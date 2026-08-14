import assert from "node:assert/strict";
import { test } from "node:test";

const webhook = await import("../../apps/portal/src/lib/billing/webhook.ts");

// Vetor gerado com o mesmo algoritmo documentado (HMAC-SHA256 sobre
// "{timestamp}.{raw-body}", docs.stripe.com/webhooks/signatures) — não é
// segredo real de produção.
const TEST_SECRET = "whsec_test_stripe_secret_material_32b";
const TEST_TIMESTAMP = "1700000000";
const TEST_NOW = Number(TEST_TIMESTAMP);
const TENANT_ID = "0198a8b2-3c4d-7e5f-8a90-1234567890aa";
const CHECKOUT_INTENT_ID = "0198a8b2-3c4d-7e5f-8a90-1234567890ab";
const TEST_BODY = '{"id":"evt_test123","type":"customer.subscription.created","created":1699999000,"data":{"object":{"id":"sub_test123","customer":"cus_test123","status":"active","metadata":{"tenant_id":"0198a8b2-3c4d-7e5f-8a90-1234567890aa","plan_id":"crescimento","checkout_intent_id":"0198a8b2-3c4d-7e5f-8a90-1234567890ab"},"items":{"data":[{"price":{"id":"price_CrescimentoBase123","recurring":{"usage_type":"licensed"}},"current_period_start":1700000000,"current_period_end":1702592000},{"price":{"id":"price_CrescimentoOverage123","recurring":{"usage_type":"metered"}},"current_period_start":1700000000,"current_period_end":1702592000}]}}}}';
const TEST_SIGNATURE_HEX = "88a4d8109d539fe84b610964fea03ae64e94bfa4100c54335ac541a972135643";
const TEST_HEADER = `t=${TEST_TIMESTAMP},v1=${TEST_SIGNATURE_HEX}`;

test("assinatura válida (HMAC-SHA256, formato Stripe-Signature) é aceita", () => {
  assert.equal(webhook.verifyStripeWebhookSignature(TEST_SECRET, TEST_HEADER, TEST_BODY, TEST_NOW), true);
});

test("aceita quando a assinatura válida é uma entre várias v1 (rotação de segredo)", () => {
  const header = `t=${TEST_TIMESTAMP},v1=00000000000000000000000000000000000000000000000000000000000000,v1=${TEST_SIGNATURE_HEX}`;
  assert.equal(webhook.verifyStripeWebhookSignature(TEST_SECRET, header, TEST_BODY, TEST_NOW), true);
});

test("rejeita corpo, timestamp ou segredo adulterados", () => {
  assert.equal(webhook.verifyStripeWebhookSignature(TEST_SECRET, TEST_HEADER, TEST_BODY + "x", TEST_NOW), false);
  assert.equal(webhook.verifyStripeWebhookSignature(TEST_SECRET, `t=1700000001,v1=${TEST_SIGNATURE_HEX}`, TEST_BODY, TEST_NOW), false);
  assert.equal(webhook.verifyStripeWebhookSignature("whsec_outro_segredo_completamente_diferente", TEST_HEADER, TEST_BODY, TEST_NOW), false);
});

test("rejeita timestamp fora da janela de tolerância de 5 minutos (replay)", () => {
  assert.equal(webhook.verifyStripeWebhookSignature(TEST_SECRET, TEST_HEADER, TEST_BODY, TEST_NOW + 301), false);
  assert.equal(webhook.verifyStripeWebhookSignature(TEST_SECRET, TEST_HEADER, TEST_BODY, TEST_NOW - 301), false);
  assert.equal(webhook.verifyStripeWebhookSignature(TEST_SECRET, TEST_HEADER, TEST_BODY, TEST_NOW + 299), true);
});

test("rejeita cabeçalho ausente, sem v1, ou em formato inesperado", () => {
  assert.equal(webhook.verifyStripeWebhookSignature(TEST_SECRET, null, TEST_BODY, TEST_NOW), false);
  assert.equal(webhook.verifyStripeWebhookSignature(TEST_SECRET, "", TEST_BODY, TEST_NOW), false);
  assert.equal(webhook.verifyStripeWebhookSignature(TEST_SECRET, `t=${TEST_TIMESTAMP}`, TEST_BODY, TEST_NOW), false);
  assert.equal(webhook.verifyStripeWebhookSignature(TEST_SECRET, "garbage-no-equals", TEST_BODY, TEST_NOW), false);
  assert.equal(webhook.verifyStripeWebhookSignature("", TEST_HEADER, TEST_BODY, TEST_NOW), false);
});

