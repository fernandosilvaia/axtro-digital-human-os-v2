import { getAuthorizedTenantContext, type AuthorizedRequestContext } from "@axtro/auth";
import type { ActionIntent, PolicyDecision, ToolExecutionReceipt } from "@axtro/contracts-ts";
import {
  CostLedgerAuthorizationError,
  type CostLedgerAggregation,
  type DeterministicCostLedger,
} from "@axtro/costing";
import {
  canonicalJson,
  interactionStateHash,
  parseSessionId,
  parseTenantId,
  parseUuidV7,
  replayInteraction,
  sha256Canonical,
  type SessionId,
  type TenantId,
} from "@axtro/domain";
import {
  decodeInteractionEvent,
  SessionTimelineAuthorizationError,
  type SessionTimelineRepository,
} from "@axtro/events";
import { parseActionIntent, parsePolicyDecision } from "@axtro/policy";
import {
  SessionLifecycleAuthorizationError,
  SessionLifecycleNotFoundError,
  type SessionLifecycleApplication,
} from "@axtro/session-application";
import type {
  OperationsActionReceiptView,
  OperationsConsoleViewModel,
  OperationsCostBucketView,
  OperationsCostSource,
  OperationsCostTotalView,
  OperationsTimelineItemView,
} from "@axtro/ui";

export interface OperationsActionEvidenceInput {
  readonly action_intent: unknown;
  readonly policy_decision: unknown;
  readonly tool_execution_receipt: unknown;
}

export interface OperationsActionEvidenceProjection {
  listBySession(request: AuthorizedRequestContext, sessionId: unknown): readonly OperationsActionEvidenceRow[];
}

export interface OperationsActionEvidenceRow extends OperationsActionReceiptView {
  readonly tenant_id: string;
  readonly session_id: string;
}

export interface OperationsConsoleReadModelOptions {
  readonly lifecycle: Pick<SessionLifecycleApplication, "getSession">;
  readonly timeline: Pick<SessionTimelineRepository, "listCanonicalEvents">;
  readonly actions: OperationsActionEvidenceProjection;
  readonly costs: Pick<DeterministicCostLedger, "aggregate">;
}

export interface OperationsConsoleReadModel {
  read(request: AuthorizedRequestContext, sessionId: unknown, afterVersion?: unknown): OperationsConsoleViewModel;
}

export class OperationsConsoleAuthorizationError extends Error {
  constructor() {
    super("Operations console access is not authorized");
    this.name = "OperationsConsoleAuthorizationError";
  }
}

export class OperationsConsoleNotFoundError extends Error {
  constructor() {
    super("Operations session was not found");
    this.name = "OperationsConsoleNotFoundError";
  }
}

export class OperationsConsoleValidationError extends Error {
  constructor() {
    super("Operations console request is invalid");
    this.name = "OperationsConsoleValidationError";
  }
}

export class OperationsConsoleIntegrityError extends Error {
  constructor() {
    super("Operations console evidence is not internally consistent");
    this.name = "OperationsConsoleIntegrityError";
  }
}

export class OperationsConsoleCapacityError extends Error {
  constructor() {
    super("Operations console projection capacity is exhausted");
    this.name = "OperationsConsoleCapacityError";
  }
}

