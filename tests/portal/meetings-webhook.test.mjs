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
