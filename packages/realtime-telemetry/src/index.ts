/**
 * M2-11: latency, quality and cost telemetry for the realtime path, per
 * docs/operations/LATENCY_BUDGETS.md. This package owns its own closed span
 * vocabulary rather than widening `@axtro/observability`'s frozen M0
 * `TELEMETRY_SPAN_NAMES` (D-V2-047) — every sample is still correlated by
 * `generationId`, matching the turn-coordinator/avatar/scene generation
 * fencing used across M2.
 */
export const REALTIME_SPAN_KINDS = [
  "audio_ingress",
  "turn_candidate",
  "turn_commit",
  "context_compose",
  "model_first_token",
  "tts_first_audio",
  "avatar_first_frame",
  "channel_publish",
  "cancellation_acknowledged",
] as const;
export type RealtimeSpanKind = (typeof REALTIME_SPAN_KINDS)[number];

export interface RealtimeSpanSample {
  readonly kind: RealtimeSpanKind;
  readonly generationId: number;
  readonly startedAtMs: number;
  readonly endedAtMs: number;
  readonly durationMs: number;
}

export interface PercentileBudget {
  readonly kind: "percentile";
  readonly p50Ms: number;
  readonly p95Ms: number;
}
export interface ThresholdBudget {
  readonly kind: "threshold";
  readonly idealMs: number;
  readonly acceptableMs: number;
}
export interface UnbudgetedSpan {
  readonly kind: "unbudgeted";
}
export type SpanBudget = PercentileBudget | ThresholdBudget | UnbudgetedSpan;

/** Verbatim mapping from docs/operations/LATENCY_BUDGETS.md. */
export const SPAN_BUDGETS: Readonly<Record<RealtimeSpanKind, SpanBudget>> = Object.freeze({
  audio_ingress: Object.freeze({ kind: "unbudgeted" }),
  turn_candidate: Object.freeze({ kind: "unbudgeted" }),
  turn_commit: Object.freeze({ kind: "percentile", p50Ms: 120, p95Ms: 300 }),
  context_compose: Object.freeze({ kind: "percentile", p50Ms: 20, p95Ms: 60 }),
  model_first_token: Object.freeze({ kind: "percentile", p50Ms: 250, p95Ms: 600 }),
  tts_first_audio: Object.freeze({ kind: "percentile", p50Ms: 180, p95Ms: 450 }),
  avatar_first_frame: Object.freeze({ kind: "threshold", idealMs: 2_000, acceptableMs: 5_000 }),
  channel_publish: Object.freeze({ kind: "percentile", p50Ms: 80, p95Ms: 180 }),
  cancellation_acknowledged: Object.freeze({ kind: "threshold", idealMs: 180, acceptableMs: 250 }),
});

export const TOTAL_EOT_TO_AUDIO_BUDGET_MS: PercentileBudget = Object.freeze({ kind: "percentile", p50Ms: 650, p95Ms: 1_500 });
const EOT_TO_AUDIO_COMPONENTS: readonly RealtimeSpanKind[] = Object.freeze([
  "turn_commit",
  "context_compose",
  "model_first_token",
  "tts_first_audio",
  "channel_publish",
]);

export type BudgetEvaluation = "within_budget" | "p50_exceeded" | "p95_exceeded" | "unbudgeted" | "insufficient_samples";

export interface PercentileSummary {
  readonly p50Ms: number | null;
  readonly p95Ms: number | null;
  readonly sampleSize: number;
}

export interface RealtimeLatencyRecorder {
  recordSpan(input: unknown): RealtimeSpanSample;
  samples(kind: RealtimeSpanKind): readonly RealtimeSpanSample[];
  percentiles(kind: RealtimeSpanKind): PercentileSummary;
  evaluateBudget(kind: RealtimeSpanKind): BudgetEvaluation;
  totalEotToAudioMs(generationId: unknown): number | null;
  evaluateTotalEotToAudioBudget(generationId: unknown): BudgetEvaluation;
  missingSpansForGeneration(generationId: unknown, requiredKinds: readonly RealtimeSpanKind[]): readonly RealtimeSpanKind[];
}

