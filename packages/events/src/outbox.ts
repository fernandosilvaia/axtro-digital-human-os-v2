import {
  assertAuthorizedTenantMatch,
  getAuthorizedTenantContext,
  type AuthorizedRequestContext,
} from "@axtro/auth";
import type { EventDeliveryReceipt, EventEnvelope } from "@axtro/contracts-ts";
import {
  createDeterministicTransactionCoordinator,
  type TransactionalStateParticipant,
} from "@axtro/database";
import {
  parseInteractionEvent,
  parseSessionId,
  parseUuidV7,
  reduceInteractionState,
  sha256Canonical,
  type AnyInteractionEvent,
  type InteractionAggregateState,
  type TenantId,
  type UuidV7,
} from "@axtro/domain";

import { decodeInteractionEvent, encodeInteractionEvent } from "./codec.js";

export const TRANSACTIONAL_OUTBOX_FAULT_POINTS = [
  "after_aggregate_write",
  "after_outbox_insert",
  "before_commit",
] as const;

export const SESSION_TIMELINE_CONSUMER_NAME = "session-timeline" as const;
export type EventDeliveryConsumerName = typeof SESSION_TIMELINE_CONSUMER_NAME;

export type TransactionalOutboxFaultPoint = (typeof TRANSACTIONAL_OUTBOX_FAULT_POINTS)[number];
export type TransactionalOutboxStatus = "pending" | "publishing" | "published" | "failed" | "dead_letter";

export interface DeterministicTransactionalOutboxOptions {
  /** Closed, one-shot local test seams. They never leave this in-memory fake. */
  readonly faultPoints?: readonly TransactionalOutboxFaultPoint[];
  readonly maxRecordsPerTenant?: unknown;
}

export interface TransactionalOutboxRecord {
  readonly tenant_id: TenantId;
  readonly event_id: string;
  readonly aggregate_type: "interaction_session";
  readonly aggregate_id: string;
  readonly aggregate_version: number;
  readonly event: EventEnvelope;
  readonly status: TransactionalOutboxStatus;
  readonly attempts: number;
}

export interface TransactionalOutboxCommitResult {
  readonly aggregate: InteractionAggregateState;
  readonly outbox: TransactionalOutboxRecord;
}

/** A contiguous aggregate event batch committed with its pending outbox rows. */
export interface TransactionalOutboxBatchCommitResult {
  readonly aggregate: InteractionAggregateState;
  readonly outbox: readonly TransactionalOutboxRecord[];
}

/** Trusted command fence used by an upstream request deadline before local commit. */
export interface TransactionalOutboxCommitControl {
  assertActive(): void;
}

export type EventDeliveryFailureCode = Exclude<EventDeliveryReceipt["failure_code"], null>;

export interface OutboxDeliveryClaimInput {
  readonly consumer_name: unknown;
  readonly claim_token: unknown;
  readonly now: unknown;
  readonly lease_duration_ms: unknown;
  readonly max_attempts: unknown;
}

export interface OutboxDeliveryAttemptReference {
  readonly event_id: unknown;
  readonly consumer_name: unknown;
  readonly claim_token: unknown;
}

export interface OutboxDeliveryAcknowledgementInput extends OutboxDeliveryAttemptReference {
  readonly completed_at: unknown;
  readonly effect_hash: unknown;
}

export interface OutboxDeliveryFailureInput extends OutboxDeliveryAttemptReference {
  readonly completed_at: unknown;
  readonly failure_code: unknown;
  readonly retryable: unknown;
  readonly retry_delay_ms: unknown;
}

export interface OutboxDeliveryClaim {
  readonly tenant_id: TenantId;
  readonly event_id: UuidV7;
  readonly aggregate_id: string;
  readonly aggregate_version: number;
  readonly consumer_name: EventDeliveryConsumerName;
  readonly claim_token: UuidV7;
  readonly attempt: number;
  readonly max_attempts: number;
  readonly event_fingerprint: string;
  readonly started_at: string;
  readonly lease_expires_at: string;
  readonly event: EventEnvelope;
}

export type OutboxDeliveryClaimResult =
  | Readonly<{ outcome: "idle"; claim: null; receipt: null }>
  | Readonly<{ outcome: "claimed"; claim: OutboxDeliveryClaim; receipt: null }>
  | Readonly<{ outcome: "dead_lettered"; claim: null; receipt: EventDeliveryReceipt }>;

