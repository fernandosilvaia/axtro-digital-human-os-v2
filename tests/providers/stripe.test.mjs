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

function fakeFetch(handler) {
  const calls = [];
  return { calls, implementation: async (url, init) => { calls.push({ url, init }); return handler(url, init); } };
}

function parseFormBody(body) {
  return Object.fromEntries(new URLSearchParams(body).entries());
}

test("createCheckoutSession envia payload form-encoded fechado e devolve sessionId/checkoutUrl", async () => {
  const { calls, implementation } = fakeFetch(async () =>
    new Response(JSON.stringify({ id: "cs_test_123", url: "https://checkout.stripe.com/c/pay/cs_test_123" }), { status: 200 }));
  const port = provider.createStripeBillingPort({ apiKey: API_KEY, fetchImplementation: implementation });

  const result = await port.createCheckoutSession({
    tenantId: "tenant-abc",
    planId: "crescimento",
    basePriceId: BASE_PRICE_ID,
    overagePriceId: OVERAGE_PRICE_ID,
    customerEmail: "dono@empresa.com",
    successUrl: "https://closer.axtroai.com/configuracoes?checkout=ok",
    cancelUrl: "https://closer.axtroai.com/configuracoes?checkout=cancel",
    idempotencyKey: "checkout:tenant-abc:crescimento:12345",
  });

  assert.deepEqual(result, { sessionId: "cs_test_123", checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test_123" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.stripe.com/v1/checkout/sessions");
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${API_KEY}`);
  assert.equal(calls[0].init.headers["Content-Type"], "application/x-www-form-urlencoded");
  assert.ok(calls[0].init.headers["Stripe-Version"]);
  assert.equal(calls[0].init.headers["Idempotency-Key"], "checkout:tenant-abc:crescimento:12345", "duplo clique/duas abas não podem criar duas assinaturas — achado da auditoria 2026-08-06");

  const body = parseFormBody(calls[0].init.body);
  assert.equal(body.mode, "subscription");
  assert.equal(body.client_reference_id, "tenant-abc");
  assert.equal(body.customer_email, "dono@empresa.com");
  assert.equal(body["line_items[0][price]"], BASE_PRICE_ID);
  assert.equal(body["line_items[0][quantity]"], "1");
  assert.equal(body["line_items[1][price]"], OVERAGE_PRICE_ID);
  assert.equal(body["line_items[1][quantity]"], undefined, "metered line item não deve carregar quantity");
  assert.equal(body["subscription_data[metadata][tenant_id]"], "tenant-abc");
  assert.equal(body["subscription_data[metadata][plan_id]"], "crescimento");
  assert.equal(body.success_url, "https://closer.axtroai.com/configuracoes?checkout=ok");
});

test("createCheckoutSession reaproveita existingStripeCustomerId em vez de customer_email (troca de plano)", async () => {
  const { calls, implementation } = fakeFetch(async () => new Response(JSON.stringify({ id: "cs_2", url: "https://checkout.stripe.com/c/pay/cs_2" }), { status: 200 }));
  const port = provider.createStripeBillingPort({ apiKey: API_KEY, fetchImplementation: implementation });
  await port.createCheckoutSession({
    tenantId: "tenant-abc",
    planId: "escala",
    basePriceId: BASE_PRICE_ID,
    overagePriceId: OVERAGE_PRICE_ID,
    existingStripeCustomerId: CUSTOMER_ID,
    customerEmail: "ignored@example.com",
    successUrl: "https://closer.axtroai.com/ok",
    cancelUrl: "https://closer.axtroai.com/cancel",
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
    tenantId: "t1", planId: "piloto", basePriceId: BASE_PRICE_ID, overagePriceId: OVERAGE_PRICE_ID,
    successUrl: "https://a.com/ok", cancelUrl: "https://a.com/cancel", idempotencyKey: "checkout:t1:piloto:1",
  };
  for (const bad of [
    { ...base, basePriceId: "not-a-price-id" },
    { ...base, overagePriceId: "prod_wrong_prefix" },
    { ...base, successUrl: "http://not-https.com" },
    { ...base, cancelUrl: "" },
    { ...base, tenantId: "" },
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
      successUrl: "https://a.com/ok", cancelUrl: "https://a.com/cancel",
    }),
    (e) => e.code === "invalid_request" && e.message.includes("idempotencyKey"),
  );
  assert.equal(calls.length, 0);
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
});

test("reportOverageUsage manda meter_events com Idempotency-Key e payload fechado", async () => {
  const { calls, implementation } = fakeFetch(async () => new Response(JSON.stringify({ id: "me_1" }), { status: 200 }));
  const port = provider.createStripeBillingPort({ apiKey: API_KEY, fetchImplementation: implementation });
  await port.reportOverageUsage({
    stripeCustomerId: CUSTOMER_ID,
    eventName: "axtro_conversation_overage",
    quantity: 1,
    idempotencyKey: "overage:tenant-abc:cost-event-uuid",
  });
  assert.equal(calls[0].url, "https://api.stripe.com/v1/billing/meter_events");
  assert.equal(calls[0].init.headers["Idempotency-Key"], "overage:tenant-abc:cost-event-uuid");
  const body = parseFormBody(calls[0].init.body);
  assert.equal(body.event_name, "axtro_conversation_overage");
  assert.equal(body["payload[stripe_customer_id]"], CUSTOMER_ID);
  assert.equal(body["payload[value]"], "1");
});

test("reportOverageUsage rejeita quantity não-positiva/fracionária e exige idempotencyKey", async () => {
  const { calls, implementation } = fakeFetch(async () => new Response("{}", { status: 200 }));
  const port = provider.createStripeBillingPort({ apiKey: API_KEY, fetchImplementation: implementation });
  for (const bad of [
    { stripeCustomerId: CUSTOMER_ID, eventName: "x", quantity: 0, idempotencyKey: "k" },
    { stripeCustomerId: CUSTOMER_ID, eventName: "x", quantity: -1, idempotencyKey: "k" },
    { stripeCustomerId: CUSTOMER_ID, eventName: "x", quantity: 1.5, idempotencyKey: "k" },
    { stripeCustomerId: CUSTOMER_ID, eventName: "x", quantity: 1, idempotencyKey: "" },
  ]) {
    await assert.rejects(() => port.reportOverageUsage(bad), (e) => e.code === "invalid_request");
  }
  assert.equal(calls.length, 0);
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

test("timeout aborta e nunca vaza a chave no erro", async () => {
  const slow = fakeFetch(() => new Promise((_, reject) => {
    setTimeout(() => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), 5);
  }));
  const port = provider.createStripeBillingPort({ apiKey: API_KEY, timeoutMs: 1, fetchImplementation: slow.implementation });
  await assert.rejects(
    () => port.createPortalSession({ stripeCustomerId: CUSTOMER_ID, returnUrl: "https://a.com" }),
    (e) => {
      assert.equal(e.code, "provider_timeout");
      assert.equal(e.message.includes(API_KEY), false);
      return true;
    },
  );
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
