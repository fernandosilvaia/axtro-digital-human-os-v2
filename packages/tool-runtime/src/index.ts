import { createHash } from "node:crypto";

import {
  assertAuthorizedTenantMatch,
  getAuthorizedTenantContext,
  type AuthorizedRequestContext,
} from "@axtro/auth";
import type {
  ActionIntent,
  CatalogLookupCommand,
  PolicyDecision,
  ToolExecutionReceipt,
} from "@axtro/contracts-ts";
import {
  canonicalJson,
  parseActorId,
  parseSessionId,
  parseTenantId,
  parseUuidV7,
  sha256Canonical,
  type ActorId,
  type SessionId,
  type TenantContext,
  type TenantId,
  type UuidV7,
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
  /** Trusted per-tenant bound for retained idempotency and unknown-effect entries. */
  readonly max_ledger_entries_per_tenant?: number;
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

/** Server-owned binding between an authorized Presenter and one session. */
export interface CatalogLookupSessionAuthority {
  readonly tenant_id: string;
  readonly session_id: string;
  readonly presenter_actor_id: string;
}

/**
 * Trusted composition inputs for the M1 coordinator. None are accepted from
 * the catalog command, model output, or a provider result.
 */
export interface DeterministicCatalogLookupCommandFlowOptions {
  readonly clock: ActionRuntimeClock;
  readonly sessions: readonly CatalogLookupSessionAuthority[];
  readonly policy_fixture_mode?: "default" | "require_approval";
  readonly fake_execution_mode?: "default" | "timeout_once";
  readonly max_ledger_entries_per_tenant?: number;
}

/** Candidate for a later conversation boundary. It does not publish speech or timeline state. */
export interface ReceiptBackedCatalogAnswer {
  readonly tenant_id: string;
  readonly question_id: string;
  readonly session_id: string;
  readonly confirmed: boolean;
  readonly response_text: string;
  readonly receipt: Readonly<{
    execution_id: string;
    effect_hash: string | null;
    error_code: string | null;
    catalog_version: string | null;
    plan_id: "starter" | "growth" | null;
    status: ToolExecutionReceipt["status"];
  }>;
}

/** Result of the internal fake reconciliation after an unknown receipt. */
export interface CatalogLookupReconciliation {
  readonly reconciliation_id: string;
  readonly question_id: string;
  readonly session_id: string;
  readonly receipt_execution_id: string;
  readonly status: "not_applied";
}

export interface DeterministicCatalogLookupCommandFlow {
  /** Parses a structured command, derives an ActionIntent, and returns a receipt-backed candidate. */
  submitCatalogLookup(request: AuthorizedRequestContext, command: unknown): Promise<ReceiptBackedCatalogAnswer>;
  /** Clears only the authenticated command's exact fake unknown-effect barrier. */
  reconcileUnknownCatalogLookup(request: AuthorizedRequestContext, command: unknown): Promise<CatalogLookupReconciliation>;
  /** Local fake inspection seam. It reveals no adapter, provider, arguments, or execution authority. */
  readFakeCatalogInvocationCount(request: AuthorizedRequestContext): number;
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

export class ActionRuntimeLedgerCapacityError extends Error {
  constructor() {
    super("Action Runtime ledger capacity is exhausted");
    this.name = "ActionRuntimeLedgerCapacityError";
  }
}

export class CatalogLookupCommandValidationError extends Error {
  constructor() {
    super("Catalog lookup command is invalid");
    this.name = "CatalogLookupCommandValidationError";
  }
}

export class CatalogLookupCommandConflictError extends Error {
  constructor() {
    super("Catalog lookup question conflicts with a prior command");
    this.name = "CatalogLookupCommandConflictError";
  }
}

interface ExecutionLedgerEntry {
  readonly fingerprint: string;
  readonly promise: Promise<ActionRuntimeResult>;
}

type PrivateFixtureExecutionMode = "default" | "timeout_once";

interface DeterministicActionRuntimeCore extends DeterministicActionRuntime {
  /** Module-private only. A coordinator may reconcile the exact runtime barrier it created. */
  reconcilePrivateUnknown(request: AuthorizedRequestContext, intent: ActionIntent): ToolExecutionReceipt;
}

interface CatalogLookupSessionBinding {
  readonly tenantId: TenantId;
  readonly sessionId: SessionId;
  readonly presenterActorId: ActorId;
}

interface CatalogLookupExecution {
  readonly command: CatalogLookupCommand;
  readonly actionIntent: ActionIntent;
  readonly actionResult: ActionRuntimeResult;
  readonly answer: ReceiptBackedCatalogAnswer;
}

interface CatalogLookupLedgerEntry {
  readonly fingerprint: string;
  readonly operationKey: string;
  readonly promise: Promise<CatalogLookupExecution>;
}

interface CatalogUnknownBarrier {
  readonly questionKey: string;
  readonly fingerprint: string;
  readonly tenantId: TenantId;
  readonly sessionId: SessionId;
  readonly actorId: ActorId;
  readonly actionIntent: ActionIntent;
  readonly receipt: ToolExecutionReceipt;
}

interface NormalizedCatalogLookupFlowOptions {
  readonly clock: ActionRuntimeClock;
  readonly policyFixtureMode: "default" | "require_approval";
  readonly fakeExecutionMode: "default" | "timeout_once";
  readonly maxLedgerEntriesPerTenant: number;
  readonly sessions: ReadonlyMap<SessionId, CatalogLookupSessionBinding>;
}

interface PrivateFixtureOutcome {
  readonly status: "succeeded" | "unknown";
  readonly result: Readonly<Record<string, string>> | null;
}

const RUNTIME_OPTION_KEYS = ["clock", "max_ledger_entries_per_tenant", "policy_fixture_mode"] as const;
const CATALOG_FLOW_OPTION_KEYS = [
  "clock",
  "fake_execution_mode",
  "max_ledger_entries_per_tenant",
  "policy_fixture_mode",
  "sessions",
] as const;
const CATALOG_COMMAND_KEYS = ["plan_id", "question_id", "schema_version", "session_id"] as const;
const CATALOG_COMMAND_PLAN_IDS = ["starter", "growth"] as const;
const CATALOG_COMMAND_TTL_MS = 5 * 60 * 1_000;
const DEFAULT_LEDGER_ENTRIES_PER_TENANT = 128;
const MAX_LEDGER_ENTRIES_PER_TENANT = 4_096;
const MAX_CATALOG_SESSION_AUTHORITIES = 256;
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
  const core = createDeterministicActionRuntimeCore(optionsInput, "default");
  return Object.freeze({
    submitActionIntent: core.submitActionIntent,
    readM0FixtureInvocationCount: core.readM0FixtureInvocationCount,
  });
}

function createDeterministicActionRuntimeCore(
  optionsInput: unknown,
  fixtureExecutionMode: PrivateFixtureExecutionMode,
): DeterministicActionRuntimeCore {
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
  const ledgerEntryCounts = new Map<TenantId, number>();
  const timeoutUnknownDispatchedTenants = new Set<TenantId>();

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

    assertLedgerCapacity(ledgerEntryCounts, context.tenantId, options.maxLedgerEntriesPerTenant);

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
    incrementLedgerCount(ledgerEntryCounts, context.tenantId);
    void promise.then(
      () => {
        if (operationsInFlight.get(operationKey) === entry) operationsInFlight.delete(operationKey);
      },
      () => {
        if (executions.get(idempotencyKey) === entry) executions.delete(idempotencyKey);
        if (executionsByIntent.get(intentKey) === entry) executionsByIntent.delete(intentKey);
        if (operationsInFlight.get(operationKey) === entry) operationsInFlight.delete(operationKey);
        decrementLedgerCount(ledgerEntryCounts, context.tenantId);
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
    const tenantId = parseTenantId(intent.tenant_id);
    const forceTimeoutUnknown = fixtureExecutionMode === "timeout_once" && !timeoutUnknownDispatchedTenants.has(tenantId);
    if (forceTimeoutUnknown) {
      if (timeoutUnknownDispatchedTenants.size >= MAX_LEDGER_ENTRIES_PER_TENANT) {
        throw new ActionRuntimeLedgerCapacityError();
      }
      timeoutUnknownDispatchedTenants.add(tenantId);
    }
    const outcome = executePrivateReadOnlyCatalogFixture(operation, forceTimeoutUnknown);
    if (outcome.status === "unknown") {
      const receipt = createReceipt({
        intent,
        status: "unknown",
        providerId: M0_RUNTIME_CATALOG_PROVIDER_ID,
        resultJson: null,
        error: forceTimeoutUnknown
          ? normalizedError("timeout", "Execution outcome requires reconciliation after timeout", false, "m1_timeout_once")
          : normalizedError("unknown_effect", "Execution effect requires reconciliation", false, "m0_unknown_fixture"),
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
    reconcilePrivateUnknown(request: AuthorizedRequestContext, intentInput: ActionIntent): ToolExecutionReceipt {
      const intent = parseActionIntent(intentInput);
      const context = requireAuthorizedToolContext(request, intent);
      const operationKey = canonicalOperationKey(intent);
      const receipt = unknownOperations.get(operationKey);
      if (
        receipt === undefined
        || receipt.intent_id !== intent.intent_id
        || receipt.tenant_id !== context.tenantId
        || receipt.status !== "unknown"
      ) {
        throw new ActionRuntimeUnknownEffectError();
      }
      unknownOperations.delete(operationKey);
      return receipt;
    },
  });
}

/**
 * M1's server-owned command coordinator. It deliberately stays outside the
 * Turn Driver and exposes a receipt-backed response candidate only.
 */
export function createDeterministicCatalogLookupCommandFlow(
  optionsInput: unknown,
): DeterministicCatalogLookupCommandFlow {
  const options = normalizeCatalogLookupFlowOptions(optionsInput);
  const actionRuntime = createDeterministicActionRuntimeCore({
    clock: options.clock,
    policy_fixture_mode: options.policyFixtureMode,
    max_ledger_entries_per_tenant: options.maxLedgerEntriesPerTenant,
  }, options.fakeExecutionMode);
  const commandsByQuestion = new Map<string, CatalogLookupLedgerEntry>();
  const operationsInFlight = new Map<string, CatalogLookupLedgerEntry>();
  const unknownOperations = new Map<string, CatalogUnknownBarrier>();
  const ledgerEntryCounts = new Map<TenantId, number>();

  async function submitCatalogLookup(
    request: AuthorizedRequestContext,
    commandInput: unknown,
  ): Promise<ReceiptBackedCatalogAnswer> {
    const command = parseCatalogLookupCommand(commandInput);
    const context = requireCatalogCommandContext(request);
    const session = requireCatalogSessionAuthority(options.sessions, command.session_id, context);
    const questionId = parseUuidV7(command.question_id, "question_id");
    const questionKey = tenantQuestionKey(context.tenantId, questionId);
    const fingerprint = catalogCommandFingerprint(command, context);
    const existing = commandsByQuestion.get(questionKey);
    if (existing !== undefined) {
      if (existing.fingerprint !== fingerprint) throw new CatalogLookupCommandConflictError();
      return (await existing.promise).answer;
    }

    const operationKey = catalogOperationKey(context.tenantId, command.plan_id);
    if (unknownOperations.has(operationKey)) throw new ActionRuntimeUnknownEffectError();
    if (operationsInFlight.has(operationKey)) throw new ActionRuntimeOperationInProgressError();
    assertLedgerCapacity(ledgerEntryCounts, context.tenantId, options.maxLedgerEntriesPerTenant);

    const now = options.clock.now();
    const actionIntent = deriveCatalogLookupIntent(
      command,
      context,
      now,
      command.plan_id,
    );
    const promise = Promise.resolve().then(async () => {
      const actionResult = await actionRuntime.submitActionIntent(request, actionIntent);
      const answer = createReceiptBackedCatalogAnswer(command, context, actionIntent, actionResult);
      if (actionResult.tool_execution_receipt.status === "unknown") {
        const barrier: CatalogUnknownBarrier = Object.freeze({
          questionKey,
          fingerprint,
          tenantId: context.tenantId,
          sessionId: session.sessionId,
          actorId: context.actorId,
          actionIntent,
          receipt: actionResult.tool_execution_receipt,
        });
        unknownOperations.set(operationKey, barrier);
      }
      return Object.freeze({ command, actionIntent, actionResult, answer });
    });
    const entry: CatalogLookupLedgerEntry = Object.freeze({ fingerprint, operationKey, promise });
    commandsByQuestion.set(questionKey, entry);
    operationsInFlight.set(operationKey, entry);
    incrementLedgerCount(ledgerEntryCounts, context.tenantId);
    void promise.then(
      () => {
        if (operationsInFlight.get(operationKey) === entry) operationsInFlight.delete(operationKey);
      },
      () => {
        if (commandsByQuestion.get(questionKey) === entry) {
          commandsByQuestion.delete(questionKey);
          decrementLedgerCount(ledgerEntryCounts, context.tenantId);
        }
        if (operationsInFlight.get(operationKey) === entry) operationsInFlight.delete(operationKey);
      },
    );
    return (await promise).answer;
  }

  async function reconcileUnknownCatalogLookup(
    request: AuthorizedRequestContext,
    commandInput: unknown,
  ): Promise<CatalogLookupReconciliation> {
    const command = parseCatalogLookupCommand(commandInput);
    const context = requireCatalogCommandContext(request);
    const session = requireCatalogSessionAuthority(options.sessions, command.session_id, context);
    const questionId = parseUuidV7(command.question_id, "question_id");
    const questionKey = tenantQuestionKey(context.tenantId, questionId);
    const fingerprint = catalogCommandFingerprint(command, context);
    const entry = commandsByQuestion.get(questionKey);
    if (entry === undefined) throw new ActionRuntimeUnknownEffectError();
    if (entry.fingerprint !== fingerprint) throw new CatalogLookupCommandConflictError();

    const execution = await entry.promise;
    const barrier = unknownOperations.get(entry.operationKey);
    if (
      barrier === undefined
      || barrier.questionKey !== questionKey
      || barrier.fingerprint !== fingerprint
      || barrier.tenantId !== context.tenantId
      || barrier.sessionId !== session.sessionId
      || barrier.actorId !== context.actorId
      || barrier.actionIntent !== execution.actionIntent
      || barrier.receipt.intent_id !== execution.actionIntent.intent_id
      || barrier.receipt.tenant_id !== context.tenantId
      || barrier.receipt.status !== "unknown"
    ) {
      throw new ActionRuntimeUnknownEffectError();
    }

    const reconciledReceipt = actionRuntime.reconcilePrivateUnknown(request, execution.actionIntent);
    if (canonicalJson(reconciledReceipt) !== canonicalJson(barrier.receipt)) {
      throw new ActionRuntimeInvariantError();
    }
    unknownOperations.delete(entry.operationKey);
    return Object.freeze({
      reconciliation_id: deriveDeterministicActionUuid(barrier.receipt.execution_id, "catalog-reconcile"),
      question_id: command.question_id,
      session_id: command.session_id,
      receipt_execution_id: barrier.receipt.execution_id,
      status: "not_applied",
    });
  }

  return Object.freeze({
    submitCatalogLookup,
    reconcileUnknownCatalogLookup,
    readFakeCatalogInvocationCount(request: AuthorizedRequestContext): number {
      requireCatalogCommandContext(request);
      return actionRuntime.readM0FixtureInvocationCount(request);
    },
  });
}

/** Parse the generated M1 command at the untrusted application boundary. */
export function parseCatalogLookupCommand(value: unknown): CatalogLookupCommand {
  try {
    const record = exactRecord(value, CATALOG_COMMAND_KEYS);
    const questionId = parseUuidV7(readValue(record, "question_id"), "question_id");
    const sessionId = parseSessionId(readValue(record, "session_id"));
    const planId = enumValue(readValue(record, "plan_id"), CATALOG_COMMAND_PLAN_IDS);
    if (readValue(record, "schema_version") !== "2.0.0") throw new ReceiptNormalizationError();
    return Object.freeze({
      schema_version: "2.0.0",
      question_id: questionId,
      session_id: sessionId,
      plan_id: planId,
    });
  } catch {
    throw new CatalogLookupCommandValidationError();
  }
}

function requireCatalogCommandContext(request: AuthorizedRequestContext): TenantContext {
  const context = getAuthorizedTenantContext(request);
  if (
    context.actorType !== "presenter"
    || !context.grantedScopes.includes("session:read")
    || !context.grantedScopes.includes("session:write")
    || !context.grantedScopes.includes("tool:use")
    || !context.purposes.includes("essential_processing")
    || !context.purposes.includes("tool_auth")
  ) {
    throw new ActionRuntimeAuthorizationError();
  }
  return context;
}

function requireCatalogSessionAuthority(
  sessions: ReadonlyMap<SessionId, CatalogLookupSessionBinding>,
  sessionIdInput: unknown,
  context: TenantContext,
): CatalogLookupSessionBinding {
  const sessionId = parseSessionId(sessionIdInput);
  const session = sessions.get(sessionId);
  if (
    session === undefined
    || session.tenantId !== context.tenantId
    || session.presenterActorId !== context.actorId
  ) {
    throw new ActionRuntimeAuthorizationError();
  }
  return session;
}

function deriveCatalogLookupIntent(
  command: CatalogLookupCommand,
  context: TenantContext,
  now: number,
  planId: M0CatalogLookup["plan_id"],
): ActionIntent {
  const intentId = deriveDeterministicActionUuid(command.question_id, "catalog-command-intent");
  return parseActionIntent({
    schema_version: "2.0.0",
    intent_id: intentId,
    session_id: command.session_id,
    tenant_id: context.tenantId,
    actor_id: context.actorId,
    actor_type: context.actorType,
    tool_contract_id: "catalog.lookup",
    action: "get_plan",
    arguments_json: canonicalJson({ plan_id: planId }),
    purpose: "answer_explicit_catalog_question",
    idempotency_key: `catalog-question-${command.question_id}`,
    requested_at: timestampFromMilliseconds(now),
    expires_at: timestampFromMilliseconds(now + CATALOG_COMMAND_TTL_MS),
  });
}

function createReceiptBackedCatalogAnswer(
  command: CatalogLookupCommand,
  context: TenantContext,
  actionIntent: ActionIntent,
  actionResult: ActionRuntimeResult,
): ReceiptBackedCatalogAnswer {
  const receipt = actionResult.tool_execution_receipt;
  if (receipt.intent_id !== actionIntent.intent_id || receipt.tenant_id !== context.tenantId) {
    throw new ActionRuntimeInvariantError();
  }
  if (actionResult.effect_confirmed) {
    if (
      receipt.status !== "succeeded"
      || receipt.result_json === null
      || receipt.effect_hash === null
      || canonicalJson(actionResult.action_intent) !== canonicalJson(actionIntent)
    ) {
      throw new ActionRuntimeInvariantError();
    }
    const result = parseCatalogReceiptResult(receipt.result_json);
    if (
      result.planId !== command.plan_id
      || sha256Canonical(result.raw) !== receipt.effect_hash
      || canonicalJson(result.raw) !== receipt.result_json
    ) {
      throw new ActionRuntimeInvariantError();
    }
    const receiptSummary = Object.freeze({
      execution_id: receipt.execution_id,
      effect_hash: receipt.effect_hash,
      error_code: null,
      catalog_version: result.catalogVersion,
      plan_id: result.planId,
      status: receipt.status,
    });
    return Object.freeze({
      tenant_id: context.tenantId,
      question_id: command.question_id,
      session_id: command.session_id,
      confirmed: true,
      response_text: `Catalog receipt ${receipt.execution_id} confirms ${result.planId} is available in catalog ${result.catalogVersion} with effect ${receipt.effect_hash}.`,
      receipt: receiptSummary,
    });
  }

  return Object.freeze({
    tenant_id: context.tenantId,
    question_id: command.question_id,
    session_id: command.session_id,
    confirmed: false,
    response_text: `Catalog availability is not confirmed because receipt ${receipt.execution_id} is ${receipt.status}.`,
    receipt: Object.freeze({
      execution_id: receipt.execution_id,
      effect_hash: null,
      error_code: receipt.error?.code ?? null,
      catalog_version: null,
      plan_id: null,
      status: receipt.status,
    }),
  });
}

function parseCatalogReceiptResult(resultJson: string): Readonly<{
  raw: Readonly<Record<string, string>>;
  catalogVersion: string;
  planId: "starter" | "growth";
}> {
  try {
    const parsed = JSON.parse(resultJson);
    const record = exactRecord(parsed, ["catalog_version", "plan_id", "status"]);
    const catalogVersion = boundedString(readValue(record, "catalog_version"), 1, 80);
    const planId = enumValue(readValue(record, "plan_id"), CATALOG_COMMAND_PLAN_IDS);
    if (readValue(record, "status") !== "available") throw new ReceiptNormalizationError();
    return Object.freeze({
      raw: Object.freeze({ catalog_version: catalogVersion, plan_id: planId, status: "available" }),
      catalogVersion,
      planId,
    });
  } catch {
    throw new ActionRuntimeInvariantError();
  }
}

function catalogCommandFingerprint(command: CatalogLookupCommand, context: TenantContext): string {
  return sha256(canonicalJson({
    question_id: command.question_id,
    session_id: command.session_id,
    plan_id: command.plan_id,
    actor_id: context.actorId,
    actor_type: context.actorType,
  }));
}

function catalogOperationKey(tenantId: TenantId, planId: "starter" | "growth"): string {
  return sha256(canonicalJson({
    tenant_id: tenantId,
    tool_contract_id: "catalog.lookup",
    action: "get_plan",
    arguments_json: canonicalJson({ plan_id: planId }),
  }));
}

function tenantQuestionKey(tenantId: TenantId, questionId: UuidV7): string {
  return `${tenantId}\u0000${questionId}`;
}

function normalizeCatalogLookupFlowOptions(value: unknown): NormalizedCatalogLookupFlowOptions {
  try {
    const record = catalogFlowOptionsRecord(value);
    const runtimeInput: Record<string, unknown> = { clock: readValue(record, "clock") };
    const policyFixtureMode = Object.getOwnPropertyDescriptor(record, "policy_fixture_mode");
    const ledgerCapacity = Object.getOwnPropertyDescriptor(record, "max_ledger_entries_per_tenant");
    if (policyFixtureMode !== undefined) runtimeInput.policy_fixture_mode = policyFixtureMode.value;
    if (ledgerCapacity !== undefined) runtimeInput.max_ledger_entries_per_tenant = ledgerCapacity.value;
    const runtimeOptions = normalizeRuntimeOptions(runtimeInput);
    const fakeModeDescriptor = Object.getOwnPropertyDescriptor(record, "fake_execution_mode");
    const fakeExecutionMode = fakeModeDescriptor === undefined
      ? "default"
      : enumValue(fakeModeDescriptor.value, ["default", "timeout_once"] as const);
    if (fakeExecutionMode === "timeout_once" && runtimeOptions.policyFixtureMode !== "default") {
      throw new ActionRuntimeConfigurationError();
    }
    const sessions = normalizeCatalogSessionAuthorities(readValue(record, "sessions"));
    return Object.freeze({
      clock: runtimeOptions.clock,
      policyFixtureMode: runtimeOptions.policyFixtureMode,
      fakeExecutionMode,
      maxLedgerEntriesPerTenant: runtimeOptions.maxLedgerEntriesPerTenant,
      sessions,
    });
  } catch (error) {
    if (error instanceof ActionRuntimeConfigurationError) throw error;
    throw new ActionRuntimeConfigurationError();
  }
}

function catalogFlowOptionsRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new ReceiptNormalizationError();
  }
  if (Object.getOwnPropertySymbols(value).length > 0) throw new ReceiptNormalizationError();
  const keys = Object.getOwnPropertyNames(value).sort();
  if (
    keys.length < 2
    || keys.length > CATALOG_FLOW_OPTION_KEYS.length
    || !keys.includes("clock")
    || !keys.includes("sessions")
    || keys.some((key) => !(CATALOG_FLOW_OPTION_KEYS as readonly string[]).includes(key))
  ) {
    throw new ReceiptNormalizationError();
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor)) throw new ReceiptNormalizationError();
  }
  return value as Record<string, unknown>;
}