export interface TransactionalOutboxRepository {
  commitInteractionEvent(
    request: AuthorizedRequestContext,
    eventInput: unknown,
    control?: TransactionalOutboxCommitControl,
  ): Promise<TransactionalOutboxCommitResult>;
  commitInteractionEvents(
    request: AuthorizedRequestContext,
    eventInputs: unknown,
    control?: TransactionalOutboxCommitControl,
  ): Promise<TransactionalOutboxBatchCommitResult>;
  readInteractionAggregate(
    request: AuthorizedRequestContext,
    aggregateId: unknown,
  ): InteractionAggregateState | null;
  listOutbox(request: AuthorizedRequestContext): readonly TransactionalOutboxRecord[];
  claimNextDelivery(
    request: AuthorizedRequestContext,
    input: OutboxDeliveryClaimInput,
  ): Promise<OutboxDeliveryClaimResult>;
  acknowledgeDelivery(
    request: AuthorizedRequestContext,
    input: OutboxDeliveryAcknowledgementInput,
  ): Promise<EventDeliveryReceipt>;
  failDelivery(
    request: AuthorizedRequestContext,
    input: OutboxDeliveryFailureInput,
  ): Promise<EventDeliveryReceipt>;
  readLatestDeliveryReceipt(
    request: AuthorizedRequestContext,
    consumerName: unknown,
    eventId: unknown,
  ): EventDeliveryReceipt | null;
  listDeadLetters(
    request: AuthorizedRequestContext,
    consumerName: unknown,
  ): readonly EventDeliveryReceipt[];
}

export class TransactionalOutboxAuthorizationError extends Error {
  constructor() {
    super("Transactional outbox access is not authorized");
    this.name = "TransactionalOutboxAuthorizationError";
  }
}

export class TransactionalOutboxConflictError extends Error {
  constructor() {
    super("Transactional outbox event conflicts with committed state");
    this.name = "TransactionalOutboxConflictError";
  }
}

export class TransactionalOutboxTransactionError extends Error {
  constructor() {
    super("Transactional outbox transaction was rolled back");
    this.name = "TransactionalOutboxTransactionError";
  }
}

export class TransactionalOutboxConfigurationError extends Error {
  constructor() {
    super("Transactional outbox configuration is invalid");
    this.name = "TransactionalOutboxConfigurationError";
  }
}

export class TransactionalOutboxCapacityError extends Error {
  constructor() {
    super("Transactional outbox capacity is exhausted");
    this.name = "TransactionalOutboxCapacityError";
  }
}

interface StoredOutboxRecord extends TransactionalOutboxRecord {}

interface RepositoryState {
  readonly aggregates: Map<string, InteractionAggregateState>;
  readonly outbox: Map<string, StoredOutboxRecord>;
  readonly outboxKeysByTenant: Map<TenantId, Set<string>>;
  readonly outboxKeysByAggregate: Map<string, Set<string>>;
  readonly deliveries: Map<string, StoredDeliveryState>;
  readonly usedClaimTokensByTenant: Map<TenantId, Set<UuidV7>>;
}

interface ActiveDeliveryClaim {
  readonly consumerName: EventDeliveryConsumerName;
  readonly claimToken: UuidV7;
  readonly startedAt: string;
  readonly startedAtMs: number;
  readonly leaseExpiresAt: string;
  readonly leaseExpiresAtMs: number;
  readonly maxAttempts: number;
}

interface StoredDeliveryState {
  readonly consumerName: EventDeliveryConsumerName | null;
  readonly maxAttempts: number | null;
  readonly availableAtMs: number;
  readonly activeClaim: ActiveDeliveryClaim | null;
  readonly lastAttemptStartedAt: string | null;
  readonly latestReceipt: EventDeliveryReceipt | null;
}

interface NormalizedDeliveryClaimInput {
  readonly consumerName: EventDeliveryConsumerName;
  readonly claimToken: UuidV7;
  readonly now: string;
  readonly nowMs: number;
  readonly leaseDurationMs: number;
  readonly maxAttempts: number;
}

interface NormalizedDeliveryAcknowledgement {
  readonly eventId: UuidV7;
  readonly consumerName: EventDeliveryConsumerName;
  readonly claimToken: UuidV7;
  readonly completedAt: string;
  readonly completedAtMs: number;
  readonly effectHash: string;
}

interface NormalizedDeliveryFailure {
  readonly eventId: UuidV7;
  readonly consumerName: EventDeliveryConsumerName;
  readonly claimToken: UuidV7;
  readonly completedAt: string;
  readonly completedAtMs: number;
  readonly failureCode: EventDeliveryFailureCode;
  readonly retryable: boolean;
  readonly retryDelayMs: number;
}

interface ParsedTimestamp {
  readonly iso: string;
  readonly epochMs: number;
}

const MAX_FAULT_POINTS = 16;
const MAX_BATCH_EVENTS = 16;
const DEFAULT_MAX_RECORDS_PER_TENANT = 1_024;
const MAX_RECORDS_PER_TENANT = 10_000;
const MAX_DELIVERY_ATTEMPTS = 16;
const MIN_LEASE_DURATION_MS = 100;
const MAX_LEASE_DURATION_MS = 300_000;
const MAX_RETRY_DELAY_MS = 3_600_000;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

