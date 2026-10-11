import assert from "node:assert/strict";
import { test } from "node:test";

const trace = await import("../../apps/portal/src/lib/observability/brain-trace.ts");

const PK = "pk-lf-synthetic0001";
const SK = "sk-lf-synthetic0001";
const IDS = { traceId: "a".repeat(32), rootSpanId: "b".repeat(16), retrievalSpanId: "c".repeat(16), generationSpanId: "d".repeat(16) };

const TURN = Object.freeze({
  tenantId: "019f0000-0000-7000-8000-000000000001",
  agentId: "019f0000-0000-7000-8000-000000000002",
  vertical: "life_insurance_qualification",
  language: "english",
  startedAtMs: 1_760_000_000_000,
  endedAtMs: 1_760_000_000_900,
  guardrailFlags: ["approval_claim"],
  toolCallNames: ["estimate_coverage_need"],
  retrieval: { startedAtMs: 1_760_000_000_010, endedAtMs: 1_760_000_000_120, matches: 3, failed: false },
  generation: {
    startedAtMs: 1_760_000_000_130, endedAtMs: 1_760_000_000_880, model: "anthropic/claude-haiku-4.5", failed: false,
    inputTokens: 3200, outputTokens: 60, cachedInputTokens: 2900, costUsd: 0.0012,
  },
});

function attributes(span) {
  return Object.fromEntries(span.attributes.map(({ key, value }) => [key, value.stringValue ?? value.arrayValue.values.map((item) => item.stringValue)]));
}

test("tracing stays off without all three settings, and never accepts plain HTTP off localhost", () => {
  assert.equal(trace.langfuseConfigFromEnv({}), null);
  assert.equal(trace.langfuseConfigFromEnv({ LANGFUSE_PUBLIC_KEY: PK, LANGFUSE_SECRET_KEY: SK }), null, "no default host: data residency is a decision");
  assert.equal(trace.langfuseConfigFromEnv({ LANGFUSE_PUBLIC_KEY: SK, LANGFUSE_SECRET_KEY: PK, LANGFUSE_BASE_URL: "https://cloud.langfuse.com" }), null, "swapped keys");
  assert.equal(trace.langfuseConfigFromEnv({ LANGFUSE_PUBLIC_KEY: PK, LANGFUSE_SECRET_KEY: SK, LANGFUSE_BASE_URL: "http://langfuse.example.com" }), null);
  assert.equal(trace.langfuseConfigFromEnv({ LANGFUSE_PUBLIC_KEY: PK, LANGFUSE_SECRET_KEY: SK, LANGFUSE_BASE_URL: "https://user:pass@cloud.langfuse.com" }), null);

  const cloud = trace.langfuseConfigFromEnv({ LANGFUSE_PUBLIC_KEY: PK, LANGFUSE_SECRET_KEY: SK, LANGFUSE_BASE_URL: "https://us.cloud.langfuse.com/", NODE_ENV: "production" });
  assert.equal(cloud.endpoint, "https://us.cloud.langfuse.com/api/public/otel/v1/traces");
  assert.equal(cloud.authorization, `Basic ${Buffer.from(`${PK}:${SK}`).toString("base64")}`);
  assert.equal(cloud.environment, "production");

  const lab = trace.langfuseConfigFromEnv({ LANGFUSE_PUBLIC_KEY: PK, LANGFUSE_SECRET_KEY: SK, LANGFUSE_HOST: "http://localhost:3000", LANGFUSE_TRACING_ENVIRONMENT: "priscila-lab" });
  assert.equal(lab.endpoint, "http://localhost:3000/api/public/otel/v1/traces");
  assert.equal(lab.environment, "priscila-lab");
  const reserved = trace.langfuseConfigFromEnv({ LANGFUSE_PUBLIC_KEY: PK, LANGFUSE_SECRET_KEY: SK, LANGFUSE_HOST: "http://127.0.0.1:3000", LANGFUSE_TRACING_ENVIRONMENT: "langfuse-internal" });
  assert.equal(reserved.environment, "development", "names starting with langfuse are reserved by Langfuse");
});

