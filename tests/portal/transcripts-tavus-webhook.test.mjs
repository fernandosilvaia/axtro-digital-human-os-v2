import assert from "node:assert/strict";
import { test } from "node:test";

const webhook = await import("../../apps/portal/src/lib/transcripts/tavus-webhook.ts");

const VALID_EVENT = {
  event_type: "application.transcription_ready",
  conversation_id: "conv_abc123",
  timestamp: "2026-08-10T12:00:00.000Z",
  properties: {
    transcript: [
      { role: "assistant", content: "Oi, tudo bem?", timestamp: 1, seconds_from_start: 0, duration: 1.2 },
      { role: "user", content: "Tudo! Testando.", timestamp: 2, seconds_from_start: 3 },
    ],
  },
};

test("parseTavusTranscriptEvent extrai conversationId e normaliza turns pro shape {role, content}", () => {
  const parsed = webhook.parseTavusTranscriptEvent(VALID_EVENT);
  assert.deepEqual(parsed, {
    conversationId: "conv_abc123",
    turns: [
      { role: "assistant", content: "Oi, tudo bem?" },
      { role: "user", content: "Tudo! Testando." },
    ],
  });
});

test("ignora eventos fora do escopo (system.replica_joined, recording.ready) sem lançar", () => {
  for (const eventType of ["system.replica_joined", "recording.ready", "application.perception_analysis"]) {
    assert.equal(webhook.parseTavusTranscriptEvent({ ...VALID_EVENT, event_type: eventType }), null);
  }
});

test("rejeita payload malformado (sem conversation_id, sem properties.transcript, transcript vazio)", () => {
  assert.equal(webhook.parseTavusTranscriptEvent(null), null);
  assert.equal(webhook.parseTavusTranscriptEvent("string"), null);
  assert.equal(webhook.parseTavusTranscriptEvent({ ...VALID_EVENT, conversation_id: undefined }), null);
  assert.equal(webhook.parseTavusTranscriptEvent({ ...VALID_EVENT, properties: {} }), null);
  assert.equal(webhook.parseTavusTranscriptEvent({ ...VALID_EVENT, properties: { transcript: [] } }), null);
});

test("rejeita item de transcript com role inválido, mas pula turno de content vazio sem falhar o evento inteiro", () => {
  const badRole = { ...VALID_EVENT, properties: { transcript: [{ role: "system", content: "x" }] } };
  assert.equal(webhook.parseTavusTranscriptEvent(badRole), null);

  const emptyContent = {
    ...VALID_EVENT,
    properties: { transcript: [{ role: "user", content: "" }, { role: "assistant", content: "oi" }] },
  };
  const parsed = webhook.parseTavusTranscriptEvent(emptyContent);
  assert.deepEqual(parsed.turns, [{ role: "assistant", content: "oi" }]);
});

test("trunca content além do teto sem lançar", () => {
  const huge = { ...VALID_EVENT, properties: { transcript: [{ role: "user", content: "x".repeat(5000) }] } };
  const parsed = webhook.parseTavusTranscriptEvent(huge);
  assert.equal(parsed.turns[0].content.length, 4000);
});
