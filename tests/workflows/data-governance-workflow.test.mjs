import assert from "node:assert/strict";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../..", import.meta.url));
const auth = await import(pathToFileURL(join(root, "packages/auth/dist/index.js")).href);
const config = await import(pathToFileURL(join(root, "packages/config/dist/index.js")).href);
const domain = await import(pathToFileURL(join(root, "packages/domain/dist/index.js")).href);
const workflows = await import(pathToFileURL(join(root, "packages/workflows/dist/index.js")).href);
const workerRuntime = await import(pathToFileURL(join(root, "apps/workflow-worker/dist/index.js")).href);

const tenantAlpha = id(1);
const tenantBeta = id(2);
const actorAlpha = id(3);
const actorBeta = id(4);

function id(offset) {
  return domain.uuidV7FromParts(
    1_701_000_000_000 + offset,
    Uint8Array.from(Array.from({ length: 10 }, (_, index) => (offset + index + 71) & 0xff)),
  );
}

function runtimeConfiguration() {
  return config.loadRuntimeConfig({
    AXTRO_ENV: "test",
    AXTRO_SERVICE_NAME: "workflow-worker",
    AXTRO_PROVIDER_MODE: "fake",
    AXTRO_SECRET_BROKER_HANDLE: "secret://local/data-governance-test",
    AXTRO_PORT: "3000",
    AXTRO_REQUEST_TIMEOUT_MS: "10000",
    AXTRO_DEV_AUTH_ENABLED: "true",
    AXTRO_LOG_LEVEL: "info",
  });
}

function authorizedRequest({ tenantId = tenantAlpha, actorId = actorAlpha, token = "dev_governance_alpha_0001" } = {}) {
  const verifier = auth.createDevelopmentIdentityVerifier(runtimeConfiguration(), [{
    token,
    actorId,
    actorType: "workflow",
    identityKind: "service",
    tenantGrants: [{
      tenantId,
      grantedScopes: ["workflow:dispatch", "workflow:execute", "workflow:observe"],
      purposes: ["essential_processing"],
    }],
  }]);
  return auth.resolveAuthorizedRequestContext({ authorization: `Bearer ${token}`, requestedTenantId: tenantId }, verifier);
}

function receiptIds(base = 1_000) {
  return Array.from({ length: 128 }, (_, index) => id(base + index));
}

function fixture({ base = 1_000 } = {}) {
  const clock = workflows.createManualDataGovernanceClock("2026-08-31T12:00:00.000Z");
  const repository = workflows.createInMemoryDataGovernanceRepository({
    clock,
    id_factory: workflows.createDeterministicDataGovernanceIdFactory(receiptIds(base)),
  });
  return { clock, repository };
}

function command({ tenantId = tenantAlpha, requestId = id(100), commandId = id(101), actorId = actorAlpha, commandType = "request_deletion", requestedAction = "irreversible_delete", scopeType = "tenant", dataSubjectId = null } = {}) {
  const value = {
    schema_version: "2.0.0",
    governance_version: "1.0.0",
    command_id: commandId,
    request_id: requestId,
    tenant_id: tenantId,
    command_type: commandType,
    scope_type: scopeType,
    data_subject_id: dataSubjectId,
    requested_action: requestedAction,
    actor_id: actorId,
    policy_decision_id: commandType === "authorize_execution" ? id(102) : null,
    approval_ids: commandType === "authorize_execution"
      ? scopeType === "tenant" ? [id(102), id(103)] : [id(102)]
      : [],
    policy_version: "1.0.0",
    inventory_version: "1.0.0",
    request_fingerprint: "0".repeat(64),
    idempotency_key: `data-governance/v1/${tenantId}/${requestId}/${commandId}`,
    trace_id: "1".repeat(32),
    correlation_id: id(104),
    causation_id: null,
    issued_at: "2026-08-31T11:59:00.000Z",
    authorization_expires_at: commandType === "authorize_execution" ? "2026-09-01T12:00:00.000Z" : null,
    data_classification: "internal",
  };
  value.request_fingerprint = workflows.dataGovernanceRequestFingerprint(value);
  return value;
}

function authorizationCommand(rootCommand, commandId = id(500)) {
  return command({
    tenantId: rootCommand.tenant_id,
    requestId: rootCommand.request_id,
    commandId,
    actorId: rootCommand.actor_id,
    commandType: "authorize_execution",
    requestedAction: rootCommand.requested_action,
    scopeType: rootCommand.scope_type,
    dataSubjectId: rootCommand.data_subject_id,
  });
}

function cancellationCommand(rootCommand, commandId = id(501)) {
  return command({
    tenantId: rootCommand.tenant_id,
    requestId: rootCommand.request_id,
    commandId,
    actorId: rootCommand.actor_id,
    commandType: "cancel_request",
    requestedAction: rootCommand.requested_action,
    scopeType: rootCommand.scope_type,
    dataSubjectId: rootCommand.data_subject_id,
  });
}

function item({ tenantId = tenantAlpha, requestId = id(100), workItemId = id(200), surface = "database", action } = {}) {
  const resolvedAction = action ?? (surface === "cache" ? "cache_invalidate" : surface === "backup" ? "backup_expiry_wait" : ["object_storage", "embedding_index", "provider_copy", "auth_identity", "vault_secret"].includes(surface) ? "external_delete" : "irreversible_delete");
  return {
    schema_version: "2.0.0",
    governance_version: "1.0.0",
    work_item_id: workItemId,
    request_id: requestId,
    tenant_id: tenantId,
    surface,
    resource_class: surface === "cache" ? "cache_entry" : surface === "embedding_index" ? "embedding" : surface === "backup" ? "backup_snapshot" : surface === "provider_copy" ? "provider_copy" : surface === "object_storage" ? "object_blob" : surface === "auth_identity" ? "authentication_identity" : surface === "vault_secret" ? "vault_secret" : "tenant_profile",
    action: resolvedAction,
    state: "pending",
    resource_locator_hmac: `hmac-sha256:${domain.sha256Canonical({ tenantId, workItemId, surface })}`,
    resource_count: 1,
    attempt: 0,
    max_attempts: 4,
    lease_fence: null,
    lease_token_digest: null,
    next_attempt_at: null,
    failure_code: null,
    verification_digest: null,
    retention_exception_code: null,
    recoverable_until: surface === "backup" ? "2026-09-30T00:00:00.000Z" : null,
    correlation_id: id(205),
    created_at: "2026-08-31T11:59:00.000Z",
    updated_at: "2026-08-31T11:59:00.000Z",
    data_classification: "internal",
  };
}

