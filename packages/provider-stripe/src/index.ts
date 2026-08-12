/**
 * Quarto adapter de provider real do projeto: Stripe — cobrança dos planos
 * do Digital Human OS (D-V2-101). Mesma disciplina dos outros três
 * (OpenRouter, Tavus, Recall.ai): chave nunca aparece em erro/log, fetch
 * injetável, timeout obrigatório, validação fechada antes da rede.
 *
 * Diferença estrutural: a API da Stripe é form-urlencoded (não JSON), com
 * notação de colchetes para campos aninhados/arrays — `toFormBody` faz essa
 * serialização. `Stripe-Version` é fixada explicitamente (prática
 * recomendada pela própria Stripe): a integração usa a API de Billing
 * Meters (não a `usage_records` legada, removida a partir da versão
 * 2025-03-31.basil — docs.stripe.com/billing/subscriptions/usage-based/
 * implementation-guide) para cobrar overage.
 *
 * Modelo de cobrança (docs.stripe.com/billing/subscriptions/build-
 * subscriptions + implementation-guide, confirmado 2026-08-03): cada
 * assinatura tem DOIS itens — um price recorrente "licensed" (mensalidade
 * fixa) e um price "metered" vinculado a um Meter compartilhado
 * (`event_name` único pro produto inteiro; o preço por unidade difere por
 * plano, mas o meter é o mesmo — Stripe agrega os eventos por
 * stripe_customer_id e fatura contra o item metered QUE aquele cliente tem
 * assinado). A unidade cobrada é CONVERSA de vídeo, não minuto — o produto
 * não mede duração real de chamada hoje (gap já declarado em
 * docs/COST_OPTIMIZATION.md), então cobrar por minuto seria uma promessa
 * de precisão que o sistema não cumpre (Art. 16).
 */

export type StripeErrorCode =
  | "missing_api_key"
  | "invalid_request"
  | "provider_rejected"
  | "provider_timeout"
  | "provider_unavailable"
  | "malformed_provider_response";

export class StripeBillingError extends Error {
  readonly code: StripeErrorCode;
  constructor(code: StripeErrorCode, message: string) {
    super(message);
    this.name = "StripeBillingError";
    this.code = code;
  }
}

export interface CreateCheckoutSessionRequest {
  readonly tenantId: string;
  readonly planId: string;
  readonly basePriceId: string;
  readonly overagePriceId: string;
  readonly customerEmail?: string;
  /** Reaproveita o Customer existente (troca de plano) em vez de criar um novo. */
  readonly existingStripeCustomerId?: string;
  readonly successUrl: string;
  readonly cancelUrl: string;
  /** Chave de idempotência da Stripe — duplo clique/retry/duas abas não criam duas assinaturas. */
  readonly idempotencyKey: string;
}

export interface CheckoutSession {
  readonly sessionId: string;
  readonly checkoutUrl: string;
}

export interface CreatePortalSessionRequest {
  readonly stripeCustomerId: string;
  readonly returnUrl: string;
}

export interface PortalSession {
  readonly portalUrl: string;
}

export interface ReportOverageUsageRequest {
  readonly stripeCustomerId: string;
  readonly eventName: string;
  /** Unidades de overage deste evento (conversas acima do incluído) — inteiro positivo. */
  readonly quantity: number;
  /** Chave de idempotência da Stripe — evita duplicar cobrança em retry. */
  readonly idempotencyKey: string;
}

export interface StripeBillingPort {
  readonly providerId: string;
  createCheckoutSession(request: CreateCheckoutSessionRequest): Promise<CheckoutSession>;
  createPortalSession(request: CreatePortalSessionRequest): Promise<PortalSession>;
  reportOverageUsage(request: ReportOverageUsageRequest): Promise<void>;
}

