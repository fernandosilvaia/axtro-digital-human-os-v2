import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../..", import.meta.url));
const domain = await import(pathToFileURL(join(root, "packages/domain/dist/index.js")).href);
const walkingSequence = JSON.parse(
  readFileSync(join(root, "tests/fixtures/reducers/walking-sequence.json"), "utf8"),
);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function outcomeEvent({
  aggregateVersion = 6,
  eventId = "018bcfe5-68a0-7abc-bf01-020304050607",
  generation = 0,
  outcome = "succeeded",
  reasonCode = "generation_succeeded",
  persistence = "disabled",
  resultingTurnIndex = 2,
} = {}) {
  return {
    ...clone(walkingSequence[3]),
    event_id: eventId,
    event_type: "turn.outcome_recorded",
    aggregate_version: aggregateVersion,
    data_classification: "internal",
    occurred_at: `2026-07-14T12:02:0${aggregateVersion}.000Z`,
    payload: {
      schema_version: "2.0.0",
      claim_id: "018bcfe5-68b0-7abc-bf01-020304050607",
      generation,
      outcome,
      reason_code: reasonCode,
      persistence,
      resulting_turn_index: resultingTurnIndex,
    },
  };
}

test("turn outcome parser accepts only the closed content-free success and failure payloads", () => {
  const success = domain.parseInteractionEvent(outcomeEvent({ generation: 10_000_000, persistence: "persisted" }));
  assert.deepEqual(Object.keys(success.payload).sort(), [
    "claim_id",
    "generation",
    "outcome",
    "persistence",
    "reason_code",
    "resulting_turn_index",
    "schema_version",
  ]);
  assert.equal(success.data_classification, "internal");
  assert.equal(success.payload.outcome, "succeeded");

  const failure = domain.parseInteractionEvent(outcomeEvent({
    outcome: "failed",
    reasonCode: "provider_response_uncommitted",
    persistence: null,
    resultingTurnIndex: 0,
  }));
  assert.equal(failure.payload.outcome, "failed");
  assert.equal(failure.payload.reason_code, "provider_response_uncommitted");
  assert.equal(failure.payload.persistence, null);
});

test("turn outcome parser rejects content, digests, metadata, wrong classification, and malformed bounds", () => {
  for (const forbiddenField of ["content", "content_digest", "metadata", "provider_request_id"]) {
    const event = outcomeEvent();
    event.payload[forbiddenField] = "forbidden";
    assert.throws(() => domain.parseInteractionEvent(event), domain.DomainEventValidationError);
  }

  const invalidEvents = [
    (() => { const event = outcomeEvent(); event.data_classification = "restricted"; return event; })(),
    (() => { const event = outcomeEvent(); event.payload.claim_id = "not-a-uuid"; return event; })(),
    (() => { const event = outcomeEvent(); event.payload.schema_version = "2.1.0"; return event; })(),
    outcomeEvent({ generation: -1 }),
    outcomeEvent({ generation: 10_000_001 }),
    outcomeEvent({ generation: 1.5 }),
    outcomeEvent({ outcome: "unknown" }),
    outcomeEvent({ reasonCode: "unknown" }),
    outcomeEvent({ persistence: "unknown" }),
    outcomeEvent({ resultingTurnIndex: -1 }),
    outcomeEvent({ resultingTurnIndex: 1.5 }),
  ];
  for (const event of invalidEvents) {
    assert.throws(() => domain.parseInteractionEvent(event));
  }
});

test("turn outcome parser enforces bidirectional outcome, reason, and persistence invariants", () => {
  const invalidEvents = [
    outcomeEvent({ reasonCode: "generation_failed" }),
    outcomeEvent({ persistence: null }),
    outcomeEvent({ outcome: "failed", reasonCode: "generation_succeeded", persistence: null }),
    outcomeEvent({ outcome: "failed", reasonCode: "generated_reply_invalid", persistence: "disabled" }),
    outcomeEvent({ reasonCode: "provider_response_uncommitted", persistence: null }),
    outcomeEvent({ outcome: "failed", reasonCode: "provider_response_uncommitted", persistence: "disabled" }),
  ];
  for (const event of invalidEvents) {
    assert.throws(() => domain.parseInteractionEvent(event), domain.DomainEventValidationError);
  }
});

