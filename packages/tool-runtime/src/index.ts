import { createHash } from "node:crypto";

import {
  assertAuthorizedTenantMatch,
  getAuthorizedTenantContext,
  type AuthorizedRequestContext,
} from "@axtro/auth";
import type { ActionIntent, PolicyDecision, ToolExecutionReceipt } from "@axtro/contracts-ts";
import {
  canonicalJson,
  parseTenantId,
  parseUuidV7,
  sha256Canonical,
  type TenantContext,
  type TenantId,
} from "@axtro/domain";
import {
  assertActionIntentActive,
  createDeterministicPolicyEngine,
  deriveDeterministicActionUuid,
  parseActionIntent,
  parsePolicyDecision,
  resolveM0ReadOnlyCatalogLookup,
  type M0CatalogLookup,
} from "@axtro/policy";

export const M0_RUNTIME_CATALOG_PROVIDER_ID = "m0-runtime-catalog-fixture" as const;

export interface ActionRuntimeClock {
  now(): number;
}

export interface DeterministicActionRuntimeOptions {
  /** Trusted composition clock. The M0 runtime never reads ambient wall-clock time. */
  readonly clock: ActionRuntimeClock;
  /** Closed composition profile used only to exercise a stricter approval branch. */
  readonly policy_fixture_mode?: "default" | "require_approval";
}

export interface ActionRuntimeResult {
  readonly action_intent: ActionIntent;
  readonly policy_decision: PolicyDecision;
  readonly tool_execution_receipt: ToolExecutionReceipt;
  /** Runtime-derived flag. It is true only for a validated succeeded receipt. */
  readonly effect_confirmed: boolean;
}

export interface DeterministicActionRuntime {
  /** The only public execution entry point accepts an authenticated request and ActionIntent. */
  submitActionIntent(request: AuthorizedRequestContext, intent: unknown): Promise<ActionRuntimeResult>;
  /** Local fake inspection seam. It exposes no adapter, arguments, receipt or provider authority. */
  readM0FixtureInvocationCount(request: AuthorizedRequestContext): number;
}

export class ActionRuntimeConfigurationError extends Error {
  constructor() {
    super("Action Runtime configuration is invalid");
    this.name = "ActionRuntimeConfigurationError";
  }
}

export class ActionRuntimeAuthorizationError extends Error {
  constructor() {
    super("Action Runtime execution is not authorized");
    this.name = "ActionRuntimeAuthorizationError";
  }
}

export class ActionRuntimeIdempotencyConflictError extends Error {
  constructor() {
    super("Action Runtime idempotency key conflicts with an existing execution");
    this.name = "ActionRuntimeIdempotencyConflictError";
  }
}

export class ActionRuntimeIntentConflictError extends Error {
  constructor() {
    super("Action Runtime intent conflicts with an existing execution");
    this.name = "ActionRuntimeIntentConflictError";
  }
}

export class ActionRuntimeOperationInProgressError extends Error {
  constructor() {
    super("Action Runtime operation is already in progress");
    this.name = "ActionRuntimeOperationInProgressError";
  }
}

export class ActionRuntimeUnknownEffectError extends Error {
  constructor() {
    super("Action Runtime requires reconciliation before retry");
    this.name = "ActionRuntimeUnknownEffectError";
  }
}

export class ActionRuntimeInvariantError extends Error {
  constructor() {
    super("Action Runtime invariant failed");
    this.name = "ActionRuntimeInvariantError";
  }
}

interface ExecutionLedgerEntry {
  readonly fingerprint: string;
  readonly promise: Promise<ActionRuntimeResult>;
}

interface PrivateFixtureOutcome {
  readonly status: "succeeded" | "unknown";
  readonly result: Readonly<Record<string, string>> | null;
}

const RUNTIME_OPTION_KEYS = ["clock", "policy_fixture_mode"] as const;
const RECEIPT_KEYS = [
  "schema_version",
  "execution_id",
  "intent_id",
  "tenant_id",
  "status",
  "provider_id",
  "attempt",
  "result_json",
  "error",
  "effect_hash",
  "started_at",
  "completed_at",
] as const;
const RECEIPT_STATUSES = ["started", "succeeded", "failed", "pending", "unknown", "cancelled"] as const;
const EFFECT_HASH_PATTERN = /^[0-9a-f]{64}$/;
const PROVIDER_ID_PATTERN = /^[a-z][a-z0-9_-]{0,119}$/;
const RFC3339_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * M0's governed execution skeleton. Its only tool is a private, read-only
 * fixture; no provider ToolPort or authorization factory is opened here.
 */
