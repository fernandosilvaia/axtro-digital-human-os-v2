import { NextRequest, NextResponse } from "next/server";

import { PLAN_CATALOG, PLAN_ORDER } from "@/lib/billing/plans";
import {
  isHandledStripeCheckoutEventType,
  isHandledStripeSubscriptionEventType,
  parseStripeCheckoutEvent,
  parseStripeSubscriptionEvent,
  verifyStripeWebhookSignature,
} from "@/lib/billing/webhook";
import { readBoundedTextBody } from "@/lib/http/read-bounded-body";
import { createServiceRoleClient, ServiceRoleUnavailableError } from "@/lib/supabase/service";
import { logError as trackError, logEvent } from "@/lib/telemetry";

/**
 * Recebe eventos de assinatura da Stripe (D-V2-101) — servidor-a-servidor,
 * sem sessão de usuário, mesmo padrão de /api/recall/webhook: assinatura
 * HMAC obrigatória (STRIPE_WEBHOOK_SECRET), corpo cru lido ANTES do parse
 * JSON (a assinatura é sobre os bytes exatos que a Stripe mandou).
 *
 * Trata o ciclo de vida de assinatura e os eventos assinados de Checkout
 * que fecham ou expiram uma intenção durável. Outros tipos respondem 200
 * sem ação (Art. 14: escopo declarado).
 *
 * O PLANO é resolvido pelo par exato licensed+metered (`resolvePlanId`),
 * NUNCA pela metadata sozinha — a Stripe não reescreve metadata quando o
 * cliente troca de plano pelo Customer Portal, então confiar só nela cobra
 * o plano errado depois de upgrade/downgrade. Price desconhecido agora falha
 * fechado; não há fallback de metadata no writer financeiro estrito.
 */
export const dynamic = "force-dynamic";
const STRIPE_WEBHOOK_MAX_BODY_BYTES = 1024 * 1024;

function resolvePlanId(licensedPriceId: string | null, meteredPriceId: string | null): string | null {
  if (licensedPriceId === null || meteredPriceId === null) return null;
  for (const planId of PLAN_ORDER) {
    if (
      (process.env[PLAN_CATALOG[planId].basePriceEnvVar] ?? "").trim() === licensedPriceId
      && (process.env[PLAN_CATALOG[planId].overagePriceEnvVar] ?? "").trim() === meteredPriceId
    ) {
      return planId;
    }
  }
  return null;
}

function exactReceipt(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]) ? record : null;
}

function expectedCheckoutReceiptState(
  eventType: string,
  paymentStatus: string | null,
): "completed" | "expired" | "unknown" | null {
  if (eventType === "checkout.session.completed") {
    if (paymentStatus === "unpaid") return "unknown";
    return paymentStatus === "paid" || paymentStatus === "no_payment_required" ? "completed" : null;
  }
  if (eventType === "checkout.session.async_payment_succeeded") {
    return paymentStatus === "paid" || paymentStatus === "no_payment_required" ? "completed" : null;
  }
  return eventType === "checkout.session.expired" || eventType === "checkout.session.async_payment_failed"
    ? "expired"
    : null;
}

