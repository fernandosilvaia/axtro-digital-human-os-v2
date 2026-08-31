import assert from "node:assert/strict";
import test from "node:test";

import { readinessConfig } from "../../apps/portal/src/app/api/ready/checks.ts";
import { PUBLIC_DEMO_EDGE_POLICY_ATTESTATION } from "../../apps/portal/src/lib/public-demo/edge-policy.ts";

const SECRET = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";

test("readiness keeps a disabled demo healthy and requires the complete rollout gate when enabled", () => {
  assert.equal(readinessConfig({}).public_demo_rollout_gate, true);

  for (const env of [
    { PORTAL_PUBLIC_DEMO_STATE_SECRET: SECRET },
    { PORTAL_PUBLIC_DEMO_EDGE_POLICY_ATTESTATION: PUBLIC_DEMO_EDGE_POLICY_ATTESTATION },
    {
      PORTAL_PUBLIC_DEMO_STATE_SECRET: SECRET,
      PORTAL_PUBLIC_DEMO_EDGE_POLICY_ATTESTATION: "axtro-public-demo-edge/v0",
    },
    {
      PORTAL_PUBLIC_DEMO_STATE_SECRET: "a".repeat(64),
      PORTAL_PUBLIC_DEMO_EDGE_POLICY_ATTESTATION: PUBLIC_DEMO_EDGE_POLICY_ATTESTATION,
    },
  ]) {
    assert.equal(readinessConfig(env).public_demo_rollout_gate, false, JSON.stringify(env));
  }

  assert.equal(readinessConfig({
    PORTAL_PUBLIC_DEMO_STATE_SECRET: SECRET,
    PORTAL_PUBLIC_DEMO_EDGE_POLICY_ATTESTATION: PUBLIC_DEMO_EDGE_POLICY_ATTESTATION,
  }).public_demo_rollout_gate, true);
});
