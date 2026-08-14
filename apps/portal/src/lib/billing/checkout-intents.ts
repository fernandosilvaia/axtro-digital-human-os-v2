import { createUuidV7, isUuidV7 } from "@axtro/domain";
import {
  StripeBillingError,
  type CheckoutSession,
  type CreateCheckoutSessionRequest,
  type StripeBillingCatalogReceipt,
  type VerifyStripeBillingCatalogRequest,
} from "@axtro/provider-stripe";

import { verifyCheckoutCatalogPreflight } from "./checkout-preflight.ts";
import { logError } from "../telemetry.ts";

export type CheckoutIntentOutcome = "reserved" | "replayed" | "conflict" | "blocked_unknown";
export type CheckoutIntentState = "reserved" | "dispatched" | "bound" | "completed" | "expired" | "released" | "unknown" | "conflict";

export interface CheckoutIntentReceipt {
  readonly outcome: CheckoutIntentOutcome;
  readonly checkoutIntentId: string | null;
  readonly state: CheckoutIntentState | null;
  readonly stripeIdempotencyKey: string | null;
  readonly planId: string | null;
  readonly basePriceId: string | null;
  readonly overagePriceId: string | null;
  readonly stripeLivemode: boolean | null;
  readonly baseUnitAmountCents: number | null;
  readonly overageUnitAmountCents: number | null;
  readonly meterEventName: string | null;
  readonly existingStripeCustomerId: string | null;
  readonly successUrl: string | null;
  readonly cancelUrl: string | null;
  readonly expiresAt: string | null;
  readonly stripeSessionId: string | null;
  readonly checkoutUrl: string | null;
}

export interface DurableCheckoutInput {
  readonly tenantId: string;
  readonly userId: string;
  readonly planId: string;
  readonly basePriceId: string;
  readonly overagePriceId: string;
  readonly existingStripeCustomerId?: string;
  readonly successUrl: string;
  readonly cancelUrl: string;
  readonly expiresAtIso: string;
  readonly catalog: VerifyStripeBillingCatalogRequest;
}

export type DurableCheckoutResult =
  | { readonly status: "ready"; readonly checkoutUrl: string; readonly checkoutIntentId: string }
  | { readonly status: "pending" | "conflict" };

interface RpcResult {
  readonly data: unknown;
  readonly error: { readonly message: string } | null;
}

export interface CheckoutIntentRpcClient {
  rpc(name: string, parameters?: Readonly<Record<string, unknown>>): PromiseLike<RpcResult>;
}

export interface CheckoutIntentPort {
  verifyBillingCatalog(request: VerifyStripeBillingCatalogRequest): Promise<StripeBillingCatalogReceipt>;
  createCheckoutSession(request: CreateCheckoutSessionRequest): Promise<CheckoutSession>;
}

export interface DurableCheckoutDependencies {
  readonly client: CheckoutIntentRpcClient;
  readonly port: CheckoutIntentPort;
  readonly createCheckoutIntentId?: () => string;
}

const BEGIN_KEYS = Object.freeze([
  "basePriceId", "baseUnitAmountCents", "cancelUrl", "checkoutIntentId", "checkoutUrl", "existingStripeCustomerId", "expiresAt",
  "meterEventName", "outcome", "overagePriceId", "overageUnitAmountCents", "planId", "state", "stripeIdempotencyKey",
  "stripeLivemode", "stripeSessionId", "successUrl",
]);
const CHECKOUT_STATES = new Set<CheckoutIntentState>(["reserved", "dispatched", "bound", "completed", "expired", "released", "unknown", "conflict"]);
const CHECKOUT_OUTCOMES = new Set<CheckoutIntentOutcome>(["reserved", "replayed", "conflict", "blocked_unknown"]);
const PRICE_ID_PATTERN = /^price_[A-Za-z0-9]{1,255}$/;
const CUSTOMER_ID_PATTERN = /^cus_[A-Za-z0-9]{1,255}$/;
const SESSION_ID_PATTERN = /^cs_(?:test|live)_[A-Za-z0-9_]{1,240}$/;
const IDEMPOTENCY_KEY_PATTERN = /^billing:checkout:[0-9a-f]{32}$/;

function exactRecord(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} returned a malformed receipt`);
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} returned a non-exact receipt`);
  }
  return record;
}

function nullableString(value: unknown, maxChars: number): string | null {
  return value === null || (typeof value === "string" && value.length > 0 && value.length <= maxChars) ? value as string | null : null;
}

