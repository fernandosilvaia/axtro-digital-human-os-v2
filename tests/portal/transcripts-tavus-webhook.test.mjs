import assert from "node:assert/strict";
import { test } from "node:test";

const webhook = await import("../../apps/portal/src/lib/transcripts/tavus-webhook.ts");

test("append receipt is acknowledged only after a matching placeholder was persisted", () => {
  assert.equal(webhook.transcriptAppendWasPersisted({ found: true }), true);
  assert.equal(webhook.transcriptAppendWasPersisted({ found: false }), false);
  assert.equal(webhook.transcriptAppendWasPersisted({}), false);
  assert.equal(webhook.transcriptAppendWasPersisted(null), false);
});

const VALID_EVENT = {
  event_type: "application.transcription_ready",
  message_type: "application",
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
    observedAt: "2026-08-10T12:00:00.000Z",
    turns: [
      { role: "assistant", content: "Oi, tudo bem?" },
      { role: "user", content: "Tudo! Testando." },
    ],
    hasHumanTurn: true,
    truncated: false,
  });
});

test("system.replica_joined nunca é prova de humano; apenas transcript com turno user é delivery", () => {
  assert.equal(webhook.parseTavusTranscriptEvent({ ...VALID_EVENT, event_type: "system.replica_joined" }), null);
  const assistantOnly = webhook.parseTavusTranscriptEvent({
    ...VALID_EVENT,
    properties: { transcript: [{ role: "assistant", content: "Olá, estou pronta." }] },
  });
  assert.equal(assistantOnly.hasHumanTurn, false);
  assert.equal(webhook.parseTavusTranscriptEvent(VALID_EVENT).hasHumanTurn, true);
});

test("aceita somente shutdown autenticável com o reason exato de participante ausente", () => {
  const absent = {
    event_type: "system.shutdown",
    message_type: "system",
    conversation_id: "conv_abc123",
    timestamp: "2026-08-10T12:00:00.000Z",
    properties: { shutdown_reason: "participant_absent_timeout reached" },
  };
  assert.deepEqual(webhook.parseTavusNoDeliveryEvent(absent), {
    conversationId: "conv_abc123",
    observedAt: "2026-08-10T12:00:00.000Z",
    reason: "participant_absent_timeout reached",
  });
  for (const mutation of [
    { ...absent, message_type: "application" },
    { ...absent, conversation_id: "" },
    { ...absent, timestamp: "not-a-timestamp" },
    { ...absent, properties: { shutdown_reason: "participant_left_timeout reached" } },
    { ...absent, properties: { shutdown_reason: "participant_absent_timeout" } },
  ]) assert.equal(webhook.parseTavusNoDeliveryEvent(mutation), null);
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
  assert.equal(webhook.parseTavusTranscriptEvent({ ...VALID_EVENT, message_type: "system" }), null);
  assert.equal(webhook.parseTavusTranscriptEvent({ ...VALID_EVENT, message_type: undefined }), null);
  // 65 chars is the unified max shared with provider-tavus's ID_PATTERN
  // (achado onda 6: era 64 aqui, 65 lá — drift silencioso corrigido).
  for (const conversation_id of ["ab", " conv_abc123", "conv.abc", "conv/abc", "a".repeat(100)]) {
    assert.equal(webhook.parseTavusTranscriptEvent({ ...VALID_EVENT, conversation_id }), null);
  }
});

test("achado da auto-revisão D-V2-115: item com role inválido é PULADO, não descarta o evento inteiro (mesma disciplina do turno de content vazio)", () => {
  const mixedBadRole = {
    ...VALID_EVENT,
    properties: { transcript: [{ role: "system", content: "x" }, { role: "assistant", content: "oi" }] },
  };
  const parsed = webhook.parseTavusTranscriptEvent(mixedBadRole);
  assert.notEqual(parsed, null, "um item com role inválido no meio não deveria descartar o evento inteiro");
  assert.deepEqual(parsed.turns, [{ role: "assistant", content: "oi" }]);

  // Se TODOS os itens forem malformados, ainda cai em null (turns vazio) —
  // a proteção contra payload 100% lixo continua de pé.
  const allBadRole = { ...VALID_EVENT, properties: { transcript: [{ role: "system", content: "x" }] } };
  assert.equal(webhook.parseTavusTranscriptEvent(allBadRole), null);

  const emptyContent = {
    ...VALID_EVENT,
    properties: { transcript: [{ role: "user", content: "" }, { role: "assistant", content: "oi" }] },
  };
  const parsedEmpty = webhook.parseTavusTranscriptEvent(emptyContent);
  assert.deepEqual(parsedEmpty.turns, [{ role: "assistant", content: "oi" }]);
});

test("achado da auto-revisão D-V2-115: item não-objeto (null, string, número) no meio do array é pulado, não descarta o evento", () => {
  const mixedNonObjects = {
    ...VALID_EVENT,
    properties: { transcript: [null, "lixo", 42, { role: "assistant", content: "oi" }] },
  };
  const parsed = webhook.parseTavusTranscriptEvent(mixedNonObjects);
  assert.notEqual(parsed, null);
  assert.deepEqual(parsed.turns, [{ role: "assistant", content: "oi" }]);
});

test("trunca content além do teto sem lançar", () => {
  const huge = { ...VALID_EVENT, properties: { transcript: [{ role: "user", content: "x".repeat(5000) }] } };
  const parsed = webhook.parseTavusTranscriptEvent(huge);
  assert.equal(parsed.turns[0].content.length, 4000);
});

test("achado D-V2-115: transcript com mais de 500 turnos é TRUNCADO, não descartado por inteiro", () => {
  const manyTurns = Array.from({ length: 600 }, (_, i) => ({
    role: i % 2 === 0 ? "assistant" : "user",
    content: `turno ${i}`,
  }));
  const huge = { ...VALID_EVENT, properties: { transcript: manyTurns } };
  const parsed = webhook.parseTavusTranscriptEvent(huge);
  assert.notEqual(parsed, null, "não deveria descartar o evento inteiro");
  assert.equal(parsed.turns.length, 500, "deveria manter só os primeiros 500 turnos");
  assert.equal(parsed.truncated, true);
});

test("transcript com exatamente 500 turnos não é marcado como truncado", () => {
  const exactTurns = Array.from({ length: 500 }, (_, i) => ({
    role: i % 2 === 0 ? "assistant" : "user",
    content: `turno ${i}`,
  }));
  const parsed = webhook.parseTavusTranscriptEvent({ ...VALID_EVENT, properties: { transcript: exactTurns } });
  assert.equal(parsed.turns.length, 500);
  assert.equal(parsed.truncated, false);
});
