import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import test from "node:test";

const root = fileURLToPath(new URL("../..", import.meta.url));
const api = await import(pathToFileURL(join(root, "apps/api/dist/index.js")).href);
const auth = await import(pathToFileURL(join(root, "packages/auth/dist/index.js")).href);
const config = await import(pathToFileURL(join(root, "packages/config/dist/index.js")).href);
const domain = await import(pathToFileURL(join(root, "packages/domain/dist/index.js")).href);
const events = await import(pathToFileURL(join(root, "packages/events/dist/index.js")).href);
const observability = await import(pathToFileURL(join(root, "packages/observability/dist/index.js")).href);
const sessions = await import(pathToFileURL(join(root, "packages/session-application/dist/index.js")).href);

const tenantAlpha = id(1);
const tenantBeta = id(2);
const actor = id(3);
const agentAlpha = id(10);
const presenterAlpha = id(11);
const token = "dev_lifecycle_api_token_0001";
const readOnlyToken = "dev_lifecycle_api_readonly_0001";
const writeOnlyToken = "dev_lifecycle_api_writeonly_0001";

function id(offset) {
  return domain.uuidV7FromParts(
    1_701_100_000_000 + offset,
    Uint8Array.from(Array.from({ length: 10 }, (_, index) => (offset + index + 7) & 0xff)),
  );
}

function ids(start = 100) {
  let offset = start;
  return { nextId: () => id(offset++) };
}

class ManualRuntime {
  nowValue = 1_701_100_000_000;
  nextTimerId = 1;
  timers = new Map();

  now = () => this.nowValue;

  setTimeout = (callback, delayMs) => {
    const timerId = this.nextTimerId;
    this.nextTimerId += 1;
    this.timers.set(timerId, { callback, dueAt: this.nowValue + delayMs });
    return timerId;
  };

  clearTimeout = (timerId) => {
    this.timers.delete(timerId);
  };

  advance(milliseconds) {
    this.nowValue += milliseconds;
    const due = [...this.timers.entries()]
      .filter(([, timer]) => timer.dueAt <= this.nowValue)
      .sort(([left], [right]) => left - right);
    for (const [timerId, timer] of due) {
      this.timers.delete(timerId);
      timer.callback();
    }
  }
}

function runtimeConfiguration(timeoutMs = "10000") {
  return config.loadRuntimeConfig({
    AXTRO_ENV: "test",
    AXTRO_SERVICE_NAME: "api",
    AXTRO_PROVIDER_MODE: "fake",
    AXTRO_SECRET_BROKER_HANDLE: "secret://local/session-lifecycle-api-tests",
    AXTRO_PORT: "3000",
    AXTRO_REQUEST_TIMEOUT_MS: timeoutMs,
    AXTRO_DEV_AUTH_ENABLED: "true",
    AXTRO_LOG_LEVEL: "info",
  });
}

function fixture({ runtime, timeoutMs = "10000", disclosureDelivery, idempotencyCapacity } = {}) {
  const runtimeConfig = runtimeConfiguration(timeoutMs);
  const transactionRunner = { async withinTransaction(work) { return work({ async execute() {} }); } };
  const security = api.createDevelopmentApiSecurityPipeline({
    config: runtimeConfig,
    registrations: [
      {
        token,
        actorId: actor,
        actorType: "workflow",
        identityKind: "service",
        tenantGrants: [
          { tenantId: tenantAlpha, grantedScopes: ["session:read", "session:write"], purposes: ["essential_processing"] },
          { tenantId: tenantBeta, grantedScopes: ["session:read", "session:write"], purposes: ["essential_processing"] },
        ],
      },
      {
        token: readOnlyToken,
        actorId: actor,
        actorType: "workflow",
        identityKind: "service",
        tenantGrants: [
          { tenantId: tenantAlpha, grantedScopes: ["session:read"], purposes: ["essential_processing"] },
        ],
      },
      {
        token: writeOnlyToken,
        actorId: actor,
        actorType: "workflow",
        identityKind: "service",
        tenantGrants: [
          { tenantId: tenantAlpha, grantedScopes: ["session:write"], purposes: ["essential_processing"] },
        ],
      },
    ],
    transactionRunner,
    ...(runtime === undefined ? {} : { clock: { now: runtime.now }, timer: { setTimeout: runtime.setTimeout, clearTimeout: runtime.clearTimeout } }),
  });
  const telemetry = observability.createTelemetryRuntime({
    clock: () => 1_701_100_000_000,
    idGenerator: {
      createTraceId: () => "b".repeat(32),
      createSpanId: () => "c".repeat(16),
      createCorrelationId: () => id(40),
    },
  });
  const outbox = events.createDeterministicTransactionalOutboxRepository();
  const application = sessions.createDeterministicSessionLifecycleApplication({
    outbox,
    registrations: [{
      tenant_id: tenantAlpha,
      agent_id: agentAlpha,
      role_pack_id: "sales-closer",
      role_pack_version: "1.0.0",
      presenter_id: presenterAlpha,
    }],
    idGenerator: ids(),
    clock: { now: () => 1_701_100_000_000 },
    store: sessions.createDeterministicSessionLifecycleStore(),
    ...(disclosureDelivery === undefined ? {} : { disclosure_delivery: disclosureDelivery }),
    ...(idempotencyCapacity === undefined ? {} : { idempotency_capacity_per_tenant: idempotencyCapacity }),
  });
  return Object.freeze({ lifecycle: api.createSessionLifecycleApi({ security, telemetry, application }), application, outbox });
}