function legalHold(rootCommand, workItemIds, { holdId = id(350), commandId = id(352), operation = "create", startsAt = "2026-08-31T12:00:00.000Z", expiresAt = "2026-09-30T12:00:00.000Z" } = {}) {
  return {
    request_id: rootCommand.request_id,
    work_item_ids: workItemIds,
    hold: {
      schema_version: "2.0.0",
      governance_version: "1.0.0",
      record_type: "command",
      operation,
      hold_id: holdId,
      tenant_id: rootCommand.tenant_id,
      command_id: commandId,
      receipt_id: null,
      scope_type: "artifact_set",
      scope_hmac: `hmac-sha256:${domain.sha256Canonical(workItemIds)}`,
      artifact_count: workItemIds.length,
      purpose_code: "litigation",
      authority_code: "counsel_instruction",
      authorized_by_actor_id: rootCommand.actor_id,
      authorization_id: id(353),
      starts_at: startsAt,
      expires_at: expiresAt,
      outcome: null,
      outcome_code: null,
      record_fingerprint: domain.sha256Canonical({ holdId, commandId, operation }),
      trace_id: "2".repeat(32),
      correlation_id: id(354),
      recorded_at: "2026-08-31T12:00:00.000Z",
      data_classification: "internal",
    },
  };
}

function prepare({ repository }, request, commandValue, workItems, beforeInventoryComplete) {
  repository.submit(request, commandValue);
  repository.requestApproval(request, commandValue.request_id);
  repository.authorize(request, authorizationCommand(commandValue));
  repository.beginInventory(request, commandValue.request_id);
  beforeInventoryComplete?.();
  return repository.completeInventory(request, { request_id: commandValue.request_id, work_items: workItems });
}

function workerFor(repository, port, tokensBase = 2_000, options = {}) {
  const { database_results: databaseResults, ...workerOptions } = options;
  return workerRuntime.createDataGovernanceWorker({
    repository: workerRuntime.createInMemoryDataGovernanceExecutionRepositoryForTests(repository, {
      ...(databaseResults === undefined ? {} : { database_results: databaseResults }),
    }),
    ports: {
      object_storage: port,
      cache: port,
      embedding_index: port,
      provider_copy: port,
      auth_identity: port,
      vault_secret: port,
      backup: port,
    },
    claim_token_factory: workerRuntime.createDeterministicDataGovernanceClaimTokenFactory(
      Array.from({ length: 64 }, (_, index) => id(tokensBase + index)),
    ),
    lease_duration_ms: 100,
    allow_test_repository: true,
    ...workerOptions,
  });
}

function deferred() {
  let resolve;
  const promise = new Promise((settle) => { resolve = settle; });
  return { promise, resolve };
}

function externalResult(context, operation, result) {
  const outcomeCode = result.outcome === "succeeded"
    ? operation === "verify" ? context.action === "redact" ? "verified_content_free" : "verified_absent" : "applied"
    : result.outcome === "retryable" ? "retryable_failure"
      : result.outcome === "unknown" ? "effect_unknown" : "permanent_failure";
  const absenceKind = {
    object_storage: "object_absence",
    cache: "cache_absence",
    embedding_index: "index_absence",
    provider_copy: "provider_absence",
    auth_identity: "auth_absence",
    vault_secret: "vault_absence",
    backup: "backup_window_elapsed",
  }[context.target];
  const evidenceKind = outcomeCode === "applied" ? "effect_receipt"
    : outcomeCode === "effect_unknown" ? "transport_unknown"
      : outcomeCode === "retryable_failure" ? "transport_failure"
        : outcomeCode === "permanent_failure" ? "provider_denied" : absenceKind;
  const terminalVerification = outcomeCode === "verified_absent" || outcomeCode === "verified_content_free";
  const recoverableUntil = result.recoverable_until ?? null;
  return {
    ...result,
    evidence: {
      receipt_id: context.attempt_receipt_id,
      outcome_code: outcomeCode,
      evidence_kind: evidenceKind,
      evidence_fingerprint: workflows.dataGovernanceExternalEvidenceFingerprint({
        tenant_id: context.tenant_id,
        request_id: context.request_id,
        work_item_id: context.work_item_id,
        attempt: context.attempt,
        receipt_id: context.attempt_receipt_id,
        operation,
        lease_fence: context.lease_fence,
        outcome_code: outcomeCode,
        evidence_kind: evidenceKind,
        operation_identity: context.operation_identity,
        attestation_challenge_hmac: context.attestation_challenge_hmac,
        recoverable_until: recoverableUntil,
      }),
      verifier_authority_id: terminalVerification ? context.attempt_receipt_id : null,
      verifier_attestation_hmac: terminalVerification
        ? `hmac-sha256:${domain.sha256Canonical({ operation_identity: context.operation_identity, verifier: true })}`
        : null,
      recoverable_until: recoverableUntil,
    },
  };
}

test("apply and verify complete one content-free work item in two bounded runs", async () => {
  const request = authorizedRequest();
  const setup = fixture();
  const cmd = command();
  prepare(setup, request, cmd, [item({})]);
  const port = workerRuntime.createDeterministicDataDispositionPort();
  const worker = workerFor(setup.repository, port);

  const applied = await worker.runOnce(request, cmd.request_id);
  assert.equal(applied.outcome, "checkpointed");
  assert.equal(applied.operation, "apply");
  assert.equal(applied.status.state, "verifying");
  assert.equal(port.callCount("apply"), 0, "database apply is owned by the execution repository");
  assert.equal(port.callCount("verify"), 0, "one run never applies and verifies together");

  const verified = await worker.runOnce(request, cmd.request_id);
  assert.equal(verified.operation, "verify");
  assert.equal(verified.status.state, "completed");
  assert.equal(port.callCount("verify"), 0, "database verify is owned by the execution repository");
  assert.equal(setup.repository.listWorkItems(request, cmd.request_id)[0].resource_locator_hmac, null);
});