test("successful and failed turn outcomes enforce active Presenter transitions without content state", () => {
  const activePrefix = clone(walkingSequence.slice(0, 5));
  const before = domain.replayInteraction(activePrefix);
  const successEvent = outcomeEvent({ persistence: "persisted" });
  const succeeded = domain.reduceInteractionState(before, successEvent);

  assert.equal(succeeded.session.state_version, 6);
  assert.equal(succeeded.session.status, "active");
  assert.equal(succeeded.session.active_presenter_id, before.session.active_presenter_id);
  assert.deepEqual(succeeded.conversation, {
    ...before.conversation,
    turn_index: 2,
    updated_at: successEvent.occurred_at,
  });

  const failureEvent = outcomeEvent({
    outcome: "failed",
    reasonCode: "provider_response_uncommitted",
    persistence: null,
    resultingTurnIndex: 0,
  });
  const failed = domain.reduceInteractionState(before, failureEvent);
  assert.equal(failed.session.state_version, 6);
  assert.deepEqual(failed.conversation, before.conversation);

  const readyPrefix = clone(walkingSequence.slice(0, 4));
  const ready = domain.replayInteraction(readyPrefix);
  const readyEvent = outcomeEvent({ aggregateVersion: 5 });
  assert.throws(() => domain.reduceInteractionState(ready, readyEvent), domain.InteractionTransitionError);

  assert.throws(
    () => domain.reduceInteractionState(before, outcomeEvent({ resultingTurnIndex: 1 })),
    domain.InteractionTransitionError,
  );
  assert.throws(
    () => domain.reduceInteractionState(before, outcomeEvent({
      outcome: "failed",
      reasonCode: "session_expired",
      persistence: null,
      resultingTurnIndex: 2,
    })),
    domain.InteractionTransitionError,
  );

  const staleGeneration = outcomeEvent({
    aggregateVersion: 7,
    eventId: "018bcfe5-68a2-7abc-bf01-020304050607",
    generation: 0,
    outcome: "failed",
    reasonCode: "worker_lost",
    persistence: null,
    resultingTurnIndex: 2,
  });
  const futureGeneration = outcomeEvent({
    aggregateVersion: 7,
    eventId: "018bcfe5-68a3-7abc-bf01-020304050607",
    generation: 2,
    outcome: "failed",
    reasonCode: "worker_lost",
    persistence: null,
    resultingTurnIndex: 2,
  });
  assert.throws(
    () => domain.reduceInteractionState(succeeded, staleGeneration),
    /generation does not match the prior content-free exchange state/,
  );
  assert.throws(
    () => domain.reduceInteractionState(succeeded, futureGeneration),
    /generation does not match the prior content-free exchange state/,
  );
});

test("turn outcome replay is deterministic across success and later failure", () => {
  const success = outcomeEvent({ generation: 0, persistence: "disabled" });
  const failure = outcomeEvent({
    aggregateVersion: 7,
    eventId: "018bcfe5-68a1-7abc-bf01-020304050607",
    generation: 1,
    outcome: "failed",
    reasonCode: "worker_lost",
    persistence: null,
    resultingTurnIndex: 2,
  });
  const sequence = [...clone(walkingSequence.slice(0, 5)), success, failure];
  const first = domain.replayInteraction(sequence);
  const second = domain.replayInteraction(clone(sequence));

  assert.deepEqual(first, second);
  assert.equal(domain.interactionStateHash(first), domain.interactionStateHash(second));
  assert.equal(first.session.state_version, 7);
  assert.equal(first.conversation.turn_index, 2);
  assert.equal(first.conversation.updated_at, success.occurred_at);
});
