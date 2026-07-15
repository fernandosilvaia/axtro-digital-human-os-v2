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
const walkingSequence = JSON.parse(readFileSync(join(root, "tests/fixtures/reducers/walking-sequence.json"), "utf8"));

const tenantAlpha = id(1);
const tenantBeta = id(2);
const actorAlpha = id(3);
const actorBeta = id(4);
const aggregateAlpha = id(20);
const aggregateBeta = id(21);
const alphaEventOne = id(30);
const alphaEventTwo = id(31);
const betaEventOne = id(32);

function id(offset) {
  return domain.uuidV7FromParts(
    1_700_400_000_000 + offset,
    Uint8Array.from(Array.from({ length: 10 }, (_, index) => (offset + index + 11) & 0xff)),
  );
}

function runtimeConfiguration() {
  return config.loadRuntimeConfig({
    AXTRO_ENV: "test",
    AXTRO_SERVICE_NAME: "api",
    AXTRO_PROVIDER_MODE: "fake",
    AXTRO_SECRET_BROKER_HANDLE: "secret://local/outbox-test-broker",
    AXTRO_PORT: "3000",
    AXTRO_REQUEST_TIMEOUT_MS: "10000",
    AXTRO_DEV_AUTH_ENABLED: "true",
    AXTRO_LOG_LEVEL: "info",
  });
}

function authorizedRequest(
  tenantId,
  actorId,
  token,
  scopes = ["session:read", "session:write", "event:relay", "event:observe"],
) {
  const verifier = auth.createDevelopmentIdentityVerifier(runtimeConfiguration(), [{
    token,
    actorId,
    actorType: "workflow",
    identityKind: "service",
    tenantGrants: [{
      tenantId,
      grantedScopes: scopes,
      purposes: ["essential_processing"],
    }],
  }]);
  return auth.resolveAuthorizedRequestContext({ authorization: `Bearer ${token}`, requestedTenantId: tenantId }, verifier);
}

function eventFor({ tenantId, aggregateId, eventId, aggregateVersion }) {
  const template = aggregateVersion === 1 ? walkingSequence[0] : walkingSequence[1];
  const event = structuredClone(template);
  event.tenant_id = tenantId;
  event.aggregate_id = aggregateId;
  event.session_id = aggregateId;
  event.event_id = eventId;
  event.aggregate_version = aggregateVersion;
  event.correlation_id = id(100 + aggregateVersion);
  event.causation_id = aggregateVersion === 1 ? null : id(200 + aggregateVersion);
  event.occurred_at = aggregateVersion === 1 ? "2026-07-14T12:00:00.000Z" : "2026-07-14T12:00:01.000Z";
  return event;
}

test("aggregate state and canonical outbox envelope commit atomically for an authorized tenant", async () => {
  const repository = events.createDeterministicTransactionalOutboxRepository();
  const request = authorizedRequest(tenantAlpha, actorAlpha, "dev_outbox_alpha_0001");
  const event = eventFor({ tenantId: tenantAlpha, aggregateId: aggregateAlpha, eventId: alphaEventOne, aggregateVersion: 1 });

  const result = await repository.commitInteractionEvent(request, event);

  assert.equal(result.aggregate.session.state_version, 1);
  assert.equal(result.outbox.event_id, alphaEventOne);
  assert.equal(result.outbox.status, "pending");
  assert.equal(result.outbox.event.payload_json, domain.canonicalJson(event.payload));
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.outbox.event), true);
  assert.deepEqual(repository.readInteractionAggregate(request, aggregateAlpha), result.aggregate);
  assert.deepEqual(repository.listOutbox(request), [result.outbox]);
});

