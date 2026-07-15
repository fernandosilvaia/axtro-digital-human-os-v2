import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import test from "node:test";

import {
  canonicalArtifactJson,
  runM1WalkingSkeleton,
} from "./m1-walking-skeleton-harness.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));

function readArtifact(name) {
  return readFileSync(join(root, "artifacts", "m1", name), "utf8");
}

test("one deterministic command proves the complete M1 walking skeleton and frozen evidence", async () => {
  const first = await runM1WalkingSkeleton();
  const second = await runM1WalkingSkeleton();
  assert.deepEqual(second, first);

  assert.equal(readArtifact("timeline.json"), canonicalArtifactJson(first.timeline));
  assert.equal(readArtifact("evidence.json"), canonicalArtifactJson(first.evidence));
  assert.equal(readArtifact("manifest.json"), canonicalArtifactJson(first.manifest));

  assert.equal(first.timeline.event_count, 12);
  assert.equal(first.timeline.payloads_omitted, true);
  assert.equal(first.timeline.events.every((event) => event.payload_omitted === true), true);
  assert.deepEqual(
    first.timeline.events.map((event) => event.aggregate_version),
    Array.from({ length: 12 }, (_, index) => index + 1),
  );
  assert.deepEqual(first.evidence.failure_matrix.map((entry) => [entry.case, entry.outcome]), [
    ["cross_tenant_denial", "passed"],
    ["outbox_retry_after_effect", "passed"],
    ["unknown_tool_effect", "passed"],
  ]);
  assert.equal(first.evidence.replay.matches_outbox, true);
  assert.equal(first.evidence.replay.matches_hot_actor, true);
  assert.equal(first.evidence.replay.matches_workflow_source, true);
  assert.equal(first.evidence.replay.matches_console, true);
  assert.deepEqual(first.evidence.turns.speaker_role_sequence, [
    "participant", "presenter", "participant", "presenter", "participant", "presenter",
  ]);
  assert.deepEqual(first.evidence.turns.turn_index_sequence, [1, 2, 3, 4, 5, 6]);
  assert.equal(first.evidence.turns.unique_presenter_count, 1);
  assert.equal(first.evidence.turns.presenter_matches_active_floor, true);
  assert.equal(first.evidence.turns.alternate_presenter_count, 0);
  assert.equal(first.evidence.safeguards.one_mouth_rule_preserved, true);
  assert.equal(first.evidence.safeguards.action_candidate_not_spoken_automatically, true);
  assert.equal(first.evidence.safeguards.governed_action_chain_verified, true);
  assert.equal(first.evidence.safeguards.external_follow_up_sent, false);
  assert.equal(first.evidence.safeguards.telemetry_sensitive_data_found, false);
  assert.equal(first.evidence.cost.accounting_scope, "nominal_catalog_lookup_only");
  assert.equal(first.evidence.cost.included_fake_invocation_count, 1);
  assert.equal(first.evidence.cost.excluded_failure_injection_invocation_count, 2);
  assert.equal(first.evidence.cost.other_local_fake_attributed_cost_usd_decimal, "0");
  assert.equal(first.evidence.cost.total_estimated_usd_decimal, "0.02");
});

test("tracked M1 artifacts contain only allowlisted metadata and no restricted or operational material", () => {
  const artifactText = ["timeline.json", "evidence.json", "manifest.json", "README.md"]
    .map(readArtifact)
    .join("\n");
  for (const prohibited of [
    "payload_json",
    "transcript_text",
    "arguments_json",
    "result_json",
    "provider_code",
    "provider_request_ref",
    "rate_card_ref",
    "claim_token",
    "authorization",
    "Bearer ",
    "secret://",
    "stack",
    "exception",
    "private@example.test",
    "dev_m1_e2e_",
    "/Users/",
  ]) assert.equal(artifactText.includes(prohibited), false, prohibited);

  const timeline = JSON.parse(readArtifact("timeline.json"));
  const allowedEventKeys = [
    "aggregate_version",
    "data_classification",
    "envelope_fingerprint",
    "event_id",
    "event_type",
    "occurred_at",
    "payload_omitted",
  ].sort();
  for (const event of timeline.events) {
    assert.deepEqual(Object.keys(event).sort(), allowedEventKeys);
    assert.match(event.envelope_fingerprint, /^[0-9a-f]{64}$/);
  }
});