function isIsoInstant(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) && Number.isFinite(Date.parse(value));
}

function parseBeginReceipt(value: unknown): CheckoutIntentReceipt {
  const row = exactRecord(value, BEGIN_KEYS, "checkout begin");
  if (!CHECKOUT_OUTCOMES.has(row.outcome as CheckoutIntentOutcome)) throw new Error("checkout begin returned an invalid outcome");
  const checkoutIntentId = nullableString(row.checkoutIntentId, 36);
  const state = row.state === null || CHECKOUT_STATES.has(row.state as CheckoutIntentState) ? row.state as CheckoutIntentState | null : null;
  const receipt: CheckoutIntentReceipt = {
    outcome: row.outcome as CheckoutIntentOutcome,
    checkoutIntentId,
    state,
    stripeIdempotencyKey: typeof row.stripeIdempotencyKey === "string" && IDEMPOTENCY_KEY_PATTERN.test(row.stripeIdempotencyKey)
      ? row.stripeIdempotencyKey
      : null,
    planId: nullableString(row.planId, 64),
    basePriceId: nullableString(row.basePriceId, 261),
    overagePriceId: nullableString(row.overagePriceId, 261),
    stripeLivemode: typeof row.stripeLivemode === "boolean" ? row.stripeLivemode : null,
    baseUnitAmountCents: Number.isInteger(row.baseUnitAmountCents) ? Number(row.baseUnitAmountCents) : null,
    overageUnitAmountCents: Number.isInteger(row.overageUnitAmountCents) ? Number(row.overageUnitAmountCents) : null,
    meterEventName: nullableString(row.meterEventName, 100),
    existingStripeCustomerId: nullableString(row.existingStripeCustomerId, 259),
    successUrl: nullableString(row.successUrl, 2000),
    cancelUrl: nullableString(row.cancelUrl, 2000),
    expiresAt: isIsoInstant(row.expiresAt) ? row.expiresAt : null,
    stripeSessionId: nullableString(row.stripeSessionId, 255),
    checkoutUrl: nullableString(row.checkoutUrl, 2000),
  };
  if (receipt.outcome === "conflict" || receipt.outcome === "blocked_unknown") {
    if (Object.entries(receipt).some(([key, item]) => key !== "outcome" && item !== null)) {
      throw new Error("blocked checkout begin receipt exposed mutable intent data");
    }
    return Object.freeze(receipt);
  }
  if (receipt.outcome === "reserved" && receipt.state !== "reserved") {
    throw new Error("checkout begin returned an impossible reserved receipt");
  }
  if (
    !isUuidV7(receipt.checkoutIntentId)
    || receipt.state === null
    || receipt.stripeIdempotencyKey === null
    || receipt.planId === null
    || !PRICE_ID_PATTERN.test(receipt.basePriceId ?? "")
    || !PRICE_ID_PATTERN.test(receipt.overagePriceId ?? "")
    || receipt.stripeLivemode === null
    || receipt.baseUnitAmountCents === null
    || receipt.baseUnitAmountCents < 1
    || receipt.overageUnitAmountCents === null
    || receipt.overageUnitAmountCents < 1
    || receipt.meterEventName === null
    || (receipt.existingStripeCustomerId !== null && !CUSTOMER_ID_PATTERN.test(receipt.existingStripeCustomerId))
    || receipt.successUrl === null
    || receipt.cancelUrl === null
    || receipt.expiresAt === null
  ) {
    throw new Error("checkout begin returned an incomplete immutable snapshot");
  }
  return Object.freeze(receipt);
}

function assertSnapshot(receipt: CheckoutIntentReceipt, input: DurableCheckoutInput): void {
  const licensed = input.catalog.prices.find((price) => price.usageType === "licensed");
  const metered = input.catalog.prices.find((price) => price.usageType === "metered");
  if (
    receipt.planId !== input.planId
    || receipt.basePriceId !== input.basePriceId
    || receipt.overagePriceId !== input.overagePriceId
    || receipt.stripeLivemode !== input.catalog.livemode
    || receipt.baseUnitAmountCents !== licensed?.unitAmountUsdCents
    || receipt.overageUnitAmountCents !== metered?.unitAmountUsdCents
    || receipt.meterEventName !== input.catalog.eventName
    || receipt.existingStripeCustomerId !== (input.existingStripeCustomerId ?? null)
    || receipt.successUrl !== input.successUrl
    || receipt.cancelUrl !== input.cancelUrl
    || (receipt.outcome === "reserved" && receipt.expiresAt !== input.expiresAtIso)
  ) {
    throw new Error("checkout begin immutable snapshot conflicts with the requested checkout");
  }
}