const MAX_PAGE_ITEMS = 100;
const MAX_CANONICAL_EVENTS = 10_000;
const MAX_CANONICAL_REPLAY_BYTES = 5_000_000;
const MAX_PROJECTION_RECORDS = 10_000;
const MAX_ACTION_PROJECTION_INPUT_BYTES = 5_000_000;
const MAX_EVENT_PAYLOAD_CHARACTERS = 250_000;
const UTF8_ENCODER = new TextEncoder();
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
const COST_SOURCES = ["estimated", "measured", "provider_reported"] as const;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const PROVIDER_PATTERN = /^[a-z][a-z0-9_-]{0,119}$/;
const LEDGER_DECIMAL_PATTERN = /^(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,8})?$/;
const UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function createDeterministicOperationsActionEvidenceProjection(
  recordsInput: readonly OperationsActionEvidenceInput[],
): OperationsActionEvidenceProjection {
  if (!Array.isArray(recordsInput) || recordsInput.length > MAX_PROJECTION_RECORDS) {
    throw new OperationsConsoleCapacityError();
  }
  const recordsBySession = new Map<string, OperationsActionEvidenceRow[]>();
  const executionKeys = new Set<string>();
  let projectionInputBytes = 0;
  for (const recordInput of recordsInput) {
    const record = exactRecord(recordInput, ["action_intent", "policy_decision", "tool_execution_receipt"]);
    const intent = parseEvidenceIntent(readValue(record, "action_intent"));
    const decision = parseEvidenceDecision(readValue(record, "policy_decision"));
    const receipt = parseReceipt(readValue(record, "tool_execution_receipt"));
    projectionInputBytes += actionEvidenceInputBytes(intent, decision, receipt);
    if (projectionInputBytes > MAX_ACTION_PROJECTION_INPUT_BYTES) throw new OperationsConsoleCapacityError();
    assertEvidenceBinding(intent, decision, receipt);
    const executionKey = `${receipt.tenantId}:${receipt.executionId}`;
    if (executionKeys.has(executionKey)) throw new OperationsConsoleIntegrityError();
    executionKeys.add(executionKey);
    const key = tenantSessionKey(intent.tenant_id as TenantId, intent.session_id as SessionId);
    const rows = recordsBySession.get(key) ?? [];
    if (rows.length >= MAX_PAGE_ITEMS) throw new OperationsConsoleCapacityError();
    rows.push(immutable<OperationsActionEvidenceRow>({
      tenant_id: intent.tenant_id,
      session_id: intent.session_id,
      execution_id: receipt.executionId,
      intent_id: intent.intent_id,
      tool_contract_id: intent.tool_contract_id,
      action: intent.action,
      status: receipt.status,
      policy_outcome: decision.outcome,
      confirmed_effect: decision.outcome === "allow"
        && receipt.status === "succeeded"
        && receipt.effectHash !== null
        && receipt.completedAt !== null,
      effect_hash: receipt.effectHash,
      attempt: receipt.attempt,
      started_at: receipt.startedAt,
      completed_at: receipt.completedAt,
    }));
    recordsBySession.set(key, rows);
  }
  for (const rows of recordsBySession.values()) {
    rows.sort((left, right) => right.started_at.localeCompare(left.started_at)
      || left.execution_id.localeCompare(right.execution_id));
    Object.freeze(rows);
  }
  return Object.freeze({
    listBySession(request: AuthorizedRequestContext, sessionIdInput: unknown): readonly OperationsActionEvidenceRow[] {
      const context = requireReadContext(request);
      const sessionId = parseRequestedSession(sessionIdInput);
      return recordsBySession.get(tenantSessionKey(context.tenantId, sessionId)) ?? Object.freeze([]);
    },
  });
}