const MAX_SAMPLES_PER_KIND = 10_000;
const MIN_SAMPLES_FOR_PERCENTILE = 1;

export function createRealtimeLatencyRecorder(): RealtimeLatencyRecorder {
  const samplesByKind = new Map<RealtimeSpanKind, RealtimeSpanSample[]>(REALTIME_SPAN_KINDS.map((kind) => [kind, []]));

  return Object.freeze({
    recordSpan(rawInput: unknown): RealtimeSpanSample {
      const sample = parseSpanSample(rawInput);
      const bucket = samplesByKind.get(sample.kind)!;
      if (bucket.length >= MAX_SAMPLES_PER_KIND) bucket.shift();
      bucket.push(sample);
      return sample;
    },

    samples(kind: RealtimeSpanKind): readonly RealtimeSpanSample[] {
      return Object.freeze([...(samplesByKind.get(kind) ?? [])]);
    },

    percentiles(kind: RealtimeSpanKind): PercentileSummary {
      const durations = (samplesByKind.get(kind) ?? []).map((sample) => sample.durationMs).sort((a, b) => a - b);
      if (durations.length < MIN_SAMPLES_FOR_PERCENTILE) return Object.freeze({ p50Ms: null, p95Ms: null, sampleSize: 0 });
      return Object.freeze({ p50Ms: nearestRank(durations, 0.5), p95Ms: nearestRank(durations, 0.95), sampleSize: durations.length });
    },

    evaluateBudget(kind: RealtimeSpanKind): BudgetEvaluation {
      const budget = SPAN_BUDGETS[kind];
      if (budget.kind === "unbudgeted") return "unbudgeted";
      const durations = (samplesByKind.get(kind) ?? []).map((sample) => sample.durationMs).sort((a, b) => a - b);
      if (durations.length < MIN_SAMPLES_FOR_PERCENTILE) return "insufficient_samples";
      if (budget.kind === "threshold") {
        const worst = durations[durations.length - 1]!;
        if (worst > budget.acceptableMs) return "p95_exceeded";
        if (worst > budget.idealMs) return "p50_exceeded";
        return "within_budget";
      }
      const p50 = nearestRank(durations, 0.5)!;
      const p95 = nearestRank(durations, 0.95)!;
      if (p95 > budget.p95Ms) return "p95_exceeded";
      if (p50 > budget.p50Ms) return "p50_exceeded";
      return "within_budget";
    },

    totalEotToAudioMs(rawGenerationId: unknown): number | null {
      const generationId = parseGenerationId(rawGenerationId);
      let total = 0;
      for (const kind of EOT_TO_AUDIO_COMPONENTS) {
        const sample = (samplesByKind.get(kind) ?? []).find((entry) => entry.generationId === generationId);
        if (sample === undefined) return null;
        total += sample.durationMs;
      }
      return total;
    },

    evaluateTotalEotToAudioBudget(rawGenerationId: unknown): BudgetEvaluation {
      const total = this.totalEotToAudioMs(rawGenerationId);
      if (total === null) return "insufficient_samples";
      if (total > TOTAL_EOT_TO_AUDIO_BUDGET_MS.p95Ms) return "p95_exceeded";
      if (total > TOTAL_EOT_TO_AUDIO_BUDGET_MS.p50Ms) return "p50_exceeded";
      return "within_budget";
    },

    missingSpansForGeneration(rawGenerationId: unknown, requiredKinds: readonly RealtimeSpanKind[]): readonly RealtimeSpanKind[] {
      const generationId = parseGenerationId(rawGenerationId);
      const missing = requiredKinds.filter((kind) => !(samplesByKind.get(kind) ?? []).some((sample) => sample.generationId === generationId));
      return Object.freeze(missing);
    },
  });
}

