/**
 * Núcleo puro do webhook de cobrança da Stripe (D-V2-101). Autenticação por
 * assinatura HMAC-SHA256 no cabeçalho `Stripe-Signature`
 * (docs.stripe.com/webhooks/signatures): string assinada
 * `{timestamp}.{raw-body}`, formato `t=<unix>,v1=<hex>[,v1=<hex>...]`
 * (múltiplas `v1=` durante rotação de segredo — basta UMA bater),
 * tolerância de replay de 5min, comparação em tempo constante. Mesmo
 * desenho já usado no webhook do Recall.ai (meetings/webhook.ts).
 *
 * Parser: só os 3 eventos de assinatura carregam tudo que a gente precisa
 * (metadata.tenant_id, status, período de faturamento, price id do item
 * licensed) — o objeto Subscription inteiro, sem precisar de uma segunda
 * chamada à API. Eventos fora desse escopo (invoice.*, checkout.session.
 * completed, payment_intent.*) são ignorados nesta versão — não é erro, é
 * escopo declarado (Art. 14).
 *
 * `metadataPlanId` NUNCA deve ser a fonte de verdade do plano: é setado
 * UMA vez no Checkout e a Stripe não reescreve metadata quando o cliente
 * troca de plano pelo Customer Portal (achado da revisão adversarial
 * 2026-08-03 — confiar nele sozinho cobra/libera o plano ERRADO depois de
 * upgrade/downgrade). O caller (route.ts, que conhece os price ids dos
 * planos via env) resolve o plano de verdade a partir de `licensedPriceId`
 * e só cai pra `metadataPlanId` como fallback de última instância.
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

const SUBSCRIPTION_STATUSES = new Set([
  "incomplete", "incomplete_expired", "trialing", "active", "past_due", "canceled", "unpaid", "paused",
]);
const PLAN_IDS = new Set(["piloto", "crescimento", "escala"]);

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
  readonly eventCreatedIso: string | null;
  readonly tenantId: string;
  /** NÃO confiar sozinho — ver docstring do módulo. Fallback só quando licensedPriceId não resolve pra nenhum plano conhecido. */
  readonly metadataPlanId: string;
  /** Price id do item "licensed" da assinatura — fonte de verdade do plano (o caller resolve id→plano via env). */
  readonly licensedPriceId: string | null;
  readonly stripeCustomerId: string;
  readonly stripeSubscriptionId: string;
  readonly status: string;
  readonly periodStartIso: string | null;
  readonly periodEndIso: string | null;
}

function unixToIso(value: unknown): string | null {
  return typeof value === "number" && Number.isFinite(value) ? new Date(value * 1000).toISOString() : null;
}

/** Devolve null pra evento fora do escopo mapeado ou payload malformado — nunca lança. */
export function parseStripeSubscriptionEvent(body: unknown): ParsedStripeSubscriptionEvent | null {
  if (body === null || typeof body !== "object") return null;
  const event = body as Record<string, unknown>;
  const eventId = event.id;
  const eventType = event.type;
  if (typeof eventId !== "string" || eventId.length === 0) return null;
  if (typeof eventType !== "string" || !HANDLED_EVENT_TYPES.has(eventType)) return null;
  const eventCreatedIso = unixToIso(event.created);

  const data = event.data as Record<string, unknown> | undefined;
  const subscription = data?.object as Record<string, unknown> | undefined;
  if (subscription === undefined || subscription === null) return null;

  const subscriptionId = subscription.id;
  const customerId = subscription.customer;
  const status = subscription.status;
  const metadata = subscription.metadata as Record<string, unknown> | undefined;
  const tenantId = metadata?.tenant_id;
  const metadataPlanId = metadata?.plan_id;

  if (typeof subscriptionId !== "string" || subscriptionId.length === 0) return null;
  if (typeof customerId !== "string" || customerId.length === 0) return null;
  if (typeof status !== "string" || !SUBSCRIPTION_STATUSES.has(status)) return null;
  if (typeof tenantId !== "string" || tenantId.length === 0) return null;
  if (typeof metadataPlanId !== "string" || !PLAN_IDS.has(metadataPlanId)) return null;

  const items = (subscription.items as { data?: unknown } | undefined)?.data;
  let periodStartIso: string | null = null;
  let periodEndIso: string | null = null;
  let licensedPriceId: string | null = null;
  if (Array.isArray(items)) {
    const licensedItem = items.find((item): item is Record<string, unknown> => {
      if (item === null || typeof item !== "object") return false;
      const price = (item as Record<string, unknown>).price as Record<string, unknown> | undefined;
      const recurring = price?.recurring as Record<string, unknown> | undefined;
      return recurring?.usage_type === "licensed";
    });
    // Sem fallback pro primeiro item: se nenhum vier marcado "licensed", é
    // configuração de plano quebrada — período/price ficam null (Art. 14),
    // nunca herdados do item metered por engano.
    if (licensedItem) {
      periodStartIso = unixToIso(licensedItem.current_period_start);
      periodEndIso = unixToIso(licensedItem.current_period_end);
      const price = licensedItem.price as Record<string, unknown> | undefined;
      licensedPriceId = typeof price?.id === "string" ? price.id : null;
    }
  }

  return {
    eventId,
    eventType,
    eventCreatedIso,
    tenantId,
    metadataPlanId,
    licensedPriceId,
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscriptionId,
    status,
    periodStartIso,
    periodEndIso,
  };
}
