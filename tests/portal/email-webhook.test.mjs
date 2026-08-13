import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";

const webhook = await import("../../apps/portal/src/lib/email-webhook.ts");

const TEST_SECRET_RAW = Buffer.from("test-svix-secret-material-32-bytes!!", "utf8");
const TEST_SECRET = `whsec_${TEST_SECRET_RAW.toString("base64")}`;
const TEST_ID = "msg_test123";
const TEST_TIMESTAMP = "1700000000";
const TEST_NOW = Number(TEST_TIMESTAMP);
const TEST_BODY = '{"type":"email.bounced","data":{"email_id":"email_abc123"}}';

function sign(id, timestamp, body, secretRaw = TEST_SECRET_RAW) {
  const signature = createHmac("sha256", secretRaw).update(`${id}.${timestamp}.${body}`).digest("base64");
  return `v1,${signature}`;
}

test("assinatura Svix válida (HMAC-SHA256 base64) é aceita", () => {
  const header = sign(TEST_ID, TEST_TIMESTAMP, TEST_BODY);
  assert.equal(webhook.verifyResendWebhookSignature(TEST_SECRET, TEST_ID, TEST_TIMESTAMP, header, TEST_BODY, TEST_NOW), true);
});

test("aceita quando a assinatura válida é uma entre várias v1 (rotação de segredo)", () => {
  const header = `v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= ${sign(TEST_ID, TEST_TIMESTAMP, TEST_BODY)}`;
  assert.equal(webhook.verifyResendWebhookSignature(TEST_SECRET, TEST_ID, TEST_TIMESTAMP, header, TEST_BODY, TEST_NOW), true);
});

test("rejeita corpo, id, timestamp ou segredo adulterados", () => {
  const header = sign(TEST_ID, TEST_TIMESTAMP, TEST_BODY);
  assert.equal(webhook.verifyResendWebhookSignature(TEST_SECRET, TEST_ID, TEST_TIMESTAMP, header, TEST_BODY + "x", TEST_NOW), false);
  assert.equal(webhook.verifyResendWebhookSignature(TEST_SECRET, "msg_outro", TEST_TIMESTAMP, header, TEST_BODY, TEST_NOW), false);
  assert.equal(webhook.verifyResendWebhookSignature(TEST_SECRET, TEST_ID, "1700000001", header, TEST_BODY, TEST_NOW), false);
  const otherSecret = `whsec_${Buffer.from("outro-segredo-completamente-diferente!!").toString("base64")}`;
  assert.equal(webhook.verifyResendWebhookSignature(otherSecret, TEST_ID, TEST_TIMESTAMP, header, TEST_BODY, TEST_NOW), false);
});

test("rejeita timestamp fora da janela de tolerância de 5 minutos (replay)", () => {
  const header = sign(TEST_ID, TEST_TIMESTAMP, TEST_BODY);
  assert.equal(webhook.verifyResendWebhookSignature(TEST_SECRET, TEST_ID, TEST_TIMESTAMP, header, TEST_BODY, TEST_NOW + 301), false);
  assert.equal(webhook.verifyResendWebhookSignature(TEST_SECRET, TEST_ID, TEST_TIMESTAMP, header, TEST_BODY, TEST_NOW - 301), false);
  assert.equal(webhook.verifyResendWebhookSignature(TEST_SECRET, TEST_ID, TEST_TIMESTAMP, header, TEST_BODY, TEST_NOW + 299), true);
});

test("rejeita cabeçalho/segredo ausente ou em formato inesperado", () => {
  assert.equal(webhook.verifyResendWebhookSignature(TEST_SECRET, TEST_ID, TEST_TIMESTAMP, null, TEST_BODY, TEST_NOW), false);
  assert.equal(webhook.verifyResendWebhookSignature(TEST_SECRET, TEST_ID, TEST_TIMESTAMP, "", TEST_BODY, TEST_NOW), false);
  assert.equal(webhook.verifyResendWebhookSignature(TEST_SECRET, null, TEST_TIMESTAMP, sign(TEST_ID, TEST_TIMESTAMP, TEST_BODY), TEST_BODY, TEST_NOW), false);
  assert.equal(webhook.verifyResendWebhookSignature(TEST_SECRET, TEST_ID, null, sign(TEST_ID, TEST_TIMESTAMP, TEST_BODY), TEST_BODY, TEST_NOW), false);
  assert.equal(webhook.verifyResendWebhookSignature("", TEST_ID, TEST_TIMESTAMP, sign(TEST_ID, TEST_TIMESTAMP, TEST_BODY), TEST_BODY, TEST_NOW), false);
  assert.equal(webhook.verifyResendWebhookSignature("sk_not_a_whsec_secret", TEST_ID, TEST_TIMESTAMP, sign(TEST_ID, TEST_TIMESTAMP, TEST_BODY), TEST_BODY, TEST_NOW), false);
});

test("isHandledResendEventType reconhece só os 3 eventos de falha de entrega tratados", () => {
  assert.equal(webhook.isHandledResendEventType("email.bounced"), true);
  assert.equal(webhook.isHandledResendEventType("email.complained"), true);
  assert.equal(webhook.isHandledResendEventType("email.delivery_delayed"), true);
  assert.equal(webhook.isHandledResendEventType("email.sent"), false);
  assert.equal(webhook.isHandledResendEventType("email.delivered"), false);
  assert.equal(webhook.isHandledResendEventType(123), false);
  assert.equal(webhook.isHandledResendEventType(null), false);
});

test("parseResendWebhookEvent extrai type + email_id de um evento tratado", () => {
  const parsed = webhook.parseResendWebhookEvent({ type: "email.bounced", data: { email_id: "email_abc123", to: ["alguem@example.com"] } });
  assert.deepEqual(parsed, { eventType: "email.bounced", emailId: "email_abc123" });
});

test("parseResendWebhookEvent devolve null pra tipo fora de escopo, payload malformado, ou sem email_id", () => {
  assert.equal(webhook.parseResendWebhookEvent({ type: "email.sent", data: { email_id: "email_1" } }), null);
  assert.equal(webhook.parseResendWebhookEvent({ type: "email.bounced", data: {} }), null);
  assert.equal(webhook.parseResendWebhookEvent({ type: "email.bounced" }), null);
  assert.equal(webhook.parseResendWebhookEvent(null), null);
  assert.equal(webhook.parseResendWebhookEvent("not an object"), null);
});