test("runOnce touches at most one of multiple inventory items", async () => {
  const request = authorizedRequest();
  const setup = fixture({ base: 1_200 });
  const cmd = command({ requestId: id(110) });
  prepare(setup, request, cmd, [item({ requestId: cmd.request_id, workItemId: id(210) }), item({ requestId: cmd.request_id, workItemId: id(211), surface: "cache" })]);
  const port = workerRuntime.createDeterministicDataDispositionPort();
  await workerFor(setup.repository, port, 2_100).runOnce(request, cmd.request_id);
  assert.equal(port.callCount("apply"), 0);
  assert.equal(setup.repository.listWorkItems(request, cmd.request_id).filter((entry) => entry.attempt > 0).length, 1);
});

test("all eight disposition surfaces apply and verify through their contract actions", async () => {
  const request = authorizedRequest();
  const surfaces = [
    "database", "object_storage", "cache", "embedding_index",
    "provider_copy", "auth_identity", "vault_secret", "backup",
  ];
  for (const [index, surface] of surfaces.entries()) {
    const setup = fixture({ base: 4_000 + index * 100 });
    const cmd = command({ requestId: id(700 + index), commandId: id(800 + index) });
    prepare(setup, request, cmd, [item({ requestId: cmd.request_id, workItemId: id(900 + index), surface })]);
    const port = workerRuntime.createDeterministicDataDispositionPort(surface === "backup" ? {
      scripts: {
        apply: [{ outcome: "succeeded", code: "backup_tombstoned", recoverable_until: "2026-09-30T00:00:00.000Z" }],
        verify: [{ outcome: "succeeded", code: "backup_absence_verified", recoverable_until: "2026-09-30T00:00:00.000Z" }],
      },
    } : {});
    const worker = workerFor(setup.repository, port, 5_000 + index * 100);
    assert.equal((await worker.runOnce(request, cmd.request_id)).status.state, "verifying", surface);
    assert.equal((await worker.runOnce(request, cmd.request_id)).status.state, "completed", surface);
    assert.equal(setup.repository.listWorkItems(request, cmd.request_id)[0].resource_locator_hmac, null, surface);
  }
});

test("unknown external outcomes reconcile while database ambiguity requires an operator", async () => {
  const request = authorizedRequest();
  const externalSurfaces = [
    "object_storage", "cache", "embedding_index", "provider_copy",
    "auth_identity", "vault_secret", "backup",
  ];
  for (const [index, surface] of externalSurfaces.entries()) {
    const setup = fixture({ base: 6_000 + index * 100 });
    const cmd = command({ requestId: id(1_000 + index), commandId: id(1_100 + index) });
    prepare(setup, request, cmd, [item({ requestId: cmd.request_id, workItemId: id(1_200 + index), surface })]);
    const port = workerRuntime.createDeterministicDataDispositionPort({
      scripts: { apply: [{ outcome: "unknown", code: "external_response_unknown" }] },
    });
    const worker = workerFor(setup.repository, port, 7_000 + index * 100);
    assert.equal((await worker.runOnce(request, cmd.request_id)).status.state, "effect_unknown", surface);
    assert.equal(setup.repository.listWorkItems(request, cmd.request_id)[0].state, "effect_unknown", surface);
  }

  const setup = fixture({ base: 7_800 });
  const cmd = command({ requestId: id(1_300), commandId: id(1_301) });
  prepare(setup, request, cmd, [item({ requestId: cmd.request_id, workItemId: id(1_302), surface: "database" })]);
  const port = workerRuntime.createDeterministicDataDispositionPort();
  assert.equal((await workerFor(setup.repository, port, 7_900, {
    database_results: [{ outcome: "unknown", code: "database_commit_unknown" }],
  }).runOnce(request, cmd.request_id)).status.state, "operator_required");
});

test("retryable outcome waits, retries with a new fence, then verifies", async () => {
  const request = authorizedRequest();
  const setup = fixture({ base: 1_400 });
  const cmd = command({ requestId: id(120) });
  prepare(setup, request, cmd, [item({ requestId: cmd.request_id, workItemId: id(220), surface: "provider_copy" })]);
  const port = workerRuntime.createDeterministicDataDispositionPort({
    scripts: { apply: [
      { outcome: "retryable", code: "provider_retryable" },
      { outcome: "succeeded", code: "effect_confirmed" },
    ] },
  });
  const worker = workerFor(setup.repository, port, 2_200);
  assert.equal((await worker.runOnce(request, cmd.request_id)).status.state, "retry_wait");
  assert.equal((await worker.runOnce(request, cmd.request_id)).outcome, "idle");
  setup.clock.advanceBy(100);
  assert.equal((await worker.runOnce(request, cmd.request_id)).status.state, "verifying");
  assert.equal((await worker.runOnce(request, cmd.request_id)).status.state, "completed");
  assert.equal(port.callCount("apply"), 2);
});

test("retryable reconciliation resumes reconciliation without repeating apply", async () => {
  const request = authorizedRequest();
  const setup = fixture({ base: 1_500 });
  const cmd = command({ requestId: id(125), commandId: id(126) });
  prepare(setup, request, cmd, [item({ requestId: cmd.request_id, workItemId: id(225), surface: "provider_copy" })]);
  const port = workerRuntime.createDeterministicDataDispositionPort({
    scripts: {
      apply: [{ outcome: "unknown", code: "provider_effect_unknown" }],
      reconcile: [
        { outcome: "retryable", code: "provider_retryable" },
        { outcome: "succeeded", code: "effect_reconciled" },
      ],
    },
  });
  const worker = workerFor(setup.repository, port, 2_250);

  assert.equal((await worker.runOnce(request, cmd.request_id)).status.state, "effect_unknown");
  assert.equal((await worker.runOnce(request, cmd.request_id)).status.state, "retry_wait");
  assert.equal((await worker.runOnce(request, cmd.request_id)).outcome, "idle");
  setup.clock.advanceBy(100);
  const resumed = await worker.runOnce(request, cmd.request_id);
  assert.equal(resumed.operation, "reconcile");
  assert.equal(resumed.status.state, "verifying");
  assert.equal((await worker.runOnce(request, cmd.request_id)).status.state, "completed");
  assert.equal(port.callCount("apply"), 1);
  assert.equal(port.callCount("reconcile"), 2);
});

