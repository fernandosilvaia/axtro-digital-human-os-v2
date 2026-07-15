import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import test from "node:test";

const root = fileURLToPath(new URL("../..", import.meta.url));
const web = await import(pathToFileURL(join(root, "apps/web/dist/index.js")).href);
const auth = await import(pathToFileURL(join(root, "packages/auth/dist/index.js")).href);
const config = await import(pathToFileURL(join(root, "packages/config/dist/index.js")).href);
const costing = await import(pathToFileURL(join(root, "packages/costing/dist/index.js")).href);
const domain = await import(pathToFileURL(join(root, "packages/domain/dist/index.js")).href);
const events = await import(pathToFileURL(join(root, "packages/events/dist/index.js")).href);
const observability = await import(pathToFileURL(join(root, "packages/observability/dist/index.js")).href);
const sessions = await import(pathToFileURL(join(root, "packages/session-application/dist/index.js")).href);
const ui = await import(pathToFileURL(join(root, "packages/ui/dist/index.js")).href);

const tenantAlpha = id(1);
const tenantBeta = id(2);
const operator = id(3);
const workflowActor = id(4);
const presenter = id(5);
const agent = id(6);
const alphaToken = "dev_web_operator_alpha_0001";
const betaToken = "dev_web_operator_beta_0001";
const writerToken = "dev_web_writer_alpha_000001";

function id(offset) {
  return domain.uuidV7FromParts(
    1_721_200_000_000 + offset,
    Uint8Array.from(Array.from({ length: 10 }, (_, index) => (offset + index + 59) & 0xff)),
  );
}

function ids(start = 100) {
  let offset = start;
  return { nextId: () => id(offset++) };
}

function runtimeConfiguration() {
  return config.loadRuntimeConfig({
    AXTRO_ENV: "test",
    AXTRO_SERVICE_NAME: "api",
    AXTRO_PROVIDER_MODE: "fake",
    AXTRO_SECRET_BROKER_HANDLE: "secret://local/operations-console-tests",
    AXTRO_PORT: "3000",
    AXTRO_REQUEST_TIMEOUT_MS: "10000",
    AXTRO_DEV_AUTH_ENABLED: "true",
    AXTRO_LOG_LEVEL: "info",
  });
}

function requestFor({ tenantId, token, actorId = operator, actorType = "human_operator", scopes = ["session:read"], purposes = ["essential_processing"] }) {
  const verifier = auth.createDevelopmentIdentityVerifier(runtimeConfiguration(), [{
    token,
    actorId,
    actorType,
    identityKind: "service",
    tenantGrants: [{ tenantId, grantedScopes: scopes, purposes }],
  }]);
  return auth.resolveAuthorizedRequestContext({ authorization: `Bearer ${token}`, requestedTenantId: tenantId }, verifier);
}

function actionEvidence(sessionId, offset = 0) {
  const intent = {
    schema_version: "2.0.0",
    intent_id: id(300 + (offset * 3)),
    session_id: sessionId,
    tenant_id: tenantAlpha,
    actor_id: presenter,
    actor_type: "presenter",
    tool_contract_id: "catalog.lookup",
    action: "get_plan",
    arguments_json: '{"plan_id":"growth"}',
    purpose: "answer_explicit_catalog_question",
    idempotency_key: `operations-console-action-${String(offset).padStart(4, "0")}`,
    requested_at: "2026-07-15T14:00:00.000Z",
    expires_at: "2026-07-15T14:30:00.000Z",
  };
  return {
    action_intent: intent,
    policy_decision: {
      schema_version: "2.0.0",
      decision_id: id(301 + (offset * 3)),
      intent_id: intent.intent_id,
      tenant_id: tenantAlpha,
      outcome: "allow",
      reasons: ["allowlisted read-only catalog fixture"],
      obligations: [],
      policy_version: "m0-readonly-catalog@1.0.0",
      evaluated_at: "2026-07-15T14:00:00.000Z",
      expires_at: "2026-07-15T14:30:00.000Z",
    },
    tool_execution_receipt: {
      schema_version: "2.0.0",
      execution_id: id(302 + (offset * 3)),
      intent_id: intent.intent_id,
      tenant_id: tenantAlpha,
      status: "succeeded",
      provider_id: "local-tool-fake",
      attempt: 1,
      result_json: '{"plan_id":"growth","status":"available"}',
      error: null,
      effect_hash: domain.sha256Canonical({ plan_id: "growth", status: "available" }),
      started_at: "2026-07-15T14:00:01.000Z",
      completed_at: "2026-07-15T14:00:02.000Z",
    },
  };
}

