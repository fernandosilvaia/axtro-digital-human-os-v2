import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  checkoutCatalogExpectation,
  createDeterministicFakeCheckoutPort,
  verifyCheckoutCatalogPreflight,
} from "../../apps/portal/src/lib/billing/checkout-preflight.ts";
import { PLAN_CATALOG } from "../../apps/portal/src/lib/billing/plans.ts";

const root = fileURLToPath(new URL("../..", import.meta.url));
const stripe = await import(pathToFileURL(join(root, "packages/provider-stripe/dist/index.js")).href);

const API_KEY = "sk_test_checkout_preflight_000000000000";
const BASE_PRICE_ID = "price_1CheckoutBase000";
const OVERAGE_PRICE_ID = "price_1CheckoutOver000";
const METER_ID = "mtr_checkout_catalog_1";
const EVENT_NAME = "axtro_conversation_overage";
const CHECKOUT_INTENT_ID = "0198a8b2-3c4d-7e5f-8a90-1234567890ab";
const EXPIRES_AT_ISO = "2026-08-13T12:30:00.000Z";

const CHECKOUT = Object.freeze({
  checkoutIntentId: CHECKOUT_INTENT_ID,
  tenantId: "tenant-checkout",
  planId: "piloto",
  basePriceId: BASE_PRICE_ID,
  overagePriceId: OVERAGE_PRICE_ID,
  successUrl: "https://closer.axtroai.com/configuracoes?billing_success=1",
  cancelUrl: "https://closer.axtroai.com/configuracoes?billing_error=cancelado",
  expiresAtIso: EXPIRES_AT_ISO,
  idempotencyKey: "checkout:tenant-checkout:piloto:123",
});

function price(id, unitAmount, usageType, meter, overrides = {}) {
  return {
    id,
    object: "price",
    active: true,
    currency: "usd",
    livemode: false,
    type: "recurring",
    billing_scheme: "per_unit",
    unit_amount: unitAmount,
    recurring: {
      interval: "month",
      interval_count: 1,
      usage_type: usageType,
      meter,
    },
    ...overrides,
  };
}

function meter(overrides = {}) {
  return {
    id: METER_ID,
    object: "billing.meter",
    status: "active",
    event_name: EVENT_NAME,
    livemode: false,
    default_aggregation: { formula: "sum" },
    customer_mapping: { type: "by_id", event_payload_key: "stripe_customer_id" },
    value_settings: { event_payload_key: "value" },
    ...overrides,
  };
}

function harness(overrides = {}) {
  const calls = [];
  const fetchImplementation = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith(`/prices/${BASE_PRICE_ID}`)) {
      return new Response(JSON.stringify(price(
        BASE_PRICE_ID,
        PLAN_CATALOG.piloto.priceUsdCents,
        "licensed",
        null,
        overrides.base,
      )), { status: overrides.baseStatus ?? 200 });
    }
    if (url.endsWith(`/prices/${OVERAGE_PRICE_ID}`)) {
      return new Response(JSON.stringify(price(
        OVERAGE_PRICE_ID,
        PLAN_CATALOG.piloto.overageUsdCentsPerConversation,
        "metered",
        METER_ID,
        overrides.overage,
      )), { status: overrides.overageStatus ?? 200 });
    }
    if (url.includes("/billing/meters/")) {
      const referencedMeterId = decodeURIComponent(new URL(url).pathname.split("/").at(-1));
      return new Response(JSON.stringify(meter({ id: referencedMeterId, ...overrides.meter })), { status: overrides.meterStatus ?? 200 });
    }
    if (url.endsWith("/checkout/sessions")) {
      return new Response(JSON.stringify({
        id: "cs_test_checkout_preflight",
        url: "https://checkout.stripe.com/c/pay/cs_test_checkout_preflight",
        expires_at: Date.parse(EXPIRES_AT_ISO) / 1000,
      }), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  };
  return {
    calls,
    port: stripe.createStripeBillingPort({ apiKey: API_KEY, fetchImplementation }),
  };
}

