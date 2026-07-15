import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../..", import.meta.url));
const load = (path) => import(pathToFileURL(join(root, path)).href);

const api = await load("apps/api/dist/index.js");
const eventRelay = await load("apps/event-relay/dist/index.js");
const web = await load("apps/web/dist/index.js");
const workflowWorker = await load("apps/workflow-worker/dist/index.js");
const auth = await load("packages/auth/dist/index.js");
const config = await load("packages/config/dist/index.js");
const contextComposer = await load("packages/context-composer/dist/index.js");
const costing = await load("packages/costing/dist/index.js");
const domain = await load("packages/domain/dist/index.js");
const events = await load("packages/events/dist/index.js");
const observability = await load("packages/observability/dist/index.js");
const sessions = await load("packages/session-application/dist/index.js");
const sessionRuntime = await load("packages/session-runtime/dist/index.js");
const toolRuntime = await load("packages/tool-runtime/dist/index.js");
const turns = await load("packages/turns/dist/index.js");
const workflows = await load("packages/workflows/dist/index.js");

const NOW = Date.parse("2026-07-15T16:00:00.000Z");
const TENANT_ALPHA = id(1);
const TENANT_BETA = id(2);
const API_ACTOR_ALPHA = id(3);
const API_ACTOR_BETA = id(4);
const RELAY_ACTOR_ALPHA = id(5);
const RELAY_ACTOR_BETA = id(6);
const WORKFLOW_ACTOR_ALPHA = id(7);
const WORKFLOW_ACTOR_BETA = id(8);
const CONSOLE_ACTOR_ALPHA = id(9);
const CONSOLE_ACTOR_BETA = id(10);
const COST_ACTOR_ALPHA = id(11);
const PARTICIPANT_ALPHA = id(20);
const PRESENTER_ALPHA = id(21);
const AGENT_ALPHA = id(22);
const TRACE_ID = "a".repeat(32);
const TURN_TEXTS = Object.freeze([
  "I need a plan for a small deterministic team.",
  "Please compare the available catalog option.",
  "Confirm the next safe step without taking an external action.",
]);
const FAST_LANE_RESPONSE = "The deterministic Presenter is ready for the next verified step.";
const TOKENS = Object.freeze({
  apiAlpha: "dev_m1_e2e_api_alpha_0001",
  apiBeta: "dev_m1_e2e_api_beta_0001",
  presenterAlpha: "dev_m1_e2e_presenter_alpha_0001",
  presenterBeta: "dev_m1_e2e_presenter_beta_0001",
  relayAlpha: "dev_m1_e2e_relay_alpha_0001",
  relayBeta: "dev_m1_e2e_relay_beta_0001",
  workflowExecutorAlpha: "dev_m1_e2e_workflow_execute_alpha_0001",
  workflowObserverAlpha: "dev_m1_e2e_workflow_observe_alpha_0001",
  workflowObserverBeta: "dev_m1_e2e_workflow_observe_beta_0001",
  consoleAlpha: "dev_m1_e2e_console_alpha_0001",
  consoleBeta: "dev_m1_e2e_console_beta_0001",
  costAlpha: "dev_m1_e2e_cost_alpha_0001",
});

function id(offset) {
  return domain.uuidV7FromParts(
    1_721_300_000_000 + offset,
    Uint8Array.from(Array.from({ length: 10 }, (_, index) => (offset + index + 73) & 0xff)),
  );
}

function ids(start) {
  let offset = start;
  return Object.freeze({ nextId: () => id(offset++) });
}

function runtimeConfiguration(serviceName = "api") {
  return config.loadRuntimeConfig({
    AXTRO_ENV: "test",
    AXTRO_SERVICE_NAME: serviceName,
    AXTRO_PROVIDER_MODE: "fake",
    AXTRO_SECRET_BROKER_HANDLE: "secret://local/m1-walking-skeleton",
    AXTRO_PORT: "3000",
    AXTRO_REQUEST_TIMEOUT_MS: "10000",
    AXTRO_DEV_AUTH_ENABLED: "true",
    AXTRO_LOG_LEVEL: "info",
  });
}

function registration({ tenantId, actorId, actorType, token, scopes, purposes }) {
  return Object.freeze({
    token,
    actorId,
    actorType,
    identityKind: "service",
    tenantGrants: [Object.freeze({
      tenantId,
      grantedScopes: Object.freeze([...scopes]),
      purposes: Object.freeze([...purposes]),
    })],
  });
}

function requestFor(input) {
  const verifier = auth.createDevelopmentIdentityVerifier(runtimeConfiguration(), [registration(input)]);
  return auth.resolveAuthorizedRequestContext({
    authorization: `Bearer ${input.token}`,
    requestedTenantId: input.tenantId,
  }, verifier);
}

function createTelemetryFixture() {
  const sink = new observability.InMemoryTelemetrySink();
  let traceSequence = 0;
  let spanSequence = 0;
  let correlationSequence = 0;
  const runtime = observability.createTelemetryRuntime({
    sink,
    clock: () => NOW,
    idGenerator: {
      createTraceId: () => (++traceSequence).toString(16).padStart(32, "0"),
      createSpanId: () => (++spanSequence).toString(16).padStart(16, "0"),
      createCorrelationId: () => id(900 + (++correlationSequence)),
    },
    secretValues: Object.values(TOKENS),
  });
  return Object.freeze({ runtime, sink });
}

function inbound(headers, body) {
  return Object.freeze({
    headers,
    body: body === undefined
      ? new Uint8Array()
      : new TextEncoder().encode(JSON.stringify(body)),
  });
}

function apiHeaders(tenantId, token, idempotencyKey) {
  return Object.freeze({
    authorization: `Bearer ${token}`,
    "x-tenant-id": tenantId,
    ...(idempotencyKey === undefined ? {} : { "idempotency-key": idempotencyKey }),
  });
}