export interface CostReconciliationInput {
  readonly sessionId: string;
  readonly estimatedUsdMicros: number;
  readonly providerReportedUsdMicros: number;
  readonly toleranceRatio?: number;
}

export type CostReconciliationStatus = "reconciled" | "variance_exceeded";

export interface CostReconciliationResult {
  readonly status: CostReconciliationStatus;
  readonly sessionId: string;
  readonly estimatedUsdMicros: number;
  readonly providerReportedUsdMicros: number;
  readonly varianceRatio: number;
}

const DEFAULT_TOLERANCE_RATIO = 0.1;

/** Estimated vs provider-reported cost reconcile per session (M2-11 acceptance criterion). */
export function reconcileSessionCost(rawInput: unknown): CostReconciliationResult {
  const input = parseCostReconciliationInput(rawInput);
  const toleranceRatio = input.toleranceRatio ?? DEFAULT_TOLERANCE_RATIO;
  const denominator = Math.max(1, input.estimatedUsdMicros);
  const varianceRatio = Math.abs(input.providerReportedUsdMicros - input.estimatedUsdMicros) / denominator;
  return Object.freeze({
    status: varianceRatio > toleranceRatio ? "variance_exceeded" : "reconciled",
    sessionId: input.sessionId,
    estimatedUsdMicros: input.estimatedUsdMicros,
    providerReportedUsdMicros: input.providerReportedUsdMicros,
    varianceRatio,
  });
}

function nearestRank(sortedAscending: readonly number[], percentile: number): number {
  const index = Math.min(sortedAscending.length - 1, Math.max(0, Math.ceil(percentile * sortedAscending.length) - 1));
  return sortedAscending[index]!;
}

function parseSpanSample(value: unknown): RealtimeSpanSample {
  if (value === null || typeof value !== "object") throw new RangeError("invalid realtime span sample");
  const record = value as Record<string, unknown>;
  if (typeof record.kind !== "string" || !(REALTIME_SPAN_KINDS as readonly string[]).includes(record.kind)) throw new RangeError("invalid span kind");
  const generationId = parseGenerationId(record.generationId);
  const startedAtMs = parseNonNegativeFinite(record.startedAtMs, "startedAtMs");
  const endedAtMs = parseNonNegativeFinite(record.endedAtMs, "endedAtMs");
  if (endedAtMs < startedAtMs) throw new RangeError("span cannot end before it starts");
  return Object.freeze({ kind: record.kind as RealtimeSpanKind, generationId, startedAtMs, endedAtMs, durationMs: endedAtMs - startedAtMs });
}

function parseGenerationId(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new RangeError("invalid generationId");
  return value;
}

function parseNonNegativeFinite(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new RangeError(`invalid ${field}`);
  return value;
}

function parseCostReconciliationInput(value: unknown): CostReconciliationInput {
  if (value === null || typeof value !== "object") throw new RangeError("invalid cost reconciliation input");
  const record = value as Record<string, unknown>;
  if (typeof record.sessionId !== "string" || record.sessionId.length === 0) throw new RangeError("invalid sessionId");
  const estimatedUsdMicros = parseNonNegativeFinite(record.estimatedUsdMicros, "estimatedUsdMicros");
  const providerReportedUsdMicros = parseNonNegativeFinite(record.providerReportedUsdMicros, "providerReportedUsdMicros");
  if (record.toleranceRatio !== undefined && (typeof record.toleranceRatio !== "number" || record.toleranceRatio < 0)) {
    throw new RangeError("invalid toleranceRatio");
  }
  return Object.freeze({
    sessionId: record.sessionId,
    estimatedUsdMicros,
    providerReportedUsdMicros,
    ...(record.toleranceRatio === undefined ? {} : { toleranceRatio: record.toleranceRatio }),
  });
}