test("the OTLP body maps the turn to a trace, a retriever span and a generation", () => {
  const body = trace.brainTurnToOtlp(TURN, { environment: "production" }, IDS);
  const [root, retrieval, generation] = body.resourceSpans[0].scopeSpans[0].spans;

  assert.equal(root.traceId, IDS.traceId);
  assert.equal(root.startTimeUnixNano, "1760000000000000000");
  assert.equal(root.endTimeUnixNano, "1760000000900000000");
  const rootAttributes = attributes(root);
  assert.equal(rootAttributes["langfuse.trace.name"], "brain_turn");
  assert.deepEqual(rootAttributes["langfuse.trace.tags"], ["vertical:life_insurance_qualification", "language:english", "tool_call", "guardrail"]);
  assert.equal(rootAttributes["langfuse.trace.metadata.guardrail_flags"], "approval_claim");
  assert.equal(rootAttributes["langfuse.trace.metadata.tool_calls"], "estimate_coverage_need");
  assert.equal(root.status.code, 1);

  assert.equal(retrieval.parentSpanId, IDS.rootSpanId);
  assert.equal(attributes(retrieval)["langfuse.observation.type"], "retriever");
  assert.equal(attributes(retrieval)["langfuse.observation.metadata.matches"], "3");

  const generationAttributes = attributes(generation);
  assert.equal(generationAttributes["langfuse.observation.type"], "generation");
  assert.equal(generationAttributes["langfuse.observation.model.name"], "anthropic/claude-haiku-4.5");
  assert.deepEqual(JSON.parse(generationAttributes["langfuse.observation.usage_details"]), { input: 3200, output: 60, cache_read_input_tokens: 2900 });
  assert.deepEqual(JSON.parse(generationAttributes["langfuse.observation.cost_details"]), { total: 0.0012 });
});

test("the trace has no slot for conversation content", () => {
  const body = JSON.stringify(trace.brainTurnToOtlp(TURN, { environment: "production" }, IDS));
  for (const key of ["langfuse.observation.input", "langfuse.observation.output", "gen_ai.prompt", "gen_ai.completion", "input.value", "output.value"]) {
    assert.ok(!body.includes(key), `${key} is never set`);
  }
});

test("a degraded turn is a warning with its reason, and steps that did not run are absent", () => {
  const degraded = { ...TURN, degradedReason: "generation_failed", guardrailFlags: [], toolCallNames: [], retrieval: undefined, generation: { startedAtMs: TURN.startedAtMs, endedAtMs: TURN.endedAtMs, model: "anthropic/claude-haiku-4.5", failed: true } };
  delete degraded.retrieval;
  const spans = trace.brainTurnToOtlp(degraded, { environment: "production" }, IDS).resourceSpans[0].scopeSpans[0].spans;
  assert.equal(spans.length, 2);
  const root = attributes(spans[0]);
  assert.equal(root["langfuse.observation.level"], "WARNING");
  assert.equal(root["langfuse.trace.metadata.degraded_reason"], "generation_failed");
  assert.ok(root["langfuse.trace.tags"].includes("degraded"));
  assert.equal(spans[0].status.code, 2);
  assert.equal(attributes(spans[1])["langfuse.observation.level"], "ERROR");
  assert.equal(attributes(spans[1])["langfuse.observation.usage_details"], undefined, "no invented usage for a failed call");
});

test("export posts OTLP JSON with Basic auth and never throws", async () => {
  const config = trace.langfuseConfigFromEnv({ LANGFUSE_PUBLIC_KEY: PK, LANGFUSE_SECRET_KEY: SK, LANGFUSE_BASE_URL: "https://cloud.langfuse.com" });
  const calls = [];
  const sent = await trace.exportBrainTurn(TURN, {
    config, ids: IDS,
    fetchImplementation: async (url, init) => { calls.push({ url, init }); return new Response("{}", { status: 200 }); },
  });
  assert.equal(sent, true);
  assert.equal(calls[0].url, "https://cloud.langfuse.com/api/public/otel/v1/traces");
  assert.equal(calls[0].init.headers.Authorization, config.authorization);
  assert.equal(calls[0].init.headers["x-langfuse-ingestion-version"], "4");
  assert.equal(JSON.parse(calls[0].init.body).resourceSpans[0].scopeSpans[0].spans[0].traceId, IDS.traceId);

  const failures = [];
  assert.equal(await trace.exportBrainTurn(TURN, { config, onFailure: (failure) => failures.push(failure), fetchImplementation: async () => new Response("echo of the payload", { status: 401 }) }), false);
  assert.equal(await trace.exportBrainTurn(TURN, { config, onFailure: (failure) => failures.push(failure), fetchImplementation: async () => { throw new TypeError("network down"); } }), false);
  assert.deepEqual(failures, [{ status: 401 }, { reason: "TypeError" }], "only status or error name, never the response body");

  let aborted = false;
  assert.equal(await trace.exportBrainTurn(TURN, {
    config, timeoutMs: 5, onFailure: () => {},
    fetchImplementation: (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => { aborted = true; reject(new DOMException("aborted", "AbortError")); })),
  }), false);
  assert.equal(aborted, true, "a slow collector is cut off, never awaited forever");

  assert.equal(await trace.exportBrainTurn(TURN, { config: null, fetchImplementation: async () => { throw new Error("must not be called"); } }), false);
});

test("trace ids are random lowercase hex of the OTLP sizes", () => {
  const ids = trace.newTraceIds();
  assert.match(ids.traceId, /^[0-9a-f]{32}$/);
  for (const key of ["rootSpanId", "retrievalSpanId", "generationSpanId"]) assert.match(ids[key], /^[0-9a-f]{16}$/);
  assert.notEqual(trace.newTraceIds().traceId, ids.traceId);
});
