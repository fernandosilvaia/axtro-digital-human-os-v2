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
const requestId = id(10);
const workItemId = id(11);
const claimToken = id(12);
const workerId = id(13);
const evidenceReceiptId = id(14);
const verifierId = id(15);

function id(offset) {
  return domain.uuidV7FromParts(
    1_701_100_000_000 + offset,
    Uint8Array.from(Array.from({ length: 10 }, (_, index) => (offset + index + 29) & 0xff)),
  );
}

function runtimeConfiguration() {
  return config.loadRuntimeConfig({
    AXTRO_ENV: "test",
    AXTRO_SERVICE_NAME: "workflow-worker",
    AXTRO_PROVIDER_MODE: "fake",
    AXTRO_SECRET_BROKER_HANDLE: "secret://local/data-governance-postgres-test",
    AXTRO_PORT: "3000",
    AXTRO_REQUEST_TIMEOUT_MS: "10000",
    AXTRO_DEV_AUTH_ENABLED: "true",
    AXTRO_LOG_LEVEL: "info",
  });
}

function authorizedRequest({ tenantId = tenantAlpha, actorId = actorAlpha, token = "dev_governance_rpc_alpha_0001" } = {}) {
  const verifier = auth.createDevelopmentIdentityVerifier(runtimeConfiguration(), [{
    token,
    actorId,
    actorType: "workflow",
    identityKind: "service",
    tenantGrants: [{
      tenantId,
      grantedScopes: ["workflow:execute"],
      purposes: ["essential_processing"],
    }],
  }]);
  return auth.resolveAuthorizedRequestContext({ authorization: `Bearer ${token}`, requestedTenantId: tenantId }, verifier);
}

function claimRow({
  tenantId = tenantAlpha,
  resourceCode = "external_provider_copy",
  scope = "tenant",
  subjectId = null,
  action = "external_delete",
  operation = "apply",
  challenge = `hmac-sha256:${"3".repeat(64)}`,
  surface = resourceCode === "db_tenants" ? "database" : "provider_copy",
  resourceClass = resourceCode === "db_tenants" ? "tenant_profile" : "provider_copy",
} = {}) {
  return {
    workItemId,
    requestId,
    tenantId,
    resourceCode,
    surface,
    resourceClass,
    scope,
    subjectId,
    resourceLocatorHmac: `hmac-sha256:${"1".repeat(64)}`,
    action,
    state: "leased",
    resourceCount: 1,
    operation,
    operationIdentity: "2".repeat(64),
    attestationChallengeHmac: challenge,
    attemptCount: 1,
    maxAttempts: 4,
    leaseToken: claimToken,
    leaseExpiresAt: "2026-08-31T13:00:00.000Z",
    fencingToken: 7,
  };
}

function scriptedClient(steps) {
  const calls = [];
  let cursor = 0;
  return {
    calls,
    async rpc(name, parameters) {
      calls.push({ name, parameters });
      const step = steps[cursor];
      cursor += 1;
      if (step === undefined) throw new Error("unexpected RPC");
      if (step.name !== undefined) assert.equal(name, step.name);
      if (step.throw) throw new Error("transport failed");
      return step.response;
    },
  };
}

function repository(client) {
  return workerRuntime.createPostgresDataGovernanceExecutionRepository({
    client,
    worker_id: workerId,
  });
}

function claimInput() {
  return { request_id: requestId, claim_token: claimToken, lease_duration_ms: 5_000 };
}

function evidenceFingerprint(
  execution,
  {
    receiptId = evidenceReceiptId,
    outcomeCode = "verified_absent",
    evidenceKind = "provider_absence",
    recoverableUntil = null,
  } = {},
) {
  return workflows.dataGovernanceExternalEvidenceFingerprint({
    tenant_id: execution.tenant_id,
    request_id: execution.request_id,
    work_item_id: execution.work_item.work_item_id,
    attempt: execution.work_item.attempt,
    receipt_id: receiptId,
    operation: execution.operation,
    lease_fence: execution.work_item.lease_fence,
    outcome_code: outcomeCode,
    evidence_kind: evidenceKind,
    operation_identity: execution.work_item.operation_identity,
    attestation_challenge_hmac: execution.work_item.attestation_challenge_hmac,
    recoverable_until: recoverableUntil,
  });
}

