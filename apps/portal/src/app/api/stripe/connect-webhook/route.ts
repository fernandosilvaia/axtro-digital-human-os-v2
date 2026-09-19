import { createHash } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import {
  isHandledStripeConnectEventType,
  parseStripeConnectAccountEvent,
  parseStripeConnectCheckoutEvent,
  verifyStripeWebhookSignature,
} from "@/lib/billing/connect-webhook";
import { readBoundedTextBody } from "@/lib/http/read-bounded-body";
import { createServiceRoleClient, ServiceRoleUnavailableError } from "@/lib/supabase/service";
import { logError as trackError, logEvent } from "@/lib/telemetry";

/**
 * Recebe eventos de conta conectada da Stripe (ADR-040): endpoint separado
 * de `/api/stripe/webhook` de propósito, com segredo próprio
 * (`STRIPE_CONNECT_WEBHOOK_SECRET`), porque a Stripe exige configuração de
 * endpoint dedicada com "escutar eventos em contas conectadas" habilitado, e
 * porque misturar os dois domínios de dinheiro (Axtro cobrando tenant,
 * tenant cobrando prospect) atrás da mesma verificação de assinatura seria
 * confuso e arriscado. Mesmo padrão do handler já em produção: corpo cru
 * lido antes do parse (a assinatura é sobre os bytes exatos), tipo fora do
 * escopo tratado responde 200 sem ação (Art. 14), tipo tratado com payload
 * malformado responde erro em vez de silêncio.
 *
 * O tenant nunca é lido de um header. Para `checkout.session.*`, vem de
 * `metadata.tenant_id` gravado pelo próprio servidor ao criar a Checkout
 * Session; a validação final de que o evento pertence à conta certa
 * acontece dentro do RPC (`portal_apply_business_checkout_connect_event_service`
 * cruza `event.account` contra o `stripe_account_id` snapshotado na própria
 * reserva). Para `account.updated`, que não carrega tenant nenhum no
 * payload, o tenant é resolvido por `portal_resolve_stripe_connect_tenant_service`
 * a partir do `stripe_account_id`, que é `unique` na tabela de conexões.
 */
export const dynamic = "force-dynamic";
const STRIPE_CONNECT_WEBHOOK_MAX_BODY_BYTES = 1024 * 1024;

function payloadFingerprint(rawBody: string): string {
  return createHash("sha256").update(rawBody, "utf8").digest("hex");
}

function exactReceipt(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]) ? record : null;
}

