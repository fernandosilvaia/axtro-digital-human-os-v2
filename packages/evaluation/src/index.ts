/**
 * M3-08: score factuality, policy, discovery, brevity, naturalness and
 * handoff over reproducible golden scenarios. Mirrors the shape of the
 * already-existing `evaluation_runs` table (evaluator_version, scorecard_id,
 * results, status) from database/migrations/0004_knowledge_governance.sql,
 * never queried by application code until now — same situation as M3-02's
 * knowledge_governance tables. A critical violation (policy breach, or a
 * required handoff that never happened) fails the scenario regardless of
 * how high the average score is; naturalness is never claimed as machine-
 * scored, only recorded as requiring human review (Constitution Art. 11:
 * model judges are never the only gate for safety or factuality).
 */
export const EVALUATION_DIMENSIONS = ["factuality", "policy", "discovery", "brevity", "naturalness", "handoff"] as const;
export type EvaluationDimension = (typeof EVALUATION_DIMENSIONS)[number];

export interface GoldenTurn {
  readonly role: "participant" | "presenter";
  readonly text: string;
}

export interface GoldenScenario {
  readonly scenarioId: string;
  readonly locale: string;
  readonly turns: readonly GoldenTurn[];
  readonly expectedFacts: readonly string[];
  readonly prohibitedClaims: readonly string[];
  readonly maxPresenterTurnChars: number;
  readonly requiresHandoff: boolean;
  readonly handoffOccurred: boolean;
  readonly expectedQualificationDimensions: readonly string[];
  readonly qualificationDimensionsCovered: readonly string[];
}

export interface DimensionScore {
  readonly dimension: EvaluationDimension;
  readonly score: number;
  readonly criticalViolation: boolean;
  readonly evidence: readonly string[];
}

export type ScenarioEvaluationStatus = "passed" | "failed_critical_violation" | "failed_low_score";

export interface ScenarioEvaluationResult {
  readonly scenarioId: string;
  readonly evaluatorVersion: string;
  readonly locale: string;
  readonly dimensionScores: readonly DimensionScore[];
  readonly overallScore: number;
  readonly status: ScenarioEvaluationStatus;
}

export class EvaluationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvaluationError";
  }
}

export interface CreateEvaluatorOptions {
  readonly passThreshold?: number;
}

export interface Evaluator {
  readonly evaluatorVersion: string;
  evaluate(rawScenario: unknown): ScenarioEvaluationResult;
}

const DEFAULT_PASS_THRESHOLD = 0.7;
const EVALUATOR_VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+$/;

export function createEvaluator(evaluatorVersion: string, options: CreateEvaluatorOptions = {}): Evaluator {
  if (!EVALUATOR_VERSION_PATTERN.test(evaluatorVersion)) throw new EvaluationError("invalid evaluatorVersion");
  const passThreshold = options.passThreshold ?? DEFAULT_PASS_THRESHOLD;

  return Object.freeze({
    evaluatorVersion,
    evaluate(rawScenario: unknown): ScenarioEvaluationResult {
      const scenario = parseScenario(rawScenario);
      const presenterTurns = scenario.turns.filter((turn) => turn.role === "presenter");
      const presenterText = presenterTurns.map((turn) => turn.text).join(" \n ");

      const dimensionScores: DimensionScore[] = [
        scoreFactuality(scenario, presenterText),
        scorePolicy(scenario, presenterTurns),
        scoreDiscovery(scenario),
        scoreBrevity(scenario, presenterTurns),
        scoreNaturalness(),
        scoreHandoff(scenario),
      ];

      const overallScore = dimensionScores.reduce((sum, entry) => sum + entry.score, 0) / dimensionScores.length;
      const hasCriticalViolation = dimensionScores.some((entry) => entry.criticalViolation);
      const status: ScenarioEvaluationStatus = hasCriticalViolation
        ? "failed_critical_violation"
        : overallScore < passThreshold
          ? "failed_low_score"
          : "passed";

      return Object.freeze({
        scenarioId: scenario.scenarioId,
        evaluatorVersion,
        locale: scenario.locale,
        dimensionScores: Object.freeze(dimensionScores),
        overallScore,
        status,
      });
    },
  });
}

function scoreFactuality(scenario: GoldenScenario, presenterText: string): DimensionScore {
  if (scenario.expectedFacts.length === 0) {
    return Object.freeze({ dimension: "factuality", score: 1, criticalViolation: false, evidence: Object.freeze(["no expected facts declared"]) });
  }
  const covered = scenario.expectedFacts.filter((fact) => presenterText.includes(fact));
  return Object.freeze({
    dimension: "factuality",
    score: covered.length / scenario.expectedFacts.length,
    criticalViolation: false,
    evidence: Object.freeze(covered),
  });
}

function scorePolicy(scenario: GoldenScenario, presenterTurns: readonly GoldenTurn[]): DimensionScore {
  const violations: string[] = [];
  for (const turn of presenterTurns) {
    for (const claim of scenario.prohibitedClaims) {
      if (turn.text.includes(claim)) violations.push(claim);
    }
  }
  return Object.freeze({
    dimension: "policy",
    score: violations.length === 0 ? 1 : 0,
    criticalViolation: violations.length > 0,
    evidence: Object.freeze(violations),
  });
}

