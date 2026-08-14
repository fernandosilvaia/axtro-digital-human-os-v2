import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { createDurableCheckout } from "../../apps/portal/src/lib/billing/checkout-intents.ts";

const root = fileURLToPath(new URL("../..", import.meta.url));
const { StripeBillingError } = await import(pathToFileURL(join(root, "packages/provider-stripe/dist/index.js")).href);

const INTENT_ID = "0198a8b2-3c4d-7e5f-8a90-1234567890ab";
const IDEMPOTENCY_KEY = "billing:checkout:0198a8b23c4d7e5f8a901234567890ab";
const TENANT_ID = "0198a8b2-3c4d-7e5f-8a90-1234567890aa";
const USER_ID = "550e8400-e29b-41d4-a716-446655440000";
const EXPIRES_AT = "2026-08-13T12:30:00.000Z";
const BASE_PRICE_ID = "price_1CheckoutBase000";
const OVERAGE_PRICE_ID = "price_1CheckoutOver000";
const SUCCESS_URL = "https://closer.axtroai.com/configuracoes?billing_success=1";
const CANCEL_URL = "https://closer.axtroai.com/configuracoes?billing_error=cancelado";

const input = Object.freeze({
  tenantId: TENANT_ID,
  userId: USER_ID,
  planId: "piloto",
  basePriceId: BASE_PRICE_ID,
  overagePriceId: OVERAGE_PRICE_ID,
  successUrl: SUCCESS_URL,
  cancelUrl: CANCEL_URL,
  expiresAtIso: EXPIRES_AT,
  catalog: Object.freeze({
    eventName: "axtro_conversation_overage",
    livemode: false,
    prices: Object.freeze([
      Object.freeze({ priceId: BASE_PRICE_ID, unitAmountUsdCents: 49_700, usageType: "licensed" }),
      Object.freeze({ priceId: OVERAGE_PRICE_ID, unitAmountUsdCents: 3_000, usageType: "metered" }),
    ]),
  }),
});

function begin(overrides = {}) {
  return {
    outcome: "reserved",
    checkoutIntentId: INTENT_ID,
    state: "reserved",
    stripeIdempotencyKey: IDEMPOTENCY_KEY,
    planId: "piloto",
    basePriceId: BASE_PRICE_ID,
    overagePriceId: OVERAGE_PRICE_ID,
    stripeLivemode: false,
    baseUnitAmountCents: 49_700,
    overageUnitAmountCents: 3_000,
    meterEventName: "axtro_conversation_overage",
    existingStripeCustomerId: null,
    successUrl: SUCCESS_URL,
    cancelUrl: CANCEL_URL,
    expiresAt: EXPIRES_AT,
    stripeSessionId: null,
    checkoutUrl: null,
    ...overrides,
  };
}

function harness(overrides = {}) {
  const order = [];
  const rpcCalls = [];
  const checkoutRequests = [];
  const responses = {
    portal_begin_billing_checkout_intent_service: { data: begin(overrides.begin), error: null },
    portal_mark_billing_checkout_dispatched_service: { data: { acquired: true, state: "dispatched" }, error: null },
    portal_bind_billing_checkout_session_service: { data: { bound: true, state: "bound" }, error: null },
    portal_release_billing_checkout_intent_service: { data: { released: true, state: "released" }, error: null },
    ...overrides.rpc,
  };
  const client = {
    rpc: async (name, args) => {
      order.push(`rpc:${name}`);
      rpcCalls.push({ name, args });
      const response = responses[name];
      return typeof response === "function" ? response(args) : response;
    },
  };
  let checkoutAttempt = 0;
  const port = {
    verifyBillingCatalog: async (catalog) => {
      order.push("provider:verify");
      if (overrides.preflightError) throw overrides.preflightError;
      return overrides.catalogReceipt ?? {
        verified: true,
        meterId: "mtr_checkout_catalog_1",
        eventName: catalog.eventName,
        livemode: catalog.livemode,
        priceCount: catalog.prices.length,
      };
    },
    createCheckoutSession: async (request) => {
      order.push("provider:create");
      checkoutRequests.push(request);
      const error = overrides.checkoutErrors?.[checkoutAttempt++];
      if (error) throw error;
      return overrides.session ?? {
        sessionId: "cs_test_checkout123",
        checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test_checkout123",
        expiresAtIso: EXPIRES_AT,
      };
    },
  };
  return { order, rpcCalls, checkoutRequests, client, port };
}

