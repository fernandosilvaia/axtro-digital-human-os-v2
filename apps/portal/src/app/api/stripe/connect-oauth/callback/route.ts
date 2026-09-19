import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

import { createUuidV7 } from "@axtro/domain";
import {
  createFakeStripeConnectAuthorizationCodeExchange,
  exchangeStripeConnectAuthorizationCode,
  StripeBillingError,
  stripeConnectFakeProvidersEnabled,
} from "@axtro/provider-stripe";

import {
  STRIPE_CONNECT_OAUTH_STATE_COOKIE_NAME,
  STRIPE_CONNECT_OAUTH_STATE_SECRET_ENV,
  StripeConnectOAuthStateError,
  verifyStripeConnectOAuthStateToken,
} from "@/lib/billing/stripe-connect-oauth-state";
import { portalPublicOrigin } from "@/lib/public-origin";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { logError as trackError } from "@/lib/telemetry";

/**
 * Callback OAuth da Stripe Connect (ADR-040), a segunda rota de callback
 * OAuth por redirect de navegador deste repositório (a primeira é
 * `api/google-calendar/oauth/callback`, mesmo padrão espelhado aqui).
 *
 * Responsabilidades, em ordem, cada uma fechando a rota antes da próxima se
 * falhar:
 * 1. `error=` da Stripe (usuário negou consentimento) -> recusa com um
 *    código curto, nunca repassa o texto bruto da Stripe pra URL de
 *    retorno.
 * 2. `code`/`state` ausentes -> recusa.
 * 3. Cookie de `state` ausente -> recusa. Consome (apaga) o cookie sempre,
 *    tenha ou não sucesso: uso único, mesmo espírito de
 *    `consumeGoogleCalendarOAuthState`.
 * 4. `state` do cookie verificado por assinatura HMAC + double-submit
 *    contra o `state` da query string (os dois precisam ser BYTE-IDÊNTICOS,
 *    defesa em profundidade além da assinatura sozinha).
 * 5. Reautentica a sessão atual e confirma que ainda é o MESMO tenant_admin
 *    amarrado ao `state`, mesma defesa que o callback do Google Calendar já
 *    aplica: nunca confia só no `state` sozinho.
 * 6. Troca `code` por `stripe_user_id` (real ou fake conforme
 *    `PORTAL_FAKE_PROVIDERS`).
 * 7. Chama `portal_complete_stripe_connect_service` (`service_role`).
 * 8. Redireciona pra `/configuracoes?stripe_connect_status=connected`
 *    (sucesso) ou `/configuracoes?stripe_connect_error=<motivo_curto>`
 *    (qualquer falha).
 *
 * Nunca loga `code`, `state` bruto, nem qualquer credencial em nenhum
 * caminho (sucesso ou erro), só metadados não sensíveis.
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  let origin: string;
  try {
    origin = portalPublicOrigin();
  } catch {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  const errorRedirect = (code: string): NextResponse => NextResponse.redirect(`${origin}/configuracoes?stripe_connect_error=${code}`);

  const cookieStore = await cookies();
  const cookieToken = cookieStore.get(STRIPE_CONNECT_OAUTH_STATE_COOKIE_NAME)?.value;
  // Uso único: consome o cookie ANTES de qualquer verificação, sucesso ou falha.
  cookieStore.set(STRIPE_CONNECT_OAUTH_STATE_COOKIE_NAME, "", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 0 });

  const url = new URL(request.url);
  const stripeError = url.searchParams.get("error");
  if (stripeError !== null) {
    return errorRedirect("consentimento_negado");
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (code === null || code.length === 0 || state === null || state.length === 0 || cookieToken === undefined) {
    return errorRedirect("callback_invalido");
  }
  // Double-submit: o valor da query string precisa bater byte a byte com o
  // que o cookie guardava, não só passar a própria verificação de
  // assinatura -- um atacante que conseguisse fixar (mas nunca ler) um
  // cookie de vítima não teria como produzir um `state` de query
  // correspondente.
  if (state !== cookieToken) {
    return errorRedirect("state_invalido");
  }

  const stateSecret = (process.env[STRIPE_CONNECT_OAUTH_STATE_SECRET_ENV] ?? "").trim();
  let pending: { tenantId: string; actorId: string };
  try {
    const payload = verifyStripeConnectOAuthStateToken(cookieToken, stateSecret);
    pending = { tenantId: payload.tenant_id, actorId: payload.actor_id };
  } catch (error) {
    if (error instanceof StripeConnectOAuthStateError && error.code === "state_token_expired") {
      return errorRedirect("state_expirado");
    }
    return errorRedirect("state_invalido");
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const actorId = typeof user?.app_metadata?.actor_id === "string" ? user.app_metadata.actor_id : null;

  const { data: overviewData, error: overviewError } = await supabase.rpc("portal_tenant_overview");
  if (overviewError) {
    trackError("stripe_connect_oauth_overview_failed", overviewError, {});
    return errorRedirect("sessao_invalida");
  }
  const overview = overviewData as { provisioned?: unknown; role?: unknown; tenant?: { id?: unknown } | null } | null;
  const tenantId = typeof overview?.tenant?.id === "string" ? overview.tenant.id : null;

  if (
    user === null || actorId === null || actorId !== pending.actorId
    || overview?.provisioned !== true || overview?.role !== "tenant_admin"
    || tenantId === null || tenantId !== pending.tenantId
  ) {
    return errorRedirect("sessao_divergente");
  }

  const fakeMode = stripeConnectFakeProvidersEnabled();
  const platformSecretKey = fakeMode ? "sk_test_fake_platform_key_00" : (process.env.STRIPE_SECRET_KEY ?? "").trim();
  if (!fakeMode && platformSecretKey.length === 0) {
    trackError("stripe_connect_oauth_not_configured", new Error("Stripe platform secret key is not configured"), {});
    return errorRedirect("nao_configurado");
  }

  const exchange = fakeMode ? createFakeStripeConnectAuthorizationCodeExchange() : exchangeStripeConnectAuthorizationCode;
  let stripeAccountId: string;
  try {
    const result = await exchange({ platformSecretKey, code });
    stripeAccountId = result.stripeAccountId;
  } catch (error) {
    // NUNCA loga `code` nem qualquer credencial -- só o código de erro
    // tipado do provider (metadado seguro) e o tenant.
    const providerCode = error instanceof StripeBillingError ? error.code : "unknown";
    trackError("stripe_connect_oauth_exchange_failed", new Error(`Stripe Connect token exchange failed (${providerCode})`), { tenant_id: tenantId });
    return errorRedirect("falha_na_troca");
  }

  try {
    const service = createServiceRoleClient();
    const { data: connectData, error: connectError } = await service.rpc("portal_complete_stripe_connect_service", {
      p_id: createUuidV7(),
      p_tenant_id: tenantId,
      p_actor_id: actorId,
      p_stripe_account_id: stripeAccountId,
    });
    if (connectError) {
      trackError("stripe_connect_oauth_connect_failed", connectError, { tenant_id: tenantId });
      return errorRedirect("falha_ao_conectar");
    }
    const outcome = (connectData as { outcome?: unknown } | null)?.outcome;
    if (outcome === "account_already_connected_elsewhere") {
      trackError("stripe_connect_oauth_account_conflict", new Error("connected account already belongs to a different tenant"), { tenant_id: tenantId });
      return errorRedirect("conta_ja_conectada_a_outro_tenant");
    }
    if (outcome !== "connected") {
      trackError("stripe_connect_oauth_connect_unexpected_outcome", new Error("unexpected connect outcome"), { tenant_id: tenantId, outcome: String(outcome) });
      return errorRedirect("falha_ao_conectar");
    }
  } catch (serviceError) {
    trackError("stripe_connect_oauth_connect_failed", serviceError, { tenant_id: tenantId });
    return errorRedirect("falha_ao_conectar");
  }

  return NextResponse.redirect(`${origin}/configuracoes?stripe_connect_status=connected`);
}
