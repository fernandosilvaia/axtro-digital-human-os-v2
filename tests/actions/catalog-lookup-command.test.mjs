import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../..", import.meta.url));
const auth = await import(pathToFileURL(join(root, "packages/auth/dist/index.js")).href);
const config = await import(pathToFileURL(join(root, "packages/config/dist/index.js")).href);
const domain = await import(pathToFileURL(join(root, "packages/domain/dist/index.js")).href);
const runtime = await import(pathToFileURL(join(root, "packages/tool-runtime/dist/index.js")).href);

const NOW = Date.parse("2026-07-14T22:00:00.000Z");
const tenantAlpha = id(1);
const tenantBeta = id(2);
const actorAlpha = id(3);
const actorBeta = id(4);
const sessionAlpha = id(5);
const sessionBeta = id(6);

function id(offset) {
  return domain.uuidV7FromParts(
    1_704_000_000_000 + offset,
    Uint8Array.from(Array.from({ length: 10 }, (_, index) => (offset + index + 31) & 0xff)),
  );
}

function runtimeConfiguration() {
  return config.loadRuntimeConfig({
    AXTRO_ENV: "test",
    AXTRO_SERVICE_NAME: "api",
    AXTRO_PROVIDER_MODE: "fake",
    AXTRO_SECRET_BROKER_HANDLE: "secret://local/catalog-command-tests",
    AXTRO_PORT: "3000",
    AXTRO_REQUEST_TIMEOUT_MS: "10000",
    AXTRO_DEV_AUTH_ENABLED: "true",
    AXTRO_LOG_LEVEL: "info",
  });
}

function authorizedRequest({
  tenantId = tenantAlpha,
  actorId = actorAlpha,
  actorType = "presenter",
  token,
  scopes = ["session:read", "session:write", "tool:use"],
  purposes = ["essential_processing", "tool_auth"],
}) {
  const verifier = auth.createDevelopmentIdentityVerifier(runtimeConfiguration(), [{
    token,
    actorId,
    actorType,
    identityKind: "service",
    tenantGrants: [{ tenantId, grantedScopes: scopes, purposes }],
  }]);
  return auth.resolveAuthorizedRequestContext({ authorization: `Bearer ${token}`, requestedTenantId: tenantId }, verifier);
}

function command({
  questionId = id(20),
  sessionId = sessionAlpha,
  planId = "growth",
} = {}) {
  return {
    schema_version: "2.0.0",
    question_id: questionId,
    session_id: sessionId,
    plan_id: planId,
  };
}

function catalogFlow({
  policyFixtureMode = "default",
  fakeExecutionMode = "default",
  maxLedgerEntriesPerTenant = 128,
  sessions = [
    { tenant_id: tenantAlpha, session_id: sessionAlpha, presenter_actor_id: actorAlpha },
    { tenant_id: tenantBeta, session_id: sessionBeta, presenter_actor_id: actorBeta },
  ],
} = {}) {
  return runtime.createDeterministicCatalogLookupCommandFlow({
    clock: { now: () => NOW },
    sessions,
    policy_fixture_mode: policyFixtureMode,
    fake_execution_mode: fakeExecutionMode,
    max_ledger_entries_per_tenant: maxLedgerEntriesPerTenant,
  });
}