test("retryable verification resumes verification without repeating apply or reconciling", async () => {
  const request = authorizedRequest();
  const setup = fixture({ base: 1_550 });
  const cmd = command({ requestId: id(127), commandId: id(128) });
  prepare(setup, request, cmd, [item({ requestId: cmd.request_id, workItemId: id(227), surface: "provider_copy" })]);
  const port = workerRuntime.createDeterministicDataDispositionPort({
    scripts: {
      verify: [
        { outcome: "retryable", code: "provider_retryable" },
        { outcome: "succeeded", code: "absence_verified" },
      ],
    },
  });
  const worker = workerFor(setup.repository, port, 2_275);

  assert.equal((await worker.runOnce(request, cmd.request_id)).status.state, "verifying");
  assert.equal((await worker.runOnce(request, cmd.request_id)).status.state, "retry_wait");
  assert.equal((await worker.runOnce(request, cmd.request_id)).outcome, "idle");
  setup.clock.advanceBy(100);
  const resumed = await worker.runOnce(request, cmd.request_id);
  assert.equal(resumed.operation, "verify");
  assert.equal(resumed.status.state, "completed");
  assert.equal(port.callCount("apply"), 1);
  assert.equal(port.callCount("reconcile"), 0);
  assert.equal(port.callCount("verify"), 2);
});

test("ambiguous external effect must reconcile before verification", async () => {
  const request = authorizedRequest();
  const setup = fixture({ base: 1_600 });
  const cmd = command({ requestId: id(130) });
  prepare(setup, request, cmd, [item({ requestId: cmd.request_id, workItemId: id(230), surface: "provider_copy" })]);
  const port = workerRuntime.createDeterministicDataDispositionPort({
    scripts: { apply: [{ outcome: "unknown", code: "provider_effect_unknown" }] },
  });
  const worker = workerFor(setup.repository, port, 2_300);
  assert.equal((await worker.runOnce(request, cmd.request_id)).status.state, "effect_unknown");
  const reconciled = await worker.runOnce(request, cmd.request_id);
  assert.equal(reconciled.operation, "reconcile");
  assert.equal(reconciled.status.state, "verifying");
  assert.equal((await worker.runOnce(request, cmd.request_id)).status.state, "completed");
});

test("provider completion after timeout cannot bypass effect_unknown reconciliation", async () => {
  const request = authorizedRequest();
  const setup = fixture({ base: 1_700 });
  const cmd = command({ requestId: id(135) });
  prepare(setup, request, cmd, [item({ requestId: cmd.request_id, workItemId: id(235), surface: "provider_copy" })]);
  let aborted = false;
  let lateCompleted = false;
  const lateApply = deferred();
  const port = {
    apply(context) {
      context.signal.addEventListener("abort", () => { aborted = true; }, { once: true });
      return lateApply.promise.then((result) => {
        lateCompleted = true;
        return externalResult(context, "apply", result);
      });
    },
    async reconcile(context) { return externalResult(context, "reconcile", { outcome: "succeeded", code: "effect_reconciled" }); },
    async verify(context) { return externalResult(context, "verify", { outcome: "succeeded", code: "absence_verified" }); },
  };
  const worker = workerFor(setup.repository, port, 2_350, { operation_timeout_ms: 10 });
  const timedOut = await worker.runOnce(request, cmd.request_id);
  assert.equal(timedOut.outcome, "unacknowledged");
  assert.equal(timedOut.status.state, "executing_irreversible_deletion");
  assert.equal(aborted, true);
  lateApply.resolve({ outcome: "succeeded", code: "late_provider_success" });
  await lateApply.promise;
  await Promise.resolve();
  assert.equal(lateCompleted, true);
  assert.equal(setup.repository.readStatus(request, cmd.request_id).state, "executing_irreversible_deletion");
  setup.clock.advanceBy(101);
  assert.equal((await worker.runOnce(request, cmd.request_id)).operation, "reconcile");
});

test("reconciliation timeout resumes reconciliation without repeating apply", async () => {
  const request = authorizedRequest();
  const setup = fixture({ base: 1_750 });
  const cmd = command({ requestId: id(136), commandId: id(137) });
  prepare(setup, request, cmd, [item({ requestId: cmd.request_id, workItemId: id(236), surface: "provider_copy" })]);
  const timedReconcile = deferred();
  let reconcileCalls = 0;
  let applyCalls = 0;
  const port = {
    async apply(context) { applyCalls += 1; return externalResult(context, "apply", { outcome: "unknown", code: "provider_effect_unknown" }); },
    reconcile(context) {
      reconcileCalls += 1;
      return reconcileCalls === 1
        ? timedReconcile.promise.then((result) => externalResult(context, "reconcile", result))
        : Promise.resolve(externalResult(context, "reconcile", { outcome: "succeeded", code: "effect_reconciled" }));
    },
    async verify(context) { return externalResult(context, "verify", { outcome: "succeeded", code: "absence_verified" }); },
  };
  const worker = workerFor(setup.repository, port, 2_375, { operation_timeout_ms: 10 });

  assert.equal((await worker.runOnce(request, cmd.request_id)).status.state, "effect_unknown");
  const timedOut = await worker.runOnce(request, cmd.request_id);
  assert.equal(timedOut.operation, "reconcile");
  assert.equal(timedOut.outcome, "unacknowledged");
  assert.equal(timedOut.status.state, "effect_unknown");
  setup.clock.advanceBy(101);
  const resumed = await worker.runOnce(request, cmd.request_id);
  assert.equal(resumed.operation, "reconcile");
  assert.equal(resumed.status.state, "verifying");
  assert.equal(applyCalls, 1);
  assert.equal(reconcileCalls, 2);
  timedReconcile.resolve({ outcome: "succeeded", code: "late_reconciliation" });
});

