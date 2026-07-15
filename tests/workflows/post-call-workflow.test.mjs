import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../..", import.meta.url));
const auth = await import(pathToFileURL(join(root, "packages/auth/dist/index.js")).href);
const config = await import(pathToFileURL(join(root, "packages/config/dist/index.js")).href);
const domain = await import(pathToFileURL(join(root, "packages/domain/dist/index.js")).href);
const events = await import(pathToFileURL(join(root, "packages/events/dist/index.js")).href);
const observability = await import(pathToFileURL(join(root, "packages/observability/dist/index.js")).href);
const workflows = await import(pathToFileURL(join(root, "packages/workflows/dist/index.js")).href);
const eventRelay = await import(pathToFileURL(join(root, "apps/event-relay/dist/index.js")).href);
const workflowWorker = await import(pathToFileURL(join(root, "apps/workflow-worker/dist/index.js")).href);
const walkingSequence = JSON.parse(readFileSync(
  join(root, "tests/fixtures/reducers/walking-sequence.json"),
  "utf8",
));

const tenantAlpha = id(1);
const tenantBeta = id(2);
const actorAlpha = id(3);
const actorBeta = id(4);

function id(offset) {
  return domain.uuidV7FromParts(
    1_701_000_000_000 + offset,
    Uint8Array.from(Array.from({ length: 10 }, (_, index) => (offset + index + 31) & 0xff)),
  );
}

function runtimeConfiguration(serviceName = "workflow-worker") {
  return config.loadRuntimeConfig({
    AXTRO_ENV: "test",
    AXTRO_SERVICE_NAME: serviceName,
    AXTRO_PROVIDER_MODE: "fake",
    AXTRO_SECRET_BROKER_HANDLE: "secret://local/post-call-workflow-test",
    AXTRO_PORT: "3000",
    AXTRO_REQUEST_TIMEOUT_MS: "10000",
    AXTRO_DEV_AUTH_ENABLED: "true",
    AXTRO_LOG_LEVEL: "info",
  });
}

function authorizedRequest({
  tenantId = tenantAlpha,
  actorId = actorAlpha,
  token = "dev_workflow_alpha_0001",
  scopes = [
    "session:read",
    "session:write",
    "event:relay",
    "event:observe",
    "workflow:dispatch",
    "workflow:execute",
    "workflow:observe",
  ],
  purposes = ["essential_processing"],
} = {}) {
  const verifier = auth.createDevelopmentIdentityVerifier(runtimeConfiguration(), [{
    token,
    actorId,
    actorType: "workflow",
    identityKind: "service",
    tenantGrants: [{ tenantId, grantedScopes: scopes, purposes }],
  }]);
  return auth.resolveAuthorizedRequestContext({
    authorization: `Bearer ${token}`,
    requestedTenantId: tenantId,
  }, verifier);
}

function sessionEvents({ tenantId = tenantAlpha, sessionId = id(100), base = 1_000 } = {}) {
  const sequence = walkingSequence.map((template, index) => {
    const event = structuredClone(template);
    event.event_id = id(base + index);
    event.tenant_id = tenantId;
    event.aggregate_id = sessionId;
    event.session_id = sessionId;
    event.aggregate_version = index + 1;
    event.trace_id = "1".repeat(32);
    event.correlation_id = id(base + 100 + index);
    event.causation_id = index === 0 ? null : id(base + 99 + index);
    event.occurred_at = new Date(Date.parse("2026-07-15T14:00:00.000Z") + index * 1_000).toISOString();
    return event;
  });
  const previous = sequence.at(-1);
  const completion = {
    schema_version: "2.0.0",
    event_id: id(base + sequence.length),
    event_type: "session.completed",
    event_version: 1,
    aggregate_type: "interaction_session",
    aggregate_id: sessionId,
    aggregate_version: sequence.length + 1,
    tenant_id: tenantId,
    session_id: sessionId,
    producer: "workflow-test",
    trace_id: "1".repeat(32),
    correlation_id: id(base + 100 + sequence.length),
    causation_id: previous.correlation_id,
    data_classification: "internal",
    occurred_at: new Date(Date.parse("2026-07-15T14:00:00.000Z") + sequence.length * 1_000).toISOString(),
    payload: {},
  };
  return [...sequence, completion];
}

function telemetryFixture(sink = new observability.InMemoryTelemetrySink()) {
  let sequence = 0;
  const runtime = observability.createTelemetryRuntime({
    sink,
    clock: () => 1_701_000_100_000 + sequence,
    idGenerator: {
      createTraceId: () => "2".repeat(32),
      createSpanId: () => (++sequence).toString(16).padStart(16, "0"),
      createCorrelationId: () => id(9_000 + sequence),
    },
  });
  return { runtime, sink };
}

