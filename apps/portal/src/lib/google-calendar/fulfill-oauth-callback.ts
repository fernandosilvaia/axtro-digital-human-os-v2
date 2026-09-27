import { createUuidV7 } from "@axtro/domain";
import {
  createFakeGoogleAuthorizationCodeExchange,
  exchangeGoogleAuthorizationCode,
  GoogleCalendarProviderError,
  googleCalendarFakeProvidersEnabled,
} from "@axtro/provider-google-calendar";

import { decodeGoogleIdTokenEmail } from "./id-token";
import { consumeGoogleCalendarOAuthState } from "./oauth-state";
import { googleCalendarOAuthRedirectUri } from "./oauth-url";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { logError as trackError } from "@/lib/telemetry";

/**
 * Corpo do callback OAuth do Google Calendar, sem a casca HTTP: extraído da
 * rota `api/google-calendar/oauth/callback` pra poder ser chamado por dois
 * caminhos diferentes.
 *
 * 1. A rota em si, quando o Google redireciona o navegador de volta (modo real).
 * 2. `startGoogleCalendarConnection` diretamente, em modo fake -- NUNCA mais
 *    via `redirect()` pra própria rota. Um `redirect()` de dentro de uma
 *    Server Action pra uma rota interna faz o Next.js resolver essa rota
 *    internamente como parte da própria resposta da action, E o navegador
 *    navega pra ela de novo em seguida: duas execuções reais desta função
 *    pro mesmo clique. Como o `state` é de uso único por design (defesa de
 *    replay), a segunda execução sempre falhava com "state_invalido" --
 *    mesmo a conexão tendo sido concluída de verdade na primeira. Achado
 *    testando o botão como um usuário real testaria (2026-09-27): a conexão
 *    aparecia como bem-sucedida no banco, mas a tela sempre mostrava erro.
 *    Em modo real isso nunca acontece: o destino é `accounts.google.com`,
 *    um domínio externo que o Next.js não tem como resolver internamente.
 */
export type GoogleCalendarOAuthFulfillmentResult =
  | Readonly<{ readonly outcome: "connected" }>
  | Readonly<{ readonly outcome: "error"; readonly code: string }>;

export async function fulfillGoogleCalendarOAuthCallback(
  code: string,
  state: string,
): Promise<GoogleCalendarOAuthFulfillmentResult> {
  const pending = await consumeGoogleCalendarOAuthState(state);
  if (pending === null) {
    return { outcome: "error", code: "state_invalido" };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const actorId = typeof user?.app_metadata?.actor_id === "string" ? user.app_metadata.actor_id : null;

  const { data: overviewData, error: overviewError } = await supabase.rpc("portal_tenant_overview");
  if (overviewError) {
    trackError("calendar_oauth_overview_failed", overviewError, {});
    return { outcome: "error", code: "sessao_invalida" };
  }
  const overview = overviewData as {
    readonly provisioned?: unknown;
    readonly role?: unknown;
    readonly tenant?: { readonly id?: unknown; readonly default_timezone?: unknown } | null;
  } | null;
  const tenantId = typeof overview?.tenant?.id === "string" ? overview.tenant.id : null;
  const defaultTimezone = typeof overview?.tenant?.default_timezone === "string" ? overview.tenant.default_timezone : null;

  if (
    user === null || actorId === null || actorId !== pending.actorId
    || overview?.provisioned !== true || overview?.role !== "tenant_admin"
    || tenantId === null || tenantId !== pending.tenantId || defaultTimezone === null
  ) {
    return { outcome: "error", code: "sessao_divergente" };
  }

  const fakeMode = googleCalendarFakeProvidersEnabled();
  const clientId = fakeMode ? "fake-google-oauth-client-id.apps.googleusercontent.com" : (process.env.GOOGLE_OAUTH_CLIENT_ID ?? "").trim();
  const clientSecret = fakeMode ? "fake-google-oauth-client-secret" : (process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? "").trim();
  if (!fakeMode && (clientId.length === 0 || clientSecret.length === 0)) {
    trackError("calendar_oauth_not_configured", new Error("Google OAuth client is not configured"), {});
    return { outcome: "error", code: "nao_configurado" };
  }

  const exchange = fakeMode ? createFakeGoogleAuthorizationCodeExchange() : exchangeGoogleAuthorizationCode;
  let tokens: Awaited<ReturnType<typeof exchangeGoogleAuthorizationCode>>;
  try {
    tokens = await exchange({ clientId, clientSecret, code, redirectUri: googleCalendarOAuthRedirectUri() });
  } catch (error) {
    // NUNCA loga `code` nem qualquer token -- só o código de erro tipado do
    // provider (metadado seguro) e o tenant.
    const providerCode = error instanceof GoogleCalendarProviderError ? error.code : "unknown";
    trackError("calendar_oauth_exchange_failed", new Error(`Google token exchange failed (${providerCode})`), { tenant_id: tenantId });
    return { outcome: "error", code: providerCode === "missing_refresh_token" ? "sem_refresh_token" : "falha_na_troca" };
  }

  const email = tokens.idToken !== null ? decodeGoogleIdTokenEmail(tokens.idToken) : null;
  if (email === null) {
    trackError("calendar_oauth_missing_email", new Error("Google token exchange did not include a usable id_token email claim"), { tenant_id: tenantId });
    return { outcome: "error", code: "sem_email_google" };
  }

  try {
    const service = createServiceRoleClient();
    const { data: connectData, error: connectError } = await service.rpc("portal_connect_google_calendar_service", {
      p_id: createUuidV7(),
      p_tenant_id: tenantId,
      p_actor_id: actorId,
      p_google_account_email: email,
      p_calendar_id: "primary",
      p_default_timezone: defaultTimezone,
      p_refresh_token: tokens.refreshToken,
    });
    if (connectError) {
      trackError("calendar_oauth_connect_failed", connectError, { tenant_id: tenantId });
      return { outcome: "error", code: "falha_ao_conectar" };
    }
    const outcome = (connectData as { outcome?: unknown } | null)?.outcome;
    if (outcome !== "connected") {
      trackError("calendar_oauth_connect_unexpected_outcome", new Error("unexpected connect outcome"), { tenant_id: tenantId, outcome: String(outcome) });
      return { outcome: "error", code: "falha_ao_conectar" };
    }
  } catch (serviceError) {
    trackError("calendar_oauth_connect_failed", serviceError, { tenant_id: tenantId });
    return { outcome: "error", code: "falha_ao_conectar" };
  }

  return { outcome: "connected" };
}