test("verification timeout schedules and resumes verification without reconciling", async () => {
  const request = authorizedRequest();
  const setup = fixture({ base: 1_775 });
  const cmd = command({ requestId: id(138), commandId: id(139) });
  prepare(setup, request, cmd, [item({ requestId: cmd.request_id, workItemId: id(238), surface: "provider_copy" })]);
  const timedVerify = deferred();
  let applyCalls = 0;
  let reconcileCalls = 0;
  let verifyCalls = 0;
  const port = {
    async apply(context) { applyCalls += 1; return externalResult(context, "apply", { outcome: "succeeded", code: "effect_confirmed" }); },
    async reconcile(context) { reconcileCalls += 1; return externalResult(context, "reconcile", { outcome: "succeeded", code: "effect_reconciled" }); },
    verify(context) {
      verifyCalls += 1;
      return verifyCalls === 1
        ? timedVerify.promise.then((result) => externalResult(context, "verify", result))
        : Promise.resolve(externalResult(context, "verify", { outcome: "succeeded", code: "absence_verified" }));
    },
  };
  const worker = workerFor(setup.repository, port, 2_390, { operation_timeout_ms: 10 });

  assert.equal((await worker.runOnce(request, cmd.request_id)).status.state, "verifying");
  const timedOut = await worker.runOnce(request, cmd.request_id);
  assert.equal(timedOut.operation, "verify");
  assert.equal(timedOut.outcome, "unacknowledged");
  assert.equal(timedOut.status.state, "verifying");
  assert.equal((await worker.runOnce(request, cmd.request_id)).outcome, "busy");
  setup.clock.advanceBy(101);
  const resumed = await worker.runOnce(request, cmd.request_id);
  assert.equal(resumed.operation, "verify");
  assert.equal(resumed.status.state, "completed");
  assert.equal(applyCalls, 1);
  assert.equal(reconcileCalls, 0);
  assert.equal(verifyCalls, 2);
  timedVerify.resolve({ outcome: "succeeded", code: "late_verification" });
});

test("expired lease fence rejects a stale checkpoint", () => {
  const request = authorizedRequest();
  const setup = fixture({ base: 1_800 });
  const cmd = command({ requestId: id(140) });
  prepare(setup, request, cmd, [item({ requestId: cmd.request_id, workItemId: id(240) })]);
  const claim = setup.repository.claimNext(request, {
    request_id: cmd.request_id,
    claim_token: id(2_400),
    lease_duration_ms: 100,
    max_attempts: 4,
  });
  assert.equal(claim.outcome, "claimed");
  setup.clock.advanceBy(101);
  assert.throws(() => setup.repository.checkpoint(request, {
    request_id: cmd.request_id,
    work_item_id: claim.execution.work_item.work_item_id,
    claim_token: claim.execution.claim_token,
    lease_fence: claim.execution.work_item.lease_fence,
    operation: claim.execution.operation,
    attempt: claim.execution.work_item.attempt,
    result: { outcome: "succeeded", code: "effect_confirmed" },
    retry_delay_ms: 100,
  }), workflows.DataGovernanceConflictError);
});

test("tenant-scoped redaction is rejected before admission", () => {
  const request = authorizedRequest();
  const setup = fixture({ base: 11_000 });
  const tenantRedaction = command({
    requestId: id(1_700),
    commandId: id(1_701),
    requestedAction: "redact",
  });
  assert.throws(
    () => setup.repository.submit(request, tenantRedaction),
    workflows.DataGovernanceValidationError,
  );
});

test("data-subject redaction inventory accepts only non-destructive surface actions", () => {
  const request = authorizedRequest();
  const surfaces = [
    "database", "object_storage", "cache", "embedding_index",
    "provider_copy", "auth_identity", "vault_secret", "backup",
  ];
  const acceptedSetup = fixture({ base: 11_200 });
  const acceptedCommand = command({
    requestId: id(1_710),
    commandId: id(1_711),
    requestedAction: "redact",
    scopeType: "data_subject",
    dataSubjectId: id(1_712),
  });
  const acceptedItems = surfaces.map((surface, index) => item({
    requestId: acceptedCommand.request_id,
    workItemId: id(1_720 + index),
    surface,
    action: surface === "backup" ? "backup_expiry_wait" : "redact",
  }));
  assert.equal(prepare(acceptedSetup, request, acceptedCommand, acceptedItems).state, "ready");

  const forbidden = [
    ["database", "irreversible_delete"],
    ["object_storage", "external_delete"],
    ["cache", "cache_invalidate"],
    ["vault_secret", "crypto_erase"],
  ];
  for (const [index, [surface, action]] of forbidden.entries()) {
    const setup = fixture({ base: 11_400 + index * 100 });
    const cmd = command({
      requestId: id(1_740 + index * 10),
      commandId: id(1_741 + index * 10),
      requestedAction: "redact",
      scopeType: "data_subject",
      dataSubjectId: id(1_742 + index * 10),
    });
    setup.repository.submit(request, cmd);
    setup.repository.requestApproval(request, cmd.request_id);
    setup.repository.authorize(request, authorizationCommand(cmd, id(1_743 + index * 10)));
    setup.repository.beginInventory(request, cmd.request_id);
    assert.throws(() => setup.repository.completeInventory(request, {
      request_id: cmd.request_id,
      work_items: [item({ requestId: cmd.request_id, workItemId: id(1_744 + index * 10), surface, action })],
    }), workflows.DataGovernanceValidationError, `${surface}:${action}`);
    assert.equal(setup.repository.listWorkItems(request, cmd.request_id).length, 0, "rejected inventory is atomic");
  }
});

test("irreversible deletion inventory cannot smuggle redaction actions", () => {
  const request = authorizedRequest();
  for (const [index, surface] of ["database", "object_storage"].entries()) {
    const setup = fixture({ base: 11_900 + index * 100 });
    const cmd = command({ requestId: id(1_790 + index * 10), commandId: id(1_791 + index * 10) });
    setup.repository.submit(request, cmd);
    setup.repository.requestApproval(request, cmd.request_id);
    setup.repository.authorize(request, authorizationCommand(cmd, id(1_792 + index * 10)));
    setup.repository.beginInventory(request, cmd.request_id);
    assert.throws(() => setup.repository.completeInventory(request, {
      request_id: cmd.request_id,
      work_items: [item({ requestId: cmd.request_id, workItemId: id(1_793 + index * 10), surface, action: "redact" })],
    }), workflows.DataGovernanceValidationError, surface);
  }
});

