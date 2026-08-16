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
  readonly httpStatus: number | null;
  readonly retryAfterSeconds: number | null;
  constructor(code: StripeErrorCode, message: string, httpStatus: number | null = null, retryAfterSeconds: number | null = null) {
    super(message);
    this.name = "StripeBillingError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export interface CreateCheckoutSessionRequest {
  /** Durable, server-owned intent that correlates Stripe and database state. */
  readonly checkoutIntentId: string;
  readonly tenantId: string;
  readonly planId: string;
  readonly basePriceId: string;
  readonly overagePriceId: string;
  /** Reaproveita o Customer existente (troca de plano) em vez de criar um novo. */
  readonly existingStripeCustomerId?: string;
  readonly successUrl: string;
  readonly cancelUrl: string;
  /** Immutable, second-precision expiry persisted before provider dispatch. */
  readonly expiresAtIso: string;
  /** Chave de idempotência da Stripe — duplo clique/retry/duas abas não criam duas assinaturas. */
  readonly idempotencyKey: string;
}

export interface CheckoutSession {
  readonly sessionId: string;
  readonly checkoutUrl: string;
  readonly expiresAtIso: string;
}

/**
 * Sessão de checkout pra um prospect sem conta/tenant no produto — usada
 * pelo fechamento ao vivo de um closer (D-V2-123), não pelo autosserviço.
 * Sem `checkoutIntentId`/`tenantId`: não existe assinatura durável nem
 * conflito de assinatura concorrente a proteger aqui, só uma sessão avulsa
 * pra uma empresa que ainda não é cliente.
 */
export interface CreateProspectCheckoutSessionRequest {
  readonly basePriceId: string;
  readonly overagePriceId: string;
  readonly prospectEmail: string;
  readonly prospectCompanyName: string;
  readonly successUrl: string;
  readonly cancelUrl: string;
  readonly expiresAtIso: string;
  readonly idempotencyKey: string;
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
  /**
   * Instante atribuído ao evento no Meter, em ISO 8601. Opcional para manter
   * compatibilidade com os chamadores síncronos legados; o outbox durável
   * informa o instante real em que a unidade faturável foi criada.
   */
  readonly eventTimestamp?: string;
}

export interface StripeCatalogPriceExpectation {
  readonly priceId: string;
  readonly unitAmountUsdCents: number;
  readonly usageType: "licensed" | "metered";
}

export interface VerifyStripeBillingCatalogRequest {
  readonly prices: readonly StripeCatalogPriceExpectation[];
  readonly eventName: string;
  readonly livemode: boolean;
}

export interface StripeBillingCatalogReceipt {
  readonly verified: true;
  readonly meterId: string;
  readonly eventName: string;
  readonly livemode: boolean;
  readonly priceCount: number;
}

export interface StripeBillingPort {
  readonly providerId: string;
  createCheckoutSession(request: CreateCheckoutSessionRequest): Promise<CheckoutSession>;
  createProspectCheckoutSession(request: CreateProspectCheckoutSessionRequest): Promise<CheckoutSession>;
  createPortalSession(request: CreatePortalSessionRequest): Promise<PortalSession>;
  reportOverageUsage(request: ReportOverageUsageRequest): Promise<void>;
  verifyBillingCatalog(request: VerifyStripeBillingCatalogRequest): Promise<StripeBillingCatalogReceipt>;
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
const MAX_EVENT_NAME_CHARS = 100;
const MAX_RESPONSE_BODY_BYTES = 256 * 1024;
const PRICE_ID_PATTERN = /^price_[A-Za-z0-9]{1,255}$/;
const CUSTOMER_ID_PATTERN = /^cus_[A-Za-z0-9]{1,255}$/;
const CHECKOUT_SESSION_ID_PATTERN = /^cs_(?:test|live)_[A-Za-z0-9_]{1,240}$/;
const CHECKOUT_INTENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROSPECT_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_CHARS = 255;
const MAX_COMPANY_NAME_CHARS = 160;

function isHttpsUrl(value: unknown, maxChars: number): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > maxChars) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function checkoutExpirySeconds(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/.test(value)) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed % 1000 !== 0) return null;
  return parsed / 1000;
}

function isStripeCheckoutUrl(value: unknown, sessionId: string): value is string {
  if (!isHttpsUrl(value, MAX_URL_CHARS)) return false;
  const parsed = new URL(value);
  return parsed.hostname === "checkout.stripe.com"
    && parsed.username.length === 0
    && parsed.password.length === 0
    && parsed.port.length === 0
    && parsed.pathname.split("/").some((segment) => segment === sessionId);
}