function idFactory(base = 2_000) {
  return workflows.createDeterministicWorkflowIdFactory({
    command_ids: Array.from({ length: 16 }, (_, index) => id(base + index)),
    run_ids: Array.from({ length: 16 }, (_, index) => id(base + 100 + index)),
    follow_up_command_ids: Array.from({ length: 16 }, (_, index) => id(base + 200 + index)),
  });
}

function tokenFactory(base = 3_000, count = 64) {
  return workflowWorker.createDeterministicWorkflowClaimTokenFactory(
    Array.from({ length: count }, (_, index) => id(base + index)),
  );
}

function createWorkflowFixture({
  timeline = events.createDeterministicSessionTimelineRepository(),
  clock = workflows.createManualWorkflowClock("2026-07-15T15:00:00.000Z"),
  factory = idFactory(),
  repositoryOptions = {},
  activityOptions = {},
} = {}) {
  const repository = workflows.createDeterministicPostCallWorkflowRepository({
    evidence_source: eventRelay.createSessionTimelineWorkflowEvidenceSource(timeline),
    clock,
    id_factory: factory,
    ...repositoryOptions,
  });
  const activities = workflows.createDeterministicPostCallActivities({
    id_factory: factory,
    ...activityOptions,
  });
  return { timeline, clock, factory, repository, activities };
}

function workerFor(fixture, {
  activities = fixture.activities,
  tokens = tokenFactory(),
  telemetry = telemetryFixture().runtime,
  leaseDurationMs = 100,
  retryDelayMs = 100,
  maxAttempts = 4,
  faultPoints = [],
} = {}) {
  return workflowWorker.createWorkflowWorker({
    repository: fixture.repository,
    activities,
    claim_token_factory: tokens,
    telemetry,
    lease_duration_ms: leaseDurationMs,
    retry_delay_ms: retryDelayMs,
    max_attempts: maxAttempts,
    fault_points: faultPoints,
  });
}

function seedTimeline(request, timeline, domainEvents) {
  let completionEnvelope;
  for (const event of domainEvents) {
    const envelope = events.encodeInteractionEvent(event);
    timeline.appendCanonicalEvent(request, envelope);
    completionEnvelope = envelope;
  }
  return completionEnvelope;
}

async function enqueueDirect(request, fixture, domainEvents) {
  const completion = seedTimeline(request, fixture.timeline, domainEvents);
  const receipt = await fixture.repository.enqueueSessionCompletion(request, completion);
  return { completion, receipt };
}

function relayFor({ outbox, timeline, repository, relayClock, tokenBase, telemetry, faultPoints = [] }) {
  return eventRelay.createEventRelay({
    outbox,
    consumer: eventRelay.createSessionTimelineWorkflowConsumer(timeline, repository),
    clock: relayClock,
    claim_token_factory: eventRelay.createDeterministicClaimTokenFactory(
      Array.from({ length: 32 }, (_, index) => id(tokenBase + index)),
    ),
    telemetry: telemetry ?? telemetryFixture().runtime,
    lease_duration_ms: 100,
    max_attempts: 4,
    retry_delay_ms: 100,
    fault_points: faultPoints,
  });
}

