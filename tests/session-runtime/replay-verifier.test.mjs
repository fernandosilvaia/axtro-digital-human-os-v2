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
const runtime = await import(pathToFileURL(join(root, "packages/session-runtime/dist/index.js")).href);
const fixture = JSON.parse(readFileSync(join(root, "tests/fixtures/reducers/walking-sequence.json"), "utf8"));

const tenantAlpha = fixture[0].tenant_id;
const sessionAlpha = fixture[0].session_id;
const tenantBeta = id(1);

function id(offset) {
  return domain.uuidV7FromParts(
    1_704_000_000_000 + offset,
    Uint8Array.from(Array.from({ length: 10 }, (_, index) => (offset + index + 51) & 0xff)),
  );
}

function runtimeConfiguration() {
  return config.loadRuntimeConfig({
    AXTRO_ENV: "test",
    AXTRO_SERVICE_NAME: "api",
    AXTRO_PROVIDER_MODE: "fake",
    AXTRO_SECRET_BROKER_HANDLE: "secret://local/replay-verifier-tests",
    AXTRO_PORT: "3000",
    AXTRO_REQUEST_TIMEOUT_MS: "10000",
    AXTRO_DEV_AUTH_ENABLED: "true",
    AXTRO_LOG_LEVEL: "info",
  });
}

function requestFor(tenantId, actorId, token, scopes = ["session:read", "session:write"]) {
  const verifier = auth.createDevelopmentIdentityVerifier(runtimeConfiguration(), [{
    token,
    actorId,
    actorType: "workflow",
    identityKind: "service",
    tenantGrants: [{ tenantId, grantedScopes: scopes, purposes: ["essential_processing"] }],
  }]);
  return auth.resolveAuthorizedRequestContext({ authorization: `Bearer ${token}`, requestedTenantId: tenantId }, verifier);
}