test("a contiguous interaction batch commits or rolls back state and every pending outbox row together", async () => {
  const request = authorizedRequest(tenantAlpha, actorAlpha, "dev_outbox_batch_0001");
  const first = eventFor({ tenantId: tenantAlpha, aggregateId: aggregateAlpha, eventId: alphaEventOne, aggregateVersion: 1 });
  const second = eventFor({ tenantId: tenantAlpha, aggregateId: aggregateAlpha, eventId: alphaEventTwo, aggregateVersion: 2 });
  const repository = events.createDeterministicTransactionalOutboxRepository();

  const committed = await repository.commitInteractionEvents(request, [first, second]);
  assert.equal(committed.aggregate.session.state_version, 2);
  assert.deepEqual(committed.outbox.map((record) => record.aggregate_version), [1, 2]);
  assert.deepEqual(repository.listOutbox(request).map((record) => record.event_id), [alphaEventOne, alphaEventTwo]);

  const rollbackRepository = events.createDeterministicTransactionalOutboxRepository({ faultPoints: ["after_outbox_insert"] });
  await assert.rejects(
    rollbackRepository.commitInteractionEvents(request, [first, second]),
    events.TransactionalOutboxTransactionError,
  );
  assert.equal(rollbackRepository.readInteractionAggregate(request, aggregateAlpha), null);
  assert.deepEqual(rollbackRepository.listOutbox(request), []);

  await assert.rejects(
    repository.commitInteractionEvents(request, [first, { ...second, aggregate_id: aggregateBeta, session_id: aggregateBeta }]),
    events.TransactionalOutboxConfigurationError,
  );
});

test("injected aggregate, outbox and commit failures restore both sides of the local transaction", async () => {
  const request = authorizedRequest(tenantAlpha, actorAlpha, "dev_outbox_rollback_0001");
  const event = eventFor({ tenantId: tenantAlpha, aggregateId: aggregateAlpha, eventId: alphaEventOne, aggregateVersion: 1 });

  for (const faultPoint of ["after_aggregate_write", "after_outbox_insert", "before_commit"]) {
    const repository = events.createDeterministicTransactionalOutboxRepository({ faultPoints: [faultPoint] });
    await assert.rejects(
      repository.commitInteractionEvent(request, event),
      events.TransactionalOutboxTransactionError,
    );
    assert.equal(repository.readInteractionAggregate(request, aggregateAlpha), null);
    assert.deepEqual(repository.listOutbox(request), []);
  }
});

test("a trusted deadline control fences a batch before its aggregate or outbox commit", async () => {
  const repository = events.createDeterministicTransactionalOutboxRepository();
  const request = authorizedRequest(tenantAlpha, actorAlpha, "dev_outbox_control_0001");
  const event = eventFor({ tenantId: tenantAlpha, aggregateId: aggregateAlpha, eventId: alphaEventOne, aggregateVersion: 1 });
  let checks = 0;
  const expiredControl = {
    assertActive() {
      checks += 1;
      if (checks >= 3) throw new Error("deadline-expired-before-commit");
    },
  };
  await assert.rejects(
    repository.commitInteractionEvent(request, event, expiredControl),
    /deadline-expired-before-commit/,
  );
  assert.equal(repository.readInteractionAggregate(request, aggregateAlpha), null);
  assert.deepEqual(repository.listOutbox(request), []);
});

test("duplicate event identities and stale aggregate versions fail without creating an outbox row", async () => {
  const repository = events.createDeterministicTransactionalOutboxRepository();
  const request = authorizedRequest(tenantAlpha, actorAlpha, "dev_outbox_versions_0001");
  const first = eventFor({ tenantId: tenantAlpha, aggregateId: aggregateAlpha, eventId: alphaEventOne, aggregateVersion: 1 });
  await repository.commitInteractionEvent(request, first);

  await assert.rejects(
    repository.commitInteractionEvent(request, first),
    events.TransactionalOutboxConflictError,
  );
  await assert.rejects(
    repository.commitInteractionEvent(request, eventFor({
      tenantId: tenantAlpha,
      aggregateId: aggregateAlpha,
      eventId: alphaEventTwo,
      aggregateVersion: 1,
    })),
    domain.AggregateVersionError,
  );
  await assert.rejects(
    repository.commitInteractionEvent(request, eventFor({
      tenantId: tenantAlpha,
      aggregateId: aggregateAlpha,
      eventId: betaEventOne,
      aggregateVersion: 3,
    })),
    domain.AggregateVersionError,
  );
  assert.equal(repository.listOutbox(request).length, 1);
});