test("completion is ACKed only after one deterministic command, then four bounded runs produce a restricted result", async () => {
  const request = authorizedRequest();
  const domainEvents = sessionEvents();
  const outbox = events.createDeterministicTransactionalOutboxRepository();
  const fixture = createWorkflowFixture();
  const relayClock = eventRelay.createManualEventRelayClock("2026-07-15T15:00:00.000Z");
  const relayTelemetry = telemetryFixture();
  await outbox.commitInteractionEvents(request, domainEvents);
  const relay = relayFor({
    outbox,
    timeline: fixture.timeline,
    repository: fixture.repository,
    relayClock,
    tokenBase: 4_000,
    telemetry: relayTelemetry.runtime,
  });

  for (let index = 0; index < domainEvents.length - 1; index += 1) {
    assert.equal((await relay.runOnce(request)).outcome, "published");
  }
  const completionEvent = events.encodeInteractionEvent(domainEvents.at(-1));
  assert.equal(fixture.repository.readEnqueueReceipt(request, completionEvent.event_id), null);
  const delivered = await relay.runOnce(request);
  assert.equal(delivered.outcome, "published");
  const enqueueReceipt = fixture.repository.readEnqueueReceipt(request, completionEvent.event_id);
  assert.ok(enqueueReceipt);
  assert.equal(fixture.timeline.listCanonicalEvents(request, completionEvent.session_id, 0).length, 9);
  const timelineReceipt = fixture.timeline.appendCanonicalEvent(request, completionEvent);
  assert.equal(delivered.receipt.effect_hash, domain.sha256Canonical({
    timeline_state_hash: timelineReceipt.state_hash,
    workflow_command_fingerprint: enqueueReceipt.command_fingerprint,
  }));
  assert.equal(outbox.listOutbox(request).at(-1).status, "published");

  const workflowTelemetry = telemetryFixture();
  const worker = workerFor(fixture, {
    tokens: tokenFactory(5_000),
    telemetry: workflowTelemetry.runtime,
  });
  assert.equal(worker.runOnce(request, enqueueReceipt.workflow_run_id).outcome, "checkpointed");
  assert.equal(worker.runOnce(request, enqueueReceipt.workflow_run_id).outcome, "checkpointed");
  assert.equal(worker.runOnce(request, enqueueReceipt.workflow_run_id).outcome, "checkpointed");
  const completed = worker.runOnce(request, enqueueReceipt.workflow_run_id);
  assert.equal(completed.outcome, "completed");
  assert.equal(completed.status.status, "completed");
  assert.equal(completed.status.max_attempts, 4);

  const result = fixture.repository.readResult(request, enqueueReceipt.workflow_run_id);
  assert.ok(result);
  assert.equal(result.data_classification, "restricted");
  assert.equal(result.summary.text, "Session completed with 9 canonical events at aggregate version 9.");
  assert.equal(result.summary.canonical_event_count, 9);
  assert.deepEqual(result.evaluation, {
    evaluator_version: "fake-structural-v1",
    outcome: "passed",
    score_basis_points: 10_000,
    evidence_event_ids: domainEvents.map((event) => event.event_id).slice(-16),
  });
  assert.deepEqual(
    { mode: result.follow_up_guard.mode, status: result.follow_up_guard.status, external_effect: result.follow_up_guard.external_effect },
    { mode: "deterministic_noop", status: "not_sent", external_effect: false },
  );
  assert.match(result.result_hash, /^[0-9a-f]{64}$/);
  assert.equal(fixture.repository.listStepReceipts(request, enqueueReceipt.workflow_run_id).length, 4);
  assert.equal(Object.hasOwn(fixture.repository.readCommand(request, enqueueReceipt.workflow_run_id), "input_json"), false);
  assert.equal(fixture.activities.effectCount(tenantAlpha, enqueueReceipt.workflow_run_id, "record_follow_up_guard"), 1);

  assert.deepEqual(workflowTelemetry.sink.logs.map((entry) => entry.event_code), [
    "workflow.run.started",
    "workflow.run.checkpointed",
    "workflow.run.started",
    "workflow.run.checkpointed",
    "workflow.run.started",
    "workflow.run.checkpointed",
    "workflow.run.started",
    "workflow.run.completed",
  ]);
  const serializedTelemetry = JSON.stringify(workflowTelemetry.sink);
  for (const prohibited of ["payload_json", "transcript", result.summary.text, "claim_token", "external_effect"]) {
    assert.equal(serializedTelemetry.includes(prohibited), false);
  }
});

test("composite relay closes timeline-to-enqueue and enqueue-to-ACK crash windows idempotently", async () => {
  const request = authorizedRequest({ token: "dev_workflow_crash_windows" });
  const domainEvents = sessionEvents({ sessionId: id(110), base: 1_100 });
  const outbox = events.createDeterministicTransactionalOutboxRepository();
  const fixture = createWorkflowFixture({
    factory: idFactory(2_100),
    repositoryOptions: { fault_points: ["before_enqueue_commit"] },
  });
  const relayClock = eventRelay.createManualEventRelayClock("2026-07-15T15:10:00.000Z");
  await outbox.commitInteractionEvents(request, domainEvents);
  const relay = relayFor({
    outbox,
    timeline: fixture.timeline,
    repository: fixture.repository,
    relayClock,
    tokenBase: 4_100,
  });
  for (let index = 0; index < 8; index += 1) assert.equal((await relay.runOnce(request)).outcome, "published");
  const firstCompletionAttempt = await relay.runOnce(request);
  assert.equal(firstCompletionAttempt.outcome, "retry_scheduled");
  assert.equal(firstCompletionAttempt.receipt.failure_code, "consumer_retryable");
  const completionEnvelope = events.encodeInteractionEvent(domainEvents.at(-1));
  assert.equal(fixture.timeline.listCanonicalEvents(request, completionEnvelope.session_id, 0).length, 9);
  assert.equal(fixture.repository.readEnqueueReceipt(request, completionEnvelope.event_id), null);
  relayClock.advanceBy(100);
  assert.equal((await relay.runOnce(request)).outcome, "published");
  const recoveredReceipt = fixture.repository.readEnqueueReceipt(request, completionEnvelope.event_id);
  assert.ok(recoveredReceipt);
  assert.equal(fixture.timeline.listCanonicalEvents(request, completionEnvelope.session_id, 0).length, 9);

  const secondEvents = sessionEvents({ sessionId: id(120), base: 1_200 });
  const secondOutbox = events.createDeterministicTransactionalOutboxRepository();
  const secondFixture = createWorkflowFixture({ factory: idFactory(2_200) });
  const secondClock = eventRelay.createManualEventRelayClock("2026-07-15T15:20:00.000Z");
  await secondOutbox.commitInteractionEvents(request, secondEvents);
  const stable = relayFor({
    outbox: secondOutbox,
    timeline: secondFixture.timeline,
    repository: secondFixture.repository,
    relayClock: secondClock,
    tokenBase: 4_200,
  });
  for (let index = 0; index < 8; index += 1) assert.equal((await stable.runOnce(request)).outcome, "published");
  const crashing = relayFor({
    outbox: secondOutbox,
    timeline: secondFixture.timeline,
    repository: secondFixture.repository,
    relayClock: secondClock,
    tokenBase: 4_300,
    faultPoints: ["after_effect_before_ack"],
  });
  await assert.rejects(crashing.runOnce(request), eventRelay.EventRelayCrashError);
  const secondCompletion = events.encodeInteractionEvent(secondEvents.at(-1));
  const beforeAck = secondFixture.repository.readEnqueueReceipt(request, secondCompletion.event_id);
  assert.ok(beforeAck);
  assert.equal(secondOutbox.listOutbox(request).at(-1).status, "publishing");
  secondClock.advanceBy(100);
  const replacement = relayFor({
    outbox: secondOutbox,
    timeline: secondFixture.timeline,
    repository: secondFixture.repository,
    relayClock: secondClock,
    tokenBase: 4_400,
  });
  assert.equal((await replacement.runOnce(request)).outcome, "published");
  assert.deepEqual(secondFixture.repository.readEnqueueReceipt(request, secondCompletion.event_id), beforeAck);
  assert.equal(secondFixture.timeline.listCanonicalEvents(request, secondCompletion.session_id, 0).length, 9);
});

