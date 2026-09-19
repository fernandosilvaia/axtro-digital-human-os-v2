"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

import {
  createFakeDeauthorizeStripeConnectAccount,
  deauthorizeStripeConnectAccount,
  StripeBillingError,
} from "@axtro/provider-stripe";

import {
  issueStripeConnectOAuthStateToken,
  STRIPE_CONNECT_OAUTH_STATE_COOKIE_NAME,
  STRIPE_CONNECT_OAUTH_STATE_SECRET_ENV,
} from "@/lib/billing/stripe-connect-oauth-state";
import { buildStripeConnectAuthorizationUrl, stripeConnectOAuthRedirectUri } from "@/lib/billing/stripe-connect-oauth-url";
import { fetchTenantOverview } from "@/lib/portal-data";
import { isRateLimited } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { logError as trackError } from "@/lib/telemetry";

/**
 * Server Actions de conexão/desconexão da conta Stripe conectada (ADR-040).
 * Mesma estrutura de `calendar-connection.ts` (ADR-039, onda 1b-ii):
 * `startStripeConnectConnection` autentica, confere `tenant_admin`, gera o
 * `state` anti-CSRF e redireciona pra Stripe (ou, em modo fake, direto pra
 * própria rota de callback). `disconnectStripeConnect` desautoriza do lado
 * da Stripe e marca a linha local como desconectada.
 */
const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
/** Não precisa ser um code real: em modo fake, a rota de callback nunca chama a rede, só o exchange determinístico. */
const FAKE_STRIPE_CONNECT_AUTHORIZATION_CODE = "ac_fake_stripe_connect_authorization_code";

function fakeProvidersEnabled(): boolean {
  return (process.env.PORTAL_FAKE_PROVIDERS ?? "").trim() === "1";
}

async function setStripeConnectOAuthStateCookie(token: string, expiresAtIso: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(STRIPE_CONNECT_OAUTH_STATE_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(expiresAtIso),
    priority: "high",
  });
}

export async function startStripeConnectConnection(): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user === null) {
    redirect("/login");
  }

  const overview = await fetchTenantOverview();
  if (!overview.provisioned || overview.tenant === undefined) {
    redirect("/configuracoes?stripe_connect_error=conta_nao_provisionada");
  }
  if (overview.role !== "tenant_admin") {
    redirect("/configuracoes?stripe_connect_error=apenas_admin");
  }

  const actorId = typeof user.app_metadata?.actor_id === "string" ? user.app_metadata.actor_id : null;
  if (actorId === null || !UUID_V7_PATTERN.test(actorId)) {
    trackError("stripe_connect_start_missing_actor", new Error("authenticated session is missing a tenant actor id"), { tenant_id: overview.tenant.id });
    redirect("/configuracoes?stripe_connect_error=sessao_invalida");
  }

  if (isRateLimited(`stripe-connect-connect:${overview.tenant.id}`, 60_000, 6)) {
    redirect("/configuracoes?stripe_connect_error=tentativas_excedidas");
  }

  const fakeProviders = fakeProvidersEnabled();
  const connectClientId = (process.env.STRIPE_CONNECT_CLIENT_ID ?? "").trim();
  const stateSecret = (process.env[STRIPE_CONNECT_OAUTH_STATE_SECRET_ENV] ?? "").trim();
  if (!fakeProviders && connectClientId.length === 0) {
    trackError("stripe_connect_start_not_configured", new Error("STRIPE_CONNECT_CLIENT_ID is not configured"), {});
    redirect("/configuracoes?stripe_connect_error=nao_configurado");
  }
  if (stateSecret.length === 0) {
    trackError("stripe_connect_start_state_secret_missing", new Error("STRIPE_CONNECT_OAUTH_STATE_SECRET is not configured"), {});
    redirect("/configuracoes?stripe_connect_error=nao_configurado");
  }

  let token: string;
  let expiresAtIso: string;
  try {
    const now = new Date();
    token = issueStripeConnectOAuthStateToken(overview.tenant.id, actorId, stateSecret, now);
    expiresAtIso = new Date(now.getTime() + 600_000).toISOString();
  } catch (error) {
    trackError("stripe_connect_start_state_unavailable", error, { tenant_id: overview.tenant.id });
    redirect("/configuracoes?stripe_connect_error=falha_ao_conectar");
  }
  await setStripeConnectOAuthStateCookie(token, expiresAtIso);

  if (fakeProviders) {
    // Modo demonstração sem credencial real: nunca manda o navegador pro
    // domínio real da Stripe (mesmo espírito do checkout fake em billing.ts
    // e do callback fake do Google Calendar). O `code` é sempre ignorado
    // pelo exchange fake, só o `state` (cookie + query, double-submit)
    // precisa ser real para exercitar a mesma validação do modo real.
    redirect(`/api/stripe/connect-oauth/callback?code=${encodeURIComponent(FAKE_STRIPE_CONNECT_AUTHORIZATION_CODE)}&state=${encodeURIComponent(token)}`);
  }

  const authorizationUrl = buildStripeConnectAuthorizationUrl({
    connectClientId,
    redirectUri: stripeConnectOAuthRedirectUri(),
    state: token,
  });
  redirect(authorizationUrl);
}