async function fixture() {
  const writer = requestFor({
    tenantId: tenantAlpha,
    token: writerToken,
    actorId: workflowActor,
    actorType: "workflow",
    scopes: ["session:read", "session:write", "provider:use"],
    purposes: ["essential_processing", "provider_auth"],
  });
  const alphaRequest = requestFor({ tenantId: tenantAlpha, token: alphaToken });
  const betaRequest = requestFor({ tenantId: tenantBeta, token: betaToken });
  const outbox = events.createDeterministicTransactionalOutboxRepository();
  const lifecycle = sessions.createDeterministicSessionLifecycleApplication({
    outbox,
    registrations: [{
      tenant_id: tenantAlpha,
      agent_id: agent,
      role_pack_id: "sales-closer",
      role_pack_version: "1.0.0",
      presenter_id: presenter,
    }],
    clock: { now: () => Date.parse("2026-07-15T14:00:00.000Z") },
    idGenerator: ids(),
    store: sessions.createDeterministicSessionLifecycleStore(),
  });
  const state = await lifecycle.createSession(
    writer,
    { agent_id: agent, role_pack_id: "sales-closer", role_pack_version: "1.0.0", channel: "api", language: "pt-BR" },
    "operations-console-create-0001",
    { trace_id: "a".repeat(32), correlation_id: id(90) },
  );
  const timeline = events.createDeterministicSessionTimelineRepository();
  for (const envelope of lifecycle.listTimeline(writer, state.session_id, 0).items) {
    timeline.appendCanonicalEvent(writer, envelope);
  }

  const ledger = costing.createDeterministicCostLedger();
  const costAuthority = costing.createCostAttributionAuthority();
  const rateCard = costAuthority.issueRateCard({
    rate_card_ref: "catalog/local-console-2026-07-15",
    rate_card_as_of: "2026-07-15T00:00:00Z",
    provider_id: "local-model-fake",
    service: "catalog",
    unit_type: "request",
    unit_cost_usd: "0.02",
  });
  const providerRequest = costAuthority.issueProviderRequestReference({
    rate_card: rateCard,
    tenant_id: tenantAlpha,
    session_id: state.session_id,
  });
  ledger.record(writer, {
    cost_event_id: id(250),
    tenant_id: tenantAlpha,
    session_id: state.session_id,
    source: "estimated",
    quantity: 1,
    occurred_at: "2026-07-15T14:00:03Z",
    trace_id: "b".repeat(32),
    rate_card: rateCard,
    provider_request: providerRequest,
  });

  const actionProjection = web.createDeterministicOperationsActionEvidenceProjection([actionEvidence(state.session_id)]);
  const calls = { lifecycle: 0, timeline: 0, actions: 0, costs: 0 };
  const order = [];
  let lifecycleResolved = false;
  const sources = {
    lifecycle: {
      getSession(request, sessionId) {
        calls.lifecycle += 1;
        order.push("lifecycle");
        const result = lifecycle.getSession(request, sessionId);
        lifecycleResolved = true;
        return result;
      },
    },
    timeline: {
      listCanonicalEvents(request, sessionId, afterVersion) {
        calls.timeline += 1;
        order.push("timeline");
        assert.equal(lifecycleResolved, true);
        return timeline.listCanonicalEvents(request, sessionId, afterVersion);
      },
    },
    actions: {
      listBySession(request, sessionId) {
        calls.actions += 1;
        order.push("actions");
        assert.equal(lifecycleResolved, true);
        return actionProjection.listBySession(request, sessionId);
      },
    },
    costs: {
      aggregate(request, filter) {
        calls.costs += 1;
        order.push("costs");
        assert.equal(lifecycleResolved, true);
        return ledger.aggregate(request, filter);
      },
    },
  };
  const sink = new observability.InMemoryTelemetrySink();
  const telemetry = observability.createTelemetryRuntime({
    sink,
    clock: () => Date.parse("2026-07-15T14:01:00.000Z"),
    idGenerator: {
      createTraceId: () => "e".repeat(32),
      createSpanId: () => "f".repeat(16),
      createCorrelationId: () => id(400),
    },
    secretValues: [alphaToken, betaToken, "secondary-read-canary"],
  });
  const query = web.createOperationsConsoleReadModel(sources);
  const route = web.createOperationsConsoleRoute({ query, telemetry });
  return {
    route,
    query,
    state,
    alphaRequest,
    betaRequest,
    writer,
    lifecycle,
    timeline,
    ledger,
    calls,
    order,
    sink,
    reset() {
      calls.lifecycle = 0;
      calls.timeline = 0;
      calls.actions = 0;
      calls.costs = 0;
      order.length = 0;
      lifecycleResolved = false;
    },
  };
}