test("a replacement worker resumes after lease expiry without duplicating the follow-up guard", async () => {
  const request = authorizedRequest({ token: "dev_workflow_restart_0001" });
  const fixture = createWorkflowFixture({ factory: idFactory(2_300) });
  const { receipt } = await enqueueDirect(
    request,
    fixture,
    sessionEvents({ sessionId: id(130), base: 1_300 }),
  );
  const firstWorker = workerFor(fixture, { tokens: tokenFactory(5_100) });
  assert.equal(firstWorker.runOnce(request, receipt.workflow_run_id).outcome, "checkpointed");
  assert.equal(firstWorker.runOnce(request, receipt.workflow_run_id).outcome, "checkpointed");

  const crashing = workerFor(fixture, {
    tokens: tokenFactory(5_200, 1),
    faultPoints: ["after_activity_before_checkpoint"],
  });
  assert.throws(
    () => crashing.runOnce(request, receipt.workflow_run_id),
    workflowWorker.WorkflowWorkerCrashError,
  );
  assert.equal(fixture.repository.readStatus(request, receipt.workflow_run_id).status, "running");
  assert.equal(fixture.activities.effectCount(tenantAlpha, receipt.workflow_run_id, "record_follow_up_guard"), 1);

  const replacement = workerFor(fixture, {
    tokens: tokenFactory(5_300, 4),
    maxAttempts: 16,
  });
  assert.equal(replacement.runOnce(request, receipt.workflow_run_id).outcome, "busy");
  fixture.clock.advanceBy(100);
  const resumed = replacement.runOnce(request, receipt.workflow_run_id);
  assert.equal(resumed.outcome, "checkpointed");
  assert.equal(resumed.receipt.step, "record_follow_up_guard");
  assert.equal(resumed.receipt.attempt, 2);
  assert.equal(resumed.status.max_attempts, 4);
  assert.equal(fixture.activities.effectCount(tenantAlpha, receipt.workflow_run_id, "record_follow_up_guard"), 1);
  assert.equal(replacement.runOnce(request, receipt.workflow_run_id).outcome, "completed");
  assert.equal(fixture.repository.listStepReceipts(request, receipt.workflow_run_id).length, 4);
});

test("every activity checkpoint resumes after a crash without duplicating its deterministic effect", async () => {
  const request = authorizedRequest({ token: "dev_workflow_each_checkpoint" });
  for (const [stepIndex, step] of workflows.POST_CALL_WORKFLOW_STEPS.entries()) {
    const fixture = createWorkflowFixture({ factory: idFactory(7_000 + stepIndex * 100) });
    const { receipt } = await enqueueDirect(
      request,
      fixture,
      sessionEvents({ sessionId: id(7_500 + stepIndex), base: 7_600 + stepIndex * 20 }),
    );
    const stable = workerFor(fixture, { tokens: tokenFactory(8_000 + stepIndex * 20, 4) });
    for (let completed = 0; completed < stepIndex; completed += 1) {
      assert.equal(stable.runOnce(request, receipt.workflow_run_id).outcome, "checkpointed");
    }
    const crashing = workerFor(fixture, {
      tokens: tokenFactory(8_500 + stepIndex, 1),
      faultPoints: ["after_activity_before_checkpoint"],
    });
    assert.throws(
      () => crashing.runOnce(request, receipt.workflow_run_id),
      workflowWorker.WorkflowWorkerCrashError,
    );
    assert.equal(fixture.activities.effectCount(tenantAlpha, receipt.workflow_run_id, step), 1);
    fixture.clock.advanceBy(100);
    const replacement = workerFor(fixture, { tokens: tokenFactory(8_600 + stepIndex, 1) });
    const resumed = replacement.runOnce(request, receipt.workflow_run_id);
    assert.equal(resumed.outcome, step === "finalize" ? "completed" : "checkpointed");
    assert.equal(fixture.activities.effectCount(tenantAlpha, receipt.workflow_run_id, step), 1);
  }
});