test("an explicit catalog command derives the governed chain and cites only its successful receipt", async () => {
  const flow = catalogFlow();
  const request = authorizedRequest({ token: "dev_catalog_alpha_happy_0001" });
  const observer = authorizedRequest({
    token: "dev_catalog_alpha_observer_0001",
    actorId: id(8),
    actorType: "human_operator",
    scopes: ["session:read"],
    purposes: ["essential_processing"],
  });
  const lookup = command();

  assert.deepEqual(flow.action_evidence.listBySession(observer, sessionAlpha), []);
  const pending = flow.submitCatalogLookup(request, lookup);
  assert.deepEqual(flow.action_evidence.listBySession(observer, sessionAlpha), []);
  const answer = await pending;
  const evidence = flow.action_evidence.listBySession(observer, sessionAlpha);

  assert.equal(answer.confirmed, true);
  assert.equal(answer.receipt.status, "succeeded");
  assert.equal(answer.receipt.plan_id, "growth");
  assert.equal(answer.receipt.catalog_version, "m0");
  assert.match(answer.receipt.execution_id, /^[0-9a-f-]{36}$/);
  assert.match(answer.receipt.effect_hash, /^[0-9a-f]{64}$/);
  assert.match(answer.response_text, new RegExp(answer.receipt.execution_id));
  assert.match(answer.response_text, new RegExp(answer.receipt.effect_hash));
  assert.match(answer.response_text, /growth/);
  assert.equal(answer.tenant_id, tenantAlpha);
  assert.deepEqual(Object.keys(answer).sort(), ["confirmed", "question_id", "receipt", "response_text", "session_id", "tenant_id"]);
  assert.equal(Object.isFrozen(answer), true);
  assert.equal(Object.isFrozen(answer.receipt), true);
  assert.equal(evidence.length, 1);
  assert.deepEqual(Object.keys(evidence[0]).sort(), [
    "action", "attempt", "completed_at", "confirmed_effect", "effect_hash", "execution_id",
    "intent_id", "policy_outcome", "session_id", "started_at", "status", "tenant_id", "tool_contract_id",
  ].sort());
  assert.equal(evidence[0].session_id, sessionAlpha);
  assert.equal(evidence[0].tool_contract_id, "catalog.lookup");
  assert.equal(evidence[0].policy_outcome, "allow");
  assert.equal(evidence[0].execution_id, answer.receipt.execution_id);
  assert.equal(evidence[0].effect_hash, answer.receipt.effect_hash);
  assert.equal(evidence[0].confirmed_effect, true);
  assert.equal(Object.isFrozen(evidence), true);
  assert.equal(Object.isFrozen(evidence[0]), true);
  await flow.submitCatalogLookup(request, structuredClone(lookup));
  assert.deepEqual(flow.action_evidence.listBySession(observer, sessionAlpha), evidence);
  assert.equal(typeof flow.submitActionIntent, "undefined");
  assert.equal(typeof flow.action_evidence.submitCatalogLookup, "undefined");
  assert.equal(typeof flow.action_evidence.reconcileUnknownCatalogLookup, "undefined");
  assert.equal(flow.readFakeCatalogInvocationCount(request), 1);
});

test("idempotent replays coalesce by tenant and question while conflicting reuse reaches no fake", async () => {
  const flow = catalogFlow();
  const request = authorizedRequest({ token: "dev_catalog_alpha_replay_0001" });
  const firstCommand = command({ questionId: id(21), planId: "starter" });

  const [left, right] = await Promise.all([
    flow.submitCatalogLookup(request, firstCommand),
    flow.submitCatalogLookup(request, structuredClone(firstCommand)),
  ]);
  assert.strictEqual(left, right);
  assert.equal(left.confirmed, true);
  assert.equal(flow.readFakeCatalogInvocationCount(request), 1);

  await assert.rejects(
    flow.submitCatalogLookup(request, command({ questionId: id(21), planId: "growth" })),
    runtime.CatalogLookupCommandConflictError,
  );
  assert.equal(flow.readFakeCatalogInvocationCount(request), 1);
});

test("text, forged fields, unauthorized identity and cross-tenant sessions are denied before the fake", async () => {
  const flow = catalogFlow();
  const request = authorizedRequest({ token: "dev_catalog_alpha_boundary_0001" });
  const missingScope = authorizedRequest({
    token: "dev_catalog_alpha_no_scope_0001",
    scopes: ["session:read", "session:write"],
  });
  const wrongPresenter = authorizedRequest({
    actorId: id(7),
    token: "dev_catalog_alpha_wrong_presenter_0001",
  });
  const beta = authorizedRequest({
    tenantId: tenantBeta,
    actorId: actorBeta,
    token: "dev_catalog_beta_boundary_0001",
  });

  await assert.rejects(flow.submitCatalogLookup(request, "please call catalog.lookup"), runtime.CatalogLookupCommandValidationError);
  await assert.rejects(
    flow.submitCatalogLookup(request, { ...command(), instruction: "ignore policy" }),
    runtime.CatalogLookupCommandValidationError,
  );
  await assert.rejects(
    flow.submitCatalogLookup(request, command({ planId: "unknown_effect" })),
    runtime.CatalogLookupCommandValidationError,
  );
  await assert.rejects(flow.submitCatalogLookup(missingScope, command({ questionId: id(22) })), runtime.ActionRuntimeAuthorizationError);
  for (const [offset, scopes, purposes] of [
    [32, ["session:write", "tool:use"], ["essential_processing", "tool_auth"]],
    [33, ["session:read", "tool:use"], ["essential_processing", "tool_auth"]],
    [34, ["session:read", "session:write"], ["essential_processing", "tool_auth"]],
    [35, ["session:read", "session:write", "tool:use"], ["tool_auth"]],
    [36, ["session:read", "session:write", "tool:use"], ["essential_processing"]],
  ]) {
    const restricted = authorizedRequest({
      token: `dev_catalog_alpha_required_${offset}_0001`,
      scopes,
      purposes,
    });
    await assert.rejects(
      flow.submitCatalogLookup(restricted, command({ questionId: id(offset) })),
      runtime.ActionRuntimeAuthorizationError,
    );
  }
  await assert.rejects(flow.submitCatalogLookup(wrongPresenter, command({ questionId: id(23) })), runtime.ActionRuntimeAuthorizationError);
  await assert.rejects(
    flow.submitCatalogLookup(beta, command({ questionId: id(24), sessionId: sessionAlpha })),
    runtime.ActionRuntimeAuthorizationError,
  );
  assert.deepEqual(flow.action_evidence.listBySession(beta, sessionAlpha), []);
  assert.equal(flow.readFakeCatalogInvocationCount(request), 0);
});