test("same-tenant deep link renders real lifecycle, canonical timeline, governed receipt and exact costs", async () => {
  const f = await fixture();
  f.reset();
  const response = await f.route.handle({
    request_context: f.alphaRequest,
    path: `/operations/sessions/${f.state.session_id}`,
  });
  assert.equal(response.status, 200);
  assert.deepEqual(f.calls, { lifecycle: 1, timeline: 1, actions: 1, costs: 1 });
  assert.deepEqual(f.order, ["lifecycle", "timeline", "actions", "costs"]);
  assert.match(response.body, /Receipt confirmado/);
  assert.match(response.body, /USD 0\.02000000/);
  assert.match(response.body, /4 eventos autorizados/);
  assert.doesNotMatch(response.body, /result_json|payload_json|arguments_json|provider_code|secondary-read-canary/);
  assert.equal(response.headers["cache-control"], "private, no-store, max-age=0");
  assert.equal(response.headers["x-content-type-options"], "nosniff");
  assert.equal(response.headers["x-frame-options"], "DENY");
  assert.equal(response.headers["x-trace-id"], "e".repeat(32));
  assert.equal(response.headers["x-correlation-id"], id(400));
  const styleHash = createHash("sha256").update(ui.OPERATIONS_CONSOLE_STYLES, "utf8").digest("base64");
  assert.match(response.headers["content-security-policy"], new RegExp(`style-src 'sha256-${styleHash.replaceAll("+", "\\+")}'`));
  assert.equal(f.sink.spans.at(-1).name, "web.request");
  assert.equal(f.sink.spans.at(-1).service_name, "web");
  assert.equal(f.sink.spans.at(-1).session_id, null);
  assert.equal(f.sink.logs.at(-1).event_code, "web.request.completed");
  assert.equal(JSON.stringify(f.sink).includes(alphaToken), false);
});

test("foreign and missing session links are indistinguishable and stop before every secondary read", async () => {
  const f = await fixture();
  f.reset();
  const foreign = await f.route.handle({
    request_context: f.betaRequest,
    path: `/operations/sessions/${f.state.session_id}`,
  });
  assert.equal(foreign.status, 404);
  assert.deepEqual(f.calls, { lifecycle: 1, timeline: 0, actions: 0, costs: 0 });
  assert.doesNotMatch(foreign.body, new RegExp(`${tenantAlpha}|${f.state.session_id}|${alphaToken}|secondary-read-canary`));
  assert.equal(f.sink.spans.at(-1).session_id, null);
  assert.equal(JSON.stringify(f.sink.spans.at(-1)).includes(f.state.session_id), false);
  assert.equal(JSON.stringify(f.sink.logs.at(-1)).includes(f.state.session_id), false);

  f.reset();
  const missing = await f.route.handle({
    request_context: f.alphaRequest,
    path: `/operations/sessions/${id(999)}`,
  });
  assert.equal(missing.status, 404);
  assert.deepEqual(f.calls, { lifecycle: 1, timeline: 0, actions: 0, costs: 0 });
  assert.equal(missing.body, foreign.body);
});

test("forged context, missing scope, wrong actor and tenant query injection fail before data access", async () => {
  const f = await fixture();
  const path = `/operations/sessions/${f.state.session_id}`;
  f.reset();
  const forged = await f.route.handle({ request_context: {}, path });
  assert.equal(forged.status, 401);
  assert.deepEqual(f.calls, { lifecycle: 0, timeline: 0, actions: 0, costs: 0 });
  assert.equal(forged.headers["x-trace-id"], undefined);

  const withoutRead = requestFor({
    tenantId: tenantAlpha,
    token: "dev_web_no_read_scope_0001",
    scopes: ["session:write"],
  });
  f.reset();
  const deniedScope = await f.route.handle({ request_context: withoutRead, path });
  assert.equal(deniedScope.status, 403);
  assert.deepEqual(f.calls, { lifecycle: 0, timeline: 0, actions: 0, costs: 0 });

  const workflow = requestFor({
    tenantId: tenantAlpha,
    token: "dev_web_wrong_actor_000001",
    actorType: "workflow",
  });
  f.reset();
  const deniedActor = await f.route.handle({ request_context: workflow, path });
  assert.equal(deniedActor.status, 403);
  assert.deepEqual(f.calls, { lifecycle: 0, timeline: 0, actions: 0, costs: 0 });

  f.reset();
  const injectedTenant = await f.route.handle({
    request_context: f.alphaRequest,
    path: `${path}?tenant_id=${tenantBeta}`,
  });
  assert.equal(injectedTenant.status, 400);
  assert.deepEqual(f.calls, { lifecycle: 0, timeline: 0, actions: 0, costs: 0 });
});