test("the repository clock owns lease deadlines and idle or busy probes do not consume claim tokens", async () => {
  const request = authorizedRequest({ token: "dev_workflow_clock_authority" });
  const fixture = createWorkflowFixture({ factory: idFactory(9_000) });
  const { receipt } = await enqueueDirect(
    request,
    fixture,
    sessionEvents({ sessionId: id(9_300), base: 9_400 }),
  );
  const first = fixture.repository.claimStep(request, {
    workflow_run_id: receipt.workflow_run_id,
    claim_token_factory: tokenFactory(9_600, 1),
    lease_duration_ms: 100,
    max_attempts: 4,
  });
  assert.equal(first.outcome, "claimed");
  const artifact = fixture.activities.runStep(first.execution);
  const replacementTokens = tokenFactory(9_700, 1);
  for (let probe = 0; probe < 3; probe += 1) {
    assert.equal(fixture.repository.claimStep(request, {
      workflow_run_id: receipt.workflow_run_id,
      claim_token_factory: replacementTokens,
      lease_duration_ms: 100,
      max_attempts: 4,
    }).outcome, "busy");
  }
  assert.throws(() => fixture.repository.claimStep(request, {
    workflow_run_id: receipt.workflow_run_id,
    claim_token_factory: replacementTokens,
    lease_duration_ms: 100,
    max_attempts: 4,
    now: "2099-01-01T00:00:00.000Z",
  }), workflows.WorkflowValidationError);
  assert.throws(() => fixture.repository.checkpointStep(request, {
    workflow_run_id: receipt.workflow_run_id,
    claim_token: first.execution.claim_token,
    step: first.execution.step,
    attempt: first.execution.attempt,
    artifact,
    completed_at: "2020-01-01T00:00:00.000Z",
  }), workflows.WorkflowValidationError);
  fixture.clock.advanceBy(100);
  assert.throws(() => fixture.repository.checkpointStep(request, {
    workflow_run_id: receipt.workflow_run_id,
    claim_token: first.execution.claim_token,
    step: first.execution.step,
    attempt: first.execution.attempt,
    artifact,
  }), workflows.WorkflowConflictError);
  const recovered = fixture.repository.claimStep(request, {
    workflow_run_id: receipt.workflow_run_id,
    claim_token_factory: replacementTokens,
    lease_duration_ms: 100,
    max_attempts: 16,
  });
  assert.equal(recovered.outcome, "claimed");
  assert.equal(recovered.execution.attempt, 2);
  assert.equal(recovered.status.max_attempts, 4);
});

test("an expired final claim closes with evidence before any replacement token is issued", async () => {
  const request = authorizedRequest({ token: "dev_workflow_expired_exhaustion" });
  const fixture = createWorkflowFixture({ factory: idFactory(9_800) });
  const { receipt } = await enqueueDirect(
    request,
    fixture,
    sessionEvents({ sessionId: id(9_850), base: 9_900 }),
  );
  const first = fixture.repository.claimStep(request, {
    workflow_run_id: receipt.workflow_run_id,
    claim_token_factory: tokenFactory(9_950, 1),
    lease_duration_ms: 100,
    max_attempts: 1,
  });
  assert.equal(first.outcome, "claimed");
  const artifact = fixture.activities.runStep(first.execution);
  fixture.clock.advanceBy(100);
  let replacementTokensIssued = 0;
  const exhausted = fixture.repository.claimStep(request, {
    workflow_run_id: receipt.workflow_run_id,
    claim_token_factory: () => {
      replacementTokensIssued += 1;
      return id(9_951);
    },
    lease_duration_ms: 100,
    max_attempts: 16,
  });
  assert.equal(exhausted.outcome, "terminal");
  assert.equal(exhausted.status.status, "failed");
  assert.equal(exhausted.status.last_error_code, "max_attempts_exhausted");
  assert.equal(replacementTokensIssued, 0);
  assert.deepEqual(
    fixture.repository.listStepReceipts(request, receipt.workflow_run_id).map((entry) => [entry.attempt, entry.outcome, entry.failure_code]),
    [[1, "failed", "max_attempts_exhausted"]],
  );
  assert.throws(() => fixture.repository.checkpointStep(request, {
    workflow_run_id: receipt.workflow_run_id,
    claim_token: first.execution.claim_token,
    step: first.execution.step,
    attempt: first.execution.attempt,
    artifact,
  }), workflows.WorkflowConflictError);
});