export function createDeterministicActionRuntime(optionsInput: unknown): DeterministicActionRuntime {
  const options = normalizeRuntimeOptions(optionsInput);
  const { clock } = options;
  const policy = createDeterministicPolicyEngine({
    requireApprovalForCatalogFixture: options.policyFixtureMode === "require_approval",
  });
  const executions = new Map<string, ExecutionLedgerEntry>();
  const executionsByIntent = new Map<string, ExecutionLedgerEntry>();
  const operationsInFlight = new Map<string, ExecutionLedgerEntry>();
  const unknownOperations = new Map<string, ToolExecutionReceipt>();
  const fixtureInvocationCounts = new Map<TenantId, number>();

  async function submitActionIntent(request: AuthorizedRequestContext, intentInput: unknown): Promise<ActionRuntimeResult> {
    const intent = parseActionIntent(intentInput);
    const context = requireAuthorizedToolContext(request, intent);

    const fingerprint = intentFingerprint(intent);
    const idempotencyKey = tenantIdempotencyKey(context.tenantId, intent.idempotency_key);
    const existing = executions.get(idempotencyKey);
    if (existing !== undefined) {
      if (existing.fingerprint !== fingerprint) throw new ActionRuntimeIdempotencyConflictError();
      return existing.promise;
    }

    const intentKey = tenantIntentKey(context.tenantId, intent.intent_id);
    const existingIntent = executionsByIntent.get(intentKey);
    if (existingIntent !== undefined) {
      if (existingIntent.fingerprint !== fingerprint) throw new ActionRuntimeIntentConflictError();
      return existingIntent.promise;
    }

    const now = clock.now();
    assertActionIntentActive(intent, now);

    const operationKey = canonicalOperationKey(intent);
    if (unknownOperations.has(operationKey)) throw new ActionRuntimeUnknownEffectError();
    if (operationsInFlight.has(operationKey)) throw new ActionRuntimeOperationInProgressError();

    const promise = Promise.resolve().then(() => {
      const decision = parsePolicyDecision(policy.evaluate({
        intent,
        authorized_tenant_id: context.tenantId,
        authorized_actor_id: context.actorId,
        authorized_actor_type: context.actorType,
        evaluated_at_ms: now,
      }));
      assertDecisionMatchesIntent(decision, intent);
      return executeGovernedDecision(intent, decision, now, operationKey);
    });
    const entry: ExecutionLedgerEntry = Object.freeze({ fingerprint, promise });
    executions.set(idempotencyKey, entry);
    executionsByIntent.set(intentKey, entry);
    operationsInFlight.set(operationKey, entry);
    void promise.then(
      () => {
        if (operationsInFlight.get(operationKey) === entry) operationsInFlight.delete(operationKey);
      },
      () => {
        if (executions.get(idempotencyKey) === entry) executions.delete(idempotencyKey);
        if (executionsByIntent.get(intentKey) === entry) executionsByIntent.delete(intentKey);
        if (operationsInFlight.get(operationKey) === entry) operationsInFlight.delete(operationKey);
      },
    );
    return promise;
  }

  function executeGovernedDecision(
    intent: ActionIntent,
    decision: PolicyDecision,
    now: number,
    operationKey: string,
  ): ActionRuntimeResult {
    const startedAt = timestampFromMilliseconds(now);
    if (decision.outcome === "deny") {
      return createRuntimeResult(intent, decision, createReceipt({
        intent,
        status: "failed",
        providerId: "m0-runtime-policy",
        resultJson: null,
        error: normalizedError("policy_denied", "Action is denied by policy", false, null),
        effectHash: null,
        startedAt,
        completedAt: startedAt,
      }));
    }
    if (decision.outcome === "require_approval") {
      return createRuntimeResult(intent, decision, createReceipt({
        intent,
        status: "pending",
        providerId: "m0-runtime-policy",
        resultJson: null,
        error: normalizedError("approval_required", "Action requires approval", false, null),
        effectHash: null,
        startedAt,
        completedAt: null,
      }));
    }

    const operation = resolveM0ReadOnlyCatalogLookup(intent);
    if (operation === null) throw new ActionRuntimeInvariantError();
    incrementFixtureInvocation(fixtureInvocationCounts, parseTenantId(intent.tenant_id));
    const outcome = executePrivateReadOnlyCatalogFixture(operation);
    if (outcome.status === "unknown") {
      const receipt = createReceipt({
        intent,
        status: "unknown",
        providerId: M0_RUNTIME_CATALOG_PROVIDER_ID,
        resultJson: null,
        error: normalizedError("unknown_effect", "Execution effect requires reconciliation", false, "m0_unknown_fixture"),
        effectHash: null,
        startedAt,
        completedAt: startedAt,
      });
      unknownOperations.set(operationKey, receipt);
      return createRuntimeResult(intent, decision, receipt);
    }

    const resultJson = canonicalJson(outcome.result);
    return createRuntimeResult(intent, decision, createReceipt({
      intent,
      status: "succeeded",
      providerId: M0_RUNTIME_CATALOG_PROVIDER_ID,
      resultJson,
      error: null,
      effectHash: sha256Canonical(outcome.result),
      startedAt,
      completedAt: startedAt,
    }));
  }

  return Object.freeze({
    submitActionIntent,
    readM0FixtureInvocationCount(request: AuthorizedRequestContext): number {
      const context = requireFixtureInspectionContext(request);
      return fixtureInvocationCounts.get(context.tenantId) ?? 0;
    },
  });
}