function normalizeCatalogSessionAuthorities(value: unknown): ReadonlyMap<SessionId, CatalogLookupSessionBinding> {
  const values = strictArray(value);
  if (values.length === 0 || values.length > MAX_CATALOG_SESSION_AUTHORITIES) {
    throw new ActionRuntimeConfigurationError();
  }
  const sessions = new Map<SessionId, CatalogLookupSessionBinding>();
  for (const raw of values) {
    try {
      const record = exactRecord(raw, ["presenter_actor_id", "session_id", "tenant_id"]);
      const binding: CatalogLookupSessionBinding = Object.freeze({
        tenantId: parseTenantId(readValue(record, "tenant_id")),
        sessionId: parseSessionId(readValue(record, "session_id")),
        presenterActorId: parseActorId(readValue(record, "presenter_actor_id")),
      });
      if (sessions.has(binding.sessionId)) throw new ReceiptNormalizationError();
      sessions.set(binding.sessionId, binding);
    } catch {
      throw new ActionRuntimeConfigurationError();
    }
  }
  return sessions;
}

function strictArray(value: unknown): readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || Object.getOwnPropertySymbols(value).length > 0) {
    throw new ReceiptNormalizationError();
  }
  const names = Object.getOwnPropertyNames(value).sort();
  const expectedNames = ["length", ...Array.from({ length: value.length }, (_, index) => String(index))].sort();
  if (names.length !== expectedNames.length || names.some((name, index) => name !== expectedNames[index])) {
    throw new ReceiptNormalizationError();
  }
  const normalized: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !("value" in descriptor)) throw new ReceiptNormalizationError();
    normalized.push(descriptor.value);
  }
  return Object.freeze(normalized);
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