test("durable RPC adapter forwards a complete independent external evidence envelope and completion receipt", async () => {
  const client = scriptedClient([
    {
      name: "portal_lease_data_governance_work_items_service",
      response: { data: [claimRow({ operation: "verify" })], error: null },
    },
    {
      name: "portal_begin_data_governance_external_operation_service",
      response: {
        data: {
          tenantId: tenantAlpha,
          workItemId,
          state: "applying",
          operation: "verify",
          operationIdentity: "2".repeat(64),
          fencingToken: 7,
          leaseToken: claimToken,
          replayed: false,
        },
        error: null,
      },
    },
    {
      name: "portal_record_data_governance_item_outcome_service",
      response: {
        data: { tenantId: tenantAlpha, workItemId, state: "verified", outcomeCode: "verified_absent", receiptId: evidenceReceiptId, replayed: false },
        error: null,
      },
    },
    {
      name: "portal_complete_data_governance_request_service",
      response: { data: { requestId, tenantId: tenantAlpha, state: "completed", receiptId: evidenceReceiptId, replayed: false }, error: null },
    },
  ]);
  const durable = repository(client);
  const request = authorizedRequest();
  const claim = await durable.claimNext(request, claimInput());
  assert.equal(claim.outcome, "claimed");
  await durable.beginExternal(request, claim.execution);
  const canonicalEvidenceFingerprint = evidenceFingerprint(claim.execution);
  const result = {
    outcome: "succeeded",
    code: "absence_verified",
    evidence: {
      receipt_id: evidenceReceiptId,
      outcome_code: "verified_absent",
      evidence_kind: "provider_absence",
      evidence_fingerprint: canonicalEvidenceFingerprint,
      verifier_authority_id: verifierId,
      verifier_attestation_hmac: `hmac-sha256:${"5".repeat(64)}`,
      recoverable_until: null,
    },
  };
  const mutation = await durable.recordExternalOutcome(request, claim.execution, result);
  assert.equal(mutation.work_item_state, "verified");
  assert.deepEqual(client.calls[2].parameters, {
    p_tenant_id: tenantAlpha,
    p_request_id: requestId,
    p_item_id: workItemId,
    p_lease_token: claimToken,
    p_receipt_id: evidenceReceiptId,
    p_operation: "verify",
    p_fencing_token: 7,
    p_outcome_code: "verified_absent",
    p_evidence_kind: "provider_absence",
    p_evidence_fingerprint: canonicalEvidenceFingerprint,
    p_verifier_authority_id: verifierId,
    p_verifier_attestation_hmac: `hmac-sha256:${"5".repeat(64)}`,
    p_recoverable_until: null,
  });
  assert.equal((await durable.complete(request, { request_id: requestId, receipt_id: evidenceReceiptId })).state, "completed");
  assert.equal(client.calls.every((call) => call.parameters.p_tenant_id === tenantAlpha), true);
});

test("database claims execute only through the typed database RPC and never through an external target port", async () => {
  const client = scriptedClient([
    {
      name: "portal_lease_data_governance_work_items_service",
      response: { data: [claimRow({ resourceCode: "db_tenants", action: "irreversible_delete", challenge: null })], error: null },
    },
    {
      name: "portal_apply_data_governance_database_item_service",
      response: { data: { tenantId: tenantAlpha, workItemId, state: "verification_pending", outcomeCode: "applied" }, error: null },
    },
  ]);
  const externalPort = {
    async apply() { assert.fail("database claim reached an external port"); },
    async reconcile() { assert.fail("database claim reached an external port"); },
    async verify() { assert.fail("database claim reached an external port"); },
  };
  const worker = workerRuntime.createDataGovernanceWorker({
    repository: repository(client),
    ports: { provider_copy: externalPort },
    claim_token_factory: workerRuntime.createDeterministicDataGovernanceClaimTokenFactory([claimToken]),
    lease_duration_ms: 5_000,
  });
  const run = await worker.runOnce(authorizedRequest(), requestId);
  assert.equal(run.outcome, "checkpointed");
  assert.equal(run.work_item_state, "verification_pending");
  assert.deepEqual(client.calls.map((entry) => entry.name), [
    "portal_lease_data_governance_work_items_service",
    "portal_apply_data_governance_database_item_service",
  ]);
  assert.equal(client.calls.every((call) => call.parameters.p_tenant_id === tenantAlpha), true);
});