function requireAuthorizedToolContext(request: AuthorizedRequestContext, intent: ActionIntent): TenantContext {
  const context = requireFixtureInspectionContext(request);
  try {
    assertAuthorizedTenantMatch(request, intent.tenant_id);
  } catch {
    throw new ActionRuntimeAuthorizationError();
  }
  if (intent.actor_id !== context.actorId || intent.actor_type !== context.actorType) {
    throw new ActionRuntimeAuthorizationError();
  }
  return context;
}

function requireFixtureInspectionContext(request: AuthorizedRequestContext): TenantContext {
  const context = getAuthorizedTenantContext(request);
  if (!context.grantedScopes.includes("tool:use") || !context.purposes.includes("tool_auth")) {
    throw new ActionRuntimeAuthorizationError();
  }
  return context;
}

function executePrivateReadOnlyCatalogFixture(operation: M0CatalogLookup): PrivateFixtureOutcome {
  if (operation.plan_id === "unknown_effect") {
    return Object.freeze({ status: "unknown", result: null });
  }
  return Object.freeze({
    status: "succeeded",
    result: Object.freeze({
      catalog_version: "m0",
      plan_id: operation.plan_id,
      status: "available",
    }),
  });
}

function incrementFixtureInvocation(counts: Map<TenantId, number>, tenantId: TenantId): void {
  counts.set(tenantId, (counts.get(tenantId) ?? 0) + 1);
}

function createRuntimeResult(
  intent: ActionIntent,
  decision: PolicyDecision,
  receipt: ToolExecutionReceipt,
): ActionRuntimeResult {
  const normalizedReceipt = parseRuntimeReceipt(receipt);
  const effectConfirmed = normalizedReceipt.status === "succeeded";
  if (effectConfirmed !== (normalizedReceipt.effect_hash !== null && normalizedReceipt.result_json !== null)) {
    throw new ActionRuntimeInvariantError();
  }
  return Object.freeze({
    action_intent: intent,
    policy_decision: decision,
    tool_execution_receipt: normalizedReceipt,
    effect_confirmed: effectConfirmed,
  });
}

function createReceipt(input: {
  readonly intent: ActionIntent;
  readonly status: ToolExecutionReceipt["status"];
  readonly providerId: string;
  readonly resultJson: string | null;
  readonly error: ToolExecutionReceipt["error"];
  readonly effectHash: string | null;
  readonly startedAt: string;
  readonly completedAt: string | null;
}): ToolExecutionReceipt {
  return parseRuntimeReceipt({
    schema_version: "2.0.0",
    execution_id: deriveDeterministicActionUuid(input.intent.intent_id, "tool-execution"),
    intent_id: input.intent.intent_id,
    tenant_id: input.intent.tenant_id,
    status: input.status,
    provider_id: input.providerId,
    attempt: 1,
    result_json: input.resultJson,
    error: input.error,
    effect_hash: input.effectHash,
    started_at: input.startedAt,
    completed_at: input.completedAt,
  });
}