function executePrivateReadOnlyCatalogFixture(
  operation: M0CatalogLookup,
  forceTimeoutUnknown = false,
): PrivateFixtureOutcome {
  if (forceTimeoutUnknown || operation.plan_id === "unknown_effect") {
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

function parseLedgerCapacity(value: unknown): number {
  if (
    typeof value !== "number"
    || !Number.isSafeInteger(value)
    || value < 1
    || value > MAX_LEDGER_ENTRIES_PER_TENANT
  ) {
    throw new ActionRuntimeConfigurationError();
  }
  return value;
}

function assertLedgerCapacity(counts: ReadonlyMap<TenantId, number>, tenantId: TenantId, maximum: number): void {
  if ((counts.get(tenantId) ?? 0) >= maximum) throw new ActionRuntimeLedgerCapacityError();
}

function incrementLedgerCount(counts: Map<TenantId, number>, tenantId: TenantId): void {
  counts.set(tenantId, (counts.get(tenantId) ?? 0) + 1);
}

function decrementLedgerCount(counts: Map<TenantId, number>, tenantId: TenantId): void {
  const current = counts.get(tenantId);
  if (current === undefined || current < 1) throw new ActionRuntimeInvariantError();
  if (current === 1) {
    counts.delete(tenantId);
    return;
  }
  counts.set(tenantId, current - 1);
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
  maxLedgerEntriesPerTenant: number;
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
    const capacityDescriptor = Object.getOwnPropertyDescriptor(record, "max_ledger_entries_per_tenant");
    const maxLedgerEntriesPerTenant = capacityDescriptor === undefined
      ? DEFAULT_LEDGER_ENTRIES_PER_TENANT
      : parseLedgerCapacity(capacityDescriptor.value);
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
      maxLedgerEntriesPerTenant,
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