test("activity failures are classified into one retryable code and terminal safe codes", async () => {
  const request = authorizedRequest({ token: "dev_workflow_failure_classes" });
  const cases = [
    [() => new workflows.WorkflowValidationError(), "invalid_source"],
    [() => new workflows.WorkflowPolicyDeniedError(), "policy_denied"],
    [() => new Error("private@example.test bearer-secret"), "internal_failure"],
  ];
  for (const [createError, expectedCode] of cases) {
    const offset = cases.findIndex(([candidate]) => candidate === createError);
    const fixture = createWorkflowFixture({ factory: idFactory(10_000 + offset * 100) });
    const { receipt } = await enqueueDirect(
      request,
      fixture,
      sessionEvents({ sessionId: id(10_500 + offset), base: 10_600 + offset * 20 }),
    );
    const activities = Object.freeze({ runStep() { throw createError(); } });
    const worker = workerFor(fixture, {
      activities,
      tokens: tokenFactory(11_000 + offset, 1),
    });
    const failed = worker.runOnce(request, receipt.workflow_run_id);
    assert.equal(failed.outcome, "failed");
    assert.equal(failed.status.last_error_code, expectedCode);
    assert.equal(failed.receipt.failure_code, expectedCode);
    assert.equal(failed.status.next_attempt_at, null);
    assert.equal(JSON.stringify(failed).includes("private@example.test"), false);
    assert.equal(worker.runOnce(request, receipt.workflow_run_id).outcome, "terminal");
  }
});

test("retry backoff, pinned exhaustion, and cancellation fail closed without late checkpoint", async () => {
  const request = authorizedRequest({ token: "dev_workflow_retry_cancel" });
  const fixture = createWorkflowFixture({
    factory: idFactory(2_400),
    activityOptions: { retry_once_steps: ["evaluate"] },
  });
  const { receipt } = await enqueueDirect(
    request,
    fixture,
    sessionEvents({ sessionId: id(140), base: 1_400 }),
  );
  const worker = workerFor(fixture, { tokens: tokenFactory(5_400), retryDelayMs: 100 });
  assert.equal(worker.runOnce(request, receipt.workflow_run_id).outcome, "checkpointed");
  const retry = worker.runOnce(request, receipt.workflow_run_id);
  assert.equal(retry.outcome, "retry_scheduled");
  assert.equal(retry.status.status, "waiting");
  assert.equal(retry.status.last_error_code, "activity_retryable");
  assert.equal(worker.runOnce(request, receipt.workflow_run_id).outcome, "idle");
  fixture.clock.advanceBy(99);
  assert.equal(worker.runOnce(request, receipt.workflow_run_id).outcome, "idle");
  fixture.clock.advanceBy(1);
  assert.equal(worker.runOnce(request, receipt.workflow_run_id).outcome, "checkpointed");

  const claim = fixture.repository.claimStep(request, {
    workflow_run_id: receipt.workflow_run_id,
    claim_token_factory: tokenFactory(5_900, 1),
    lease_duration_ms: 100,
    max_attempts: 16,
  });
  assert.equal(claim.outcome, "claimed");
  const artifact = fixture.activities.runStep(claim.execution);
  const cancelled = worker.cancel(request, receipt.workflow_run_id);
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.cancelled_at, fixture.clock.now());
  assert.deepEqual(worker.cancel(request, receipt.workflow_run_id), cancelled);
  assert.throws(() => fixture.repository.checkpointStep(request, {
    workflow_run_id: receipt.workflow_run_id,
    claim_token: claim.execution.claim_token,
    step: claim.execution.step,
    attempt: claim.execution.attempt,
    artifact,
  }), workflows.WorkflowConflictError);
  assert.equal(fixture.repository.readResult(request, receipt.workflow_run_id), null);
  assert.equal(fixture.repository.listStepReceipts(request, receipt.workflow_run_id).at(-1).outcome, "cancelled");

  const exhaustedFixture = createWorkflowFixture({
    factory: idFactory(2_500),
    activityOptions: { retry_once_steps: ["evaluate"] },
  });
  const exhaustedEnqueue = await enqueueDirect(
    request,
    exhaustedFixture,
    sessionEvents({ sessionId: id(150), base: 1_500 }),
  );
  const oneAttemptWorker = workerFor(exhaustedFixture, {
    tokens: tokenFactory(6_000),
    maxAttempts: 1,
  });
  assert.equal(oneAttemptWorker.runOnce(request, exhaustedEnqueue.receipt.workflow_run_id).outcome, "checkpointed");
  const exhausted = oneAttemptWorker.runOnce(request, exhaustedEnqueue.receipt.workflow_run_id);
  assert.equal(exhausted.outcome, "failed");
  assert.equal(exhausted.status.last_error_code, "max_attempts_exhausted");
  assert.equal(oneAttemptWorker.runOnce(request, exhaustedEnqueue.receipt.workflow_run_id).outcome, "terminal");
});

