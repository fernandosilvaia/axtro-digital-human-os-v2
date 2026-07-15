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
const fixture = JSON.parse(readFileSync(join(root, "tests/fixtures/reducers/walking-sequence.json"), "utf8"));

const tenantAlpha = fixture[0].tenant_id;
const sessionAlpha = fixture[0].session_id;
const tenantBeta = id(1);
const sessionBeta = id(2);

function id(offset) {
  return domain.uuidV7FromParts(
    1_703_000_000_000 + offset,
    Uint8Array.from(Array.from({ length: 10 }, (_, index) => (offset + index + 31) & 0xff)),
  );
}

function runtimeConfiguration() {
  return config.loadRuntimeConfig({
    AXTRO_ENV: "test",
    AXTRO_SERVICE_NAME: "api",
    AXTRO_PROVIDER_MODE: "fake",
    AXTRO_SECRET_BROKER_HANDLE: "secret://local/session-timeline-tests",
    AXTRO_PORT: "3000",
    AXTRO_REQUEST_TIMEOUT_MS: "10000",
    AXTRO_DEV_AUTH_ENABLED: "true",
    AXTRO_LOG_LEVEL: "info",
  });
}

function requestFor(
  tenantId,
  actorId,
  token,
  scopes = ["session:read", "session:write"],
  purposes = ["essential_processing"],
) {
  const verifier = auth.createDevelopmentIdentityVerifier(runtimeConfiguration(), [{
    token,
    actorId,
    actorType: "workflow",
    identityKind: "service",
    tenantGrants: [{ tenantId, grantedScopes: scopes, purposes }],
  }]);
  return auth.resolveAuthorizedRequestContext({ authorization: `Bearer ${token}`, requestedTenantId: tenantId }, verifier);
}

const alphaRequest = requestFor(tenantAlpha, id(10), "dev_timeline_alpha_0001");
const betaRequest = requestFor(tenantBeta, id(11), "dev_timeline_beta_0001");
const alphaReadOnly = requestFor(tenantAlpha, id(12), "dev_timeline_read_only_0001", ["session:read"]);
const alphaWriteOnly = requestFor(tenantAlpha, id(13), "dev_timeline_write_only_0001", ["session:write"]);
const alphaWrongPurpose = requestFor(
  tenantAlpha,
  id(14),
  "dev_timeline_wrong_purpose_0001",
  ["session:read", "session:write"],
  ["provider_auth"],
);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sequenceFor(tenantId = tenantAlpha, sessionId = sessionAlpha, count = 5) {
  return fixture.slice(0, count).map((event, index) => ({
    ...clone(event),
    event_id: tenantId === tenantAlpha && sessionId === sessionAlpha ? event.event_id : id(100 + index),
    tenant_id: tenantId,
    session_id: sessionId,
    aggregate_id: sessionId,
  }));
}

function appendSequence(repository, request, sequence) {
  return sequence.map((event) => repository.appendCanonicalEvent(request, events.encodeInteractionEvent(event)));
}

function eventAtVersion(version, { tenantId = tenantAlpha, sessionId = sessionAlpha, eventId = id(200 + version) } = {}) {
  const event = clone(fixture[version - 1]);
  return {
    ...event,
    event_id: eventId,
    tenant_id: tenantId,
    session_id: sessionId,
    aggregate_id: sessionId,
    aggregate_version: version,
    correlation_id: id(300 + version),
    causation_id: version === 1 ? null : id(400 + version),
  };
}

test("canonical append is contiguous, tenant-scoped, immutable and idempotent by event fingerprint", () => {
  const repository = events.createDeterministicSessionTimelineRepository();
  const sequence = sequenceFor();
  const firstEnvelope = events.encodeInteractionEvent(sequence[0]);
  const first = repository.appendCanonicalEvent(alphaRequest, firstEnvelope);
  const retry = repository.appendCanonicalEvent(alphaRequest, firstEnvelope);
  assert.deepEqual(retry, first);
  assert.equal(repository.listCanonicalEvents(alphaRequest, sessionAlpha, 0).length, 1);

  appendSequence(repository, alphaRequest, sequence.slice(1));
  const tail = repository.listCanonicalEvents(alphaRequest, sessionAlpha, 3);
  assert.deepEqual(tail.map((event) => event.aggregate_version), [4, 5]);
  assert.equal(Object.isFrozen(tail), true);
  assert.equal(Object.isFrozen(tail[0]), true);
  assert.throws(() => { tail[0].event_type = "tampered"; }, TypeError);
  assert.equal(first.state_hash, domain.interactionStateHash(domain.replayInteraction([sequence[0]])));
  assert.match(first.event_fingerprint, /^[0-9a-f]{64}$/);
});