test("claim parser rejects cross-tenant, unknown catalog, accessor and stale RPC responses", async (t) => {
  const cases = [
    {
      name: "cross tenant",
      response: { data: [claimRow({ tenantId: tenantBeta })], error: null },
      code: "invalid_rpc_response",
    },
    {
      name: "invalid catalog projection",
      response: { data: [claimRow({ surface: "unregistered_surface" })], error: null },
      code: "invalid_rpc_response",
    },
    {
      name: "stale database lease",
      response: { data: null, error: { code: "55000" } },
      code: "rpc_error",
    },
  ];
  for (const current of cases) {
    await t.test(current.name, async () => {
      const durable = repository(scriptedClient([{ response: current.response }]));
      await assert.rejects(durable.claimNext(authorizedRequest(), claimInput()), (error) => {
        assert.equal(error.name, "DataGovernancePostgresRepositoryError");
        assert.equal(error.code, current.code);
        return true;
      });
    });
  }

  await t.test("accessor payload", async () => {
    const row = claimRow();
    Object.defineProperty(row, "tenantId", { get() { return tenantAlpha; }, enumerable: true });
    const durable = repository(scriptedClient([{ response: { data: [row], error: null } }]));
    await assert.rejects(durable.claimNext(authorizedRequest(), claimInput()), workerRuntime.DataGovernancePostgresRepositoryError);
  });
});

test("missing verifier authority fails before any external outcome RPC", async () => {
  const client = scriptedClient([{
    response: { data: [claimRow({ operation: "verify" })], error: null },
  }]);
  const durable = repository(client);
  const claim = await durable.claimNext(authorizedRequest(), claimInput());
  const invalid = {
    outcome: "succeeded",
    code: "absence_verified",
    evidence: {
      receipt_id: evidenceReceiptId,
      outcome_code: "verified_absent",
      evidence_kind: "provider_absence",
      evidence_fingerprint: evidenceFingerprint(claim.execution),
      verifier_authority_id: null,
      verifier_attestation_hmac: null,
      recoverable_until: null,
    },
  };
  await assert.rejects(
    durable.recordExternalOutcome(authorizedRequest(), claim.execution, invalid),
    workflows.DataGovernanceConfigurationError,
  );
  assert.equal(client.calls.length, 1);
});

test("completion response must prove the same authorized tenant", async () => {
  const client = scriptedClient([{
    response: {
      data: { requestId, tenantId: tenantBeta, state: "completed", receiptId: evidenceReceiptId, replayed: false },
      error: null,
    },
  }]);
  await assert.rejects(
    repository(client).complete(authorizedRequest(), { request_id: requestId, receipt_id: evidenceReceiptId }),
    (error) => error instanceof workerRuntime.DataGovernancePostgresRepositoryError
      && error.code === "invalid_rpc_response",
  );
});

test("RPC transport exceptions remain unacknowledged errors", async () => {
  const client = scriptedClient([{ throw: true }]);
  await assert.rejects(repository(client).claimNext(authorizedRequest(), claimInput()), (error) => {
    assert.equal(error.name, "DataGovernancePostgresRepositoryError");
    assert.equal(error.code, "rpc_error");
    return true;
  });
});

test("missing external port leaves the lease unacknowledged without beginning dispatch", async () => {
  const client = scriptedClient([{
    name: "portal_lease_data_governance_work_items_service",
    response: { data: [claimRow()], error: null },
  }]);
  const worker = workerRuntime.createDataGovernanceWorker({
    repository: repository(client),
    ports: {},
    claim_token_factory: workerRuntime.createDeterministicDataGovernanceClaimTokenFactory([claimToken]),
    lease_duration_ms: 5_000,
  });
  const run = await worker.runOnce(authorizedRequest(), requestId);
  assert.equal(run.outcome, "unacknowledged");
  assert.deepEqual(client.calls.map((entry) => entry.name), ["portal_lease_data_governance_work_items_service"]);
});

test("failed external begin never invokes the provider port", async () => {
  const client = scriptedClient([
    {
      name: "portal_lease_data_governance_work_items_service",
      response: { data: [claimRow()], error: null },
    },
    {
      name: "portal_begin_data_governance_external_operation_service",
      response: { data: null, error: { code: "55000" } },
    },
  ]);
  let providerCalls = 0;
  const port = {
    async apply() { providerCalls += 1; throw new Error("must not run"); },
    async reconcile() { providerCalls += 1; throw new Error("must not run"); },
    async verify() { providerCalls += 1; throw new Error("must not run"); },
  };
  const worker = workerRuntime.createDataGovernanceWorker({
    repository: repository(client),
    ports: { provider_copy: port },
    claim_token_factory: workerRuntime.createDeterministicDataGovernanceClaimTokenFactory([claimToken]),
    lease_duration_ms: 5_000,
  });
  await assert.rejects(worker.runOnce(authorizedRequest(), requestId), workerRuntime.DataGovernancePostgresRepositoryError);
  assert.equal(providerCalls, 0);
});