function catalog() {
  return checkoutCatalogExpectation(PLAN_CATALOG.piloto, {
    apiKey: API_KEY,
    eventName: EVENT_NAME,
    basePriceId: BASE_PRICE_ID,
    overagePriceId: OVERAGE_PRICE_ID,
  });
}

test("checkout semantic preflight validates the selected catalog without creating a Stripe effect", async () => {
  const { calls, port } = harness();
  const result = await verifyCheckoutCatalogPreflight(port, catalog());

  assert.equal(result, undefined);
  assert.deepEqual(calls.map((call) => new URL(call.url).pathname), [
    `/v1/prices/${BASE_PRICE_ID}`,
    `/v1/prices/${OVERAGE_PRICE_ID}`,
    `/v1/billing/meters/${METER_ID}`,
  ]);
  assert.equal(calls.filter((call) => call.init.method === "POST").length, 0);
  assert.ok(calls.every((call) => call.init.headers.Authorization === `Bearer ${API_KEY}`));
});

for (const [label, overrides] of [
  ["old syntactically valid base price", { base: { unit_amount: 10_000 } }],
  ["wrong US$30 overage amount", { overage: { unit_amount: 1_000 } }],
  ["wrong meter", {
    overage: { recurring: { interval: "month", interval_count: 1, usage_type: "metered", meter: "mtr_old_catalog" } },
    meter: { event_name: "legacy_conversation_overage" },
  }],
  ["wrong Stripe mode", { base: { livemode: true } }],
]) {
  test(`checkout fails closed before create for ${label}`, async () => {
    const { calls, port } = harness(overrides);
    await assert.rejects(
      () => verifyCheckoutCatalogPreflight(port, catalog()),
      (error) => error.code === "invalid_request",
    );
    assert.equal(calls.some((call) => call.url.endsWith("/checkout/sessions")), false);
    assert.equal(calls.some((call) => call.init.method === "POST"), false);
  });
}

test("provider preflight error prevents the Checkout effect", async () => {
  const { calls, port } = harness({ baseStatus: 503 });
  await assert.rejects(
    () => verifyCheckoutCatalogPreflight(port, catalog()),
    (error) => error.code === "provider_unavailable" && error.message.includes("HTTP 503"),
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.method, "GET");
});

test("fake checkout is deterministic, effect-free and does not need a provider network", async () => {
  const url = "https://closer.axtroai.com/configuracoes?billing_error=nao_configurado";
  const port = createDeterministicFakeCheckoutPort(url);
  const expectation = checkoutCatalogExpectation(PLAN_CATALOG.piloto, {
    apiKey: "sk_test_fake_checkout",
    eventName: EVENT_NAME,
    basePriceId: "price_fakepilotobase",
    overagePriceId: "price_fakepilotooverage",
  });
  await verifyCheckoutCatalogPreflight(port, expectation);
  const first = await port.createCheckoutSession({
    ...CHECKOUT,
    basePriceId: "price_fakepilotobase",
    overagePriceId: "price_fakepilotooverage",
  });
  await verifyCheckoutCatalogPreflight(port, expectation);
  const replay = await port.createCheckoutSession({
    ...CHECKOUT,
    basePriceId: "price_fakepilotobase",
    overagePriceId: "price_fakepilotooverage",
  });
  assert.deepEqual(first, replay);
  assert.deepEqual(first, {
    sessionId: `cs_test_fake_piloto_${CHECKOUT_INTENT_ID.replaceAll("-", "")}`,
    checkoutUrl: url,
    expiresAtIso: EXPIRES_AT_ISO,
  });
});

test("checkout catalog configuration rejects ambiguous key mode before any port call", () => {
  assert.throws(
    () => checkoutCatalogExpectation(PLAN_CATALOG.piloto, {
      apiKey: "rk_unknown_account",
      eventName: EVENT_NAME,
      basePriceId: BASE_PRICE_ID,
      overagePriceId: OVERAGE_PRICE_ID,
    }),
    /must identify test or live mode/,
  );
});
