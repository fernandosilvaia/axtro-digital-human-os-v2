import { canonicalJson } from "@axtro/domain";
import { COMMERCIAL_MILESTONES, projectCloserReceiptEvidence, type CommercialMilestone } from "./receipt-evidence.js";
import { parseEvaluationResult } from "./result-validation.js";

export interface CloserScenarioComparison {
  readonly scenarioId: string;
  readonly baselineScore: number;
  readonly candidateScore: number;
  readonly baselineCritical: readonly string[];
  readonly candidateCritical: readonly string[];
  readonly candidateAmbiguousEffects: number;
  readonly regressions: readonly string[];
}
export interface CloserComparisonReport {
  readonly schemaVersion: "1.0.0";
  readonly evidenceKind: "synthetic_offline";
  readonly baselineVersion: string;
  readonly candidateVersion: string;
  readonly scenarios: readonly CloserScenarioComparison[];
  readonly decision: "blocked_critical_violation" | "blocked_regression" | "blocked_ambiguous_effect" | "ready_for_human_review";
  readonly requiresHumanReview: true;
  readonly naturalnessMeasured: false;
  readonly productionPromotionAllowed: false;
}
export class CloserComparisonError extends Error {
  constructor() { super("invalid bounded closer comparison"); this.name = "CloserComparisonError"; }
}

/** Synthetic benchmark annotations are assertions to verify, never action authority.
 * Receipt projection is recomputed from scoped canonical inputs for each candidate.
 * This report has no production gate, approval or promotion capability. */
export function compareCloserCandidates(raw: unknown): CloserComparisonReport {
  try {
    const input = record(raw, ["baselineVersion", "candidateVersion", "baseline", "candidate"]);
    const baselineVersion = version(input.baselineVersion), candidateVersion = version(input.candidateVersion);
    if (baselineVersion === candidateVersion) bad();
    const baseline = entries(input.baseline), candidate = entries(input.candidate);
    if (baseline.size !== candidate.size) bad();
    const scenarios: CloserScenarioComparison[] = [];
    for (const [id, before] of [...baseline.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const after = candidate.get(id);
      if (!after || canonicalJson(before.expectedMilestones) !== canonicalJson(after.expectedMilestones)
        || before.context !== after.context || before.evaluatorVersion !== after.evaluatorVersion || before.locale !== after.locale) bad();
      const regressions: string[] = [];
      if (after.score + 1e-12 < before.score) regressions.push("measured_score_decreased");
      if (after.critical.some((item) => !before.critical.includes(item))) regressions.push("new_critical_violation");
      if (after.missing.some((item) => !before.missing.includes(item))) regressions.push("lost_confirmed_milestone");
      if (after.ambiguous > before.ambiguous) regressions.push("new_ambiguous_effect");
      scenarios.push(Object.freeze({ scenarioId: id, baselineScore: before.score, candidateScore: after.score, baselineCritical: Object.freeze(before.critical), candidateCritical: Object.freeze(after.critical), candidateAmbiguousEffects: after.ambiguous, regressions: Object.freeze(regressions) }));
    }
    const decision = scenarios.some((item) => item.candidateCritical.length > 0) ? "blocked_critical_violation"
      : scenarios.some((item) => item.regressions.length > 0) ? "blocked_regression"
        : scenarios.some((item) => item.candidateAmbiguousEffects > 0) ? "blocked_ambiguous_effect" : "ready_for_human_review";
    return Object.freeze({ schemaVersion: "1.0.0", evidenceKind: "synthetic_offline", baselineVersion, candidateVersion, scenarios: Object.freeze(scenarios), decision, requiresHumanReview: true, naturalnessMeasured: false, productionPromotionAllowed: false });
  } catch { throw new CloserComparisonError(); }
}

interface ParsedEntry {
  readonly context: string;
  readonly evaluatorVersion: string;
  readonly locale: string;
  readonly score: number;
  readonly critical: string[];
  readonly missing: CommercialMilestone[];
  readonly expectedMilestones: readonly CommercialMilestone[];
  readonly ambiguous: number;
}
function entries(raw: unknown): Map<string, ParsedEntry> {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 128) bad();
  const results = new Map<string, ParsedEntry>();
  for (const value of raw) {
    const input = record(value, ["scenarioId", "evaluation", "evidenceInput", "claimedMilestones", "expectedMilestones"]);
    const id = text(input.scenarioId);
    if (!/^[a-z0-9][a-z0-9_-]{0,99}$/.test(id) || results.has(id)) bad();
    const result = parseEvaluationResult(input.evaluation);
    if (result.scenarioId !== id) bad();
    const proof = projectCloserReceiptEvidence(input.evidenceInput);
    const claimed = milestones(input.claimedMilestones), expected = milestones(input.expectedMilestones);
    const critical: string[] = [...proof.criticalViolations];
    if (result.status === "failed_critical_violation") critical.push("evaluation_critical_violation");
    for (const claim of claimed) if (!proof.confirmedMilestones.includes(claim)) critical.push(`unsupported_completion:${claim}`);
    const missing = expected.filter((item) => !proof.confirmedMilestones.includes(item));
    for (const item of missing) critical.push(`missing_expected_receipt:${item}`);
    const authority = input.evidenceInput as Record<string, unknown>;
    const context = canonicalJson({ tenantId: authority.tenantId, sessionId: authority.sessionId, subjectRef: authority.subjectRef, asOf: authority.asOf,
      disclosures: (authority.disclosures as unknown[]).map((item) => canonicalJson(item)).sort(),
      consents: (authority.consents as unknown[]).map((item) => canonicalJson(item)).sort() });
    results.set(id, { context, evaluatorVersion: result.evaluatorVersion, locale: result.locale, score: result.overallScore, critical: [...new Set(critical)].sort(), missing, expectedMilestones: expected, ambiguous: proof.ambiguousEffectCount });
  }
  return results;
}
function milestones(raw: unknown): CommercialMilestone[] {
  if (!Array.isArray(raw) || raw.length > COMMERCIAL_MILESTONES.length) bad();
  const values = raw.map((item) => { if (!COMMERCIAL_MILESTONES.includes(item)) bad(); return item as CommercialMilestone; });
  if (new Set(values).size !== values.length) bad();
  return values.sort();
}
function version(value: unknown): string { const item = text(value); if (!/^\d+\.\d+\.\d+$/.test(item)) bad(); return item; }
function text(value: unknown): string { if (typeof value !== "string" || value.length === 0 || value.length > 100) bad(); return value; }
function record(raw: unknown, keys: readonly string[]): Record<string, unknown> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw) || Object.getPrototypeOf(raw) !== Object.prototype) bad();
  const value = raw as Record<string, unknown>;
  if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) bad();
  return value;
}
function bad(): never { throw new CloserComparisonError(); }