function validCheckoutUrl(value: string, successOrigin: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:"
      && (parsed.hostname === "checkout.stripe.com" || parsed.origin === new URL(successOrigin).origin);
  } catch {
    return false;
  }
}

function isRetryableStripeFailure(error: unknown): boolean {
  if (!(error instanceof StripeBillingError)) return false;
  if (error.code === "provider_timeout" || error.code === "provider_unavailable") return true;
  return error.code === "provider_rejected"
    && error.httpStatus !== null
    // A 429 carries a provider backoff contract. Do not sleep inside the
    // Server Action or hammer it immediately; the durable intent lets the
    // next tenant-scoped retry reuse this exact Stripe key and body.
    && ([408, 409, 425].includes(error.httpStatus) || error.httpStatus >= 500);
}

async function releasePreDispatch(client: CheckoutIntentRpcClient, checkoutIntentId: string): Promise<void> {
  const response = await client.rpc("portal_release_billing_checkout_intent_service", {
    p_checkout_intent_id: checkoutIntentId,
    p_evidence: "catalog_preflight_failed",
  });
  if (response.error) throw new Error(`checkout intent release failed: ${response.error.message}`);
  const receipt = exactRecord(response.data, ["released", "state"], "checkout release");
  if (receipt.released !== true || receipt.state !== "released") throw new Error("checkout release was not applied");
}

async function createWithOneRetry(port: CheckoutIntentPort, request: CreateCheckoutSessionRequest): Promise<CheckoutSession> {
  try {
    return await port.createCheckoutSession(request);
  } catch (error) {
    if (!isRetryableStripeFailure(error)) throw error;
    return port.createCheckoutSession(request);
  }
}