test("parseStripeSubscriptionEvent extrai tenant/metadataPlanId/status/período/price id do item licensed", () => {
  const parsed = webhook.parseStripeSubscriptionEvent(JSON.parse(TEST_BODY));
  assert.deepEqual(parsed, {
    eventId: "evt_test123",
    eventType: "customer.subscription.created",
    eventCreatedIso: new Date(1699999000 * 1000).toISOString(),
    tenantId: TENANT_ID,
    checkoutIntentId: CHECKOUT_INTENT_ID,
    metadataPlanId: "crescimento",
    licensedPriceId: "price_CrescimentoBase123",
    meteredPriceId: "price_CrescimentoOverage123",
    stripeCustomerId: "cus_test123",
    stripeSubscriptionId: "sub_test123",
    status: "active",
    periodStartIso: new Date(1700000000 * 1000).toISOString(),
    periodEndIso: new Date(1702592000 * 1000).toISOString(),
  });
});

test("parser de assinatura ignora eventos pertencentes a outros parsers sem lançar", () => {
  for (const type of ["invoice.payment_failed", "checkout.session.completed", "payment_intent.succeeded"]) {
    assert.equal(webhook.parseStripeSubscriptionEvent({ id: "evt_x", type, data: { object: {} } }), null);
  }
});

test("rejeita evento de assinatura sem metadata.tenant_id/plan_id válidos (checkout que não passou o metadata certo)", () => {
  const base = JSON.parse(TEST_BODY);
  const noTenant = structuredClone(base);
  delete noTenant.data.object.metadata.tenant_id;
  assert.equal(webhook.parseStripeSubscriptionEvent(noTenant), null);

  const badPlan = structuredClone(base);
  badPlan.data.object.metadata.plan_id = "plano-que-nao-existe";
  assert.equal(webhook.parseStripeSubscriptionEvent(badPlan), null);

  const badStatus = structuredClone(base);
  badStatus.data.object.status = "not-a-real-status";
  assert.equal(webhook.parseStripeSubscriptionEvent(badStatus), null);

  const badCheckoutIntent = structuredClone(base);
  badCheckoutIntent.data.object.metadata.checkout_intent_id = "not-a-uuidv7";
  assert.equal(webhook.parseStripeSubscriptionEvent(badCheckoutIntent), null);
});

test("payload malformado (não-objeto, sem data.object ou par de items) nunca lança e falha fechado", () => {
  assert.equal(webhook.parseStripeSubscriptionEvent(null), null);
  assert.equal(webhook.parseStripeSubscriptionEvent("string"), null);
  assert.equal(webhook.parseStripeSubscriptionEvent({ id: "evt_1", type: "customer.subscription.updated" }), null);

  const noItems = JSON.parse(TEST_BODY);
  delete noItems.data.object.items;
  assert.equal(webhook.parseStripeSubscriptionEvent(noItems), null);

  const missingCreated = JSON.parse(TEST_BODY);
  delete missingCreated.created;
  assert.equal(webhook.parseStripeSubscriptionEvent(missingCreated), null);
});

test("o catálogo exige exatamente um item licensed e um metered, sem extras ou pares ambíguos", () => {
  const noLicensed = JSON.parse(TEST_BODY);
  noLicensed.data.object.items.data[0].price.recurring.usage_type = "metered";
  assert.equal(webhook.parseStripeSubscriptionEvent(noLicensed), null);

  const noMetered = JSON.parse(TEST_BODY);
  noMetered.data.object.items.data.pop();
  assert.equal(webhook.parseStripeSubscriptionEvent(noMetered), null);

  const duplicateLicensed = JSON.parse(TEST_BODY);
  duplicateLicensed.data.object.items.data[1].price.recurring.usage_type = "licensed";
  assert.equal(webhook.parseStripeSubscriptionEvent(duplicateLicensed), null);

  const extraRecurring = JSON.parse(TEST_BODY);
  extraRecurring.data.object.items.data.push(structuredClone(extraRecurring.data.object.items.data[1]));
  assert.equal(webhook.parseStripeSubscriptionEvent(extraRecurring), null);

  const malformedPrice = JSON.parse(TEST_BODY);
  malformedPrice.data.object.items.data[1].price.id = "price_hostile_suffix";
  assert.equal(webhook.parseStripeSubscriptionEvent(malformedPrice), null);
});

test("customer.subscription.deleted (status=canceled) é tratado igual aos outros dois eventos", () => {
  const deleted = JSON.parse(TEST_BODY);
  deleted.type = "customer.subscription.deleted";
  deleted.data.object.status = "canceled";
  const parsed = webhook.parseStripeSubscriptionEvent(deleted);
  assert.equal(parsed.eventType, "customer.subscription.deleted");
  assert.equal(parsed.status, "canceled");
});

