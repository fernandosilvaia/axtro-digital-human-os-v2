import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import test from "node:test";

import {
  authorizeProviderEffectReconciliation,
  isProviderEffectReconcilerEnabled,
  manuallyReconcileProviderEffect,
  parseManualProviderEffectReconciliation,
  reconcilePendingProviderEffects,
} from "../../apps/portal/src/lib/paid-effects/reconciler.ts";
import { stableProviderReconciliationReceiptId } from "../../apps/portal/src/lib/paid-effects/index.ts";

const routeMocks = new Map([
  ["next/server", `
    export class NextRequest {}
    export class NextResponse extends Response {
      static json(body, init = {}) {
        return new Response(JSON.stringify(body), {
          ...init,
          headers: { ...init.headers, "content-type": "application/json" },
        });
      }
    }
  `],
  ["@/lib/paid-effects/reconciler", `
    export function authorizeProviderEffectReconciliation(header, expected) {
      return expected?.length >= 24 && header === "Bearer " + expected ? "authorized" : "unauthorized";
    }
    export function parseManualProviderEffectReconciliation(value) { return value; }
    export async function manuallyReconcileProviderEffect() {
      globalThis.__providerEffectManualRouteState.rpcCalls += 1;
    }
  `],
  ["@/lib/telemetry", `export function logError() {}`],
]);

const boundedBodyModuleUrl = new URL("../../apps/portal/src/lib/http/read-bounded-body.ts", import.meta.url).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/lib/http/read-bounded-body") {
      return { url: boundedBodyModuleUrl, shortCircuit: true };
    }
    if (routeMocks.has(specifier)) {
      return { url: `provider-effect-route-mock:${encodeURIComponent(specifier)}`, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith("provider-effect-route-mock:")) {
      const specifier = decodeURIComponent(url.slice("provider-effect-route-mock:".length));
      return { format: "module", source: routeMocks.get(specifier), shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

const SECRET = "provider-effect-reconcile-secret-for-tests";
const LEASE_TOKEN = "0198f5d0-45c0-7000-8000-000000000010";
const LEASE_TOKEN_B = "0198f5d0-45c0-7000-8000-000000000011";
const LEASE_TOKEN_C = "0198f5d0-45c0-7000-8000-000000000012";
const RESERVATION_A = "0198f5d0-45c0-7000-8000-000000000001";
const RESERVATION_B = "0198f5d0-45c0-7000-8000-000000000002";
const NOW = "2026-08-13T12:00:00.000Z";

const BACKLOG = Object.freeze({
  pending: 0,
  processing: 0,
  deadLetter: 0,
  providerInFlight: 0,
  unknown: 0,
  cleanupPending: 0,
  oldestAgeSeconds: 0,
  oldestUnknownAgeSeconds: 0,
});

function row(overrides = {}) {
  return {
    reservationId: RESERVATION_A,
    providerId: "tavus",
    providerRef: "conv_cleanup_001",
    state: "cleanup_pending",
    createdAt: NOW,
    attempts: 1,
    nextAttemptAt: NOW,
    leaseToken: LEASE_TOKEN,
    ...overrides,
  };
}

function ok(data) {
  return { data, error: null };
}

function oneRowAtATime(rows) {
  let index = 0;
  return () => ok(index < rows.length ? [rows[index++]] : []);
}

function dependencies(rpc, ports = {}) {
  return {
    env: {
      TAVUS_API_KEY: "tavus_test_key",
      RECALL_API_KEY: "recall_test_key",
      RECALL_API_REGION: "us-east-1",
    },
    createClient: () => ({ rpc }),
    createLeaseToken: ports.createLeaseToken ?? (() => LEASE_TOKEN),
    createTavusPort: () => ({ endConversation: ports.endConversation ?? (async () => {}) }),
    createRecallPort: () => ({ leaveCall: ports.leaveCall ?? (async () => {}) }),
    providerTimeoutMs: ports.timeoutMs ?? 50,
    logEvent: () => {},
    logError: () => {},
  };
}

const { POST: postManualProviderEffectReconciliation } = await import(
  "../../apps/portal/src/app/api/internal/provider-effects/manual/route.ts"
);

test("manual HTTP reconciliation is unavailable and does not read a chunked body", { concurrency: false }, async () => {
  const previousSecret = process.env.PROVIDER_EFFECT_RECONCILE_SECRET;
  process.env.PROVIDER_EFFECT_RECONCILE_SECRET = SECRET;
  globalThis.__providerEffectManualRouteState = { rpcCalls: 0 };
  let pulls = 0;
  let cancelled = false;
  const chunks = [new Uint8Array(1_024), new Uint8Array(1_025), new Uint8Array(1_024)];
  const body = new ReadableStream({
    pull(controller) {
      const chunk = chunks[pulls];
      pulls += 1;
      if (chunk === undefined) controller.close();
      else controller.enqueue(chunk);
    },
    cancel() {
      cancelled = true;
    },
  }, { highWaterMark: 0 });
  try {
    const response = await postManualProviderEffectReconciliation({
      headers: new Headers({
        authorization: `Bearer ${SECRET}`,
        "content-type": "application/json",
        "transfer-encoding": "chunked",
      }),
      body,
    });
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "not_found" });
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(pulls, 0);
    assert.equal(cancelled, false);
    assert.equal(globalThis.__providerEffectManualRouteState.rpcCalls, 0);
  } finally {
    if (previousSecret === undefined) delete process.env.PROVIDER_EFFECT_RECONCILE_SECRET;
    else process.env.PROVIDER_EFFECT_RECONCILE_SECRET = previousSecret;
  }
});

test("manual HTTP reconciliation stays unavailable for malformed bodies", { concurrency: false }, async (t) => {
  const previousSecret = process.env.PROVIDER_EFFECT_RECONCILE_SECRET;
  process.env.PROVIDER_EFFECT_RECONCILE_SECRET = SECRET;
  try {
    await t.test("invalid content length", async () => {
      globalThis.__providerEffectManualRouteState = { rpcCalls: 0 };
      const response = await postManualProviderEffectReconciliation({
        headers: new Headers({
          authorization: `Bearer ${SECRET}`,
          "content-type": "application/json",
          "content-length": "not-a-number",
        }),
        body: new Response("{}").body,
      });
      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), { error: "not_found" });
      assert.equal(globalThis.__providerEffectManualRouteState.rpcCalls, 0);
    });
    await t.test("stream read failure", async () => {
      globalThis.__providerEffectManualRouteState = { rpcCalls: 0 };
      const body = new ReadableStream({
        pull(controller) {
          controller.error(new Error("client disconnected"));
        },
      });
      const response = await postManualProviderEffectReconciliation({
        headers: new Headers({
          authorization: `Bearer ${SECRET}`,
          "content-type": "application/json",
        }),
        body,
      });
      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), { error: "not_found" });
      assert.equal(globalThis.__providerEffectManualRouteState.rpcCalls, 0);
    });
  } finally {
    if (previousSecret === undefined) delete process.env.PROVIDER_EFFECT_RECONCILE_SECRET;
    else process.env.PROVIDER_EFFECT_RECONCILE_SECRET = previousSecret;
  }
});