test("execute-only authority cancels queued and waiting workflows without observe scope", async () => {
  const dispatch = authorizedRequest({ token: "dev_workflow_cancel_dispatch" });
  const executeOnly = authorizedRequest({
    token: "dev_workflow_cancel_execute",
    scopes: ["workflow:execute"],
  });
  const queuedFixture = createWorkflowFixture({ factory: idFactory(11_500) });
  const queued = await enqueueDirect(
    dispatch,
    queuedFixture,
    sessionEvents({ sessionId: id(11_800), base: 11_900 }),
  );
  const queuedWorker = workerFor(queuedFixture, { tokens: tokenFactory(12_100, 1) });
  assert.equal(queuedWorker.cancel(executeOnly, queued.receipt.workflow_run_id).status, "cancelled");
  assert.throws(
    () => queuedWorker.runOnce(executeOnly, queued.receipt.workflow_run_id),
    workflows.WorkflowAuthorizationError,
  );
  assert.equal(queuedWorker.runOnce(dispatch, queued.receipt.workflow_run_id).outcome, "terminal");

  const waitingFixture = createWorkflowFixture({
    factory: idFactory(12_500),
    activityOptions: { retry_once_steps: ["generate_summary"] },
  });
  const waiting = await enqueueDirect(
    dispatch,
    waitingFixture,
    sessionEvents({ sessionId: id(12_800), base: 12_900 }),
  );
  const waitingWorker = workerFor(waitingFixture, { tokens: tokenFactory(13_100, 1) });
  assert.equal(waitingWorker.runOnce(dispatch, waiting.receipt.workflow_run_id).outcome, "retry_scheduled");
  assert.equal(waitingWorker.cancel(executeOnly, waiting.receipt.workflow_run_id).status, "cancelled");
  assert.throws(
    () => waitingWorker.runOnce(executeOnly, waiting.receipt.workflow_run_id),
    workflows.WorkflowAuthorizationError,
  );
  assert.equal(waitingWorker.runOnce(dispatch, waiting.receipt.workflow_run_id).outcome, "terminal");
  const receipts = waitingFixture.repository.listStepReceipts(dispatch, waiting.receipt.workflow_run_id);
  assert.deepEqual(receipts.map((entry) => entry.attempt), [1, 2]);
});

test("tenant, scope, capacity, source, and no-external-integration boundaries reject before mutation", async () => {
  const alpha = authorizedRequest({ token: "dev_workflow_boundary_a" });
  const beta = authorizedRequest({
    tenantId: tenantBeta,
    actorId: actorBeta,
    token: "dev_workflow_boundary_b",
  });
  const observeOnly = authorizedRequest({
    token: "dev_workflow_observe_only",
    scopes: ["session:read", "workflow:observe"],
  });
  const executeOnly = authorizedRequest({
    token: "dev_workflow_execute_only",
    scopes: ["session:read", "workflow:execute"],
  });
  const dispatchOnly = authorizedRequest({
    token: "dev_workflow_dispatch_only",
    scopes: ["session:read", "workflow:dispatch"],
  });
  const observeWithoutSession = authorizedRequest({
    token: "dev_workflow_observe_no_session",
    scopes: ["workflow:observe"],
  });
  const wrongPurpose = authorizedRequest({
    token: "dev_workflow_wrong_purpose",
    purposes: ["provider_auth"],
  });
  const fixture = createWorkflowFixture({
    factory: idFactory(2_600),
    repositoryOptions: { max_runs_per_tenant: 1 },
  });
  const first = await enqueueDirect(alpha, fixture, sessionEvents({ sessionId: id(160), base: 1_600 }));
  const secondCompletion = seedTimeline(
    alpha,
    fixture.timeline,
    sessionEvents({ sessionId: id(170), base: 1_700 }),
  );
  await assert.rejects(
    fixture.repository.enqueueSessionCompletion(alpha, secondCompletion),
    workflows.WorkflowCapacityError,
  );
  assert.throws(
    () => fixture.repository.readStatus(beta, first.receipt.workflow_run_id),
    workflows.WorkflowNotFoundError,
  );
  assert.throws(() => fixture.repository.claimStep(observeOnly, {
    workflow_run_id: first.receipt.workflow_run_id,
    claim_token_factory: tokenFactory(6_100, 1),
    lease_duration_ms: 100,
    max_attempts: 4,
  }), workflows.WorkflowAuthorizationError);
  assert.throws(
    () => fixture.repository.readStatus(executeOnly, first.receipt.workflow_run_id),
    workflows.WorkflowAuthorizationError,
  );
  assert.deepEqual(
    await fixture.repository.enqueueSessionCompletion(dispatchOnly, first.completion),
    first.receipt,
  );
  await assert.rejects(
    fixture.repository.enqueueSessionCompletion(executeOnly, first.completion),
    workflows.WorkflowAuthorizationError,
  );
  assert.throws(() => fixture.repository.claimStep(dispatchOnly, {
    workflow_run_id: first.receipt.workflow_run_id,
    claim_token_factory: tokenFactory(6_150, 1),
    lease_duration_ms: 100,
    max_attempts: 4,
  }), workflows.WorkflowAuthorizationError);
  assert.equal(
    fixture.repository.readStatus(observeWithoutSession, first.receipt.workflow_run_id).status,
    "queued",
  );
  assert.throws(
    () => fixture.repository.readResult(observeWithoutSession, first.receipt.workflow_run_id),
    workflows.WorkflowAuthorizationError,
  );
  assert.throws(
    () => fixture.repository.readStatus(wrongPurpose, first.receipt.workflow_run_id),
    workflows.WorkflowAuthorizationError,
  );
  const altered = structuredClone(first.completion);
  altered.event_id = id(6_200);
  await assert.rejects(
    fixture.repository.enqueueSessionCompletion(alpha, altered),
    workflows.WorkflowConflictError,
  );
  assert.equal(fixture.repository.readStatus(alpha, first.receipt.workflow_run_id).status, "queued");

  const workflowSource = readFileSync(join(root, "packages/workflows/src/index.ts"), "utf8");
  const workerSource = readFileSync(join(root, "apps/workflow-worker/src/index.ts"), "utf8");
  for (const prohibited of [
    "@axtro/tool-runtime",
    "@axtro/provider-contracts",
    "@axtro/model-gateway",
    "@axtro/policy",
    "@axtro/agent",
    "fetch(",
  ]) {
    assert.equal(workflowSource.includes(prohibited), false);
    assert.equal(workerSource.includes(prohibited), false);
  }
  assert.equal(workflowSource.includes("external_effect: false"), true);
});