interface NormalizedOutboxOptions {
  readonly faultPoints: TransactionalOutboxFaultPoint[];
  readonly maxRecordsPerTenant: number;
}

/**
 * A deterministic M0 fake for an atomic aggregate-plus-outbox write. It uses
 * the existing event envelope codec and an authenticated request context, and
 * has no network, worker, broker, timer, provider or global tenant scan.
 */
export function createDeterministicTransactionalOutboxRepository(
  optionsInput?: DeterministicTransactionalOutboxOptions,
): TransactionalOutboxRepository {
  const options = normalizeOutboxOptions(optionsInput);
  const faultPoints = options.faultPoints;
  const coordinator = createDeterministicTransactionCoordinator();
  let state: RepositoryState = emptyState();
  const participant: TransactionalStateParticipant<RepositoryState> = {
    captureSnapshot: () => cloneState(state),
    restoreSnapshot: (snapshot) => {
      state = cloneState(snapshot);
    },
  };

  const commitInteractionEvents = async (
    request: AuthorizedRequestContext,
    eventInputs: unknown,
    controlInput?: TransactionalOutboxCommitControl,
  ): Promise<TransactionalOutboxBatchCommitResult> => {
    const control = normalizeCommitControl(controlInput);
    control.assertActive();
    const tenantId = requireScope(request, "session:write");
    const canonicalEvents = normalizeInteractionEventBatch(request, tenantId, eventInputs);

    return coordinator.execute(participant, () => {
      control.assertActive();
      const records: TransactionalOutboxRecord[] = [];
      let aggregate: InteractionAggregateState | undefined;
      for (const canonicalEvent of canonicalEvents) {
        control.assertActive();
        const eventKey = tenantEventKey(tenantId, canonicalEvent.event_id);
        const aggregateKey = tenantAggregateKey(tenantId, canonicalEvent.aggregate_id);
        if (state.outbox.has(eventKey)) throw new TransactionalOutboxConflictError();
        if ((state.outboxKeysByTenant.get(tenantId)?.size ?? 0) >= options.maxRecordsPerTenant) {
          throw new TransactionalOutboxCapacityError();
        }

        aggregate = reduceInteractionState(state.aggregates.get(aggregateKey), canonicalEvent);
        control.assertActive();
        state.aggregates.set(aggregateKey, immutableCopy(aggregate));
        throwAtFaultPoint(faultPoints, "after_aggregate_write");

        const record = immutableCopy<StoredOutboxRecord>({
          tenant_id: tenantId,
          event_id: canonicalEvent.event_id,
          aggregate_type: "interaction_session",
          aggregate_id: canonicalEvent.aggregate_id,
          aggregate_version: canonicalEvent.aggregate_version,
          event: encodeInteractionEvent(canonicalEvent),
          status: "pending",
          attempts: 0,
        });
        state.outbox.set(eventKey, record);
        state.deliveries.set(eventKey, emptyDeliveryState());
        addOutboxIndex(state, tenantId, aggregateKey, eventKey);
        records.push(record);
        throwAtFaultPoint(faultPoints, "after_outbox_insert");
      }
      control.assertActive();
      throwAtFaultPoint(faultPoints, "before_commit");
      if (aggregate === undefined) throw new TransactionalOutboxConfigurationError();
      return immutableCopy({ aggregate, outbox: records });
    });
  };

  const repository: TransactionalOutboxRepository = {
    async commitInteractionEvent(request, eventInput, control): Promise<TransactionalOutboxCommitResult> {
      const result = await commitInteractionEvents(request, [eventInput], control);
      const outbox = result.outbox[0];
      if (outbox === undefined) throw new TransactionalOutboxConfigurationError();
      return immutableCopy({ aggregate: result.aggregate, outbox });
    },

    commitInteractionEvents,

    readInteractionAggregate(request, aggregateId): InteractionAggregateState | null {
      const tenantId = requireScope(request, "session:read");
      const normalizedAggregateId = parseSessionId(aggregateId);
      const stateForAggregate = state.aggregates.get(tenantAggregateKey(tenantId, normalizedAggregateId));
      return stateForAggregate === undefined ? null : immutableCopy(stateForAggregate);
    },

    listOutbox(request): readonly TransactionalOutboxRecord[] {
      const tenantId = requireScope(request, "session:read");
      const keys = state.outboxKeysByTenant.get(tenantId) ?? new Set<string>();
      const records = [...keys]
        .map((key) => state.outbox.get(key))
        .filter((record): record is StoredOutboxRecord => record !== undefined)
        .sort(compareOutboxRecords)
        .map((record) => immutableCopy(record));
      return Object.freeze(records);
    },

    async claimNextDelivery(request, input): Promise<OutboxDeliveryClaimResult> {
      const tenantId = requireScope(request, "event:relay");
      const claimInput = parseDeliveryClaimInput(input);
      return coordinator.execute(participant, () => claimNextDelivery(state, tenantId, claimInput));
    },

    async acknowledgeDelivery(request, input): Promise<EventDeliveryReceipt> {
      const tenantId = requireScope(request, "event:relay");
      const acknowledgement = parseDeliveryAcknowledgement(input);
      return coordinator.execute(participant, () => acknowledgeClaim(state, tenantId, acknowledgement));
    },

    async failDelivery(request, input): Promise<EventDeliveryReceipt> {
      const tenantId = requireScope(request, "event:relay");
      const failure = parseDeliveryFailure(input);
      return coordinator.execute(participant, () => failClaim(state, tenantId, failure));
    },

    readLatestDeliveryReceipt(request, consumerNameInput, eventIdInput): EventDeliveryReceipt | null {
      const tenantId = requireScope(request, "event:observe");
      const consumerName = parseConsumerName(consumerNameInput);
      const eventId = parseEventId(eventIdInput);
      const delivery = state.deliveries.get(tenantEventKey(tenantId, eventId));
      if (delivery === undefined || delivery.consumerName !== consumerName || delivery.latestReceipt === null) return null;
      return immutableCopy(delivery.latestReceipt);
    },

    listDeadLetters(request, consumerNameInput): readonly EventDeliveryReceipt[] {
      const tenantId = requireScope(request, "event:observe");
      const consumerName = parseConsumerName(consumerNameInput);
      const keys = state.outboxKeysByTenant.get(tenantId) ?? new Set<string>();
      const receipts = [...keys]
        .map((key) => state.deliveries.get(key)?.latestReceipt)
        .filter((receipt): receipt is EventDeliveryReceipt => (
          receipt !== undefined
          && receipt !== null
          && receipt.consumer_name === consumerName
          && receipt.status === "dead_letter"
        ))
        .sort(compareDeliveryReceipts)
        .map((receipt) => immutableCopy(receipt));
      return Object.freeze(receipts);
    },
  };
  return Object.freeze(repository);
}

