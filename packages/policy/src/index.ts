import { createHash } from "node:crypto";

import type { ActionIntent, PolicyDecision } from "@axtro/contracts-ts";
import {
  canonicalJson,
  parseActorId,
  parseActorType,
  parseSessionId,
  parseTenantId,
  parseUuidV7,
  uuidV7FromParts,
  uuidV7Timestamp,
  type ActorId,
  type ActorType,
  type TenantId,
  type UuidV7,
} from "@axtro/domain";

export const MAX_ACTION_INTENT_TTL_MS = 60 * 60 * 1_000;
export const M0_POLICY_VERSION = "m0-readonly-catalog@1.0.0" as const;

export const M0_READ_ONLY_CATALOG_CONTRACT = Object.freeze({
  schema_version: "2.0.0",
  tool_contract_id: "catalog.lookup",
  version: "1.0.0",
  tool_name: "catalog_lookup",
  action: "get_plan",
  tenant_scope: "tenant_installation",
  risk_class: "read_tenant",
  input_schema_ref: "https://schemas.axtro.ai/tools/catalog-lookup-input.schema.json",
  output_schema_ref: "https://schemas.axtro.ai/tools/catalog-lookup-output.schema.json",
  timeout_ms: 1_500,
  idempotency_required: false,
  human_approval: "never",
  allowed_actors: Object.freeze(["presenter", "workflow"]),
  data_classification: "internal",
  side_effects: "none",
  status: "active",
});

export const M0_CATALOG_PLAN_IDS = Object.freeze(["starter", "growth", "unknown_effect"]);
export type M0CatalogPlanId = (typeof M0_CATALOG_PLAN_IDS)[number];

export interface M0CatalogLookup {
  readonly plan_id: M0CatalogPlanId;
}

export interface PolicyEvaluationInput {
  readonly intent: unknown;
  readonly authorized_tenant_id: unknown;
  readonly authorized_actor_id: unknown;
  readonly authorized_actor_type: unknown;
  readonly evaluated_at_ms: unknown;
}

export interface DeterministicPolicyEngine {
  evaluate(input: PolicyEvaluationInput): PolicyDecision;
}

export interface DeterministicPolicyEngineOptions {
  /** Closed composition profile that can only make the M0 fixture stricter. */
  readonly requireApprovalForCatalogFixture?: boolean;
}

export class ActionIntentValidationError extends Error {
  constructor() {
    super("Action intent is invalid");
    this.name = "ActionIntentValidationError";
  }
}

export class ActionIntentWindowError extends Error {
  constructor() {
    super("Action intent is not active");
    this.name = "ActionIntentWindowError";
  }
}

export class PolicyDecisionValidationError extends Error {
  constructor() {
    super("Policy decision is invalid");
    this.name = "PolicyDecisionValidationError";
  }
}

export function createDeterministicPolicyEngine(
  optionsInput: DeterministicPolicyEngineOptions = {},
): DeterministicPolicyEngine {
  const requireApprovalForCatalogFixture = normalizePolicyOptions(optionsInput);
  return Object.freeze({
    evaluate(input: PolicyEvaluationInput): PolicyDecision {
      const normalized = normalizeEvaluationInput(input);
      const decision = evaluateDeterministicPolicy(normalized, requireApprovalForCatalogFixture);
      return parsePolicyDecision(decision);
    },
  });
}

/** Parse an untrusted ActionIntent against the generated contract at runtime. */
export function parseActionIntent(value: unknown): ActionIntent {
  try {
    const record = exactRecord(value, ACTION_INTENT_KEYS);
    const requestedAt = parseTimestamp(readValue(record, "requested_at"));
    const expiresAt = parseTimestamp(readValue(record, "expires_at"));
    if (requestedAt.milliseconds > expiresAt.milliseconds) throw new NormalizationError();
    if (expiresAt.milliseconds - requestedAt.milliseconds > MAX_ACTION_INTENT_TTL_MS) throw new NormalizationError();

    const intent: ActionIntent = {
      schema_version: requireExactString(readValue(record, "schema_version"), "2.0.0"),
      intent_id: parseUuidV7(readValue(record, "intent_id"), "intent_id"),
      session_id: parseSessionId(readValue(record, "session_id")),
      tenant_id: parseTenantId(readValue(record, "tenant_id")),
      actor_id: parseActorId(readValue(record, "actor_id")),
      actor_type: parseActorType(readValue(record, "actor_type")),
      tool_contract_id: boundedString(readValue(record, "tool_contract_id"), 1, 200),
      action: boundedString(readValue(record, "action"), 1, 200),
      arguments_json: parseCanonicalJson(readValue(record, "arguments_json"), 2, 100_000),
      purpose: boundedString(readValue(record, "purpose"), 1, 1_000),
      idempotency_key: boundedString(readValue(record, "idempotency_key"), 16, 200),
      requested_at: requestedAt.iso,
      expires_at: expiresAt.iso,
    };
    return Object.freeze(intent);
  } catch {
    throw new ActionIntentValidationError();
  }
}

