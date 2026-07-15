import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import test from "node:test";

const root = fileURLToPath(new URL("../..", import.meta.url));
const { reduceTurnCoordinatorState, canHandleTurnCoordinatorEvent, TurnCoordinatorTransitionError } =
  await import(pathToFileURL(join(root, "packages/turn-coordinator/dist/index.js")).href);

test("state machine: the documented idle -> committed -> idle cycle is reachable", () => {
  let state = "idle";
  state = reduceTurnCoordinatorState(state, "speech_started");
  assert.equal(state, "user_speaking");
  state = reduceTurnCoordinatorState(state, "pause_detected");
  assert.equal(state, "endpoint_candidate");
  state = reduceTurnCoordinatorState(state, "endpoint_confirmed");
  assert.equal(state, "committed");
  state = reduceTurnCoordinatorState(state, "presenter_turn_completed");
  assert.equal(state, "idle");
});

test("state machine: barge-in confirms through agent_interrupted back to user_speaking", () => {
  let state = "committed";
  state = reduceTurnCoordinatorState(state, "interruption_candidate");
  assert.equal(state, "agent_interrupted");
  state = reduceTurnCoordinatorState(state, "interruption_confirmed");
  assert.equal(state, "user_speaking");
});

test("state machine: a false interruption recovers back to committed, not idle", () => {
  let state = "committed";
  state = reduceTurnCoordinatorState(state, "interruption_candidate");
  state = reduceTurnCoordinatorState(state, "interruption_false_positive");
  assert.equal(state, "recovered_false_interrupt");
  state = reduceTurnCoordinatorState(state, "playback_recovered");
  assert.equal(state, "committed");
});

test("state machine: undefined transitions throw a typed error instead of silently no-op", () => {
  assert.throws(() => reduceTurnCoordinatorState("idle", "endpoint_confirmed"), TurnCoordinatorTransitionError);
  assert.throws(() => reduceTurnCoordinatorState("committed", "speech_started"), TurnCoordinatorTransitionError);
  assert.equal(canHandleTurnCoordinatorEvent("idle", "speech_started"), true);
  assert.equal(canHandleTurnCoordinatorEvent("idle", "endpoint_confirmed"), false);
});
