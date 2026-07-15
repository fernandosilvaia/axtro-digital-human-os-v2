import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import test from "node:test";

const root = fileURLToPath(new URL("../..", import.meta.url));
const auth = await import(pathToFileURL(join(root, "packages/auth/dist/index.js")).href);
const config = await import(pathToFileURL(join(root, "packages/config/dist/index.js")).href);
const domain = await import(pathToFileURL(join(root, "packages/domain/dist/index.js")).href);
const events = await import(pathToFileURL(join(root, "packages/events/dist/index.js")).href);
const sessions = await import(pathToFileURL(join(root, "packages/session-application/dist/index.js")).href);

const tenantAlpha = id(1);
const tenantBeta = id(2);
const actorAlpha = id(3);
const actorBeta = id(4);
const agentAlpha = id(10);
const agentOther = id(11);
const agentBeta = id(12);
const presenterAlpha = id(20);
const presenterOther = id(21);
const presenterBeta = id(22);
const trace = { trace_id: "a".repeat(32), correlation_id: id(30) };

function id(offset) {
  return domain.uuidV7FromParts(
    1_701_000_000_000 + offset,
    Uint8Array.from(Array.from({ length: 10 }, (_, index) => (offset + index + 1) & 0xff)),
  );
}

function runtimeConfiguration() {
  return config.loadRuntimeConfig({
    AXTRO_ENV: "test",
    AXTRO_SERVICE_NAME: "api",
    AXTRO_PROVIDER_MODE: "fake",
    AXTRO_SECRET_BROKER_HANDLE: "secret://local/session-lifecycle-tests",
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

function ids(start = 100) {
  let offset = start;
  return { nextId: () => id(offset++) };
}

function fixture({
  essentialConsentStatus = "not_required",
  outbox = events.createDeterministicTransactionalOutboxRepository(),
  store,
  allowedChannels,
  disclosureDelivery,
  idempotencyCapacity,
} = {}) {
  const sharedStore = store ?? sessions.createDeterministicSessionLifecycleStore();
  const registrations = [
    {
      tenant_id: tenantAlpha,
      agent_id: agentAlpha,
      role_pack_id: "sales-closer",
      role_pack_version: "1.0.0",
      presenter_id: presenterAlpha,
      essential_consent_status: essentialConsentStatus,
      ...(allowedChannels === undefined ? {} : { allowed_channels: allowedChannels }),
    },
    {
      tenant_id: tenantAlpha,
      agent_id: agentOther,
      role_pack_id: "sales-closer",
      role_pack_version: "1.0.0",
      presenter_id: presenterOther,
    },
    {
      tenant_id: tenantBeta,
      agent_id: agentBeta,
      role_pack_id: "sales-closer",
      role_pack_version: "1.0.0",
      presenter_id: presenterBeta,
    },
  ];
  return {
    outbox,
    store: sharedStore,
    application: sessions.createDeterministicSessionLifecycleApplication({
      outbox,
      registrations,
      idGenerator: ids(),
      clock: { now: () => 1_701_000_000_000 },
      store: sharedStore,
      ...(disclosureDelivery === undefined ? {} : { disclosure_delivery: disclosureDelivery }),
      ...(idempotencyCapacity === undefined ? {} : { idempotency_capacity_per_tenant: idempotencyCapacity }),
    }),
    alpha: requestFor(tenantAlpha, actorAlpha, "dev_session_alpha_0001"),
    beta: requestFor(tenantBeta, actorBeta, "dev_session_beta_0001"),
  };
}

function createInput(agentId = agentAlpha, language = "en-US") {
  return {
    agent_id: agentId,
    role_pack_id: "sales-closer",
    role_pack_version: "1.0.0",
    channel: "api",
    language,
  };
}

test("lifecycle create is atomic, prepared, evidence-backed, idempotent, and produces an ordered canonical timeline", async () => {
  const { application, alpha, outbox } = fixture();
  const first = await application.createSession(alpha, createInput(), "create-alpha-0001", trace);

  assert.equal(first.status, "ready");
  assert.equal(first.state_version, 4);
  assert.equal(first.disclosure_status, "delivered");
  assert.equal(first.consent_status, "not_required");
  assert.equal(first.active_presenter_id, null);
  const disclosure = application.readDisclosureRecord(alpha, first.session_id);
  assert.ok(disclosure);
  assert.equal(disclosure.schema_version, "2.0.0");
  assert.equal(disclosure.session_id, first.session_id);
  assert.equal(disclosure.tenant_id, tenantAlpha);
  assert.equal(disclosure.disclosure_type, "ai_identity");
  assert.equal(disclosure.version, "ai-identity@1");
  assert.equal(disclosure.delivery_channel, "chat");
  assert.equal(disclosure.language, "en-US");
  assert.equal(disclosure.acknowledged, false);
  assert.equal(disclosure.acknowledged_at, null);
  const timeline = application.listTimeline(alpha, first.session_id, 0);
  assert.deepEqual(timeline.items.map((event) => [event.event_type, event.aggregate_version]), [
    ["session.created", 1],
    ["session.prepared", 2],
    ["disclosure.delivered", 3],
    ["consent.recorded", 4],
  ]);
  assert.equal(timeline.items.every((event) => event.tenant_id === tenantAlpha && event.session_id === first.session_id), true);
  assert.equal(timeline.items.every((event) => event.trace_id === trace.trace_id && event.correlation_id === trace.correlation_id), true);
  assert.equal(outbox.listOutbox(alpha).length, 4);

  const retry = await application.createSession(alpha, createInput(), "create-alpha-0001", trace);
  assert.deepEqual(retry, first);
  assert.equal(outbox.listOutbox(alpha).length, 4);
  await assert.rejects(
    application.createSession(alpha, createInput(agentAlpha, "pt-BR"), "create-alpha-0001", trace),
    sessions.SessionLifecycleConflictError,
  );
});

test("activate and complete enforce persistent disclosure, presenter membership, CAS, retry safety, and reason minimization", async () => {
  const { application, alpha, outbox } = fixture();
  const first = await application.createSession(alpha, createInput(), "create-alpha-0002", trace);

  await assert.rejects(
    application.activateSession(alpha, first.session_id, { presenter_id: presenterOther, expected_state_version: 4 }, "activate-alpha-0002", trace),
    sessions.SessionLifecycleConflictError,
  );
  assert.equal(application.listTimeline(alpha, first.session_id, 0).items.length, 4);

  const active = await application.activateSession(
    alpha,
    first.session_id,
    { presenter_id: presenterAlpha, expected_state_version: 4 },
    "activate-alpha-0003",
    trace,
  );
  assert.equal(active.status, "active");
  assert.equal(active.state_version, 5);
  assert.equal(active.active_presenter_id, presenterAlpha);
  const activationRetry = await application.activateSession(
    alpha,
    first.session_id,
    { presenter_id: presenterAlpha, expected_state_version: 4 },
    "activate-alpha-0003",
    trace,
  );
  assert.deepEqual(activationRetry, active);
  await assert.rejects(
    application.activateSession(alpha, first.session_id, { presenter_id: presenterAlpha, expected_state_version: 4 }, "activate-alpha-0004", trace),
    sessions.SessionLifecycleConflictError,
  );

  const reasonCanary = "ignore-this-secret-like-reason-and-never-store-it";
  const completed = await application.completeSession(
    alpha,
    first.session_id,
    { reason: reasonCanary, expected_state_version: 5 },
    "complete-alpha-0001",
    trace,
  );
  assert.equal(completed.status, "completed");
  assert.equal(completed.active_presenter_id, null);
  assert.equal(completed.state_version, 6);
  const completionRetry = await application.completeSession(
    alpha,
    first.session_id,
    { reason: reasonCanary, expected_state_version: 5 },
    "complete-alpha-0001",
    trace,
  );
  assert.deepEqual(completionRetry, completed);
  await assert.rejects(
    application.completeSession(
      alpha,
      first.session_id,
      { reason: "different-minimized-reason", expected_state_version: 5 },
      "complete-alpha-0001",
      trace,
    ),
    sessions.SessionLifecycleConflictError,
  );
  const serializedTimeline = JSON.stringify(application.listTimeline(alpha, first.session_id, 0));
  assert.equal(serializedTimeline.includes(reasonCanary), false);
  assert.equal(outbox.listOutbox(alpha).filter((record) => record.aggregate_id === first.session_id).length, 6);
});

test("catalog channel policy and deterministic delivery receipt fail closed before disclosure or readiness", async () => {
  const unsupported = fixture();
  await assert.rejects(
    unsupported.application.createSession(
      unsupported.alpha,
      { ...createInput(), channel: "telephone" },
      "create-channel-denied",
      trace,
    ),
    sessions.SessionLifecycleValidationError,
  );
  assert.deepEqual(unsupported.outbox.listOutbox(unsupported.alpha), []);

  const unavailable = fixture({
    disclosureDelivery: sessions.createDeterministicDisclosureDeliveryFake({ outcome: "unavailable" }),
  });
  await assert.rejects(
    unavailable.application.createSession(unavailable.alpha, createInput(), "create-delivery-down", trace),
    sessions.SessionLifecycleDisclosureDeliveryError,
  );
  assert.deepEqual(unavailable.outbox.listOutbox(unavailable.alpha), []);
});

test("idempotency receipts are tenant-scoped and bounded without evicting a prior result", async () => {
  const limited = fixture({ idempotencyCapacity: 1 });
  const first = await limited.application.createSession(limited.alpha, createInput(), "create-capacity-001", trace);
  const retry = await limited.application.createSession(limited.alpha, createInput(), "create-capacity-001", trace);
  assert.deepEqual(retry, first);
  await assert.rejects(
    limited.application.createSession(limited.alpha, createInput(agentOther), "create-capacity-002", trace),
    sessions.SessionLifecycleRateLimitError,
  );
  assert.equal(limited.outbox.listOutbox(limited.alpha).length, 4);

  const alpha = fixture();
  const betaCommand = {
    agent_id: agentBeta,
    role_pack_id: "sales-closer",
    role_pack_version: "1.0.0",
    channel: "api",
    language: "en-US",
  };
  const alphaState = await alpha.application.createSession(alpha.alpha, createInput(), "shared-key-tenant", trace);
  const betaState = await alpha.application.createSession(alpha.beta, betaCommand, "shared-key-tenant", trace);
  assert.notEqual(alphaState.session_id, betaState.session_id);
});

test("concurrent compare-and-swap commands serialize per session and create one authoritative transition", async () => {
  const concurrent = fixture();
  const created = await concurrent.application.createSession(concurrent.alpha, createInput(), "create-cas-000001", trace);
  const outcomes = await Promise.allSettled([
    concurrent.application.activateSession(
      concurrent.alpha,
      created.session_id,
      { presenter_id: presenterAlpha, expected_state_version: 4 },
      "activate-cas-0001",
      trace,
    ),
    concurrent.application.activateSession(
      concurrent.alpha,
      created.session_id,
      { presenter_id: presenterAlpha, expected_state_version: 4 },
      "activate-cas-0002",
      trace,
    ),
  ]);
  assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
  assert.equal(outcomes.filter((outcome) => outcome.status === "rejected").length, 1);
  assert.equal(concurrent.application.getSession(concurrent.alpha, created.session_id).state_version, 5);
  assert.deepEqual(concurrent.application.listTimeline(concurrent.alpha, created.session_id, 0).items.map((event) => event.aggregate_version), [1, 2, 3, 4, 5]);
});

test("a stale command control cannot mutate after it waited behind an idempotency lock", async () => {
  let releaseDelivery;
  let markStarted;
  const started = new Promise((resolve) => { markStarted = resolve; });
  const release = new Promise((resolve) => { releaseDelivery = resolve; });
  const baseDelivery = sessions.createDeterministicDisclosureDeliveryFake();
  const delayedDelivery = {
    async deliver(input, control) {
      markStarted();
      await release;
      control.assertActive();
      return baseDelivery.deliver(input, control);
    },
  };
  const locked = fixture({ disclosureDelivery: delayedDelivery });
  const first = locked.application.createSession(locked.alpha, createInput(), "create-locked-0001", trace);
  await started;
  let checks = 0;
  const expiredControl = {
    assertActive() {
      checks += 1;
      if (checks > 1) throw new Error("request-expired");
    },
  };
  const late = locked.application.createSession(locked.alpha, createInput(), "create-locked-0001", trace, expiredControl);
  await Promise.resolve();
  releaseDelivery();
  const created = await first;
  await assert.rejects(late, /request-expired/);
  assert.equal(locked.outbox.listOutbox(locked.alpha).length, 4);
  assert.equal(locked.application.getSession(locked.alpha, created.session_id).state_version, 4);
});

test("tenant boundaries, fresh evidence stores, and denied essential consent fail closed", async () => {
  const shared = fixture();
  const first = await shared.application.createSession(shared.alpha, createInput(), "create-alpha-0003", trace);
  const wrongPurpose = requestFor(
    tenantAlpha,
    id(5),
    "dev_session_wrong_purpose_0001",
    ["session:read", "session:write"],
    ["tool_auth"],
  );
  assert.throws(
    () => shared.application.getSession(wrongPurpose, first.session_id),
    sessions.SessionLifecycleAuthorizationError,
  );
  await assert.rejects(
    shared.application.createSession(wrongPurpose, createInput(agentOther), "create-wrong-purpose", trace),
    sessions.SessionLifecycleAuthorizationError,
  );
  assert.equal(shared.outbox.listOutbox(shared.alpha).length, 4);
  await assert.throws(() => shared.application.getSession(shared.beta, first.session_id), sessions.SessionLifecycleNotFoundError);
  await assert.throws(() => shared.application.listTimeline(shared.beta, first.session_id, 0), sessions.SessionLifecycleNotFoundError);
  await assert.rejects(
    shared.application.activateSession(shared.beta, first.session_id, { presenter_id: presenterAlpha, expected_state_version: 4 }, "activate-beta-0001", trace),
    sessions.SessionLifecycleNotFoundError,
  );

  const freshStoreApplication = fixture({ outbox: shared.outbox, store: sessions.createDeterministicSessionLifecycleStore() }).application;
  await assert.rejects(
    freshStoreApplication.activateSession(shared.alpha, first.session_id, { presenter_id: presenterAlpha, expected_state_version: 4 }, "activate-alpha-0005", trace),
    sessions.SessionLifecycleConflictError,
  );

  const denied = fixture({ essentialConsentStatus: "denied" });
  const deniedState = await denied.application.createSession(denied.alpha, createInput(), "create-denied-0001", trace);
  assert.equal(deniedState.consent_status, "denied");
  assert.equal(denied.application.readConsentEvidence(denied.alpha, deniedState.session_id).status, "denied");
  await assert.rejects(
    denied.application.activateSession(denied.alpha, deniedState.session_id, { presenter_id: presenterAlpha, expected_state_version: 4 }, "activate-denied-0001", trace),
    sessions.SessionLifecycleConflictError,
  );
});

test("an outbox batch failure rolls back lifecycle evidence and leaves a clean retry boundary", async () => {
  const outbox = events.createDeterministicTransactionalOutboxRepository({ faultPoints: ["after_outbox_insert"] });
  const { application, alpha } = fixture({ outbox });
  await assert.rejects(
    application.createSession(alpha, createInput(), "create-rollback-001", trace),
    events.TransactionalOutboxTransactionError,
  );
  assert.deepEqual(outbox.listOutbox(alpha), []);
  const recovered = await application.createSession(alpha, createInput(), "create-rollback-001", trace);
  assert.equal(recovered.status, "ready");
  assert.equal(outbox.listOutbox(alpha).length, 4);
});