test("reconciler auth and enable switch fail closed", () => {
  assert.equal(authorizeProviderEffectReconciliation(`Bearer ${SECRET}`, undefined), "not_configured");
  assert.equal(authorizeProviderEffectReconciliation(null, SECRET), "unauthorized");
  assert.equal(authorizeProviderEffectReconciliation("Basic ignored", SECRET), "unauthorized");
  assert.equal(authorizeProviderEffectReconciliation(`Bearer ${"x".repeat(SECRET.length)}`, SECRET), "unauthorized");
  assert.equal(authorizeProviderEffectReconciliation(`Bearer ${SECRET}`, SECRET), "authorized");
  assert.equal(isProviderEffectReconcilerEnabled({ PROVIDER_EFFECT_RECONCILER_ENABLED: "true" }), true);
  assert.equal(isProviderEffectReconcilerEnabled({ PROVIDER_EFFECT_RECONCILER_ENABLED: "false" }), false);
  assert.equal(isProviderEffectReconcilerEnabled({ PROVIDER_EFFECT_RECONCILER_ENABLED: "yes" }), false);
});

test("manual reconciliation accepts only receipt evidence and excludes tenant or actor payload", async () => {
  const valid = {
    reservationId: RESERVATION_A,
    receiptId: RESERVATION_B,
    evidence: "reconciliation_absent",
    providerReceiptRef: "tavus:lookup:not_found:20260813",
  };
  assert.deepEqual(parseManualProviderEffectReconciliation(valid), valid);
  assert.throws(() => parseManualProviderEffectReconciliation({ ...valid, tenantId: RESERVATION_B }), /exact bounded shape/);
  assert.throws(() => parseManualProviderEffectReconciliation({ ...valid, actorId: RESERVATION_B }), /exact bounded shape/);
  assert.throws(() => parseManualProviderEffectReconciliation({ ...valid, evidence: "operator_says_ok" }), /invalid/);

  const calls = [];
  const client = { rpc: async (name, parameters) => { calls.push([name, parameters]); return ok(true); } };
  await manuallyReconcileProviderEffect(valid, client);
  await manuallyReconcileProviderEffect(valid, client);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], calls[1]);
  assert.deepEqual(Object.keys(calls[0][1]).sort(), ["p_evidence", "p_provider_receipt_ref", "p_receipt_id", "p_reservation_id"]);
});