const alphaRequest = requestFor(tenantAlpha, id(10), "dev_replay_alpha_0001");
const betaRequest = requestFor(tenantBeta, id(11), "dev_replay_beta_0001");
const alphaWriteOnly = requestFor(tenantAlpha, id(12), "dev_replay_write_only_0001", ["session:write"]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sequenceFor(count = 5) {
  return fixture.slice(0, count).map((event) => clone(event));
}

function versionSix({ eventId = id(100), summary = "Canonical version six." } = {}) {
  const event = clone(fixture[5]);
  return {
    ...event,
    event_id: eventId,
    aggregate_version: 6,
    payload: { ...event.payload, incremental_summary: summary },
  };
}

function repositoryWith(sequence) {
  const repository = events.createDeterministicSessionTimelineRepository();
  for (const event of sequence) repository.appendCanonicalEvent(alphaRequest, events.encodeInteractionEvent(event));
  return repository;
}

function instrument(source) {
  const afterVersions = [];
  return {
    afterVersions,
    source: {
      loadSnapshot: source.loadSnapshot.bind(source),
      async listTimeline(request, sessionId, afterVersion, control) {
        afterVersions.push(afterVersion);
        return source.listTimeline(request, sessionId, afterVersion, control);
      },
    },
  };
}

test("replay from zero equals a separately read snapshot tail by state, version and hash", async () => {
  const base = sequenceFor();
  const repository = repositoryWith(base);
  repository.materializeSnapshot(alphaRequest, sessionAlpha, {
    snapshot_id: id(200),
    created_at: "2026-07-15T04:00:00.000Z",
  });
  const tail = versionSix();
  repository.appendCanonicalEvent(alphaRequest, events.encodeInteractionEvent(tail));
  const measured = instrument(runtime.createSessionTimelineReplaySource(repository));

  const verification = await runtime.verifySessionReplay(alphaRequest, sessionAlpha, measured.source);
  const expected = domain.replayInteraction([...base, tail]);
  assert.deepEqual(measured.afterVersions, [0, 5]);
  assert.equal(verification.snapshot_version, 5);
  assert.equal(verification.tail_event_count, 1);
  assert.equal(verification.full_event_count, 6);
  assert.equal(verification.aggregate_version, 6);
  assert.equal(verification.state_hash, domain.interactionStateHash(expected));
  assert.deepEqual(verification.state, expected);
  assert.equal(Object.isFrozen(verification), true);

  const actor = await runtime.createSessionActorRegistry({ source: measured.source }).getActor(alphaRequest, sessionAlpha);
  assert.equal(domain.interactionStateHash(await actor.getState(alphaRequest)), verification.state_hash);
  assert.deepEqual(measured.afterVersions, [0, 5, 0, 5]);
});

test("snapshot absence replays from zero and a snapshot at head performs an empty real tail read", async () => {
  const base = sequenceFor();
  const withoutSnapshot = repositoryWith(base);
  const noSnapshotMeasured = instrument(runtime.createSessionTimelineReplaySource(withoutSnapshot));
  const replayed = await runtime.verifySessionReplay(alphaRequest, sessionAlpha, noSnapshotMeasured.source);
  assert.equal(replayed.snapshot_version, null);
  assert.equal(replayed.tail_event_count, 5);
  assert.deepEqual(noSnapshotMeasured.afterVersions, [0]);

  withoutSnapshot.materializeSnapshot(alphaRequest, sessionAlpha, {
    snapshot_id: id(210),
    created_at: "2026-07-15T04:10:00.000Z",
  });
  const headMeasured = instrument(runtime.createSessionTimelineReplaySource(withoutSnapshot));
  const atHead = await runtime.verifySessionReplay(alphaRequest, sessionAlpha, headMeasured.source);
  assert.equal(atHead.snapshot_version, 5);
  assert.equal(atHead.tail_event_count, 0);
  assert.deepEqual(headMeasured.afterVersions, [0, 5]);
  assert.equal(atHead.state_hash, replayed.state_hash);
});

test("snapshot hash, state, identity, version and canonical-prefix tampering fail closed", async () => {
  const base = sequenceFor();
  const repository = repositoryWith(base);
  const persisted = repository.materializeSnapshot(alphaRequest, sessionAlpha, {
    snapshot_id: id(220),
    created_at: "2026-07-15T04:20:00.000Z",
  });
  const canonical = runtime.createSessionTimelineReplaySource(repository);
  const actorSnapshot = {
    aggregate_version: persisted.aggregate_version,
    state: persisted.state,
    state_hash: persisted.state_hash,
  };

  for (const snapshot of [
    { ...actorSnapshot, state_hash: "0".repeat(64) },
    { ...actorSnapshot, aggregate_version: 6 },
    { ...actorSnapshot, state: { ...clone(actorSnapshot.state), session: { ...clone(actorSnapshot.state.session), tenant_id: tenantBeta } } },
    { ...actorSnapshot, state: { ...clone(actorSnapshot.state), session: { ...clone(actorSnapshot.state.session), session_id: id(221) } } },
  ]) {
    await assert.rejects(
      runtime.verifySessionReplay(alphaRequest, sessionAlpha, {
        loadSnapshot: async () => snapshot,
        listTimeline: canonical.listTimeline.bind(canonical),
      }),
      runtime.SessionActorReplayError,
    );
  }

  const alteredState = clone(actorSnapshot.state);
  alteredState.conversation.incremental_summary = "A self-consistent but non-canonical snapshot.";
  const alteredSnapshot = {
    aggregate_version: actorSnapshot.aggregate_version,
    state: alteredState,
    state_hash: domain.interactionStateHash(alteredState),
  };
  await assert.rejects(
    runtime.verifySessionReplay(alphaRequest, sessionAlpha, {
      loadSnapshot: async () => alteredSnapshot,
      listTimeline: canonical.listTimeline.bind(canonical),
    }),
    runtime.SessionActorReplayError,
  );
});

test("missing, duplicate and inverted versions are never sorted or reduced into a partial actor", async () => {
  const envelopes = sequenceFor().map((event) => events.encodeInteractionEvent(event));
  const histories = [
    [envelopes[0], envelopes[2]],
    [envelopes[0], envelopes[1], { ...clone(envelopes[1]), event_id: id(230) }],
    [envelopes[1], envelopes[0]],
    [envelopes[0], envelopes[0]],
  ];
  for (const history of histories) {
    const source = {
      loadSnapshot: async () => null,
      listTimeline: async () => history,
    };
    await assert.rejects(runtime.verifySessionReplay(alphaRequest, sessionAlpha, source), runtime.SessionActorReplayError);
    const registry = runtime.createSessionActorRegistry({ source });
    await assert.rejects(registry.getActor(alphaRequest, sessionAlpha), runtime.SessionActorReplayError);
    assert.equal(registry.actorCount(), 0);
  }
});

test("a divergent separately read tail is rejected by event identity and canonical fingerprint", async () => {
  const base = sequenceFor();
  const canonicalTail = versionSix({ eventId: id(240), summary: "Canonical tail." });
  const repository = repositoryWith(base);
  repository.materializeSnapshot(alphaRequest, sessionAlpha, {
    snapshot_id: id(241),
    created_at: "2026-07-15T04:30:00.000Z",
  });
  repository.appendCanonicalEvent(alphaRequest, events.encodeInteractionEvent(canonicalTail));
  const canonical = runtime.createSessionTimelineReplaySource(repository);
  const tamperedTail = events.encodeInteractionEvent(versionSix({ eventId: id(240), summary: "Tampered tail." }));
  const source = {
    loadSnapshot: canonical.loadSnapshot.bind(canonical),
    async listTimeline(request, sessionId, afterVersion, control) {
      if (afterVersion === 5) return [tamperedTail];
      return canonical.listTimeline(request, sessionId, afterVersion, control);
    },
  };
  await assert.rejects(
    runtime.verifySessionReplay(alphaRequest, sessionAlpha, source),
    runtime.SessionActorReplayError,
  );
});

test("repository adapter preserves tenant scope, read-only actor surface and aborted controls", async () => {
  const repository = repositoryWith(sequenceFor());
  const source = runtime.createSessionTimelineReplaySource(repository);
  assert.deepEqual(Object.keys(source).sort(), ["listTimeline", "loadSnapshot"]);
  await assert.rejects(
    runtime.verifySessionReplay(alphaWriteOnly, sessionAlpha, source),
    runtime.SessionActorAuthorizationError,
  );
  await assert.rejects(
    runtime.verifySessionReplay(betaRequest, sessionAlpha, source),
    runtime.SessionActorNotFoundError,
  );

  const controller = new AbortController();
  controller.abort("test");
  await assert.rejects(
    runtime.verifySessionReplay(alphaRequest, sessionAlpha, source, {
      signal: controller.signal,
      timeout_ms: 1,
    }),
    runtime.SessionActorSourceTimeoutError,
  );
});