function requireScope(
  request: AuthorizedRequestContext,
  scope: "session:read" | "session:write" | "event:relay" | "event:observe",
): TenantId {
  const context = getAuthorizedTenantContext(request);
  if (!context.grantedScopes.includes(scope)) throw new TransactionalOutboxAuthorizationError();
  if (
    (scope === "event:relay" || scope === "event:observe")
    && !context.purposes.includes("essential_processing")
  ) throw new TransactionalOutboxAuthorizationError();
  return context.tenantId;
}

const NOOP_COMMIT_CONTROL: TransactionalOutboxCommitControl = Object.freeze({ assertActive() {} });

function normalizeCommitControl(value: TransactionalOutboxCommitControl | undefined): TransactionalOutboxCommitControl {
  if (value === undefined) return NOOP_COMMIT_CONTROL;
  if (value === null || typeof value !== "object" || typeof value.assertActive !== "function") {
    throw new TransactionalOutboxConfigurationError();
  }
  return value;
}

function normalizeOutboxOptions(optionsInput: DeterministicTransactionalOutboxOptions | undefined): NormalizedOutboxOptions {
  if (optionsInput === undefined) {
    return { faultPoints: [], maxRecordsPerTenant: DEFAULT_MAX_RECORDS_PER_TENANT };
  }
  const record = strictPlainRecord(optionsInput, ["faultPoints", "maxRecordsPerTenant"]);
  const values = record.faultPoints ?? [];
  if (!Array.isArray(values) || values.length > MAX_FAULT_POINTS) throw new TransactionalOutboxConfigurationError();
  const parsed: TransactionalOutboxFaultPoint[] = [];
  for (const value of values) {
    if (!TRANSACTIONAL_OUTBOX_FAULT_POINTS.includes(value as TransactionalOutboxFaultPoint)) {
      throw new TransactionalOutboxConfigurationError();
    }
    parsed.push(value as TransactionalOutboxFaultPoint);
  }
  return {
    faultPoints: parsed,
    maxRecordsPerTenant: optionalBoundedInteger(
      record.maxRecordsPerTenant,
      DEFAULT_MAX_RECORDS_PER_TENANT,
      1,
      MAX_RECORDS_PER_TENANT,
    ),
  };
}

function parseDeliveryClaimInput(value: unknown): NormalizedDeliveryClaimInput {
  const record = strictPlainRecord(value, [
    "consumer_name",
    "claim_token",
    "now",
    "lease_duration_ms",
    "max_attempts",
  ]);
  const timestamp = parseTimestamp(record.now);
  return Object.freeze({
    consumerName: parseConsumerName(record.consumer_name),
    claimToken: parseEventId(record.claim_token),
    now: timestamp.iso,
    nowMs: timestamp.epochMs,
    leaseDurationMs: parseBoundedInteger(record.lease_duration_ms, MIN_LEASE_DURATION_MS, MAX_LEASE_DURATION_MS),
    maxAttempts: parseBoundedInteger(record.max_attempts, 1, MAX_DELIVERY_ATTEMPTS),
  });
}