test("event identity conflicts, version reuse, gaps and inverted order fail before mutation", () => {
  const repository = events.createDeterministicSessionTimelineRepository();
  const sequence = sequenceFor();
  const first = events.encodeInteractionEvent(sequence[0]);
  repository.appendCanonicalEvent(alphaRequest, first);

  const altered = clone(first);
  altered.payload_json = domain.canonicalJson({ ...JSON.parse(altered.payload_json), language: "pt-BR" });
  assert.throws(
    () => repository.appendCanonicalEvent(alphaRequest, altered),
    events.SessionTimelineConflictError,
  );

  const reusedVersion = events.encodeInteractionEvent({ ...sequence[0], event_id: id(500) });
  assert.throws(
    () => repository.appendCanonicalEvent(alphaRequest, reusedVersion),
    events.SessionTimelineConflictError,
  );
  assert.throws(
    () => repository.appendCanonicalEvent(alphaRequest, events.encodeInteractionEvent(sequence[2])),
    events.SessionTimelineConflictError,
  );
  assert.equal(repository.listCanonicalEvents(alphaRequest, sessionAlpha, 0).length, 1);

  const inverted = events.createDeterministicSessionTimelineRepository();
  assert.throws(
    () => inverted.appendCanonicalEvent(alphaRequest, events.encodeInteractionEvent(sequence[1])),
    events.SessionTimelineConflictError,
  );
  assert.deepEqual(inverted.listCanonicalEvents(alphaRequest, sessionAlpha, 0), []);

  const otherSession = id(501);
  const sameTenantIdentity = events.encodeInteractionEvent({
    ...sequenceFor(tenantAlpha, otherSession, 1)[0],
    event_id: first.event_id,
  });
  assert.throws(
    () => repository.appendCanonicalEvent(alphaRequest, sameTenantIdentity),
    events.SessionTimelineConflictError,
  );
  assert.deepEqual(repository.listCanonicalEvents(alphaRequest, otherSession, 0), []);
});

test("snapshot materialization derives the complete restricted cache only from canonical replay", () => {
  const repository = events.createDeterministicSessionTimelineRepository();
  const sequence = sequenceFor();
  appendSequence(repository, alphaRequest, sequence);
  assert.equal(repository.loadLatestSnapshot(alphaRequest, sessionAlpha), null);

  const metadata = { snapshot_id: id(600), created_at: "2026-07-15T01:00:00.000Z" };
  const snapshot = repository.materializeSnapshot(alphaRequest, sessionAlpha, metadata);
  const expected = domain.replayInteraction(sequence);
  assert.equal(snapshot.aggregate_version, 5);
  assert.equal(snapshot.state_hash, domain.interactionStateHash(expected));
  assert.deepEqual(snapshot.state, expected);
  assert.equal(snapshot.tenant_id, tenantAlpha);
  assert.equal(snapshot.session_id, sessionAlpha);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.state), true);
  assert.deepEqual(repository.materializeSnapshot(alphaRequest, sessionAlpha, metadata), snapshot);
  assert.deepEqual(repository.loadLatestSnapshot(alphaRequest, sessionAlpha), snapshot);

  assert.throws(
    () => repository.materializeSnapshot(alphaRequest, sessionAlpha, {
      snapshot_id: id(601),
      created_at: "2026-07-15T01:00:01.000Z",
    }),
    events.SessionTimelineConflictError,
  );

  const versionSix = eventAtVersion(6);
  repository.appendCanonicalEvent(alphaRequest, events.encodeInteractionEvent(versionSix));
  const nextSnapshot = repository.materializeSnapshot(alphaRequest, sessionAlpha, {
    snapshot_id: id(602),
    created_at: "2026-07-15T01:00:02.000Z",
  });
  assert.equal(nextSnapshot.aggregate_version, 6);
  assert.equal(nextSnapshot.state_hash, domain.interactionStateHash(domain.replayInteraction([...sequence, versionSix])));
});

