import assert from "node:assert/strict";
import test from "node:test";

import { parsePublicDemoActionResult } from "../../apps/portal/src/lib/public-demo/client-result.ts";

const APPLIED = Object.freeze({
  schema_version: "2.0.0",
  outcome: "applied",
  revision: 1,
  surface: "agent",
  step: "context",
  commands_remaining: 11,
  reason_code: null,
});

test("public demo client accepts every exact result variant", () => {
  for (const result of [
    APPLIED,
    { ...APPLIED, outcome: "replayed", reason_code: "duplicate_command" },
    { ...APPLIED, outcome: "stale", reason_code: "revision_mismatch" },
    {
      schema_version: "2.0.0",
      outcome: "expired",
      revision: null,
      surface: null,
      step: null,
      commands_remaining: null,
      reason_code: "state_expired",
    },
    {
      schema_version: "2.0.0",
      outcome: "unavailable",
      revision: null,
      surface: null,
      step: null,
      commands_remaining: null,
      reason_code: "demo_unavailable",
    },
  ]) {
    assert.deepEqual(parsePublicDemoActionResult(result), result);
  }
});

test("public demo client rejects malformed or internally inconsistent results", () => {
  for (const result of [
    null,
    [],
    { ...APPLIED, schema_version: "1.0.0" },
    { ...APPLIED, commands_remaining: 1 },
    { ...APPLIED, surface: "billing" },
    { ...APPLIED, step: "free_text" },
    { ...APPLIED, reason_code: "duplicate_command" },
    { ...APPLIED, extra: true },
    { ...APPLIED, outcome: "unavailable", revision: null },
  ]) {
    assert.equal(parsePublicDemoActionResult(result), null);
  }
});