test("cleanup receipt is stable on replay and carries no tenant or actor data", async () => {
  const acknowledgements = [];
  const ended = [];
  let leaseCall = 0;
  const rpc = async (name, parameters) => {
    if (name === "portal_lease_provider_effect_reconciliation_service") {
      leaseCall += 1;
      return ok(leaseCall % 2 === 1 ? [row()] : []);
    }
    if (name === "portal_void_unleased_billing_usage_service") return ok(true);
    if (name === "portal_ack_provider_effect_reconciliation_service") {
      acknowledgements.push(parameters);
      return ok(true);
    }
    if (name === "portal_provider_effect_reconciliation_backlog_service") return ok(BACKLOG);
    throw new Error(`unexpected RPC ${name}`);
  };
  const deps = dependencies(rpc, { endConversation: async (ref) => ended.push(ref) });
  const first = await reconcilePendingProviderEffects(20, deps);
  const second = await reconcilePendingProviderEffects(20, deps);

  assert.equal(first.reconciled, 1);
  assert.equal(second.reconciled, 1);
  assert.deepEqual(ended, ["conv_cleanup_001", "conv_cleanup_001"]);
  assert.equal(acknowledgements[0].p_provider_receipt_ref, "tavus:end:conv_cleanup_001");
  assert.equal(
    acknowledgements[0].p_receipt_id,
    stableProviderReconciliationReceiptId(RESERVATION_A, "compensation_confirmed", "tavus:end:conv_cleanup_001"),
  );
  assert.deepEqual(acknowledgements[0], acknowledgements[1]);
  assert.equal("p_tenant_id" in acknowledgements[0], false);
  assert.equal("p_actor_id" in acknowledgements[0], false);
});

test("one provider failure and ack false are isolated from the next leased row", async () => {
  const failures = [];
  const acknowledgements = [];
  const nextLease = oneRowAtATime([
    row(),
    row({ reservationId: RESERVATION_B, providerRef: "conv_cleanup_002" }),
  ]);
  const rpc = async (name, parameters) => {
    if (name === "portal_lease_provider_effect_reconciliation_service") return nextLease();
    if (name === "portal_void_unleased_billing_usage_service") return ok(true);
    if (name === "portal_ack_provider_effect_reconciliation_service") {
      acknowledgements.push(parameters);
      return ok(parameters.p_reservation_id === RESERVATION_B);
    }
    if (name === "portal_fail_provider_effect_reconciliation_service") {
      failures.push(parameters);
      return ok(true);
    }
    if (name === "portal_provider_effect_reconciliation_backlog_service") return ok({ ...BACKLOG, pending: 1, cleanupPending: 1 });
    throw new Error(`unexpected RPC ${name}`);
  };

  const result = await reconcilePendingProviderEffects(20, dependencies(rpc));
  assert.equal(result.leased, 2);
  assert.equal(result.reconciled, 1);
  assert.equal(result.failed, 1);
  assert.equal(acknowledgements.length, 2);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].p_reservation_id, RESERVATION_A);
  assert.equal(failures[0].p_permanent, false);
});

test("an identifiable malformed leased row is dead-lettered without blocking a valid row", async () => {
  const failures = [];
  const nextLease = oneRowAtATime([
    row({ providerId: "untrusted-provider" }),
    row({ reservationId: RESERVATION_B, providerRef: "conv_cleanup_002" }),
  ]);
  const rpc = async (name, parameters) => {
    if (name === "portal_lease_provider_effect_reconciliation_service") return nextLease();
    if (name === "portal_void_unleased_billing_usage_service") return ok(true);
    if (name === "portal_fail_provider_effect_reconciliation_service") {
      failures.push(parameters);
      return ok(true);
    }
    if (name === "portal_ack_provider_effect_reconciliation_service") return ok(true);
    if (name === "portal_provider_effect_reconciliation_backlog_service") return ok({ ...BACKLOG, deadLetter: 1 });
    throw new Error(`unexpected RPC ${name}`);
  };

  const result = await reconcilePendingProviderEffects(20, dependencies(rpc));
  assert.equal(result.leased, 2);
  assert.equal(result.deadLettered, 1);
  assert.equal(result.reconciled, 1);
  assert.equal(failures[0].p_reservation_id, RESERVATION_A);
  assert.equal(failures[0].p_error_code, "invalid_reconciliation_row");
  assert.equal(failures[0].p_permanent, true);
});