export interface DisconnectStripeConnectState {
  readonly error: string | null;
}

export async function disconnectStripeConnect(): Promise<DisconnectStripeConnectState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user === null) return { error: "Sessão expirada. Faça login de novo." };

  const overview = await fetchTenantOverview();
  if (!overview.provisioned || overview.tenant === undefined) return { error: "Conta ainda não provisionada." };
  if (overview.role !== "tenant_admin") return { error: "Somente administradores podem desconectar a Stripe." };

  const actorId = typeof user.app_metadata?.actor_id === "string" ? user.app_metadata.actor_id : null;
  if (actorId === null || !UUID_V7_PATTERN.test(actorId)) {
    trackError("stripe_connect_disconnect_missing_actor", new Error("authenticated session is missing a tenant actor id"), { tenant_id: overview.tenant.id });
    return { error: "Sessão inválida. Recarregue a página e tente de novo." };
  }

  try {
    const service = createServiceRoleClient();
    const { data: statusData, error: statusError } = await service.rpc("portal_stripe_connect_status_service", {
      p_tenant_id: overview.tenant.id,
    });
    if (statusError) {
      trackError("stripe_connect_disconnect_status_failed", statusError, { tenant_id: overview.tenant.id });
      return { error: "Não foi possível desconectar agora. Tente novamente." };
    }
    const stripeAccountId = (statusData as { stripeAccountId?: unknown } | null)?.stripeAccountId;

    if (typeof stripeAccountId === "string" && stripeAccountId.length > 0) {
      const fakeProviders = fakeProvidersEnabled();
      const platformSecretKey = (process.env.STRIPE_SECRET_KEY ?? "").trim();
      const connectClientId = (process.env.STRIPE_CONNECT_CLIENT_ID ?? "").trim();
      const deauthorize = fakeProviders ? createFakeDeauthorizeStripeConnectAccount() : deauthorizeStripeConnectAccount;
      if (!fakeProviders && (platformSecretKey.length === 0 || connectClientId.length === 0)) {
        trackError("stripe_connect_disconnect_not_configured", new Error("Stripe Connect client is not configured"), { tenant_id: overview.tenant.id });
        return { error: "Não foi possível desconectar agora. Tente novamente." };
      }
      try {
        await deauthorize({
          platformSecretKey: fakeProviders ? "sk_test_fake_platform_key_00" : platformSecretKey,
          connectClientId: fakeProviders ? "ca_fake_connect_client_id_00" : connectClientId,
          stripeAccountId,
        });
      } catch (error) {
        // NUNCA loga a chave -- só o código de erro tipado do provider.
        const providerCode = error instanceof StripeBillingError ? error.code : "unknown";
        trackError("stripe_connect_deauthorize_failed", new Error(`Stripe Connect deauthorize failed (${providerCode})`), { tenant_id: overview.tenant.id });
        return { error: "Não foi possível desconectar agora. Tente novamente." };
      }
    }

    const { data, error } = await service.rpc("portal_disconnect_stripe_service", {
      p_tenant_id: overview.tenant.id,
      p_actor_id: actorId,
    });
    if (error) {
      trackError("stripe_connect_disconnect_failed", error, { tenant_id: overview.tenant.id });
      return { error: "Não foi possível desconectar agora. Tente novamente." };
    }
    const outcome = (data as { outcome?: unknown } | null)?.outcome;
    if (outcome !== "disconnected" && outcome !== "not_connected") {
      trackError("stripe_connect_disconnect_unexpected_outcome", new Error("unexpected disconnect outcome"), { tenant_id: overview.tenant.id, outcome: String(outcome) });
      return { error: "Não foi possível confirmar a desconexão. Tente novamente." };
    }
  } catch (serviceError) {
    trackError("stripe_connect_disconnect_failed", serviceError, { tenant_id: overview.tenant.id });
    return { error: "Não foi possível desconectar agora. Tente novamente." };
  }

  revalidatePath("/configuracoes");
  return { error: null };
}
