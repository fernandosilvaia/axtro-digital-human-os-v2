"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { buildGoogleCalendarAuthorizationUrl, googleCalendarOAuthRedirectUri } from "@/lib/google-calendar/oauth-url";
import { createGoogleCalendarOAuthState } from "@/lib/google-calendar/oauth-state";
import { fetchTenantOverview } from "@/lib/portal-data";
import { isRateLimited } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { logError as trackError } from "@/lib/telemetry";

/**
 * Server Actions de conexão/desconexão do Google Calendar (ADR-039, onda
 * 1b-ii). `startGoogleCalendarConnection` é a metade "connect" do fluxo
 * OAuth: autentica, confere `tenant_admin` (mesmo padrão de billing.ts),
 * gera o `state` anti-CSRF (`oauth-state.ts`) e redireciona pro Google (ou,
 * em modo fake, direto pra própria rota de callback — mesmo espírito de
 * `createDeterministicFakeCheckoutPort` em billing.ts, que também nunca
 * manda o navegador pra um domínio de terceiro real em modo fake).
 * `disconnectGoogleCalendar` chama a RPC de revogação; a RPC já trata
 * corretamente o caso `reauth_required` (mesmo botão "Reconectar" da UI
 * simplesmente chama `startGoogleCalendarConnection` de novo).
 */
const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const FAKE_GOOGLE_OAUTH_CLIENT_ID = "fake-google-oauth-client-id.apps.googleusercontent.com";
/** Não precisa ser um code real: em modo fake, a rota de callback nunca valida o conteúdo do code, só troca por tokens fake determinísticos. */
const FAKE_GOOGLE_OAUTH_AUTHORIZATION_CODE = "fake-google-authorization-code";

function fakeProvidersEnabled(): boolean {
  return (process.env.PORTAL_FAKE_PROVIDERS ?? "").trim() === "1";
}

export async function startGoogleCalendarConnection(): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user === null) {
    redirect("/login");
  }

  const overview = await fetchTenantOverview();
  if (!overview.provisioned || overview.tenant === undefined) {
    redirect("/configuracoes?calendar_error=conta_nao_provisionada");
  }
  if (overview.role !== "tenant_admin") {
    // Ação de servidor é POST-ável direto (o botão só fica escondido na UI
    // pra quem não é admin) — mesmo controle de papel que toda RPC
    // administrativa do projeto já aplica, mesmo padrão de billing.ts.
    redirect("/configuracoes?calendar_error=apenas_admin");
  }

  const actorId = typeof user.app_metadata?.actor_id === "string" ? user.app_metadata.actor_id : null;
  if (actorId === null || !UUID_V7_PATTERN.test(actorId)) {
    trackError("calendar_connect_missing_actor", new Error("authenticated session is missing a tenant actor id"), { tenant_id: overview.tenant.id });
    redirect("/configuracoes?calendar_error=sessao_invalida");
  }

  // Mesmo limiter tenant-scoped já usado pelo checkout (billing.ts) — aqui
  // limita quantos `state` pendentes um tenant pode gerar sem completar o
  // fluxo, defesa em profundidade além do bound de tamanho do Map em
  // oauth-state.ts.
  if (isRateLimited(`google-calendar-connect:${overview.tenant.id}`, 60_000, 6)) {
    redirect("/configuracoes?calendar_error=tentativas_excedidas");
  }

  const fakeProviders = fakeProvidersEnabled();
  const clientId = (process.env.GOOGLE_OAUTH_CLIENT_ID ?? "").trim();
  const clientSecret = (process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? "").trim();
  if (!fakeProviders && (clientId.length === 0 || clientSecret.length === 0)) {
    trackError("calendar_connect_not_configured", new Error("Google OAuth client is not configured"), {});
    redirect("/configuracoes?calendar_error=nao_configurado");
  }

  const state = createGoogleCalendarOAuthState(overview.tenant.id, actorId);

  if (fakeProviders) {
    // Modo demonstração sem credencial real: nunca manda o navegador pro
    // domínio real do Google (mesmo espírito do checkout fake da Stripe em
    // billing.ts) — em vez disso, redireciona direto pra nossa própria rota
    // de callback com um `code` fake, exercitando o mesmo caminho de
    // validação de `state`/RPC de conexão que o modo real usa.
    redirect(`/api/google-calendar/oauth/callback?code=${encodeURIComponent(FAKE_GOOGLE_OAUTH_AUTHORIZATION_CODE)}&state=${encodeURIComponent(state)}`);
  }

  const authorizationUrl = buildGoogleCalendarAuthorizationUrl({
    clientId,
    redirectUri: googleCalendarOAuthRedirectUri(),
    state,
  });
  redirect(authorizationUrl);
}

export interface DisconnectGoogleCalendarState {
  readonly error: string | null;
}

export async function disconnectGoogleCalendar(): Promise<DisconnectGoogleCalendarState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user === null) return { error: "Sessão expirada — faça login de novo." };

  const overview = await fetchTenantOverview();
  if (!overview.provisioned || overview.tenant === undefined) return { error: "Conta ainda não provisionada." };
  if (overview.role !== "tenant_admin") return { error: "Somente administradores podem desconectar o Google Calendar." };

  const actorId = typeof user.app_metadata?.actor_id === "string" ? user.app_metadata.actor_id : null;
  if (actorId === null || !UUID_V7_PATTERN.test(actorId)) {
    trackError("calendar_disconnect_missing_actor", new Error("authenticated session is missing a tenant actor id"), { tenant_id: overview.tenant.id });
    return { error: "Sessão inválida — recarregue a página e tente de novo." };
  }

  try {
    const service = createServiceRoleClient();
    const { data, error } = await service.rpc("portal_disconnect_google_calendar_service", {
      p_tenant_id: overview.tenant.id,
      p_actor_id: actorId,
    });
    if (error) {
      trackError("calendar_disconnect_failed", error, { tenant_id: overview.tenant.id });
      return { error: "Não foi possível desconectar agora. Tente novamente." };
    }
    const outcome = (data as { outcome?: unknown } | null)?.outcome;
    if (outcome !== "revoked" && outcome !== "not_connected") {
      trackError("calendar_disconnect_unexpected_outcome", new Error("unexpected disconnect outcome"), { tenant_id: overview.tenant.id, outcome: String(outcome) });
      return { error: "Não foi possível confirmar a desconexão. Tente novamente." };
    }
  } catch (serviceError) {
    trackError("calendar_disconnect_failed", serviceError, { tenant_id: overview.tenant.id });
    return { error: "Não foi possível desconectar agora. Tente novamente." };
  }

  revalidatePath("/configuracoes");
  return { error: null };
}