test("expired apply leases reconcile external effects and fail closed for database effects", () => {
  const request = authorizedRequest();
  const externalSetup = fixture({ base: 12_200 });
  const externalCommand = command({ requestId: id(1_820), commandId: id(1_821) });
  prepare(externalSetup, request, externalCommand, [item({
    requestId: externalCommand.request_id,
    workItemId: id(1_822),
    surface: "object_storage",
  })]);
  const firstExternalClaim = externalSetup.repository.claimNext(request, {
    request_id: externalCommand.request_id,
    claim_token: id(1_823),
    lease_duration_ms: 100,
    max_attempts: 4,
  });
  assert.equal(firstExternalClaim.outcome, "claimed");
  assert.equal(firstExternalClaim.execution.operation, "apply");
  externalSetup.clock.advanceBy(101);
  const reconciledClaim = externalSetup.repository.claimNext(request, {
    request_id: externalCommand.request_id,
    claim_token: id(1_824),
    lease_duration_ms: 100,
    max_attempts: 4,
  });
  assert.equal(reconciledClaim.outcome, "claimed");
  assert.equal(reconciledClaim.execution.operation, "reconcile");
  assert.equal(reconciledClaim.execution.work_item.attempt, 2);
  assert.equal(externalSetup.repository.listReceipts(request, externalCommand.request_id).at(-1).outcome, "effect_unknown");

  const databaseSetup = fixture({ base: 12_400 });
  const databaseCommand = command({ requestId: id(1_830), commandId: id(1_831) });
  prepare(databaseSetup, request, databaseCommand, [item({
    requestId: databaseCommand.request_id,
    workItemId: id(1_832),
    surface: "database",
  })]);
  assert.equal(databaseSetup.repository.claimNext(request, {
    request_id: databaseCommand.request_id,
    claim_token: id(1_833),
    lease_duration_ms: 100,
    max_attempts: 4,
  }).outcome, "claimed");
  databaseSetup.clock.advanceBy(101);
  const failedClosed = databaseSetup.repository.claimNext(request, {
    request_id: databaseCommand.request_id,
    claim_token: id(1_834),
    lease_duration_ms: 100,
    max_attempts: 4,
  });
  assert.equal(failedClosed.outcome, "terminal");
  assert.equal(failedClosed.execution, null);
  assert.equal(failedClosed.status.state, "operator_required");
  assert.equal(databaseSetup.repository.listWorkItems(request, databaseCommand.request_id)[0].state, "operator_required");
});

test("expired verification lease is safely verified again", () => {
  const request = authorizedRequest();
  const setup = fixture({ base: 12_600 });
  const cmd = command({ requestId: id(1_840), commandId: id(1_841) });
  prepare(setup, request, cmd, [item({ requestId: cmd.request_id, workItemId: id(1_842), surface: "object_storage" })]);
  const applyClaim = setup.repository.claimNext(request, {
    request_id: cmd.request_id,
    claim_token: id(1_843),
    lease_duration_ms: 100,
    max_attempts: 4,
  });
  assert.equal(applyClaim.outcome, "claimed");
  setup.repository.checkpoint(request, {
    request_id: cmd.request_id,
    work_item_id: applyClaim.execution.work_item.work_item_id,
    claim_token: applyClaim.execution.claim_token,
    lease_fence: applyClaim.execution.work_item.lease_fence,
    operation: applyClaim.execution.operation,
    attempt: applyClaim.execution.work_item.attempt,
    result: { outcome: "succeeded", code: "effect_confirmed" },
    retry_delay_ms: 100,
  });
  const firstVerifyClaim = setup.repository.claimNext(request, {
    request_id: cmd.request_id,
    claim_token: id(1_844),
    lease_duration_ms: 100,
    max_attempts: 4,
  });
  assert.equal(firstVerifyClaim.outcome, "claimed");
  assert.equal(firstVerifyClaim.execution.operation, "verify");
  setup.clock.advanceBy(101);
  const secondVerifyClaim = setup.repository.claimNext(request, {
    request_id: cmd.request_id,
    claim_token: id(1_845),
    lease_duration_ms: 100,
    max_attempts: 4,
  });
  assert.equal(secondVerifyClaim.outcome, "claimed");
  assert.equal(secondVerifyClaim.execution.operation, "verify");
});

test("granular legal hold blocks only the held item, and late hold or cancellation is denied", async () => {
  const request = authorizedRequest();
  const setup = fixture({ base: 2_500 });
  const cmd = command({ requestId: id(150) });
  const held = item({ requestId: cmd.request_id, workItemId: id(250) });
  const free = item({ requestId: cmd.request_id, workItemId: id(251), surface: "cache" });
  prepare(setup, request, cmd, [held, free], () => {
    setup.repository.placeLegalHold(request, legalHold(cmd, [held.work_item_id]));
  });
  const port = workerRuntime.createDeterministicDataDispositionPort();
  const run = await workerFor(setup.repository, port, 2_600).runOnce(request, cmd.request_id);
  assert.equal(run.work_item_id, free.work_item_id);
  assert.throws(() => setup.repository.cancel(request, cancellationCommand(cmd)), workflows.DataGovernanceConflictError);
  assert.throws(() => setup.repository.placeLegalHold(request, legalHold(cmd, [free.work_item_id], { holdId: id(351), commandId: id(355) })), workflows.DataGovernanceConflictError);
});

