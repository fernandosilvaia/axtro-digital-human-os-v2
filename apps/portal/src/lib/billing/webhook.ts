/**
 * Núcleo puro do webhook de cobrança da Stripe (D-V2-101). Autenticação por
 * assinatura HMAC-SHA256 no cabeçalho `Stripe-Signature`
 * (docs.stripe.com/webhooks/signatures): string assinada
 * `{timestamp}.{raw-body}`, formato `t=<unix>,v1=<hex>[,v1=<hex>...]`
 * (múltiplas `v1=` durante rotação de segredo — basta UMA bater),
 * tolerância de replay de 5min, comparação em tempo constante. Mesmo
 * desenho já usado no webhook do Recall.ai (meetings/webhook.ts).
 *
 * Parsers separados cobrem assinatura e o lifecycle de Checkout. Em ambos,
 * metadata externa é apenas uma alegação comparada ao snapshot durável; não
 * concede tenant, plano nem autoridade de escrita.
 *
 * `metadataPlanId` NUNCA deve ser a fonte de verdade do plano: é setado
 * UMA vez no Checkout e a Stripe não reescreve metadata quando o cliente
 * troca de plano pelo Customer Portal (achado da revisão adversarial
 * 2026-08-03 — confiar nele sozinho cobra/libera o plano ERRADO depois de
 * upgrade/downgrade). O caller (route.ts, que conhece os price ids dos
 * planos via env) exige o par exato `licensedPriceId` + `meteredPriceId`;
 * metadata nunca é fallback.
 *
 * ATENÇÃO API version (2025-03-31.basil, docs.stripe.com/changelog/basil/
 * 2025-03-31/deprecate-subscription-current-period-start-and-end):
 * `current_period_start`/`current_period_end` NÃO existem mais no objeto
 * Subscription — migraram pra cada item (`items.data[].current_period_*`).
 * O item "licensed" (a mensalidade fixa) é a fonte do período E do price
 * id — sem fallback pro primeiro item da lista: se nenhum item vier
 * marcado "licensed", isso é uma configuração de plano quebrada e o evento
 * é tratado como malformado (Art. 14: nunca adivinha).
 */
import { createHmac, timingSafeEqual } from "node:crypto";

const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;
const HANDLED_EVENT_TYPES = new Set([
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
]);
const HANDLED_CHECKOUT_EVENT_TYPES = new Set([
  "checkout.session.completed",
  "checkout.session.expired",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
]);

const SUBSCRIPTION_STATUSES = new Set([
  "incomplete", "incomplete_expired", "trialing", "active", "past_due", "canceled", "unpaid", "paused",
]);
const PLAN_IDS = new Set(["piloto", "crescimento", "escala"]);
const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EVENT_ID_PATTERN = /^evt_[A-Za-z0-9_]{1,250}$/;
const SESSION_ID_PATTERN = /^cs_(?:test|live)_[A-Za-z0-9_]{1,240}$/;
const CUSTOMER_ID_PATTERN = /^cus_[A-Za-z0-9]{1,255}$/;
const SUBSCRIPTION_ID_PATTERN = /^sub_[A-Za-z0-9]{1,255}$/;
const PRICE_ID_PATTERN = /^price_[A-Za-z0-9]{1,255}$/;

/** Tipo de evento tratado por parseStripeSubscriptionEvent — exposto pra route.ts distinguir "fora de escopo" de "payload malformado" (a diferença importa pra telemetria). */
export function isHandledStripeSubscriptionEventType(eventType: unknown): boolean {
  return typeof eventType === "string" && HANDLED_EVENT_TYPES.has(eventType);
}

export function isHandledStripeCheckoutEventType(eventType: unknown): boolean {
  return typeof eventType === "string" && HANDLED_CHECKOUT_EVENT_TYPES.has(eventType);
}

