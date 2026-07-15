/**
 * Pure helpers that produce a `sales.installed` / `sales.updated` event
 * payload shape (contracts/schemas/sales_state.schema.json). This package
 * never mints event envelopes, IDs or timestamps itself — that authority
 * belongs to the session-application layer, consistent with M1's lifecycle
 * command boundary.
 */
export const FUNNEL_STAGES = [
  "opening",
  "discovery",
  "qualification",
  "solution_fit",
  "demonstration",
  "objection_handling",
  "proposal",
  "commitment",
  "follow_up",
  "closed_won",
  "closed_lost",
] as const;
export type FunnelStage = (typeof FUNNEL_STAGES)[number];

export const QUALIFICATION_DIMENSIONS = ["budget", "authority", "need", "timing", "impact", "decision_process"] as const;
export type QualificationDimension = (typeof QUALIFICATION_DIMENSIONS)[number];

export const QUALIFICATION_STATUSES = ["unknown", "partial", "confirmed", "not_applicable"] as const;
export type QualificationStatus = (typeof QUALIFICATION_STATUSES)[number];

export const OBJECTION_STATUSES = ["open", "exploring", "addressed", "unresolved"] as const;
export type ObjectionStatus = (typeof OBJECTION_STATUSES)[number];

export const PROPOSAL_STATUSES = ["not_started", "drafting", "presented", "revising", "accepted", "rejected", "expired"] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export interface SalesQualificationDimension {
  readonly dimension: QualificationDimension;
  readonly status: QualificationStatus;
  readonly value_summary: string | null;
  readonly evidence_refs: readonly string[];
}

export interface SalesObjection {
  readonly objection_id: string;
  readonly category: string;
  readonly summary: string;
  readonly status: ObjectionStatus;
  readonly evidence_refs: readonly string[];
}

export interface SalesStatePayload {
  readonly funnel_stage: FunnelStage;
  readonly methodology: string;
  readonly qualification: readonly SalesQualificationDimension[];
  readonly objections: readonly SalesObjection[];
  readonly proposal_status: ProposalStatus;
  readonly conversion_probability: number;
  readonly next_step: string | null;
}

export class SalesStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SalesStateError";
  }
}

const METHODOLOGY_PATTERN_MAX = 120;

/** Seeds a freshly-installed sales extension: every BANT-ish dimension starts unknown, nothing assumed. */
export function createInitialSalesState(methodology: unknown): SalesStatePayload {
  const validMethodology = stringValue(methodology, "methodology", 1, METHODOLOGY_PATTERN_MAX);
  return Object.freeze({
    funnel_stage: "opening",
    methodology: validMethodology,
    qualification: Object.freeze(
      QUALIFICATION_DIMENSIONS.map((dimension) =>
        Object.freeze({ dimension, status: "unknown" as const, value_summary: null, evidence_refs: Object.freeze([]) }),
      ),
    ),
    objections: Object.freeze([]),
    proposal_status: "not_started",
    conversion_probability: 0,
    next_step: null,
  });
}

export interface SalesStatePatch {
  readonly funnel_stage?: unknown;
  readonly qualification?: unknown;
  readonly objections?: unknown;
  readonly proposal_status?: unknown;
  readonly conversion_probability?: unknown;
  readonly next_step?: unknown;
}

/**
 * Applies a partial change on top of the current sales state. This never
 * regresses `funnel_stage` past `closed_won`/`closed_lost` — a closed deal
 * is a terminal funnel state for this pack.
 */