export async function POST(request: NextRequest): Promise<Response> {
  const webhookSecret = (process.env.STRIPE_CONNECT_WEBHOOK_SECRET ?? "").trim();
  if (webhookSecret.length === 0) {
    trackError("stripe_connect_webhook_secret_missing", new Error("STRIPE_CONNECT_WEBHOOK_SECRET not configured"));
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  const boundedBody = await readBoundedTextBody(request, STRIPE_CONNECT_WEBHOOK_MAX_BODY_BYTES);
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
  const fingerprint = payloadFingerprint(rawBody);

  const checkout = parseStripeConnectCheckoutEvent(body);
  if (checkout !== null) {
    try {
      const supabase = createServiceRoleClient();
      const response = await supabase.rpc("portal_apply_business_checkout_connect_event_service", {
        p_event_id: checkout.eventId,
        p_event_type: checkout.eventType,
        p_tenant_id: checkout.tenantId,
        p_reservation_id: checkout.reservationId,
        p_connected_account_id: checkout.connectedAccountId,
        p_payload_fingerprint: fingerprint,
        p_stripe_payment_intent_id: checkout.paymentIntentId,
        p_stripe_charge_id: null,
        p_amount_total_cents: checkout.amountTotalCents,
      });
      const outcomes = new Set([
        "payment_completed",
        "payment_failed",
        "expired",
        "duplicate_event",
        "ignored_unknown_reservation",
        "ignored_state",
        "ignored_account_mismatch",
      ]);
      const outcome = response.data !== null && typeof response.data === "object" && !Array.isArray(response.data)
        ? (response.data as Record<string, unknown>).outcome
        : undefined;
      if (response.error || typeof outcome !== "string" || !outcomes.has(outcome)) {
        throw new Error(response.error?.message ?? "checkout connect event receipt was malformed");
      }
      if (outcome === "ignored_account_mismatch") {
        trackError(
          "stripe_connect_webhook_account_mismatch",
          new Error("signed connected-account event does not match the reservation's own stripe_account_id"),
          { event_id: checkout.eventId, tenant_id: checkout.tenantId, reservation_id: checkout.reservationId },
        );
        return NextResponse.json({ error: "account_mismatch" }, { status: 409 });
      }
      logEvent("stripe_connect_checkout_event_applied", {
        event_id: checkout.eventId,
        event_type: checkout.eventType,
        tenant_id: checkout.tenantId,
        reservation_id: checkout.reservationId,
        outcome,
      });
      return NextResponse.json({ ok: true, handled: true, outcome });
    } catch (error) {
      if (error instanceof ServiceRoleUnavailableError) {
        trackError("stripe_connect_webhook_service_role_unavailable", error, { event_id: checkout.eventId });
        return NextResponse.json({ error: "not_configured" }, { status: 503 });
      }
      trackError("stripe_connect_checkout_event_persistence_failed", error, { event_id: checkout.eventId, event_type: checkout.eventType });
      return NextResponse.json({ error: "internal_error" }, { status: 500 });
    }
  }

  const account = parseStripeConnectAccountEvent(body);
  if (account !== null) {
    try {
      const supabase = createServiceRoleClient();
      const resolved = await supabase.rpc("portal_resolve_stripe_connect_tenant_service", {
        p_stripe_account_id: account.connectedAccountId,
      });
      const resolvedReceipt = exactReceipt(resolved.data, ["outcome", "tenantId"])
        ?? exactReceipt(resolved.data, ["outcome"]);
      if (resolved.error || resolvedReceipt === null) {
        throw new Error(resolved.error?.message ?? "stripe connect tenant resolution was malformed");
      }
      if (resolvedReceipt.outcome === "not_found") {
        // Conta conectada que este produto nao reconhece (nunca foi
        // conectada aqui, ou a Stripe reenviou um evento antigo depois de
        // um disconnect+reconnect por outro caminho). Silencio esperado: a
        // Stripe manda account.updated para toda conta que ja teve algum
        // vinculo, mesmo apos handler removido do lado da aplicacao.
        return NextResponse.json({ ok: true, handled: false });
      }
      const tenantId = resolvedReceipt.tenantId;
      if (typeof tenantId !== "string") {
        throw new Error("stripe connect tenant resolution returned found without a tenantId");
      }

      const response = await supabase.rpc("portal_sync_stripe_connect_capabilities_service", {
        p_event_id: account.eventId,
        p_tenant_id: tenantId,
        p_stripe_account_id: account.connectedAccountId,
        p_payload_fingerprint: fingerprint,
        p_charges_enabled: account.chargesEnabled,
        p_payouts_enabled: account.payoutsEnabled,
        p_details_submitted: account.detailsSubmitted,
      });
      const outcomes = new Set(["synced", "duplicate_event", "ignored_unknown_account"]);
      const outcome = response.data !== null && typeof response.data === "object" && !Array.isArray(response.data)
        ? (response.data as Record<string, unknown>).outcome
        : undefined;
      if (response.error || typeof outcome !== "string" || !outcomes.has(outcome)) {
        throw new Error(response.error?.message ?? "stripe connect capability sync receipt was malformed");
      }
      logEvent("stripe_connect_account_capabilities_synced", {
        event_id: account.eventId,
        tenant_id: tenantId,
        connected_account_id: account.connectedAccountId,
        outcome,
        charges_enabled: account.chargesEnabled,
      });
      return NextResponse.json({ ok: true, handled: true, outcome });
    } catch (error) {
      if (error instanceof ServiceRoleUnavailableError) {
        trackError("stripe_connect_webhook_service_role_unavailable", error, { event_id: account.eventId });
        return NextResponse.json({ error: "not_configured" }, { status: 503 });
      }
      trackError("stripe_connect_account_event_persistence_failed", error, { event_id: account.eventId });
      return NextResponse.json({ error: "internal_error" }, { status: 500 });
    }
  }

  // "Fora de escopo" e silencio esperado (Art. 14). Mas se o TIPO e um dos
  // 4 tratados e mesmo assim o parse falhou, o payload assinado nao tem a
  // forma que o contrato fechado exige: sinal de drift que nao pode
  // desaparecer sem rastro, mesmo raciocinio do webhook de assinatura.
  const record = body !== null && typeof body === "object" && !Array.isArray(body)
    ? body as Record<string, unknown>
    : null;
  const eventType = record?.type;
  if (isHandledStripeConnectEventType(eventType)) {
    trackError(
      "stripe_connect_webhook_malformed_event",
      new Error("connect event type in scope but payload failed strict validation"),
      { event_id: typeof record?.id === "string" ? record.id : "?", event_type: String(eventType) },
    );
    return NextResponse.json({ error: "malformed_in_scope_event" }, { status: 503 });
  }
  return NextResponse.json({ ok: true, handled: false });
}