function isStripeBillingPortalUrl(value: unknown): value is string {
  if (!isHttpsUrl(value, MAX_URL_CHARS)) return false;
  const parsed = new URL(value);
  return parsed.hostname === "billing.stripe.com"
    && parsed.username.length === 0
    && parsed.password.length === 0
    && parsed.port.length === 0
    && parsed.hash.length === 0
    && parsed.pathname.startsWith("/p/session/")
    && parsed.pathname.length > "/p/session/".length;
}

async function readBoundedResponseText(response: Response): Promise<string> {
  const contentLength = response.headers?.get?.("content-length");
  if (contentLength !== null && contentLength !== undefined) {
    if (!/^(0|[1-9][0-9]*)$/.test(contentLength) || Number(contentLength) > MAX_RESPONSE_BODY_BYTES) {
      throw new StripeBillingError("malformed_provider_response", "Stripe response exceeded the body limit");
    }
  }
  if (response.body === null || response.body === undefined) {
    // Compatibility for injected test transports; native fetch responses use
    // the bounded stream branch below.
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BODY_BYTES) {
      throw new StripeBillingError("malformed_provider_response", "Stripe response exceeded the body limit");
    }
    return text;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let totalBytes = 0;
  let text = "";
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      totalBytes += next.value.byteLength;
      if (totalBytes > MAX_RESPONSE_BODY_BYTES) {
        await reader.cancel();
        throw new StripeBillingError("malformed_provider_response", "Stripe response exceeded the body limit");
      }
      text += decoder.decode(next.value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } catch (error) {
    if (error instanceof StripeBillingError) throw error;
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new StripeBillingError("malformed_provider_response", "Stripe returned non-UTF-8 output");
  } finally {
    reader.releaseLock();
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
    method: "GET" | "POST",
    path: string,
    body: Record<string, unknown> = {},
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
          ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
          "Stripe-Version": STRIPE_API_VERSION,
          ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
        },
        ...(method === "POST" ? { body: toFormBody(body) } : {}),
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
        const retryAfterHeader = response.headers?.get?.("retry-after") ?? null;
        const retryAfterSeconds = retryAfterHeader !== null && /^(0|[1-9][0-9]*)$/.test(retryAfterHeader)
          ? Math.min(86_400, Number(retryAfterHeader))
          : null;
        throw new StripeBillingError(code, `Stripe respondeu HTTP ${response.status}`, response.status, retryAfterSeconds);
      }
      let text: string;
      try {
        text = await readBoundedResponseText(response);
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
      if (!CHECKOUT_INTENT_ID_PATTERN.test(request.checkoutIntentId)) {
        throw new StripeBillingError("invalid_request", "checkoutIntentId must be a UUIDv7");
      }
      if (typeof request.tenantId !== "string" || request.tenantId.length === 0 || request.tenantId.length > MAX_ID_CHARS) {
        throw new StripeBillingError("invalid_request", "tenantId must be 1.." + MAX_ID_CHARS + " chars");
      }
      if (typeof request.planId !== "string" || request.planId.length === 0 || request.planId.length > 64) {
        throw new StripeBillingError("invalid_request", "planId must be 1..64 chars");
      }
      if (!PRICE_ID_PATTERN.test(request.basePriceId) || !PRICE_ID_PATTERN.test(request.overagePriceId)) {
        throw new StripeBillingError("invalid_request", "basePriceId/overagePriceId must be plain Stripe price ids");
      }
      if (request.existingStripeCustomerId !== undefined && !CUSTOMER_ID_PATTERN.test(request.existingStripeCustomerId)) {
        throw new StripeBillingError("invalid_request", "existingStripeCustomerId must be a plain Stripe customer id");
      }
      if (!isHttpsUrl(request.successUrl, MAX_URL_CHARS) || !isHttpsUrl(request.cancelUrl, MAX_URL_CHARS)) {
        throw new StripeBillingError("invalid_request", "successUrl/cancelUrl must be https URLs");
      }
      const expiresAtSeconds = checkoutExpirySeconds(request.expiresAtIso);
      if (expiresAtSeconds === null) {
        throw new StripeBillingError("invalid_request", "expiresAtIso must be a second-precision ISO 8601 instant");
      }
      if (typeof request.idempotencyKey !== "string" || request.idempotencyKey.length === 0 || request.idempotencyKey.length > MAX_ID_CHARS) {
        throw new StripeBillingError("invalid_request", "idempotencyKey is required");
      }

      const payload = await call(
        "POST",
        "/checkout/sessions",
        {
          mode: "subscription",
          client_reference_id: request.checkoutIntentId,
          ...(request.existingStripeCustomerId ? { customer: request.existingStripeCustomerId } : {}),
          success_url: request.successUrl,
          cancel_url: request.cancelUrl,
          expires_at: expiresAtSeconds,
          allow_promotion_codes: true,
          metadata: {
            checkout_intent_id: request.checkoutIntentId,
            tenant_id: request.tenantId,
            plan_id: request.planId,
          },
          line_items: [
            { price: request.basePriceId, quantity: 1 },
            { price: request.overagePriceId },
          ],
          subscription_data: {
            metadata: {
              checkout_intent_id: request.checkoutIntentId,
              tenant_id: request.tenantId,
              plan_id: request.planId,
            },
          },
        },
        request.idempotencyKey,
      );
      const record = (payload ?? {}) as Record<string, unknown>;
      const sessionId = record.id;
      const checkoutUrl = record.url;
      const responseExpirySeconds = record.expires_at;
      if (
        typeof sessionId !== "string"
        || !CHECKOUT_SESSION_ID_PATTERN.test(sessionId)
        || !isStripeCheckoutUrl(checkoutUrl, sessionId)
        || !Number.isInteger(responseExpirySeconds)
        || responseExpirySeconds !== expiresAtSeconds
      ) {
        throw new StripeBillingError("malformed_provider_response", "Stripe checkout session payload has an invalid id/url/expiry");
      }
      return Object.freeze({ sessionId, checkoutUrl, expiresAtIso: request.expiresAtIso });
    },

    async createProspectCheckoutSession(request: CreateProspectCheckoutSessionRequest): Promise<CheckoutSession> {
      if (!PRICE_ID_PATTERN.test(request.basePriceId) || !PRICE_ID_PATTERN.test(request.overagePriceId)) {
        throw new StripeBillingError("invalid_request", "basePriceId/overagePriceId must be plain Stripe price ids");
      }
      if (
        typeof request.prospectEmail !== "string"
        || request.prospectEmail.length === 0
        || request.prospectEmail.length > MAX_EMAIL_CHARS
        || !PROSPECT_EMAIL_PATTERN.test(request.prospectEmail)
      ) {
        throw new StripeBillingError("invalid_request", "prospectEmail must be a plain email address");
      }
      if (
        typeof request.prospectCompanyName !== "string"
        || request.prospectCompanyName.trim().length === 0
        || request.prospectCompanyName.length > MAX_COMPANY_NAME_CHARS
      ) {
        throw new StripeBillingError("invalid_request", "prospectCompanyName must be 1.." + MAX_COMPANY_NAME_CHARS + " chars");
      }
      if (!isHttpsUrl(request.successUrl, MAX_URL_CHARS) || !isHttpsUrl(request.cancelUrl, MAX_URL_CHARS)) {
        throw new StripeBillingError("invalid_request", "successUrl/cancelUrl must be https URLs");
      }
      const expiresAtSeconds = checkoutExpirySeconds(request.expiresAtIso);
      if (expiresAtSeconds === null) {
        throw new StripeBillingError("invalid_request", "expiresAtIso must be a second-precision ISO 8601 instant");
      }
      if (typeof request.idempotencyKey !== "string" || request.idempotencyKey.length === 0 || request.idempotencyKey.length > MAX_ID_CHARS) {
        throw new StripeBillingError("invalid_request", "idempotencyKey is required");
      }

      const payload = await call(
        "POST",
        "/checkout/sessions",
        {
          mode: "subscription",
          customer_email: request.prospectEmail,
          success_url: request.successUrl,
          cancel_url: request.cancelUrl,
          expires_at: expiresAtSeconds,
          allow_promotion_codes: true,
          metadata: {
            prospect_company: request.prospectCompanyName,
            source: "axtro_closer_proposal",
          },
          line_items: [
            { price: request.basePriceId, quantity: 1 },
            { price: request.overagePriceId },
          ],
          subscription_data: {
            metadata: {
              prospect_company: request.prospectCompanyName,
              source: "axtro_closer_proposal",
            },
          },
        },
        request.idempotencyKey,
      );
      const record = (payload ?? {}) as Record<string, unknown>;
      const sessionId = record.id;
      const checkoutUrl = record.url;
      const responseExpirySeconds = record.expires_at;
      if (
        typeof sessionId !== "string"
        || !CHECKOUT_SESSION_ID_PATTERN.test(sessionId)
        || !isStripeCheckoutUrl(checkoutUrl, sessionId)
        || !Number.isInteger(responseExpirySeconds)
        || responseExpirySeconds !== expiresAtSeconds
      ) {
        throw new StripeBillingError("malformed_provider_response", "Stripe checkout session payload has an invalid id/url/expiry");
      }
      return Object.freeze({ sessionId, checkoutUrl, expiresAtIso: request.expiresAtIso });
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
      if (!isStripeBillingPortalUrl(portalUrl)) {
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
      let timestamp: number | undefined;
      if (request.eventTimestamp !== undefined) {
        const parsed = Date.parse(request.eventTimestamp);
        if (!Number.isFinite(parsed) || parsed < 0) {
          throw new StripeBillingError("invalid_request", "eventTimestamp must be a valid ISO 8601 instant");
        }
        timestamp = Math.floor(parsed / 1000);
      }
      await call(
        "POST",
        "/billing/meter_events",
        {
          event_name: request.eventName,
          payload: { stripe_customer_id: request.stripeCustomerId, value: request.quantity },
          ...(timestamp === undefined ? {} : { timestamp }),
        },
        request.idempotencyKey,
      );
    },

    async verifyBillingCatalog(request: VerifyStripeBillingCatalogRequest): Promise<StripeBillingCatalogReceipt> {
      if (
        !Array.isArray(request.prices)
        || request.prices.length < 1
        || request.prices.length > 20
        || typeof request.eventName !== "string"
        || request.eventName.length < 1
        || request.eventName.length > MAX_EVENT_NAME_CHARS
        || typeof request.livemode !== "boolean"
      ) {
        throw new StripeBillingError("invalid_request", "Stripe billing catalog expectation is invalid");
      }
      const uniqueIds = new Set<string>();
      let meterId: string | null = null;
      for (const expected of request.prices) {
        if (
          !PRICE_ID_PATTERN.test(expected.priceId)
          || !Number.isInteger(expected.unitAmountUsdCents)
          || expected.unitAmountUsdCents < 1
          || expected.unitAmountUsdCents > 100_000_000
          || (expected.usageType !== "licensed" && expected.usageType !== "metered")
          || uniqueIds.has(expected.priceId)
        ) {
          throw new StripeBillingError("invalid_request", "Stripe billing catalog contains an invalid or duplicate price expectation");
        }
        uniqueIds.add(expected.priceId);
        const payload = await call("GET", `/prices/${expected.priceId}`);
        const price = (payload ?? {}) as Record<string, unknown>;
        const recurring = price.recurring as Record<string, unknown> | null;
        if (
          price.id !== expected.priceId
          || price.object !== "price"
          || price.active !== true
          || price.currency !== "usd"
          || price.livemode !== request.livemode
          || price.type !== "recurring"
          || price.billing_scheme !== "per_unit"
          || price.unit_amount !== expected.unitAmountUsdCents
          || recurring === null
          || typeof recurring !== "object"
          || recurring.interval !== "month"
          || recurring.interval_count !== 1
          || recurring.usage_type !== expected.usageType
        ) {
          throw new StripeBillingError("invalid_request", `Stripe price ${expected.priceId} does not match the versioned catalog`);
        }
        if (expected.usageType === "licensed") {
          if (recurring.meter !== null && recurring.meter !== undefined) {
            throw new StripeBillingError("invalid_request", `Stripe base price ${expected.priceId} unexpectedly references a meter`);
          }
        } else {
          if (typeof recurring.meter !== "string" || recurring.meter.length < 5 || recurring.meter.length > MAX_ID_CHARS) {
            throw new StripeBillingError("invalid_request", `Stripe overage price ${expected.priceId} has no meter`);
          }
          if (meterId !== null && meterId !== recurring.meter) {
            throw new StripeBillingError("invalid_request", "Stripe overage prices do not share one meter");
          }
          meterId = recurring.meter;
        }
      }
      if (meterId === null) {
        throw new StripeBillingError("invalid_request", "Stripe billing catalog has no metered overage price");
      }
      const meterPayload = await call("GET", `/billing/meters/${encodeURIComponent(meterId)}`);
      const meter = (meterPayload ?? {}) as Record<string, unknown>;
      const aggregation = meter.default_aggregation as Record<string, unknown> | null;
      const customerMapping = meter.customer_mapping as Record<string, unknown> | null;
      const valueSettings = meter.value_settings as Record<string, unknown> | null;
      if (
        meter.id !== meterId
        || meter.object !== "billing.meter"
        || meter.status !== "active"
        || meter.event_name !== request.eventName
        || meter.livemode !== request.livemode
        || aggregation?.formula !== "sum"
        || customerMapping?.type !== "by_id"
        || customerMapping?.event_payload_key !== "stripe_customer_id"
        || valueSettings?.event_payload_key !== "value"
      ) {
        throw new StripeBillingError("invalid_request", "Stripe meter does not match the versioned billing catalog");
      }
      return Object.freeze({
        verified: true,
        meterId,
        eventName: request.eventName,
        livemode: request.livemode,
        priceCount: request.prices.length,
      });
    },
  });
}