/** Ensure an already valid intent is active against a trusted composition clock. */
export function assertActionIntentActive(intentInput: unknown, evaluatedAtMsInput: unknown): number {
  const intent = parseActionIntent(intentInput);
  const evaluatedAtMs = parseSafeMilliseconds(evaluatedAtMsInput);
  const requestedAt = parseTimestamp(intent.requested_at).milliseconds;
  const expiresAt = parseTimestamp(intent.expires_at).milliseconds;
  if (evaluatedAtMs < requestedAt || evaluatedAtMs > expiresAt) throw new ActionIntentWindowError();
  return evaluatedAtMs;
}

/** Validate an internal policy artifact before an Action Runtime can consume it. */
export function parsePolicyDecision(value: unknown): PolicyDecision {
  try {
    const record = exactRecord(value, POLICY_DECISION_KEYS);
    const evaluatedAt = parseTimestamp(readValue(record, "evaluated_at"));
    const expiresAt = parseTimestamp(readValue(record, "expires_at"));
    if (evaluatedAt.milliseconds > expiresAt.milliseconds) throw new NormalizationError();
    const outcome = enumValue(readValue(record, "outcome"), ["allow", "deny", "require_approval"] as const);
    const reasons = boundedStrings(readValue(record, "reasons"), 1, 50, 1, 500);
    const obligations = boundedStrings(readValue(record, "obligations"), 0, 50, 1, 500);
    const decision: PolicyDecision = {
      schema_version: requireExactString(readValue(record, "schema_version"), "2.0.0"),
      decision_id: parseUuidV7(readValue(record, "decision_id"), "decision_id"),
      intent_id: parseUuidV7(readValue(record, "intent_id"), "intent_id"),
      tenant_id: parseTenantId(readValue(record, "tenant_id")),
      outcome,
      reasons,
      obligations,
      policy_version: boundedString(readValue(record, "policy_version"), 1, 100),
      evaluated_at: evaluatedAt.iso,
      expires_at: expiresAt.iso,
    };
    return Object.freeze(decision);
  } catch {
    throw new PolicyDecisionValidationError();
  }
}

/** Resolve the sole M0 fixture contract. Any nonmatching intent remains unexecutable. */
export function resolveM0ReadOnlyCatalogLookup(intentInput: unknown): M0CatalogLookup | null {
  const intent = parseActionIntent(intentInput);
  if (
    intent.tool_contract_id !== M0_READ_ONLY_CATALOG_CONTRACT.tool_contract_id
    || intent.action !== M0_READ_ONLY_CATALOG_CONTRACT.action
  ) {
    return null;
  }
  try {
    const parsed = JSON.parse(intent.arguments_json);
    const record = exactRecord(parsed, ["plan_id"]);
    const planId = enumValue(readValue(record, "plan_id"), M0_CATALOG_PLAN_IDS);
    return Object.freeze({ plan_id: planId });
  } catch {
    return null;
  }
}

export function deriveDeterministicActionUuid(intentIdInput: unknown, namespace: string): UuidV7 {
  const intentId = parseUuidV7(intentIdInput, "intent_id");
  if (typeof namespace !== "string" || !/^[a-z][a-z0-9_.-]{1,63}$/.test(namespace)) {
    throw new ActionIntentValidationError();
  }
  const digest = createHash("sha256").update(`${namespace}:${intentId}`, "utf8").digest();
  return uuidV7FromParts(uuidV7Timestamp(intentId), digest.subarray(0, 10));
}

interface NormalizedEvaluationInput {
  readonly intent: ActionIntent;
  readonly authorizedTenantId: TenantId;
  readonly authorizedActorId: ActorId;
  readonly authorizedActorType: ActorType;
  readonly evaluatedAtMs: number;
}

interface ParsedTimestamp {
  readonly iso: string;
  readonly milliseconds: number;
}

class NormalizationError extends Error {}

const ACTION_INTENT_KEYS = [
  "schema_version",
  "intent_id",
  "session_id",
  "tenant_id",
  "actor_id",
  "actor_type",
  "tool_contract_id",
  "action",
  "arguments_json",
  "purpose",
  "idempotency_key",
  "requested_at",
  "expires_at",
] as const;