export async function POST(request: NextRequest): Promise<Response> {
  const webhookSecret = (process.env.STRIPE_WEBHOOK_SECRET ?? "").trim();
  if (webhookSecret.length === 0) {
    // Achado onda 8 (D-V2-117): sem isto, TODO webhook de assinatura da
    // Stripe falhava em silêncio — só apareceria no dashboard da Stripe
    // (ninguém monitora ativamente), nunca no alerta de taxa de erro do
    // próprio produto (D-V2-114).
    trackError("stripe_webhook_secret_missing", new Error("STRIPE_WEBHOOK_SECRET not configured"));
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  const boundedBody = await readBoundedTextBody(request, STRIPE_WEBHOOK_MAX_BODY_BYTES);
  if (!boundedBody.ok) {
    const status = boundedBody.reason === "too_large" ? 413 : 400;
    return NextResponse.json(
      { error: boundedBody.reason === "too_large" ? "payload_too_large" : "invalid_body" },
      { status },
    );
  }
  const rawBody = boundedBody.text;
  const signatureValid = verifyStripeWebhookSignature(
    webhookSecret,
    request.headers.get("stripe-signature"),
    rawBody,
    Math.floor(Date.now() / 1000),
  );
  if (!signatureValid) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid_json_body" }, { status: 400 });
  }

  const checkout = parseStripeCheckoutEvent(body);
  if (checkout !== null) {
    const expectedState = expectedCheckoutReceiptState(checkout.eventType, checkout.paymentStatus);
    if (expectedState === null) {
      trackError(
        "stripe_webhook_malformed_event",
        new Error("checkout event/payment status combination is outside the closed contract"),
        { event_id: checkout.eventId, event_type: checkout.eventType },
      );
      return NextResponse.json({ error: "malformed_in_scope_event" }, { status: 503 });
    }
    try {
      const supabase = createServiceRoleClient();
      const response = await supabase.rpc("portal_apply_billing_checkout_event_service", {
        p_event_id: checkout.eventId,
        p_event_type: checkout.eventType,
        p_event_created_at: checkout.eventCreatedIso,
        p_checkout_intent_id: checkout.checkoutIntentId,
        p_stripe_session_id: checkout.stripeSessionId,
        p_tenant_id: checkout.tenantId,
        p_plan_id: checkout.planId,
        p_stripe_customer_id: checkout.stripeCustomerId,
        p_stripe_subscription_id: checkout.stripeSubscriptionId,
        p_payment_status: checkout.paymentStatus,
      });
      const receipt = exactReceipt(response.data, ["applied", "replayed", "state"]);
      if (
        response.error
        || receipt === null
        || typeof receipt.applied !== "boolean"
        || typeof receipt.replayed !== "boolean"
        || (receipt.applied === true && receipt.replayed === true)
        || receipt.state !== expectedState
      ) {
        throw new Error(response.error?.message ?? "checkout event receipt was malformed");
      }
      logEvent("stripe_checkout_event_applied", {
        event_id: checkout.eventId,
        event_type: checkout.eventType,
        checkout_intent_id: checkout.checkoutIntentId,
        state: receipt.state,
        replayed: receipt.replayed,
      });
      return NextResponse.json({ ok: true, handled: true, replayed: receipt.replayed });
    } catch (error) {
      if (error instanceof ServiceRoleUnavailableError) {
        trackError("stripe_webhook_service_role_unavailable", error, { event_id: checkout.eventId });
        return NextResponse.json({ error: "not_configured" }, { status: 503 });
      }
      trackError("stripe_checkout_event_persistence_failed", error, { event_id: checkout.eventId, event_type: checkout.eventType });
      return NextResponse.json({ error: "internal_error" }, { status: 500 });
    }
  }

  const parsed = parseStripeSubscriptionEvent(body);
  if (parsed === null) {
    // "Fora de escopo" (invoice.*, checkout.session.*...) é silêncio
    // esperado (Art. 14). Mas se o TIPO é um dos 3 tratados e mesmo assim
    // o parse falhou, o payload não tem tenant_id/plan_id válidos — sinal
    // de assinatura órfã (ex.: criada manualmente no dashboard Stripe pra
    // suporte) que ficava invisível pra investigar, inconsistente com o
    // resto deste arquivo (achado da auditoria 2026-08-06).
    const record = body !== null && typeof body === "object" && !Array.isArray(body)
      ? body as Record<string, unknown>
      : null;
    const eventType = record?.type;
    if (isHandledStripeSubscriptionEventType(eventType) || isHandledStripeCheckoutEventType(eventType)) {
      trackError(
        "stripe_webhook_malformed_event",
        new Error("event type in scope but payload failed strict validation"),
        { event_id: typeof record?.id === "string" ? record.id : "?", event_type: String(eventType) },
      );
      // A signed event from our closed financial surface must not disappear.
      // Stripe retries non-2xx; operators can correct catalog/metadata drift
      // while the same globally unique event id remains pending evidence.
      return NextResponse.json({ error: "malformed_in_scope_event" }, { status: 503 });
    }
    return NextResponse.json({ ok: true, handled: false });
  }

  const planId = resolvePlanId(parsed.licensedPriceId, parsed.meteredPriceId);
  if (planId === null) {
    trackError(
      "stripe_webhook_unknown_licensed_price",
      new Error("licensed price does not match the configured catalog"),
      { event_id: parsed.eventId, event_type: parsed.eventType, tenant_id: parsed.tenantId },
    );
    return NextResponse.json({ error: "catalog_mismatch" }, { status: 500 });
  }

  try {
    const supabase = createServiceRoleClient();
    const response = await supabase.rpc("portal_apply_tenant_subscription_event_service", {
      p_event_id: parsed.eventId,
      p_event_type: parsed.eventType,
      p_event_created_at: parsed.eventCreatedIso,
      p_tenant_id: parsed.tenantId,
      p_checkout_intent_id: parsed.checkoutIntentId,
      p_plan_id: planId,
      p_status: parsed.status,
      p_stripe_customer_id: parsed.stripeCustomerId,
      p_stripe_subscription_id: parsed.stripeSubscriptionId,
      p_current_period_start: parsed.periodStartIso,
      p_current_period_end: parsed.periodEndIso,
    });
    const receipt = exactReceipt(response.data, ["applied", "outcome", "replayed"]);
    const outcomes = new Set(["applied", "replayed", "ignored_stale", "ignored_superseded_subscription", "duplicate_subscription_conflict"]);
    const validReceipt = receipt !== null
      && outcomes.has(String(receipt.outcome))
      && typeof receipt.applied === "boolean"
      && typeof receipt.replayed === "boolean"
      && receipt.applied === (receipt.outcome === "applied")
      && receipt.replayed === (receipt.outcome === "replayed");
    if (response.error || !validReceipt) {
      trackError("stripe_subscription_event_persistence_failed", response.error ?? new Error("subscription receipt was malformed"), { event_id: parsed.eventId, event_type: parsed.eventType, tenant_id: parsed.tenantId });
      return NextResponse.json({ error: "internal_error" }, { status: 500 });
    }
    if (receipt!.outcome === "duplicate_subscription_conflict") {
      trackError("stripe_subscription_duplicate_conflict", new Error("tenant has a conflicting live subscription"), { event_id: parsed.eventId, tenant_id: parsed.tenantId });
      return NextResponse.json({ error: "subscription_conflict" }, { status: 409 });
    }
    logEvent("stripe_subscription_synced", { event_id: parsed.eventId, event_type: parsed.eventType, plan_id: planId, outcome: receipt!.outcome, status: parsed.status });
    return NextResponse.json({ ok: true, handled: true, replayed: receipt!.replayed });
  } catch (error) {
    if (error instanceof ServiceRoleUnavailableError) {
      trackError("stripe_webhook_service_role_unavailable", error, { event_id: parsed.eventId });
      return NextResponse.json({ error: "not_configured" }, { status: 503 });
    }
    trackError("stripe_webhook_unexpected_error", error, { event_id: parsed.eventId });
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
