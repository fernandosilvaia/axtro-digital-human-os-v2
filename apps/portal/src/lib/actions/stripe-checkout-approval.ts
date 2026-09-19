"use server";

import { createStripeBillingPort, StripeBillingError } from "@axtro/provider-stripe";

import { createDeterministicFakeConnectedAccountCheckoutPort, type ConnectedAccountCheckoutPort } from "@/lib/billing/checkout-preflight";
import { sendCheckoutLinkEmail } from "@/lib/email";
import { fetchTenantOverview } from "@/lib/portal-data";
import { portalPublicOrigin } from "@/lib/public-origin";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { logError as trackError, logEvent } from "@/lib/telemetry";

/**
 * Server Actions de aprovação/rejeição de reserva de checkout (ADR-040),
 * onda de aprovação humana obrigatória: só um `tenant_admin` aprova ou
 * rejeita. `rejectBusinessCheckoutReservation` nunca toca a Stripe (fence
 * estrito `pending_approval` -> `rejected`). `approveBusinessCheckoutReservation`
 * toca a Stripe: no mesmo fluxo do clique de aprovação (ADR-040,
 * "Aprovação humana do tenant"), ela avança a reserva `pending_approval` ->
 * `reserved` -> `provider_in_flight` -> `committed`, repete o preflight de
 * preço vivo (a mesma disciplina de `stripe-checkout-catalog.ts`, mas contra
 * o preço no instante do dispatch, que pode ser horas depois do cadastro),
 * cria a Checkout Session real na conta conectada do tenant e dispara o
 * e-mail do link pro `contact_email`. A tela que lista reservas
 * `pending_approval` e chama estas actions é trabalho de produto fora do
 * escopo de código deste ADR; o contrato aqui é o que essa tela vai chamar.
 *
 * `confirm_meeting_slot`/Google Calendar tem a mesma forma de lacuna que
 * este arquivo fechava antes desta revisão (a RPC de reserva existe, mas
 * nenhuma Server Action chamava `insertEvent` de verdade): ainda não fechada
 * lá, fechada aqui.
 */
const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CHECKOUT_CATALOG_CURRENCY = "usd";
/** ADR-040 recomenda um prazo curto (poucas horas): o link chega por e-mail, de forma assíncrona, nunca dentro de uma call ao vivo. */
const CHECKOUT_SESSION_EXPIRY_SECONDS = 4 * 60 * 60;

function fakeProvidersEnabled(): boolean {
  return (process.env.PORTAL_FAKE_PROVIDERS ?? "").trim() === "1";
}

interface DispatchSnapshot {
  readonly reservationId: string;
  readonly productId: string;
  readonly displayName: string;
  readonly quantity: number;
  readonly unitAmountCents: number;
  readonly currency: string;
  readonly stripePriceId: string;
  readonly stripeAccountId: string;
  readonly applicationFeeAmountCents: number | null;
  readonly contactEmail: string | null;
  readonly stripeIdempotencyKey: string;
}

function readDispatchSnapshot(value: unknown): DispatchSnapshot | null {
  const record = value as Record<string, unknown> | null;
  if (record === null || typeof record !== "object") return null;
  const {
    reservationId, productId, displayName, quantity, unitAmountCents, currency,
    stripePriceId, stripeAccountId, applicationFeeAmountCents, contactEmail, stripeIdempotencyKey,
  } = record;
  if (
    typeof reservationId !== "string" || typeof productId !== "string" || typeof displayName !== "string"
    || typeof quantity !== "number" || typeof unitAmountCents !== "number" || typeof currency !== "string"
    || typeof stripePriceId !== "string" || typeof stripeAccountId !== "string" || typeof stripeIdempotencyKey !== "string"
    || (applicationFeeAmountCents !== null && typeof applicationFeeAmountCents !== "number")
    || (contactEmail !== null && typeof contactEmail !== "string")
  ) {
    return null;
  }
  return {
    reservationId, productId, displayName, quantity, unitAmountCents, currency,
    stripePriceId, stripeAccountId, applicationFeeAmountCents, contactEmail, stripeIdempotencyKey,
  };
}