test("completion replay after ACK loss accepts only the original durable receipt", async () => {
  const originalReceiptId = id(16);
  const client = scriptedClient([{
    name: "portal_complete_data_governance_request_service",
    response: {
      data: { requestId, tenantId: tenantAlpha, state: "completed", receiptId: originalReceiptId, replayed: true },
      error: null,
    },
  }]);
  const worker = workerRuntime.createDataGovernanceWorker({
    repository: repository(client),
    ports: {},
    claim_token_factory: workerRuntime.createDeterministicDataGovernanceClaimTokenFactory([id(17)]),
  });
  const completion = await worker.complete(authorizedRequest(), requestId, evidenceReceiptId);
  assert.equal(completion.replayed, true);
  assert.equal(completion.receipt_id, originalReceiptId);
  assert.equal(client.calls[0].parameters.p_tenant_id, tenantAlpha);
});

test("external outcome replay after ACK loss returns the original durable receipt", async () => {
  const originalReceiptId = evidenceReceiptId;
  const client = scriptedClient([
    {
      name: "portal_lease_data_governance_work_items_service",
      response: { data: [claimRow({ operation: "verify" })], error: null },
    },
    {
      name: "portal_record_data_governance_item_outcome_service",
      response: {
        data: {
          tenantId: tenantAlpha,
          workItemId,
          state: "verified",
          outcomeCode: "verified_absent",
          receiptId: originalReceiptId,
          replayed: true,
        },
        error: null,
      },
    },
  ]);
  const durable = repository(client);
  const claim = await durable.claimNext(authorizedRequest(), claimInput());
  const replay = await durable.recordExternalOutcome(authorizedRequest(), claim.execution, {
    outcome: "succeeded",
    code: "absence_verified",
    evidence: {
      receipt_id: evidenceReceiptId,
      outcome_code: "verified_absent",
      evidence_kind: "provider_absence",
      evidence_fingerprint: evidenceFingerprint(claim.execution),
      verifier_authority_id: verifierId,
      verifier_attestation_hmac: `hmac-sha256:${"5".repeat(64)}`,
      recoverable_until: null,
    },
  });
  assert.equal(replay.replayed, true);
  assert.equal(replay.receipt_id, originalReceiptId);
  assert.equal(client.calls[1].parameters.p_tenant_id, tenantAlpha);
});

test("durable worker requires operation timeout to fit inside the lease safety margin", () => {
  const client = scriptedClient([]);
  assert.throws(() => workerRuntime.createDataGovernanceWorker({
    repository: repository(client),
    ports: {},
    claim_token_factory: workerRuntime.createDeterministicDataGovernanceClaimTokenFactory([id(18)]),
    lease_duration_ms: 5_000,
    operation_timeout_ms: 4_000,
  }), workflows.DataGovernanceConfigurationError);
});

test("mutation response from another tenant fails closed", async () => {
  const client = scriptedClient([
    {
      response: { data: [claimRow({ operation: "verify" })], error: null },
    },
    {
      response: {
        data: { tenantId: tenantBeta, workItemId, state: "verified", outcomeCode: "verified_absent", receiptId: evidenceReceiptId, replayed: false },
        error: null,
      },
    },
  ]);
  const durable = repository(client);
  const claim = await durable.claimNext(authorizedRequest(), claimInput());
  const result = {
    outcome: "succeeded",
    code: "absence_verified",
    evidence: {
      receipt_id: evidenceReceiptId,
      outcome_code: "verified_absent",
      evidence_kind: "provider_absence",
      evidence_fingerprint: evidenceFingerprint(claim.execution),
      verifier_authority_id: verifierId,
      verifier_attestation_hmac: `hmac-sha256:${"5".repeat(64)}`,
      recoverable_until: null,
    },
  };
  await assert.rejects(
    durable.recordExternalOutcome(authorizedRequest(), claim.execution, result),
    workerRuntime.DataGovernancePostgresRepositoryError,
  );
});

test("worker rejects the process-local fake unless test mode is explicitly opted in", () => {
  const fake = workflows.createInMemoryDataGovernanceRepository({
    clock: workflows.createManualDataGovernanceClock("2026-08-31T12:00:00.000Z"),
    id_factory: workflows.createDeterministicDataGovernanceIdFactory([id(90)]),
  });
  const executionFake = workerRuntime.createInMemoryDataGovernanceExecutionRepositoryForTests(fake);
  assert.throws(() => workerRuntime.createDataGovernanceWorker({
    repository: executionFake,
    ports: {},
    claim_token_factory: workerRuntime.createDeterministicDataGovernanceClaimTokenFactory([id(91)]),
  }), workflows.DataGovernanceConfigurationError);
});