export function applySalesUpdate(current: SalesStatePayload, patch: SalesStatePatch): SalesStatePayload {
  if (current.funnel_stage === "closed_won" || current.funnel_stage === "closed_lost") {
    throw new SalesStateError("cannot update a sales extension whose funnel_stage is already closed");
  }
  return Object.freeze({
    funnel_stage: patch.funnel_stage === undefined ? current.funnel_stage : enumValue(patch.funnel_stage, FUNNEL_STAGES, "funnel_stage"),
    methodology: current.methodology,
    qualification: patch.qualification === undefined ? current.qualification : parseQualification(patch.qualification),
    objections: patch.objections === undefined ? current.objections : parseObjections(patch.objections),
    proposal_status:
      patch.proposal_status === undefined ? current.proposal_status : enumValue(patch.proposal_status, PROPOSAL_STATUSES, "proposal_status"),
    conversion_probability:
      patch.conversion_probability === undefined ? current.conversion_probability : boundedNumber(patch.conversion_probability, "conversion_probability", 0, 1),
    next_step: patch.next_step === undefined ? current.next_step : (patch.next_step === null ? null : stringValue(patch.next_step, "next_step", 0, 1_000)),
  });
}

function parseQualification(value: unknown): readonly SalesQualificationDimension[] {
  if (!Array.isArray(value) || value.length > 20) throw new SalesStateError("qualification must be an array of at most 20 items");
  const dimensions = new Set<QualificationDimension>();
  const parsed = value.map((item, index) => {
    const record = exactRecord(item, `qualification[${index}]`, ["dimension", "status", "value_summary", "evidence_refs"]);
    const dimension = enumValue(record.dimension, QUALIFICATION_DIMENSIONS, `qualification[${index}].dimension`);
    if (dimensions.has(dimension)) throw new SalesStateError(`qualification cannot repeat dimension ${dimension}`);
    dimensions.add(dimension);
    return Object.freeze({
      dimension,
      status: enumValue(record.status, QUALIFICATION_STATUSES, `qualification[${index}].status`),
      value_summary: record.value_summary === null ? null : stringValue(record.value_summary, `qualification[${index}].value_summary`, 0, 500),
      evidence_refs: stringArray(record.evidence_refs, `qualification[${index}].evidence_refs`, 20),
    });
  });
  return Object.freeze(parsed);
}

function parseObjections(value: unknown): readonly SalesObjection[] {
  if (!Array.isArray(value) || value.length > 50) throw new SalesStateError("objections must be an array of at most 50 items");
  const parsed = value.map((item, index) => {
    const record = exactRecord(item, `objections[${index}]`, ["objection_id", "category", "summary", "status", "evidence_refs"]);
    return Object.freeze({
      objection_id: stringValue(record.objection_id, `objections[${index}].objection_id`, 1, 200),
      category: stringValue(record.category, `objections[${index}].category`, 1, 120),
      summary: stringValue(record.summary, `objections[${index}].summary`, 1, 500),
      status: enumValue(record.status, OBJECTION_STATUSES, `objections[${index}].status`),
      evidence_refs: stringArray(record.evidence_refs, `objections[${index}].evidence_refs`, 20),
    });
  });
  return Object.freeze(parsed);
}

function exactRecord(value: unknown, label: string, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new SalesStateError(`${label} must be a plain object`);
  }
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new SalesStateError(`${label} must contain exactly: ${expected.join(", ")}`);
  }
  return record;
}

function stringValue(value: unknown, label: string, minimum: number, maximum: number): string {
  if (typeof value !== "string" || value.length < minimum || value.length > maximum) {
    throw new SalesStateError(`${label} must be a string between ${minimum} and ${maximum} characters`);
  }
  return value;
}

function stringArray(value: unknown, label: string, maximum: number): string[] {
  if (!Array.isArray(value) || value.length > maximum) throw new SalesStateError(`${label} must be an array of at most ${maximum} items`);
  return value.map((item, index) => stringValue(item, `${label}[${index}]`, 1, 200));
}

function boundedNumber(value: unknown, label: string, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new SalesStateError(`${label} must be a finite number between ${minimum} and ${maximum}`);
  }
  return value;
}

function enumValue<T extends readonly string[]>(value: unknown, allowed: T, label: string): T[number] {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new SalesStateError(`${label} is not an allowed value`);
  }
  return value as T[number];
}