test("durable checkout orders begin, exact catalog receipt, dispatch, one Stripe POST and bind", async () => {
  const h = harness();
  const result = await createDurableCheckout(input, { client: h.client, port: h.port, createCheckoutIntentId: () => INTENT_ID });
  assert.deepEqual(result, {
    status: "ready",
    checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test_checkout123",
    checkoutIntentId: INTENT_ID,
  });
  assert.deepEqual(h.order, [
    "rpc:portal_begin_billing_checkout_intent_service",
    "provider:verify",
    "rpc:portal_mark_billing_checkout_dispatched_service",
    "provider:create",
    "rpc:portal_bind_billing_checkout_session_service",
  ]);
  assert.deepEqual(h.rpcCalls[0].args, {
    p_checkout_intent_id: INTENT_ID,
    p_tenant_id: TENANT_ID,
    p_user_id: USER_ID,
    p_plan_id: "piloto",
    p_base_price_id: BASE_PRICE_ID,
    p_overage_price_id: OVERAGE_PRICE_ID,
    p_stripe_livemode: false,
    p_base_unit_amount_cents: 49_700,
    p_overage_unit_amount_cents: 3_000,
    p_meter_event_name: "axtro_conversation_overage",
    p_existing_stripe_customer_id: null,
    p_success_url: SUCCESS_URL,
    p_cancel_url: CANCEL_URL,
    p_expires_at: EXPIRES_AT,
  });
  assert.equal(h.checkoutRequests[0].idempotencyKey, IDEMPOTENCY_KEY);
  assert.equal("customerEmail" in h.checkoutRequests[0], false);
  assert.equal(h.rpcCalls.at(-1).args.p_stripe_session_id, "cs_test_checkout123");
});

test("catalog failure releases only the still-undispatched intent", async () => {
  const h = harness({ preflightError: new StripeBillingError("invalid_request", "bad catalog") });
  await assert.rejects(
    () => createDurableCheckout(input, { client: h.client, port: h.port, createCheckoutIntentId: () => INTENT_ID }),
    /bad catalog/,
  );
  assert.deepEqual(h.order, [
    "rpc:portal_begin_billing_checkout_intent_service",
    "provider:verify",
    "rpc:portal_release_billing_checkout_intent_service",
  ]);
  assert.deepEqual(h.rpcCalls.at(-1).args, { p_checkout_intent_id: INTENT_ID, p_evidence: "catalog_preflight_failed" });
});

test("transient Stripe failure retries with the exact same frozen request and idempotency key", async () => {
  const h = harness({ checkoutErrors: [new StripeBillingError("provider_timeout", "timeout")] });
  const result = await createDurableCheckout(input, { client: h.client, port: h.port, createCheckoutIntentId: () => INTENT_ID });
  assert.equal(result.status, "ready");
  assert.equal(h.checkoutRequests.length, 2);
  assert.equal(h.checkoutRequests[0], h.checkoutRequests[1]);
  assert.equal(Object.isFrozen(h.checkoutRequests[0]), true);
  assert.equal(h.checkoutRequests[0].idempotencyKey, IDEMPOTENCY_KEY);
});

test("ambiguous failure after dispatch returns pending and never releases or mints another key", async () => {
  const error = new StripeBillingError("provider_timeout", "timeout");
  const h = harness({ checkoutErrors: [error, error] });
  const result = await createDurableCheckout(input, { client: h.client, port: h.port, createCheckoutIntentId: () => INTENT_ID });
  assert.deepEqual(result, { status: "pending" });
  assert.equal(h.checkoutRequests.length, 2);
  assert.equal(h.rpcCalls.some((call) => call.name === "portal_release_billing_checkout_intent_service"), false);
  assert.equal(h.rpcCalls.filter((call) => call.name === "portal_begin_billing_checkout_intent_service").length, 1);
});