export interface CheckoutApprovalActionState {
  readonly error: string | null;
}

/** Marca a reserva como `unknown` pra reconciliação humana. Nunca lança: um operador ainda precisa saber, mesmo se este próprio RPC falhar. */
async function markCheckoutUnknown(
  service: ReturnType<typeof createServiceRoleClient>,
  tenantId: string,
  reservationId: string,
  failureCode: string,
): Promise<void> {
  try {
    const { error } = await service.rpc("portal_mark_business_checkout_reservation_unknown_service", {
      p_tenant_id: tenantId,
      p_reservation_id: reservationId,
      p_failure_code: failureCode,
    });
    if (error) throw error;
  } catch (markUnknownError) {
    trackError("checkout_mark_unknown_failed", markUnknownError, { tenant_id: tenantId, reservation_id: reservationId });
  }
}

/**
 * Dispatch -> preflight de preço vivo -> Checkout Session real -> commit ->
 * e-mail. Chamado só depois de `portal_approve_business_checkout_service`
 * já ter avançado a reserva pra `reserved`. Nunca lança: todo caminho volta
 * um `CheckoutApprovalActionState`, porque o clique de aprovação em si já
 * teve sucesso no banco (a reserva é `reserved`, no mínimo) e uma exceção
 * daqui não pode mascarar isso.
 */
