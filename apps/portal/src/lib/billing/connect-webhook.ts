/**
 * Núcleo puro do webhook de conta conectada da Stripe (ADR-040): endpoint
 * separado, segredo separado (`STRIPE_CONNECT_WEBHOOK_SECRET`, distinto de
 * `STRIPE_WEBHOOK_SECRET`, a Stripe exige configuração de endpoint própria
 * com "escutar eventos em contas conectadas" habilitado). A verificação de
 * assinatura HMAC é a mesma de `./webhook.ts`
 * (`verifyStripeWebhookSignature`), reexportada aqui só por conveniência do
 * caller: o formato do cabeçalho `Stripe-Signature` não muda entre os dois
 * endpoints.
 *
 * Dois tipos de evento, dois domínios de dinheiro completamente diferentes
 * atrás da mesma verificação de assinatura, por isso dois parsers
 * separados, nunca um payload genérico:
 *
 * - `checkout.session.completed`/`expired`/`async_payment_failed`: o
 *   desfecho de uma Checkout Session de `request_checkout` (ADR-040). O
 *   tenant nunca é lido de um header, é resolvido por `metadata.tenant_id`
 *   que o próprio servidor gravou ao criar a sessão
 *   (`packages/provider-stripe` `createConnectedAccountCheckoutSession`),
 *   cruzado contra `event.account` (a conta conectada dona do evento, campo
 *   que só existe em webhooks de Connect).
 * - `account.updated`: sincroniza `charges_enabled`/`payouts_enabled`/
 *   `details_submitted` da conta conectada. `data.object` já É o próprio
 *   Account, `data.object.id` é a fonte primária do id da conta (mesmo
 *   valor de `event.account` quando presente; um evento de Connect sem os
 *   dois concordando é tratado como malformado, nunca um dos dois ignorado
 *   silenciosamente).
 */
import { verifyStripeWebhookSignature } from "./webhook.ts";

export { verifyStripeWebhookSignature };

const EVENT_ID_PATTERN = /^evt_[A-Za-z0-9_]{1,251}$/;
const SESSION_ID_PATTERN = /^cs_(?:test|live)_[A-Za-z0-9_]{1,240}$/;
const ACCOUNT_ID_PATTERN = /^acct_[A-Za-z0-9]{1,255}$/;
const PAYMENT_INTENT_ID_PATTERN = /^pi_[A-Za-z0-9]{1,255}$/;
const CHARGE_ID_PATTERN = /^ch_[A-Za-z0-9]{1,255}$/;
const RESERVATION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID_V7_PATTERN = RESERVATION_ID_PATTERN;

const HANDLED_CHECKOUT_EVENT_TYPES = new Set([
  "checkout.session.completed",
  "checkout.session.expired",
  "checkout.session.async_payment_failed",
]);

export function isHandledStripeConnectCheckoutEventType(eventType: unknown): boolean {
  return typeof eventType === "string" && HANDLED_CHECKOUT_EVENT_TYPES.has(eventType);
}

export function isHandledStripeConnectEventType(eventType: unknown): boolean {
  return isHandledStripeConnectCheckoutEventType(eventType) || eventType === "account.updated";
}

function unixToIso(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 253_402_300_799) return null;
  const date = new Date(value * 1000);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export interface ParsedStripeConnectCheckoutEvent {
  readonly eventId: string;
  readonly eventType: string;
  readonly eventCreatedIso: string;
  readonly tenantId: string;
  readonly reservationId: string;
  readonly connectedAccountId: string;
  readonly stripeSessionId: string;
  readonly paymentIntentId: string | null;
  readonly amountTotalCents: number | null;
}

/**
 * Strict signed connected-account Checkout lifecycle payload. `metadata` é
 * dado a comparar com o snapshot durável da reserva, nunca autoridade
 * (mesmo princípio de `parseStripeCheckoutEvent` em `./webhook.ts`).
 */
