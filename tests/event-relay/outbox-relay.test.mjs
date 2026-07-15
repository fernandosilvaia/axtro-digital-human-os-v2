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
const eventRelay = await import(pathToFileURL(join(root, "apps/event-relay/dist/index.js")).href);
const walkingSequence = JSON.parse(readFileSync(join(root, "tests/fixtures/reducers/walking-sequence.json"), "utf8"));

const tenantAlpha = id(1);
const tenantBeta = id(2);
const actorAlpha = id(3);
const actorBeta = id(4);

function id(offset) {
  return domain.uuidV7FromParts(
    1_700_700_000_000 + offset,
    Uint8Array.from(Array.from({ length: 10 }, (_, index) => (offset + index + 17) & 0xff)),
  );
}

function runtimeConfiguration() {
  return config.loadRuntimeConfig({
    AXTRO_ENV: "test",
    AXTRO_SERVICE_NAME: "event-relay",
    AXTRO_PROVIDER_MODE: "fake",
    AXTRO_SECRET_BROKER_HANDLE: "secret://local/event-relay-test-broker",
    AXTRO_PORT: "3000",
    AXTRO_REQUEST_TIMEOUT_MS: "10000",
    AXTRO_DEV_AUTH_ENABLED: "true",
    AXTRO_LOG_LEVEL: "info",
  });
}