test("Stripe 429 stays pending without an immediate retry storm", async () => {
  const h = harness({ checkoutErrors: [new StripeBillingError("provider_rejected", "limited", 429, 17)] });
  const result = await createDurableCheckout(input, { client: h.client, port: h.port, createCheckoutIntentId: () => INTENT_ID });
  assert.deepEqual(result, { status: "pending" });
  assert.equal(h.checkoutRequests.length, 1);
  assert.equal(h.rpcCalls.some((call) => call.name === "portal_release_billing_checkout_intent_service"), false);
});

test("conflict and blocked_unknown never verify catalog, dispatch or create Stripe sessions", async (t) => {
  for (const [outcome, status] of [["conflict", "conflict"], ["blocked_unknown", "pending"]]) {
    await t.test(outcome, async () => {
      const h = harness({ begin: Object.fromEntries(Object.keys(begin()).map((key) => [key, key === "outcome" ? outcome : null])) });
      const result = await createDurableCheckout(input, { client: h.client, port: h.port, createCheckoutIntentId: () => INTENT_ID });
      assert.deepEqual(result, { status });
      assert.deepEqual(h.order, ["rpc:portal_begin_billing_checkout_intent_service"]);
    });
  }
});

test("replayed bound intent redirects to its durable URL without any provider call", async () => {
  const checkoutUrl = "https://checkout.stripe.com/c/pay/cs_test_replayed";
  const h = harness({ begin: {
    outcome: "replayed",
    state: "bound",
    stripeSessionId: "cs_test_replayed",
    checkoutUrl,
    expiresAt: "2026-08-13T12:20:00.000Z",
  } });
  const result = await createDurableCheckout(input, { client: h.client, port: h.port, createCheckoutIntentId: () => INTENT_ID });
  assert.deepEqual(result, { status: "ready", checkoutUrl, checkoutIntentId: INTENT_ID });
  assert.deepEqual(h.order, ["rpc:portal_begin_billing_checkout_intent_service"]);
});

test("replayed dispatched or unknown intent recovers through the same provider key/body and binds", async (t) => {
  for (const state of ["dispatched", "unknown"]) {
    await t.test(state, async () => {
      const h = harness({ begin: { outcome: "replayed", state } });
      const result = await createDurableCheckout(input, { client: h.client, port: h.port, createCheckoutIntentId: () => "0198a8b2-3c4d-7e5f-8a90-1234567890ac" });
      assert.equal(result.status, "ready");
      assert.equal(h.rpcCalls.some((call) => call.name === "portal_mark_billing_checkout_dispatched_service"), false);
      assert.equal(h.checkoutRequests[0].checkoutIntentId, INTENT_ID);
      assert.equal(h.checkoutRequests[0].idempotencyKey, IDEMPOTENCY_KEY);
      assert.equal(h.rpcCalls.at(-1).name, "portal_bind_billing_checkout_session_service");
    });
  }
});

test("catalog failure while recovering a dispatched intent stays pending and never releases", async () => {
  const h = harness({
    begin: { outcome: "replayed", state: "dispatched" },
    preflightError: new StripeBillingError("provider_unavailable", "catalog unavailable"),
  });
  const result = await createDurableCheckout(input, { client: h.client, port: h.port, createCheckoutIntentId: () => INTENT_ID });
  assert.deepEqual(result, { status: "pending" });
  assert.equal(h.rpcCalls.some((call) => call.name === "portal_release_billing_checkout_intent_service"), false);
  assert.equal(h.order.includes("provider:create"), false);
});

test("malformed or non-exact SQL receipts fail closed before Stripe", async (t) => {
  for (const receipt of [
    { ...begin(), unexpected: true },
    { ...begin(), checkoutIntentId: "not-a-uuidv7" },
    { ...begin(), stripeIdempotencyKey: null },
    { ...begin(), stripeIdempotencyKey: `checkout:${INTENT_ID}` },
  ]) {
    await t.test(JSON.stringify(receipt).slice(0, 50), async () => {
      const h = harness({ rpc: { portal_begin_billing_checkout_intent_service: { data: receipt, error: null } } });
      await assert.rejects(
        () => createDurableCheckout(input, { client: h.client, port: h.port, createCheckoutIntentId: () => INTENT_ID }),
        /receipt|snapshot/,
      );
      assert.equal(h.order.includes("provider:create"), false);
    });
  }
});