test("a retry receipt advances through a fenced second attempt", async () => {
  const repository = events.createDeterministicTransactionalOutboxRepository();
  const request = authorizedRequest(tenantAlpha, actorAlpha, "dev_outbox_relay_0001");
  const event = eventFor({ tenantId: tenantAlpha, aggregateId: aggregateAlpha, eventId: alphaEventOne, aggregateVersion: 1 });
  await repository.commitInteractionEvent(request, event);

  const first = await repository.claimNextDelivery(request, {
    consumer_name: "session-timeline",
    claim_token: id(300),
    now: "2026-07-14T13:00:00.000Z",
    lease_duration_ms: 100,
    max_attempts: 3,
  });
  assert.equal(first.outcome, "claimed");
  const retry = await repository.failDelivery(request, {
    event_id: alphaEventOne,
    consumer_name: "session-timeline",
    claim_token: id(300),
    completed_at: "2026-07-14T13:00:00.000Z",
    failure_code: "consumer_retryable",
    retryable: true,
    retry_delay_ms: 0,
  });
  assert.equal(retry.status, "retry_scheduled");
  assert.equal(retry.attempt, 1);
  assert.equal(repository.listOutbox(request)[0].status, "failed");

  const second = await repository.claimNextDelivery(request, {
    consumer_name: "session-timeline",
    claim_token: id(301),
    now: "2026-07-14T13:00:00.000Z",
    lease_duration_ms: 100,
    max_attempts: 3,
  });
  assert.equal(second.outcome, "claimed");
  assert.equal(second.claim.attempt, 2);
  const published = await repository.acknowledgeDelivery(request, {
    event_id: alphaEventOne,
    consumer_name: "session-timeline",
    claim_token: id(301),
    completed_at: "2026-07-14T13:00:00.000Z",
    effect_hash: "a".repeat(64),
  });
  assert.equal(published.status, "published");
  assert.equal(published.attempt, 2);
  assert.equal(repository.listOutbox(request)[0].status, "published");
  assert.deepEqual(repository.readLatestDeliveryReceipt(request, "session-timeline", alphaEventOne), published);
});

test("delivery blocks N+1 while N is delayed and keeps a different aggregate independently eligible", async () => {
  const repository = events.createDeterministicTransactionalOutboxRepository();
  const request = authorizedRequest(tenantAlpha, actorAlpha, "dev_outbox_ordering_0001");
  const aggregateA = id(50);
  const aggregateB = id(60);
  const eventAOne = id(51);
  const eventATwo = id(52);
  const eventBOne = id(61);

  await repository.commitInteractionEvent(request, eventFor({
    tenantId: tenantAlpha,
    aggregateId: aggregateA,
    eventId: eventAOne,
    aggregateVersion: 1,
  }));
  await repository.commitInteractionEvent(request, eventFor({
    tenantId: tenantAlpha,
    aggregateId: aggregateA,
    eventId: eventATwo,
    aggregateVersion: 2,
  }));
  await repository.commitInteractionEvent(request, eventFor({
    tenantId: tenantAlpha,
    aggregateId: aggregateB,
    eventId: eventBOne,
    aggregateVersion: 1,
  }));

  const first = await repository.claimNextDelivery(request, {
    consumer_name: "session-timeline",
    claim_token: id(310),
    now: "2026-07-14T14:00:00.000Z",
    lease_duration_ms: 100,
    max_attempts: 3,
  });
  assert.equal(first.claim.event_id, eventAOne);
  await repository.failDelivery(request, {
    event_id: eventAOne,
    consumer_name: "session-timeline",
    claim_token: id(310),
    completed_at: "2026-07-14T14:00:00.000Z",
    failure_code: "consumer_retryable",
    retryable: true,
    retry_delay_ms: 100,
  });
  const independent = await repository.claimNextDelivery(request, {
    consumer_name: "session-timeline",
    claim_token: id(311),
    now: "2026-07-14T14:00:00.000Z",
    lease_duration_ms: 100,
    max_attempts: 3,
  });
  assert.equal(independent.claim.event_id, eventBOne);
  await repository.acknowledgeDelivery(request, {
    event_id: eventBOne,
    consumer_name: "session-timeline",
    claim_token: id(311),
    completed_at: "2026-07-14T14:00:00.000Z",
    effect_hash: "b".repeat(64),
  });
  const retry = await repository.claimNextDelivery(request, {
    consumer_name: "session-timeline",
    claim_token: id(312),
    now: "2026-07-14T14:00:00.100Z",
    lease_duration_ms: 100,
    max_attempts: 3,
  });
  assert.equal(retry.claim.event_id, eventAOne);
  await repository.acknowledgeDelivery(request, {
    event_id: eventAOne,
    consumer_name: "session-timeline",
    claim_token: id(312),
    completed_at: "2026-07-14T14:00:00.100Z",
    effect_hash: "c".repeat(64),
  });
  const successor = await repository.claimNextDelivery(request, {
    consumer_name: "session-timeline",
    claim_token: id(313),
    now: "2026-07-14T14:00:00.100Z",
    lease_duration_ms: 100,
    max_attempts: 3,
  });
  assert.equal(successor.claim.event_id, eventATwo);
  await repository.acknowledgeDelivery(request, {
    event_id: eventATwo,
    consumer_name: "session-timeline",
    claim_token: id(313),
    completed_at: "2026-07-14T14:00:00.100Z",
    effect_hash: "d".repeat(64),
  });
  assert.deepEqual(repository.listOutbox(request).map((record) => [record.event_id, record.status]), [
    [eventAOne, "published"],
    [eventATwo, "published"],
    [eventBOne, "published"],
  ]);
});