export async function createDurableCheckout(
  input: DurableCheckoutInput,
  dependencies: DurableCheckoutDependencies,
): Promise<DurableCheckoutResult> {
  const checkoutIntentId = (dependencies.createCheckoutIntentId ?? createUuidV7)();
  if (!isUuidV7(checkoutIntentId)) throw new Error("checkout intent id must be a UUIDv7");
  const begin = await dependencies.client.rpc("portal_begin_billing_checkout_intent_service", {
    p_checkout_intent_id: checkoutIntentId,
    p_tenant_id: input.tenantId,
    p_user_id: input.userId,
    p_plan_id: input.planId,
    p_base_price_id: input.basePriceId,
    p_overage_price_id: input.overagePriceId,
    p_stripe_livemode: input.catalog.livemode,
    p_base_unit_amount_cents: input.catalog.prices.find((price) => price.usageType === "licensed")?.unitAmountUsdCents ?? null,
    p_overage_unit_amount_cents: input.catalog.prices.find((price) => price.usageType === "metered")?.unitAmountUsdCents ?? null,
    p_meter_event_name: input.catalog.eventName,
    p_existing_stripe_customer_id: input.existingStripeCustomerId ?? null,
    p_success_url: input.successUrl,
    p_cancel_url: input.cancelUrl,
    p_expires_at: input.expiresAtIso,
  });
  if (begin.error) throw new Error(`checkout intent begin failed: ${begin.error.message}`);
  const intent = parseBeginReceipt(begin.data);
  if (intent.outcome === "conflict") return Object.freeze({ status: "conflict" });
  if (intent.outcome === "blocked_unknown") return Object.freeze({ status: "pending" });
  if (intent.outcome === "reserved") assertSnapshot(intent, input);

  if ((intent.state === "bound" || intent.state === "completed") && intent.checkoutUrl !== null && validCheckoutUrl(intent.checkoutUrl, intent.successUrl!)) {
    return Object.freeze({ status: "ready", checkoutUrl: intent.checkoutUrl, checkoutIntentId: intent.checkoutIntentId! });
  }
  if (intent.state !== "reserved" && intent.state !== "dispatched" && intent.state !== "unknown") {
    return Object.freeze({ status: "pending" });
  }

  const immutableCatalog: VerifyStripeBillingCatalogRequest = Object.freeze({
    eventName: intent.meterEventName!,
    livemode: intent.stripeLivemode!,
    prices: Object.freeze([
      Object.freeze({ priceId: intent.basePriceId!, unitAmountUsdCents: intent.baseUnitAmountCents!, usageType: "licensed" as const }),
      Object.freeze({ priceId: intent.overagePriceId!, unitAmountUsdCents: intent.overageUnitAmountCents!, usageType: "metered" as const }),
    ]),
  });

  try {
    await verifyCheckoutCatalogPreflight(dependencies.port, immutableCatalog);
  } catch (error) {
    if (intent.state === "reserved") {
      await releasePreDispatch(dependencies.client, intent.checkoutIntentId!);
      throw error;
    }
    logError("billing_checkout_preflight_failed", error, {
      tenant_id: input.tenantId,
      checkout_intent_id: intent.checkoutIntentId,
      intent_state: intent.state,
    });
    return Object.freeze({ status: "pending" });
  }

  if (intent.state === "reserved") {
    const dispatch = await dependencies.client.rpc("portal_mark_billing_checkout_dispatched_service", {
      p_checkout_intent_id: intent.checkoutIntentId,
    });
    if (dispatch.error) throw new Error(`checkout dispatch fence failed: ${dispatch.error.message}`);
    const dispatchReceipt = exactRecord(dispatch.data, ["acquired", "state"], "checkout dispatch");
    if (
      typeof dispatchReceipt.acquired !== "boolean"
      || !CHECKOUT_STATES.has(dispatchReceipt.state as CheckoutIntentState)
      || (dispatchReceipt.acquired === true) !== (dispatchReceipt.state === "dispatched")
      || (dispatchReceipt.acquired === false && dispatchReceipt.state === "reserved")
    ) {
      throw new Error("checkout dispatch returned an invalid receipt");
    }
    if (dispatchReceipt.acquired !== true) return Object.freeze({ status: "pending" });
  }

  const checkoutRequest = Object.freeze({
    checkoutIntentId: intent.checkoutIntentId!,
    tenantId: input.tenantId,
    planId: intent.planId!,
    basePriceId: intent.basePriceId!,
    overagePriceId: intent.overagePriceId!,
    ...(intent.existingStripeCustomerId === null ? {} : { existingStripeCustomerId: intent.existingStripeCustomerId }),
    successUrl: intent.successUrl!,
    cancelUrl: intent.cancelUrl!,
    expiresAtIso: intent.expiresAt!,
    idempotencyKey: intent.stripeIdempotencyKey!,
  } satisfies CreateCheckoutSessionRequest);

  let session: CheckoutSession;
  try {
    session = await createWithOneRetry(dependencies.port, checkoutRequest);
  } catch (error) {
    logError("billing_checkout_create_failed", error, {
      tenant_id: input.tenantId,
      checkout_intent_id: intent.checkoutIntentId,
    });
    return Object.freeze({ status: "pending" });
  }
  if (session.expiresAtIso !== intent.expiresAt || !SESSION_ID_PATTERN.test(session.sessionId) || !validCheckoutUrl(session.checkoutUrl, intent.successUrl!)) {
    logError("billing_checkout_session_mismatch", new Error("Stripe checkout session did not match the reserved intent"), {
      tenant_id: input.tenantId,
      checkout_intent_id: intent.checkoutIntentId,
    });
    return Object.freeze({ status: "pending" });
  }

  const bound = await dependencies.client.rpc("portal_bind_billing_checkout_session_service", {
    p_checkout_intent_id: intent.checkoutIntentId,
    p_stripe_session_id: session.sessionId,
    p_checkout_url: session.checkoutUrl,
    p_expires_at: session.expiresAtIso,
  });
  if (bound.error) {
    logError("billing_checkout_bind_failed", new Error(bound.error.message), {
      tenant_id: input.tenantId,
      checkout_intent_id: intent.checkoutIntentId,
    });
    return Object.freeze({ status: "pending" });
  }
  const bindReceipt = exactRecord(bound.data, ["bound", "state"], "checkout bind");
  if (bindReceipt.bound !== true || (bindReceipt.state !== "bound" && bindReceipt.state !== "completed")) {
    logError("billing_checkout_bind_failed", new Error("checkout bind receipt was not accepted"), {
      tenant_id: input.tenantId,
      checkout_intent_id: intent.checkoutIntentId,
      state: bindReceipt.state,
    });
    return Object.freeze({ status: "pending" });
  }
  return Object.freeze({ status: "ready", checkoutUrl: session.checkoutUrl, checkoutIntentId: intent.checkoutIntentId! });
}