async function dispatchAndCommitCheckout(tenantId: string, reservationId: string): Promise<CheckoutApprovalActionState> {
  const service = createServiceRoleClient();

  let dispatch: Record<string, unknown>;
  try {
    const { data, error } = await service.rpc("portal_dispatch_business_checkout_reservation_service", {
      p_tenant_id: tenantId,
      p_reservation_id: reservationId,
    });
    if (error) {
      trackError("checkout_dispatch_failed", error, { tenant_id: tenantId, reservation_id: reservationId });
      return { error: "Aprovado, mas não foi possível iniciar a geração do link agora. Tente novamente." };
    }
    dispatch = (data ?? {}) as Record<string, unknown>;
  } catch (serviceError) {
    trackError("checkout_dispatch_failed", serviceError, { tenant_id: tenantId, reservation_id: reservationId });
    return { error: "Aprovado, mas não foi possível iniciar a geração do link agora. Tente novamente." };
  }

  if (dispatch.acquired !== true) {
    const state = dispatch.state;
    // Outro fluxo concorrente (duplo clique, duas abas) já está processando
    // ou já terminou: idempotente, nunca um erro pro tenant_admin.
    if (state === "provider_in_flight" || state === "committed" || state === "payment_completed" || state === "payment_failed" || state === "expired") {
      return { error: null };
    }
    trackError("checkout_dispatch_not_acquired", new Error("dispatch fence was not acquired and the reservation is not in a known-safe state"), { tenant_id: tenantId, reservation_id: reservationId, state: String(state) });
    return { error: "Esta cobrança não está mais disponível para gerar um link (foi liberada ou está em reconciliação manual)." };
  }

  const snapshot = readDispatchSnapshot(dispatch);
  if (snapshot === null) {
    trackError("checkout_dispatch_malformed_snapshot", new Error("dispatch receipt was missing required snapshot fields"), { tenant_id: tenantId, reservation_id: reservationId });
    return { error: "Aprovado, mas houve uma falha ao preparar o link. A reserva ficou pendente; contate o suporte." };
  }
  if (snapshot.contactEmail === null) {
    // Nunca deveria acontecer (a aprovação exige contact_email antes de
    // chegar aqui), mas falhar fechado sem e-mail pra mandar o link é mais
    // seguro que enviar pra lugar nenhum.
    trackError("checkout_dispatch_missing_contact_email", new Error("dispatch snapshot has no contact_email even though approval requires one"), { tenant_id: tenantId, reservation_id: reservationId });
    return { error: "Aprovado, mas não há e-mail de contato registrado para enviar o link." };
  }

  const fakeProviders = fakeProvidersEnabled();
  const apiKey = (process.env.STRIPE_SECRET_KEY ?? "").trim();
  if (!fakeProviders && apiKey.length === 0) {
    trackError("checkout_dispatch_not_configured", new Error("Stripe API key is not configured"), { tenant_id: tenantId, reservation_id: reservationId });
    return { error: "Aprovado, mas a cobrança não está configurada agora. Contate o suporte." };
  }

  let origin: string;
  try {
    origin = portalPublicOrigin();
  } catch {
    trackError("checkout_dispatch_origin_not_configured", new Error("PORTAL_PUBLIC_URL is not configured"), { tenant_id: tenantId, reservation_id: reservationId });
    return { error: "Aprovado, mas a cobrança não está configurada agora. Contate o suporte." };
  }

  const port: ConnectedAccountCheckoutPort = fakeProviders
    ? createDeterministicFakeConnectedAccountCheckoutPort(`${origin}/`)
    : createStripeBillingPort({ apiKey });

  try {
    await port.verifyConnectedAccountPrice({
      stripeAccountId: snapshot.stripeAccountId,
      priceId: snapshot.stripePriceId,
      expectedUnitAmountCents: snapshot.unitAmountCents,
      expectedCurrency: snapshot.currency || CHECKOUT_CATALOG_CURRENCY,
    });
  } catch (error) {
    const providerCode = error instanceof StripeBillingError ? error.code : "unknown";
    trackError("checkout_price_preflight_failed", new Error(`Stripe connected account price preflight failed at dispatch time (${providerCode})`), { tenant_id: tenantId, reservation_id: reservationId });
    try {
      const { error: releaseError } = await service.rpc("portal_release_business_checkout_reservation_service", {
        p_tenant_id: tenantId,
        p_reservation_id: reservationId,
        p_evidence: "price_preflight_failed",
      });
      if (releaseError) trackError("checkout_price_preflight_release_failed", releaseError, { tenant_id: tenantId, reservation_id: reservationId });
    } catch (releaseServiceError) {
      trackError("checkout_price_preflight_release_failed", releaseServiceError, { tenant_id: tenantId, reservation_id: reservationId });
    }
    return { error: "O preço deste produto mudou na conta Stripe do tenant desde o cadastro. A cobrança foi cancelada; será preciso oferecer o checkout de novo." };
  }

  let session: { readonly sessionId: string; readonly checkoutUrl: string };
  try {
    const expiresAtIso = new Date(Math.floor((Date.now() + CHECKOUT_SESSION_EXPIRY_SECONDS * 1000) / 1000) * 1000).toISOString();
    session = await port.createConnectedAccountCheckoutSession({
      reservationId: snapshot.reservationId,
      tenantId,
      stripeAccountId: snapshot.stripeAccountId,
      priceId: snapshot.stripePriceId,
      quantity: snapshot.quantity,
      ...(snapshot.applicationFeeAmountCents !== null ? { applicationFeeAmountCents: snapshot.applicationFeeAmountCents } : {}),
      contactEmail: snapshot.contactEmail,
      successUrl: `${origin}/`,
      cancelUrl: `${origin}/`,
      expiresAtIso,
      idempotencyKey: snapshot.stripeIdempotencyKey,
    });
  } catch (error) {
    // Qualquer falha aqui (declarada ou de rede) é tratada como ambígua de
    // propósito: uma vez que a fence provider_in_flight foi adquirida, não
    // há como distinguir com segurança "a Stripe nunca recebeu o pedido" de
    // "recebeu, mas a resposta se perdeu" sem inspecionar o dashboard da
    // Stripe -- a mesma disciplina do ADR-036 pra todo efeito externo
    // pago. portal_mark_business_checkout_reservation_unknown_service nunca
    // chama a Stripe; só marca a linha pra reconciliação humana (dois
    // operadores tenant_admin, portal_reconcile_business_checkout_reservation_service).
    const providerCode = error instanceof StripeBillingError ? error.code : "unknown";
    trackError("checkout_session_creation_failed", new Error(`Stripe connected account checkout session creation failed (${providerCode})`), { tenant_id: tenantId, reservation_id: reservationId });
    await markCheckoutUnknown(service, tenantId, reservationId, `checkout_session_creation_${providerCode}`);
    return { error: "Aprovado, mas a criação do link de pagamento falhou de um jeito que não dá para confirmar sozinho. Um operador precisa reconciliar esta reserva manualmente." };
  }

  try {
    const { data, error } = await service.rpc("portal_commit_business_checkout_reservation_service", {
      p_tenant_id: tenantId,
      p_reservation_id: reservationId,
      p_stripe_checkout_session_id: session.sessionId,
      p_checkout_url: session.checkoutUrl,
    });
    if (error) throw error;
    const outcome = (data as { outcome?: unknown } | null)?.outcome;
    if (outcome !== "succeeded") throw new Error(`unexpected commit outcome: ${String(outcome)}`);
  } catch (commitError) {
    // A Checkout Session JÁ EXISTE na Stripe neste ponto (foi criada com
    // sucesso acima); só a gravação local falhou. Marca unknown em vez de
    // perder o checkoutUrl: um operador recupera via
    // portal_reconcile_business_checkout_reservation_service, repetindo o
    // mesmo p_stripe_idempotency_key (a própria Stripe deduplica).
    trackError("checkout_commit_failed", commitError, { tenant_id: tenantId, reservation_id: reservationId });
    await markCheckoutUnknown(service, tenantId, reservationId, "checkout_commit_write_failed");
    return { error: "Aprovado e o link foi criado na Stripe, mas não foi possível confirmar isso no banco. Um operador precisa reconciliar esta reserva manualmente." };
  }

  try {
    const emailResult = await sendCheckoutLinkEmail({
      to: snapshot.contactEmail,
      productDisplayName: snapshot.displayName,
      unitAmountCents: snapshot.unitAmountCents,
      quantity: snapshot.quantity,
      checkoutUrl: session.checkoutUrl,
    });
    if (!emailResult.sent) {
      trackError("checkout_link_email_not_sent", new Error(`checkout link email was not sent (${emailResult.reason})`), { tenant_id: tenantId, reservation_id: reservationId });
    }
  } catch (emailError) {
    // O commit já é durável e o link já existe; uma falha de e-mail é
    // best-effort, nunca desfaz o que já foi confirmado.
    trackError("checkout_link_email_not_sent", emailError, { tenant_id: tenantId, reservation_id: reservationId });
  }

  logEvent("checkout_reservation_committed", { tenant_id: tenantId, reservation_id: reservationId });
  return { error: null };
}