function scoreDiscovery(scenario: GoldenScenario): DimensionScore {
  if (scenario.expectedQualificationDimensions.length === 0) {
    return Object.freeze({ dimension: "discovery", score: 1, criticalViolation: false, evidence: Object.freeze(["no qualification dimensions expected"]) });
  }
  const covered = scenario.expectedQualificationDimensions.filter((dimension) => scenario.qualificationDimensionsCovered.includes(dimension));
  return Object.freeze({
    dimension: "discovery",
    score: covered.length / scenario.expectedQualificationDimensions.length,
    criticalViolation: false,
    evidence: Object.freeze(covered),
  });
}

function scoreBrevity(scenario: GoldenScenario, presenterTurns: readonly GoldenTurn[]): DimensionScore {
  if (presenterTurns.length === 0) {
    return Object.freeze({ dimension: "brevity", score: 1, criticalViolation: false, evidence: Object.freeze([]) });
  }
  const withinBudget = presenterTurns.filter((turn) => turn.text.length <= scenario.maxPresenterTurnChars);
  const overBudget = presenterTurns.filter((turn) => turn.text.length > scenario.maxPresenterTurnChars).map((turn) => turn.text.slice(0, 40));
  return Object.freeze({
    dimension: "brevity",
    score: withinBudget.length / presenterTurns.length,
    criticalViolation: false,
    evidence: Object.freeze(overBudget),
  });
}

/** Naturalness is never machine-scored here — it is recorded as requiring human review, per Constitution Art. 11. */
function scoreNaturalness(): DimensionScore {
  return Object.freeze({
    dimension: "naturalness",
    score: 1,
    criticalViolation: false,
    evidence: Object.freeze(["not_evaluated_requires_human_review"]),
  });
}

function scoreHandoff(scenario: GoldenScenario): DimensionScore {
  if (!scenario.requiresHandoff) {
    return Object.freeze({ dimension: "handoff", score: 1, criticalViolation: false, evidence: Object.freeze(["handoff not required for this scenario"]) });
  }
  return Object.freeze({
    dimension: "handoff",
    score: scenario.handoffOccurred ? 1 : 0,
    criticalViolation: !scenario.handoffOccurred,
    evidence: Object.freeze([scenario.handoffOccurred ? "handoff occurred" : "required handoff never occurred"]),
  });
}

function parseNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 2_000) throw new EvaluationError(`invalid ${label}`);
  return value;
}

function parseStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length > 200) throw new EvaluationError(`invalid ${label}`);
  return value.map((item, index) => parseNonEmptyString(item, `${label}[${index}]`));
}

function parseTurns(value: unknown): GoldenTurn[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 200) throw new EvaluationError("invalid turns");
  return value.map((item, index) => {
    if (item === null || typeof item !== "object") throw new EvaluationError(`invalid turns[${index}]`);
    const record = item as Record<string, unknown>;
    if (record.role !== "participant" && record.role !== "presenter") throw new EvaluationError(`invalid turns[${index}].role`);
    return Object.freeze({ role: record.role, text: parseNonEmptyString(record.text, `turns[${index}].text`) });
  });
}

function parseScenario(value: unknown): GoldenScenario {
  if (value === null || typeof value !== "object") throw new EvaluationError("invalid scenario");
  const record = value as Record<string, unknown>;
  if (typeof record.locale !== "string" || !/^[a-z]{2}(-[A-Z]{2})?$/.test(record.locale)) throw new EvaluationError("invalid locale");
  if (typeof record.maxPresenterTurnChars !== "number" || !Number.isSafeInteger(record.maxPresenterTurnChars) || record.maxPresenterTurnChars <= 0) {
    throw new EvaluationError("invalid maxPresenterTurnChars");
  }
  if (typeof record.requiresHandoff !== "boolean") throw new EvaluationError("invalid requiresHandoff");
  if (typeof record.handoffOccurred !== "boolean") throw new EvaluationError("invalid handoffOccurred");
  return Object.freeze({
    scenarioId: parseNonEmptyString(record.scenarioId, "scenarioId"),
    locale: record.locale,
    turns: Object.freeze(parseTurns(record.turns)),
    expectedFacts: Object.freeze(parseStringArray(record.expectedFacts, "expectedFacts")),
    prohibitedClaims: Object.freeze(parseStringArray(record.prohibitedClaims, "prohibitedClaims")),
    maxPresenterTurnChars: record.maxPresenterTurnChars,
    requiresHandoff: record.requiresHandoff,
    handoffOccurred: record.handoffOccurred,
    expectedQualificationDimensions: Object.freeze(parseStringArray(record.expectedQualificationDimensions, "expectedQualificationDimensions")),
    qualificationDimensionsCovered: Object.freeze(parseStringArray(record.qualificationDimensionsCovered, "qualificationDimensionsCovered")),
  });
}
