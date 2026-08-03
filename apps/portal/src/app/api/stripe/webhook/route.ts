import { NextRequest, NextResponse } from "next/server";

import { createUuidV7 } from "@axtro/domain";

import { PLAN_CATALOG, PLAN_ORDER } from "@/lib/billing/plans";
import { parseStripeSubscriptionEvent, verifyStripeWebhookSignature } from "@/lib/billing/webhook";
import { createServiceRoleClient, ServiceRoleUnavailableError } from "@/lib/supabase/service";
import { logError as trackError, logEvent } from "@/lib/telemetry";

/**
 * Recebe eventos de assinatura da Stripe (D-V2-101) — servidor-a-servidor,
 * sem sessão de usuário, mesmo padrão de /api/recall/webhook: assinatura
 * HMAC obrigatória (STRIPE_WEBHOOK_SECRET), corpo cru lido ANTES do parse
 * JSON (a assinatura é sobre os bytes exatos que a Stripe mandou).
 *
 * Só os 3 eventos de ciclo de vida de assinatura são tratados (ver
 * lib/billing/webhook.ts) — outros tipos (invoice.*, checkout.session.*,
 * payment_intent.*) respondem 200 sem ação (Art. 14: escopo declarado).
 *
 * O PLANO é resolvido pelo price id do item licensed (`resolvePlanId`),
 * NUNCA pela metadata sozinha — a Stripe não reescreve metadata quando o
 * cliente troca de plano pelo Customer Portal, então confiar só nela cobra
 * o plano errado depois de upgrade/downgrade (achado da revisão adversarial
 * 2026-08-03). Metadata só entra como fallback de última instância, com
 * telemetria — nunca em silêncio.
 */
export const dynamic = "force-dynamic";

function resolvePlanId(licensedPriceId: string | null, metadataPlanId: string): { planId: string; source: "price" | "metadata_fallback" } {
  if (licensedPriceId !== null) {
    for (const planId of PLAN_ORDER) {
      if ((process.env[PLAN_CATALOG[planId].basePriceEnvVar] ?? "").trim() === licensedPriceId) {
        return { planId, source: "price" };
      }
    }
  }
  return { planId: metadataPlanId, source: "metadata_fallback" };
}

export async function POST(request: NextRequest): Promise<Response> {
  const webhookSecret = (process.env.STRIPE_WEBHOOK_SECRET ?? "").trim();
  if (webhookSecret.length === 0) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  const rawBody = await request.text();
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

  const parsed = parseStripeSubscriptionEvent(body);
  if (parsed === null) {
    return NextResponse.json({ ok: true, handled: false });
  }

  const { planId, source: planSource } = resolvePlanId(parsed.licensedPriceId, parsed.metadataPlanId);
  if (planSource === "metadata_fallback") {
    // Price id do item licensed não bateu com nenhum STRIPE_PRICE_*_BASE
    // conhecido — pode ser env desatualizada ou preço fora do catálogo.
    // Segue com o valor de metadata (pode estar certo na criação, mas é
    // exatamente o caso que fica errado depois de uma troca de plano) e
    // fica visível pra investigar, nunca falha em silêncio.
    trackError(
      "stripe_webhook_plan_resolved_from_metadata_fallback",
      new Error(`licensedPriceId=${parsed.licensedPriceId ?? "null"} não bateu com nenhum plano conhecido`),
      { event_id: parsed.eventId, event_type: parsed.eventType, tenant_id: parsed.tenantId },
    );
  }

  try {
    const supabase = createServiceRoleClient();
    const { error } = await supabase.rpc("portal_upsert_tenant_subscription_service", {
      p_id: createUuidV7(),
      p_tenant_id: parsed.tenantId,
      p_plan_id: planId,
      p_status: parsed.status,
      p_stripe_customer_id: parsed.stripeCustomerId,
      p_stripe_subscription_id: parsed.stripeSubscriptionId,
      p_current_period_start: parsed.periodStartIso,
      p_current_period_end: parsed.periodEndIso,
      p_event_created_at: parsed.eventCreatedIso,
    });
    if (error) {
      trackError("stripe_webhook_upsert_failed", error, { event_id: parsed.eventId, event_type: parsed.eventType, tenant_id: parsed.tenantId });
      return NextResponse.json({ error: "internal_error" }, { status: 500 });
    }
    logEvent("stripe_subscription_synced", { event_id: parsed.eventId, event_type: parsed.eventType, plan_id: planId, plan_source: planSource, status: parsed.status });
    return NextResponse.json({ ok: true, handled: true });
  } catch (error) {
    if (error instanceof ServiceRoleUnavailableError) {
      trackError("stripe_webhook_service_role_unavailable", error, { event_id: parsed.eventId });
      return NextResponse.json({ error: "not_configured" }, { status: 503 });
    }
    trackError("stripe_webhook_unexpected_error", error, { event_id: parsed.eventId });
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