export function verifyStripeWebhookSignature(
  secret: string,
  signatureHeader: string | null,
  rawBody: string,
  nowSeconds: number,
): boolean {
  if (typeof secret !== "string" || secret.length === 0) return false;
  if (typeof signatureHeader !== "string" || signatureHeader.length === 0) return false;

  let timestamp: string | null = null;
  const candidateSignatures: string[] = [];
  for (const part of signatureHeader.split(",")) {
    const separatorIndex = part.indexOf("=");
    if (separatorIndex === -1) continue;
    const key = part.slice(0, separatorIndex).trim();
    const value = part.slice(separatorIndex + 1).trim();
    if (key === "t") timestamp = value;
    else if (key === "v1" && value.length > 0) candidateSignatures.push(value);
  }
  if (timestamp === null || candidateSignatures.length === 0) return false;

  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds)) return false;
  if (Math.abs(nowSeconds - timestampSeconds) > SIGNATURE_TOLERANCE_SECONDS) return false;

  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest();
  for (const candidate of candidateSignatures) {
    let candidateBytes: Buffer;
    try {
      candidateBytes = Buffer.from(candidate, "hex");
    } catch {
      continue;
    }
    if (candidateBytes.length !== expected.length) continue;
    if (timingSafeEqual(candidateBytes, expected)) return true;
  }
  return false;
}

export interface ParsedStripeSubscriptionEvent {
  readonly eventId: string;
  readonly eventType: string;
  /** Momento em que a Stripe gerou o evento — usado como guarda monotônica contra entrega fora de ordem. */
  readonly eventCreatedIso: string;
  readonly tenantId: string;
  readonly checkoutIntentId: string | null;
  /** Alegação externa comparada pelo writer; nunca é fonte de verdade do catálogo. */
  readonly metadataPlanId: string;
  /** Price id do item "licensed" da assinatura — fonte de verdade do plano (o caller resolve id→plano via env). */
  readonly licensedPriceId: string | null;
  /** Par obrigatório do catálogo: uma assinatura válida tem exatamente um item metered. */
  readonly meteredPriceId: string | null;
  readonly stripeCustomerId: string;
  readonly stripeSubscriptionId: string;
  readonly status: string;
  readonly periodStartIso: string | null;
  readonly periodEndIso: string | null;
}

function unixToIso(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 253_402_300_799) return null;
  const date = new Date(value * 1000);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

/** Devolve null pra evento fora do escopo mapeado ou payload malformado — nunca lança. */
export function parseStripeSubscriptionEvent(body: unknown): ParsedStripeSubscriptionEvent | null {
  if (body === null || typeof body !== "object") return null;
  const event = body as Record<string, unknown>;
  const eventId = event.id;
  const eventType = event.type;
  if (typeof eventId !== "string" || !EVENT_ID_PATTERN.test(eventId)) return null;
  if (typeof eventType !== "string" || !HANDLED_EVENT_TYPES.has(eventType)) return null;
  const eventCreatedIso = unixToIso(event.created);
  if (eventCreatedIso === null) return null;

  const data = event.data as Record<string, unknown> | undefined;
  const subscription = data?.object as Record<string, unknown> | undefined;
  if (subscription === undefined || subscription === null) return null;

  const subscriptionId = subscription.id;
  const customerId = subscription.customer;
  const status = subscription.status;
  const metadata = subscription.metadata as Record<string, unknown> | undefined;
  const tenantId = metadata?.tenant_id;
  const metadataPlanId = metadata?.plan_id;
  const checkoutIntentIdRaw = metadata?.checkout_intent_id;

  if (typeof subscriptionId !== "string" || !SUBSCRIPTION_ID_PATTERN.test(subscriptionId)) return null;
  if (typeof customerId !== "string" || !CUSTOMER_ID_PATTERN.test(customerId)) return null;
  if (typeof status !== "string" || !SUBSCRIPTION_STATUSES.has(status)) return null;
  if (typeof tenantId !== "string" || !UUID_V7_PATTERN.test(tenantId)) return null;
  if (typeof metadataPlanId !== "string" || !PLAN_IDS.has(metadataPlanId)) return null;
  if (checkoutIntentIdRaw !== undefined && (typeof checkoutIntentIdRaw !== "string" || !UUID_V7_PATTERN.test(checkoutIntentIdRaw))) return null;

  const items = (subscription.items as { data?: unknown } | undefined)?.data;
  let periodStartIso: string | null = null;
  let periodEndIso: string | null = null;
  let licensedPriceId: string | null = null;
  let meteredPriceId: string | null = null;
  if (!Array.isArray(items) || items.length !== 2) return null;
  const recurringItems = items.map((item) => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) return null;
    const record = item as Record<string, unknown>;
    const price = record.price;
    if (price === null || typeof price !== "object" || Array.isArray(price)) return null;
    const priceRecord = price as Record<string, unknown>;
    const recurring = priceRecord.recurring;
    if (recurring === null || typeof recurring !== "object" || Array.isArray(recurring)) return null;
    const usageType = (recurring as Record<string, unknown>).usage_type;
    if ((usageType !== "licensed" && usageType !== "metered")
      || typeof priceRecord.id !== "string"
      || !PRICE_ID_PATTERN.test(priceRecord.id)) return null;
    return { record, priceId: priceRecord.id, usageType } as const;
  });
  if (recurringItems.some((item) => item === null)) return null;
  const licensedItems = recurringItems.filter((item) => item?.usageType === "licensed");
  const meteredItems = recurringItems.filter((item) => item?.usageType === "metered");
  if (licensedItems.length !== 1 || meteredItems.length !== 1) return null;
  const licensedItem = licensedItems[0]!;
  periodStartIso = unixToIso(licensedItem.record.current_period_start);
  periodEndIso = unixToIso(licensedItem.record.current_period_end);
  licensedPriceId = licensedItem.priceId;
  meteredPriceId = meteredItems[0]!.priceId;

  return {
    eventId,
    eventType,
    eventCreatedIso,
    tenantId,
    checkoutIntentId: typeof checkoutIntentIdRaw === "string" ? checkoutIntentIdRaw : null,
    metadataPlanId,
    licensedPriceId,
    meteredPriceId,
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscriptionId,
    status,
    periodStartIso,
    periodEndIso,
  };
}