test("timeline corruption and internal errors produce sanitized unavailable pages without partial evidence", async () => {
  const f = await fixture();
  const corruptQuery = web.createOperationsConsoleReadModel({
    lifecycle: {
      getSession() { return f.state; },
    },
    timeline: { listCanonicalEvents() { throw new Error("secret@example.com secondary-read-canary"); } },
    actions: { listBySession() { throw new Error("must not run"); } },
    costs: { aggregate() { throw new Error("must not run"); } },
  });
  const telemetry = observability.createTelemetryRuntime({
    idGenerator: {
      createTraceId: () => "1".repeat(32),
      createSpanId: () => "2".repeat(16),
      createCorrelationId: () => id(401),
    },
  });
  const route = web.createOperationsConsoleRoute({ query: corruptQuery, telemetry });
  const response = await route.handle({
    request_context: f.alphaRequest,
    path: `/operations/sessions/${f.state.session_id}`,
  });
  assert.equal(response.status, 503);
  assert.match(response.body, /Dados indisponíveis/);
  assert.match(response.body, new RegExp(id(401)));
  assert.doesNotMatch(response.body, /secret@example\.com|secondary-read-canary|must not run/);
});

test("action projection rejects cross-tenant, intent and policy bindings before opening a read index", async () => {
  const f = await fixture();
  const standalone = web.createDeterministicOperationsActionEvidenceProjection([
    actionEvidence(f.state.session_id),
  ]);
  const wrongPurpose = requestFor({
    tenantId: tenantAlpha,
    token: "dev_web_action_wrong_purpose_0001",
    purposes: ["tool_auth"],
  });
  assert.throws(
    () => standalone.listBySession(wrongPurpose, f.state.session_id),
    web.OperationsConsoleAuthorizationError,
  );
  assert.equal(standalone.listBySession(f.alphaRequest, f.state.session_id).length, 1);

  const evidence = actionEvidence(f.state.session_id);
  evidence.tool_execution_receipt.tenant_id = tenantBeta;
  assert.throws(
    () => web.createDeterministicOperationsActionEvidenceProjection([evidence]),
    web.OperationsConsoleIntegrityError,
  );

  const mismatchedDecision = actionEvidence(f.state.session_id);
  mismatchedDecision.policy_decision.intent_id = id(777);
  assert.throws(
    () => web.createDeterministicOperationsActionEvidenceProjection([mismatchedDecision]),
    web.OperationsConsoleIntegrityError,
  );

  const mismatchedEffect = actionEvidence(f.state.session_id);
  mismatchedEffect.tool_execution_receipt.effect_hash = "d".repeat(64);
  assert.throws(
    () => web.createDeterministicOperationsActionEvidenceProjection([mismatchedEffect]),
    web.OperationsConsoleIntegrityError,
  );

  const deniedSuccess = actionEvidence(f.state.session_id);
  deniedSuccess.policy_decision.outcome = "deny";
  deniedSuccess.policy_decision.reasons = ["policy denied execution"];
  assert.throws(
    () => web.createDeterministicOperationsActionEvidenceProjection([deniedSuccess]),
    web.OperationsConsoleIntegrityError,
  );

  const earlyDecision = actionEvidence(f.state.session_id);
  earlyDecision.policy_decision.evaluated_at = "2026-07-15T13:59:59.000Z";
  assert.throws(
    () => web.createDeterministicOperationsActionEvidenceProjection([earlyDecision]),
    web.OperationsConsoleIntegrityError,
  );
});

