import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import test from "node:test";

const root = fileURLToPath(new URL("../..", import.meta.url));
const provider = await import(pathToFileURL(join(root, "packages/provider-stripe/dist/index.js")).href);

const API_KEY = "sk_test_0000000000000000000000000000";
const CUSTOMER_ID = "cus_T3st0000000000";
const BASE_PRICE_ID = "price_1BaseTest000000";
const OVERAGE_PRICE_ID = "price_1OverageTest0000";
const CHECKOUT_INTENT_ID = "0198a8b2-3c4d-7e5f-8a90-1234567890ab";
const EXPIRES_AT_ISO = "2026-08-13T12:30:00.000Z";
const EXPIRES_AT_SECONDS = Date.parse(EXPIRES_AT_ISO) / 1000;

function fakeFetch(handler) {
  const calls = [];
  return { calls, implementation: async (url, init) => { calls.push({ url, init }); return handler(url, init); } };
}

function parseFormBody(body) {
  return Object.fromEntries(new URLSearchParams(body).entries());
}

test("createCheckoutSession envia payload form-encoded fechado e devolve sessionId/checkoutUrl", async () => {
  const { calls, implementation } = fakeFetch(async () =>
    new Response(JSON.stringify({ id: "cs_test_123", url: "https://checkout.stripe.com/c/pay/cs_test_123", expires_at: EXPIRES_AT_SECONDS }), { status: 200 }));
  const port = provider.createStripeBillingPort({ apiKey: API_KEY, fetchImplementation: implementation });

  const result = await port.createCheckoutSession({
    checkoutIntentId: CHECKOUT_INTENT_ID,
    tenantId: "tenant-abc",
    planId: "crescimento",
    basePriceId: BASE_PRICE_ID,
    overagePriceId: OVERAGE_PRICE_ID,
    successUrl: "https://closer.axtroai.com/configuracoes?checkout=ok",
    cancelUrl: "https://closer.axtroai.com/configuracoes?checkout=cancel",
    expiresAtIso: EXPIRES_AT_ISO,
    idempotencyKey: "checkout:tenant-abc:crescimento:12345",
  });

  assert.deepEqual(result, { sessionId: "cs_test_123", checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test_123", expiresAtIso: EXPIRES_AT_ISO });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.stripe.com/v1/checkout/sessions");
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${API_KEY}`);
  assert.equal(calls[0].init.headers["Content-Type"], "application/x-www-form-urlencoded");
  assert.ok(calls[0].init.headers["Stripe-Version"]);
  assert.equal(calls[0].init.headers["Idempotency-Key"], "checkout:tenant-abc:crescimento:12345", "duplo clique/duas abas não podem criar duas assinaturas — achado da auditoria 2026-08-06");

  const body = parseFormBody(calls[0].init.body);
  assert.equal(body.mode, "subscription");
  assert.equal(body.client_reference_id, CHECKOUT_INTENT_ID);
  assert.equal(body.customer_email, undefined);
  assert.equal(body.expires_at, String(EXPIRES_AT_SECONDS));
  assert.equal(body["metadata[checkout_intent_id]"], CHECKOUT_INTENT_ID);
  assert.equal(body["metadata[tenant_id]"], "tenant-abc");
  assert.equal(body["metadata[plan_id]"], "crescimento");
  assert.equal(body["line_items[0][price]"], BASE_PRICE_ID);
  assert.equal(body["line_items[0][quantity]"], "1");
  assert.equal(body["line_items[1][price]"], OVERAGE_PRICE_ID);
  assert.equal(body["line_items[1][quantity]"], undefined, "metered line item não deve carregar quantity");
  assert.equal(body["subscription_data[metadata][tenant_id]"], "tenant-abc");
  assert.equal(body["subscription_data[metadata][plan_id]"], "crescimento");
  assert.equal(body["subscription_data[metadata][checkout_intent_id]"], CHECKOUT_INTENT_ID);
  assert.equal(body.success_url, "https://closer.axtroai.com/configuracoes?checkout=ok");
});

test("createCheckoutSession reaproveita existingStripeCustomerId sem enviar customer_email", async () => {
  const { calls, implementation } = fakeFetch(async () => new Response(JSON.stringify({ id: "cs_test_2", url: "https://checkout.stripe.com/c/pay/cs_test_2", expires_at: EXPIRES_AT_SECONDS }), { status: 200 }));
  const port = provider.createStripeBillingPort({ apiKey: API_KEY, fetchImplementation: implementation });
  await port.createCheckoutSession({
    checkoutIntentId: CHECKOUT_INTENT_ID,
    tenantId: "tenant-abc",
    planId: "escala",
    basePriceId: BASE_PRICE_ID,
    overagePriceId: OVERAGE_PRICE_ID,
    existingStripeCustomerId: CUSTOMER_ID,
    successUrl: "https://closer.axtroai.com/ok",
    cancelUrl: "https://closer.axtroai.com/cancel",
    expiresAtIso: EXPIRES_AT_ISO,
    idempotencyKey: "checkout:tenant-abc:escala:12345",
  });
  const body = parseFormBody(calls[0].init.body);
  assert.equal(body.customer, CUSTOMER_ID);
  assert.equal(body.customer_email, undefined, "não deve mandar customer_email quando já existe customer");
});

test("createCheckoutSession valida price ids, urls e customer id antes da rede", async () => {
  const { calls, implementation } = fakeFetch(async () => new Response("{}", { status: 200 }));
  const port = provider.createStripeBillingPort({ apiKey: API_KEY, fetchImplementation: implementation });
  const base = {
    checkoutIntentId: CHECKOUT_INTENT_ID,
    tenantId: "t1", planId: "piloto", basePriceId: BASE_PRICE_ID, overagePriceId: OVERAGE_PRICE_ID,
    successUrl: "https://a.com/ok", cancelUrl: "https://a.com/cancel", expiresAtIso: EXPIRES_AT_ISO, idempotencyKey: "checkout:t1:piloto:1",
  };
  for (const bad of [
    { ...base, basePriceId: "not-a-price-id" },
    { ...base, overagePriceId: "prod_wrong_prefix" },
    { ...base, successUrl: "http://not-https.com" },
    { ...base, cancelUrl: "" },
    { ...base, tenantId: "" },
    { ...base, checkoutIntentId: "not-a-uuidv7" },
    { ...base, expiresAtIso: "2026-08-13T12:30:00.123Z" },
    { ...base, existingStripeCustomerId: "not-a-customer-id" },
    { ...base, idempotencyKey: "" },
  ]) {
    await assert.rejects(() => port.createCheckoutSession(bad), (e) => e.code === "invalid_request");
  }
  assert.equal(calls.length, 0);
});

test("createCheckoutSession sem idempotencyKey é rejeitado antes da rede — duplo clique/duas abas não podem gerar duas assinaturas", async () => {
  const { calls, implementation } = fakeFetch(async () => new Response("{}", { status: 200 }));
  const port = provider.createStripeBillingPort({ apiKey: API_KEY, fetchImplementation: implementation });
  await assert.rejects(
    () => port.createCheckoutSession({
      tenantId: "t1", planId: "piloto", basePriceId: BASE_PRICE_ID, overagePriceId: OVERAGE_PRICE_ID,
      checkoutIntentId: CHECKOUT_INTENT_ID, successUrl: "https://a.com/ok", cancelUrl: "https://a.com/cancel", expiresAtIso: EXPIRES_AT_ISO,
    }),
    (e) => e.code === "invalid_request" && e.message.includes("idempotencyKey"),
  );
  assert.equal(calls.length, 0);
});

test("createCheckoutSession rejeita id, host/path e expires_at divergentes no receipt Stripe", async (t) => {
  for (const payload of [
    { id: "session_wrong", url: "https://checkout.stripe.com/c/pay/session_wrong", expires_at: EXPIRES_AT_SECONDS },
    { id: "cs_test_123", url: "https://evil.example/c/pay/cs_test_123", expires_at: EXPIRES_AT_SECONDS },
    { id: "cs_test_123", url: "https://checkout.stripe.com/c/pay/cs_test_other", expires_at: EXPIRES_AT_SECONDS },
    { id: "cs_test_123", url: "https://checkout.stripe.com/c/pay/cs_test_123", expires_at: EXPIRES_AT_SECONDS + 1 },
  ]) {
    await t.test(JSON.stringify(payload), async () => {
      const { implementation } = fakeFetch(async () => new Response(JSON.stringify(payload), { status: 200 }));
      const port = provider.createStripeBillingPort({ apiKey: API_KEY, fetchImplementation: implementation });
      await assert.rejects(
        () => port.createCheckoutSession({
          checkoutIntentId: CHECKOUT_INTENT_ID,
          tenantId: "tenant-abc",
          planId: "piloto",
          basePriceId: BASE_PRICE_ID,
          overagePriceId: OVERAGE_PRICE_ID,
          successUrl: "https://closer.axtroai.com/ok",
          cancelUrl: "https://closer.axtroai.com/cancel",
          expiresAtIso: EXPIRES_AT_ISO,
          idempotencyKey: `checkout:${CHECKOUT_INTENT_ID}`,
        }),
        (error) => error.code === "malformed_provider_response",
      );
    });
  }
});

test("createPortalSession valida customerId/returnUrl e devolve a portalUrl", async () => {
  const { calls, implementation } = fakeFetch(async () => new Response(JSON.stringify({ url: "https://billing.stripe.com/p/session/abc" }), { status: 200 }));
  const port = provider.createStripeBillingPort({ apiKey: API_KEY, fetchImplementation: implementation });
  const result = await port.createPortalSession({ stripeCustomerId: CUSTOMER_ID, returnUrl: "https://closer.axtroai.com/configuracoes" });
  assert.deepEqual(result, { portalUrl: "https://billing.stripe.com/p/session/abc" });
  const body = parseFormBody(calls[0].init.body);
  assert.equal(body.customer, CUSTOMER_ID);
  assert.equal(body.return_url, "https://closer.axtroai.com/configuracoes");

  await assert.rejects(
    () => port.createPortalSession({ stripeCustomerId: "bad", returnUrl: "https://a.com" }),
    (e) => e.code === "invalid_request",
  );

  for (const hostileUrl of [
    "javascript:alert(1)",
    "https://evil.example/p/session/abc",
    "https://billing.stripe.com.evil.example/p/session/abc",
    "https://user@billing.stripe.com/p/session/abc",
    "https://billing.stripe.com:444/p/session/abc",
    "https://billing.stripe.com/not-a-session/abc",
    "https://billing.stripe.com/p/session/abc#leak",
  ]) {
    const hostile = fakeFetch(async () => new Response(JSON.stringify({ url: hostileUrl }), { status: 200 }));
    const hostilePort = provider.createStripeBillingPort({ apiKey: API_KEY, fetchImplementation: hostile.implementation });
    await assert.rejects(
      () => hostilePort.createPortalSession({ stripeCustomerId: CUSTOMER_ID, returnUrl: "https://a.com" }),
      (error) => error.code === "malformed_provider_response",
      hostileUrl,
    );
  }
});

test("Stripe success responses are bounded for declared and chunked bodies", async () => {
  const declared = fakeFetch(async () => new Response("{}", {
    status: 200,
    headers: { "content-length": String(256 * 1024 + 1) },
  }));
  const declaredPort = provider.createStripeBillingPort({ apiKey: API_KEY, fetchImplementation: declared.implementation });
  await assert.rejects(
    () => declaredPort.createPortalSession({ stripeCustomerId: CUSTOMER_ID, returnUrl: "https://a.com" }),
    (error) => error.code === "malformed_provider_response",
  );

  const chunked = fakeFetch(async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(200 * 1024));
      controller.enqueue(new Uint8Array(60 * 1024));
      controller.close();
    },
  }), { status: 200 }));
  const chunkedPort = provider.createStripeBillingPort({ apiKey: API_KEY, fetchImplementation: chunked.implementation });
  await assert.rejects(
    () => chunkedPort.createPortalSession({ stripeCustomerId: CUSTOMER_ID, returnUrl: "https://a.com" }),
    (error) => error.code === "malformed_provider_response",
  );
});

test("reportOverageUsage manda meter_events com Idempotency-Key e payload fechado", async () => {
  const { calls, implementation } = fakeFetch(async () => new Response(JSON.stringify({ id: "me_1" }), { status: 200 }));
  const port = provider.createStripeBillingPort({ apiKey: API_KEY, fetchImplementation: implementation });
  await port.reportOverageUsage({
    stripeCustomerId: CUSTOMER_ID,
    eventName: "axtro_conversation_overage",
    quantity: 1,
    idempotencyKey: "overage:tenant-abc:cost-event-uuid",
    eventTimestamp: "2026-08-13T12:00:00.000Z",
  });
  assert.equal(calls[0].url, "https://api.stripe.com/v1/billing/meter_events");
  assert.equal(calls[0].init.headers["Idempotency-Key"], "overage:tenant-abc:cost-event-uuid");
  const body = parseFormBody(calls[0].init.body);
  assert.equal(body.event_name, "axtro_conversation_overage");
  assert.equal(body["payload[stripe_customer_id]"], CUSTOMER_ID);
  assert.equal(body["payload[value]"], "1");
  assert.equal(body.timestamp, "1786622400", "o instante real da unidade deve chegar ao Meter sem usar o relógio do retry");
});

test("reportOverageUsage rejeita quantity não-positiva/fracionária e exige idempotencyKey", async () => {
  const { calls, implementation } = fakeFetch(async () => new Response("{}", { status: 200 }));
  const port = provider.createStripeBillingPort({ apiKey: API_KEY, fetchImplementation: implementation });
  for (const bad of [
    { stripeCustomerId: CUSTOMER_ID, eventName: "x", quantity: 0, idempotencyKey: "k" },
    { stripeCustomerId: CUSTOMER_ID, eventName: "x", quantity: -1, idempotencyKey: "k" },
    { stripeCustomerId: CUSTOMER_ID, eventName: "x", quantity: 1.5, idempotencyKey: "k" },
    { stripeCustomerId: CUSTOMER_ID, eventName: "x", quantity: 1, idempotencyKey: "" },
    { stripeCustomerId: CUSTOMER_ID, eventName: "x", quantity: 1, idempotencyKey: "k", eventTimestamp: "not-an-instant" },
  ]) {
    await assert.rejects(() => port.reportOverageUsage(bad), (e) => e.code === "invalid_request");
  }
  assert.equal(calls.length, 0);
});

test("billing catalog preflight verifies exact prices, mode and the shared active meter", async () => {
  const LICENSED = "price_1LicensedCatalog";
  const METERED = "price_1MeteredCatalog0";
  const METER = "mtr_test_catalog_1";
  const { calls, implementation } = fakeFetch(async (url) => {
    if (url.endsWith(`/prices/${LICENSED}`)) {
      return new Response(JSON.stringify({
        id: LICENSED, object: "price", active: true, currency: "usd", livemode: false,
        type: "recurring", billing_scheme: "per_unit", unit_amount: 49_700,
        recurring: { interval: "month", interval_count: 1, usage_type: "licensed", meter: null },
      }), { status: 200 });
    }
    if (url.endsWith(`/prices/${METERED}`)) {
      return new Response(JSON.stringify({
        id: METERED, object: "price", active: true, currency: "usd", livemode: false,
        type: "recurring", billing_scheme: "per_unit", unit_amount: 3_000,
        recurring: { interval: "month", interval_count: 1, usage_type: "metered", meter: METER },
      }), { status: 200 });
    }
    if (url.endsWith(`/billing/meters/${METER}`)) {
      return new Response(JSON.stringify({
        id: METER, object: "billing.meter", status: "active", event_name: "axtro_conversation_overage", livemode: false,
        default_aggregation: { formula: "sum" },
        customer_mapping: { type: "by_id", event_payload_key: "stripe_customer_id" },
        value_settings: { event_payload_key: "value" },
      }), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  });
  const port = provider.createStripeBillingPort({ apiKey: API_KEY, fetchImplementation: implementation });
  const receipt = await port.verifyBillingCatalog({
    eventName: "axtro_conversation_overage",
    livemode: false,
    prices: [
      { priceId: LICENSED, unitAmountUsdCents: 49_700, usageType: "licensed" },
      { priceId: METERED, unitAmountUsdCents: 3_000, usageType: "metered" },
    ],
  });
  assert.deepEqual(receipt, {
    verified: true,
    meterId: METER,
    eventName: "axtro_conversation_overage",
    livemode: false,
    priceCount: 2,
  });
  assert.equal(calls.length, 3);
  for (const call of calls) {
    assert.equal(call.init.method, "GET");
    assert.equal(call.init.body, undefined);
    assert.equal(call.init.headers["Content-Type"], undefined);
  }
});

test("billing catalog preflight rejects an old syntactically valid overage price", async () => {
  const PRICE = "price_1OldOverage000";
  const { implementation } = fakeFetch(async () => new Response(JSON.stringify({
    id: PRICE, object: "price", active: true, currency: "usd", livemode: false,
    type: "recurring", billing_scheme: "per_unit", unit_amount: 1_000,
    recurring: { interval: "month", interval_count: 1, usage_type: "metered", meter: "mtr_old" },
  }), { status: 200 }));
  const port = provider.createStripeBillingPort({ apiKey: API_KEY, fetchImplementation: implementation });
  await assert.rejects(
    () => port.verifyBillingCatalog({
      eventName: "axtro_conversation_overage",
      livemode: false,
      prices: [{ priceId: PRICE, unitAmountUsdCents: 3_000, usageType: "metered" }],
    }),
    (error) => error.code === "invalid_request" && /versioned catalog/.test(error.message),
  );
});

test("5xx vira provider_unavailable; payload sem id/url vira malformed; chave curta não constrói o port", async () => {
  const down = fakeFetch(async () => new Response("x", { status: 503 }));
  const portDown = provider.createStripeBillingPort({ apiKey: API_KEY, fetchImplementation: down.implementation });
  await assert.rejects(
    () => portDown.createPortalSession({ stripeCustomerId: CUSTOMER_ID, returnUrl: "https://a.com" }),
    (e) => e.code === "provider_unavailable",
  );

  const junk = fakeFetch(async () => new Response(JSON.stringify({ status: "ok" }), { status: 200 }));
  const portJunk = provider.createStripeBillingPort({ apiKey: API_KEY, fetchImplementation: junk.implementation });
  await assert.rejects(
    () => portJunk.createPortalSession({ stripeCustomerId: CUSTOMER_ID, returnUrl: "https://a.com" }),
    (e) => e.code === "malformed_provider_response",
  );

  assert.throws(() => provider.createStripeBillingPort({ apiKey: "" }), (e) => e.code === "missing_api_key");
});

test("Stripe preserva status HTTP e Retry-After sem vazar o corpo do provider", async () => {
  const limited = fakeFetch(async () => new Response("segredo-ecoado", {
    status: 429,
    headers: { "retry-after": "17" },
  }));
  const port = provider.createStripeBillingPort({ apiKey: API_KEY, fetchImplementation: limited.implementation });
  await assert.rejects(
    () => port.reportOverageUsage({
      stripeCustomerId: CUSTOMER_ID,
      eventName: "axtro_conversation_overage",
      quantity: 1,
      idempotencyKey: "overage:retry-after",
    }),
    (error) => {
      assert.equal(error.code, "provider_rejected");
      assert.equal(error.httpStatus, 429);
      assert.equal(error.retryAfterSeconds, 17);
      assert.equal(error.message.includes("segredo-ecoado"), false);
      return true;
    },
  );
});

test("timeout aborta e nunca vaza a chave no erro", async () => {
  let abortObserved = false;
  const slow = fakeFetch((_url, init) => new Promise((_, reject) => {
    const rejectOnAbort = () => {
      abortObserved = true;
      reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
    };
    if (init.signal.aborted) {
      rejectOnAbort();
      return;
    }
    init.signal.addEventListener("abort", rejectOnAbort, { once: true });
  }));
  const port = provider.createStripeBillingPort({ apiKey: API_KEY, timeoutMs: 5, fetchImplementation: slow.implementation });
  await assert.rejects(
    () => port.createPortalSession({ stripeCustomerId: CUSTOMER_ID, returnUrl: "https://a.com" }),
    (e) => {
      assert.equal(e.code, "provider_timeout");
      assert.equal(e.message.includes(API_KEY), false);
      return true;
    },
  );
  assert.equal(abortObserved, true, "o timeout do adapter deve abortar o fetch pendente");
  assert.equal(slow.calls.length, 1);
  assert.equal(slow.calls[0].init.signal.aborted, true);
});

// Achado P1 da auditoria 2026-08-11: clearTimeout rodava assim que os
// headers chegavam, ANTES da leitura do corpo — um corpo travado depois de
// um 200 (checkout/portal/overage) nunca era interrompido pelo timeout.
test("corpo travado depois dos headers (200) ainda respeita o timeout", async () => {
  const stallingFetch = async (_url, init) => ({
    ok: true,
    status: 200,
    text: () => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    }),
  });
  const port = provider.createStripeBillingPort({ apiKey: API_KEY, timeoutMs: 5, fetchImplementation: stallingFetch });
  await assert.rejects(
    () => port.createPortalSession({ stripeCustomerId: CUSTOMER_ID, returnUrl: "https://a.com" }),
    (e) => e.code === "provider_timeout",
  );
});