// D-V2-105: route.ts usa isHandledStripeSubscriptionEventType pra distinguir
// "tipo fora de escopo" (silêncio esperado) de "tipo tratado mas payload
// malformado" (deveria emitir telemetria — achado da auditoria 2026-08-06).
test("isHandledStripeSubscriptionEventType reconhece só os 3 eventos de ciclo de vida de assinatura", () => {
  assert.equal(webhook.isHandledStripeSubscriptionEventType("customer.subscription.created"), true);
  assert.equal(webhook.isHandledStripeSubscriptionEventType("customer.subscription.updated"), true);
  assert.equal(webhook.isHandledStripeSubscriptionEventType("customer.subscription.deleted"), true);
  assert.equal(webhook.isHandledStripeSubscriptionEventType("invoice.paid"), false);
  assert.equal(webhook.isHandledStripeSubscriptionEventType("checkout.session.completed"), false);
  assert.equal(webhook.isHandledStripeSubscriptionEventType(undefined), false);
  assert.equal(webhook.isHandledStripeSubscriptionEventType(null), false);
  assert.equal(webhook.isHandledStripeSubscriptionEventType(123), false);
});

test("evento do tipo certo mas sem tenant_id/plan_id válidos: tipo é reconhecido como 'tratado' mesmo com parse falhando", () => {
  const orphan = JSON.parse(TEST_BODY);
  delete orphan.data.object.metadata.tenant_id;
  assert.equal(webhook.parseStripeSubscriptionEvent(orphan), null, "parse deve falhar sem tenant_id");
  assert.equal(webhook.isHandledStripeSubscriptionEventType(orphan.type), true, "mas o TIPO segue sendo um dos 3 tratados — route.ts deve logar isso, não silenciar");
});

function checkoutEvent(type = "checkout.session.completed", overrides = {}) {
  return {
    id: "evt_checkout123",
    type,
    created: 1700000000,
    data: {
      object: {
        id: "cs_test_checkout123",
        client_reference_id: CHECKOUT_INTENT_ID,
        customer: "cus_test123",
        subscription: "sub_test123",
        payment_status: "paid",
        metadata: {
          checkout_intent_id: CHECKOUT_INTENT_ID,
          tenant_id: TENANT_ID,
          plan_id: "crescimento",
        },
        ...overrides,
      },
    },
  };
}

test("parseStripeCheckoutEvent aceita os quatro eventos fechados e preserva correlação durável", () => {
  for (const type of [
    "checkout.session.completed",
    "checkout.session.expired",
    "checkout.session.async_payment_succeeded",
    "checkout.session.async_payment_failed",
  ]) {
    const parsed = webhook.parseStripeCheckoutEvent(checkoutEvent(type));
    assert.deepEqual(parsed, {
      eventId: "evt_checkout123",
      eventType: type,
      eventCreatedIso: new Date(1700000000 * 1000).toISOString(),
      checkoutIntentId: CHECKOUT_INTENT_ID,
      stripeSessionId: "cs_test_checkout123",
      tenantId: TENANT_ID,
      planId: "crescimento",
      stripeCustomerId: "cus_test123",
      stripeSubscriptionId: "sub_test123",
      paymentStatus: "paid",
    });
    assert.equal(webhook.isHandledStripeCheckoutEventType(type), true);
  }
});

test("checkout assinado falha fechado em metadata, client_reference_id, IDs ou payment status inconsistentes", () => {
  const cases = [
    checkoutEvent("checkout.session.completed", { client_reference_id: TENANT_ID }),
    checkoutEvent("checkout.session.completed", { id: "session_wrong" }),
    checkoutEvent("checkout.session.completed", { customer: "customer_wrong" }),
    checkoutEvent("checkout.session.completed", { subscription: "subscription_wrong" }),
    checkoutEvent("checkout.session.completed", { payment_status: "unknown" }),
    checkoutEvent("checkout.session.completed", { metadata: { checkout_intent_id: CHECKOUT_INTENT_ID, tenant_id: "tenant_wrong", plan_id: "crescimento" } }),
  ];
  for (const event of cases) assert.equal(webhook.parseStripeCheckoutEvent(event), null);
});

test("checkout permite customer/subscription/payment_status nulos no evento expired", () => {
  const parsed = webhook.parseStripeCheckoutEvent(checkoutEvent("checkout.session.expired", {
    customer: null,
    subscription: null,
    payment_status: null,
  }));
  assert.equal(parsed.stripeCustomerId, null);
  assert.equal(parsed.stripeSubscriptionId, null);
  assert.equal(parsed.paymentStatus, null);
});