test("canonical replay byte budget fails before action or cost reads", async () => {
  const f = await fixture();
  let actionCalls = 0;
  let costCalls = 0;
  const bounded = web.createOperationsConsoleReadModel({
    lifecycle: { getSession() { return f.state; } },
    timeline: {
      listCanonicalEvents() {
        return Array.from({ length: 21 }, () => ({ payload_json: "x".repeat(249_999) }));
      },
    },
    actions: { listBySession() { actionCalls += 1; return []; } },
    costs: { aggregate() { costCalls += 1; throw new Error("must not run"); } },
  });
  assert.throws(
    () => bounded.read(f.alphaRequest, f.state.session_id, 0),
    web.OperationsConsoleCapacityError,
  );
  assert.equal(actionCalls, 0);
  assert.equal(costCalls, 0);
});

test("cursor exposes at most 100 canonical rows and advances without silently truncating history", async () => {
  const f = await fixture();
  const baseEnvelopes = f.timeline.listCanonicalEvents(f.writer, f.state.session_id, 0);
  const domainEvents = baseEnvelopes.map((envelope) => events.decodeInteractionEvent(envelope));
  let causationId = domainEvents.at(-1).event_id;
  for (let version = 5; version <= 101; version += 1) {
    const event = {
      schema_version: "2.0.0",
      event_id: id(1_000 + version),
      event_type: "session.degraded",
      event_version: 1,
      aggregate_type: "interaction_session",
      aggregate_id: f.state.session_id,
      aggregate_version: version,
      tenant_id: tenantAlpha,
      session_id: f.state.session_id,
      producer: "operations-console-pagination-test",
      trace_id: "c".repeat(32),
      correlation_id: id(1_200 + version),
      causation_id: causationId,
      data_classification: "internal",
      occurred_at: new Date(Date.parse("2026-07-15T14:00:04.000Z") + version).toISOString(),
      payload: { level: version % 2 === 0 ? "minor" : "major" },
    };
    f.timeline.appendCanonicalEvent(f.writer, events.encodeInteractionEvent(event));
    domainEvents.push(event);
    causationId = event.event_id;
  }
  const replayed = domain.replayInteraction(domainEvents);
  const query = web.createOperationsConsoleReadModel({
    lifecycle: { getSession() { return replayed.session; } },
    timeline: f.timeline,
    actions: web.createDeterministicOperationsActionEvidenceProjection([]),
    costs: f.ledger,
  });
  const firstPage = query.read(f.alphaRequest, f.state.session_id, 0);
  assert.equal(firstPage.timeline.items.length, 100);
  assert.equal(firstPage.timeline.total_event_count, 101);
  assert.equal(firstPage.timeline.next_after_version, 100);
  const finalPage = query.read(f.alphaRequest, f.state.session_id, 100);
  assert.deepEqual(finalPage.timeline.items.map((item) => item.aggregate_version), [101]);
  assert.equal(finalPage.timeline.next_after_version, null);
});

test("action and cost projections reject a 101st row instead of silently truncating evidence", async () => {
  const f = await fixture();
  assert.throws(
    () => web.createDeterministicOperationsActionEvidenceProjection(
      Array.from({ length: 101 }, (_, index) => actionEvidence(f.state.session_id, index)),
    ),
    web.OperationsConsoleCapacityError,
  );

  const boundedCosts = web.createOperationsConsoleReadModel({
    lifecycle: { getSession() { return f.state; } },
    timeline: f.timeline,
    actions: web.createDeterministicOperationsActionEvidenceProjection([]),
    costs: {
      aggregate() {
        return {
          tenant_id: tenantAlpha,
          session_id: f.state.session_id,
          reconciliations: [],
          buckets: Array.from({ length: 101 }, () => ({
            source: "estimated",
            provider_id: "local-model-fake",
            service: "catalog",
            unit_type: "request",
            event_count: 1,
            quantity_decimal: "1",
            amount_usd_decimal: "0.02",
          })),
        };
      },
    },
  });
  assert.throws(
    () => boundedCosts.read(f.alphaRequest, f.state.session_id, 0),
    web.OperationsConsoleCapacityError,
  );
});

test("action projection rejects a cumulative input byte flood before retaining its read index", async () => {
  const f = await fixture();
  const bulky = Array.from({ length: 30 }, (_, index) => {
    const evidence = actionEvidence(f.state.session_id, index);
    const result = { padding: "x".repeat(190_000), sequence: index };
    evidence.tool_execution_receipt.result_json = domain.canonicalJson(result);
    evidence.tool_execution_receipt.effect_hash = domain.sha256Canonical(result);
    return evidence;
  });
  assert.throws(
    () => web.createDeterministicOperationsActionEvidenceProjection(bulky),
    web.OperationsConsoleCapacityError,
  );
});