const POLICY_DECISION_KEYS = [
  "schema_version",
  "decision_id",
  "intent_id",
  "tenant_id",
  "outcome",
  "reasons",
  "obligations",
  "policy_version",
  "evaluated_at",
  "expires_at",
] as const;

const RFC3339_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/;

function normalizeEvaluationInput(value: PolicyEvaluationInput): NormalizedEvaluationInput {
  try {
    const record = exactRecord(value, [
      "intent",
      "authorized_tenant_id",
      "authorized_actor_id",
      "authorized_actor_type",
      "evaluated_at_ms",
    ]);
    return Object.freeze({
      intent: parseActionIntent(readValue(record, "intent")),
      authorizedTenantId: parseTenantId(readValue(record, "authorized_tenant_id")),
      authorizedActorId: parseActorId(readValue(record, "authorized_actor_id")),
      authorizedActorType: parseActorType(readValue(record, "authorized_actor_type")),
      evaluatedAtMs: parseSafeMilliseconds(readValue(record, "evaluated_at_ms")),
    });
  } catch {
    throw new PolicyDecisionValidationError();
  }
}

function evaluateDeterministicPolicy(
  input: NormalizedEvaluationInput,
  requireApprovalForCatalogFixture: boolean,
): PolicyDecision {
  const { intent } = input;
  const evaluationIso = timestampFromMilliseconds(input.evaluatedAtMs);
  let outcome: PolicyDecision["outcome"] = "deny";
  let reasons: string[] = ["m0_policy_identity_or_contract_denied"];
  let obligations: string[] = ["redact_runtime_telemetry"];

  const identityMatches = intent.tenant_id === input.authorizedTenantId
    && intent.actor_id === input.authorizedActorId
    && intent.actor_type === input.authorizedActorType;
  const operation = resolveM0ReadOnlyCatalogLookup(intent);
  const isActive = isIntentActive(intent, input.evaluatedAtMs);

  if (!identityMatches) {
    reasons = ["m0_policy_authenticated_identity_mismatch"];
  } else if (!isActive) {
    reasons = ["m0_policy_intent_not_active"];
  } else if (operation === null) {
    reasons = ["m0_policy_tool_not_allowlisted"];
  } else if (!M0_READ_ONLY_CATALOG_CONTRACT.allowed_actors.includes(intent.actor_type)) {
    reasons = ["m0_policy_actor_not_allowed_for_fixture"];
  } else if (requireApprovalForCatalogFixture) {
    outcome = "require_approval";
    reasons = ["m0_policy_fixture_requires_approval"];
    obligations = ["record_human_approval"];
  } else {
    outcome = "allow";
    reasons = ["m0_policy_readonly_catalog_allowed"];
  }

  const frozenReasons = [...reasons];
  const frozenObligations = [...obligations];
  Object.freeze(frozenReasons);
  Object.freeze(frozenObligations);
  const decision: PolicyDecision = {
    schema_version: "2.0.0",
    decision_id: deriveDeterministicActionUuid(intent.intent_id, "policy-decision"),
    intent_id: intent.intent_id,
    tenant_id: intent.tenant_id,
    outcome,
    reasons: frozenReasons,
    obligations: frozenObligations,
    policy_version: M0_POLICY_VERSION,
    evaluated_at: evaluationIso,
    expires_at: intent.expires_at,
  };
  return Object.freeze(decision);
}

function normalizePolicyOptions(value: DeterministicPolicyEngineOptions): boolean {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
      throw new NormalizationError();
    }
    if (Object.getOwnPropertySymbols(value).length > 0) throw new NormalizationError();
    const keys = Object.getOwnPropertyNames(value);
    if (keys.length > 1 || (keys.length === 1 && keys[0] !== "requireApprovalForCatalogFixture")) {
      throw new NormalizationError();
    }
    if (keys.length === 0) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, "requireApprovalForCatalogFixture");
    if (descriptor === undefined || !("value" in descriptor) || typeof descriptor.value !== "boolean") {
      throw new NormalizationError();
    }
    return descriptor.value;
  } catch {
    throw new PolicyDecisionValidationError();
  }
}

function isIntentActive(intent: ActionIntent, evaluatedAtMs: number): boolean {
  const requestedAt = parseTimestamp(intent.requested_at).milliseconds;
  const expiresAt = parseTimestamp(intent.expires_at).milliseconds;
  return evaluatedAtMs >= requestedAt && evaluatedAtMs <= expiresAt;
}