function parseDeliveryAcknowledgement(value: unknown): NormalizedDeliveryAcknowledgement {
  const record = strictPlainRecord(value, [
    "event_id",
    "consumer_name",
    "claim_token",
    "completed_at",
    "effect_hash",
  ]);
  const timestamp = parseTimestamp(record.completed_at);
  if (typeof record.effect_hash !== "string" || !SHA256_PATTERN.test(record.effect_hash)) {
    throw new TransactionalOutboxConfigurationError();
  }
  return Object.freeze({
    eventId: parseEventId(record.event_id),
    consumerName: parseConsumerName(record.consumer_name),
    claimToken: parseEventId(record.claim_token),
    completedAt: timestamp.iso,
    completedAtMs: timestamp.epochMs,
    effectHash: record.effect_hash,
  });
}

function parseDeliveryFailure(value: unknown): NormalizedDeliveryFailure {
  const record = strictPlainRecord(value, [
    "event_id",
    "consumer_name",
    "claim_token",
    "completed_at",
    "failure_code",
    "retryable",
    "retry_delay_ms",
  ]);
  const timestamp = parseTimestamp(record.completed_at);
  if (typeof record.retryable !== "boolean") throw new TransactionalOutboxConfigurationError();
  const failureCode = parseFailureCode(record.failure_code);
  const retryDelayMs = parseBoundedInteger(record.retry_delay_ms, 0, MAX_RETRY_DELAY_MS);
  const retryableCodes: readonly EventDeliveryFailureCode[] = ["consumer_retryable", "timeline_capacity"];
  const terminalCodes: readonly EventDeliveryFailureCode[] = [
    "consumer_rejected",
    "timeline_conflict",
    "timeline_invalid",
  ];
  if (
    (record.retryable && !retryableCodes.includes(failureCode))
    || (!record.retryable && (!terminalCodes.includes(failureCode) || retryDelayMs !== 0))
  ) throw new TransactionalOutboxConfigurationError();
  return Object.freeze({
    eventId: parseEventId(record.event_id),
    consumerName: parseConsumerName(record.consumer_name),
    claimToken: parseEventId(record.claim_token),
    completedAt: timestamp.iso,
    completedAtMs: timestamp.epochMs,
    failureCode,
    retryable: record.retryable,
    retryDelayMs,
  });
}

function parseConsumerName(value: unknown): EventDeliveryConsumerName {
  if (value !== SESSION_TIMELINE_CONSUMER_NAME) {
    throw new TransactionalOutboxConfigurationError();
  }
  return SESSION_TIMELINE_CONSUMER_NAME;
}

function parseEventId(value: unknown): UuidV7 {
  try {
    return parseUuidV7(value, "event_id");
  } catch {
    throw new TransactionalOutboxConfigurationError();
  }
}

function parseFailureCode(value: unknown): EventDeliveryFailureCode {
  const allowed: readonly EventDeliveryFailureCode[] = [
    "consumer_retryable",
    "consumer_rejected",
    "timeline_conflict",
    "timeline_capacity",
    "timeline_invalid",
    "lease_expired",
    "max_attempts_exhausted",
  ];
  if (typeof value !== "string" || !allowed.includes(value as EventDeliveryFailureCode)) {
    throw new TransactionalOutboxConfigurationError();
  }
  return value as EventDeliveryFailureCode;
}

function parseTimestamp(value: unknown): ParsedTimestamp {
  if (typeof value !== "string" || value.length < 20 || value.length > 40) {
    throw new TransactionalOutboxConfigurationError();
  }
  const epochMs = Date.parse(value);
  if (!Number.isFinite(epochMs)) throw new TransactionalOutboxConfigurationError();
  return Object.freeze({ iso: new Date(epochMs).toISOString(), epochMs });
}

function parseBoundedInteger(value: unknown, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TransactionalOutboxConfigurationError();
  }
  return value;
}

function optionalBoundedInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return value === undefined ? fallback : parseBoundedInteger(value, minimum, maximum);
}

function normalizeInteractionEventBatch(
  request: AuthorizedRequestContext,
  tenantId: TenantId,
  value: unknown,
): readonly AnyInteractionEvent[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_BATCH_EVENTS) {
    throw new TransactionalOutboxConfigurationError();
  }
  const events: AnyInteractionEvent[] = [];
  let aggregateId: string | undefined;
  for (const input of value) {
    const event = parseInteractionEvent(input);
    assertAuthorizedTenantMatch(request, event.tenant_id);
    if (event.tenant_id !== tenantId) throw new TransactionalOutboxAuthorizationError();
    const canonicalEvent = decodeInteractionEvent(encodeInteractionEvent(event));
    if (aggregateId !== undefined && aggregateId !== canonicalEvent.aggregate_id) {
      throw new TransactionalOutboxConfigurationError();
    }
    aggregateId = canonicalEvent.aggregate_id;
    events.push(canonicalEvent);
  }
  return Object.freeze(events);
}