export interface ParsedStripeCheckoutEvent {
  readonly eventId: string;
  readonly eventType: string;
  readonly eventCreatedIso: string;
  readonly checkoutIntentId: string;
  readonly stripeSessionId: string;
  readonly tenantId: string;
  readonly planId: string;
  readonly stripeCustomerId: string | null;
  readonly stripeSubscriptionId: string | null;
  readonly paymentStatus: "paid" | "unpaid" | "no_payment_required" | null;
}

/** Strict signed Checkout lifecycle payload; metadata is data to compare with the immutable SQL snapshot, never authority. */
export function parseStripeCheckoutEvent(body: unknown): ParsedStripeCheckoutEvent | null {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return null;
  const event = body as Record<string, unknown>;
  if (!EVENT_ID_PATTERN.test(String(event.id ?? "")) || !isHandledStripeCheckoutEventType(event.type)) return null;
  const eventCreatedIso = unixToIso(event.created);
  if (eventCreatedIso === null) return null;
  const session = (event.data as Record<string, unknown> | undefined)?.object;
  if (session === null || typeof session !== "object" || Array.isArray(session)) return null;
  const record = session as Record<string, unknown>;
  const metadata = record.metadata;
  if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const metadataRecord = metadata as Record<string, unknown>;
  const checkoutIntentId = metadataRecord.checkout_intent_id;
  const tenantId = metadataRecord.tenant_id;
  const planId = metadataRecord.plan_id;
  if (
    typeof checkoutIntentId !== "string"
    || !UUID_V7_PATTERN.test(checkoutIntentId)
    || record.client_reference_id !== checkoutIntentId
    || typeof tenantId !== "string"
    || !UUID_V7_PATTERN.test(tenantId)
    || typeof planId !== "string"
    || !PLAN_IDS.has(planId)
    || typeof record.id !== "string"
    || !SESSION_ID_PATTERN.test(record.id)
  ) return null;
  const customerId = record.customer;
  const subscriptionId = record.subscription;
  const paymentStatus = record.payment_status;
  if (customerId !== null && customerId !== undefined && (typeof customerId !== "string" || !CUSTOMER_ID_PATTERN.test(customerId))) return null;
  if (subscriptionId !== null && subscriptionId !== undefined && (typeof subscriptionId !== "string" || !SUBSCRIPTION_ID_PATTERN.test(subscriptionId))) return null;
  if (paymentStatus !== null && paymentStatus !== undefined && paymentStatus !== "paid" && paymentStatus !== "unpaid" && paymentStatus !== "no_payment_required") return null;
  return Object.freeze({
    eventId: event.id as string,
    eventType: event.type as string,
    eventCreatedIso,
    checkoutIntentId,
    stripeSessionId: record.id,
    tenantId,
    planId,
    stripeCustomerId: typeof customerId === "string" ? customerId : null,
    stripeSubscriptionId: typeof subscriptionId === "string" ? subscriptionId : null,
    paymentStatus: typeof paymentStatus === "string" ? paymentStatus as ParsedStripeCheckoutEvent["paymentStatus"] : null,
  });
}