export interface StripeAdapterOptions {
  readonly apiKey: string;
  readonly timeoutMs?: number;
  readonly fetchImplementation?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 20_000;
const STRIPE_API_VERSION = "2025-03-31.basil";
const MAX_URL_CHARS = 2000;
const MAX_ID_CHARS = 200;
const MAX_EMAIL_CHARS = 254;
const MAX_EVENT_NAME_CHARS = 100;
const PRICE_ID_PATTERN = /^price_[A-Za-z0-9]{1,255}$/;
const CUSTOMER_ID_PATTERN = /^cus_[A-Za-z0-9]{1,255}$/;

function isHttpsUrl(value: unknown, maxChars: number): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > maxChars) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/** Serializa um objeto pra form-urlencoded no dialeto da Stripe: `a[b][0][c]=v`. */
function toFormBody(input: Record<string, unknown>): string {
  const pairs: string[] = [];
  function walk(prefix: string, value: unknown): void {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(`${prefix}[${index}]`, item));
      return;
    }
    if (typeof value === "object") {
      for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
        walk(prefix.length === 0 ? key : `${prefix}[${key}]`, nested);
      }
      return;
    }
    pairs.push(`${encodeURIComponent(prefix)}=${encodeURIComponent(String(value))}`);
  }
  walk("", input);
  return pairs.join("&");
}