async function requireTenantAdminActor(): Promise<
  | { readonly ok: true; readonly tenantId: string; readonly actorId: string }
  | { readonly ok: false; readonly error: string }
> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user === null) return { ok: false, error: "Sessão expirada. Faça login de novo." };

  const overview = await fetchTenantOverview();
  if (!overview.provisioned || overview.tenant === undefined) return { ok: false, error: "Conta ainda não provisionada." };
  if (overview.role !== "tenant_admin") return { ok: false, error: "Somente administradores podem aprovar ou rejeitar cobranças." };

  const actorId = typeof user.app_metadata?.actor_id === "string" ? user.app_metadata.actor_id : null;
  if (actorId === null || !UUID_V7_PATTERN.test(actorId)) {
    trackError("checkout_approval_missing_actor", new Error("authenticated session is missing a tenant actor id"), { tenant_id: overview.tenant.id });
    return { ok: false, error: "Sessão inválida. Recarregue a página e tente de novo." };
  }
  return { ok: true, tenantId: overview.tenant.id, actorId };
}

export async function approveBusinessCheckoutReservation(reservationId: string, contactEmail?: string): Promise<CheckoutApprovalActionState> {
  if (!UUID_V7_PATTERN.test(reservationId)) return { error: "Reserva inválida." };
  const actor = await requireTenantAdminActor();
  if (!actor.ok) return { error: actor.error };

  try {
    const service = createServiceRoleClient();
    const { data, error } = await service.rpc("portal_approve_business_checkout_service", {
      p_tenant_id: actor.tenantId,
      p_reservation_id: reservationId,
      p_actor_id: actor.actorId,
      p_contact_email: contactEmail?.trim() || null,
    });
    if (error) {
      trackError("checkout_approve_failed", error, { tenant_id: actor.tenantId, reservation_id: reservationId });
      return { error: "Não foi possível aprovar agora. Tente novamente." };
    }
    const outcome = (data as { outcome?: unknown } | null)?.outcome;
    if (outcome === "contact_email_required") return { error: "Informe o e-mail do prospect para aprovar: nenhuma chamada anterior capturou um." };
    if (outcome === "already_rejected") return { error: "Esta cobrança já foi rejeitada." };
    if (outcome === "approval_expired") return { error: "O prazo de aprovação desta cobrança expirou." };
    if (outcome !== "approved" && outcome !== "already_approved") {
      trackError("checkout_approve_unexpected_outcome", new Error("unexpected checkout approval outcome"), { tenant_id: actor.tenantId, reservation_id: reservationId, outcome: String(outcome) });
      return { error: "Não foi possível confirmar a aprovação. Tente novamente." };
    }
  } catch (serviceError) {
    trackError("checkout_approve_failed", serviceError, { tenant_id: actor.tenantId, reservation_id: reservationId });
    return { error: "Não foi possível aprovar agora. Tente novamente." };
  }

  return dispatchAndCommitCheckout(actor.tenantId, reservationId);
}