function parseRuntimeReceipt(value: unknown): ToolExecutionReceipt {
  try {
    const record = exactRecord(value, RECEIPT_KEYS);
    const status = enumValue(readValue(record, "status"), RECEIPT_STATUSES);
    const startedAt = parseUtcTimestamp(readValue(record, "started_at"));
    const completedAtValue = readValue(record, "completed_at");
    const completedAt = completedAtValue === null ? null : parseUtcTimestamp(completedAtValue);
    if (completedAt !== null && completedAt.milliseconds < startedAt.milliseconds) throw new ReceiptNormalizationError();
    const resultJson = parseReceiptJson(readValue(record, "result_json"));
    const error = parseReceiptError(readValue(record, "error"));
    const effectHash = parseEffectHash(readValue(record, "effect_hash"));
    assertReceiptSemantics(status, resultJson, error, effectHash, completedAt);
    const receipt: ToolExecutionReceipt = {
      schema_version: exactVersion(readValue(record, "schema_version")),
      execution_id: parseUuidV7(readValue(record, "execution_id"), "execution_id"),
      intent_id: parseUuidV7(readValue(record, "intent_id"), "intent_id"),
      tenant_id: parseTenantId(readValue(record, "tenant_id")),
      status,
      provider_id: providerId(readValue(record, "provider_id")),
      attempt: positiveAttempt(readValue(record, "attempt")),
      result_json: resultJson,
      error,
      effect_hash: effectHash,
      started_at: startedAt.iso,
      completed_at: completedAt?.iso ?? null,
    };
    return Object.freeze(receipt);
  } catch {
    throw new ActionRuntimeInvariantError();
  }
}

function assertDecisionMatchesIntent(decision: PolicyDecision, intent: ActionIntent): void {
  if (decision.intent_id !== intent.intent_id || decision.tenant_id !== intent.tenant_id) {
    throw new ActionRuntimeInvariantError();
  }
}

function intentFingerprint(intent: ActionIntent): string {
  return sha256(canonicalJson(intent));
}

function canonicalOperationKey(intent: ActionIntent): string {
  return sha256(canonicalJson({
    tenant_id: intent.tenant_id,
    tool_contract_id: intent.tool_contract_id,
    action: intent.action,
    arguments_json: intent.arguments_json,
  }));
}

function tenantIdempotencyKey(tenantId: TenantId, idempotencyKey: string): string {
  return `${tenantId}\u0000${idempotencyKey}`;
}

