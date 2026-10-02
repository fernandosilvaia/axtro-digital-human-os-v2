import type { ScenarioEvaluationResult, DimensionScore } from "./index.js";

const DIMENSIONS = ["factuality", "policy", "discovery", "brevity", "naturalness", "handoff"] as const;
const STATUSES = ["passed", "failed_critical_violation", "failed_low_score"];

/** Results crossing a gate are data, even when a caller claims they came from our evaluator. */
export function parseEvaluationResult(raw: unknown): ScenarioEvaluationResult {
  const value = plainRecord(raw);
  bounded(value.scenarioId, 2000);
  if (typeof value.evaluatorVersion !== "string" || value.evaluatorVersion.length > 100 || !/^\d+\.\d+\.\d+$/.test(value.evaluatorVersion)) invalid();
  if (typeof value.locale !== "string" || !/^[a-z]{2}(-[A-Z]{2})?$/.test(value.locale)) invalid();
  score(value.overallScore);
  if (typeof value.status !== "string" || !STATUSES.includes(value.status)) invalid();
  if (!Array.isArray(value.dimensionScores) || value.dimensionScores.length !== DIMENSIONS.length) invalid();
  const seen = new Set<string>();
  const scores = value.dimensionScores.map((rawEntry): DimensionScore => {
    const entry = plainRecord(rawEntry);
    if (typeof entry.dimension !== "string" || !DIMENSIONS.includes(entry.dimension as typeof DIMENSIONS[number]) || seen.has(entry.dimension)) invalid();
    seen.add(entry.dimension);
    score(entry.score);
    if (typeof entry.criticalViolation !== "boolean" || !Array.isArray(entry.evidence) || entry.evidence.length > 200) invalid();
    const evidence = entry.evidence.map((item) => bounded(item, 2000));
    if (entry.dimension === "naturalness" && (entry.criticalViolation || evidence.length !== 1 || evidence[0] !== "not_evaluated_requires_human_review")) invalid();
    return Object.freeze({ dimension: entry.dimension as DimensionScore["dimension"], score: entry.score as number, criticalViolation: entry.criticalViolation, evidence: Object.freeze(evidence) });
  });
  const critical = scores.some((entry) => entry.criticalViolation);
  if (critical !== (value.status === "failed_critical_violation")) invalid();
  const measured = Number((value.evaluatorVersion as string).split(".")[0]) < 2
    ? scores : scores.filter((entry) => entry.dimension !== "naturalness");
  const mean = measured.reduce((sum, entry) => sum + entry.score, 0) / measured.length;
  if (Math.abs(mean - (value.overallScore as number)) > 1e-12) invalid();
  return Object.freeze({ scenarioId: value.scenarioId as string, evaluatorVersion: value.evaluatorVersion as string, locale: value.locale as string, dimensionScores: Object.freeze(scores), overallScore: mean, status: value.status as ScenarioEvaluationResult["status"] });
}

function invalid(): never { throw new Error("invalid evaluation result"); }
function plainRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) invalid();
  return value as Record<string, unknown>;
}
function bounded(value: unknown, max: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max) invalid();
  return value;
}
function score(value: unknown): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) invalid();
}
