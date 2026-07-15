import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import test from "node:test";

import { canonicalArtifactJson, runM2HumanPresenceSpike } from "./m2-human-presence-spike-harness.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));

function readArtifact(name) {
  return readFileSync(join(root, "artifacts", "m2", name), "utf8");
}

test("the mandatory ten-minute Human Presence scenario is deterministic and matches frozen evidence", async () => {
  const first = await runM2HumanPresenceSpike();
  const second = await runM2HumanPresenceSpike();
  assert.deepEqual(second.evidence, first.evidence);
  assert.equal(readArtifact("evidence.json"), canonicalArtifactJson(first.evidence));
});

test("every required checklist item from HUMAN_PRESENCE_SPIKE.md completes, and the scenario spans ten simulated minutes without deadlock", async () => {
  const { evidence } = await runM2HumanPresenceSpike();
  assert.equal(evidence.meets_ten_minute_requirement, true);
  assert.ok(evidence.total_simulated_duration_ms >= 600_000);
  assert.equal(evidence.checklist_summary.all_steps_completed, true);
  assert.equal(evidence.failures.length, 0);
  assert.equal(evidence.external_network_calls, 0);
});

test("barge-in interrupts without late output, and avatar failure degrades to voice-only without blocking the turn", async () => {
  const { evidence } = await runM2HumanPresenceSpike();
  assert.equal(evidence.turn_coordinator.barge_in_confirmed, true);
  assert.equal(evidence.avatar.late_segment_discarded, true);
  assert.equal(evidence.avatar.failure_injected, true);
  assert.equal(evidence.avatar.disabled_after_failure, true);
  assert.equal(evidence.avatar.post_failure_render_outcome, "disabled");
  assert.equal(evidence.degradation.failures_declared.includes("avatar_unavailable"), true);
  assert.equal(evidence.degradation.duplicate_presentation_would_be_suppressed_for_interrupted_generation, true);
});

test("a delayed specialist never blocks the Presenter, and the read-only catalog query completes", async () => {
  const { evidence } = await runM2HumanPresenceSpike();
  assert.equal(evidence.specialists.delayed_specialist_status, "timeout");
  assert.equal(evidence.specialists.catalog_query_status, "completed");
});

test("the slide scene renders through the allowlisted manifest and cost reconciles within tolerance", async () => {
  const { evidence } = await runM2HumanPresenceSpike();
  assert.equal(evidence.scene.outcome, "accepted");
  assert.equal(evidence.scene.manifest_id, "slide-deck-human-presence");
  assert.equal(evidence.cost.status, "reconciled");
});

test("component latency budgets from LATENCY_BUDGETS.md are all evaluated, and none are silently skipped", async () => {
  const { evidence } = await runM2HumanPresenceSpike();
  const evaluated = Object.keys(evidence.telemetry.spans);
  assert.deepEqual(
    evaluated.sort(),
    [
      "audio_ingress", "avatar_first_frame", "cancellation_acknowledged", "channel_publish",
      "context_compose", "model_first_token", "tts_first_audio", "turn_candidate", "turn_commit",
    ].sort(),
  );
  for (const summary of Object.values(evidence.telemetry.spans)) {
    assert.notEqual(summary.budget_evaluation, undefined);
  }
  assert.equal(evidence.telemetry.total_eot_to_audio_budget_evaluation, "within_budget");
});

test("the frozen M2 evidence artifact contains no restricted material or local filesystem paths", () => {
  const artifactText = readArtifact("evidence.json");
  for (const prohibited of ["Bearer ", "secret://", "stack", "exception", "/Users/", "@example.test"]) {
    assert.equal(artifactText.includes(prohibited), false, prohibited);
  }
});