test("completion without a sink or with a mismatched sink is terminal and never pretends success", async () => {
  const request = authorizedRequest({ token: "dev_workflow_sink_mismatch" });
  const timeline = events.createDeterministicSessionTimelineRepository();
  const domainEvents = sessionEvents({ sessionId: id(180), base: 1_800 });
  for (const event of domainEvents.slice(0, -1)) {
    timeline.appendCanonicalEvent(request, events.encodeInteractionEvent(event));
  }
  const completion = events.encodeInteractionEvent(domainEvents.at(-1));
  const missingSink = eventRelay.createSessionTimelineConsumer(timeline);
  const missingResult = await missingSink.consume(request, completion);
  assert.deepEqual(missingResult, {
    outcome: "failed",
    failure_code: "consumer_rejected",
    retryable: false,
  });
  assert.equal(timeline.listCanonicalEvents(request, completion.session_id, 0).length, 8);
  assert.throws(
    () => eventRelay.createSessionTimelineWorkflowConsumer(timeline, null),
    eventRelay.EventRelayConfigurationError,
  );

  const secondTimeline = events.createDeterministicSessionTimelineRepository();
  for (const event of domainEvents.slice(0, -1)) {
    secondTimeline.appendCanonicalEvent(request, events.encodeInteractionEvent(event));
  }
  const mismatchedSink = {
    async enqueueSessionCompletion() {
      return {
        schema_version: "2.0.0",
        tenant_id: tenantBeta,
        session_id: completion.session_id,
        source_event_id: completion.event_id,
        source_event_fingerprint: domain.sha256Canonical(completion),
        command_id: id(6_300),
        workflow_run_id: id(6_301),
        command_fingerprint: "a".repeat(64),
        trace_id: completion.trace_id,
        correlation_id: completion.correlation_id,
        enqueued_at: "2026-07-15T15:00:00.000Z",
        data_classification: "internal",
      };
    },
  };
  const mismatchedConsumer = eventRelay.createSessionTimelineWorkflowConsumer(secondTimeline, mismatchedSink);
  assert.deepEqual(await mismatchedConsumer.consume(request, completion), {
    outcome: "failed",
    failure_code: "consumer_rejected",
    retryable: false,
  });
  assert.equal(secondTimeline.listCanonicalEvents(request, completion.session_id, 0).length, 9);

  const noDispatch = authorizedRequest({
    token: "dev_workflow_missing_dispatch",
    scopes: ["session:read", "session:write", "event:relay", "workflow:execute", "workflow:observe"],
  });
  const thirdTimeline = events.createDeterministicSessionTimelineRepository();
  for (const event of domainEvents.slice(0, -1)) {
    thirdTimeline.appendCanonicalEvent(noDispatch, events.encodeInteractionEvent(event));
  }
  const thirdFixture = createWorkflowFixture({ timeline: thirdTimeline, factory: idFactory(13_500) });
  const composed = eventRelay.createSessionTimelineWorkflowConsumer(thirdTimeline, thirdFixture.repository);
  assert.deepEqual(await composed.consume(noDispatch, completion), {
    outcome: "failed",
    failure_code: "consumer_rejected",
    retryable: false,
  });
  assert.equal(thirdTimeline.listCanonicalEvents(noDispatch, completion.session_id, 0).length, 8);
});
