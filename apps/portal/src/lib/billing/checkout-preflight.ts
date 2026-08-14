import type {
  CheckoutSession,
  CreateCheckoutSessionRequest,
  StripeBillingCatalogReceipt,
  VerifyStripeBillingCatalogRequest,
} from "@axtro/provider-stripe";

import type { PlanDefinition } from "./plans.ts";

const STRIPE_METER_ID_PATTERN = /^mtr_[A-Za-z0-9_]{1,195}$/;

export interface CheckoutCatalogVerificationPort {
  verifyBillingCatalog(request: VerifyStripeBillingCatalogRequest): Promise<StripeBillingCatalogReceipt>;
}

export interface CheckoutCatalogPort extends CheckoutCatalogVerificationPort {
  createCheckoutSession(request: CreateCheckoutSessionRequest): Promise<CheckoutSession>;
}

export interface CheckoutCatalogConfiguration {
  readonly apiKey: string;
  readonly eventName: string;
  readonly basePriceId: string;
  readonly overagePriceId: string;
}

/**
 * The checkout and usage dispatcher use the same versioned Stripe catalog
 * contract: USD monthly licensed base + USD monthly metered overage, with the
 * exact amounts from PLAN_CATALOG and one configured Meter event name.
 */
export function checkoutCatalogExpectation(
  plan: PlanDefinition,
  configuration: CheckoutCatalogConfiguration,
): VerifyStripeBillingCatalogRequest {
  const apiKey = configuration.apiKey.trim();
  const livemode = apiKey.startsWith("sk_live_")
    ? true
    : apiKey.startsWith("sk_test_")
      ? false
      : null;
  if (livemode === null) throw new Error("STRIPE_SECRET_KEY must identify test or live mode");
  const eventName = configuration.eventName.trim();
  if (eventName.length === 0) throw new Error("STRIPE_CONVERSATION_OVERAGE_EVENT_NAME is not configured");

  return Object.freeze({
    eventName,
    livemode,
    prices: Object.freeze([
      Object.freeze({
        priceId: configuration.basePriceId.trim(),
        unitAmountUsdCents: plan.priceUsdCents,
        usageType: "licensed" as const,
      }),
      Object.freeze({
        priceId: configuration.overagePriceId.trim(),
        unitAmountUsdCents: plan.overageUsdCentsPerConversation,
        usageType: "metered" as const,
      }),
    ]),
  });
}

/**
 * No Checkout effect is attempted until the same port (and therefore the
 * same Stripe account/key) returns an exact semantic catalog receipt.
 */
export async function verifyCheckoutCatalogPreflight(
  port: CheckoutCatalogVerificationPort,
  catalog: VerifyStripeBillingCatalogRequest,
): Promise<void> {
  const receipt = await port.verifyBillingCatalog(catalog);
  if (
    receipt.verified !== true
    || receipt.eventName !== catalog.eventName
    || receipt.livemode !== catalog.livemode
    || receipt.priceCount !== catalog.prices.length
    || !STRIPE_METER_ID_PATTERN.test(receipt.meterId)
  ) {
    throw new Error("Stripe checkout catalog preflight did not return an exact receipt");
  }
}

/**
 * Demonstration mode is intentionally local and effect-free. It exercises
 * the same preflight ordering but always returns one deterministic local URL;
 * a real Stripe key present by accident is never touched in fake mode.
 */
export function createDeterministicFakeCheckoutPort(notConfiguredUrl: string): CheckoutCatalogPort {
  return Object.freeze({
    async verifyBillingCatalog(request: VerifyStripeBillingCatalogRequest): Promise<StripeBillingCatalogReceipt> {
      return Object.freeze({
        verified: true,
        meterId: "mtr_fake_checkout",
        eventName: request.eventName,
        livemode: request.livemode,
        priceCount: request.prices.length,
      });
    },
    async createCheckoutSession(request: CreateCheckoutSessionRequest): Promise<CheckoutSession> {
      return Object.freeze({
        sessionId: `cs_test_fake_${request.planId}_${request.checkoutIntentId.replaceAll("-", "")}`,
        checkoutUrl: notConfiguredUrl,
        expiresAtIso: request.expiresAtIso,
      });
    },
  });
}