test("legal hold release and explicit expiration preserve immutable command and receipt ledgers", () => {
  const request = authorizedRequest();

  const releasedSetup = fixture({ base: 8_000 });
  const releasedCommand = command({ requestId: id(1_400), commandId: id(1_401) });
  const releasedItem = item({ requestId: releasedCommand.request_id, workItemId: id(1_402) });
  prepare(releasedSetup, request, releasedCommand, [releasedItem], () => {
    releasedSetup.repository.placeLegalHold(request, legalHold(releasedCommand, [releasedItem.work_item_id], {
      holdId: id(1_403), commandId: id(1_404), expiresAt: "2026-08-31T12:00:01.000Z",
    }));
  });
  releasedSetup.repository.releaseLegalHold(request, legalHold(releasedCommand, [releasedItem.work_item_id], {
    holdId: id(1_403), commandId: id(1_405), operation: "release", expiresAt: "2026-08-31T12:00:01.000Z",
  }));
  const releasedLedger = releasedSetup.repository.listLegalHolds(request, releasedCommand.request_id);
  assert.deepEqual(releasedLedger.map((entry) => [entry.record_type, entry.operation, entry.outcome]), [
    ["command", "create", null], ["receipt", "create", "created"],
    ["command", "release", null], ["receipt", "release", "released"],
  ]);
  assert.equal(releasedLedger.filter((entry) => entry.record_type === "receipt").every((entry) => entry.scope_hmac === null), true);

  const expiredSetup = fixture({ base: 8_500 });
  const expiredCommand = command({ requestId: id(1_410), commandId: id(1_411) });
  const expiredItem = item({ requestId: expiredCommand.request_id, workItemId: id(1_412) });
  prepare(expiredSetup, request, expiredCommand, [expiredItem], () => {
    expiredSetup.repository.placeLegalHold(request, legalHold(expiredCommand, [expiredItem.work_item_id], {
      holdId: id(1_413), commandId: id(1_414), expiresAt: "2026-08-31T12:00:01.000Z",
    }));
  });
  expiredSetup.clock.advanceBy(1_001);
  assert.equal(expiredSetup.repository.claimNext(request, {
    request_id: expiredCommand.request_id,
    claim_token: id(1_415),
    lease_duration_ms: 100,
    max_attempts: 4,
  }).outcome, "idle", "wall clock alone never releases a hold");
  expiredSetup.repository.expireLegalHold(request, legalHold(expiredCommand, [expiredItem.work_item_id], {
    holdId: id(1_413), commandId: id(1_416), operation: "expire", expiresAt: "2026-08-31T12:00:01.000Z",
  }));
  assert.equal(expiredSetup.repository.readStatus(request, expiredCommand.request_id).state, "ready");
  assert.deepEqual(expiredSetup.repository.listLegalHolds(request, expiredCommand.request_id).map((entry) => entry.outcome), [null, "created", null, "expired"]);
});

test("cancellation succeeds before dispatch and is fenced immediately when destructive apply is claimed", () => {
  const request = authorizedRequest();
  const preDispatch = fixture({ base: 9_000 });
  const cancellable = command({ requestId: id(1_500), commandId: id(1_501) });
  preDispatch.repository.submit(request, cancellable);
  preDispatch.repository.requestApproval(request, cancellable.request_id);
  assert.equal(preDispatch.repository.cancel(request, cancellationCommand(cancellable, id(1_502))).state, "cancelled");

  const dispatched = fixture({ base: 9_500 });
  const dispatchedCommand = command({ requestId: id(1_510), commandId: id(1_511) });
  const dispatchedItem = item({ requestId: dispatchedCommand.request_id, workItemId: id(1_512) });
  prepare(dispatched, request, dispatchedCommand, [dispatchedItem]);
  assert.equal(dispatched.repository.claimNext(request, {
    request_id: dispatchedCommand.request_id,
    claim_token: id(1_513),
    lease_duration_ms: 100,
    max_attempts: 4,
  }).outcome, "claimed");
  assert.throws(() => dispatched.repository.cancel(request, cancellationCommand(dispatchedCommand, id(1_514))), workflows.DataGovernanceConflictError);
  assert.throws(() => dispatched.repository.placeLegalHold(request, legalHold(dispatchedCommand, [dispatchedItem.work_item_id], {
    holdId: id(1_515), commandId: id(1_516),
  })), workflows.DataGovernanceConflictError);
});

test("receipts are immutable and contain no PII or resource locator", async () => {
  const request = authorizedRequest();
  const setup = fixture({ base: 2_800 });
  const cmd = command({ requestId: id(160) });
  prepare(setup, request, cmd, [item({ requestId: cmd.request_id, workItemId: id(260), surface: "object_storage" })]);
  const worker = workerFor(setup.repository, workerRuntime.createDeterministicDataDispositionPort(), 2_900);
  await worker.runOnce(request, cmd.request_id);
  await worker.runOnce(request, cmd.request_id);
  const receipts = setup.repository.listReceipts(request, cmd.request_id);
  const encoded = JSON.stringify(receipts);
  for (const canary of ["person@example.com", "+15551234567", "private transcript", "bucket/key", "provider-object-42"]) {
    assert.equal(encoded.includes(canary), false);
  }
  assert.equal(Object.isFrozen(receipts), true);
  assert.equal(Object.isFrozen(receipts[0]), true);
  assert.throws(() => { receipts[0].outcome = "policy_denied"; }, TypeError);
});

test("data-subject redaction completes without retaining the subject identifier in receipts", async () => {
  const request = authorizedRequest();
  const setup = fixture({ base: 2_950 });
  const subjectId = id(610);
  const cmd = command({
    requestId: id(165),
    commandId: id(166),
    requestedAction: "redact",
    scopeType: "data_subject",
    dataSubjectId: subjectId,
  });
  prepare(setup, request, cmd, [item({
    requestId: cmd.request_id,
    workItemId: id(265),
    action: "redact",
  })]);
  const worker = workerFor(setup.repository, workerRuntime.createDeterministicDataDispositionPort(), 2_960);
  assert.equal((await worker.runOnce(request, cmd.request_id)).status.state, "verifying");
  assert.equal((await worker.runOnce(request, cmd.request_id)).status.state, "completed");
  assert.equal(setup.repository.readStatus(request, cmd.request_id).scope_type, "data_subject");
  assert.equal(JSON.stringify(setup.repository.listReceipts(request, cmd.request_id)).includes(subjectId), false);
});