export function createStripeBillingPort(options: StripeAdapterOptions): StripeBillingPort {
  const apiKey = typeof options.apiKey === "string" ? options.apiKey.trim() : "";
  if (apiKey.length < 8) throw new StripeBillingError("missing_api_key", "Stripe API key is not configured");
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const base = "https://api.stripe.com/v1";

  async function call(
    method: "POST",
    path: string,
    body: Record<string, unknown>,
    idempotencyKey?: string,
  ): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetchImplementation(`${base}${path}`, {
        method,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
          "Stripe-Version": STRIPE_API_VERSION,
          ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
        },
        body: toFormBody(body),
      });
    } catch (error) {
      clearTimeout(timer);
      if (error instanceof Error && error.name === "AbortError") {
        throw new StripeBillingError("provider_timeout", `Stripe timed out after ${timeoutMs}ms`);
      }
      throw new StripeBillingError("provider_unavailable", "Stripe request failed before a response");
    }
    // O timer segue vivo até o corpo ser consumido — headers rápidos com
    // body pendurado não escapam do timeout (achado P1 da auditoria
    // 2026-08-11, mesmo padrão já corrigido em provider-openrouter e
    // provider-tavus na auditoria 2026-08-02; este header do arquivo já
    // afirmava essa paridade, mas o código não a implementava de verdade).
    try {
      if (!response.ok) {
        const code: StripeErrorCode = response.status >= 500 ? "provider_unavailable" : "provider_rejected";
        throw new StripeBillingError(code, `Stripe respondeu HTTP ${response.status}`);
      }
      let text: string;
      try {
        text = await response.text();
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          throw new StripeBillingError("provider_timeout", `Stripe timed out after ${timeoutMs}ms`);
        }
        throw new StripeBillingError("malformed_provider_response", "Stripe returned non-JSON output");
      }
      try {
        return text.length > 0 ? JSON.parse(text) : null;
      } catch {
        throw new StripeBillingError("malformed_provider_response", "Stripe returned non-JSON output");
      }
    } finally {
      clearTimeout(timer);
    }
  }

  return Object.freeze({
    providerId: "stripe",

    async createCheckoutSession(request: CreateCheckoutSessionRequest): Promise<CheckoutSession> {
      if (typeof request.tenantId !== "string" || request.tenantId.length === 0 || request.tenantId.length > MAX_ID_CHARS) {
        throw new StripeBillingError("invalid_request", "tenantId must be 1.." + MAX_ID_CHARS + " chars");
      }
      if (typeof request.planId !== "string" || request.planId.length === 0 || request.planId.length > 64) {
        throw new StripeBillingError("invalid_request", "planId must be 1..64 chars");
      }
      if (!PRICE_ID_PATTERN.test(request.basePriceId) || !PRICE_ID_PATTERN.test(request.overagePriceId)) {
        throw new StripeBillingError("invalid_request", "basePriceId/overagePriceId must be plain Stripe price ids");
      }
      if (request.customerEmail !== undefined && (request.customerEmail.length === 0 || request.customerEmail.length > MAX_EMAIL_CHARS)) {
        throw new StripeBillingError("invalid_request", "customerEmail must be 1.." + MAX_EMAIL_CHARS + " chars");
      }
      if (request.existingStripeCustomerId !== undefined && !CUSTOMER_ID_PATTERN.test(request.existingStripeCustomerId)) {
        throw new StripeBillingError("invalid_request", "existingStripeCustomerId must be a plain Stripe customer id");
      }
      if (!isHttpsUrl(request.successUrl, MAX_URL_CHARS) || !isHttpsUrl(request.cancelUrl, MAX_URL_CHARS)) {
        throw new StripeBillingError("invalid_request", "successUrl/cancelUrl must be https URLs");
      }
      if (typeof request.idempotencyKey !== "string" || request.idempotencyKey.length === 0 || request.idempotencyKey.length > MAX_ID_CHARS) {
        throw new StripeBillingError("invalid_request", "idempotencyKey is required");
      }

      const payload = await call(
        "POST",
        "/checkout/sessions",
        {
          mode: "subscription",
          client_reference_id: request.tenantId,
          ...(request.existingStripeCustomerId ? { customer: request.existingStripeCustomerId } : {}),
          ...(!request.existingStripeCustomerId && request.customerEmail ? { customer_email: request.customerEmail } : {}),
          success_url: request.successUrl,
          cancel_url: request.cancelUrl,
          allow_promotion_codes: true,
          line_items: [
            { price: request.basePriceId, quantity: 1 },
            { price: request.overagePriceId },
          ],
          subscription_data: {
            metadata: { tenant_id: request.tenantId, plan_id: request.planId },
          },
        },
        request.idempotencyKey,
      );
      const record = (payload ?? {}) as Record<string, unknown>;
      const sessionId = record.id;
      const checkoutUrl = record.url;
      if (typeof sessionId !== "string" || sessionId.length === 0 || typeof checkoutUrl !== "string" || checkoutUrl.length === 0) {
        throw new StripeBillingError("malformed_provider_response", "Stripe checkout session payload has no id/url");
      }
      return Object.freeze({ sessionId, checkoutUrl });
    },

    async createPortalSession(request: CreatePortalSessionRequest): Promise<PortalSession> {
      if (!CUSTOMER_ID_PATTERN.test(request.stripeCustomerId)) {
        throw new StripeBillingError("invalid_request", "stripeCustomerId must be a plain Stripe customer id");
      }
      if (!isHttpsUrl(request.returnUrl, MAX_URL_CHARS)) {
        throw new StripeBillingError("invalid_request", "returnUrl must be an https URL");
      }
      const payload = await call("POST", "/billing_portal/sessions", {
        customer: request.stripeCustomerId,
        return_url: request.returnUrl,
      });
      const record = (payload ?? {}) as Record<string, unknown>;
      const portalUrl = record.url;
      if (typeof portalUrl !== "string" || portalUrl.length === 0) {
        throw new StripeBillingError("malformed_provider_response", "Stripe portal session payload has no url");
      }
      return Object.freeze({ portalUrl });
    },

    async reportOverageUsage(request: ReportOverageUsageRequest): Promise<void> {
      if (!CUSTOMER_ID_PATTERN.test(request.stripeCustomerId)) {
        throw new StripeBillingError("invalid_request", "stripeCustomerId must be a plain Stripe customer id");
      }
      if (typeof request.eventName !== "string" || request.eventName.length === 0 || request.eventName.length > MAX_EVENT_NAME_CHARS) {
        throw new StripeBillingError("invalid_request", "eventName must be 1.." + MAX_EVENT_NAME_CHARS + " chars");
      }
      if (!Number.isInteger(request.quantity) || request.quantity <= 0 || request.quantity > 100_000) {
        throw new StripeBillingError("invalid_request", "quantity must be a positive integer");
      }
      if (typeof request.idempotencyKey !== "string" || request.idempotencyKey.length === 0 || request.idempotencyKey.length > MAX_ID_CHARS) {
        throw new StripeBillingError("invalid_request", "idempotencyKey is required");
      }
      await call(
        "POST",
        "/billing/meter_events",
        {
          event_name: request.eventName,
          payload: { stripe_customer_id: request.stripeCustomerId, value: request.quantity },
        },
        request.idempotencyKey,
      );
    },
  });
}