function headers(tenantId = tenantAlpha, idempotencyKey, suppliedToken = token) {
  return {
    authorization: `Bearer ${suppliedToken}`,
    "x-tenant-id": tenantId,
    ...(idempotencyKey === undefined ? {} : { "idempotency-key": idempotencyKey }),
  };
}

function inbound(headerValues, body) {
  return { headers: headerValues, body: body === undefined ? new Uint8Array() : new TextEncoder().encode(JSON.stringify(body)) };
}

function createBody() {
  return {
    agent_id: agentAlpha,
    role_pack_id: "sales-closer",
    role_pack_version: "1.0.0",
    channel: "api",
    language: "en-US",
  };
}

function authorizedRequest(tenantId = tenantAlpha) {
  const verifier = auth.createDevelopmentIdentityVerifier(runtimeConfiguration(), [{
    token,
    actorId: actor,
    actorType: "workflow",
    identityKind: "service",
    tenantGrants: [{ tenantId, grantedScopes: ["session:read", "session:write"], purposes: ["essential_processing"] }],
  }]);
  return auth.resolveAuthorizedRequestContext({ authorization: `Bearer ${token}`, requestedTenantId: tenantId }, verifier);
}

test("OpenAPI session operations are implemented by the framework-neutral lifecycle adapter", () => {
  const specification = readFileSync(join(root, "contracts/openapi/axtro-api.yaml"), "utf8");
  for (const operationId of ["createSession", "getSession", "activateSession", "completeSession", "listSessionTimeline"]) {
    assert.match(specification, new RegExp(`operationId: ${operationId}`));
  }
  for (const path of ["/sessions:", "/sessions/{session_id}:", "/sessions/{session_id}/activate:", "/sessions/{session_id}/complete:", "/sessions/{session_id}/timeline:"]) {
    assert.match(specification, new RegExp(path.replaceAll("/", "\\/")));
  }
  assert.match(specification, /X-Trace-Id:/);
});

test("API lifecycle operations honor OpenAPI shapes, correlation headers, CAS, and ordered timeline pagination", async () => {
  const { lifecycle } = fixture();
  const created = await lifecycle.createSession({
    inbound: inbound(headers(tenantAlpha, "create-api-000001"), createBody()),
  });
  assert.equal(created.status, 201);
  assert.equal(created.headers["x-trace-id"], "b".repeat(32));
  assert.equal(created.body.status, "ready");
  assert.equal(created.body.state_version, 4);
  const sessionId = created.body.session_id;

  const fetched = await lifecycle.getSession({ inbound: inbound(headers()), session_id: sessionId });
  assert.equal(fetched.status, 200);
  assert.deepEqual(fetched.body, created.body);

  const activated = await lifecycle.activateSession({
    inbound: inbound(headers(tenantAlpha, "activate-api-0001"), { presenter_id: presenterAlpha, expected_state_version: 4 }),
    session_id: sessionId,
  });
  assert.equal(activated.status, 200);
  assert.equal(activated.body.status, "active");
  assert.equal(activated.body.state_version, 5);

  const stale = await lifecycle.activateSession({
    inbound: inbound(headers(tenantAlpha, "activate-api-0002"), { presenter_id: presenterAlpha, expected_state_version: 4 }),
    session_id: sessionId,
  });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.trace_id, "b".repeat(32));

  const invalidActiveTransition = await lifecycle.activateSession({
    inbound: inbound(headers(tenantAlpha, "activate-api-0004"), { presenter_id: presenterAlpha, expected_state_version: 5 }),
    session_id: sessionId,
  });
  assert.equal(invalidActiveTransition.status, 409);

  const completed = await lifecycle.completeSession({
    inbound: inbound(headers(tenantAlpha, "complete-api-0001"), { reason: "operator completed the local demo", expected_state_version: 5 }),
    session_id: sessionId,
  });
  assert.equal(completed.status, 200);
  assert.equal(completed.body.status, "completed");
  assert.equal(completed.body.state_version, 6);

  const completionRetry = await lifecycle.completeSession({
    inbound: inbound(headers(tenantAlpha, "complete-api-0001"), { reason: "operator completed the local demo", expected_state_version: 5 }),
    session_id: sessionId,
  });
  assert.deepEqual(completionRetry.body, completed.body);
  const alteredReason = await lifecycle.completeSession({
    inbound: inbound(headers(tenantAlpha, "complete-api-0001"), { reason: "different reason never persisted", expected_state_version: 5 }),
    session_id: sessionId,
  });
  assert.equal(alteredReason.status, 409);
  assert.equal(JSON.stringify(alteredReason).includes("different reason never persisted"), false);

  const invalidCompleteTransition = await lifecycle.completeSession({
    inbound: inbound(headers(tenantAlpha, "complete-api-0003"), { reason: "already terminal", expected_state_version: 6 }),
    session_id: sessionId,
  });
  assert.equal(invalidCompleteTransition.status, 409);

  const invalidActivateTransition = await lifecycle.activateSession({
    inbound: inbound(headers(tenantAlpha, "activate-api-0003"), { presenter_id: presenterAlpha, expected_state_version: 6 }),
    session_id: sessionId,
  });
  assert.equal(invalidActivateTransition.status, 409);

  const timeline = await lifecycle.listSessionTimeline({
    inbound: inbound(headers()),
    session_id: sessionId,
    query: { after_version: 3 },
  });
  assert.equal(timeline.status, 200);
  assert.deepEqual(timeline.body.items.map((event) => event.aggregate_version), [4, 5, 6]);
  assert.equal(timeline.body.next_after_version, null);
  assert.equal(timeline.body.items.every((event) => event.tenant_id === tenantAlpha && event.session_id === sessionId), true);
});

