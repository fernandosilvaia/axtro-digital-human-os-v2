import { createUuidV7 } from "@axtro/domain";
import {
  createFakeStripeConnectAuthorizationCodeExchange,
  exchangeStripeConnectAuthorizationCode,
  StripeBillingError,
  stripeConnectFakeProvidersEnabled,
} from "@axtro/provider-stripe";

import {
  STRIPE_CONNECT_OAUTH_STATE_SECRET_ENV,
  StripeConnectOAuthStateError,
  verifyStripeConnectOAuthStateToken,
} from "./stripe-connect-oauth-state";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { logError as trackError } from "@/lib/telemetry";

/**
 * Corpo do callback OAuth da Stripe Connect, sem a casca HTTP nem o cookie
 * de `state` (esse fica na rota, é transporte, não domínio): extraído da
 * rota `api/stripe/connect-oauth/callback` pelo mesmo motivo de
 * `fulfill-oauth-callback.ts` do Google Calendar -- um `redirect()` de
 * dentro de uma Server Action pra uma rota interna faz o Next.js
 * resolvê-la duas vezes pro mesmo clique. O `state` da Stripe Connect é
 * deliberadamente um cookie assinado sem estado compartilhado (ver o
 * cabeçalho de `stripe-connect-oauth-state.ts`, decisão consciente
 * diferente do Google Calendar depois do D-V2-174), então a verificação de
 * ASSINATURA em si tolera ser repetida. Mas a rota ainda apaga o cookie na
 * entrada pra garantir uso único do FLUXO como um todo -- e é exatamente
 * essa parte que quebrava com a dupla execução (a segunda vinha sempre sem
 * cookie, `callback_invalido`), mesmo quando a primeira já tinha
 * conectado de verdade. Achado por analogia direta ao mesmo bug do Google
 * Calendar (2026-09-27), nunca chegou a se manifestar pra um usuário real
 * porque este fluxo ainda não está ligado a nenhum botão da UI -- corrigido
 * preventivamente antes de ligar.
 */
export type StripeConnectOAuthFulfillmentResult =
  | Readonly<{ readonly outcome: "connected" }>
  | Readonly<{ readonly outcome: "error"; readonly code: string }>;

export async function fulfillStripeConnectOAuthCallback(
  code: string,
  state: string,
): Promise<StripeConnectOAuthFulfillmentResult> {
  const stateSecret = (process.env[STRIPE_CONNECT_OAUTH_STATE_SECRET_ENV] ?? "").trim();
  let pending: { tenantId: string; actorId: string };
  try {
    const payload = verifyStripeConnectOAuthStateToken(state, stateSecret);
    pending = { tenantId: payload.tenant_id, actorId: payload.actor_id };
  } catch (error) {
    if (error instanceof StripeConnectOAuthStateError && error.code === "state_token_expired") {
      return { outcome: "error", code: "state_expirado" };
    }
    return { outcome: "error", code: "state_invalido" };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const actorId = typeof user?.app_metadata?.actor_id === "string" ? user.app_metadata.actor_id : null;

  const { data: overviewData, error: overviewError } = await supabase.rpc("portal_tenant_overview");
  if (overviewError) {
    trackError("stripe_connect_oauth_overview_failed", overviewError, {});
    return { outcome: "error", code: "sessao_invalida" };
  }
  const overview = overviewData as { provisioned?: unknown; role?: unknown; tenant?: { id?: unknown } | null } | null;
  const tenantId = typeof overview?.tenant?.id === "string" ? overview.tenant.id : null;

  if (
    user === null || actorId === null || actorId !== pending.actorId
    || overview?.provisioned !== true || overview?.role !== "tenant_admin"
    || tenantId === null || tenantId !== pending.tenantId
  ) {
    return { outcome: "error", code: "sessao_divergente" };
  }

  const fakeMode = stripeConnectFakeProvidersEnabled();
  const platformSecretKey = fakeMode ? "sk_test_fake_platform_key_00" : (process.env.STRIPE_SECRET_KEY ?? "").trim();
  if (!fakeMode && platformSecretKey.length === 0) {
    trackError("stripe_connect_oauth_not_configured", new Error("Stripe platform secret key is not configured"), {});
    return { outcome: "error", code: "nao_configurado" };
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
    return { outcome: "error", code: "falha_na_troca" };
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
      return { outcome: "error", code: "falha_ao_conectar" };
    }
    const outcome = (connectData as { outcome?: unknown } | null)?.outcome;
    if (outcome === "account_already_connected_elsewhere") {
      trackError("stripe_connect_oauth_account_conflict", new Error("connected account already belongs to a different tenant"), { tenant_id: tenantId });
      return { outcome: "error", code: "conta_ja_conectada_a_outro_tenant" };
    }
    if (outcome !== "connected") {
      trackError("stripe_connect_oauth_connect_unexpected_outcome", new Error("unexpected connect outcome"), { tenant_id: tenantId, outcome: String(outcome) });
      return { outcome: "error", code: "falha_ao_conectar" };
    }
  } catch (serviceError) {
    trackError("stripe_connect_oauth_connect_failed", serviceError, { tenant_id: tenantId });
    return { outcome: "error", code: "falha_ao_conectar" };
  }

  return { outcome: "connected" };
}
