import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import test from "node:test";

const root = fileURLToPath(new URL("../..", import.meta.url));
const behavior = await import(pathToFileURL(join(root, "packages/behavior-director/dist/index.js")).href);

const { createBehaviorDirector } = behavior;

const CAPABILITY = Object.freeze({
  allowedMicrogestures: Object.freeze(["nod", "smile", "tilt_head", "lean_in", "raise_eyebrows", "soft_gaze_break"]),
  speakingRateRange: Object.freeze({ minRatePercent: 80, maxRatePercent: 120 }),
  supportsGaze: true,
  voiceStyles: Object.freeze(["neutral", "warm", "neutral_fallback"]),
});

function intent(overrides = {}) {
  return {
    goal: "speaking_explaining",
    energy: 0.5,
    warmth: 0.5,
    pacing: "normal",
    pauseProfile: "standard",
    nonverbalIntent: ["nod", "smile"],
    generationId: 1,
    ...overrides,
  };
}

test("behavior director: a directive is validated against provider_capability, not free animation commands", () => {
  const director = createBehaviorDirector("m2-behavior-seed-a", CAPABILITY);
  const directive = director.produce(intent(), 0);
  assert.ok(behavior_state_is_canonical(directive.canonicalState));
  assert.ok(CAPABILITY.voiceStyles.includes(directive.voiceStyle));
  assert.ok(directive.speakingRatePercent >= CAPABILITY.speakingRateRange.minRatePercent);
  assert.ok(directive.speakingRatePercent <= CAPABILITY.speakingRateRange.maxRatePercent);
  for (const gesture of directive.allowedMicrogestures) assert.ok(CAPABILITY.allowedMicrogestures.includes(gesture));
  assert.equal(directive.cancellationGenerationId, 1);
});

function behavior_state_is_canonical(state) {
  return [
    "idle_ready", "listening_neutral", "listening_affirming", "thinking_brief",
    "speaking_explaining", "speaking_empathic", "presenting",
    "interrupted_recovering", "handoff_intro", "technical_degraded",
  ].includes(state);
}

test("behavior director: same state and seed produce the same directive deterministically", () => {
  const directorA = createBehaviorDirector("m2-behavior-seed-b", CAPABILITY);
  const directorB = createBehaviorDirector("m2-behavior-seed-b", CAPABILITY);
  const directiveA = directorA.produce(intent(), 1000);
  const directiveB = directorB.produce(intent(), 1000);
  assert.deepEqual(directiveA, directiveB);
});

test("behavior director: a different session seed can select a different microgesture set", () => {
  const directorA = createBehaviorDirector("m2-behavior-seed-c", CAPABILITY);
  const directorB = createBehaviorDirector("m2-behavior-seed-d", CAPABILITY);
  const seriesA = [];
  const seriesB = [];
  for (let i = 0; i < 8; i += 1) {
    seriesA.push(directorA.produce(intent({ nonverbalIntent: ["smile", "lean_in", "raise_eyebrows"] }), i * 9_000).allowedMicrogestures);
    seriesB.push(directorB.produce(intent({ nonverbalIntent: ["smile", "lean_in", "raise_eyebrows"] }), i * 9_000).allowedMicrogestures);
  }
  assert.notDeepEqual(seriesA, seriesB, "two distinct session seeds must not be perfectly correlated across a whole series");
});

test("behavior director: idle_ready stays neutral-idle predominant across many calls", () => {
  const director = createBehaviorDirector("m2-behavior-idle-seed", CAPABILITY);
  let gestureCalls = 0;
  for (let i = 0; i < 40; i += 1) {
    const directive = director.produce(intent({ goal: "idle_ready", nonverbalIntent: ["nod", "smile", "lean_in"] }), i * 2000);
    if (directive.allowedMicrogestures.length > 0) gestureCalls += 1;
    for (const gesture of directive.allowedMicrogestures) assert.ok(["nod", "soft_gaze_break", "tilt_head"].includes(gesture), "idle stays quiet-only");
  }
  assert.ok(gestureCalls < 20, "idle_ready must not gesture on most calls");
});

test("behavior director: a gesture repeated too soon is suppressed by cooldown", () => {
  const director = createBehaviorDirector("m2-behavior-cooldown-seed", CAPABILITY);
  const first = director.produce(intent({ nonverbalIntent: ["nod"] }), 0);
  const second = director.produce(intent({ nonverbalIntent: ["nod"] }), 500);
  if (first.allowedMicrogestures.includes("nod")) {
    assert.equal(second.allowedMicrogestures.includes("nod"), false, "cooldown blocks an immediate repeat");
  }
});

test("behavior director: nods are capped per minute even across many eligible calls", () => {
  const director = createBehaviorDirector("m2-behavior-cap-seed", CAPABILITY);
  let nodCount = 0;
  // 60 calls one second apart all land inside a single 60s window, so the
  // cumulative count across the whole run must still respect the per-minute cap.
  for (let i = 0; i < 60; i += 1) {
    const directive = director.produce(intent({ goal: "speaking_explaining", nonverbalIntent: ["nod"] }), i * 1_000);
    if (directive.allowedMicrogestures.includes("nod")) nodCount += 1;
  }
  assert.ok(nodCount <= 6, "at most MAX_NODS_PER_MINUTE nods land inside a single 60s window");
});

test("behavior director: technical_degraded and interrupted_recovering never gesture", () => {
  const director = createBehaviorDirector("m2-behavior-degraded-seed", CAPABILITY);
  const degraded = director.produce(intent({ goal: "technical_degraded", nonverbalIntent: ["nod", "smile"] }), 0);
  assert.deepEqual(degraded.allowedMicrogestures, []);
  assert.equal(degraded.gazeTarget, "none");
  const interrupted = director.interrupted(1, 100);
  assert.equal(interrupted.canonicalState, "interrupted_recovering");
  assert.deepEqual(interrupted.allowedMicrogestures, []);
  assert.equal(interrupted.cancellationGenerationId, 1);
});

test("behavior director: reduced motion suppresses all gestures and gaze regardless of state", () => {
  const director = createBehaviorDirector("m2-behavior-reduced-motion-seed", CAPABILITY);
  const directive = director.produce(intent({ goal: "presenting", nonverbalIntent: ["nod", "smile"], reducedMotion: true }), 0);
  assert.deepEqual(directive.allowedMicrogestures, []);
  assert.equal(directive.gazeTarget, "none");
});

test("behavior director: gaze is disabled outright when the provider capability does not support it", () => {
  const noGazeCapability = { ...CAPABILITY, supportsGaze: false };
  const director = createBehaviorDirector("m2-behavior-no-gaze-seed", noGazeCapability);
  const directive = director.produce(intent(), 0);
  assert.equal(directive.gazeTarget, "none");
});

test("behavior director: rejects a free-text or unlisted nonverbal intent instead of accepting arbitrary animation", () => {
  const director = createBehaviorDirector("m2-behavior-invalid-seed", CAPABILITY);
  assert.throws(() => director.produce(intent({ nonverbalIntent: ["do_a_backflip"] }), 0), RangeError);
});