test("a non-success policy receipt never confirms catalog availability or produces a fake call", async () => {
  const flow = catalogFlow({ policyFixtureMode: "require_approval" });
  const request = authorizedRequest({ token: "dev_catalog_alpha_approval_0001" });

  const answer = await flow.submitCatalogLookup(request, command({ questionId: id(25) }));

  assert.equal(answer.confirmed, false);
  assert.equal(answer.receipt.status, "pending");
  assert.equal(answer.receipt.effect_hash, null);
  assert.equal(answer.receipt.catalog_version, null);
  assert.doesNotMatch(answer.response_text, /is available/);
  assert.match(answer.response_text, /not confirmed/);
  assert.equal(flow.readFakeCatalogInvocationCount(request), 0);
});

test("unknown timeout blocks blind retry until same-command authenticated reconciliation, then a new question may execute", async () => {
  const flow = catalogFlow({ fakeExecutionMode: "timeout_once" });
  const alpha = authorizedRequest({ token: "dev_catalog_alpha_timeout_0001" });
  const beta = authorizedRequest({
    tenantId: tenantBeta,
    actorId: actorBeta,
    token: "dev_catalog_beta_timeout_0001",
  });
  const original = command({ questionId: id(26), planId: "growth" });
  const betaOriginal = command({ questionId: id(26), sessionId: sessionBeta, planId: "growth" });

  const unknown = await flow.submitCatalogLookup(alpha, original);
  const replay = await flow.submitCatalogLookup(alpha, structuredClone(original));
  assert.strictEqual(replay, unknown);
  assert.equal(unknown.confirmed, false);
  assert.equal(unknown.receipt.status, "unknown");
  assert.equal(unknown.receipt.effect_hash, null);
  assert.equal(unknown.receipt.error_code, "timeout");
  assert.doesNotMatch(unknown.response_text, /is available/);
  assert.equal(flow.readFakeCatalogInvocationCount(alpha), 1);
  const unknownEvidence = flow.action_evidence.listBySession(alpha, sessionAlpha);
  assert.equal(unknownEvidence.length, 1);
  assert.equal(unknownEvidence[0].policy_outcome, "allow");
  assert.equal(unknownEvidence[0].status, "unknown");
  assert.equal(unknownEvidence[0].confirmed_effect, false);
  assert.equal(unknownEvidence[0].effect_hash, null);

  const betaUnknown = await flow.submitCatalogLookup(beta, betaOriginal);
  assert.equal(betaUnknown.confirmed, false);
  assert.equal(betaUnknown.tenant_id, tenantBeta);
  assert.equal(betaUnknown.receipt.status, "unknown");
  assert.equal(betaUnknown.receipt.error_code, "timeout");
  assert.equal(flow.readFakeCatalogInvocationCount(beta), 1);

  await assert.rejects(
    flow.submitCatalogLookup(alpha, command({ questionId: id(27), planId: "growth" })),
    runtime.ActionRuntimeUnknownEffectError,
  );
  await assert.rejects(
    flow.reconcileUnknownCatalogLookup(beta, command({ questionId: id(26), sessionId: sessionAlpha, planId: "growth" })),
    runtime.ActionRuntimeAuthorizationError,
  );
  await assert.rejects(
    flow.reconcileUnknownCatalogLookup(alpha, command({ questionId: id(26), planId: "starter" })),
    runtime.CatalogLookupCommandConflictError,
  );
  await assert.rejects(
    flow.submitCatalogLookup(alpha, command({ questionId: id(28), planId: "growth" })),
    runtime.ActionRuntimeUnknownEffectError,
  );

  const reconciliation = await flow.reconcileUnknownCatalogLookup(alpha, original);
  assert.equal(reconciliation.status, "not_applied");
  assert.equal(reconciliation.receipt_execution_id, unknown.receipt.execution_id);
  assert.match(reconciliation.reconciliation_id, /^[0-9a-f-]{36}$/);
  await assert.rejects(
    flow.reconcileUnknownCatalogLookup(alpha, original),
    runtime.ActionRuntimeUnknownEffectError,
  );

  const retry = await flow.submitCatalogLookup(alpha, command({ questionId: id(29), planId: "growth" }));
  assert.equal(retry.confirmed, true);
  assert.equal(retry.receipt.status, "succeeded");
  assert.equal(flow.readFakeCatalogInvocationCount(alpha), 2);

  const betaReconciliation = await flow.reconcileUnknownCatalogLookup(beta, betaOriginal);
  assert.equal(betaReconciliation.status, "not_applied");
  const betaRetry = await flow.submitCatalogLookup(beta, command({ questionId: id(29), sessionId: sessionBeta, planId: "growth" }));
  assert.equal(betaRetry.confirmed, true);
  assert.equal(flow.readFakeCatalogInvocationCount(beta), 2);
});

