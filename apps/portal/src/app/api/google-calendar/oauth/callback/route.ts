import { NextRequest, NextResponse } from "next/server";

import { createUuidV7 } from "@axtro/domain";
import {
  createFakeGoogleAuthorizationCodeExchange,
  exchangeGoogleAuthorizationCode,
  GoogleCalendarProviderError,
  googleCalendarFakeProvidersEnabled,
} from "@axtro/provider-google-calendar";

import { decodeGoogleIdTokenEmail } from "@/lib/google-calendar/id-token";
import { consumeGoogleCalendarOAuthState } from "@/lib/google-calendar/oauth-state";
import { googleCalendarOAuthRedirectUri } from "@/lib/google-calendar/oauth-url";
import { portalPublicOrigin } from "@/lib/public-origin";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { logError as trackError } from "@/lib/telemetry";

/**
 * Callback OAuth do Google Calendar (ADR-039, onda 1b-ii) — a primeira rota
 * de callback OAuth por redirect de navegador deste repositório; toda outra
 * rota em `api/*` é webhook push (provider → servidor via POST), sem sessão
 * de usuário. Esta é diferente: o Google redireciona o NAVEGADOR do
 * `tenant_admin` de volta pra cá com `?code=...&state=...` (ou
 * `?error=...` se o usuário negar consentimento).
 *
 * Responsabilidades, em ordem, cada uma fechando a rota antes da próxima se
 * falhar:
 * 1. `error=` do Google → recusa com um código curto, nunca repassa o texto
 *    bruto do Google pra URL de retorno.
 * 2. `code`/`state` ausentes → recusa.
 * 3. `state` inválido/expirado/já usado (`oauth-state.ts`) → recusa. Esta é
 *    a defesa de CSRF (RFC 6749 §10.12): sem ela, um atacante poderia
 *    induzir a vítima `tenant_admin` a conectar a conta Google DO ATACANTE
 *    ao tenant da vítima.
 * 4. Reautentica a sessão atual (`supabase.auth.getUser()` + RPC de
 *    overview, mesmo padrão de `billing.ts`) e confirma que ainda é o MESMO
 *    tenant_admin amarrado ao `state` — nunca confia só no `state` sozinho;
 *    um logout+login como outro membro dentro da janela de 10 minutos não
 *    pode reaproveitar o `state` de outra identidade.
 * 5. Troca `code` por tokens (real ou fake conforme `PORTAL_FAKE_PROVIDERS`,
 *    mesmo padrão de todo outro provider deste repo) — `missing_refresh_token`
 *    vira um aviso específico orientando revogar acesso em
 *    myaccount.google.com/permissions.
 * 6. Decodifica o e-mail da conta conectada a partir do `id_token` (nunca
 *    valida assinatura — ver `id-token.ts`); usa `"primary"` como
 *    `calendarId` (alias documentado do Google pro calendário principal da
 *    própria identidade autenticada pelo token, sem chamada HTTP extra).
 * 7. Chama `portal_connect_google_calendar_service` (service_role).
 * 8. Redireciona pra `/configuracoes?calendar_status=connected` (sucesso)
 *    ou `/configuracoes?calendar_error=<motivo_curto>` (qualquer falha) —
 *    nunca vaza detalhe de erro sensível na URL, mesmo padrão de
 *    `billing_error` em `billing.ts`.
 *
 * Nunca loga `code`, `state`, `refresh_token`, `access_token` ou `id_token`
 * bruto em nenhum caminho (sucesso ou erro) — só metadados não sensíveis
 * (`tenant_id`, código de erro tipado do provider).
 */
export const dynamic = "force-dynamic";

interface TenantOverviewRpcRow {
  readonly provisioned?: unknown;
  readonly role?: unknown;
  readonly tenant?: { readonly id?: unknown; readonly default_timezone?: unknown } | null;
}

export async function GET(request: NextRequest): Promise<Response> {
  let origin: string;
  try {
    origin = portalPublicOrigin();
  } catch {
    // Ambiente sem PORTAL_PUBLIC_URL configurada (e fora de modo fake) --
    // mesmo padrão 503 "not_configured" já usado em
    // api/resend/webhook/route.ts pra "faltou configuração"; nunca constrói
    // um redirect a partir de uma origem não aprovada.
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  const errorRedirect = (code: string): NextResponse => NextResponse.redirect(`${origin}/configuracoes?calendar_error=${code}`);

  const url = new URL(request.url);
  const googleError = url.searchParams.get("error");
  if (googleError !== null) {
    return errorRedirect("consentimento_negado");
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (code === null || code.length === 0 || state === null || state.length === 0) {
    return errorRedirect("callback_invalido");
  }

  const pending = consumeGoogleCalendarOAuthState(state);
  if (pending === null) {
    return errorRedirect("state_invalido");
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const actorId = typeof user?.app_metadata?.actor_id === "string" ? user.app_metadata.actor_id : null;

  const { data: overviewData, error: overviewError } = await supabase.rpc("portal_tenant_overview");
  if (overviewError) {
    trackError("calendar_oauth_overview_failed", overviewError, {});
    return errorRedirect("sessao_invalida");
  }
  const overview = overviewData as TenantOverviewRpcRow | null;
  const tenantId = typeof overview?.tenant?.id === "string" ? overview.tenant.id : null;
  const defaultTimezone = typeof overview?.tenant?.default_timezone === "string" ? overview.tenant.default_timezone : null;

  if (
    user === null || actorId === null || actorId !== pending.actorId
    || overview?.provisioned !== true || overview?.role !== "tenant_admin"
    || tenantId === null || tenantId !== pending.tenantId || defaultTimezone === null
  ) {
    return errorRedirect("sessao_divergente");
  }

  const fakeMode = googleCalendarFakeProvidersEnabled();
  const clientId = fakeMode ? "fake-google-oauth-client-id.apps.googleusercontent.com" : (process.env.GOOGLE_OAUTH_CLIENT_ID ?? "").trim();
  const clientSecret = fakeMode ? "fake-google-oauth-client-secret" : (process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? "").trim();
  if (!fakeMode && (clientId.length === 0 || clientSecret.length === 0)) {
    trackError("calendar_oauth_not_configured", new Error("Google OAuth client is not configured"), {});
    return errorRedirect("nao_configurado");
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
    return errorRedirect(providerCode === "missing_refresh_token" ? "sem_refresh_token" : "falha_na_troca");
  }

  const email = tokens.idToken !== null ? decodeGoogleIdTokenEmail(tokens.idToken) : null;
  if (email === null) {
    trackError("calendar_oauth_missing_email", new Error("Google token exchange did not include a usable id_token email claim"), { tenant_id: tenantId });
    return errorRedirect("sem_email_google");
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
      return errorRedirect("falha_ao_conectar");
    }
    const outcome = (connectData as { outcome?: unknown } | null)?.outcome;
    if (outcome !== "connected") {
      trackError("calendar_oauth_connect_unexpected_outcome", new Error("unexpected connect outcome"), { tenant_id: tenantId, outcome: String(outcome) });
      return errorRedirect("falha_ao_conectar");
    }
  } catch (serviceError) {
    trackError("calendar_oauth_connect_failed", serviceError, { tenant_id: tenantId });
    return errorRedirect("falha_ao_conectar");
  }

  return NextResponse.redirect(`${origin}/configuracoes?calendar_status=connected`);
}
