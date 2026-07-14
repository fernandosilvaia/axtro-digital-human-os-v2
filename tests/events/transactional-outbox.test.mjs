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

function authorizedRequest(tenantId, actorId, token, scopes = ["session:read", "session:write"]) {
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

test("acknowledgement loss retries delivery without duplicating the deterministic consumer effect", async () => {
  const repository = events.createDeterministicTransactionalOutboxRepository({ faultPoints: ["before_publish_ack"] });
  const request = authorizedRequest(tenantAlpha, actorAlpha, "dev_outbox_relay_0001");
  const consumer = events.createDeterministicIdempotentConsumer("timeline-consumer");
  const event = eventFor({ tenantId: tenantAlpha, aggregateId: aggregateAlpha, eventId: alphaEventOne, aggregateVersion: 1 });
  await repository.commitInteractionEvent(request, event);

  const uncertain = await repository.relayOnce(request, consumer);
  assert.deepEqual(uncertain, {
    outcome: "retry_scheduled",
    event_id: alphaEventOne,
    aggregate_id: aggregateAlpha,
    aggregate_version: 1,
    attempts: 1,
  });
  assert.deepEqual(repository.readConsumerEffect(request, consumer, alphaEventOne), {
    event_id: alphaEventOne,
    effect_count: 1,
    delivery_count: 1,
  });
  assert.equal(repository.listOutbox(request)[0].status, "failed");

  const retry = await repository.relayOnce(request, consumer);
  assert.equal(retry.outcome, "published");
  assert.equal(retry.attempts, 2);
  assert.deepEqual(repository.readConsumerEffect(request, consumer, alphaEventOne), {
    event_id: alphaEventOne,
    effect_count: 1,
    delivery_count: 2,
  });
  assert.equal(repository.listOutbox(request)[0].status, "published");
});

test("relay blocks N+1 while N failed and keeps a different aggregate independently eligible", async () => {
  const repository = events.createDeterministicTransactionalOutboxRepository({ faultPoints: ["before_publish_ack"] });
  const request = authorizedRequest(tenantAlpha, actorAlpha, "dev_outbox_ordering_0001");
  const consumer = events.createDeterministicIdempotentConsumer("ordering-consumer");
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

  assert.equal((await repository.relayOnce(request, consumer)).event_id, eventAOne);
  assert.equal(repository.isRelayEligible(request, eventATwo), false);
  assert.equal(repository.isRelayEligible(request, eventBOne), true);
  assert.equal(repository.readConsumerEffect(request, consumer, eventATwo), null);
  assert.equal(repository.readConsumerEffect(request, consumer, eventBOne), null);

  assert.equal((await repository.relayOnce(request, consumer)).event_id, eventAOne);
  assert.equal((await repository.relayOnce(request, consumer)).event_id, eventATwo);
  assert.equal((await repository.relayOnce(request, consumer)).event_id, eventBOne);
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
  const consumer = events.createDeterministicIdempotentConsumer("tenant-consumer");

  await repository.commitInteractionEvent(alpha, alphaEvent);
  assert.deepEqual(repository.listOutbox(beta), []);
  assert.equal(repository.readInteractionAggregate(beta, aggregateAlpha), null);
  await assert.rejects(repository.commitInteractionEvent(beta, alphaEvent), domain.TenantBoundaryError);
  await assert.rejects(repository.commitInteractionEvent(alphaReadOnly, alphaEvent), events.TransactionalOutboxAuthorizationError);
  assert.throws(() => repository.listOutbox({}), auth.TenantAuthorizationError);

  await repository.commitInteractionEvent(beta, betaEvent);
  await repository.relayOnce(alpha, consumer);
  await repository.relayOnce(beta, consumer);
  assert.deepEqual(repository.readConsumerEffect(alpha, consumer, alphaEventOne), {
    event_id: alphaEventOne,
    effect_count: 1,
    delivery_count: 1,
  });
  assert.deepEqual(repository.readConsumerEffect(beta, consumer, alphaEventOne), {
    event_id: alphaEventOne,
    effect_count: 1,
    delivery_count: 1,
  });
});