export function createOperationsConsoleReadModel(optionsInput: OperationsConsoleReadModelOptions): OperationsConsoleReadModel {
  const options = normalizeOptions(optionsInput);
  return Object.freeze({
    read(
      request: AuthorizedRequestContext,
      sessionIdInput: unknown,
      afterVersionInput: unknown = 0,
    ): OperationsConsoleViewModel {
      const context = requireConsoleOperator(request);
      const sessionId = parseRequestedSession(sessionIdInput);
      const afterVersion = parseAfterVersion(afterVersionInput);

      const lifecycleState = readLifecycleFirst(options.lifecycle, request, sessionId);
      if (lifecycleState.tenant_id !== context.tenantId || lifecycleState.session_id !== sessionId) {
        throw new OperationsConsoleIntegrityError();
      }

      const canonicalEvents = readCanonicalEvents(options.timeline, request, sessionId);
      const replay = replayCanonicalSession(canonicalEvents, context.tenantId, sessionId);
      if (canonicalJson(replay.state.session) !== canonicalJson(lifecycleState)) throw new OperationsConsoleIntegrityError();
      if (afterVersion > replay.state.session.state_version) throw new OperationsConsoleValidationError();

      const actionReceipts = readActions(options.actions, request, sessionId, context.tenantId);
      const costs = readCosts(options.costs, request, sessionId, context.tenantId);
      const pageEvents = canonicalEvents.slice(afterVersion, afterVersion + MAX_PAGE_ITEMS);
      const pageItems = Object.freeze(pageEvents.map(toTimelineItem));
      const hasMore = afterVersion + pageItems.length < canonicalEvents.length;

      return immutable<OperationsConsoleViewModel>({
        session: {
          session_id: sessionId,
          status: replay.state.session.status,
          channel_type: replay.state.session.channel.type,
          region: replay.state.session.channel.region,
          state_version: replay.state.session.state_version,
          state_hash: replay.stateHash,
          consent_status: replay.state.session.consent_status,
          disclosure_status: replay.state.session.disclosure_status,
          degradation_level: replay.state.session.degradation_level,
          active_presenter_id: replay.state.session.active_presenter_id,
          updated_at: replay.state.session.updated_at,
        },
        timeline: {
          items: pageItems,
          after_version: afterVersion,
          total_event_count: canonicalEvents.length,
          next_after_version: hasMore ? pageItems.at(-1)!.aggregate_version : null,
        },
        action_receipts: actionReceipts,
        hypotheses: [],
        cost_buckets: costs.buckets,
        cost_totals: costs.totals,
      });
    },
  });
}

function normalizeOptions(value: OperationsConsoleReadModelOptions): OperationsConsoleReadModelOptions {
  const record = exactRecord(value, ["lifecycle", "timeline", "actions", "costs"]);
  const lifecycle = readValue(record, "lifecycle") as OperationsConsoleReadModelOptions["lifecycle"];
  const timeline = readValue(record, "timeline") as OperationsConsoleReadModelOptions["timeline"];
  const actions = readValue(record, "actions") as OperationsConsoleReadModelOptions["actions"];
  const costs = readValue(record, "costs") as OperationsConsoleReadModelOptions["costs"];
  if (typeof lifecycle?.getSession !== "function"
    || typeof timeline?.listCanonicalEvents !== "function"
    || typeof actions?.listBySession !== "function"
    || typeof costs?.aggregate !== "function") throw new OperationsConsoleValidationError();
  return Object.freeze({ lifecycle, timeline, actions, costs });
}

function requireConsoleOperator(request: AuthorizedRequestContext) {
  const context = requireReadContext(request);
  if (context.actorType !== "human_operator" || !context.purposes.includes("essential_processing")) {
    throw new OperationsConsoleAuthorizationError();
  }
  return context;
}

function requireReadContext(request: AuthorizedRequestContext) {
  try {
    const context = getAuthorizedTenantContext(request);
    if (
      !context.grantedScopes.includes("session:read")
      || !context.purposes.includes("essential_processing")
    ) throw new Error();
    return context;
  } catch {
    throw new OperationsConsoleAuthorizationError();
  }
}

function readLifecycleFirst(
  lifecycle: OperationsConsoleReadModelOptions["lifecycle"],
  request: AuthorizedRequestContext,
  sessionId: SessionId,
) {
  try {
    return lifecycle.getSession(request, sessionId);
  } catch (error) {
    if (error instanceof SessionLifecycleNotFoundError) throw new OperationsConsoleNotFoundError();
    if (error instanceof SessionLifecycleAuthorizationError) throw new OperationsConsoleAuthorizationError();
    throw new OperationsConsoleIntegrityError();
  }
}