function authorizedRequest({
  tenantId = tenantAlpha,
  actorId = actorAlpha,
  token = "dev_event_relay_alpha_0001",
  scopes = ["session:read", "session:write", "event:relay", "event:observe"],
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

function eventFor({ tenantId = tenantAlpha, aggregateId, eventId, aggregateVersion }) {
  const template = walkingSequence[aggregateVersion - 1];
  if (template === undefined) throw new Error("missing deterministic event template");
  const event = structuredClone(template);
  event.tenant_id = tenantId;
  event.aggregate_id = aggregateId;
  event.session_id = aggregateId;
  event.event_id = eventId;
  event.aggregate_version = aggregateVersion;
  event.correlation_id = id(1_000 + aggregateVersion + eventId.charCodeAt(0));
  event.causation_id = aggregateVersion === 1 ? null : id(1_100 + aggregateVersion + eventId.charCodeAt(1));
  event.occurred_at = aggregateVersion === 1
    ? "2026-07-15T11:00:00.000Z"
    : "2026-07-15T11:00:01.000Z";
  return event;
}

function telemetryFixture(sink = new observability.InMemoryTelemetrySink()) {
  let spanSequence = 0;
  const runtime = observability.createTelemetryRuntime({
    sink,
    clock: () => 1_700_700_100_000 + spanSequence,
    idGenerator: {
      createTraceId: () => "1".repeat(32),
      createSpanId: () => (++spanSequence).toString(16).padStart(16, "0"),
      createCorrelationId: () => id(900 + spanSequence),
    },
  });
  return { runtime, sink };
}

function relayFixture({
  outbox,
  timeline,
  clock,
  tokenOffsets,
  faultPoints = [],
  leaseDurationMs = 100,
  maxAttempts = 3,
  retryDelayMs = 100,
  telemetry = telemetryFixture().runtime,
}) {
  return eventRelay.createEventRelay({
    outbox,
    consumer: eventRelay.createSessionTimelineConsumer(timeline),
    clock,
    claim_token_factory: eventRelay.createDeterministicClaimTokenFactory(tokenOffsets.map(id)),
    telemetry,
    lease_duration_ms: leaseDurationMs,
    max_attempts: maxAttempts,
    retry_delay_ms: retryDelayMs,
    fault_points: faultPoints,
  });
}

test("runOnce publishes one canonical event and exposes only a PII-free receipt", async () => {
  const request = authorizedRequest();
  const outbox = events.createDeterministicTransactionalOutboxRepository();
  const timeline = events.createDeterministicSessionTimelineRepository();
  const clock = eventRelay.createManualEventRelayClock("2026-07-15T12:00:00.000Z");
  const aggregateId = id(20);
  const eventId = id(21);
  await outbox.commitInteractionEvent(request, eventFor({ aggregateId, eventId, aggregateVersion: 1 }));
  const relay = relayFixture({ outbox, timeline, clock, tokenOffsets: [500, 501] });

  const result = await relay.runOnce(request);
  assert.equal(result.outcome, "published");
  assert.equal(result.receipt.event_id, eventId);
  assert.equal(result.receipt.attempt, 1);
  assert.equal(result.receipt.failure_code, null);
  assert.match(result.receipt.effect_hash, /^[0-9a-f]{64}$/);
  assert.equal(Object.isFrozen(result.receipt), true);
  assert.deepEqual(Object.keys(result.receipt).sort(), [
    "aggregate_id",
    "aggregate_version",
    "attempt",
    "completed_at",
    "consumer_name",
    "data_classification",
    "effect_hash",
    "event_fingerprint",
    "event_id",
    "failure_code",
    "max_attempts",
    "schema_version",
    "started_at",
    "status",
    "tenant_id",
    "trace_id",
    "correlation_id",
  ].sort());
  assert.equal(result.receipt.trace_id, walkingSequence[0].trace_id);
  assert.equal(result.receipt.correlation_id, eventFor({ aggregateId, eventId, aggregateVersion: 1 }).correlation_id);
  const serializedReceipt = JSON.stringify(result.receipt);
  for (const prohibited of ["payload_json", "transcript", "claim_token", "Bearer", "stack", "exception"]) {
    assert.equal(serializedReceipt.includes(prohibited), false);
  }
  assert.equal(timeline.listCanonicalEvents(request, aggregateId, 0).length, 1);
  assert.equal(outbox.listOutbox(request)[0].status, "published");
  assert.deepEqual(outbox.readLatestDeliveryReceipt(request, "session-timeline", eventId), result.receipt);
  assert.deepEqual(outbox.listDeadLetters(request, "session-timeline"), []);
  assert.deepEqual(await relay.runOnce(request), { outcome: "idle", receipt: null });
});

test("a replacement relay recovers a crash after claim only when the lease expires", async () => {
  const request = authorizedRequest({ token: "dev_event_relay_claim_0001" });
  const outbox = events.createDeterministicTransactionalOutboxRepository();
  const timeline = events.createDeterministicSessionTimelineRepository();
  const clock = eventRelay.createManualEventRelayClock("2026-07-15T12:10:00.000Z");
  const aggregateId = id(30);
  const eventId = id(31);
  await outbox.commitInteractionEvent(request, eventFor({ aggregateId, eventId, aggregateVersion: 1 }));
  const crashing = relayFixture({
    outbox,
    timeline,
    clock,
    tokenOffsets: [510],
    faultPoints: ["after_claim_before_effect"],
  });
  await assert.rejects(crashing.runOnce(request), (error) => {
    assert.equal(error instanceof eventRelay.EventRelayCrashError, true);
    assert.equal(error.point, "after_claim_before_effect");
    return true;
  });
  assert.equal(timeline.listCanonicalEvents(request, aggregateId, 0).length, 0);
  assert.deepEqual(outbox.listOutbox(request).map((record) => [record.status, record.attempts]), [["publishing", 1]]);

  const replacement = relayFixture({
    outbox,
    timeline,
    clock,
    tokenOffsets: [511, 512],
    maxAttempts: 4,
  });
  assert.deepEqual(await replacement.runOnce(request), { outcome: "idle", receipt: null });
  assert.equal(outbox.listOutbox(request)[0].status, "publishing");
  clock.advanceBy(100);
  const recovered = await replacement.runOnce(request);
  assert.equal(recovered.outcome, "published");
  assert.equal(recovered.receipt.attempt, 2);
  assert.equal(recovered.receipt.max_attempts, 3);
  assert.equal(timeline.listCanonicalEvents(request, aggregateId, 0).length, 1);
});

test("a crash after the timeline effect redelivers without applying the effect twice", async () => {
  const request = authorizedRequest({ token: "dev_event_relay_effect_0001" });
  const outbox = events.createDeterministicTransactionalOutboxRepository();
  const timeline = events.createDeterministicSessionTimelineRepository();
  const clock = eventRelay.createManualEventRelayClock("2026-07-15T12:20:00.000Z");
  const aggregateId = id(40);
  const eventId = id(41);
  await outbox.commitInteractionEvent(request, eventFor({ aggregateId, eventId, aggregateVersion: 1 }));
  const crashing = relayFixture({
    outbox,
    timeline,
    clock,
    tokenOffsets: [520],
    faultPoints: ["after_effect_before_ack"],
  });
  await assert.rejects(crashing.runOnce(request), eventRelay.EventRelayCrashError);
  assert.equal(timeline.listCanonicalEvents(request, aggregateId, 0).length, 1);
  assert.equal(outbox.listOutbox(request)[0].status, "publishing");

  clock.advanceBy(100);
  const replacement = relayFixture({ outbox, timeline, clock, tokenOffsets: [521] });
  const result = await replacement.runOnce(request);
  assert.equal(result.outcome, "published");
  assert.equal(result.receipt.attempt, 2);
  assert.equal(timeline.listCanonicalEvents(request, aggregateId, 0).length, 1);
  assert.equal(result.receipt.effect_hash, timeline.appendCanonicalEvent(request, events.encodeInteractionEvent(eventFor({
    aggregateId,
    eventId,
    aggregateVersion: 1,
  }))).state_hash);
});

test("a stale acknowledgement token cannot complete a recovered attempt", async () => {
  const request = authorizedRequest({ token: "dev_event_relay_fence_0001" });
  const outbox = events.createDeterministicTransactionalOutboxRepository();
  const aggregateId = id(50);
  const eventId = id(51);
  const oldToken = id(530);
  const newToken = id(531);
  await outbox.commitInteractionEvent(request, eventFor({ aggregateId, eventId, aggregateVersion: 1 }));
  const first = await outbox.claimNextDelivery(request, {
    consumer_name: "session-timeline",
    claim_token: oldToken,
    now: "2026-07-15T12:30:00.000Z",
    lease_duration_ms: 100,
    max_attempts: 3,
  });
  assert.equal(first.outcome, "claimed");
  await assert.rejects(outbox.acknowledgeDelivery(request, {
    event_id: eventId,
    consumer_name: "session-timeline",
    claim_token: oldToken,
    completed_at: "2026-07-15T12:30:00.100Z",
    effect_hash: "a".repeat(64),
  }), events.TransactionalOutboxConflictError);
  await assert.rejects(outbox.claimNextDelivery(request, {
    consumer_name: "session-timeline",
    claim_token: oldToken,
    now: "2026-07-15T12:30:00.100Z",
    lease_duration_ms: 100,
    max_attempts: 3,
  }), events.TransactionalOutboxConflictError);
  assert.deepEqual(outbox.listOutbox(request).map((record) => [record.status, record.attempts]), [["publishing", 1]]);
  const second = await outbox.claimNextDelivery(request, {
    consumer_name: "session-timeline",
    claim_token: newToken,
    now: "2026-07-15T12:30:00.100Z",
    lease_duration_ms: 100,
    max_attempts: 3,
  });
  assert.equal(second.outcome, "claimed");
  assert.equal(second.claim.attempt, 2);

  await assert.rejects(outbox.acknowledgeDelivery(request, {
    event_id: eventId,
    consumer_name: "session-timeline",
    claim_token: oldToken,
    completed_at: "2026-07-15T12:30:00.100Z",
    effect_hash: "a".repeat(64),
  }), events.TransactionalOutboxConflictError);
  assert.equal(outbox.listOutbox(request)[0].status, "publishing");
  const receipt = await outbox.acknowledgeDelivery(request, {
    event_id: eventId,
    consumer_name: "session-timeline",
    claim_token: newToken,
    completed_at: "2026-07-15T12:30:00.100Z",
    effect_hash: "b".repeat(64),
  });
  assert.equal(receipt.status, "published");
  assert.equal(receipt.attempt, 2);
});

test("a poison event enters one PII-free DLQ and blocks only its aggregate", async () => {
  const request = authorizedRequest({ token: "dev_event_relay_poison_0001" });
  const outbox = events.createDeterministicTransactionalOutboxRepository();
  const timeline = events.createDeterministicSessionTimelineRepository();
  const clock = eventRelay.createManualEventRelayClock("2026-07-15T12:40:00.000Z");
  const aggregateA = id(60);
  const aggregateB = id(70);
  const eventAOne = id(61);
  const eventATwo = id(62);
  const eventBOne = id(71);
  const originalAOne = eventFor({ aggregateId: aggregateA, eventId: eventAOne, aggregateVersion: 1 });
  const alteredAOne = structuredClone(originalAOne);
  alteredAOne.payload.role.objective = "Conflicting poison fixture.";
  timeline.appendCanonicalEvent(request, events.encodeInteractionEvent(alteredAOne));
  await outbox.commitInteractionEvent(request, originalAOne);
  await outbox.commitInteractionEvent(request, eventFor({ aggregateId: aggregateA, eventId: eventATwo, aggregateVersion: 2 }));
  await outbox.commitInteractionEvent(request, eventFor({ aggregateId: aggregateB, eventId: eventBOne, aggregateVersion: 1 }));
  const relay = relayFixture({ outbox, timeline, clock, tokenOffsets: [540, 541, 542] });

  const poison = await relay.runOnce(request);
  assert.equal(poison.outcome, "dead_letter");
  assert.equal(poison.receipt.event_id, eventAOne);
  assert.equal(poison.receipt.failure_code, "timeline_conflict");
  assert.equal(poison.receipt.attempt, 1);
  assert.equal(poison.receipt.effect_hash, null);
  const deadLetters = outbox.listDeadLetters(request, "session-timeline");
  assert.deepEqual(deadLetters, [poison.receipt]);
  assert.equal(JSON.stringify(deadLetters).includes("payload_json"), false);

  const independent = await relay.runOnce(request);
  assert.equal(independent.outcome, "published");
  assert.equal(independent.receipt.event_id, eventBOne);
  assert.deepEqual(await relay.runOnce(request), { outcome: "idle", receipt: null });
  assert.deepEqual(outbox.listOutbox(request).map((record) => [record.event_id, record.status]), [
    [eventAOne, "dead_letter"],
    [eventATwo, "pending"],
    [eventBOne, "published"],
  ]);
  assert.equal(outbox.listDeadLetters(request, "session-timeline").length, 1);
});

test("retry availability and maximum attempts prevent a retry storm", async () => {
  const request = authorizedRequest({ token: "dev_event_relay_retry_0001" });
  const outbox = events.createDeterministicTransactionalOutboxRepository();
  const timeline = events.createDeterministicSessionTimelineRepository({ max_events_per_session: 1 });
  const clock = eventRelay.createManualEventRelayClock("2026-07-15T12:50:00.000Z");
  const aggregateId = id(80);
  const eventOne = id(81);
  const eventTwo = id(82);
  await outbox.commitInteractionEvent(request, eventFor({ aggregateId, eventId: eventOne, aggregateVersion: 1 }));
  await outbox.commitInteractionEvent(request, eventFor({ aggregateId, eventId: eventTwo, aggregateVersion: 2 }));
  const relay = relayFixture({
    outbox,
    timeline,
    clock,
    tokenOffsets: [550, 551, 552, 553],
    maxAttempts: 2,
    retryDelayMs: 100,
  });

  assert.equal((await relay.runOnce(request)).outcome, "published");
  const retry = await relay.runOnce(request);
  assert.equal(retry.outcome, "retry_scheduled");
  assert.equal(retry.receipt.event_id, eventTwo);
  assert.equal(retry.receipt.failure_code, "timeline_capacity");
  assert.equal(retry.receipt.attempt, 1);
  assert.deepEqual(await relay.runOnce(request), { outcome: "idle", receipt: null });
  assert.equal(outbox.listOutbox(request)[1].attempts, 1);

  clock.advanceBy(100);
  const exhausted = await relay.runOnce(request);
  assert.equal(exhausted.outcome, "dead_letter");
  assert.equal(exhausted.receipt.failure_code, "max_attempts_exhausted");
  assert.equal(exhausted.receipt.attempt, 2);
  assert.equal(outbox.listOutbox(request)[1].status, "dead_letter");
  assert.equal(outbox.listDeadLetters(request, "session-timeline").length, 1);
});

test("relay and observation scopes fail closed across tenants before mutation", async () => {
  const alpha = authorizedRequest({ token: "dev_event_relay_scope_alpha" });
  const beta = authorizedRequest({
    tenantId: tenantBeta,
    actorId: actorBeta,
    token: "dev_event_relay_scope_beta_1",
  });
  const writeOnly = authorizedRequest({
    token: "dev_event_relay_write_only",
    scopes: ["session:write"],
  });
  const relayOnly = authorizedRequest({
    token: "dev_event_relay_relay_only",
    scopes: ["event:relay"],
  });
  const wrongPurpose = authorizedRequest({
    token: "dev_event_relay_wrong_purpose",
    purposes: ["provider_auth"],
  });
  const outbox = events.createDeterministicTransactionalOutboxRepository();
  const timeline = events.createDeterministicSessionTimelineRepository();
  const clock = eventRelay.createManualEventRelayClock("2026-07-15T13:00:00.000Z");
  const aggregateId = id(90);
  const eventId = id(91);
  await outbox.commitInteractionEvent(alpha, eventFor({ aggregateId, eventId, aggregateVersion: 1 }));
  const relay = relayFixture({ outbox, timeline, clock, tokenOffsets: [560, 561, 562] });

  await assert.rejects(relay.runOnce(writeOnly), eventRelay.EventRelayAuthorizationError);
  await assert.rejects(relay.runOnce(relayOnly), eventRelay.EventRelayAuthorizationError);
  await assert.rejects(relay.runOnce(wrongPurpose), eventRelay.EventRelayAuthorizationError);
  await assert.rejects(outbox.claimNextDelivery(wrongPurpose, {
    consumer_name: "session-timeline",
    claim_token: id(564),
    now: clock.now(),
    lease_duration_ms: 100,
    max_attempts: 3,
  }), events.TransactionalOutboxAuthorizationError);
  assert.equal(outbox.listOutbox(alpha)[0].status, "pending");
  assert.deepEqual(await relay.runOnce(beta), { outcome: "idle", receipt: null });
  assert.equal(outbox.listOutbox(alpha)[0].status, "pending");
  assert.throws(
    () => outbox.listDeadLetters(writeOnly, "session-timeline"),
    events.TransactionalOutboxAuthorizationError,
  );

  const claim = await outbox.claimNextDelivery(alpha, {
    consumer_name: "session-timeline",
    claim_token: id(563),
    now: clock.now(),
    lease_duration_ms: 100,
    max_attempts: 3,
  });
  assert.equal(claim.outcome, "claimed");
  await assert.rejects(outbox.acknowledgeDelivery(beta, {
    event_id: eventId,
    consumer_name: "session-timeline",
    claim_token: id(563),
    completed_at: clock.now(),
    effect_hash: "c".repeat(64),
  }), events.TransactionalOutboxConflictError);
  assert.equal(outbox.listOutbox(alpha)[0].status, "publishing");
});

test("an unregistered consumer cannot bind or mutate a pending delivery", async () => {
  const request = authorizedRequest({ token: "dev_event_relay_consumer_registry" });
  const outbox = events.createDeterministicTransactionalOutboxRepository();
  const aggregateId = id(95);
  const eventId = id(96);
  await outbox.commitInteractionEvent(request, eventFor({ aggregateId, eventId, aggregateVersion: 1 }));

  await assert.rejects(outbox.claimNextDelivery(request, {
    consumer_name: "squatting-consumer",
    claim_token: id(565),
    now: "2026-07-15T13:05:00.000Z",
    lease_duration_ms: 100,
    max_attempts: 3,
  }), events.TransactionalOutboxConfigurationError);
  assert.deepEqual(outbox.listOutbox(request).map((record) => [record.status, record.attempts]), [["pending", 0]]);

  const claim = await outbox.claimNextDelivery(request, {
    consumer_name: "session-timeline",
    claim_token: id(565),
    now: "2026-07-15T13:05:00.000Z",
    lease_duration_ms: 100,
    max_attempts: 3,
  });
  assert.equal(claim.outcome, "claimed");
  assert.equal(claim.claim.attempt, 1);
});

test("a mismatched timeline receipt is terminal and can never acknowledge the outbox", async () => {
  const request = authorizedRequest({ token: "dev_event_relay_mismatch_receipt" });
  const outbox = events.createDeterministicTransactionalOutboxRepository();
  const clock = eventRelay.createManualEventRelayClock("2026-07-15T13:07:00.000Z");
  const aggregateId = id(97);
  const eventId = id(98);
  await outbox.commitInteractionEvent(request, eventFor({ aggregateId, eventId, aggregateVersion: 1 }));
  const mismatchedTimeline = {
    appendCanonicalEvent() {
      return {
        tenant_id: tenantBeta,
        session_id: aggregateId,
        event_id: eventId,
        aggregate_version: 1,
        event_fingerprint: "d".repeat(64),
        state_hash: "e".repeat(64),
      };
    },
  };
  const relay = relayFixture({
    outbox,
    timeline: mismatchedTimeline,
    clock,
    tokenOffsets: [566],
  });

  const result = await relay.runOnce(request);
  assert.equal(result.outcome, "dead_letter");
  assert.equal(result.receipt.failure_code, "consumer_rejected");
  assert.equal(result.receipt.effect_hash, null);
  assert.deepEqual(outbox.listOutbox(request).map((record) => [record.status, record.attempts]), [["dead_letter", 1]]);
  assert.deepEqual(outbox.listDeadLetters(request, "session-timeline"), [result.receipt]);
});

test("relay telemetry keeps canonical correlation and sink failure cannot alter ACK or retry", async () => {
  const request = authorizedRequest({ token: "dev_event_relay_telemetry" });
  const aggregateId = id(130);
  const eventId = id(131);
  const canonicalEvent = eventFor({ aggregateId, eventId, aggregateVersion: 1 });
  const outbox = events.createDeterministicTransactionalOutboxRepository();
  const timeline = events.createDeterministicSessionTimelineRepository();
  const clock = eventRelay.createManualEventRelayClock("2026-07-15T13:08:00.000Z");
  const telemetry = telemetryFixture();
  await outbox.commitInteractionEvent(request, canonicalEvent);
  const relay = relayFixture({ outbox, timeline, clock, tokenOffsets: [567], telemetry: telemetry.runtime });

  const result = await relay.runOnce(request);
  assert.equal(result.outcome, "published");
  assert.equal(telemetry.sink.spans.length, 1);
  assert.equal(telemetry.sink.spans[0].name, "outbox.relay");
  assert.equal(telemetry.sink.spans[0].service_name, "event-relay");
  assert.equal(telemetry.sink.spans[0].tenant_id, tenantAlpha);
  assert.equal(telemetry.sink.spans[0].session_id, aggregateId);
  assert.equal(telemetry.sink.spans[0].trace_id, canonicalEvent.trace_id);
  assert.equal(telemetry.sink.spans[0].correlation_id, canonicalEvent.correlation_id);
  assert.deepEqual(telemetry.sink.logs.map((record) => record.event_code), [
    "outbox.relay.started",
    "outbox.relay.completed",
  ]);
  const serializedTelemetry = JSON.stringify({ spans: telemetry.sink.spans, logs: telemetry.sink.logs });
  for (const prohibited of ["payload_json", "transcript", "claim_token", canonicalEvent.payload.role.objective]) {
    assert.equal(serializedTelemetry.includes(prohibited), false);
  }

  const throwingSink = Object.freeze({
    emitSpan() { throw new Error("deterministic sink failure"); },
    emitLog() { throw new Error("deterministic sink failure"); },
  });
  const failedTelemetry = telemetryFixture(throwingSink);
  const secondOutbox = events.createDeterministicTransactionalOutboxRepository();
  const boundedTimeline = events.createDeterministicSessionTimelineRepository({ max_events_per_session: 1 });
  const secondClock = eventRelay.createManualEventRelayClock("2026-07-15T13:09:00.000Z");
  const firstEvent = eventFor({ aggregateId: id(140), eventId: id(141), aggregateVersion: 1 });
  const secondEvent = eventFor({ aggregateId: id(140), eventId: id(142), aggregateVersion: 2 });
  await secondOutbox.commitInteractionEvent(request, firstEvent);
  await secondOutbox.commitInteractionEvent(request, secondEvent);
  const secondRelay = relayFixture({
    outbox: secondOutbox,
    timeline: boundedTimeline,
    clock: secondClock,
    tokenOffsets: [568, 569],
    telemetry: failedTelemetry.runtime,
  });

  assert.equal((await secondRelay.runOnce(request)).outcome, "published");
  const retry = await secondRelay.runOnce(request);
  assert.equal(retry.outcome, "retry_scheduled");
  assert.equal(retry.receipt.failure_code, "timeline_capacity");
  assert.deepEqual(secondOutbox.listOutbox(request).map((record) => [record.status, record.attempts]), [
    ["published", 1],
    ["failed", 1],
  ]);
  assert.equal(boundedTimeline.listCanonicalEvents(request, id(140), 0).length, 1);
  assert.deepEqual(failedTelemetry.runtime.emissionFailureCounts, { span: 2, log: 4 });
});

test("every contract-valid canonical trace emits a stable W3C relay span", async () => {
  const request = authorizedRequest({ token: "dev_event_relay_trace_profiles" });
  const profiles = ["1".repeat(16), "f".repeat(64), "0".repeat(32)];

  for (const [index, sourceTraceId] of profiles.entries()) {
    const aggregateId = id(150 + index * 10);
    const eventId = id(151 + index * 10);
    const canonicalEvent = eventFor({ aggregateId, eventId, aggregateVersion: 1 });
    canonicalEvent.trace_id = sourceTraceId;
    const outbox = events.createDeterministicTransactionalOutboxRepository();
    const timeline = events.createDeterministicSessionTimelineRepository();
    const clock = eventRelay.createManualEventRelayClock(`2026-07-15T13:${20 + index}:00.000Z`);
    const telemetry = telemetryFixture();
    await outbox.commitInteractionEvent(request, canonicalEvent);
    const relay = relayFixture({
      outbox,
      timeline,
      clock,
      tokenOffsets: [580 + index],
      telemetry: telemetry.runtime,
    });

    const result = await relay.runOnce(request);
    assert.equal(result.outcome, "published");
    assert.equal(result.receipt.trace_id, sourceTraceId);
    assert.equal(telemetry.sink.spans.length, 1);
    const normalizedTraceId = telemetry.sink.spans[0].trace_id;
    assert.match(normalizedTraceId, /^[0-9a-f]{32}$/);
    assert.notEqual(normalizedTraceId, "0".repeat(32));
    const repeatedContext = telemetry.runtime.startTrustedEventTrace({
      serviceName: "event-relay",
      tenantId: tenantAlpha,
      sessionId: aggregateId,
      traceId: sourceTraceId,
      correlationId: canonicalEvent.correlation_id,
      causationId: canonicalEvent.causation_id,
    });
    assert.equal(repeatedContext.traceId, normalizedTraceId);
  }
});

test("outbox capacity is bounded per tenant and invalid runtime capabilities are rejected", async () => {
  const alpha = authorizedRequest({ token: "dev_event_relay_capacity_a" });
  const beta = authorizedRequest({
    tenantId: tenantBeta,
    actorId: actorBeta,
    token: "dev_event_relay_capacity_b",
  });
  const outbox = events.createDeterministicTransactionalOutboxRepository({ maxRecordsPerTenant: 1 });
  await outbox.commitInteractionEvent(alpha, eventFor({ aggregateId: id(100), eventId: id(101), aggregateVersion: 1 }));
  await assert.rejects(
    outbox.commitInteractionEvent(alpha, eventFor({ aggregateId: id(110), eventId: id(111), aggregateVersion: 1 })),
    events.TransactionalOutboxCapacityError,
  );
  assert.equal(outbox.listOutbox(alpha).length, 1);
  await outbox.commitInteractionEvent(beta, eventFor({
    tenantId: tenantBeta,
    aggregateId: id(120),
    eventId: id(121),
    aggregateVersion: 1,
  }));
  assert.equal(outbox.listOutbox(beta).length, 1);
  assert.throws(
    () => events.createDeterministicTransactionalOutboxRepository({ maxRecordsPerTenant: 0 }),
    events.TransactionalOutboxConfigurationError,
  );

  const timeline = events.createDeterministicSessionTimelineRepository();
  const consumer = eventRelay.createSessionTimelineConsumer(timeline);
  const clock = eventRelay.createManualEventRelayClock("2026-07-15T13:10:00.000Z");
  const tokenFactory = eventRelay.createDeterministicClaimTokenFactory([id(570)]);
  const validOptions = {
    outbox,
    consumer,
    clock,
    claim_token_factory: tokenFactory,
    telemetry: telemetryFixture().runtime,
  };
  assert.throws(
    () => eventRelay.createEventRelay({ ...validOptions, fault_points: ["after_claim_before_effect", "after_claim_before_effect"] }),
    eventRelay.EventRelayConfigurationError,
  );
  assert.throws(
    () => eventRelay.createEventRelay({ ...validOptions, clock: { now: () => clock.now() } }),
    eventRelay.EventRelayConfigurationError,
  );
  assert.throws(
    () => eventRelay.createEventRelay({ ...validOptions, consumer: { name: "session-timeline", consume: consumer.consume } }),
    eventRelay.EventRelayConfigurationError,
  );
  assert.throws(
    () => eventRelay.createDeterministicClaimTokenFactory([id(571), id(571)]),
    eventRelay.EventRelayConfigurationError,
  );
  for (const invalid of [
    { lease_duration_ms: 99 },
    { lease_duration_ms: 300_001 },
    { max_attempts: 0 },
    { max_attempts: 17 },
    { retry_delay_ms: -1 },
    { retry_delay_ms: 3_600_001 },
  ]) {
    assert.throws(
      () => eventRelay.createEventRelay({ ...validOptions, ...invalid }),
      eventRelay.EventRelayConfigurationError,
    );
  }
  assert.throws(
    () => eventRelay.createEventRelay({ ...validOptions, unexpected: true }),
    eventRelay.EventRelayConfigurationError,
  );
  const getterOptions = { ...validOptions };
  Object.defineProperty(getterOptions, "max_attempts", { enumerable: true, get: () => 3 });
  assert.throws(() => eventRelay.createEventRelay(getterOptions), eventRelay.EventRelayConfigurationError);
  assert.throws(() => clock.advanceBy(-1), eventRelay.EventRelayConfigurationError);
});