function exactRecord(value: unknown, expectedKeys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new NormalizationError();
  }
  if (Object.getOwnPropertySymbols(value).length > 0) throw new NormalizationError();
  const actual = Object.getOwnPropertyNames(value).sort();
  const expected = [...expectedKeys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new NormalizationError();
  }
  for (const key of expected) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor)) throw new NormalizationError();
  }
  return value as Record<string, unknown>;
}

function readValue(record: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor === undefined || !("value" in descriptor)) throw new NormalizationError();
  return descriptor.value;
}

function requireExactString(value: unknown, expected: string): "2.0.0" {
  if (value !== expected) throw new NormalizationError();
  return expected as "2.0.0";
}

function boundedString(value: unknown, minimum: number, maximum: number): string {
  if (typeof value !== "string" || value.length < minimum || value.length > maximum) throw new NormalizationError();
  return value;
}

function enumValue<const Values extends readonly string[]>(value: unknown, values: Values): Values[number] {
  if (typeof value !== "string" || !values.includes(value)) throw new NormalizationError();
  return value as Values[number];
}

function boundedStrings(value: unknown, minimumItems: number, maximumItems: number, minimumLength: number, maximumLength: number): string[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) throw new NormalizationError();
  const names = Object.getOwnPropertyNames(value).sort();
  const expectedNames = ["length", ...Array.from({ length: value.length }, (_, index) => String(index))].sort();
  if (names.length !== expectedNames.length || names.some((name, index) => name !== expectedNames[index])) {
    throw new NormalizationError();
  }
  if (value.length < minimumItems || value.length > maximumItems) throw new NormalizationError();
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !("value" in descriptor)) throw new NormalizationError();
    const entry = boundedString(descriptor.value, minimumLength, maximumLength);
    if (seen.has(entry)) throw new NormalizationError();
    seen.add(entry);
    normalized.push(entry);
  }
  return Object.freeze(normalized) as string[];
}

function parseCanonicalJson(value: unknown, minimum: number, maximum: number): string {
  const input = boundedString(value, minimum, maximum);
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    throw new NormalizationError();
  }
  assertJsonValue(parsed);
  const canonical = canonicalJson(parsed);
  if (canonical.length < minimum || canonical.length > maximum) throw new NormalizationError();
  return canonical;
}

function assertJsonValue(value: unknown): void {
  if (value === null || typeof value === "boolean" || typeof value === "string") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new NormalizationError();
    return;
  }
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype || Object.getOwnPropertySymbols(value).length > 0) {
      throw new NormalizationError();
    }
    const names = Object.getOwnPropertyNames(value).sort();
    const expectedNames = ["length", ...Array.from({ length: value.length }, (_, index) => String(index))].sort();
    if (names.length !== expectedNames.length || names.some((name, index) => name !== expectedNames[index])) {
      throw new NormalizationError();
    }
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (descriptor === undefined || !("value" in descriptor)) throw new NormalizationError();
      assertJsonValue(descriptor.value);
    }
    return;
  }
  if (typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length > 0) {
    throw new NormalizationError();
  }
  for (const key of Object.getOwnPropertyNames(value)) {
    if (key === "__proto__" || key === "prototype" || key === "constructor") throw new NormalizationError();
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor)) throw new NormalizationError();
    assertJsonValue(descriptor.value);
  }
}

function parseTimestamp(value: unknown): ParsedTimestamp {
  if (typeof value !== "string") throw new NormalizationError();
  const match = RFC3339_PATTERN.exec(value);
  if (match === null) throw new NormalizationError();
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , timezone] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (
    year < 1
    || month < 1
    || month > 12
    || day < 1
    || day > daysInMonth(year, month)
    || hour > 23
    || minute > 59
    || second > 59
  ) {
    throw new NormalizationError();
  }
  if (timezone === undefined) throw new NormalizationError();
  if (timezone !== "Z") {
    const offsetHour = Number(timezone.slice(1, 3));
    const offsetMinute = Number(timezone.slice(4, 6));
    if (offsetHour > 23 || offsetMinute > 59) throw new NormalizationError();
  }
  const milliseconds = Date.parse(value);
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) throw new NormalizationError();
  return Object.freeze({ iso: timestampFromMilliseconds(milliseconds), milliseconds });
}

function parseSafeMilliseconds(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new ActionIntentWindowError();
  try {
    timestampFromMilliseconds(value);
    return value;
  } catch {
    throw new ActionIntentWindowError();
  }
}

function timestampFromMilliseconds(milliseconds: number): string {
  const date = new Date(milliseconds);
  const iso = date.toISOString();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(iso)) throw new NormalizationError();
  return iso;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}