test("reserved begin receipts reject every non-reserved state before preflight or later RPCs", async (t) => {
  for (const state of ["dispatched", "bound", "completed", "expired", "released", "unknown", "conflict", null]) {
    await t.test(String(state), async () => {
      const h = harness({ begin: { state } });
      await assert.rejects(
        () => createDurableCheckout(input, { client: h.client, port: h.port, createCheckoutIntentId: () => INTENT_ID }),
        /impossible reserved receipt|snapshot/,
      );
      assert.deepEqual(h.order, ["rpc:portal_begin_billing_checkout_intent_service"]);
      assert.equal(h.checkoutRequests.length, 0);
    });
  }
});

test("dispatch receipts reject impossible acquired/state pairs before Stripe or bind", async (t) => {
  const impossible = [
    { acquired: false, state: "reserved" },
    { acquired: false, state: "dispatched" },
    ...["reserved", "bound", "completed", "expired", "released", "unknown", "conflict"]
      .map((state) => ({ acquired: true, state })),
  ];
  for (const receipt of impossible) {
    await t.test(JSON.stringify(receipt), async () => {
      const h = harness({ rpc: { portal_mark_billing_checkout_dispatched_service: { data: receipt, error: null } } });
      await assert.rejects(
        () => createDurableCheckout(input, { client: h.client, port: h.port, createCheckoutIntentId: () => INTENT_ID }),
        /dispatch returned an invalid receipt/,
      );
      assert.deepEqual(h.order, [
        "rpc:portal_begin_billing_checkout_intent_service",
        "provider:verify",
        "rpc:portal_mark_billing_checkout_dispatched_service",
      ]);
      assert.equal(h.checkoutRequests.length, 0);
      assert.equal(h.rpcCalls.some((call) => call.name === "portal_bind_billing_checkout_session_service"), false);
    });
  }
});

test("bind accepts a completed receipt after the same Stripe session completed concurrently", async () => {
  const h = harness({
    rpc: { portal_bind_billing_checkout_session_service: { data: { bound: true, state: "completed" }, error: null } },
  });
  const result = await createDurableCheckout(input, { client: h.client, port: h.port, createCheckoutIntentId: () => INTENT_ID });
  assert.equal(result.status, "ready");
  assert.equal(h.checkoutRequests.length, 1);
  assert.equal(h.rpcCalls.at(-1).name, "portal_bind_billing_checkout_session_service");
});

test("bind rejects impossible bound/state pairs without a subsequent RPC", async (t) => {
  const impossible = [
    { bound: false, state: "bound" },
    { bound: false, state: "completed" },
    ...["reserved", "dispatched", "expired", "released", "unknown", "conflict"]
      .map((state) => ({ bound: true, state })),
  ];
  for (const receipt of impossible) {
    await t.test(JSON.stringify(receipt), async () => {
      const h = harness({ rpc: { portal_bind_billing_checkout_session_service: { data: receipt, error: null } } });
      const result = await createDurableCheckout(input, { client: h.client, port: h.port, createCheckoutIntentId: () => INTENT_ID });
      assert.deepEqual(result, { status: "pending" });
      assert.equal(h.checkoutRequests.length, 1);
      assert.equal(h.rpcCalls.at(-1).name, "portal_bind_billing_checkout_session_service");
      assert.equal(h.rpcCalls.filter((call) => call.name === "portal_bind_billing_checkout_session_service").length, 1);
    });
  }
});

test("bind persistence failure stays pending after known Stripe success and never releases", async () => {
  const h = harness({ rpc: { portal_bind_billing_checkout_session_service: { data: null, error: { message: "db unavailable" } } } });
  const result = await createDurableCheckout(input, { client: h.client, port: h.port, createCheckoutIntentId: () => INTENT_ID });
  assert.deepEqual(result, { status: "pending" });
  assert.equal(h.rpcCalls.some((call) => call.name === "portal_release_billing_checkout_intent_service"), false);
});