function tenantIntentKey(tenantId: TenantId, intentId: string): string {
  return `${tenantId}\u0000${intentId}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function normalizeRuntimeOptions(value: unknown): Readonly<{
  clock: ActionRuntimeClock;
  policyFixtureMode: "default" | "require_approval";
}> {
  try {
    const record = runtimeOptionsRecord(value);
    const clock = readValue(record, "clock");
    if (clock === null || typeof clock !== "object" || Object.getPrototypeOf(clock) !== Object.prototype) {
      throw new ReceiptNormalizationError();
    }
    const clockRecord = exactRecord(clock, ["now"]);
    const nowDescriptor = Object.getOwnPropertyDescriptor(clockRecord, "now");
    if (nowDescriptor === undefined || !("value" in nowDescriptor) || typeof nowDescriptor.value !== "function") {
      throw new ReceiptNormalizationError();
    }
    const now = nowDescriptor.value as () => unknown;
    const fixtureModeDescriptor = Object.getOwnPropertyDescriptor(record, "policy_fixture_mode");
    const policyFixtureMode = fixtureModeDescriptor === undefined
      ? "default"
      : enumValue(fixtureModeDescriptor.value, ["default", "require_approval"] as const);
    return Object.freeze({
      clock: Object.freeze({
        now(): number {
          const valueFromClock = now();
          if (typeof valueFromClock !== "number" || !Number.isSafeInteger(valueFromClock) || valueFromClock < 0) {
            throw new ActionRuntimeConfigurationError();
          }
          timestampFromMilliseconds(valueFromClock);
          return valueFromClock;
        },
      }),
      policyFixtureMode,
    });
  } catch (error) {
    if (error instanceof ActionRuntimeConfigurationError) throw error;
    throw new ActionRuntimeConfigurationError();
  }
}

function runtimeOptionsRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new ReceiptNormalizationError();
  }
  if (Object.getOwnPropertySymbols(value).length > 0) throw new ReceiptNormalizationError();
  const keys = Object.getOwnPropertyNames(value).sort();
  if (
    keys.length < 1
    || keys.length > RUNTIME_OPTION_KEYS.length
    || !keys.includes("clock")
    || keys.some((key) => !(RUNTIME_OPTION_KEYS as readonly string[]).includes(key))
  ) {
    throw new ReceiptNormalizationError();
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor)) throw new ReceiptNormalizationError();
  }
  return value as Record<string, unknown>;
}

function normalizedError(
  code: string,
  message: string,
  retryable: boolean,
  providerCode: string | null,
): NonNullable<ToolExecutionReceipt["error"]> {
  return Object.freeze({ code, message, retryable, provider_code: providerCode });
}

function exactRecord(value: unknown, expectedKeys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new ReceiptNormalizationError();
  }
  if (Object.getOwnPropertySymbols(value).length > 0) throw new ReceiptNormalizationError();
  const actual = Object.getOwnPropertyNames(value).sort();
  const expected = [...expectedKeys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new ReceiptNormalizationError();
  }
  for (const key of expected) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor)) throw new ReceiptNormalizationError();
  }
  return value as Record<string, unknown>;
}

function readValue(record: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor === undefined || !("value" in descriptor)) throw new ReceiptNormalizationError();
  return descriptor.value;
}

function enumValue<const Values extends readonly string[]>(value: unknown, values: Values): Values[number] {
  if (typeof value !== "string" || !values.includes(value)) throw new ReceiptNormalizationError();
  return value as Values[number];
}

function exactVersion(value: unknown): "2.0.0" {
  if (value !== "2.0.0") throw new ReceiptNormalizationError();
  return value;
}

function providerId(value: unknown): string {
  if (typeof value !== "string" || !PROVIDER_ID_PATTERN.test(value)) throw new ReceiptNormalizationError();
  return value;
}

function positiveAttempt(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 100) {
    throw new ReceiptNormalizationError();
  }
  return value;
}

function parseReceiptJson(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || value.length > 200_000) throw new ReceiptNormalizationError();
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new ReceiptNormalizationError();
  }
  const canonical = canonicalJson(parsed);
  if (canonical !== value) throw new ReceiptNormalizationError();
  return canonical;
}

function parseReceiptError(value: unknown): ToolExecutionReceipt["error"] {
  if (value === null) return null;
  const record = exactRecord(value, ["code", "message", "retryable", "provider_code"]);
  const code = boundedString(readValue(record, "code"), 1, 120);
  const message = boundedString(readValue(record, "message"), 1, 1_000);
  const retryable = readValue(record, "retryable");
  const providerCode = readValue(record, "provider_code");
  if (typeof retryable !== "boolean" || (providerCode !== null && typeof providerCode !== "string") || (typeof providerCode === "string" && providerCode.length > 200)) {
    throw new ReceiptNormalizationError();
  }
  return Object.freeze({ code, message, retryable, provider_code: providerCode });
}

function parseEffectHash(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !EFFECT_HASH_PATTERN.test(value)) throw new ReceiptNormalizationError();
  return value;
}

function assertReceiptSemantics(
  status: ToolExecutionReceipt["status"],
  resultJson: string | null,
  error: ToolExecutionReceipt["error"],
  effectHash: string | null,
  completedAt: ParsedTimestamp | null,
): void {
  if (status === "succeeded") {
    if (resultJson === null || error !== null || effectHash === null || completedAt === null) throw new ReceiptNormalizationError();
    return;
  }
  if (effectHash !== null) throw new ReceiptNormalizationError();
  if (status === "unknown" && resultJson !== null) throw new ReceiptNormalizationError();
  if (status === "pending" && completedAt !== null) throw new ReceiptNormalizationError();
  if ((status === "failed" || status === "unknown" || status === "cancelled") && (error === null || completedAt === null)) {
    throw new ReceiptNormalizationError();
  }
}

interface ParsedTimestamp {
  readonly iso: string;
  readonly milliseconds: number;
}

class ReceiptNormalizationError extends Error {}

function parseUtcTimestamp(value: unknown): ParsedTimestamp {
  if (typeof value !== "string" || !RFC3339_UTC_PATTERN.test(value)) throw new ReceiptNormalizationError();
  const milliseconds = Date.parse(value);
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) throw new ReceiptNormalizationError();
  if (timestampFromMilliseconds(milliseconds) !== value) throw new ReceiptNormalizationError();
  return Object.freeze({ iso: value, milliseconds });
}

function timestampFromMilliseconds(milliseconds: number): string {
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) throw new ActionRuntimeConfigurationError();
  const iso = new Date(milliseconds).toISOString();
  if (!RFC3339_UTC_PATTERN.test(iso)) throw new ActionRuntimeConfigurationError();
  return iso;
}

function boundedString(value: unknown, minimum: number, maximum: number): string {
  if (typeof value !== "string" || value.length < minimum || value.length > maximum) throw new ReceiptNormalizationError();
  return value;
}
