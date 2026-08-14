import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

const heartbeatModuleUrl = new URL(
  "../../apps/portal/src/lib/workers/heartbeat.ts",
  import.meta.url,
).href;

const mockSources = new Map([
  ["next/server", `
    export class NextRequest {}
    export class NextResponse extends Response {
      static json(body, init = {}) {
        const headers = new Headers(init.headers);
        headers.set("content-type", "application/json");
        return new NextResponse(JSON.stringify(body), { ...init, headers });
      }
    }
  `],
  ["@/lib/billing/usage-outbox", `
    export function isBillingUsageDispatchEnabled(env) { return env.BILLING_USAGE_OUTBOX_ENABLED === "true"; }
    export function authorizeBillingDispatch(header, secret) {
      if (!secret || secret.length < 24) return "not_configured";
      return header === "Bearer " + secret ? "authorized" : "unauthorized";
    }
    export async function dispatchBillingUsageOutbox() { throw new Error("test must inject dispatch"); }
  `],
  ["@/lib/paid-effects/reconciler", `
    export function isProviderEffectReconcilerEnabled(env) { return env.PROVIDER_EFFECT_RECONCILER_ENABLED === "true"; }
    export function authorizeProviderEffectReconciliation(header, secret) {
      if (!secret || secret.length < 24) return "not_configured";
      return header === "Bearer " + secret ? "authorized" : "unauthorized";
    }
    export async function reconcilePendingProviderEffects() { throw new Error("test must inject reconciliation"); }
  `],
  ["@/lib/supabase/service", `
    export function createServiceRoleClient() { return globalThis.__workerHeartbeatClient; }
  `],
  ["@/lib/telemetry", `export function logError() {}`],
]);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/lib/workers/heartbeat") return { url: heartbeatModuleUrl, shortCircuit: true };
    if (mockSources.has(specifier)) {
      return { url: `worker-heartbeat-mock:${encodeURIComponent(specifier)}`, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith("worker-heartbeat-mock:")) {
      const specifier = decodeURIComponent(url.slice("worker-heartbeat-mock:".length));
      return { format: "module", source: mockSources.get(specifier), shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

const {
  PORTAL_FINANCIAL_WORKER_VERSION,
  financialWorkerRunSucceeded,
  portalFinancialWorkerIdentity,
  recordWorkerHeartbeat,
} = await import("../../apps/portal/src/lib/workers/heartbeat.ts");
const { handleBillingUsageDispatch } = await import(
  "../../apps/portal/src/app/api/internal/billing-usage/route.ts"
);
const { handleProviderEffectReconciliation } = await import(
  "../../apps/portal/src/app/api/internal/provider-effects/reconcile/route.ts"
);

const RUN_ID = "0198f5d0-45c0-7000-8000-000000000100";
const SECRET = "worker-route-secret-for-tests";
const REQUEST = Object.freeze({ headers: new Headers({ authorization: `Bearer ${SECRET}` }) });
const WORKER_ENV = Object.freeze({
  AXTRO_DEPLOYMENT_ID: "deployment-worker-tests-20260813",
  PORTAL_FAKE_PROVIDERS: "0",
  BILLING_USAGE_OUTBOX_ENABLED: "true",
  BILLING_DISPATCH_SECRET: SECRET,
  STRIPE_SECRET_KEY: "sk_test_worker_routes",
  STRIPE_CONVERSATION_OVERAGE_EVENT_NAME: "axtro_conversation_overage",
  STRIPE_PRICE_PILOTO_BASE: "price_piloto_base",
  STRIPE_PRICE_PILOTO_OVERAGE: "price_piloto_overage",
  STRIPE_PRICE_CRESCIMENTO_BASE: "price_crescimento_base",
  STRIPE_PRICE_CRESCIMENTO_OVERAGE: "price_crescimento_overage",
  STRIPE_PRICE_ESCALA_BASE: "price_escala_base",
  STRIPE_PRICE_ESCALA_OVERAGE: "price_escala_overage",
  PROVIDER_EFFECT_RECONCILER_ENABLED: "true",
  PROVIDER_EFFECT_RECONCILE_SECRET: SECRET,
  RECALL_API_REGION: "us-west-2",
});
const BILLING_IDENTITY = portalFinancialWorkerIdentity("billing_usage", { ...WORKER_ENV });
const RECONCILER_IDENTITY = portalFinancialWorkerIdentity("provider_effect_reconciler", { ...WORKER_ENV });

const BILLING_RESULT = Object.freeze({
  catalogVerified: true,
  leased: 2,
  delivered: 2,
  failed: 0,
  deadLettered: 0,
  backlog: 0,
  oldestAgeSeconds: 0,
  deadLetterBacklog: 0,
  held: 1,
  oldestHeldAgeSeconds: 10,
  providerInFlight: 0,
  unknown: 0,
  cleanupPending: 0,
  oldestProviderPendingAgeSeconds: 0,
});

const RECONCILIATION_RESULT = Object.freeze({
  leased: 1,
  reconciled: 1,
  failed: 0,
  deadLettered: 0,
  operatorRequired: 0,
  backlog: 0,
  processing: 0,
  deadLetterBacklog: 0,
  providerInFlight: 0,
  unknown: 0,
  cleanupPending: 0,
  oldestAgeSeconds: 0,
  oldestUnknownAgeSeconds: 0,
});

test("heartbeat RPC requires UUIDv7, safe counters and a strict true receipt", async () => {
  const calls = [];
  const client = {
    rpc: async (name, parameters) => {
      calls.push([name, parameters]);
      return { data: true, error: null };
    },
  };
  const dependencies = { createClient: () => client };
  await recordWorkerHeartbeat("billing_usage", RUN_ID, "started", {}, BILLING_IDENTITY, dependencies);
  await recordWorkerHeartbeat("billing_usage", RUN_ID, "succeeded", { delivered: 2, unknown: 0 }, BILLING_IDENTITY, dependencies);
  assert.equal(calls[0][0], "portal_record_worker_heartbeat_service");
  assert.deepEqual(calls[0][1], {
    p_worker_kind: "billing_usage",
    p_run_id: RUN_ID,
    p_phase: "started",
    p_version: PORTAL_FINANCIAL_WORKER_VERSION,
    p_deployment_id: BILLING_IDENTITY.deploymentId,
    p_config_fingerprint: BILLING_IDENTITY.configFingerprint,
    p_counters: {},
  });
  assert.deepEqual(calls[1][1].p_counters, { delivered: 2, unknown: 0 });

  await assert.rejects(
    () => recordWorkerHeartbeat("billing_usage", "not-a-uuid", "started", {}, BILLING_IDENTITY),
    /UUIDv7/,
  );
  await assert.rejects(
    () => recordWorkerHeartbeat("billing_usage", RUN_ID, "failed", { failed: 1 }, BILLING_IDENTITY),
    /cannot carry counters/,
  );
  await assert.rejects(
    () => recordWorkerHeartbeat("billing_usage", RUN_ID, "succeeded", { tenantId: 1 }, BILLING_IDENTITY),
    /not allowed/,
  );

  const ambiguous = { createClient: () => ({ rpc: async () => ({ data: { ok: true }, error: null }) }) };
  await assert.rejects(
    () => recordWorkerHeartbeat("billing_usage", RUN_ID, "started", {}, BILLING_IDENTITY, ambiguous),
    /receipt was not applied/,
  );
  await assert.rejects(
    () => recordWorkerHeartbeat("billing_usage", RUN_ID, "started", {}, {
      ...BILLING_IDENTITY,
      deploymentId: "short",
    }),
    /identity is invalid/,
  );
});

test("deployment and configuration fingerprints are deterministic, scoped and non-secret", () => {
  const same = portalFinancialWorkerIdentity("billing_usage", { ...WORKER_ENV });
  assert.deepEqual(same, BILLING_IDENTITY);
  assert.match(same.configFingerprint, /^sha256:[a-f0-9]{64}$/);
  assert.equal(same.configFingerprint.includes(WORKER_ENV.STRIPE_SECRET_KEY), false);

  const rotatedSecret = portalFinancialWorkerIdentity("billing_usage", {
    ...WORKER_ENV,
    STRIPE_SECRET_KEY: "sk_test_rotated_but_same_mode",
  });
  assert.equal(rotatedSecret.configFingerprint, same.configFingerprint);
  const changedCatalog = portalFinancialWorkerIdentity("billing_usage", {
    ...WORKER_ENV,
    STRIPE_PRICE_ESCALA_OVERAGE: "price_changed",
  });
  assert.notEqual(changedCatalog.configFingerprint, same.configFingerprint);
  const changedRegion = portalFinancialWorkerIdentity("provider_effect_reconciler", {
    ...WORKER_ENV,
    RECALL_API_REGION: "eu-central-1",
  });
  assert.notEqual(changedRegion.configFingerprint, RECONCILER_IDENTITY.configFingerprint);
  assert.notEqual(BILLING_IDENTITY.configFingerprint, RECONCILER_IDENTITY.configFingerprint);
  assert.equal(portalFinancialWorkerIdentity("billing_usage", {
    ...WORKER_ENV,
    RAILWAY_GIT_COMMIT_SHA: "1234567890abcdef1234567890abcdef12345678",
  }).deploymentId, "1234567890abcdef1234567890abcdef12345678");
  assert.equal(portalFinancialWorkerIdentity("billing_usage", {
    PORTAL_FAKE_PROVIDERS: "1",
  }).deploymentId, "fake-mode");
});

test("financial success predicate requires complete integer counters with no unresolved failures", () => {
  assert.equal(financialWorkerRunSucceeded("billing_usage", {
    catalogVerified: true,
    leased: 1,
    delivered: 1,
    failed: 0,
    deadLettered: 0,
    backlog: 0,
    deadLetterBacklog: 0,
    held: 0,
    providerInFlight: 0,
    unknown: 0,
    cleanupPending: 0,
  }), true);
  assert.equal(financialWorkerRunSucceeded("billing_usage", {
    ...BILLING_RESULT,
    unknown: 1,
  }), false);
  assert.equal(financialWorkerRunSucceeded("provider_effect_reconciler", {
    ...RECONCILIATION_RESULT,
    operatorRequired: 1,
  }), false);
  assert.equal(financialWorkerRunSucceeded("provider_effect_reconciler", {
    ...RECONCILIATION_RESULT,
    reconciled: undefined,
  }), false);
});

test("billing route records started then succeeded with aggregate-only counters", async () => {
  const phases = [];
  const response = await handleBillingUsageDispatch(REQUEST, {
    env: { ...WORKER_ENV },
    createRunId: () => RUN_ID,
    dispatch: async () => BILLING_RESULT,
    recordHeartbeat: async (worker, runId, phase, counters = {}, identity) => phases.push({ worker, runId, phase, counters, identity }),
    logError: () => {},
  });
  assert.equal(response.status, 200);
  assert.deepEqual(phases.map(({ phase }) => phase), ["started", "succeeded"]);
  assert.equal(phases[1].runId, RUN_ID);
  assert.deepEqual(phases[0].identity, BILLING_IDENTITY);
  assert.deepEqual(phases[1].identity, BILLING_IDENTITY);
  assert.deepEqual(Object.keys(phases[1].counters).sort(), [
    "backlog", "catalogVerified", "cleanupPending", "deadLetterBacklog", "deadLettered",
    "delivered", "failed", "held", "leased", "providerInFlight", "unknown",
  ]);
});

test("billing route does no work when the started heartbeat is not durable", async () => {
  let dispatchCalls = 0;
  const response = await handleBillingUsageDispatch(REQUEST, {
    env: { ...WORKER_ENV },
    createRunId: () => RUN_ID,
    dispatch: async () => { dispatchCalls += 1; return BILLING_RESULT; },
    recordHeartbeat: async () => { throw new Error("heartbeat unavailable"); },
    logError: () => {},
  });
  assert.equal(response.status, 503);
  assert.equal(dispatchCalls, 0);
});

test("billing route records failed after work or success-heartbeat errors", async () => {
  for (const failureAt of ["work", "succeeded"]) {
    const phases = [];
    const response = await handleBillingUsageDispatch(REQUEST, {
      env: { ...WORKER_ENV },
      createRunId: () => RUN_ID,
      dispatch: async () => {
        if (failureAt === "work") throw new Error("dispatch failed");
        return BILLING_RESULT;
      },
      recordHeartbeat: async (_worker, _runId, phase) => {
        phases.push(phase);
        if (failureAt === "succeeded" && phase === "succeeded") throw new Error("receipt missing");
      },
      logError: () => {},
    });
    assert.equal(response.status, 503);
    assert.deepEqual(phases, failureAt === "work" ? ["started", "failed"] : ["started", "succeeded", "failed"]);
  }
});

test("worker routes fail closed before financial work when deployment identity is absent", async () => {
  let dispatchCalls = 0;
  let reconcileCalls = 0;
  let heartbeatCalls = 0;
  const env = { ...WORKER_ENV, AXTRO_DEPLOYMENT_ID: "", RAILWAY_GIT_COMMIT_SHA: "" };
  const response = await handleBillingUsageDispatch(REQUEST, {
    env,
    createRunId: () => RUN_ID,
    dispatch: async () => { dispatchCalls += 1; return BILLING_RESULT; },
    recordHeartbeat: async () => { heartbeatCalls += 1; },
    logError: () => {},
  });
  assert.equal(response.status, 503);
  assert.equal(dispatchCalls, 0);
  assert.equal(heartbeatCalls, 0);

  const reconciliationResponse = await handleProviderEffectReconciliation(REQUEST, {
    env,
    createRunId: () => RUN_ID,
    reconcile: async () => { reconcileCalls += 1; return RECONCILIATION_RESULT; },
    recordHeartbeat: async () => { heartbeatCalls += 1; },
    logError: () => {},
  });
  assert.equal(reconciliationResponse.status, 503);
  assert.equal(reconcileCalls, 0);
  assert.equal(heartbeatCalls, 0);
});

test("financial failure counters record failed and return 503", async () => {
  for (const resultPatch of [
    { failed: 1 },
    { deadLettered: 1 },
    { deadLetterBacklog: 1 },
    { unknown: 1 },
    { cleanupPending: 1 },
    { delivered: undefined },
  ]) {
    const phases = [];
    const response = await handleBillingUsageDispatch(REQUEST, {
      env: { ...WORKER_ENV },
      createRunId: () => RUN_ID,
      dispatch: async () => ({ ...BILLING_RESULT, ...resultPatch }),
      recordHeartbeat: async (_worker, _runId, phase) => phases.push(phase),
      logError: () => {},
    });
    assert.equal(response.status, 503);
    assert.deepEqual(phases, ["started", "failed"]);
  }
});

test("provider-effect route uses the same run and fails closed on heartbeat errors", async () => {
  const phases = [];
  const base = {
    env: { ...WORKER_ENV },
    createRunId: () => RUN_ID,
    reconcile: async (limit) => {
      assert.equal(limit, 3);
      return RECONCILIATION_RESULT;
    },
    logError: () => {},
  };
  const success = await handleProviderEffectReconciliation(REQUEST, {
    ...base,
    recordHeartbeat: async (worker, runId, phase, counters = {}, identity) => phases.push({ worker, runId, phase, counters, identity }),
  });
  assert.equal(success.status, 200);
  assert.deepEqual(phases.map(({ phase }) => phase), ["started", "succeeded"]);
  assert.ok(phases.every(({ worker, runId }) => worker === "provider_effect_reconciler" && runId === RUN_ID));
  assert.ok(phases.every(({ identity }) => JSON.stringify(identity) === JSON.stringify(RECONCILER_IDENTITY)));

  let reconciliationCalls = 0;
  const failed = await handleProviderEffectReconciliation(REQUEST, {
    ...base,
    reconcile: async () => { reconciliationCalls += 1; return RECONCILIATION_RESULT; },
    recordHeartbeat: async () => { throw new Error("heartbeat unavailable"); },
  });
  assert.equal(failed.status, 503);
  assert.equal(reconciliationCalls, 0);
});

test("provider reconciliation unresolved counters never record succeeded", async () => {
  for (const resultPatch of [
    { failed: 1 },
    { deadLettered: 1 },
    { deadLetterBacklog: 1 },
    { unknown: 1 },
    { cleanupPending: 1 },
    { operatorRequired: 1 },
    { reconciled: undefined },
  ]) {
    const phases = [];
    const response = await handleProviderEffectReconciliation(REQUEST, {
      env: { ...WORKER_ENV },
      createRunId: () => RUN_ID,
      reconcile: async () => ({ ...RECONCILIATION_RESULT, ...resultPatch }),
      recordHeartbeat: async (_worker, _runId, phase) => phases.push(phase),
      logError: () => {},
    });
    assert.equal(response.status, 503);
    assert.deepEqual(phases, ["started", "failed"]);
  }
});