export async function rejectBusinessCheckoutReservation(reservationId: string, rejectionReason?: string): Promise<CheckoutApprovalActionState> {
  if (!UUID_V7_PATTERN.test(reservationId)) return { error: "Reserva inválida." };
  const trimmedReason = rejectionReason?.trim() || null;
  if (trimmedReason !== null && trimmedReason.length > 500) return { error: "Motivo da rejeição muito longo." };
  const actor = await requireTenantAdminActor();
  if (!actor.ok) return { error: actor.error };

  try {
    const service = createServiceRoleClient();
    const { data, error } = await service.rpc("portal_reject_business_checkout_service", {
      p_tenant_id: actor.tenantId,
      p_reservation_id: reservationId,
      p_actor_id: actor.actorId,
      p_rejection_reason: trimmedReason,
    });
    if (error) {
      trackError("checkout_reject_failed", error, { tenant_id: actor.tenantId, reservation_id: reservationId });
      return { error: "Não foi possível rejeitar agora. Tente novamente." };
    }
    const outcome = (data as { outcome?: unknown } | null)?.outcome;
    if (outcome === "already_approved") return { error: "Esta cobrança já foi aprovada." };
    if (outcome === "approval_expired") return { error: "O prazo de aprovação desta cobrança já expirou." };
    if (outcome !== "rejected" && outcome !== "already_rejected") {
      trackError("checkout_reject_unexpected_outcome", new Error("unexpected checkout rejection outcome"), { tenant_id: actor.tenantId, reservation_id: reservationId, outcome: String(outcome) });
      return { error: "Não foi possível confirmar a rejeição. Tente novamente." };
    }
  } catch (serviceError) {
    trackError("checkout_reject_failed", serviceError, { tenant_id: actor.tenantId, reservation_id: reservationId });
    return { error: "Não foi possível rejeitar agora. Tente novamente." };
  }

  return { error: null };
}