test("authorization enforces two ordered approvals for tenant scope and one for data-subject scope", () => {
  const request = authorizedRequest();
  const tenantSetup = fixture({ base: 9_800 });
  const tenantCommand = command({ requestId: id(1_550), commandId: id(1_551) });
  tenantSetup.repository.submit(request, tenantCommand);
  tenantSetup.repository.requestApproval(request, tenantCommand.request_id);
  const insufficient = authorizationCommand(tenantCommand, id(1_552));
  insufficient.approval_ids = [id(1_553)];
  assert.throws(() => tenantSetup.repository.authorize(request, insufficient), workflows.DataGovernanceValidationError);

  const subjectSetup = fixture({ base: 9_900 });
  const subjectCommand = command({
    requestId: id(1_560), commandId: id(1_561), scopeType: "data_subject", dataSubjectId: id(1_562),
  });
  subjectSetup.repository.submit(request, subjectCommand);
  subjectSetup.repository.requestApproval(request, subjectCommand.request_id);
  assert.equal(subjectSetup.repository.authorize(request, authorizationCommand(subjectCommand, id(1_563))).state, "authorized");
});

test("strict contract boundaries reject PII canaries in extra command, work-item and hold fields", () => {
  const request = authorizedRequest();
  const commandCanary = "alice@example.com";
  const commandSetup = fixture({ base: 10_000 });
  const rejectedCommand = { ...command({ requestId: id(1_600), commandId: id(1_601) }), contact_email: commandCanary };
  assert.throws(() => commandSetup.repository.submit(request, rejectedCommand), workflows.DataGovernanceValidationError);
  const valueCanaryCommand = { ...command({ requestId: id(1_602), commandId: id(1_603) }), requested_action: "+1-555-123-4567" };
  assert.throws(() => commandSetup.repository.submit(request, valueCanaryCommand), workflows.DataGovernanceValidationError);

  const setup = fixture({ base: 10_500 });
  const cmd = command({ requestId: id(1_610), commandId: id(1_611) });
  setup.repository.submit(request, cmd);
  setup.repository.requestApproval(request, cmd.request_id);
  setup.repository.authorize(request, authorizationCommand(cmd, id(1_612)));
  setup.repository.beginInventory(request, cmd.request_id);
  const transcriptCanary = "private transcript for +1-555-123-4567";
  const rejectedItem = { ...item({ requestId: cmd.request_id, workItemId: id(1_613) }), transcript: transcriptCanary };
  assert.throws(() => setup.repository.completeInventory(request, {
    request_id: cmd.request_id,
    work_items: [rejectedItem],
  }), workflows.DataGovernanceValidationError);
  assert.equal(setup.repository.listWorkItems(request, cmd.request_id).length, 0, "rejected inventory is atomic");
  const valueCanaryItem = { ...item({ requestId: cmd.request_id, workItemId: id(1_616) }), resource_class: transcriptCanary };
  assert.throws(() => setup.repository.completeInventory(request, {
    request_id: cmd.request_id,
    work_items: [valueCanaryItem],
  }), workflows.DataGovernanceValidationError);

  const holdCanary = "tenant-bucket/private/object-key";
  const rejectedHold = legalHold(cmd, [id(1_613)], { holdId: id(1_614), commandId: id(1_615) });
  rejectedHold.hold.object_key = holdCanary;
  assert.throws(() => setup.repository.placeLegalHold(request, rejectedHold), workflows.DataGovernanceValidationError);
  const valueCanaryHold = legalHold(cmd, [id(1_613)], { holdId: id(1_617), commandId: id(1_618) });
  valueCanaryHold.hold.purpose_code = holdCanary;
  assert.throws(() => setup.repository.placeLegalHold(request, valueCanaryHold), workflows.DataGovernanceValidationError);
  const encoded = JSON.stringify(setup.repository.listReceipts(request, cmd.request_id));
  for (const canary of [commandCanary, transcriptCanary, holdCanary]) assert.equal(encoded.includes(canary), false);
});

test("tenant-scoped reads and mutations cannot cross tenant boundaries", () => {
  const alpha = authorizedRequest();
  const beta = authorizedRequest({ tenantId: tenantBeta, actorId: actorBeta, token: "dev_governance_beta_0001" });
  const setup = fixture({ base: 3_000 });
  const cmd = command({ requestId: id(170) });
  setup.repository.submit(alpha, cmd);
  assert.throws(() => setup.repository.readStatus(beta, cmd.request_id), workflows.DataGovernanceNotFoundError);
  assert.throws(() => setup.repository.submit(alpha, command({ tenantId: tenantBeta, requestId: id(171), actorId: actorBeta })), workflows.DataGovernanceAuthorizationError);
});

test("idempotent replay returns existing state while divergent replay conflicts", () => {
  const request = authorizedRequest();
  const setup = fixture({ base: 3_200 });
  const cmd = command({ requestId: id(180) });
  const first = setup.repository.submit(request, cmd);
  assert.deepEqual(setup.repository.submit(request, structuredClone(cmd)), first);
  assert.throws(() => setup.repository.submit(request, { ...cmd, trace_id: "2".repeat(32) }), workflows.DataGovernanceConflictError);
});

test("backup success must disclose recoverable_until before it can verify", async () => {
  const request = authorizedRequest();
  const setup = fixture({ base: 3_400 });
  const cmd = command({ requestId: id(190) });
  prepare(setup, request, cmd, [item({ requestId: cmd.request_id, workItemId: id(290), surface: "backup" })]);
  const invalidPort = workerRuntime.createDeterministicDataDispositionPort({
    scripts: { apply: [{ outcome: "succeeded", code: "backup_tombstoned" }] },
  });
  await assert.rejects(workerFor(setup.repository, invalidPort, 3_500).runOnce(request, cmd.request_id));

  const separate = fixture({ base: 3_600 });
  const cmd2 = command({ requestId: id(191) });
  prepare(separate, request, cmd2, [item({ requestId: cmd2.request_id, workItemId: id(291), surface: "backup" })]);
  const port = workerRuntime.createDeterministicDataDispositionPort({
    scripts: { apply: [{ outcome: "succeeded", code: "backup_tombstoned", recoverable_until: "2026-09-30T00:00:00.000Z" }] },
  });
  const applied = await workerFor(separate.repository, port, 3_700).runOnce(request, cmd2.request_id);
  assert.equal(applied.status.state, "verifying");
  assert.equal(separate.repository.listWorkItems(request, cmd2.request_id)[0].recoverable_until, "2026-09-30T00:00:00.000Z");
});