function sha256Text(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

async function rejectedWith(work, ErrorType) {
  try {
    await work();
  } catch (error) {
    assert.equal(error instanceof ErrorType, true);
    return error.name;
  }
  assert.fail(`Expected ${ErrorType.name}`);
}

function workflowIdFactory() {
  return workflows.createDeterministicWorkflowIdFactory({
    command_ids: Array.from({ length: 4 }, (_, index) => id(600 + index)),
    run_ids: Array.from({ length: 4 }, (_, index) => id(620 + index)),
    follow_up_command_ids: Array.from({ length: 4 }, (_, index) => id(640 + index)),
  });
}

function relayFor({ outbox, consumer, clock, tokenOffsets, telemetry, faultPoints = [] }) {
  return eventRelay.createEventRelay({
    outbox,
    consumer,
    clock,
    claim_token_factory: eventRelay.createDeterministicClaimTokenFactory(tokenOffsets.map(id)),
    telemetry,
    lease_duration_ms: 100,
    max_attempts: 4,
    retry_delay_ms: 100,
    fault_points: faultPoints,
  });
}

function artifactCostBuckets(aggregation) {
  return aggregation.buckets.map((bucket) => Object.freeze({
    source: bucket.source,
    service: bucket.service,
    unit_type: bucket.unit_type,
    event_count: bucket.event_count,
    quantity_decimal: bucket.quantity_decimal,
    amount_usd_decimal: bucket.amount_usd_decimal,
  }));
}

function sumUsdDecimals(values) {
  const scale = 100_000_000n;
  const total = values.reduce((sum, value) => {
    assert.match(value, /^\d+(?:\.\d{1,8})?$/);
    const [whole, fraction = ""] = value.split(".");
    return sum + (BigInt(whole) * scale) + BigInt(fraction.padEnd(8, "0"));
  }, 0n);
  const whole = total / scale;
  const fraction = (total % scale).toString().padStart(8, "0").replace(/0+$/, "");
  return fraction.length === 0 ? whole.toString() : `${whole}.${fraction}`;
}

export function canonicalArtifactJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export async function runM1WalkingSkeleton() {
  const apiTelemetry = createTelemetryFixture();
  const relayTelemetry = createTelemetryFixture();
  const workflowTelemetry = createTelemetryFixture();
  const webTelemetry = createTelemetryFixture();

  const apiRegistrations = [
    registration({
      tenantId: TENANT_ALPHA,
      actorId: API_ACTOR_ALPHA,
      actorType: "workflow",
      token: TOKENS.apiAlpha,
      scopes: ["session:read", "session:write"],
      purposes: ["essential_processing"],
    }),
    registration({
      tenantId: TENANT_BETA,
      actorId: API_ACTOR_BETA,
      actorType: "workflow",
      token: TOKENS.apiBeta,
      scopes: ["session:read", "session:write"],
      purposes: ["essential_processing"],
    }),
  ];
  const transactionRunner = Object.freeze({
    async withinTransaction(work) {
      return work(Object.freeze({ async execute() {} }));
    },
  });
  const security = api.createDevelopmentApiSecurityPipeline({
    config: runtimeConfiguration(),
    registrations: apiRegistrations,
    transactionRunner,
    clock: { now: () => NOW },
  });
  const apiRequest = requestFor({
    tenantId: TENANT_ALPHA,
    actorId: API_ACTOR_ALPHA,
    actorType: "workflow",
    token: TOKENS.apiAlpha,
    scopes: ["session:read", "session:write"],
    purposes: ["essential_processing"],
  });
  const relayRequest = requestFor({
    tenantId: TENANT_ALPHA,
    actorId: RELAY_ACTOR_ALPHA,
    actorType: "workflow",
    token: TOKENS.relayAlpha,
    scopes: ["session:read", "session:write", "event:relay", "event:observe", "workflow:dispatch"],
    purposes: ["essential_processing"],
  });
  const betaRelayRequest = requestFor({
    tenantId: TENANT_BETA,
    actorId: RELAY_ACTOR_BETA,
    actorType: "workflow",
    token: TOKENS.relayBeta,
    scopes: ["session:read", "session:write", "event:relay", "workflow:dispatch"],
    purposes: ["essential_processing"],
  });
  const workflowExecutor = requestFor({
    tenantId: TENANT_ALPHA,
    actorId: WORKFLOW_ACTOR_ALPHA,
    actorType: "workflow",
    token: TOKENS.workflowExecutorAlpha,
    scopes: ["session:read", "workflow:execute"],
    purposes: ["essential_processing"],
  });
  const workflowObserver = requestFor({
    tenantId: TENANT_ALPHA,
    actorId: WORKFLOW_ACTOR_ALPHA,
    actorType: "workflow",
    token: TOKENS.workflowObserverAlpha,
    scopes: ["session:read", "workflow:observe"],
    purposes: ["essential_processing"],
  });
  const betaWorkflowObserver = requestFor({
    tenantId: TENANT_BETA,
    actorId: WORKFLOW_ACTOR_BETA,
    actorType: "workflow",
    token: TOKENS.workflowObserverBeta,
    scopes: ["session:read", "workflow:observe"],
    purposes: ["essential_processing"],
  });
  const actionPresenter = requestFor({
    tenantId: TENANT_ALPHA,
    actorId: PRESENTER_ALPHA,
    actorType: "presenter",
    token: TOKENS.presenterAlpha,
    scopes: ["session:read", "session:write", "tool:use"],
    purposes: ["essential_processing", "tool_auth"],
  });
  const betaActionPresenter = requestFor({
    tenantId: TENANT_BETA,
    actorId: id(23),
    actorType: "presenter",
    token: TOKENS.presenterBeta,
    scopes: ["session:read", "session:write", "tool:use"],
    purposes: ["essential_processing", "tool_auth"],
  });
  const consoleOperator = requestFor({
    tenantId: TENANT_ALPHA,
    actorId: CONSOLE_ACTOR_ALPHA,
    actorType: "human_operator",
    token: TOKENS.consoleAlpha,
    scopes: ["session:read"],
    purposes: ["essential_processing"],
  });
  const betaConsoleOperator = requestFor({
    tenantId: TENANT_BETA,
    actorId: CONSOLE_ACTOR_BETA,
    actorType: "human_operator",
    token: TOKENS.consoleBeta,
    scopes: ["session:read"],
    purposes: ["essential_processing"],
  });
  const costWriter = requestFor({
    tenantId: TENANT_ALPHA,
    actorId: COST_ACTOR_ALPHA,
    actorType: "workflow",
    token: TOKENS.costAlpha,
    scopes: ["session:read", "provider:use"],
    purposes: ["essential_processing", "provider_auth"],
  });

  const outbox = events.createDeterministicTransactionalOutboxRepository();
  const lifecycleApplication = sessions.createDeterministicSessionLifecycleApplication({
    outbox,
    registrations: [{
      tenant_id: TENANT_ALPHA,
      agent_id: AGENT_ALPHA,
      role_pack_id: "sales-closer",
      role_pack_version: "0.1.0",
      presenter_id: PRESENTER_ALPHA,
    }],
    idGenerator: ids(100),
    clock: { now: () => NOW },
    store: sessions.createDeterministicSessionLifecycleStore(),
  });
  const lifecycleApi = api.createSessionLifecycleApi({
    security,
    telemetry: apiTelemetry.runtime,
    application: lifecycleApplication,
  });

  const created = await lifecycleApi.createSession({
    inbound: inbound(apiHeaders(TENANT_ALPHA, TOKENS.apiAlpha, "m1-create-session-0001"), {
      agent_id: AGENT_ALPHA,
      role_pack_id: "sales-closer",
      role_pack_version: "0.1.0",
      channel: "api",
      language: "en-US",
    }),
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.state_version, 4);
  const sessionId = created.body.session_id;
  const activated = await lifecycleApi.activateSession({
    inbound: inbound(apiHeaders(TENANT_ALPHA, TOKENS.apiAlpha, "m1-activate-session-0001"), {
      presenter_id: PRESENTER_ALPHA,
      expected_state_version: 4,
    }),
    session_id: sessionId,
  });
  assert.equal(activated.status, 200);
  assert.equal(activated.body.state_version, 5);
  assert.equal(activated.body.status, "active");

  const timeline = events.createDeterministicSessionTimelineRepository();
  const workflowClock = workflows.createManualWorkflowClock("2026-07-15T16:10:00.000Z");
  const workflowIds = workflowIdFactory();
  const workflowRepository = workflows.createDeterministicPostCallWorkflowRepository({
    evidence_source: eventRelay.createSessionTimelineWorkflowEvidenceSource(timeline),
    clock: workflowClock,
    id_factory: workflowIds,
  });
  const workflowActivities = workflows.createDeterministicPostCallActivities({ id_factory: workflowIds });
  const relayClock = eventRelay.createManualEventRelayClock("2026-07-15T16:05:00.000Z");
  const relayConsumer = eventRelay.createSessionTimelineWorkflowConsumer(timeline, workflowRepository);
  const stableRelay = relayFor({
    outbox,
    consumer: relayConsumer,
    clock: relayClock,
    tokenOffsets: Array.from({ length: 11 }, (_, index) => 800 + index),
    telemetry: relayTelemetry.runtime,
  });
  for (let index = 0; index < 5; index += 1) {
    assert.equal((await stableRelay.runOnce(relayRequest)).outcome, "published");
  }
  assert.equal(timeline.listCanonicalEvents(relayRequest, sessionId, 0).length, 5);

  const actorRegistry = sessionRuntime.createSessionActorRegistry({
    source: sessionRuntime.createSessionTimelineReplaySource(timeline),
    clock: { now: () => NOW },
  });
  const context = contextComposer.createDeterministicContextComposer({ clock: { now: () => NOW } });
  const turnDriver = turns.createTurnDriver({
    outbox,
    actors: actorRegistry,
    participants: turns.createDeterministicTurnParticipantDirectory([{
      tenant_id: TENANT_ALPHA,
      session_id: sessionId,
      participant_id: PARTICIPANT_ALPHA,
      authenticated_actor_id: API_ACTOR_ALPHA,
    }]),
    fast_lane: turns.createDeterministicFastLaneFake({
      response_text: FAST_LANE_RESPONSE,
      patch: {
        active_topic: "catalog_plan",
        open_questions: [],
        repair_state: "none",
        incremental_summary: "Three synthetic turns completed by the deterministic local Fast Lane.",
      },
    }),
    context_composer: context,
    clock: { now: () => NOW },
    id_generator: ids(300),
  });
  const turnApi = api.createTurnDriverApi({
    security,
    telemetry: apiTelemetry.runtime,
    driver: turnDriver,
  });
  const acceptedTurnCommandIds = [];
  for (const [index, text] of TURN_TEXTS.entries()) {
    const response = await turnApi.submitTurn({
      inbound: inbound(apiHeaders(
        TENANT_ALPHA,
        TOKENS.apiAlpha,
        `m1-turn-idempotency-${String(index + 1).padStart(4, "0")}`,
      ), {
        schema_version: "2.0.0",
        speaker_participant_id: PARTICIPANT_ALPHA,
        text,
        language: "en-US",
        client_turn_id: `m1-client-turn-${String(index + 1).padStart(4, "0")}`,
      }),
      session_id: sessionId,
    });
    assert.equal(response.status, 202);
    assert.equal(response.body.status, "accepted");
    acceptedTurnCommandIds.push(response.body.command_id);
  }
  const hotActor = await actorRegistry.getActor(apiRequest, sessionId);
  const activeActorState = await hotActor.getState(apiRequest);
  assert.equal(activeActorState.session.state_version, 11);
  assert.equal(activeActorState.conversation.turn_index, 6);
  assert.equal(outbox.readInteractionAggregate(apiRequest, sessionId).session.state_version, 11);

  for (let index = 0; index < 6; index += 1) {
    assert.equal((await stableRelay.runOnce(relayRequest)).outcome, "published");
  }
  assert.equal(timeline.listCanonicalEvents(relayRequest, sessionId, 0).length, 11);
  const snapshot = timeline.materializeSnapshot(relayRequest, sessionId, {
    snapshot_id: id(750),
    created_at: "2026-07-15T16:06:00.000Z",
  });
  assert.equal(snapshot.aggregate_version, 11);

  const turnEnvelopes = timeline.listCanonicalEvents(relayRequest, sessionId, 0)
    .filter((event) => event.event_type === "turn.committed");
  const turnPayloads = turnEnvelopes.map((event) => JSON.parse(event.payload_json));
  const speakerRoleSequence = turnPayloads.map((payload) => payload.speaker_role);
  const turnIndexSequence = turnPayloads.map((payload) => payload.turn_index);
  const participantSpeakerIds = turnPayloads
    .filter((payload) => payload.speaker_role === "participant")
    .map((payload) => payload.speaker_participant_id);
  const presenterSpeakerIds = turnPayloads
    .filter((payload) => payload.speaker_role === "presenter")
    .map((payload) => payload.speaker_participant_id);
  const uniquePresenterIds = [...new Set(presenterSpeakerIds)];
  assert.deepEqual(speakerRoleSequence, [
    "participant", "presenter", "participant", "presenter", "participant", "presenter",
  ]);
  assert.deepEqual(turnIndexSequence, [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(participantSpeakerIds, Array(3).fill(PARTICIPANT_ALPHA));
  assert.deepEqual(presenterSpeakerIds, Array(3).fill(PRESENTER_ALPHA));
  assert.equal(activeActorState.session.active_presenter_id, PRESENTER_ALPHA);
  const oneMouthRulePreserved = uniquePresenterIds.length === 1
    && uniquePresenterIds[0] === activeActorState.session.active_presenter_id
    && participantSpeakerIds.every((speakerId) => speakerId !== activeActorState.session.active_presenter_id);
  assert.equal(oneMouthRulePreserved, true);

  const catalogFlow = toolRuntime.createDeterministicCatalogLookupCommandFlow({
    clock: { now: () => NOW },
    sessions: [{
      tenant_id: TENANT_ALPHA,
      session_id: sessionId,
      presenter_actor_id: PRESENTER_ALPHA,
    }],
  });
  const catalogCommand = Object.freeze({
    schema_version: "2.0.0",
    question_id: id(30),
    session_id: sessionId,
    plan_id: "growth",
  });
  const eventCountBeforeAction = outbox.listOutbox(apiRequest).length;
  const catalogAnswer = await catalogFlow.submitCatalogLookup(actionPresenter, catalogCommand);
  const catalogReplay = await catalogFlow.submitCatalogLookup(actionPresenter, structuredClone(catalogCommand));
  assert.strictEqual(catalogReplay, catalogAnswer);
  assert.equal(catalogAnswer.confirmed, true);
  assert.equal(catalogFlow.readFakeCatalogInvocationCount(actionPresenter), 1);
  const actionEvidence = catalogFlow.action_evidence.listBySession(consoleOperator, sessionId);
  assert.equal(actionEvidence.length, 1);
  assert.equal(actionEvidence[0].confirmed_effect, true);
  assert.equal(outbox.listOutbox(apiRequest).length, eventCountBeforeAction);
  const actionTimelineDelta = outbox.listOutbox(apiRequest).length - eventCountBeforeAction;
  const candidateSpeechMatchCount = turnPayloads
    .filter((payload) => payload.transcript_text === catalogAnswer.response_text)
    .length;
  const actionCandidateNotSpokenAutomatically = actionTimelineDelta === 0
    && candidateSpeechMatchCount === 0;
  const governedActionChainVerified = actionEvidence[0].tool_contract_id === "catalog.lookup"
    && actionEvidence[0].policy_outcome === "allow"
    && actionEvidence[0].status === catalogAnswer.receipt.status
    && actionEvidence[0].execution_id === catalogAnswer.receipt.execution_id
    && actionEvidence[0].effect_hash === catalogAnswer.receipt.effect_hash
    && actionEvidence[0].confirmed_effect === catalogAnswer.confirmed;
  assert.equal(actionCandidateNotSpokenAutomatically, true);
  assert.equal(governedActionChainVerified, true);

  const unknownFlow = toolRuntime.createDeterministicCatalogLookupCommandFlow({
    clock: { now: () => NOW },
    sessions: [{
      tenant_id: TENANT_ALPHA,
      session_id: sessionId,
      presenter_actor_id: PRESENTER_ALPHA,
    }],
    fake_execution_mode: "timeout_once",
  });
  const unknownCommand = Object.freeze({
    schema_version: "2.0.0",
    question_id: id(31),
    session_id: sessionId,
    plan_id: "growth",
  });
  const eventCountBeforeUnknown = outbox.listOutbox(apiRequest).length;
  const unknownAnswer = await unknownFlow.submitCatalogLookup(actionPresenter, unknownCommand);
  const unknownReplay = await unknownFlow.submitCatalogLookup(actionPresenter, structuredClone(unknownCommand));
  assert.strictEqual(unknownReplay, unknownAnswer);
  assert.equal(unknownAnswer.confirmed, false);
  assert.equal(unknownAnswer.receipt.status, "unknown");
  assert.equal(unknownAnswer.receipt.effect_hash, null);
  assert.doesNotMatch(unknownAnswer.response_text, /is available/);
  assert.equal(unknownFlow.readFakeCatalogInvocationCount(actionPresenter), 1);
  const blindRetryError = await rejectedWith(
    () => unknownFlow.submitCatalogLookup(actionPresenter, {
      ...unknownCommand,
      question_id: id(32),
    }),
    toolRuntime.ActionRuntimeUnknownEffectError,
  );
  const betaReconciliationError = await rejectedWith(
    () => unknownFlow.reconcileUnknownCatalogLookup(betaActionPresenter, unknownCommand),
    toolRuntime.ActionRuntimeAuthorizationError,
  );
  const alteredReconciliationError = await rejectedWith(
    () => unknownFlow.reconcileUnknownCatalogLookup(actionPresenter, {
      ...unknownCommand,
      plan_id: "starter",
    }),
    toolRuntime.CatalogLookupCommandConflictError,
  );
  const reconciliation = await unknownFlow.reconcileUnknownCatalogLookup(actionPresenter, unknownCommand);
  assert.equal(reconciliation.status, "not_applied");
  const secondReconciliationError = await rejectedWith(
    () => unknownFlow.reconcileUnknownCatalogLookup(actionPresenter, unknownCommand),
    toolRuntime.ActionRuntimeUnknownEffectError,
  );
  const postReconciliation = await unknownFlow.submitCatalogLookup(actionPresenter, {
    ...unknownCommand,
    question_id: id(33),
  });
  assert.equal(postReconciliation.confirmed, true);
  assert.equal(postReconciliation.receipt.status, "succeeded");
  assert.equal(unknownFlow.readFakeCatalogInvocationCount(actionPresenter), 2);
  const unknownTimelineDelta = outbox.listOutbox(apiRequest).length - eventCountBeforeUnknown;
  assert.equal(unknownTimelineDelta, 0);

  const catalogInvocationsBeforeBeta = catalogFlow.readFakeCatalogInvocationCount(actionPresenter);
  const betaCatalogError = await rejectedWith(
    () => catalogFlow.submitCatalogLookup(betaActionPresenter, catalogCommand),
    toolRuntime.ActionRuntimeAuthorizationError,
  );
  assert.equal(catalogFlow.readFakeCatalogInvocationCount(actionPresenter), catalogInvocationsBeforeBeta);
  assert.deepEqual(catalogFlow.action_evidence.listBySession(betaConsoleOperator, sessionId), []);

  const costLedger = costing.createDeterministicCostLedger();
  const costAuthority = costing.createCostAttributionAuthority();
  const rateCard = costAuthority.issueRateCard({
    rate_card_ref: "catalog/local-m1-walking-skeleton",
    rate_card_as_of: "2026-07-15T00:00:00Z",
    provider_id: "local-catalog-fake",
    service: "catalog",
    unit_type: "request",
    unit_cost_usd: "0.02",
  });
  const providerRequest = costAuthority.issueProviderRequestReference({
    rate_card: rateCard,
    tenant_id: TENANT_ALPHA,
    session_id: sessionId,
  });
  costLedger.record(costWriter, {
    cost_event_id: id(700),
    tenant_id: TENANT_ALPHA,
    session_id: sessionId,
    source: "estimated",
    quantity: catalogFlow.readFakeCatalogInvocationCount(actionPresenter),
    occurred_at: "2026-07-15T16:00:01Z",
    trace_id: TRACE_ID,
    rate_card: rateCard,
    provider_request: providerRequest,
  });

  const completed = await lifecycleApi.completeSession({
    inbound: inbound(apiHeaders(TENANT_ALPHA, TOKENS.apiAlpha, "m1-complete-session-0001"), {
      reason: "deterministic M1 demo completed",
      expected_state_version: 11,
    }),
    session_id: sessionId,
  });
  assert.equal(completed.status, 200);
  assert.equal(completed.body.status, "completed");
  assert.equal(completed.body.state_version, 12);
  const completionRecord = outbox.listOutbox(apiRequest)
    .find((record) => record.aggregate_id === sessionId && record.event.event_type === "session.completed");
  assert.ok(completionRecord);
  const completionActorReceipt = await hotActor.applyCanonicalEvent(apiRequest, completionRecord.event);
  assert.equal(completionActorReceipt.aggregate_version, 12);
  const completedActorState = await hotActor.getState(apiRequest);
  assert.equal(completedActorState.session.status, "completed");

  const crashingCompletionRelay = relayFor({
    outbox,
    consumer: relayConsumer,
    clock: relayClock,
    tokenOffsets: [850],
    telemetry: relayTelemetry.runtime,
    faultPoints: ["after_effect_before_ack"],
  });
  await rejectedWith(
    () => crashingCompletionRelay.runOnce(relayRequest),
    eventRelay.EventRelayCrashError,
  );
  assert.equal(timeline.listCanonicalEvents(relayRequest, sessionId, 0).length, 12);
  const enqueueAfterEffect = workflowRepository.readEnqueueReceipt(
    workflowObserver,
    completionRecord.event_id,
  );
  assert.ok(enqueueAfterEffect);
  const publishingCompletion = outbox.listOutbox(apiRequest)
    .find((record) => record.event_id === completionRecord.event_id);
  assert.equal(publishingCompletion.status, "publishing");
  assert.equal(publishingCompletion.attempts, 1);

  const replacementRelay = relayFor({
    outbox,
    consumer: relayConsumer,
    clock: relayClock,
    tokenOffsets: [851, 852],
    telemetry: relayTelemetry.runtime,
  });
  const beforeLease = await replacementRelay.runOnce(relayRequest);
  assert.equal(beforeLease.outcome, "idle");
  relayClock.advanceBy(100);
  const recoveredCompletion = await replacementRelay.runOnce(relayRequest);
  assert.equal(recoveredCompletion.outcome, "published");
  assert.equal(recoveredCompletion.receipt.attempt, 2);
  assert.equal(timeline.listCanonicalEvents(relayRequest, sessionId, 0).length, 12);
  assert.deepEqual(
    workflowRepository.readEnqueueReceipt(workflowObserver, completionRecord.event_id),
    enqueueAfterEffect,
  );
  assert.equal(outbox.listDeadLetters(relayRequest, "session-timeline").length, 0);

  const verification = await sessionRuntime.verifySessionReplay(
    consoleOperator,
    sessionId,
    sessionRuntime.createSessionTimelineReplaySource(timeline),
  );
  assert.equal(verification.snapshot_version, 11);
  assert.equal(verification.tail_event_count, 1);
  assert.equal(verification.full_event_count, 12);
  assert.equal(verification.aggregate_version, 12);
  const finalOutboxAggregate = outbox.readInteractionAggregate(apiRequest, sessionId);
  assert.ok(finalOutboxAggregate);
  assert.equal(verification.state_hash, domain.interactionStateHash(finalOutboxAggregate));
  assert.equal(verification.state_hash, domain.interactionStateHash(completedActorState));
  assert.equal(domain.canonicalJson(verification.state.session), domain.canonicalJson(completed.body));
  const replayActorRegistry = sessionRuntime.createSessionActorRegistry({
    source: sessionRuntime.createSessionTimelineReplaySource(timeline),
  });
  const replayActor = await replayActorRegistry.getActor(consoleOperator, sessionId);
  assert.equal(domain.interactionStateHash(await replayActor.getState(consoleOperator)), verification.state_hash);
  const workflowEvidence = eventRelay.createSessionTimelineWorkflowEvidenceSource(timeline)
    .readSessionCompletionEvidence(workflowObserver, sessionId);
  assert.equal(workflowEvidence.source_state_hash, verification.state_hash);

  const worker = workflowWorker.createWorkflowWorker({
    repository: workflowRepository,
    activities: workflowActivities,
    claim_token_factory: workflowWorker.createDeterministicWorkflowClaimTokenFactory(
      Array.from({ length: 4 }, (_, index) => id(860 + index)),
    ),
    telemetry: workflowTelemetry.runtime,
    lease_duration_ms: 100,
    retry_delay_ms: 100,
    max_attempts: 4,
  });
  const workflowOutcomes = [];
  for (let index = 0; index < 4; index += 1) {
    workflowOutcomes.push(worker.runOnce(workflowExecutor, enqueueAfterEffect.workflow_run_id).outcome);
  }
  assert.deepEqual(workflowOutcomes, ["checkpointed", "checkpointed", "checkpointed", "completed"]);
  const workflowResult = workflowRepository.readResult(workflowObserver, enqueueAfterEffect.workflow_run_id);
  assert.ok(workflowResult);
  assert.equal(workflowResult.source_state_hash, verification.state_hash);
  assert.equal(workflowResult.follow_up_guard.external_effect, false);
  assert.equal(workflowResult.evaluation.outcome, "passed");
  assert.equal(workflowRepository.listStepReceipts(workflowObserver, enqueueAfterEffect.workflow_run_id).length, 4);

  const costAggregation = costLedger.aggregate(consoleOperator, { session_id: sessionId });
  assert.equal(costAggregation.buckets.length, 1);
  assert.equal(costAggregation.buckets[0].amount_usd_decimal, "0.02");

  const sourceCalls = { lifecycle: 0, timeline: 0, actions: 0, costs: 0 };
  const sources = {
    lifecycle: {
      getSession(request, requestedSessionId) {
        sourceCalls.lifecycle += 1;
        return lifecycleApplication.getSession(request, requestedSessionId);
      },
    },
    timeline: {
      listCanonicalEvents(request, requestedSessionId, afterVersion) {
        sourceCalls.timeline += 1;
        return timeline.listCanonicalEvents(request, requestedSessionId, afterVersion);
      },
    },
    actions: {
      listBySession(request, requestedSessionId) {
        sourceCalls.actions += 1;
        return catalogFlow.action_evidence.listBySession(request, requestedSessionId);
      },
    },
    costs: {
      aggregate(request, filter) {
        sourceCalls.costs += 1;
        return costLedger.aggregate(request, filter);
      },
    },
  };
  const resetSourceCalls = () => {
    sourceCalls.lifecycle = 0;
    sourceCalls.timeline = 0;
    sourceCalls.actions = 0;
    sourceCalls.costs = 0;
  };
  const consoleReadModel = web.createOperationsConsoleReadModel(sources);
  const consoleRoute = web.createOperationsConsoleRoute({
    query: consoleReadModel,
    telemetry: webTelemetry.runtime,
  });
  const consoleView = consoleReadModel.read(consoleOperator, sessionId);
  assert.equal(consoleView.session.state_hash, verification.state_hash);
  assert.equal(consoleView.timeline.total_event_count, 12);
  assert.equal(consoleView.action_receipts.length, 1);
  assert.equal(consoleView.action_receipts[0].execution_id, catalogAnswer.receipt.execution_id);
  const consoleResponse = await consoleRoute.handle({
    request_context: consoleOperator,
    path: `/operations/sessions/${sessionId}`,
  });
  assert.equal(consoleResponse.status, 200);
  assert.match(consoleResponse.body, /Receipt confirmado/);
  assert.match(consoleResponse.body, /USD 0\.02000000/);
  assert.match(consoleResponse.body, /12 eventos autorizados/);
  for (const prohibited of ["payload_json", "transcript_text", "arguments_json", "result_json", "provider_code"]) {
    assert.equal(consoleResponse.body.includes(prohibited), false);
  }

  resetSourceCalls();
  const foreignConsole = await consoleRoute.handle({
    request_context: betaConsoleOperator,
    path: `/operations/sessions/${sessionId}`,
  });
  const foreignCalls = structuredClone(sourceCalls);
  resetSourceCalls();
  const missingConsole = await consoleRoute.handle({
    request_context: consoleOperator,
    path: `/operations/sessions/${id(999)}`,
  });
  const missingCalls = structuredClone(sourceCalls);
  assert.equal(foreignConsole.status, 404);
  assert.equal(missingConsole.status, 404);
  assert.equal(foreignConsole.body, missingConsole.body);
  assert.deepEqual(foreignCalls, { lifecycle: 1, timeline: 0, actions: 0, costs: 0 });
  assert.deepEqual(missingCalls, { lifecycle: 1, timeline: 0, actions: 0, costs: 0 });

  const foreignApi = await lifecycleApi.getSession({
    inbound: inbound(apiHeaders(TENANT_BETA, TOKENS.apiBeta)),
    session_id: sessionId,
  });
  const missingApi = await lifecycleApi.getSession({
    inbound: inbound(apiHeaders(TENANT_ALPHA, TOKENS.apiAlpha)),
    session_id: id(998),
  });
  assert.equal(foreignApi.status, 404);
  assert.equal(missingApi.status, 404);
  assert.equal(foreignApi.body.detail, missingApi.body.detail);

  const betaRelay = relayFor({
    outbox,
    consumer: relayConsumer,
    clock: relayClock,
    tokenOffsets: [880],
    telemetry: relayTelemetry.runtime,
  });
  const alphaOutboxBeforeBetaRelay = outbox.listOutbox(apiRequest).map((record) => [record.event_id, record.status, record.attempts]);
  assert.deepEqual(await betaRelay.runOnce(betaRelayRequest), { outcome: "idle", receipt: null });
  assert.deepEqual(
    outbox.listOutbox(apiRequest).map((record) => [record.event_id, record.status, record.attempts]),
    alphaOutboxBeforeBetaRelay,
  );
  assert.equal(timeline.listCanonicalEvents(betaRelayRequest, sessionId, 0).length, 0);
  const betaWorkflowError = await rejectedWith(
    () => Promise.resolve().then(() => workflowRepository.readResult(
      betaWorkflowObserver,
      enqueueAfterEffect.workflow_run_id,
    )),
    workflows.WorkflowNotFoundError,
  );

  const canonicalTimeline = timeline.listCanonicalEvents(relayRequest, sessionId, 0);
  assert.equal(canonicalTimeline.length, 12);
  const expectedEventTypes = [
    "session.created",
    "session.prepared",
    "disclosure.delivered",
    "consent.recorded",
    "session.activated",
    "turn.committed",
    "turn.committed",
    "turn.committed",
    "turn.committed",
    "turn.committed",
    "turn.committed",
    "session.completed",
  ];
  assert.deepEqual(canonicalTimeline.map((event) => event.event_type), expectedEventTypes);
  assert.deepEqual(canonicalTimeline.map((event) => event.aggregate_version), Array.from({ length: 12 }, (_, index) => index + 1));

  const telemetryText = JSON.stringify([
    apiTelemetry.sink,
    relayTelemetry.sink,
    workflowTelemetry.sink,
    webTelemetry.sink,
  ]);
  const prohibitedTelemetryValues = [
    ...Object.values(TOKENS),
    ...TURN_TEXTS,
    FAST_LANE_RESPONSE,
    "secret://local/m1-walking-skeleton",
    "claim_token",
    "payload_json",
  ];
  const telemetrySensitiveDataFound = prohibitedTelemetryValues
    .some((prohibited) => telemetryText.includes(prohibited));
  assert.equal(telemetrySensitiveDataFound, false);
  assert.equal(webTelemetry.sink.spans.every((span) => span.session_id === null), true);

  const timelineArtifact = Object.freeze({
    schema_version: "1.0.0",
    milestone: "M1",
    scenario_id: "m1-deterministic-walking-skeleton",
    synthetic_data: true,
    payloads_omitted: true,
    tenant_id: TENANT_ALPHA,
    session_id: sessionId,
    event_count: canonicalTimeline.length,
    canonical_timeline_fingerprint: domain.sha256Canonical(canonicalTimeline),
    events: canonicalTimeline.map((event) => Object.freeze({
      event_id: event.event_id,
      event_type: event.event_type,
      aggregate_version: event.aggregate_version,
      occurred_at: event.occurred_at,
      data_classification: event.data_classification,
      payload_omitted: true,
      envelope_fingerprint: domain.sha256Canonical(event),
    })),
  });

  const evidenceArtifact = Object.freeze({
    schema_version: "1.0.0",
    milestone: "M1",
    scenario_id: "m1-deterministic-walking-skeleton",
    provider_mode: "fake",
    external_network_calls: 0,
    session: {
      tenant_id: TENANT_ALPHA,
      session_id: sessionId,
      role_pack: "sales-closer@0.1.0",
      channel: "api",
      final_status: completed.body.status,
      final_state_version: completed.body.state_version,
    },
    turns: {
      participant_turn_count: participantSpeakerIds.length,
      presenter_turn_count: presenterSpeakerIds.length,
      accepted_command_count: acceptedTurnCommandIds.length,
      final_turn_index: activeActorState.conversation.turn_index,
      speaker_role_sequence: speakerRoleSequence,
      turn_index_sequence: turnIndexSequence,
      unique_presenter_count: uniquePresenterIds.length,
      presenter_matches_active_floor: uniquePresenterIds.length === 1
        && uniquePresenterIds[0] === activeActorState.session.active_presenter_id,
      alternate_presenter_count: Math.max(0, uniquePresenterIds.length - 1),
    },
    governed_action: {
      question_id: catalogCommand.question_id,
      execution_id: actionEvidence[0].execution_id,
      intent_id: actionEvidence[0].intent_id,
      tool_contract_id: actionEvidence[0].tool_contract_id,
      policy_outcome: actionEvidence[0].policy_outcome,
      receipt_status: actionEvidence[0].status,
      effect_hash: actionEvidence[0].effect_hash,
      effect_confirmed: actionEvidence[0].confirmed_effect,
      idempotent_replay_same_candidate: catalogReplay === catalogAnswer,
      fake_invocation_count: catalogFlow.readFakeCatalogInvocationCount(actionPresenter),
      timeline_event_delta: actionTimelineDelta,
      candidate_speech_match_count: candidateSpeechMatchCount,
      automatically_published: !actionCandidateNotSpokenAutomatically,
    },
    outbox_relay: {
      crash_point: "after_effect_before_ack",
      status_after_crash: publishingCompletion.status,
      pre_lease_outcome: beforeLease.outcome,
      recovered_outcome: recoveredCompletion.outcome,
      recovered_attempt: recoveredCompletion.receipt.attempt,
      timeline_completion_count: canonicalTimeline.filter((event) => event.event_type === "session.completed").length,
      workflow_enqueue_count: workflowRepository.readEnqueueReceipt(workflowObserver, completionRecord.event_id) === null ? 0 : 1,
      dead_letter_count: outbox.listDeadLetters(relayRequest, "session-timeline").length,
    },
    replay: {
      aggregate_version: verification.aggregate_version,
      full_event_count: verification.full_event_count,
      snapshot_version: verification.snapshot_version,
      tail_event_count: verification.tail_event_count,
      state_hash: verification.state_hash,
      matches_outbox: verification.state_hash === domain.interactionStateHash(finalOutboxAggregate),
      matches_hot_actor: verification.state_hash === domain.interactionStateHash(completedActorState),
      matches_workflow_source: verification.state_hash === workflowEvidence.source_state_hash,
      matches_console: verification.state_hash === consoleView.session.state_hash,
    },
    post_call_workflow: {
      run_id: enqueueAfterEffect.workflow_run_id,
      outcomes: workflowOutcomes,
      final_status: workflowRepository.readStatus(workflowObserver, enqueueAfterEffect.workflow_run_id).status,
      step_receipt_count: workflowRepository.listStepReceipts(workflowObserver, enqueueAfterEffect.workflow_run_id).length,
      result_hash: workflowResult.result_hash,
      summary_template_code: workflowResult.summary.template_code,
      summary_canonical_event_count: workflowResult.summary.canonical_event_count,
      evaluation_outcome: workflowResult.evaluation.outcome,
      evaluation_score_basis_points: workflowResult.evaluation.score_basis_points,
      follow_up_external_effect: workflowResult.follow_up_guard.external_effect,
    },
    cost: {
      accounting_scope: "nominal_catalog_lookup_only",
      buckets: artifactCostBuckets(costAggregation),
      included_fake_invocation_count: catalogFlow.readFakeCatalogInvocationCount(actionPresenter),
      excluded_failure_injection_invocation_count: unknownFlow.readFakeCatalogInvocationCount(actionPresenter),
      other_local_fake_attributed_cost_usd_decimal: "0",
      total_estimated_usd_decimal: sumUsdDecimals(
        costAggregation.buckets
          .filter((bucket) => bucket.source === "estimated")
          .map((bucket) => bucket.amount_usd_decimal),
      ),
    },
    operations_console: {
      http_status: consoleResponse.status,
      state_hash: consoleView.session.state_hash,
      timeline_event_count: consoleView.timeline.total_event_count,
      confirmed_receipt_count: consoleView.action_receipts.filter((receipt) => receipt.confirmed_effect).length,
      html_sha256: sha256Text(consoleResponse.body),
      cache_control: consoleResponse.headers["cache-control"],
      raw_payload_fields_rendered: false,
    },
    failure_matrix: [
      {
        case: "cross_tenant_denial",
        outcome: "passed",
        api_foreign_status: foreignApi.status,
        api_missing_status: missingApi.status,
        console_foreign_status: foreignConsole.status,
        console_missing_status: missingConsole.status,
        foreign_equals_missing: foreignConsole.body === missingConsole.body,
        foreign_secondary_reads: foreignCalls.timeline + foreignCalls.actions + foreignCalls.costs,
        beta_relay_outcome: "idle",
        beta_timeline_event_count: 0,
        beta_catalog_error: betaCatalogError,
        beta_workflow_error: betaWorkflowError,
      },
      {
        case: "outbox_retry_after_effect",
        outcome: "passed",
        pre_lease_outcome: beforeLease.outcome,
        recovered_attempt: recoveredCompletion.receipt.attempt,
        final_delivery_status: recoveredCompletion.receipt.status,
        completion_event_count: 1,
        workflow_enqueue_count: 1,
        dead_letter_count: 0,
      },
      {
        case: "unknown_tool_effect",
        outcome: "passed",
        initial_receipt_status: unknownAnswer.receipt.status,
        initial_effect_hash: unknownAnswer.receipt.effect_hash,
        initial_confirmed: unknownAnswer.confirmed,
        idempotent_replay_same_candidate: unknownReplay === unknownAnswer,
        blind_retry_error: blindRetryError,
        beta_reconciliation_error: betaReconciliationError,
        altered_reconciliation_error: alteredReconciliationError,
        reconciliation_status: reconciliation.status,
        second_reconciliation_error: secondReconciliationError,
        post_reconciliation_receipt_status: postReconciliation.receipt.status,
        fake_invocation_count: unknownFlow.readFakeCatalogInvocationCount(actionPresenter),
        timeline_event_delta: unknownTimelineDelta,
      },
    ],
    safeguards: {
      one_mouth_rule_preserved: oneMouthRulePreserved,
      action_candidate_not_spoken_automatically: actionCandidateNotSpokenAutomatically,
      governed_action_chain_verified: governedActionChainVerified,
      external_follow_up_sent: workflowResult.follow_up_guard.external_effect,
      telemetry_sensitive_data_found: telemetrySensitiveDataFound,
    },
  });

  const manifestArtifact = Object.freeze({
    schema_version: "1.0.0",
    milestone: "M1",
    scenario_id: "m1-deterministic-walking-skeleton",
    canonical_command: "pnpm m1:e2e",
    deterministic: true,
    synthetic_data: true,
    event_count: timelineArtifact.event_count,
    replay_state_hash: evidenceArtifact.replay.state_hash,
    artifacts: {
      "timeline.json": domain.sha256Canonical(timelineArtifact),
      "evidence.json": domain.sha256Canonical(evidenceArtifact),
    },
  });

  return Object.freeze({
    timeline: timelineArtifact,
    evidence: evidenceArtifact,
    manifest: manifestArtifact,
  });
}