function readCanonicalEvents(
  timeline: OperationsConsoleReadModelOptions["timeline"],
  request: AuthorizedRequestContext,
  sessionId: SessionId,
) {
  try {
    const events = timeline.listCanonicalEvents(request, sessionId, 0);
    if (!Array.isArray(events) || events.length < 1 || events.length > MAX_CANONICAL_EVENTS) {
      throw new OperationsConsoleIntegrityError();
    }
    let replayBytes = 0;
    for (const event of events) {
      if (event === null
        || typeof event !== "object"
        || typeof event.payload_json !== "string"
        || event.payload_json.length < 2
        || event.payload_json.length > MAX_EVENT_PAYLOAD_CHARACTERS) {
        throw new OperationsConsoleIntegrityError();
      }
      replayBytes += UTF8_ENCODER.encode(event.payload_json).byteLength + 512;
      if (replayBytes > MAX_CANONICAL_REPLAY_BYTES) throw new OperationsConsoleCapacityError();
    }
    return events;
  } catch (error) {
    if (error instanceof OperationsConsoleIntegrityError || error instanceof OperationsConsoleCapacityError) throw error;
    if (error instanceof SessionTimelineAuthorizationError) throw new OperationsConsoleAuthorizationError();
    throw new OperationsConsoleIntegrityError();
  }
}

function replayCanonicalSession(
  envelopes: ReturnType<SessionTimelineRepository["listCanonicalEvents"]>,
  tenantId: TenantId,
  sessionId: SessionId,
) {
  try {
    const eventIds = new Set<string>();
    const events = envelopes.map((envelope, index) => {
      const event = decodeInteractionEvent(envelope);
      if (event.tenant_id !== tenantId
        || event.session_id !== sessionId
        || event.aggregate_id !== sessionId
        || event.aggregate_type !== "interaction_session"
        || event.aggregate_version !== index + 1
        || eventIds.has(event.event_id)) throw new Error();
      eventIds.add(event.event_id);
      return event;
    });
    const state = replayInteraction(events);
    if (state.session.tenant_id !== tenantId
      || state.session.session_id !== sessionId
      || state.session.state_version !== envelopes.length) throw new Error();
    return Object.freeze({ state, stateHash: interactionStateHash(state) });
  } catch {
    throw new OperationsConsoleIntegrityError();
  }
}

function readActions(
  actions: OperationsActionEvidenceProjection,
  request: AuthorizedRequestContext,
  sessionId: SessionId,
  tenantId: TenantId,
): readonly OperationsActionReceiptView[] {
  try {
    const rows = actions.listBySession(request, sessionId);
    if (!Array.isArray(rows) || rows.length > MAX_PAGE_ITEMS) throw new OperationsConsoleCapacityError();
    return Object.freeze(rows.map((row) => {
      const record = exactRecord(row, [
        "tenant_id", "session_id", "execution_id", "intent_id", "tool_contract_id", "action", "status",
        "policy_outcome", "confirmed_effect", "effect_hash", "attempt", "started_at", "completed_at",
      ]);
      if (parseTenantId(readValue(record, "tenant_id")) !== tenantId
        || parseSessionId(readValue(record, "session_id")) !== sessionId) throw new OperationsConsoleIntegrityError();
      return immutable<OperationsActionReceiptView>({
        execution_id: parseUuidV7(readValue(record, "execution_id"), "execution_id"),
        intent_id: parseUuidV7(readValue(record, "intent_id"), "intent_id"),
        tool_contract_id: readValue(record, "tool_contract_id") as string,
        action: readValue(record, "action") as string,
        status: readValue(record, "status") as OperationsActionReceiptView["status"],
        policy_outcome: readValue(record, "policy_outcome") as OperationsActionReceiptView["policy_outcome"],
        confirmed_effect: readValue(record, "confirmed_effect") as boolean,
        effect_hash: readValue(record, "effect_hash") as string | null,
        attempt: readValue(record, "attempt") as number,
        started_at: readValue(record, "started_at") as string,
        completed_at: readValue(record, "completed_at") as string | null,
      });
    }));
  } catch (error) {
    if (error instanceof OperationsConsoleCapacityError || error instanceof OperationsConsoleAuthorizationError) throw error;
    throw new OperationsConsoleIntegrityError();
  }
}

