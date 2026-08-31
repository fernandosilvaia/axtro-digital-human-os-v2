import assert from "node:assert/strict";
import test from "node:test";

const {
  acquirePublicDemoCapacity,
  PUBLIC_DEMO_MAX_IN_FLIGHT,
  PUBLIC_DEMO_RATE_LIMITS,
} = await import("../../apps/portal/src/lib/public-demo/capacity.ts");
const {
  isPublicDemoEdgePolicyAttested,
  PUBLIC_DEMO_EDGE_POLICY,
  PUBLIC_DEMO_EDGE_POLICY_ATTESTATION,
} = await import("../../apps/portal/src/lib/public-demo/edge-policy.ts");

test("public demo sheds concurrent load without a queue and releases idempotently", () => {
  const leases = [];
  for (let index = 0; index < PUBLIC_DEMO_MAX_IN_FLIGHT; index += 1) {
    const lease = acquirePublicDemoCapacity("command");
    assert.notEqual(lease, null);
    leases.push(lease);
  }
  assert.equal(acquirePublicDemoCapacity("command"), null);

  leases[0].release();
  leases[0].release();
  const replacement = acquirePublicDemoCapacity("command");
  assert.notEqual(replacement, null);
  replacement.release();
  leases.slice(1).forEach((lease) => lease.release());
});

test("public demo uses fixed per-instance request ceilings", () => {
  const limit = PUBLIC_DEMO_RATE_LIMITS.start;
  for (let index = 0; index < limit.maxRequests; index += 1) {
    const lease = acquirePublicDemoCapacity("start");
    assert.notEqual(lease, null);
    lease.release();
  }
  assert.equal(acquirePublicDemoCapacity("start"), null);
  assert.equal(limit.windowMs, 60_000);
});

test("public demo declares one exact global edge policy with no queue", () => {
  assert.deepEqual(PUBLIC_DEMO_EDGE_POLICY, {
    schema: "axtro-public-demo-edge/v3",
    scope: "global_across_replicas",
    queueDepth: 0,
    rejectStatus: 429,
    maxConcurrentRequests: 32,
    rules: [
      {
        method: "POST",
        path: "/demo/start",
        operation: "start",
        windowSeconds: 60,
        maxRequests: 120,
      },
      {
        method: "POST",
        path: "/demo/command and /demo/end",
        operation: "command_or_end",
        windowSeconds: 60,
        maxRequests: 600,
      },
      {
        method: "GET or HEAD",
        path: "/demo and /demo/*",
        operation: "read",
        windowSeconds: 60,
        maxRequests: 900,
      },
    ],
  });
  assert.equal(
    PUBLIC_DEMO_EDGE_POLICY_ATTESTATION,
    "axtro-public-demo-edge/v3;scope=global;post-start=120/60s;post-command-end=600/60s;get-head-demo=900/60s;concurrency=32;queue=0;reject=429",
  );
  assert.equal(isPublicDemoEdgePolicyAttested(PUBLIC_DEMO_EDGE_POLICY_ATTESTATION), true);
  for (const value of [undefined, "", `${PUBLIC_DEMO_EDGE_POLICY_ATTESTATION} `, "axtro-public-demo-edge/v2"]) {
    assert.equal(isPublicDemoEdgePolicyAttested(value), false);
  }
});
