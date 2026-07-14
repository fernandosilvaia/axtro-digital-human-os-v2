import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { delimiter, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../..", import.meta.url));
const api = await import(pathToFileURL(join(root, "apps/api/dist/index.js")).href);
const config = await import(pathToFileURL(join(root, "packages/config/dist/index.js")).href);
const domain = await import(pathToFileURL(join(root, "packages/domain/dist/index.js")).href);
const observability = await import(pathToFileURL(join(root, "packages/observability/dist/index.js")).href);

const tenantAlpha = id(81);
const sessionAlpha = id(82);
const actorAlpha = id(83);
const correlationAlpha = id(84);
const developmentToken = "dev_telemetry_token_0001";

function id(offset) {
  return domain.uuidV7FromParts(
    1_700_400_000_000 + offset,
    Uint8Array.from(Array.from({ length: 10 }, (_, index) => (offset + index + 1) & 0xff)),
  );
}

function runtimeConfiguration() {
  return config.loadRuntimeConfig({
    AXTRO_ENV: "test",
    AXTRO_SERVICE_NAME: "api",
    AXTRO_PROVIDER_MODE: "fake",
    AXTRO_SECRET_BROKER_HANDLE: "secret://local/telemetry-test-broker",
    AXTRO_PORT: "3000",
    AXTRO_REQUEST_TIMEOUT_MS: "10000",
    AXTRO_DEV_AUTH_ENABLED: "true",
    AXTRO_LOG_LEVEL: "info",
  });
}

function authorizedRequest(extraHeaders = {}) {
  const middleware = api.createDevelopmentApiAuthenticationMiddleware({
    config: runtimeConfiguration(),
    registrations: [{
      token: developmentToken,
      actorId: actorAlpha,
      actorType: "human_operator",
      identityKind: "service",
      tenantGrants: [{
        tenantId: tenantAlpha,
        grantedScopes: ["session:read"],
        purposes: ["essential_processing"],
      }],
    }],
    transactionRunner: {
      async withinTransaction(work) {
        return work({ async execute() {} });
      },
    },
  });
  return middleware.authenticate({
    authorization: `Bearer ${developmentToken}`,
    "X-Tenant-Id": tenantAlpha,
    ...extraHeaders,
  });
}

function deterministicRuntime({ secretValues = [], sink: suppliedSink } = {}) {
  const sink = suppliedSink ?? new observability.InMemoryTelemetrySink();
  const traceIds = ["11111111111111111111111111111111"];
  const spanIds = ["2222222222222222", "4444444444444444", "5555555555555555"];
  const correlationIds = [correlationAlpha];
  let timestamp = 1_700_400_000_000;
  const runtime = observability.createTelemetryRuntime({
    sink,
    secretValues,
    clock: () => {
      timestamp += 5;
      return timestamp;
    },
    idGenerator: {
      createTraceId: () => traceIds.shift(),
      createSpanId: () => spanIds.shift(),
      createCorrelationId: () => correlationIds.shift(),
    },
  });
  return { runtime, sink };
}

function continueTraceInPythonWorker(carrier, { tenantId, sessionId, correlationId, causationId = null }) {
  const workerProgram = [
    "import json, sys",
    "from axtro_realtime_worker.telemetry import create_trusted_worker_context, parse_internal_carrier, start_worker_span",
    "parent = parse_internal_carrier(json.loads(sys.argv[1]))",
    "context = create_trusted_worker_context(sys.argv[2], sys.argv[3], sys.argv[4], None if sys.argv[5] == 'null' else sys.argv[5])",
    "span = start_worker_span(context, parent, sys.argv[6])",
    "print(json.dumps({'record': span.record(), 'carrier': span.internal_carrier()}, sort_keys=True))",
  ].join("\n");
  const pythonSource = join(root, "apps", "realtime-worker", "src");
  const pythonPath = [pythonSource, process.env.PYTHONPATH].filter(Boolean).join(delimiter);
  const result = spawnSync(
    process.env.PYTHON ?? "python3",
    [
      "-c",
      workerProgram,
      JSON.stringify(carrier),
      tenantId,
      sessionId,
      correlationId,
      causationId ?? "null",
      "3333333333333333",
    ],
    { encoding: "utf8", env: { ...process.env, PYTHONPATH: pythonPath } },
  );
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test("API, Python worker, and fake provider span a trusted W3C trace without carrying tenant data in carriers", async () => {
  const { runtime, sink } = deterministicRuntime();
  const maliciousPublicTrace = `00-${"a".repeat(32)}-${"b".repeat(16)}-01`;
  const request = authorizedRequest({ traceparent: maliciousPublicTrace, baggage: "tenant=forbidden" });
  let apiCarrier;
  let workerResult;
  let providerCallbackCarrier;

  const result = await api.runAuthenticatedApiTelemetry(
    runtime,
    request,
    { routeTemplate: "/v1/sessions/:session_id" },
    async ({ spanContext, internalTraceCarrier }) => {
      apiCarrier = internalTraceCarrier;
      assert.deepEqual(Object.keys(internalTraceCarrier), ["traceparent"]);
      assert.equal(JSON.stringify(internalTraceCarrier).includes(tenantAlpha), false);
      assert.equal(internalTraceCarrier.traceparent.includes(maliciousPublicTrace.slice(3, 35)), false);

      workerResult = continueTraceInPythonWorker(internalTraceCarrier, {
        tenantId: tenantAlpha,
        sessionId: sessionAlpha,
        correlationId: spanContext.correlationId,
      });
      assert.deepEqual(Object.keys(workerResult.carrier), ["traceparent"]);
      assert.equal(JSON.stringify(workerResult.carrier).includes(tenantAlpha), false);
      assert.equal(JSON.stringify(workerResult.carrier).includes(sessionAlpha), false);
      assert.equal(JSON.stringify(workerResult.carrier).includes(spanContext.correlationId), false);

      await runtime.runWithFakeProviderTelemetry({
        carrier: workerResult.carrier,
        tenantId: tenantAlpha,
        sessionId: sessionAlpha,
        correlationId: spanContext.correlationId,
        causationId: null,
        provider: "local-model-fake",
      }, async (carrier) => {
        providerCallbackCarrier = carrier;
        assert.deepEqual(Object.keys(carrier), ["traceparent"]);
        assert.equal(JSON.stringify(carrier).includes(tenantAlpha), false);
        assert.equal(JSON.stringify(carrier).includes(sessionAlpha), false);
        assert.equal(JSON.stringify(carrier).includes(spanContext.correlationId), false);
        return "provider-result";
      });
      return "api-result";
    },
  );

  assert.equal(result, "api-result");
  assert.deepEqual(Object.keys(apiCarrier), ["traceparent"]);
  assert.deepEqual(Object.keys(workerResult.carrier), ["traceparent"]);
  assert.deepEqual(Object.keys(providerCallbackCarrier), ["traceparent"]);
  assert.equal(sink.spans.length, 2);
  const apiSpan = sink.spans.find((span) => span.name === "api.request");
  const providerSpan = sink.spans.find((span) => span.name === "provider.fake.request");
  const workerSpan = workerResult.record;
  assert.ok(apiSpan);
  assert.ok(providerSpan);
  assert.equal(apiSpan.trace_id, "11111111111111111111111111111111");
  assert.equal(apiSpan.session_id, null);
  assert.equal(workerSpan.trace_id, apiSpan.trace_id);
  assert.equal(providerSpan.trace_id, apiSpan.trace_id);
  assert.equal(workerSpan.correlation_id, apiSpan.correlation_id);
  assert.equal(providerSpan.correlation_id, apiSpan.correlation_id);
  assert.equal(apiSpan.parent_span_id, null);
  assert.equal(workerSpan.parent_span_id, apiSpan.span_id);
  assert.equal(providerSpan.parent_span_id, workerSpan.span_id);
  assert.equal(workerSpan.service_name, "realtime-worker");
  assert.equal(providerSpan.service_name, "provider-fake");
  assert.equal(workerSpan.session_id, sessionAlpha);
  assert.equal(providerSpan.session_id, sessionAlpha);
  assert.equal(workerSpan.trace_flags, "01");
  assert.deepEqual(workerSpan.attributes, { component: "realtime_worker" });
  assert.equal(providerSpan.attributes.provider_request_ref, `local-${providerSpan.span_id}`);
  assert.equal(sink.spans.every((span) => span.tenant_id === tenantAlpha), true);
  assert.equal(sink.logs.every((entry) => JSON.stringify(entry).includes(developmentToken) === false), true);
});

test("trusted continuation rejects malformed, duplicate-field, and zero-valued W3C carriers", () => {
  const { runtime } = deterministicRuntime();
  const trusted = {
    serviceName: "realtime-worker",
    tenantId: tenantAlpha,
    sessionId: sessionAlpha,
    correlationId: correlationAlpha,
    causationId: null,
  };
  const invalidCarriers = [
    undefined,
    {},
    { traceparent: `00-${"0".repeat(32)}-${"1".repeat(16)}-01` },
    { traceparent: `00-${"1".repeat(32)}-${"0".repeat(16)}-01` },
    { traceparent: `00-${"1".repeat(32)}-${"2".repeat(16)}-01`, baggage: "tenant=alpha" },
    { traceparent: `01-${"1".repeat(32)}-${"2".repeat(16)}-01` },
  ];
  for (const carrier of invalidCarriers) {
    assert.throws(() => runtime.continueTrustedInternalTrace(trusted, carrier), observability.TelemetryValidationError);
  }
});

test("structured logs use closed values, redact marked values, and omit restricted payloads", () => {
  const fakeBearer = developmentToken;
  const secretCanary = "canary:telemetry:opaque-value";
  const transcriptCanary = "Marina Oliveira telefone +55 11 99876-1234";
  const { runtime, sink } = deterministicRuntime({ secretValues: ["fake-v1"] });
  const trace = runtime.startPublicApiTrace({ tenantId: tenantAlpha });
  const span = runtime.startSpan("api.request", trace, { route_template: "/v1/sessions/:session_id" });

  const safe = runtime.log({
    level: "info",
    eventCode: "api.request.completed",
    context: span.context,
    classification: "internal",
    attributes: {
      provider: "local-model-fake",
      provider_request_ref: "local-2222222222222222",
      model_version: "fake-v1",
    },
  });
  assert.equal(safe.attributes.model_version, "[REDACTED]");
  assert.equal(JSON.stringify(safe).includes(fakeBearer), false);
  assert.equal(JSON.stringify(safe).includes(secretCanary), false);

  const beforeRejected = sink.logs.length;
  for (const attributes of [
    { payload: transcriptCanary },
    { "gen_ai.prompt.0.content": transcriptCanary },
    { provider_request_ref: fakeBearer },
    { provider_request_ref: "MarinaOliveira" },
    { route_template: "/v1/sessions/marina-oliveira" },
    { provider: "marina-oliveira" },
    { component: "MarinaOliveira" },
    { model_version: secretCanary },
  ]) {
    assert.throws(() => runtime.log({
      level: "info",
      eventCode: "api.request.completed",
      context: span.context,
      classification: "internal",
      attributes,
    }), observability.TelemetryValidationError);
  }
  assert.throws(() => span.end({ outcome: "failure", errorCode: secretCanary }), observability.TelemetryValidationError);
  assert.equal(sink.logs.length, beforeRejected);

  const restricted = runtime.log({
    level: "info",
    eventCode: "api.request.completed",
    context: span.context,
    classification: "restricted",
    attributes: { provider_request_ref: transcriptCanary, payload: transcriptCanary },
  });
  assert.equal(restricted.payload_omitted, true);
  assert.deepEqual(restricted.attributes, {});
  assert.equal(JSON.stringify(restricted).includes(transcriptCanary), false);
  assert.equal(JSON.stringify(restricted).includes("Marina Oliveira"), false);

  span.end({ outcome: "success" });
});

test("sink failures never alter the business result or force a second span end", async () => {
  let emittedSpans = 0;
  let emittedLogs = 0;
  const throwingSink = {
    emitSpan() {
      emittedSpans += 1;
      throw new Error("sink unavailable");
    },
    emitLog() {
      emittedLogs += 1;
      throw new Error("sink unavailable");
    },
  };
  const { runtime } = deterministicRuntime({ sink: throwingSink });
  const trace = runtime.startPublicApiTrace({ tenantId: tenantAlpha });
  const result = await runtime.runWithSpan("api.request", trace, async (span) => {
    const record = runtime.log({
      level: "info",
      eventCode: "api.request.completed",
      context: span.context,
      classification: "internal",
      attributes: { route_template: "/v1/sessions" },
    });
    assert.equal(record.event_code, "api.request.completed");
    return "business-result";
  });

  assert.equal(result, "business-result");
  assert.equal(emittedSpans, 1);
  assert.equal(emittedLogs, 1);
  assert.deepEqual(runtime.emissionFailureCounts, { span: 1, log: 1 });
});
