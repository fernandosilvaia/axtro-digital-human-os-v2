import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import test from "node:test";

const root = fileURLToPath(new URL("../..", import.meta.url));
const degradation = await import(pathToFileURL(join(root, "packages/degradation-controller/dist/index.js")).href);
const modelGateway = await import(pathToFileURL(join(root, "packages/model-gateway/dist/index.js")).href);

const { createDegradationController, CAPABILITY_DEGRADATION_MATRIX, CAPABILITY_FAILURE_KINDS, ruleFor } = degradation;

function manualClock(startMs = 0) {
  let value = startMs;
  return { now: () => value, advance: (deltaMs) => { value += deltaMs; } };
}

test("degradation matrix: every documented row is present exactly once with its system and data action", () => {
  assert.equal(CAPABILITY_DEGRADATION_MATRIX.length, CAPABILITY_FAILURE_KINDS.length);
  const seen = new Set();
  for (const rule of CAPABILITY_DEGRADATION_MATRIX) {
    assert.equal(seen.has(rule.failure), false, `${rule.failure} appears only once`);
    seen.add(rule.failure);
  }
  assert.equal(ruleFor("avatar_unavailable").systemAction, "disable_avatar_for_session");
  assert.equal(ruleFor("avatar_unavailable").dataAction, "health_event_and_cost_stop");
  assert.equal(ruleFor("s2s_down").systemAction, "switch_to_modular_pipeline");
  assert.equal(ruleFor("budget_reached").systemAction, "block_new_spend");
});

test("degradation controller: a declared failure is active until an explicit recover call, never auto-clears", () => {
  const controller = createDegradationController(manualClock(0));
  const event = controller.handleFailure({ failure: "s2s_down" });
  assert.equal(event.type, "failure_declared");
  assert.equal(event.rule.systemAction, "switch_to_modular_pipeline");
  assert.equal(controller.isDegraded("s2s_down"), true);
  assert.deepEqual(controller.activeFailures(), ["s2s_down"]);

  controller.recover("s2s_down");
  assert.equal(controller.isDegraded("s2s_down"), false);
  assert.deepEqual(controller.activeFailures(), []);
});

test("degradation controller: recovering a failure that was never declared is a harmless no-op", () => {
  const controller = createDegradationController(manualClock(0));
  controller.recover("network_poor");
  assert.equal(controller.events().length, 0);
});

test("degradation controller: recovery from S2S->modular fallback never delivers the same turn's output twice", () => {
  const controller = createDegradationController(manualClock(0));

  // Turn N is running on S2S (generation 7). S2S goes down mid-turn.
  controller.handleFailure({ failure: "s2s_down", generationId: 7 });
  // The fallback controller rebuilds context on the modular pipeline as a new generation (8).
  controller.markPresented(8);

  // Generation 7's S2S output arrives late (the provider eventually flushed it) — it must be suppressed.
  assert.equal(controller.shouldSuppressDuplicatePresentation(7), true);
  // Generation 8, already presented, must never be re-delivered either.
  assert.equal(controller.shouldSuppressDuplicatePresentation(8), true);
  // A brand new generation 9 (the next turn) is not a duplicate.
  assert.equal(controller.shouldSuppressDuplicatePresentation(9), false);
});

test("degradation controller: budget_reached blocks new spend without touching an unrelated failure", () => {
  const controller = createDegradationController(manualClock(0));
  controller.handleFailure({ failure: "budget_reached" });
  assert.equal(controller.isDegraded("budget_reached"), true);
  assert.equal(controller.isDegraded("network_poor"), false);
  assert.equal(ruleFor("budget_reached").dataAction, "budget_event");
});

test("degradation controller integration: an S2S session-open failure both falls back to modular and is declared to the matrix", async () => {
  const controller = createDegradationController(manualClock(0));
  const route = await modelGateway.selectConversationPathMode({ s2sEnabled: true }, async () => {
    throw new Error("provider_unavailable");
  });
  assert.equal(route.mode, "modular");
  assert.equal(route.fallbackFromS2S, true);

  const event = controller.handleFailure({ failure: "s2s_down", generationId: 1 });
  assert.equal(event.rule.systemAction, "switch_to_modular_pipeline");
  assert.equal(controller.isDegraded("s2s_down"), true);
});

test("degradation controller: invalid failure kinds and generation ids are rejected up front", () => {
  const controller = createDegradationController(manualClock(0));
  assert.throws(() => controller.handleFailure({ failure: "server_on_fire" }), RangeError);
  assert.throws(() => controller.markPresented(-1), RangeError);
  assert.throws(() => ruleFor("unknown_kind"), RangeError);
});