test("tenant scope encloses commits, reads, relay delivery and consumer deduplication", async () => {
  const repository = events.createDeterministicTransactionalOutboxRepository();
  const alpha = authorizedRequest(tenantAlpha, actorAlpha, "dev_outbox_isolation_alpha");
  const beta = authorizedRequest(tenantBeta, actorBeta, "dev_outbox_isolation_beta");
  const alphaReadOnly = authorizedRequest(tenantAlpha, actorAlpha, "dev_outbox_readonly_alpha", ["session:read"]);
  const alphaEvent = eventFor({ tenantId: tenantAlpha, aggregateId: aggregateAlpha, eventId: alphaEventOne, aggregateVersion: 1 });
  const betaEvent = eventFor({ tenantId: tenantBeta, aggregateId: aggregateBeta, eventId: alphaEventOne, aggregateVersion: 1 });

  await repository.commitInteractionEvent(alpha, alphaEvent);
  assert.deepEqual(repository.listOutbox(beta), []);
  assert.equal(repository.readInteractionAggregate(beta, aggregateAlpha), null);
  await assert.rejects(repository.commitInteractionEvent(beta, alphaEvent), domain.TenantBoundaryError);
  await assert.rejects(repository.commitInteractionEvent(alphaReadOnly, alphaEvent), events.TransactionalOutboxAuthorizationError);
  assert.throws(() => repository.listOutbox({}), auth.TenantAuthorizationError);

  await repository.commitInteractionEvent(beta, betaEvent);
  const alphaClaim = await repository.claimNextDelivery(alpha, {
    consumer_name: "session-timeline",
    claim_token: id(320),
    now: "2026-07-14T15:00:00.000Z",
    lease_duration_ms: 100,
    max_attempts: 3,
  });
  const betaClaim = await repository.claimNextDelivery(beta, {
    consumer_name: "session-timeline",
    claim_token: id(320),
    now: "2026-07-14T15:00:00.000Z",
    lease_duration_ms: 100,
    max_attempts: 3,
  });
  assert.equal(alphaClaim.claim.event_id, alphaEventOne);
  assert.equal(betaClaim.claim.event_id, alphaEventOne);
  const alphaReceipt = await repository.acknowledgeDelivery(alpha, {
    event_id: alphaEventOne,
    consumer_name: "session-timeline",
    claim_token: id(320),
    completed_at: "2026-07-14T15:00:00.000Z",
    effect_hash: "e".repeat(64),
  });
  const betaReceipt = await repository.acknowledgeDelivery(beta, {
    event_id: alphaEventOne,
    consumer_name: "session-timeline",
    claim_token: id(320),
    completed_at: "2026-07-14T15:00:00.000Z",
    effect_hash: "f".repeat(64),
  });
  assert.equal(repository.readLatestDeliveryReceipt(alpha, "session-timeline", alphaEventOne).effect_hash, alphaReceipt.effect_hash);
  assert.equal(repository.readLatestDeliveryReceipt(beta, "session-timeline", alphaEventOne).effect_hash, betaReceipt.effect_hash);
});