function strictPlainRecord(value: unknown, allowedKeys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TransactionalOutboxConfigurationError();
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!allowedKeys.includes(key) || !("value" in descriptor)) throw new TransactionalOutboxConfigurationError();
  }
  return Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]));
}

function emptyState(): RepositoryState {
  return {
    aggregates: new Map<string, InteractionAggregateState>(),
    outbox: new Map<string, StoredOutboxRecord>(),
    outboxKeysByTenant: new Map<TenantId, Set<string>>(),
    outboxKeysByAggregate: new Map<string, Set<string>>(),
    deliveries: new Map<string, StoredDeliveryState>(),
    usedClaimTokensByTenant: new Map<TenantId, Set<UuidV7>>(),
  };
}

function cloneState(source: RepositoryState): RepositoryState {
  return {
    aggregates: new Map([...source.aggregates].map(([key, value]) => [key, immutableCopy(value)])),
    outbox: new Map([...source.outbox].map(([key, value]) => [key, immutableCopy(value)])),
    outboxKeysByTenant: new Map([...source.outboxKeysByTenant].map(([key, value]) => [key, new Set(value)])),
    outboxKeysByAggregate: new Map([...source.outboxKeysByAggregate].map(([key, value]) => [key, new Set(value)])),
    deliveries: new Map([...source.deliveries].map(([key, value]) => [key, immutableCopy(value)])),
    usedClaimTokensByTenant: new Map(
      [...source.usedClaimTokensByTenant].map(([key, value]) => [key, new Set(value)]),
    ),
  };
}

function emptyDeliveryState(): StoredDeliveryState {
  return Object.freeze({
    consumerName: null,
    maxAttempts: null,
    availableAtMs: 0,
    activeClaim: null,
    lastAttemptStartedAt: null,
    latestReceipt: null,
  });
}

function claimNextDelivery(
  state: RepositoryState,
  tenantId: TenantId,
  input: NormalizedDeliveryClaimInput,
): OutboxDeliveryClaimResult {
  assertClaimTokenUnused(state, tenantId, input.claimToken);
  const tenantKeys = state.outboxKeysByTenant.get(tenantId) ?? new Set<string>();
  const candidates = [...tenantKeys]
    .map((key) => state.outbox.get(key))
    .filter((record): record is StoredOutboxRecord => record !== undefined)
    .filter((record) => isDeliveryCandidate(state, record, input.nowMs))
    .sort(compareOutboxRecords);

  for (const candidate of candidates) {
    if (hasUnpublishedPredecessor(state, candidate)) continue;
    const key = tenantEventKey(tenantId, candidate.event_id);
    let delivery = state.deliveries.get(key);
    if (delivery === undefined) throw new TransactionalOutboxConflictError();
    if (delivery.consumerName !== null && delivery.consumerName !== input.consumerName) continue;

    let record = candidate;
    if (record.status === "publishing") {
      const active = delivery.activeClaim;
      if (active === null || active.leaseExpiresAtMs > input.nowMs) continue;
      const expiredReceipt = createDeliveryReceipt(
        record,
        delivery.consumerName ?? active.consumerName,
        active.maxAttempts,
        "retry_scheduled",
        "lease_expired",
        null,
        active.startedAt,
        input.now,
      );
      record = immutableCopy({ ...record, status: "failed" as const });
      state.outbox.set(key, record);
      delivery = immutableCopy({
        ...delivery,
        consumerName: active.consumerName,
        maxAttempts: active.maxAttempts,
        availableAtMs: input.nowMs,
        activeClaim: null,
        lastAttemptStartedAt: active.startedAt,
        latestReceipt: expiredReceipt,
      });
      state.deliveries.set(key, delivery);
    }

    const maxAttempts = delivery.maxAttempts ?? input.maxAttempts;
    if (record.attempts >= maxAttempts) {
      const receipt = createDeliveryReceipt(
        record,
        delivery.consumerName ?? input.consumerName,
        maxAttempts,
        "dead_letter",
        "max_attempts_exhausted",
        null,
        delivery.lastAttemptStartedAt ?? input.now,
        input.now,
      );
      state.outbox.set(key, immutableCopy({ ...record, status: "dead_letter" as const }));
      state.deliveries.set(key, immutableCopy({
        ...delivery,
        consumerName: delivery.consumerName ?? input.consumerName,
        maxAttempts,
        availableAtMs: input.nowMs,
        activeClaim: null,
        latestReceipt: receipt,
      }));
      return Object.freeze({ outcome: "dead_lettered", claim: null, receipt: immutableCopy(receipt) });
    }

    const leaseExpiresAtMs = input.nowMs + input.leaseDurationMs;
    const activeClaim = immutableCopy<ActiveDeliveryClaim>({
      consumerName: input.consumerName,
      claimToken: input.claimToken,
      startedAt: input.now,
      startedAtMs: input.nowMs,
      leaseExpiresAt: new Date(leaseExpiresAtMs).toISOString(),
      leaseExpiresAtMs,
      maxAttempts,
    });
    const claimedRecord = immutableCopy<StoredOutboxRecord>({
      ...record,
      status: "publishing",
      attempts: record.attempts + 1,
    });
    state.outbox.set(key, claimedRecord);
    const usedClaimTokens = state.usedClaimTokensByTenant.get(tenantId) ?? new Set<UuidV7>();
    usedClaimTokens.add(input.claimToken);
    state.usedClaimTokensByTenant.set(tenantId, usedClaimTokens);
    state.deliveries.set(key, immutableCopy({
      ...delivery,
      consumerName: input.consumerName,
      maxAttempts,
      activeClaim,
      lastAttemptStartedAt: input.now,
    }));
    const claim = immutableCopy<OutboxDeliveryClaim>({
      tenant_id: tenantId,
      event_id: parseEventId(claimedRecord.event_id),
      aggregate_id: claimedRecord.aggregate_id,
      aggregate_version: claimedRecord.aggregate_version,
      consumer_name: input.consumerName,
      claim_token: input.claimToken,
      attempt: claimedRecord.attempts,
      max_attempts: maxAttempts,
      event_fingerprint: sha256Canonical(claimedRecord.event),
      started_at: input.now,
      lease_expires_at: activeClaim.leaseExpiresAt,
      event: claimedRecord.event,
    });
    return Object.freeze({ outcome: "claimed", claim, receipt: null });
  }
  return Object.freeze({ outcome: "idle", claim: null, receipt: null });
}