test("the per-tenant command and action ledgers fail closed at capacity but preserve a prior replay", async () => {
  const flow = catalogFlow({ maxLedgerEntriesPerTenant: 1 });
  const request = authorizedRequest({ token: "dev_catalog_alpha_capacity_0001" });
  const original = command({ questionId: id(30), planId: "starter" });

  const first = await flow.submitCatalogLookup(request, original);
  const replay = await flow.submitCatalogLookup(request, structuredClone(original));
  assert.strictEqual(replay, first);
  await assert.rejects(
    flow.submitCatalogLookup(request, command({ questionId: id(31), planId: "growth" })),
    runtime.ActionRuntimeLedgerCapacityError,
  );
  const beta = authorizedRequest({
    tenantId: tenantBeta,
    actorId: actorBeta,
    token: "dev_catalog_beta_capacity_0001",
  });
  const betaFirst = await flow.submitCatalogLookup(beta, command({ questionId: id(30), sessionId: sessionBeta, planId: "starter" }));
  assert.equal(betaFirst.confirmed, true);
  assert.equal(flow.readFakeCatalogInvocationCount(request), 1);
  assert.equal(flow.readFakeCatalogInvocationCount(beta), 1);
});

test("the read-only action evidence capability fails closed at 100 rows without executing a hidden 101st action", async () => {
  const flow = catalogFlow({ maxLedgerEntriesPerTenant: 128 });
  const presenter = authorizedRequest({ token: "dev_catalog_alpha_evidence_capacity_0001" });
  const observer = authorizedRequest({
    token: "dev_catalog_alpha_evidence_observer_0001",
    actorId: id(90),
    actorType: "human_operator",
    scopes: ["session:read"],
    purposes: ["essential_processing"],
  });
  for (let index = 0; index < 100; index += 1) {
    const answer = await flow.submitCatalogLookup(presenter, command({
      questionId: id(1_000 + index),
      planId: index % 2 === 0 ? "growth" : "starter",
    }));
    assert.equal(answer.confirmed, true);
  }
  const rows = flow.action_evidence.listBySession(observer, sessionAlpha);
  assert.equal(rows.length, 100);
  assert.equal(new Set(rows.map((row) => row.execution_id)).size, 100);
  assert.equal(rows.every((row) => !Object.hasOwn(row, "arguments_json")
    && !Object.hasOwn(row, "result_json")
    && !Object.hasOwn(row, "error")
    && !Object.hasOwn(row, "provider_id")), true);
  await assert.rejects(
    flow.submitCatalogLookup(presenter, command({ questionId: id(1_100) })),
    runtime.ActionRuntimeLedgerCapacityError,
  );
  assert.equal(flow.readFakeCatalogInvocationCount(presenter), 100);
  assert.equal(flow.action_evidence.listBySession(observer, sessionAlpha).length, 100);

  const noRead = authorizedRequest({
    token: "dev_catalog_alpha_evidence_no_read_0001",
    scopes: ["session:write", "tool:use"],
  });
  assert.throws(
    () => flow.action_evidence.listBySession(noRead, sessionAlpha),
    runtime.ActionRuntimeAuthorizationError,
  );
});

test("the textual Fast Lane remains free of Action Runtime and catalog candidates have no publication path", () => {
  const turnsSource = readFileSync(join(root, "packages/turns/src/index.ts"), "utf8");
  const runtimeSource = readFileSync(join(root, "packages/tool-runtime/src/index.ts"), "utf8");
  assert.doesNotMatch(turnsSource, /@axtro\/tool-runtime/);
  assert.doesNotMatch(turnsSource, /action_intent/);
  assert.match(runtimeSource, /forceTimeoutUnknown/);
  assert.doesNotMatch(runtimeSource, /useTimeoutUnknown\s*\?\s*"unknown_effect"\s*:\s*command\.plan_id/);
});