test("API hides cross-tenant sessions and returns closed problems without request content", async () => {
  const { lifecycle } = fixture();
  const created = await lifecycle.createSession({
    inbound: inbound(headers(tenantAlpha, "create-api-000002"), createBody()),
  });
  const sessionId = created.body.session_id;
  const forbidden = await lifecycle.getSession({ inbound: inbound(headers(tenantBeta)), session_id: sessionId });
  assert.equal(forbidden.status, 404);
  assert.equal(forbidden.body.trace_id, "b".repeat(32));

  const canary = "never-echo-this-body-value";
  const malformed = await lifecycle.createSession({
    inbound: inbound(headers(tenantAlpha, "create-api-000003"), { ...createBody(), tenant_id: tenantBeta, canary }),
  });
  assert.equal(malformed.status, 422);
  assert.equal(JSON.stringify(malformed).includes(canary), false);
  assert.equal(JSON.stringify(malformed).includes(token), false);

  const readOnly = await lifecycle.completeSession({
    inbound: inbound(headers(tenantAlpha, "complete-api-0002", readOnlyToken), { reason: "not-authorized", expected_state_version: 4 }),
    session_id: sessionId,
  });
  assert.equal(readOnly.status, 403);

  const writeOnly = await lifecycle.getSession({
    inbound: inbound(headers(tenantAlpha, undefined, writeOnlyToken)),
    session_id: sessionId,
  });
  assert.equal(writeOnly.status, 403);

  const missingActivation = await lifecycle.activateSession({
    inbound: inbound(headers(tenantAlpha, "activate-missing01"), { presenter_id: presenterAlpha, expected_state_version: 4 }),
    session_id: id(900),
  });
  assert.equal(missingActivation.status, 404);
});

test("API returns server-generated, closed Problem documents before authentication and for malformed query input", async () => {
  const { lifecycle } = fixture();
  const unauthenticated = await lifecycle.createSession({
    inbound: inbound({ "x-tenant-id": tenantAlpha, authorization: "Bearer forged-token" }, createBody()),
  });
  assert.equal(unauthenticated.status, 401);
  assert.equal(unauthenticated.headers["content-type"], "application/problem+json; charset=utf-8");
  assert.match(unauthenticated.body.trace_id, /^[0-9a-f]{32}$/);
  assert.equal(JSON.stringify(unauthenticated).includes("forged-token"), false);

  const invalidIngress = await lifecycle.createSession({
    inbound: inbound({
      Authorization: `Bearer ${token}`,
      authorization: `Bearer ${token}`,
      "x-tenant-id": tenantAlpha,
    }, createBody()),
  });
  assert.equal(invalidIngress.status, 400);
  assert.equal(JSON.stringify(invalidIngress).includes(token), false);

  const created = await lifecycle.createSession({ inbound: inbound(headers(tenantAlpha, "create-query-00001"), createBody()) });
  const invalidQuery = await lifecycle.listSessionTimeline({
    inbound: inbound(headers()),
    session_id: created.body.session_id,
    query: { after_version: "not-an-integer" },
  });
  assert.equal(invalidQuery.status, 422);
  assert.equal(invalidQuery.headers["content-type"], "application/problem+json; charset=utf-8");

  const unsupportedChannel = await lifecycle.createSession({
    inbound: inbound(headers(tenantAlpha, "create-channel-0001"), { ...createBody(), channel: "telephone" }),
  });
  assert.equal(unsupportedChannel.status, 422);
});

test("request timeout fences a delayed disclosure before lifecycle state or outbox commit", async () => {
  const runtime = new ManualRuntime();
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
  const { lifecycle, outbox } = fixture({ runtime, timeoutMs: "100", disclosureDelivery: delayedDelivery });
  const pending = lifecycle.createSession({
    inbound: inbound(headers(tenantAlpha, "create-timeout-001"), createBody()),
  });
  await started;
  runtime.advance(100);
  const timedOut = await pending;
  assert.equal(timedOut.status, 408);
  assert.equal(timedOut.headers["content-type"], "application/problem+json; charset=utf-8");
  releaseDelivery();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(outbox.listOutbox(authorizedRequest()), []);
});