function acknowledgeClaim(
  state: RepositoryState,
  tenantId: TenantId,
  input: NormalizedDeliveryAcknowledgement,
): EventDeliveryReceipt {
  const { record, delivery, active } = requireActiveDeliveryClaim(state, tenantId, input);
  assertCompletionWithinClaim(active, input.completedAtMs);
  const receipt = createDeliveryReceipt(
    record,
    active.consumerName,
    active.maxAttempts,
    "published",
    null,
    input.effectHash,
    active.startedAt,
    input.completedAt,
  );
  const key = tenantEventKey(tenantId, input.eventId);
  state.outbox.set(key, immutableCopy({ ...record, status: "published" as const }));
  state.deliveries.set(key, immutableCopy({
    ...delivery,
    activeClaim: null,
    latestReceipt: receipt,
  }));
  return immutableCopy(receipt);
}

function failClaim(
  state: RepositoryState,
  tenantId: TenantId,
  input: NormalizedDeliveryFailure,
): EventDeliveryReceipt {
  const { record, delivery, active } = requireActiveDeliveryClaim(state, tenantId, input);
  assertCompletionWithinClaim(active, input.completedAtMs);
  const mayRetry = input.retryable && record.attempts < active.maxAttempts;
  const status = mayRetry ? "retry_scheduled" : "dead_letter";
  const failureCode = input.retryable && !mayRetry ? "max_attempts_exhausted" : input.failureCode;
  const receipt = createDeliveryReceipt(
    record,
    active.consumerName,
    active.maxAttempts,
    status,
    failureCode,
    null,
    active.startedAt,
    input.completedAt,
  );
  const key = tenantEventKey(tenantId, input.eventId);
  state.outbox.set(key, immutableCopy({ ...record, status: mayRetry ? "failed" as const : "dead_letter" as const }));
  state.deliveries.set(key, immutableCopy({
    ...delivery,
    availableAtMs: mayRetry ? input.completedAtMs + input.retryDelayMs : input.completedAtMs,
    activeClaim: null,
    latestReceipt: receipt,
  }));
  return immutableCopy(receipt);
}

function requireActiveDeliveryClaim(
  state: RepositoryState,
  tenantId: TenantId,
  input: Readonly<{ eventId: UuidV7; consumerName: EventDeliveryConsumerName; claimToken: UuidV7 }>,
): Readonly<{ record: StoredOutboxRecord; delivery: StoredDeliveryState; active: ActiveDeliveryClaim }> {
  const key = tenantEventKey(tenantId, input.eventId);
  const record = state.outbox.get(key);
  const delivery = state.deliveries.get(key);
  const active = delivery?.activeClaim;
  if (
    record === undefined
    || record.status !== "publishing"
    || delivery === undefined
    || active === undefined
    || active === null
    || active.consumerName !== input.consumerName
    || active.claimToken !== input.claimToken
  ) throw new TransactionalOutboxConflictError();
  return Object.freeze({ record, delivery, active });
}