test("provider timeout persists a retry and never acknowledges or releases the barrier", async () => {
  const calls = [];
  const nextLease = oneRowAtATime([row()]);
  const rpc = async (name, parameters) => {
    calls.push([name, parameters]);
    if (name === "portal_lease_provider_effect_reconciliation_service") return nextLease();
    if (name === "portal_void_unleased_billing_usage_service") return ok(true);
    if (name === "portal_fail_provider_effect_reconciliation_service") return ok(true);
    if (name === "portal_provider_effect_reconciliation_backlog_service") return ok({ ...BACKLOG, pending: 1, cleanupPending: 1 });
    throw new Error(`unexpected RPC ${name}`);
  };
  const result = await reconcilePendingProviderEffects(20, dependencies(rpc, {
    timeoutMs: 10,
    endConversation: () => new Promise(() => {}),
  }));
  assert.equal(result.failed, 1);
  assert.equal(calls.some(([name]) => name === "portal_ack_provider_effect_reconciliation_service"), false);
  assert.equal(calls.some(([name]) => name === "portal_reconcile_provider_effect_service"), false);
  const failure = calls.find(([name]) => name === "portal_fail_provider_effect_reconciliation_service")[1];
  assert.equal(failure.p_error_code, "provider_timeout");
  assert.equal(failure.p_permanent, false);
});

test("leased or unavailable billing cannot release cleanup and provider termination is not replayed by the worker", async () => {
  const calls = [];
  let terminations = 0;
  const nextLease = oneRowAtATime([row()]);
  const rpc = async (name, parameters) => {
    calls.push([name, parameters]);
    if (name === "portal_lease_provider_effect_reconciliation_service") return nextLease();
    if (name === "portal_void_unleased_billing_usage_service") return ok(false);
    if (name === "portal_fail_provider_effect_reconciliation_service") return ok(true);
    if (name === "portal_provider_effect_reconciliation_backlog_service") {
      return ok({ ...BACKLOG, pending: 1, cleanupPending: 1 });
    }
    throw new Error(`unexpected RPC ${name}`);
  };

  const result = await reconcilePendingProviderEffects(20, dependencies(rpc, {
    endConversation: async () => { terminations += 1; },
  }));
  assert.equal(result.failed, 1);
  assert.equal(terminations, 0);
  assert.equal(calls.some(([name]) => name === "portal_ack_provider_effect_reconciliation_service"), false);
  const failure = calls.find(([name]) => name === "portal_fail_provider_effect_reconciliation_service")[1];
  assert.equal(failure.p_error_code, "billing_void_unavailable");
  assert.equal(failure.p_permanent, false);
});

test("slow rows receive independent single-row leases instead of sharing one expiring batch", async () => {
  const leaseParameters = [];
  const events = [];
  let leaseIndex = 0;
  let fakeNow = 0;
  const tokens = [LEASE_TOKEN, LEASE_TOKEN_B, LEASE_TOKEN_C];
  const rows = [
    row({ leaseToken: LEASE_TOKEN }),
    row({ reservationId: RESERVATION_B, providerRef: "conv_cleanup_002", leaseToken: LEASE_TOKEN_B }),
  ];
  const rpc = async (name, parameters) => {
    if (name === "portal_lease_provider_effect_reconciliation_service") {
      leaseParameters.push(parameters);
      events.push(["lease", fakeNow, parameters.p_lease_token]);
      const leasedRow = rows[leaseIndex];
      leaseIndex += 1;
      return ok(leasedRow ? [leasedRow] : []);
    }
    if (name === "portal_void_unleased_billing_usage_service") return ok(true);
    if (name === "portal_ack_provider_effect_reconciliation_service") {
      events.push(["ack", fakeNow, parameters.p_lease_token]);
      return ok(true);
    }
    if (name === "portal_provider_effect_reconciliation_backlog_service") return ok(BACKLOG);
    throw new Error(`unexpected RPC ${name}`);
  };
  let tokenIndex = 0;
  const result = await reconcilePendingProviderEffects(20, dependencies(rpc, {
    createLeaseToken: () => tokens[tokenIndex++],
    endConversation: async () => { fakeNow += 70_000; },
  }));

  assert.equal(result.leased, 2);
  assert.equal(result.reconciled, 2);
  assert.deepEqual(leaseParameters.map((parameters) => parameters.p_limit), [1, 1, 1]);
  assert.deepEqual(events, [
    ["lease", 0, LEASE_TOKEN],
    ["ack", 70_000, LEASE_TOKEN],
    ["lease", 70_000, LEASE_TOKEN_B],
    ["ack", 140_000, LEASE_TOKEN_B],
    ["lease", 140_000, LEASE_TOKEN_C],
  ]);
});