function readCosts(
  costs: OperationsConsoleReadModelOptions["costs"],
  request: AuthorizedRequestContext,
  sessionId: SessionId,
  tenantId: TenantId,
): Readonly<{ buckets: readonly OperationsCostBucketView[]; totals: readonly OperationsCostTotalView[] }> {
  let aggregate: CostLedgerAggregation;
  try {
    aggregate = costs.aggregate(request, { session_id: sessionId });
  } catch (error) {
    if (error instanceof CostLedgerAuthorizationError) throw new OperationsConsoleAuthorizationError();
    throw new OperationsConsoleIntegrityError();
  }
  if (aggregate.tenant_id !== tenantId || aggregate.session_id !== sessionId) throw new OperationsConsoleIntegrityError();
  if (aggregate.buckets.length > MAX_PAGE_ITEMS || aggregate.reconciliations.length > MAX_PAGE_ITEMS) {
    throw new OperationsConsoleCapacityError();
  }
  const buckets = aggregate.buckets.map((bucket): OperationsCostBucketView => {
    if (!COST_SOURCES.includes(bucket.source)
      || !LEDGER_DECIMAL_PATTERN.test(bucket.quantity_decimal)
      || !LEDGER_DECIMAL_PATTERN.test(bucket.amount_usd_decimal)
      || !Number.isSafeInteger(bucket.event_count)
      || bucket.event_count < 1) throw new OperationsConsoleIntegrityError();
    return immutable({
      source: bucket.source,
      provider_id: bucket.provider_id,
      service: bucket.service,
      unit_type: bucket.unit_type,
      event_count: bucket.event_count,
      quantity_decimal: normalizeFixedEight(bucket.quantity_decimal),
      amount_usd_decimal: normalizeFixedEight(bucket.amount_usd_decimal),
    });
  }).sort(compareCostBuckets);
  const totalsBySource: Record<OperationsCostSource, bigint> = {
    estimated: 0n,
    measured: 0n,
    provider_reported: 0n,
  };
  for (const bucket of buckets) totalsBySource[bucket.source] += decimalToScaled(bucket.amount_usd_decimal);
  const totals = COST_SOURCES.map((source): OperationsCostTotalView => immutable({
    source,
    amount_usd_decimal: formatScaled(totalsBySource[source]),
  }));
  return Object.freeze({ buckets: Object.freeze(buckets), totals: Object.freeze(totals) });
}

function toTimelineItem(envelope: ReturnType<SessionTimelineRepository["listCanonicalEvents"]>[number]): OperationsTimelineItemView {
  return immutable({
    event_id: envelope.event_id,
    event_type: envelope.event_type,
    aggregate_version: envelope.aggregate_version,
    occurred_at: envelope.occurred_at,
    data_classification: envelope.data_classification,
    payload_omitted: true,
  });
}

interface ParsedReceipt {
  readonly executionId: string;
  readonly intentId: string;
  readonly tenantId: TenantId;
  readonly status: ToolExecutionReceipt["status"];
  readonly attempt: number;
  readonly effectHash: string | null;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly inputBytes: number;
}

function parseEvidenceIntent(value: unknown): ActionIntent {
  try {
    return parseActionIntent(value);
  } catch {
    throw new OperationsConsoleIntegrityError();
  }
}

function parseEvidenceDecision(value: unknown): PolicyDecision {
  try {
    return parsePolicyDecision(value);
  } catch {
    throw new OperationsConsoleIntegrityError();
  }
}

