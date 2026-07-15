import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import test from "node:test";

const root = fileURLToPath(new URL("../..", import.meta.url));
const telemetry = await import(pathToFileURL(join(root, "packages/realtime-telemetry/dist/index.js")).href);

const { createRealtimeLatencyRecorder, reconcileSessionCost, REALTIME_SPAN_KINDS, SPAN_BUDGETS, TOTAL_EOT_TO_AUDIO_BUDGET_MS } = telemetry;

function span(kind, generationId, startedAtMs, durationMs) {
  return { kind, generationId, startedAtMs, endedAtMs: startedAtMs + durationMs };
}

test("realtime telemetry: p50/p95 are available per component after enough samples", () => {
  const recorder = createRealtimeLatencyRecorder();
  const durations = [100, 120, 140, 160, 500];
  durations.forEach((durationMs, index) => recorder.recordSpan(span("model_first_token", index, 0, durationMs)));
  const summary = recorder.percentiles("model_first_token");
  assert.equal(summary.sampleSize, 5);
  assert.equal(summary.p50Ms, 140);
  assert.equal(summary.p95Ms, 500);
});

test("realtime telemetry: a component within its documented budget evaluates as within_budget", () => {
  const recorder = createRealtimeLatencyRecorder();
  for (let i = 0; i < 20; i += 1) recorder.recordSpan(span("context_compose", i, 0, 15));
  assert.equal(recorder.evaluateBudget("context_compose"), "within_budget");
});

test("realtime telemetry: p95 above its budget is flagged even when p50 is healthy", () => {
  const recorder = createRealtimeLatencyRecorder();
  // 100 samples: the bottom 94% is fast, the top 6% is a slow-tail outlier —
  // p50 stays healthy but the 95th-percentile sample lands inside that tail.
  for (let i = 0; i < 94; i += 1) recorder.recordSpan(span("tts_first_audio", i, 0, 100));
  for (let i = 94; i < 100; i += 1) recorder.recordSpan(span("tts_first_audio", i, 0, 2_000));
  const summary = recorder.percentiles("tts_first_audio");
  assert.equal(summary.p50Ms, 100);
  assert.equal(summary.p95Ms, 2_000);
  assert.equal(recorder.evaluateBudget("tts_first_audio"), "p95_exceeded");
});

test("realtime telemetry: unbudgeted spans are still measured but never flagged against a numeric target", () => {
  const recorder = createRealtimeLatencyRecorder();
  recorder.recordSpan(span("audio_ingress", 1, 0, 5));
  assert.equal(SPAN_BUDGETS.audio_ingress.kind, "unbudgeted");
  assert.equal(recorder.evaluateBudget("audio_ingress"), "unbudgeted");
  assert.equal(recorder.percentiles("audio_ingress").sampleSize, 1);
});

test("realtime telemetry: threshold budgets (avatar warm-up, barge-in stop) use ideal/acceptable, not p50/p95", () => {
  assert.equal(SPAN_BUDGETS.avatar_first_frame.kind, "threshold");
  const recorder = createRealtimeLatencyRecorder();
  recorder.recordSpan(span("cancellation_acknowledged", 1, 0, 150));
  assert.equal(recorder.evaluateBudget("cancellation_acknowledged"), "within_budget");
  recorder.recordSpan(span("cancellation_acknowledged", 2, 0, 220));
  assert.equal(recorder.evaluateBudget("cancellation_acknowledged"), "p50_exceeded");
  recorder.recordSpan(span("cancellation_acknowledged", 3, 0, 300));
  assert.equal(recorder.evaluateBudget("cancellation_acknowledged"), "p95_exceeded");
});

test("realtime telemetry: total EOT-to-audio sums the five component spans for one generation and checks the composite budget", () => {
  const recorder = createRealtimeLatencyRecorder();
  const generationId = 42;
  recorder.recordSpan(span("turn_commit", generationId, 0, 100));
  recorder.recordSpan(span("context_compose", generationId, 100, 15));
  recorder.recordSpan(span("model_first_token", generationId, 115, 200));
  recorder.recordSpan(span("tts_first_audio", generationId, 315, 150));
  recorder.recordSpan(span("channel_publish", generationId, 465, 60));
  assert.equal(recorder.totalEotToAudioMs(generationId), 525);
  assert.equal(recorder.evaluateTotalEotToAudioBudget(generationId), "within_budget");
  assert.ok(525 < TOTAL_EOT_TO_AUDIO_BUDGET_MS.p50Ms);
});

test("realtime telemetry: an incomplete generation reports null total and insufficient_samples, never a partial sum", () => {
  const recorder = createRealtimeLatencyRecorder();
  recorder.recordSpan(span("turn_commit", 7, 0, 100));
  assert.equal(recorder.totalEotToAudioMs(7), null);
  assert.equal(recorder.evaluateTotalEotToAudioBudget(7), "insufficient_samples");
});

test("realtime telemetry: span completeness — the mandatory M2-12 span set can be checked per generation", () => {
  const recorder = createRealtimeLatencyRecorder();
  const generationId = 3;
  recorder.recordSpan(span("audio_ingress", generationId, 0, 5));
  recorder.recordSpan(span("turn_candidate", generationId, 5, 10));
  recorder.recordSpan(span("turn_commit", generationId, 15, 100));
  const required = REALTIME_SPAN_KINDS;
  const missing = recorder.missingSpansForGeneration(generationId, required);
  assert.deepEqual([...missing].sort(), ["avatar_first_frame", "cancellation_acknowledged", "channel_publish", "context_compose", "model_first_token", "tts_first_audio"].sort());
});

test("cost reconciliation: estimated and provider-reported cost within tolerance reconcile", () => {
  const result = reconcileSessionCost({ sessionId: "session-alpha", estimatedUsdMicros: 100_000, providerReportedUsdMicros: 105_000 });
  assert.equal(result.status, "reconciled");
  assert.ok(result.varianceRatio <= 0.1);
});

test("cost reconciliation: a large variance between estimate and provider report is flagged", () => {
  const result = reconcileSessionCost({ sessionId: "session-alpha", estimatedUsdMicros: 100_000, providerReportedUsdMicros: 300_000 });
  assert.equal(result.status, "variance_exceeded");
});

test("realtime telemetry: malformed spans (end before start, unknown kind) are rejected", () => {
  const recorder = createRealtimeLatencyRecorder();
  assert.throws(() => recorder.recordSpan(span("model_first_token", 1, 100, -50)));
  assert.throws(() => recorder.recordSpan({ kind: "unknown_span", generationId: 1, startedAtMs: 0, endedAtMs: 10 }));
});