test("tenant and scope boundaries fail closed without creating buckets for unauthorized reads", () => {
  const repository = events.createDeterministicSessionTimelineRepository();
  const alphaFirst = events.encodeInteractionEvent(sequenceFor()[0]);
  repository.appendCanonicalEvent(alphaRequest, alphaFirst);

  assert.deepEqual(repository.listCanonicalEvents(betaRequest, sessionAlpha, 0), []);
  assert.equal(repository.loadLatestSnapshot(betaRequest, sessionAlpha), null);
  assert.throws(
    () => repository.appendCanonicalEvent(betaRequest, alphaFirst),
    events.SessionTimelineAuthorizationError,
  );
  assert.throws(
    () => repository.appendCanonicalEvent(alphaReadOnly, alphaFirst),
    events.SessionTimelineAuthorizationError,
  );
  assert.throws(
    () => repository.listCanonicalEvents(alphaWriteOnly, sessionAlpha, 0),
    events.SessionTimelineAuthorizationError,
  );
  assert.throws(
    () => repository.listCanonicalEvents(alphaWrongPurpose, sessionAlpha, 0),
    events.SessionTimelineAuthorizationError,
  );
  assert.throws(
    () => repository.appendCanonicalEvent(alphaWrongPurpose, alphaFirst),
    events.SessionTimelineAuthorizationError,
  );
  assert.throws(
    () => repository.materializeSnapshot(alphaWriteOnly, sessionAlpha, {
      snapshot_id: id(699),
      created_at: "2026-07-15T02:00:00.000Z",
    }),
    events.SessionTimelineAuthorizationError,
  );
  assert.throws(
    () => repository.materializeSnapshot(betaRequest, sessionAlpha, {
      snapshot_id: id(700),
      created_at: "2026-07-15T02:00:00.000Z",
    }),
    events.SessionTimelineConflictError,
  );
  assert.throws(
    () => repository.listCanonicalEvents({}, sessionAlpha, 0),
    events.SessionTimelineAuthorizationError,
  );

  const betaFirst = events.encodeInteractionEvent({
    ...sequenceFor(tenantBeta, sessionBeta, 1)[0],
    event_id: alphaFirst.event_id,
  });
  const betaReceipt = repository.appendCanonicalEvent(betaRequest, betaFirst);
  assert.equal(betaReceipt.event_id, firstEventId(betaFirst));
  assert.equal(repository.listCanonicalEvents(alphaRequest, sessionAlpha, 0).length, 1);
  assert.equal(repository.listCanonicalEvents(betaRequest, sessionBeta, 0).length, 1);
});

test("per-session, per-tenant and snapshot byte limits reject before changing committed history", () => {
  const bounded = events.createDeterministicSessionTimelineRepository({
    max_sessions_per_tenant: 1,
    max_events_per_session: 2,
  });
  const alpha = sequenceFor();
  const firstReceipt = bounded.appendCanonicalEvent(alphaRequest, events.encodeInteractionEvent(alpha[0]));
  bounded.appendCanonicalEvent(alphaRequest, events.encodeInteractionEvent(alpha[1]));
  assert.deepEqual(bounded.appendCanonicalEvent(alphaRequest, events.encodeInteractionEvent(alpha[0])), firstReceipt);
  assert.throws(
    () => bounded.appendCanonicalEvent(alphaRequest, events.encodeInteractionEvent(alpha[2])),
    events.SessionTimelineCapacityError,
  );
  const otherSession = id(800);
  assert.throws(
    () => bounded.appendCanonicalEvent(alphaRequest, events.encodeInteractionEvent(sequenceFor(tenantAlpha, otherSession, 1)[0])),
    events.SessionTimelineCapacityError,
  );
  assert.equal(bounded.listCanonicalEvents(alphaRequest, sessionAlpha, 0).length, 2);
  assert.deepEqual(bounded.listCanonicalEvents(alphaRequest, otherSession, 0), []);

  const snapshotBounded = events.createDeterministicSessionTimelineRepository({ max_snapshot_bytes: 1_024 });
  appendSequence(snapshotBounded, alphaRequest, alpha);
  assert.throws(
    () => snapshotBounded.materializeSnapshot(alphaRequest, sessionAlpha, {
      snapshot_id: id(801),
      created_at: "2026-07-15T03:00:00.000Z",
    }),
    events.SessionTimelineCapacityError,
  );
  assert.equal(snapshotBounded.loadLatestSnapshot(alphaRequest, sessionAlpha), null);
  assert.equal(snapshotBounded.listCanonicalEvents(alphaRequest, sessionAlpha, 0).length, 5);
});

test("malformed envelopes, metadata and read windows are rejected with sanitized errors", () => {
  const repository = events.createDeterministicSessionTimelineRepository();
  assert.throws(() => repository.appendCanonicalEvent(alphaRequest, fixture[0]), events.SessionTimelineValidationError);
  assert.throws(() => repository.listCanonicalEvents(alphaRequest, sessionAlpha, -1), events.SessionTimelineValidationError);
  assert.throws(() => repository.listCanonicalEvents(alphaRequest, sessionAlpha, 10_001), events.SessionTimelineValidationError);
  appendSequence(repository, alphaRequest, sequenceFor());
  assert.throws(
    () => repository.materializeSnapshot(alphaRequest, sessionAlpha, { snapshot_id: "invalid", created_at: "never" }),
    events.SessionTimelineValidationError,
  );
});

function firstEventId(envelope) {
  return envelope.event_id;
}