function parseReceipt(value: unknown): ParsedReceipt {
  try {
    const record = exactRecord(value, RECEIPT_KEYS);
    if (readValue(record, "schema_version") !== "2.0.0") throw new Error();
    const executionId = parseUuidV7(readValue(record, "execution_id"), "execution_id");
    const intentId = parseUuidV7(readValue(record, "intent_id"), "intent_id");
    const tenantId = parseTenantId(readValue(record, "tenant_id"));
    const status = enumValue(readValue(record, "status"), RECEIPT_STATUSES);
    const provider = readValue(record, "provider_id");
    if (typeof provider !== "string" || !PROVIDER_PATTERN.test(provider)) throw new Error();
    const attempt = boundedInteger(readValue(record, "attempt"), 1, 100);
    const resultJson = parseCanonicalJsonOrNull(readValue(record, "result_json"));
    const error = parseReceiptError(readValue(record, "error"));
    const effectValue = readValue(record, "effect_hash");
    const effectHash = effectValue === null ? null : hash(effectValue);
    const startedAt = utcTimestamp(readValue(record, "started_at"));
    const completedValue = readValue(record, "completed_at");
    const completedAt = completedValue === null ? null : utcTimestamp(completedValue);
    if (completedAt !== null && completedAt < startedAt) throw new Error();
    assertReceiptSemantics(status, resultJson, error, effectHash, completedAt);
    if (status === "succeeded" && resultJson !== null && effectHash !== sha256Canonical(JSON.parse(resultJson))) {
      throw new Error();
    }
    const inputBytes = 256
      + (resultJson === null ? 0 : UTF8_ENCODER.encode(resultJson).byteLength)
      + (error === null ? 0 : UTF8_ENCODER.encode(canonicalJson(error)).byteLength);
    return Object.freeze({ executionId, intentId, tenantId, status, attempt, effectHash, startedAt, completedAt, inputBytes });
  } catch (error) {
    if (error instanceof OperationsConsoleIntegrityError) throw error;
    throw new OperationsConsoleIntegrityError();
  }
}

function actionEvidenceInputBytes(
  intent: ActionIntent,
  decision: PolicyDecision,
  receipt: ParsedReceipt,
): number {
  const strings = [
    intent.tool_contract_id,
    intent.action,
    intent.arguments_json,
    intent.purpose,
    intent.idempotency_key,
    decision.policy_version,
    ...decision.reasons,
    ...decision.obligations,
  ];
  return receipt.inputBytes + 512 + strings.reduce(
    (total, value) => total + UTF8_ENCODER.encode(value).byteLength,
    0,
  );
}

function assertEvidenceBinding(intent: ActionIntent, decision: PolicyDecision, receipt: ParsedReceipt): void {
  const intentRequestedAt = new Date(intent.requested_at).toISOString();
  const intentExpiresAt = new Date(intent.expires_at).toISOString();
  const decisionEvaluatedAt = new Date(decision.evaluated_at).toISOString();
  const decisionExpiresAt = new Date(decision.expires_at).toISOString();
  if (decision.intent_id !== intent.intent_id
    || decision.tenant_id !== intent.tenant_id
    || receipt.intentId !== intent.intent_id
    || receipt.tenantId !== intent.tenant_id
    || decisionEvaluatedAt < intentRequestedAt
    || decisionEvaluatedAt > intentExpiresAt
    || decisionExpiresAt > intentExpiresAt
    || receipt.startedAt < intentRequestedAt
    || receipt.startedAt > intentExpiresAt
    || receipt.startedAt < decisionEvaluatedAt
    || receipt.startedAt > decisionExpiresAt
    || (receipt.status === "succeeded" && decision.outcome !== "allow")) throw new OperationsConsoleIntegrityError();
}

function assertReceiptSemantics(
  status: ToolExecutionReceipt["status"],
  resultJson: string | null,
  error: unknown,
  effectHash: string | null,
  completedAt: string | null,
): void {
  if (status === "succeeded") {
    if (resultJson === null || error !== null || effectHash === null || completedAt === null) throw new Error();
    return;
  }
  if (effectHash !== null) throw new Error();
  if (status === "unknown" && resultJson !== null) throw new Error();
  if ((status === "started" || status === "pending") && completedAt !== null) throw new Error();
  if ((status === "failed" || status === "unknown" || status === "cancelled") && (error === null || completedAt === null)) {
    throw new Error();
  }
}

function parseCanonicalJsonOrNull(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || value.length > 200_000) throw new Error();
  const parsed = JSON.parse(value) as unknown;
  if (canonicalJson(parsed) !== value) throw new Error();
  return value;
}

