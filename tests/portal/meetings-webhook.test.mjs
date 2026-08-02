import assert from "node:assert/strict";
import { test } from "node:test";

const webhook = await import("../../apps/portal/src/lib/meetings/webhook.ts");

function payload(event, botId = "550e8400-e29b-41d4-a716-446655440000") {
  return { event, data: { data: { code: event, updated_at: "2026-08-01T18:00:00Z" }, bot: { id: botId } } };
}

test("mapeia cada evento de status do bot pro enum fechado da sessão", () => {
  assert.equal(webhook.statusForRecallEvent("bot.joining_call"), "joining");
  assert.equal(webhook.statusForRecallEvent("bot.in_waiting_room"), "joining");
  assert.equal(webhook.statusForRecallEvent("bot.in_call_not_recording"), "in_call");
  assert.equal(webhook.statusForRecallEvent("bot.in_call_recording"), "in_call");
  assert.equal(webhook.statusForRecallEvent("bot.recording_permission_allowed"), "in_call");
  assert.equal(webhook.statusForRecallEvent("bot.call_ended"), "ended");
  assert.equal(webhook.statusForRecallEvent("bot.done"), "ended");
  assert.equal(webhook.statusForRecallEvent("bot.fatal"), "failed");
});

test("eventos fora do enum (breakout room, participant_events) não têm status mapeado — escopo declarado, não erro", () => {
  for (const event of ["bot.breakout_room_entered", "participant_events.join", "bot.recording_permission_denied"]) {
    assert.equal(webhook.statusForRecallEvent(event), null);
  }
});

test("extrai event + botId de um payload válido", () => {
  const parsed = webhook.parseRecallWebhookPayload(payload("bot.call_ended", "550e8400-e29b-41d4-a716-446655440000"));
  assert.deepEqual(parsed, { event: "bot.call_ended", botId: "550e8400-e29b-41d4-a716-446655440000" });
});

test("devolve null pra evento desconhecido, payload malformado, ou bot.id ausente", () => {
  for (const bad of [
    null,
    undefined,
    "not an object",
    { event: "bot.breakout_room_entered", data: { bot: { id: "x" } } },
    { event: "bot.call_ended" },
    { event: "bot.call_ended", data: {} },
    { event: "bot.call_ended", data: { bot: {} } },
    { event: "bot.call_ended", data: { bot: { id: "" } } },
    {},
  ]) {
    assert.equal(webhook.parseRecallWebhookPayload(bad), null);
  }
});

// Vetor de teste gerado com o mesmo algoritmo documentado (HMAC-SHA256,
// string assinada "{id}.{timestamp}.{raw-body}", chave base64 após o
// prefixo whsec_) — não é o segredo real de produção.
const TEST_SECRET = "whsec_dGVzdC1rZXktbWF0ZXJpYWwtMzItYnl0ZXMtb2shIQ==";
const TEST_ID = "msg_test123";
const TEST_TIMESTAMP = "1700000000";
const TEST_RAW_BODY = '{"event":"bot.done","data":{"bot":{"id":"abc"}}}';
const TEST_VALID_SIGNATURE = "v1,ctSdmK6qGEuy7kU0HmCCsmsGERZFM52VQ65rC2pjOgM=";
const TEST_NOW = Number(TEST_TIMESTAMP);

test("assinatura válida (HMAC-SHA256, formato Standard Webhooks) é aceita", () => {
  const ok = webhook.verifyRecallWebhookSignature(
    TEST_SECRET,
    { id: TEST_ID, timestamp: TEST_TIMESTAMP, signature: TEST_VALID_SIGNATURE },
    TEST_RAW_BODY,
    TEST_NOW,
  );
  assert.equal(ok, true);
});

test("aceita quando a assinatura válida é uma entre várias (rotação de segredo)", () => {
  const ok = webhook.verifyRecallWebhookSignature(
    TEST_SECRET,
    { id: TEST_ID, timestamp: TEST_TIMESTAMP, signature: `v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= ${TEST_VALID_SIGNATURE}` },
    TEST_RAW_BODY,
    TEST_NOW,
  );
  assert.equal(ok, true);
});

test("rejeita corpo, id, timestamp ou segredo adulterados", () => {
  const base = { id: TEST_ID, timestamp: TEST_TIMESTAMP, signature: TEST_VALID_SIGNATURE };
  assert.equal(webhook.verifyRecallWebhookSignature(TEST_SECRET, base, '{"event":"bot.done","data":{"bot":{"id":"outro"}}}', TEST_NOW), false);
  assert.equal(webhook.verifyRecallWebhookSignature(TEST_SECRET, { ...base, id: "msg_outro" }, TEST_RAW_BODY, TEST_NOW), false);
  assert.equal(webhook.verifyRecallWebhookSignature(TEST_SECRET, { ...base, timestamp: "1700000001" }, TEST_RAW_BODY, TEST_NOW), false);
  assert.equal(webhook.verifyRecallWebhookSignature("whsec_" + Buffer.from("outro-segredo-32-bytes-aqui!!!!").toString("base64"), base, TEST_RAW_BODY, TEST_NOW), false);
});

test("rejeita timestamp fora da janela de tolerância de 5 minutos (replay)", () => {
  const base = { id: TEST_ID, timestamp: TEST_TIMESTAMP, signature: TEST_VALID_SIGNATURE };
  assert.equal(webhook.verifyRecallWebhookSignature(TEST_SECRET, base, TEST_RAW_BODY, TEST_NOW + 301), false);
  assert.equal(webhook.verifyRecallWebhookSignature(TEST_SECRET, base, TEST_RAW_BODY, TEST_NOW - 301), false);
  assert.equal(webhook.verifyRecallWebhookSignature(TEST_SECRET, base, TEST_RAW_BODY, TEST_NOW + 299), true);
});

test("rejeita cabeçalhos ausentes, segredo sem prefixo whsec_, ou assinatura em formato inesperado", () => {
  const base = { id: TEST_ID, timestamp: TEST_TIMESTAMP, signature: TEST_VALID_SIGNATURE };
  assert.equal(webhook.verifyRecallWebhookSignature(TEST_SECRET, { ...base, id: null }, TEST_RAW_BODY, TEST_NOW), false);
  assert.equal(webhook.verifyRecallWebhookSignature(TEST_SECRET, { ...base, timestamp: null }, TEST_RAW_BODY, TEST_NOW), false);
  assert.equal(webhook.verifyRecallWebhookSignature(TEST_SECRET, { ...base, signature: null }, TEST_RAW_BODY, TEST_NOW), false);
  assert.equal(webhook.verifyRecallWebhookSignature(TEST_SECRET, { ...base, timestamp: "not-a-number" }, TEST_RAW_BODY, TEST_NOW), false);
  assert.equal(webhook.verifyRecallWebhookSignature("plain-secret-no-prefix", base, TEST_RAW_BODY, TEST_NOW), false);
  assert.equal(webhook.verifyRecallWebhookSignature(TEST_SECRET, { ...base, signature: "v2,ctSdmK6qGEuy7kU0HmCCsmsGERZFM52VQ65rC2pjOgM=" }, TEST_RAW_BODY, TEST_NOW), false);
  assert.equal(webhook.verifyRecallWebhookSignature(TEST_SECRET, { ...base, signature: "garbage-no-comma" }, TEST_RAW_BODY, TEST_NOW), false);
});