test("unknown without a provider ref requires operator evidence and is never auto-released", async () => {
  const calls = [];
  const nextLease = oneRowAtATime([row({ providerRef: null, state: "unknown", attempts: 8 })]);
  const rpc = async (name, parameters) => {
    calls.push([name, parameters]);
    if (name === "portal_lease_provider_effect_reconciliation_service") return nextLease();
    if (name === "portal_fail_provider_effect_reconciliation_service") return ok(true);
    if (name === "portal_provider_effect_reconciliation_backlog_service") {
      return ok({ ...BACKLOG, deadLetter: 1, unknown: 1, oldestUnknownAgeSeconds: 3600 });
    }
    throw new Error(`unexpected RPC ${name}`);
  };
  const result = await reconcilePendingProviderEffects(20, dependencies(rpc));
  assert.equal(result.operatorRequired, 1);
  assert.equal(result.deadLettered, 1);
  assert.equal(result.oldestUnknownAgeSeconds, 3600);
  assert.equal(calls.some(([name]) => name === "portal_ack_provider_effect_reconciliation_service"), false);
  const failure = calls.find(([name]) => name === "portal_fail_provider_effect_reconciliation_service")[1];
  assert.equal(failure.p_error_code, "operator_evidence_required");
  assert.equal(failure.p_permanent, true);
});

test("fail data=false is observable after the remaining rows are isolated", async () => {
  const nextLease = oneRowAtATime([row()]);
  const rpc = async (name) => {
    if (name === "portal_lease_provider_effect_reconciliation_service") return nextLease();
    if (name === "portal_void_unleased_billing_usage_service") return ok(true);
    if (name === "portal_ack_provider_effect_reconciliation_service") return ok(false);
    if (name === "portal_fail_provider_effect_reconciliation_service") return ok(false);
    if (name === "portal_provider_effect_reconciliation_backlog_service") return ok(BACKLOG);
    throw new Error(`unexpected RPC ${name}`);
  };
  await assert.rejects(
    () => reconcilePendingProviderEffects(20, dependencies(rpc)),
    /unpersisted row failures/,
  );
});

test("scheduled operation is periodic, protected, bounded and fail-closed", async () => {
  const workflow = await readFile(new URL("../../.github/workflows/provider-effect-reconcile.yml", import.meta.url), "utf8");
  assert.match(workflow, /schedule:\s*\n\s*- cron: ['"]\*\/5 \* \* \* \*['"]/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /github\.event_name == 'workflow_dispatch' \|\| vars\.PROVIDER_EFFECT_RECONCILE_SCHEDULE_ENABLED == 'true'/);
  assert.match(workflow, /provider-effects\/reconcile\$/);
  assert.match(workflow, /PROVIDER_EFFECT_RECONCILE_SECRET is not configured/);
  assert.match(workflow, /Authorization: Bearer \$\{PROVIDER_EFFECT_RECONCILE_SECRET\}/);
  assert.match(workflow, /--max-time 90/);
  assert.doesNotMatch(workflow, /^\s*--retry\b/m);
  assert.match(workflow, /jq -e -f scripts\/worker-response-gate\.jq/);
  const automaticRoute = await readFile(new URL("../../apps/portal/src/app/api/internal/provider-effects/reconcile/route.ts", import.meta.url), "utf8");
  const manualRoute = await readFile(new URL("../../apps/portal/src/app/api/internal/provider-effects/manual/route.ts", import.meta.url), "utf8");
  assert.match(automaticRoute, /isProviderEffectReconcilerEnabled\(env\)/);
  assert.match(automaticRoute, /PROVIDER_EFFECT_RECONCILE_SECRET/);
  assert.match(automaticRoute, /AUTOMATIC_RECONCILIATION_LIMIT = 3/);
  assert.match(automaticRoute, /reconcilePendingProviderEffects\)\(AUTOMATIC_RECONCILIATION_LIMIT\)/);
  assert.match(manualRoute, /Intentionally unavailable/);
  assert.match(manualRoute, /status: 404/);
  assert.doesNotMatch(manualRoute, /PROVIDER_EFFECT_RECONCILE_SECRET|manuallyReconcileProviderEffect/);
  assert.doesNotMatch(manualRoute, /tenantId|actorId/);
});