function parseReceiptError(value: unknown): unknown {
  if (value === null) return null;
  const record = exactRecord(value, ["code", "message", "retryable", "provider_code"]);
  const code = readValue(record, "code");
  const message = readValue(record, "message");
  const retryable = readValue(record, "retryable");
  const providerCode = readValue(record, "provider_code");
  if (typeof code !== "string" || code.length < 1 || code.length > 120
    || typeof message !== "string" || message.length < 1 || message.length > 1_000
    || typeof retryable !== "boolean"
    || (providerCode !== null && (typeof providerCode !== "string" || providerCode.length > 200))) throw new Error();
  return Object.freeze({ code, message, retryable, provider_code: providerCode });
}

function compareCostBuckets(left: OperationsCostBucketView, right: OperationsCostBucketView): number {
  return COST_SOURCES.indexOf(left.source) - COST_SOURCES.indexOf(right.source)
    || left.provider_id.localeCompare(right.provider_id)
    || left.service.localeCompare(right.service)
    || left.unit_type.localeCompare(right.unit_type);
}

function decimalToScaled(value: string): bigint {
  if (!/^(?:0|[1-9][0-9]{0,11})\.[0-9]{8}$/.test(value)) throw new OperationsConsoleIntegrityError();
  return BigInt(value.replace(".", ""));
}

function normalizeFixedEight(value: string): string {
  if (!LEDGER_DECIMAL_PATTERN.test(value)) throw new OperationsConsoleIntegrityError();
  const [integer, fractional = ""] = value.split(".");
  return `${integer}.${fractional.padEnd(8, "0")}`;
}

function formatScaled(value: bigint): string {
  const digits = value.toString().padStart(9, "0");
  const integer = digits.slice(0, -8);
  if (integer.length > 12) throw new OperationsConsoleCapacityError();
  return `${integer}.${digits.slice(-8)}`;
}

function parseRequestedSession(value: unknown): SessionId {
  try {
    return parseSessionId(value);
  } catch {
    throw new OperationsConsoleValidationError();
  }
}

function parseAfterVersion(value: unknown): number {
  try {
    return boundedInteger(value, 0, MAX_CANONICAL_EVENTS);
  } catch {
    throw new OperationsConsoleValidationError();
  }
}

function exactRecord(value: unknown, expected: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new OperationsConsoleIntegrityError();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new OperationsConsoleIntegrityError();
  if (Object.getOwnPropertySymbols(value).length > 0) throw new OperationsConsoleIntegrityError();
  const names = Object.getOwnPropertyNames(value).sort();
  const keys = [...expected].sort();
  if (names.length !== keys.length || names.some((key, index) => key !== keys[index])) throw new OperationsConsoleIntegrityError();
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor)) throw new OperationsConsoleIntegrityError();
  }
  return value as Record<string, unknown>;
}

function readValue(record: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor === undefined || !("value" in descriptor)) throw new OperationsConsoleIntegrityError();
  return descriptor.value;
}

function enumValue<const Values extends readonly string[]>(value: unknown, values: Values): Values[number] {
  if (typeof value !== "string" || !values.includes(value)) throw new Error();
  return value as Values[number];
}

function boundedInteger(value: unknown, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error();
  return value;
}

function hash(value: unknown): string {
  if (typeof value !== "string" || !HASH_PATTERN.test(value)) throw new Error();
  return value;
}

function utcTimestamp(value: unknown): string {
  if (typeof value !== "string" || !UTC_PATTERN.test(value) || !Number.isFinite(Date.parse(value))) throw new Error();
  return new Date(value).toISOString();
}

function tenantSessionKey(tenantId: TenantId, sessionId: SessionId): string {
  return `${tenantId}:${sessionId}`;
}

function immutable<Value>(value: Value): Value {
  return deepFreeze(structuredClone(value));
}

function deepFreeze<Value>(value: Value): Value {
  if (value === null || typeof value !== "object") return value;
  for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  return Object.freeze(value);
}
