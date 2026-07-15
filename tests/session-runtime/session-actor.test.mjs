import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import test from "node:test";

const root = fileURLToPath(new URL("../..", import.meta.url));
const auth = await import(pathToFileURL(join(root, "packages/auth/dist/index.js")).href);
const config = await import(pathToFileURL(join(root, "packages/config/dist/index.js")).href);
const domain = await import(pathToFileURL(join(root, "packages/domain/dist/index.js")).href);
const eventCodec = await import(pathToFileURL(join(root, "packages/events/dist/index.js")).href);
const runtime = await import(pathToFileURL(join(root, "packages/session-runtime/dist/index.js")).href);
const fixture = JSON.parse(readFileSync(join(root, "tests/fixtures/reducers/walking-sequence.json"), "utf8"));

const tenantAlpha = fixture[0].tenant_id;
const sessionAlpha = fixture[0].session_id;
const presenterAlpha = fixture[4].payload.presenter_id;
const tenantBeta = id(800);
const sessionBeta = id(801);

function id(offset) {
  return domain.uuidV7FromParts(
    1_702_000_000_000 + offset,
    Uint8Array.from(Array.from({ length: 10 }, (_, index) => (offset + index + 1) & 0xff)),
  );
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createManualTimeoutScheduler() {
  let nextId = 0;
  const callbacks = new Map();
  return {
    scheduler: {
      setTimeout(callback, delayMs) {
        const id = nextId += 1;
        callbacks.set(id, { callback, delayMs });
        return id;
      },
      clearTimeout(id) {
        callbacks.delete(id);
      },
    },
    fireAll() {
      const pending = [...callbacks.values()];
      callbacks.clear();
      for (const timer of pending) timer.callback();
    },
    pendingCount() {
      return callbacks.size;
    },
  };
}

function createDeferred() {
  let resolve;
  const promise = new Promise((next) => { resolve = next; });
  return { promise, resolve };
}

function runtimeConfiguration() {
  return config.loadRuntimeConfig({
    AXTRO_ENV: "test",
    AXTRO_SERVICE_NAME: "api",
    AXTRO_PROVIDER_MODE: "fake",
    AXTRO_SECRET_BROKER_HANDLE: "secret://local/session-runtime-tests",
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

const alphaRequest = requestFor(tenantAlpha, id(810), "dev_actor_runtime_alpha_0001");
const betaRequest = requestFor(tenantBeta, id(811), "dev_actor_runtime_beta_0001");

function sequenceFor(tenantId = tenantAlpha, sessionId = sessionAlpha, count = 5) {
  return fixture.slice(0, count).map((event) => ({
    ...clone(event),
    tenant_id: tenantId,
    session_id: sessionId,
    aggregate_id: sessionId,
  }));
}

function sourceWith(events) {
  const source = runtime.createDeterministicSessionActorReplaySource();
  for (const event of events) source.appendCanonicalEvent(eventCodec.encodeInteractionEvent(event));
  return source;
}

function turnEvent({
  tenantId = tenantAlpha,
  sessionId = sessionAlpha,
  eventId = id(820),
  aggregateVersion = 6,
  summary = "The canonical turn was committed by an authorized writer.",
} = {}) {
  const event = clone(fixture[5]);
  return {
    ...event,
    event_id: eventId,
    aggregate_id: sessionId,
    aggregate_version: aggregateVersion,
    tenant_id: tenantId,
    session_id: sessionId,
    occurred_at: `2026-07-14T12:01:${String(aggregateVersion).padStart(2, "0")}.000Z`,
    payload: { ...event.payload, incremental_summary: summary },
  };
}

function roleEvent({
  tenantId = tenantAlpha,
  sessionId = sessionAlpha,
  eventId = id(821),
  aggregateVersion = 7,
} = {}) {
  const event = clone(fixture[6]);
  return {
    ...event,
    event_id: eventId,
    aggregate_id: sessionId,
    aggregate_version: aggregateVersion,
    tenant_id: tenantId,
    session_id: sessionId,
    occurred_at: `2026-07-14T12:01:${String(aggregateVersion).padStart(2, "0")}.000Z`,
  };
}

function presenterEvent({
  eventId,
  presenterId,
  expectedPresenterId = presenterAlpha,
  aggregateVersion = 6,
} = {}) {
  const template = clone(fixture[5]);
  return {
    ...template,
    event_id: eventId,
    event_type: "presenter.changed",
    aggregate_version: aggregateVersion,
    data_classification: "internal",
    occurred_at: `2026-07-14T12:02:${String(aggregateVersion).padStart(2, "0")}.000Z`,
    payload: {
      expected_presenter_id: expectedPresenterId,
      presenter_id: presenterId,
    },
  };
}

test("one actor serializes concurrent canonical commands and duplicate delivery reduces exactly once", async () => {
  const source = sourceWith(sequenceFor());
  const registry = runtime.createSessionActorRegistry({
    source,
    clock: { now: () => 1_000 },
  });
  const actor = await registry.getActor(alphaRequest, sessionAlpha);
  const first = eventCodec.encodeInteractionEvent(turnEvent({ eventId: id(830) }));
  const second = eventCodec.encodeInteractionEvent(roleEvent({ eventId: id(831) }));

  const [firstResult, duplicateResult, secondResult] = await Promise.all([
    actor.applyCanonicalEvent(alphaRequest, first),
    actor.applyCanonicalEvent(alphaRequest, first),
    actor.applyCanonicalEvent(alphaRequest, second),
  ]);

  assert.deepEqual(duplicateResult, firstResult);
  assert.equal(firstResult.aggregate_version, 6);
  assert.equal(secondResult.aggregate_version, 7);
  assert.equal((await actor.getState(alphaRequest)).session.state_version, 7);
  assert.deepEqual(actor.metrics(alphaRequest), {
    mailbox_depth: 0,
    mailbox_high_watermark: 2,
    reductions_applied: 2,
    duplicate_deliveries: 1,
    rejected_deliveries: 0,
    generation_cancellations: 0,
    last_queue_wait_ms: 0,
    last_reduction_duration_ms: 0,
  });
});

test("event identity conflict, mailbox capacity, and tenant access fail closed without a hidden mutation", async () => {
  const source = sourceWith(sequenceFor());
  const registry = runtime.createSessionActorRegistry({ source, mailbox_capacity: 2 });
  const actor = await registry.getActor(alphaRequest, sessionAlpha);
  const original = eventCodec.encodeInteractionEvent(turnEvent({ eventId: id(840) }));
  const conflict = eventCodec.encodeInteractionEvent(turnEvent({
    eventId: id(840),
    summary: "A different envelope may never reuse a canonical event identity.",
  }));
  const first = actor.applyCanonicalEvent(alphaRequest, original);
  await assert.rejects(actor.applyCanonicalEvent(alphaRequest, conflict), runtime.SessionActorConflictError);
  await first;

  const constrained = runtime.createSessionActorRegistry({ source: sourceWith(sequenceFor()), mailbox_capacity: 2 });
  const constrainedActor = await constrained.getActor(alphaRequest, sessionAlpha);
  const pending = constrainedActor.applyCanonicalEvent(alphaRequest, eventCodec.encodeInteractionEvent(turnEvent({ eventId: id(841) })));
  await assert.rejects(
    constrainedActor.applyCanonicalEvent(alphaRequest, eventCodec.encodeInteractionEvent(roleEvent({ eventId: id(842) }))),
    runtime.SessionActorMailboxCapacityError,
  );
  await pending;
  assert.equal((await constrainedActor.getState(alphaRequest)).session.state_version, 6);
  await assert.rejects(actor.getState(betaRequest), runtime.SessionActorAuthorizationError);
  await assert.rejects(constrained.getActor(betaRequest, sessionAlpha), runtime.SessionActorNotFoundError);

  const limitedRegistry = runtime.createSessionActorRegistry({
    source: sourceWith([
      ...sequenceFor(tenantAlpha, sessionAlpha),
      ...sequenceFor(tenantBeta, sessionBeta),
    ]),
    max_actors: 1,
  });
  await limitedRegistry.getActor(alphaRequest, sessionAlpha);
  await assert.rejects(limitedRegistry.getActor(betaRequest, sessionBeta), runtime.SessionActorCapacityError);
  assert.equal(limitedRegistry.actorCount(), 1);
});

test("snapshot plus canonical tail rehydrates to the same hash, while altered cache and broken history fail closed", async () => {
  const source = sourceWith(sequenceFor());
  const firstRegistry = runtime.createSessionActorRegistry({ source });
  const firstActor = await firstRegistry.getActor(alphaRequest, sessionAlpha);
  const snapshot = await firstActor.snapshot(alphaRequest);
  source.storeSnapshot(snapshot);
  const tail = turnEvent({ eventId: id(850) });
  source.appendCanonicalEvent(eventCodec.encodeInteractionEvent(tail));

  const recovered = await runtime.createSessionActorRegistry({ source }).getActor(alphaRequest, sessionAlpha);
  const expected = domain.replayInteraction([...sequenceFor(), tail]);
  assert.equal(domain.interactionStateHash(await recovered.getState(alphaRequest)), domain.interactionStateHash(expected));
  assert.equal((await recovered.getState(alphaRequest)).session.state_version, 6);

  const alteredSource = sourceWith(sequenceFor());
  const alteredActor = await runtime.createSessionActorRegistry({ source: alteredSource }).getActor(alphaRequest, sessionAlpha);
  const alteredSnapshot = await alteredActor.snapshot(alphaRequest);
  alteredSource.setSnapshotForTest(tenantAlpha, sessionAlpha, { ...alteredSnapshot, state_hash: "0".repeat(64) });
  await assert.rejects(
    runtime.createSessionActorRegistry({ source: alteredSource }).getActor(alphaRequest, sessionAlpha),
    runtime.SessionActorReplayError,
  );

  const gapSource = sourceWith([sequenceFor()[0], sequenceFor()[2]]);
  await assert.rejects(
    runtime.createSessionActorRegistry({ source: gapSource }).getActor(alphaRequest, sessionAlpha),
    runtime.SessionActorReplayError,
  );

  const outOfOrderSource = sourceWith([sequenceFor()[1], sequenceFor()[0]]);
  await assert.rejects(
    runtime.createSessionActorRegistry({ source: outOfOrderSource }).getActor(alphaRequest, sessionAlpha),
    runtime.SessionActorReplayError,
  );

  const mismatchedSource = sourceWith(sequenceFor());
  const mismatchedSnapshot = runtime.createSessionActorSnapshot(
    domain.replayInteraction(sequenceFor(tenantBeta, sessionBeta)),
  );
  mismatchedSource.setSnapshotForTest(tenantAlpha, sessionAlpha, mismatchedSnapshot);
  await assert.rejects(
    runtime.createSessionActorRegistry({ source: mismatchedSource }).getActor(alphaRequest, sessionAlpha),
    runtime.SessionActorReplayError,
  );
});

test("separate session mailboxes progress independently and reject a source that crosses tenants", async () => {
  const source = sourceWith([
    ...sequenceFor(tenantAlpha, sessionAlpha),
    ...sequenceFor(tenantBeta, sessionBeta),
  ]);
  let releaseAlpha;
  const alphaBlocked = new Promise((resolve) => { releaseAlpha = resolve; });
  const independentSource = {
    loadSnapshot: source.loadSnapshot.bind(source),
    async listTimeline(request, sessionId, afterVersion) {
      if (sessionId === sessionAlpha) await alphaBlocked;
      return source.listTimeline(request, sessionId, afterVersion);
    },
  };
  const registry = runtime.createSessionActorRegistry({ source: independentSource });
  const waitingAlpha = registry.getActor(alphaRequest, sessionAlpha);
  const betaActor = await registry.getActor(betaRequest, sessionBeta);
  assert.equal((await betaActor.getState(betaRequest)).session.tenant_id, tenantBeta);
  releaseAlpha();
  assert.equal((await waitingAlpha).metrics(alphaRequest).mailbox_depth, 0);

  const crossTenantEvent = eventCodec.encodeInteractionEvent(turnEvent({
    tenantId: tenantBeta,
    sessionId: sessionBeta,
    eventId: id(860),
  }));
  const maliciousSource = {
    loadSnapshot: source.loadSnapshot.bind(source),
    async listTimeline(request, sessionId, afterVersion) {
      const events = await source.listTimeline(request, sessionId, afterVersion);
      return [...events, crossTenantEvent];
    },
  };
  await assert.rejects(
    runtime.createSessionActorRegistry({ source: maliciousSource }).getActor(alphaRequest, sessionAlpha),
    runtime.SessionActorReplayError,
  );
});

test("floor state, generation cancellation, and late-output gate preserve One Mouth without media work", async () => {
  const source = sourceWith(sequenceFor());
  const actor = await runtime.createSessionActorRegistry({ source, mailbox_capacity: 3 }).getActor(alphaRequest, sessionAlpha);
  const generation = await actor.beginGeneration(alphaRequest);
  assert.equal(actor.canPublishGeneration(alphaRequest, generation.generation_id), true);
  const cancellation = await actor.cancelGeneration(alphaRequest, {
    command_id: id(870),
    generation_id: generation.generation_id,
    reason_code: "barge_in",
  });
  assert.deepEqual(cancellation, { generation_id: generation.generation_id, status: "cancelled" });
  assert.equal(generation.signal.aborted, true);
  assert.equal(actor.canPublishGeneration(alphaRequest, generation.generation_id), false);

  const firstPresenter = id(871);
  const competingPresenter = id(872);
  const first = eventCodec.encodeInteractionEvent(presenterEvent({ eventId: id(873), presenterId: firstPresenter }));
  const competing = eventCodec.encodeInteractionEvent(presenterEvent({ eventId: id(874), presenterId: competingPresenter }));
  const outcomes = await Promise.allSettled([
    actor.applyCanonicalEvent(alphaRequest, first),
    actor.applyCanonicalEvent(alphaRequest, competing),
  ]);
  assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
  assert.equal(outcomes.filter((outcome) => outcome.status === "rejected").length, 1);
  assert.equal((await actor.getState(alphaRequest)).session.active_presenter_id, firstPresenter);
  assert.equal(actor.metrics(alphaRequest).generation_cancellations, 1);
});

test("settled cancellation records yield capacity while preserving immediate idempotency", async () => {
  const source = sourceWith(sequenceFor());
  const actor = await runtime.createSessionActorRegistry({
    source,
    max_dedupe_entries: 1,
  }).getActor(alphaRequest, sessionAlpha);
  const firstGeneration = await actor.beginGeneration(alphaRequest);
  const firstCancellation = {
    command_id: id(880),
    generation_id: firstGeneration.generation_id,
    reason_code: "safety_stop",
  };

  const firstResult = await actor.cancelGeneration(alphaRequest, firstCancellation);
  assert.deepEqual(await actor.cancelGeneration(alphaRequest, firstCancellation), firstResult);

  const secondGeneration = await actor.beginGeneration(alphaRequest);
  const secondResult = await actor.cancelGeneration(alphaRequest, {
    command_id: id(881),
    generation_id: secondGeneration.generation_id,
    reason_code: "session_terminate",
  });
  assert.deepEqual(secondResult, { generation_id: secondGeneration.generation_id, status: "cancelled" });
  assert.equal(secondGeneration.signal.aborted, true);
});

test("canonical history preserves duplicate results across a bounded hot ledger and rehydration", async () => {
  const versionSix = turnEvent({ eventId: id(890), aggregateVersion: 6 });
  const versionSeven = roleEvent({ eventId: id(891), aggregateVersion: 7 });
  const source = sourceWith(sequenceFor());
  const firstActor = await runtime.createSessionActorRegistry({
    source,
    max_dedupe_entries: 1,
  }).getActor(alphaRequest, sessionAlpha);
  source.appendCanonicalEvent(eventCodec.encodeInteractionEvent(versionSix));
  const firstResult = await firstActor.applyCanonicalEvent(alphaRequest, eventCodec.encodeInteractionEvent(versionSix));
  source.appendCanonicalEvent(eventCodec.encodeInteractionEvent(versionSeven));
  await firstActor.applyCanonicalEvent(alphaRequest, eventCodec.encodeInteractionEvent(versionSeven));
  const duplicateResult = await firstActor.applyCanonicalEvent(alphaRequest, eventCodec.encodeInteractionEvent(versionSix));
  assert.deepEqual(duplicateResult, firstResult);
  assert.equal((await firstActor.getState(alphaRequest)).session.state_version, 7);

  const rehydrated = await runtime.createSessionActorRegistry({
    source: sourceWith([...sequenceFor(), versionSix, versionSeven]),
    max_dedupe_entries: 1,
  }).getActor(alphaRequest, sessionAlpha);
  const replayedDuplicate = await rehydrated.applyCanonicalEvent(alphaRequest, eventCodec.encodeInteractionEvent(versionSix));
  assert.deepEqual(replayedDuplicate, firstResult);
  assert.equal((await rehydrated.getState(alphaRequest)).session.state_version, 7);
});

test("an evicted delivery absent from canonical evidence is rejected without a second reduction", async () => {
  const versionSix = turnEvent({ eventId: id(892), aggregateVersion: 6 });
  const versionSeven = roleEvent({ eventId: id(893), aggregateVersion: 7 });
  const actor = await runtime.createSessionActorRegistry({
    source: sourceWith(sequenceFor()),
    max_dedupe_entries: 1,
  }).getActor(alphaRequest, sessionAlpha);
  await actor.applyCanonicalEvent(alphaRequest, eventCodec.encodeInteractionEvent(versionSix));
  await actor.applyCanonicalEvent(alphaRequest, eventCodec.encodeInteractionEvent(versionSeven));
  const stateBefore = await actor.getState(alphaRequest);
  const metricsBefore = actor.metrics(alphaRequest);

  await assert.rejects(
    actor.applyCanonicalEvent(alphaRequest, eventCodec.encodeInteractionEvent(versionSix)),
    runtime.SessionActorReplayWindowError,
  );
  assert.deepEqual(await actor.getState(alphaRequest), stateBefore);
  assert.deepEqual(actor.metrics(alphaRequest), metricsBefore);
});

test("historical replay lookups coalesce one identity and reject a bounded flood before source I/O", async () => {
  const base = sourceWith(sequenceFor());
  const gate = createDeferred();
  let holdHistoricalReads = false;
  let historicalReadCount = 0;
  const source = {
    loadSnapshot: base.loadSnapshot.bind(base),
    async listTimeline(request, sessionId, afterVersion, control) {
      if (holdHistoricalReads) {
        historicalReadCount += 1;
        await gate.promise;
      }
      return base.listTimeline(request, sessionId, afterVersion, control);
    },
  };
  const actor = await runtime.createSessionActorRegistry({
    source,
    max_dedupe_entries: 1,
  }).getActor(alphaRequest, sessionAlpha);
  holdHistoricalReads = true;
  const staleOne = eventCodec.encodeInteractionEvent(turnEvent({ eventId: id(898), aggregateVersion: 5 }));
  const staleTwo = eventCodec.encodeInteractionEvent(turnEvent({ eventId: id(899), aggregateVersion: 5 }));
  const stateBefore = await actor.getState(alphaRequest);
  const metricsBefore = actor.metrics(alphaRequest);
  const first = actor.applyCanonicalEvent(alphaRequest, staleOne);
  await Promise.resolve();
  await Promise.resolve();
  const duplicate = actor.applyCanonicalEvent(alphaRequest, staleOne);
  await assert.rejects(
    actor.applyCanonicalEvent(alphaRequest, staleTwo),
    runtime.SessionActorHistoricalLookupCapacityError,
  );
  assert.equal(historicalReadCount, 1);

  gate.resolve();
  await assert.rejects(first, runtime.SessionActorReplayWindowError);
  await assert.rejects(duplicate, runtime.SessionActorReplayWindowError);
  assert.deepEqual(await actor.getState(alphaRequest), stateBefore);
  assert.deepEqual(actor.metrics(alphaRequest), metricsBefore);
});

test("a full normal mailbox still admits and prioritizes a safety cancellation", async () => {
  const actor = await runtime.createSessionActorRegistry({
    source: sourceWith(sequenceFor()),
    mailbox_capacity: 3,
  }).getActor(alphaRequest, sessionAlpha);
  const generation = await actor.beginGeneration(alphaRequest);
  const versionSix = actor.applyCanonicalEvent(alphaRequest, eventCodec.encodeInteractionEvent(presenterEvent({
    eventId: id(894),
    presenterId: id(897),
  })));
  const versionSeven = actor.applyCanonicalEvent(alphaRequest, eventCodec.encodeInteractionEvent(roleEvent({ eventId: id(895) })));
  const cancellation = actor.cancelGeneration(alphaRequest, {
    command_id: id(896),
    generation_id: generation.generation_id,
    reason_code: "barge_in",
  });

  assert.deepEqual(await cancellation, { generation_id: generation.generation_id, status: "cancelled" });
  assert.equal(generation.signal.aborted, true);
  await Promise.all([versionSix, versionSeven]);
  assert.equal((await actor.getState(alphaRequest)).session.state_version, 7);
});

test("a replay source deadline aborts I/O, rejects closed, and removes a partial actor", async () => {
  const timer = createManualTimeoutScheduler();
  const receivedSignals = [];
  const snapshot = createDeferred();
  const timeline = createDeferred();
  const source = {
    loadSnapshot(_request, _sessionId, control) {
      receivedSignals.push(control.signal);
      return snapshot.promise;
    },
    listTimeline(_request, _sessionId, _afterVersion, control) {
      receivedSignals.push(control.signal);
      return timeline.promise;
    },
  };
  const registry = runtime.createSessionActorRegistry({
    source,
    source_timeout_ms: 1,
    timeout_scheduler: timer.scheduler,
  });
  const pending = registry.getActor(alphaRequest, sessionAlpha);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(timer.pendingCount(), 1);
  timer.fireAll();

  await assert.rejects(pending, runtime.SessionActorSourceTimeoutError);
  assert.equal(registry.actorCount(), 0);
  assert.equal(receivedSignals.length, 2);
  assert.equal(receivedSignals.every((signal) => signal.aborted), true);
  snapshot.resolve(null);
  timeline.resolve([]);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(registry.actorCount(), 0);
});

test("a replay timer cleanup failure rejects closed and releases a partial actor", async () => {
  const registry = runtime.createSessionActorRegistry({
    source: sourceWith(sequenceFor()),
    timeout_scheduler: {
      setTimeout() {
        return 1;
      },
      clearTimeout() {
        throw new Error("deterministic cleanup failure");
      },
    },
  });
  await assert.rejects(registry.getActor(alphaRequest, sessionAlpha), runtime.SessionActorSourceTimeoutError);
  assert.equal(registry.actorCount(), 0);
});

test("a replay timer creation failure rejects closed before source I/O", async () => {
  let sourceCalls = 0;
  const source = {
    loadSnapshot() {
      sourceCalls += 1;
      return Promise.resolve(null);
    },
    listTimeline() {
      sourceCalls += 1;
      return Promise.resolve([]);
    },
  };
  const registry = runtime.createSessionActorRegistry({
    source,
    timeout_scheduler: {
      setTimeout() {
        throw new Error("deterministic scheduling failure");
      },
      clearTimeout() {},
    },
  });
  await assert.rejects(registry.getActor(alphaRequest, sessionAlpha), runtime.SessionActorSourceTimeoutError);
  assert.equal(sourceCalls, 0);
  assert.equal(registry.actorCount(), 0);
});
