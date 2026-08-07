import assert from "node:assert/strict";
import { test } from "node:test";

const webhook = await import("../../apps/portal/src/lib/billing/webhook.ts");

// Vetor gerado com o mesmo algoritmo documentado (HMAC-SHA256 sobre
// "{timestamp}.{raw-body}", docs.stripe.com/webhooks/signatures) — não é
// segredo real de produção.
const TEST_SECRET = "whsec_test_stripe_secret_material_32b";
const TEST_TIMESTAMP = "1700000000";
const TEST_NOW = Number(TEST_TIMESTAMP);
const TEST_BODY = '{"id":"evt_test123","type":"customer.subscription.created","created":1699999000,"data":{"object":{"id":"sub_test123","customer":"cus_test123","status":"active","metadata":{"tenant_id":"tenant-abc","plan_id":"crescimento"},"items":{"data":[{"price":{"id":"price_crescimento_base_123","recurring":{"usage_type":"licensed"}},"current_period_start":1700000000,"current_period_end":1702592000}]}}}}';
const TEST_SIGNATURE_HEX = "56ec48dc5b82dcaf4fa4f00faf9f8863fc90f3d81995a8fd6f1d95d6625efacc";
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
    tenantId: "tenant-abc",
    metadataPlanId: "crescimento",
    licensedPriceId: "price_crescimento_base_123",
    stripeCustomerId: "cus_test123",
    stripeSubscriptionId: "sub_test123",
    status: "active",
    periodStartIso: new Date(1700000000 * 1000).toISOString(),
    periodEndIso: new Date(1702592000 * 1000).toISOString(),
  });
});

test("ignora eventos fora do escopo mapeado (invoice.*, checkout.session.completed) sem lançar", () => {
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
});

test("payload malformado (não-objeto, sem data.object, items ausente) nunca lança — devolve null ou período/price nulos", () => {
  assert.equal(webhook.parseStripeSubscriptionEvent(null), null);
  assert.equal(webhook.parseStripeSubscriptionEvent("string"), null);
  assert.equal(webhook.parseStripeSubscriptionEvent({ id: "evt_1", type: "customer.subscription.updated" }), null);

  const noItems = JSON.parse(TEST_BODY);
  delete noItems.data.object.items;
  const parsed = webhook.parseStripeSubscriptionEvent(noItems);
  assert.equal(parsed.periodStartIso, null);
  assert.equal(parsed.periodEndIso, null);
  assert.equal(parsed.licensedPriceId, null);

  const missingCreated = JSON.parse(TEST_BODY);
  delete missingCreated.created;
  assert.equal(webhook.parseStripeSubscriptionEvent(missingCreated).eventCreatedIso, null);
});

test("nenhum item marcado 'licensed' NUNCA cai pro primeiro item da lista — período e price ficam null (Art. 14)", () => {
  const noLicensed = JSON.parse(TEST_BODY);
  noLicensed.data.object.items.data[0].price.recurring.usage_type = "metered";
  const parsed = webhook.parseStripeSubscriptionEvent(noLicensed);
  assert.equal(parsed.licensedPriceId, null);
  assert.equal(parsed.periodStartIso, null);
  assert.equal(parsed.periodEndIso, null);
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