export function parseStripeConnectCheckoutEvent(body: unknown): ParsedStripeConnectCheckoutEvent | null {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return null;
  const event = body as Record<string, unknown>;
  if (!EVENT_ID_PATTERN.test(String(event.id ?? "")) || !isHandledStripeConnectCheckoutEventType(event.type)) return null;
  const eventCreatedIso = unixToIso(event.created);
  if (eventCreatedIso === null) return null;

  const connectedAccountId = event.account;
  if (typeof connectedAccountId !== "string" || !ACCOUNT_ID_PATTERN.test(connectedAccountId)) return null;

  const session = (event.data as Record<string, unknown> | undefined)?.object;
  if (session === null || typeof session !== "object" || Array.isArray(session)) return null;
  const record = session as Record<string, unknown>;
  const metadata = record.metadata;
  if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const metadataRecord = metadata as Record<string, unknown>;
  const tenantId = metadataRecord.tenant_id;
  const reservationId = metadataRecord.reservation_id;
  if (
    typeof tenantId !== "string" || !UUID_V7_PATTERN.test(tenantId)
    || typeof reservationId !== "string" || !RESERVATION_ID_PATTERN.test(reservationId)
    || typeof record.id !== "string" || !SESSION_ID_PATTERN.test(record.id)
  ) return null;

  const paymentIntentId = record.payment_intent;
  if (paymentIntentId !== null && paymentIntentId !== undefined && (typeof paymentIntentId !== "string" || !PAYMENT_INTENT_ID_PATTERN.test(paymentIntentId))) return null;
  const amountTotal = record.amount_total;
  if (amountTotal !== null && amountTotal !== undefined && (typeof amountTotal !== "number" || !Number.isInteger(amountTotal) || amountTotal < 0)) return null;

  return Object.freeze({
    eventId: event.id as string,
    eventType: event.type as string,
    eventCreatedIso,
    tenantId,
    reservationId,
    connectedAccountId,
    stripeSessionId: record.id,
    paymentIntentId: typeof paymentIntentId === "string" ? paymentIntentId : null,
    amountTotalCents: typeof amountTotal === "number" ? amountTotal : null,
  });
}

export interface ParsedStripeConnectAccountEvent {
  readonly eventId: string;
  readonly eventType: "account.updated";
  readonly eventCreatedIso: string;
  readonly connectedAccountId: string;
  readonly chargesEnabled: boolean;
  readonly payoutsEnabled: boolean;
  readonly detailsSubmitted: boolean;
}

/** `account.updated` só: `data.object` já é o Account, `event.account` (quando presente) precisa concordar com `data.object.id`. */
export function parseStripeConnectAccountEvent(body: unknown): ParsedStripeConnectAccountEvent | null {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return null;
  const event = body as Record<string, unknown>;
  if (!EVENT_ID_PATTERN.test(String(event.id ?? "")) || event.type !== "account.updated") return null;
  const eventCreatedIso = unixToIso(event.created);
  if (eventCreatedIso === null) return null;

  const account = (event.data as Record<string, unknown> | undefined)?.object;
  if (account === null || typeof account !== "object" || Array.isArray(account)) return null;
  const record = account as Record<string, unknown>;
  const accountId = record.id;
  if (typeof accountId !== "string" || !ACCOUNT_ID_PATTERN.test(accountId)) return null;
  if (event.account !== null && event.account !== undefined && event.account !== accountId) return null;

  const chargesEnabled = record.charges_enabled;
  const payoutsEnabled = record.payouts_enabled;
  const detailsSubmitted = record.details_submitted;
  if (typeof chargesEnabled !== "boolean" || typeof payoutsEnabled !== "boolean" || typeof detailsSubmitted !== "boolean") return null;

  return Object.freeze({
    eventId: event.id as string,
    eventType: "account.updated" as const,
    eventCreatedIso,
    connectedAccountId: accountId,
    chargesEnabled,
    payoutsEnabled,
    detailsSubmitted,
  });
}

const CHARGE_ID_PATTERN_EXPORT = CHARGE_ID_PATTERN;
export { CHARGE_ID_PATTERN_EXPORT as CHARGE_ID_PATTERN };