function assertCompletionWithinClaim(active: ActiveDeliveryClaim, completedAtMs: number): void {
  if (completedAtMs < active.startedAtMs || completedAtMs >= active.leaseExpiresAtMs) {
    throw new TransactionalOutboxConflictError();
  }
}

function isDeliveryCandidate(state: RepositoryState, record: StoredOutboxRecord, nowMs: number): boolean {
  const delivery = state.deliveries.get(tenantEventKey(record.tenant_id, record.event_id));
  if (delivery === undefined) return false;
  if (record.status === "pending" || record.status === "failed") return delivery.availableAtMs <= nowMs;
  return record.status === "publishing"
    && delivery.activeClaim !== null
    && delivery.activeClaim.leaseExpiresAtMs <= nowMs;
}

function assertClaimTokenUnused(state: RepositoryState, tenantId: TenantId, claimToken: UuidV7): void {
  if (state.usedClaimTokensByTenant.get(tenantId)?.has(claimToken) === true) {
    throw new TransactionalOutboxConflictError();
  }
}

function createDeliveryReceipt(
  record: StoredOutboxRecord,
  consumerName: EventDeliveryConsumerName,
  maxAttempts: number,
  status: EventDeliveryReceipt["status"],
  failureCode: EventDeliveryReceipt["failure_code"],
  effectHash: string | null,
  startedAt: string,
  completedAt: string,
): EventDeliveryReceipt {
  return immutableCopy({
    schema_version: "2.0.0",
    tenant_id: record.tenant_id,
    event_id: record.event_id,
    aggregate_id: record.aggregate_id,
    aggregate_version: record.aggregate_version,
    consumer_name: consumerName,
    event_fingerprint: sha256Canonical(record.event),
    trace_id: record.event.trace_id,
    correlation_id: record.event.correlation_id,
    status,
    attempt: record.attempts,
    max_attempts: maxAttempts,
    failure_code: failureCode,
    effect_hash: effectHash,
    started_at: startedAt,
    completed_at: completedAt,
    data_classification: "internal",
  } satisfies EventDeliveryReceipt);
}

function compareDeliveryReceipts(left: EventDeliveryReceipt, right: EventDeliveryReceipt): number {
  return left.aggregate_id.localeCompare(right.aggregate_id)
    || left.aggregate_version - right.aggregate_version
    || left.event_id.localeCompare(right.event_id);
}

function addOutboxIndex(state: RepositoryState, tenantId: TenantId, aggregateKey: string, eventKey: string): void {
  const tenantKeys = state.outboxKeysByTenant.get(tenantId) ?? new Set<string>();
  tenantKeys.add(eventKey);
  state.outboxKeysByTenant.set(tenantId, tenantKeys);
  const aggregateKeys = state.outboxKeysByAggregate.get(aggregateKey) ?? new Set<string>();
  aggregateKeys.add(eventKey);
  state.outboxKeysByAggregate.set(aggregateKey, aggregateKeys);
}

function hasUnpublishedPredecessor(state: RepositoryState, record: StoredOutboxRecord): boolean {
  const aggregateKey = tenantAggregateKey(record.tenant_id, record.aggregate_id);
  const aggregateEvents = state.outboxKeysByAggregate.get(aggregateKey) ?? new Set<string>();
  for (const key of aggregateEvents) {
    const candidate = state.outbox.get(key);
    if (
      candidate !== undefined
      && candidate.aggregate_version < record.aggregate_version
      && candidate.status !== "published"
    ) return true;
  }
  return false;
}

function consumeFaultPoint(faultPoints: TransactionalOutboxFaultPoint[], point: TransactionalOutboxFaultPoint): boolean {
  const index = faultPoints.indexOf(point);
  if (index < 0) return false;
  faultPoints.splice(index, 1);
  return true;
}

function throwAtFaultPoint(faultPoints: TransactionalOutboxFaultPoint[], point: TransactionalOutboxFaultPoint): void {
  if (consumeFaultPoint(faultPoints, point)) throw new TransactionalOutboxTransactionError();
}


function compareOutboxRecords(left: TransactionalOutboxRecord, right: TransactionalOutboxRecord): number {
  return left.aggregate_id.localeCompare(right.aggregate_id)
    || left.aggregate_version - right.aggregate_version
    || left.event_id.localeCompare(right.event_id);
}

function tenantEventKey(tenantId: TenantId, eventId: string): string {
  return `${tenantId}\u0000${eventId}`;
}

function tenantAggregateKey(tenantId: TenantId, aggregateId: string): string {
  return `${tenantId}\u0000${aggregateId}`;
}

function immutableCopy<Value>(value: Value): Value {
  return deepFreeze(structuredClone(value));
}

function deepFreeze<Value>(value: Value): Value {
  if (value === null || typeof value !== "object") return value;
  for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  return Object.freeze(value);
}
