/**
 * Leitura do estado de conexão do Google Calendar de um tenant, pra
 * Configurações mostrar "conectado como fulano@gmail.com" / "não conectado"
 * / "precisa reconectar". `portal_google_calendar_connection_context_service`
 * é `service_role`-only (nunca decodifica nem expõe o `vault_secret_id` além
 * da própria referência opaca) — por isso este helper, diferente de todo
 * outro fetch em `portal-data.ts`, usa `createServiceRoleClient()` em vez do
 * client autenticado por sessão, filtrando por `tenantId` explicitamente
 * (Art. 9: isolamento de tenant é controle de segurança, não conveniência).
 */
import { createServiceRoleClient } from "../supabase/service.ts";

export type GoogleCalendarConnectionStatusValue = "connected" | "revoked" | "reauth_required";

export interface GoogleCalendarConnection {
  readonly outcome: "found";
  readonly status: GoogleCalendarConnectionStatusValue;
  readonly googleAccountEmail: string;
  readonly calendarId: string;
  readonly defaultTimezone: string;
}

export interface GoogleCalendarNotConnected {
  readonly outcome: "not_connected";
}

export type GoogleCalendarConnectionContext = GoogleCalendarConnection | GoogleCalendarNotConnected;

function isConnectionContext(value: unknown): value is GoogleCalendarConnectionContext {
  if (value === null || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (record.outcome === "not_connected") return true;
  return record.outcome === "found"
    && (record.status === "connected" || record.status === "revoked" || record.status === "reauth_required")
    && typeof record.googleAccountEmail === "string"
    && typeof record.calendarId === "string"
    && typeof record.defaultTimezone === "string";
}

export async function fetchGoogleCalendarConnection(tenantId: string): Promise<GoogleCalendarConnectionContext> {
  const service = createServiceRoleClient();
  const { data, error } = await service.rpc("portal_google_calendar_connection_context_service", { p_tenant_id: tenantId });
  if (error) throw new Error(`google calendar connection fetch failed: ${error.message}`);
  if (!isConnectionContext(data)) throw new Error("google calendar connection context returned an unexpected shape");
  return data;
}
