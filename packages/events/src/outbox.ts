import {
  assertAuthorizedTenantMatch,
  getAuthorizedTenantContext,
  type AuthorizedRequestContext,
} from "@axtro/auth";
import type { EventEnvelope } from "@axtro/contracts-ts";
import {
  createDeterministicTransactionCoordinator,
  type TransactionalStateParticipant,
} from "@axtro/database";
import {
  parseInteractionEvent,
  parseSessionId,
  parseUuidV7,
  reduceInteractionState,
  type InteractionAggregateState,
  type TenantId,
} from "@axtro/domain";

import { decodeInteractionEvent, encodeInteractionEvent } from "./codec.js";

export const TRANSACTIONAL_OUTBOX_FAULT_POINTS = [
  "after_aggregate_write",
  "after_outbox_insert",
  "before_commit",
  "before_publish_ack",
] as const;

export type TransactionalOutboxFaultPoint = (typeof TRANSACTIONAL_OUTBOX_FAULT_POINTS)[number];
export type TransactionalOutboxStatus = "pending" | "publishing" | "published" | "failed";
export type TransactionalOutboxRelayOutcome = "idle" | "published" | "retry_scheduled";

export interface DeterministicTransactionalOutboxOptions {
  /** Closed, one-shot local test seams. They never leave this in-memory fake. */
  readonly faultPoints?: readonly TransactionalOutboxFaultPoint[];
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

export interface TransactionalOutboxRelayResult {
  readonly outcome: TransactionalOutboxRelayOutcome;
  readonly event_id: string | null;
  readonly aggregate_id: string | null;
  readonly aggregate_version: number | null;
  readonly attempts: number | null;
}

export interface DeterministicConsumerEffect {
  readonly event_id: string;
  readonly effect_count: number;
  readonly delivery_count: number;
}

/** A branded, local-only fake consumer. It cannot be invoked without the relay. */
export interface DeterministicIdempotentConsumer {
  readonly name: string;
}

export interface TransactionalOutboxRepository {
  commitInteractionEvent(
    request: AuthorizedRequestContext,
    eventInput: unknown,
  ): Promise<TransactionalOutboxCommitResult>;
  readInteractionAggregate(
    request: AuthorizedRequestContext,
    aggregateId: unknown,
  ): InteractionAggregateState | null;
  listOutbox(request: AuthorizedRequestContext): readonly TransactionalOutboxRecord[];
  /** Local fake inspection seam used to prove per-aggregate relay ordering. */
  isRelayEligible(request: AuthorizedRequestContext, eventId: unknown): boolean;
  relayOnce(
    request: AuthorizedRequestContext,
    consumer: DeterministicIdempotentConsumer,
  ): Promise<TransactionalOutboxRelayResult>;
  readConsumerEffect(
    request: AuthorizedRequestContext,
    consumer: DeterministicIdempotentConsumer,
    eventId: unknown,
  ): DeterministicConsumerEffect | null;
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

interface StoredOutboxRecord extends TransactionalOutboxRecord {}

interface RepositoryState {
  readonly aggregates: Map<string, InteractionAggregateState>;
  readonly outbox: Map<string, StoredOutboxRecord>;
  readonly outboxKeysByTenant: Map<TenantId, Set<string>>;
  readonly outboxKeysByAggregate: Map<string, Set<string>>;
}

interface ConsumerEffectState {
  readonly effects: Map<string, DeterministicConsumerEffect>;
}

const CONSUMER_EFFECTS = new WeakMap<object, ConsumerEffectState>();
const CONSUMER_NAME_PATTERN = /^[a-z][a-z0-9_-]{2,63}$/;
const MAX_FAULT_POINTS = 16;

/**
 * A deterministic M0 fake for an atomic aggregate-plus-outbox write. It uses
 * the existing event envelope codec and an authenticated request context, and
 * has no network, worker, broker, timer, provider or global tenant scan.
 */
export function createDeterministicTransactionalOutboxRepository(
  optionsInput?: DeterministicTransactionalOutboxOptions,
): TransactionalOutboxRepository {
  const faultPoints = parseFaultPoints(optionsInput);
  const coordinator = createDeterministicTransactionCoordinator();
  let state: RepositoryState = emptyState();
  const participant: TransactionalStateParticipant<RepositoryState> = {
    captureSnapshot: () => cloneState(state),
    restoreSnapshot: (snapshot) => {
      state = cloneState(snapshot);
    },
  };

  const repository: TransactionalOutboxRepository = {
    async commitInteractionEvent(request, eventInput): Promise<TransactionalOutboxCommitResult> {
      const tenantId = requireScope(request, "session:write");
      const event = parseInteractionEvent(eventInput);
      assertAuthorizedTenantMatch(request, event.tenant_id);
      if (event.tenant_id !== tenantId) throw new TransactionalOutboxAuthorizationError();
      const canonicalEvent = decodeInteractionEvent(encodeInteractionEvent(event));
      const eventKey = tenantEventKey(tenantId, canonicalEvent.event_id);
      const aggregateKey = tenantAggregateKey(tenantId, canonicalEvent.aggregate_id);

      return coordinator.execute(participant, () => {
        if (state.outbox.has(eventKey)) throw new TransactionalOutboxConflictError();
        const aggregate = reduceInteractionState(state.aggregates.get(aggregateKey), canonicalEvent);
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
        addOutboxIndex(state, tenantId, aggregateKey, eventKey);
        throwAtFaultPoint(faultPoints, "after_outbox_insert");
        throwAtFaultPoint(faultPoints, "before_commit");

        return immutableCopy({ aggregate, outbox: record });
      });
    },

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

    isRelayEligible(request, eventId): boolean {
      const tenantId = requireScope(request, "session:write");
      const normalizedEventId = parseUuidV7(eventId, "event_id");
      const record = state.outbox.get(tenantEventKey(tenantId, normalizedEventId));
      return record !== undefined && isClaimableRecord(state, record);
    },

    async relayOnce(request, consumer): Promise<TransactionalOutboxRelayResult> {
      const tenantId = requireScope(request, "session:write");
      const consumerState = requireConsumer(consumer);
      const claimed = await coordinator.execute(participant, () => claimNextRecord(state, tenantId));
      if (claimed === null) return emptyRelayResult();

      recordConsumerDelivery(consumerState, claimed);
      if (consumeFaultPoint(faultPoints, "before_publish_ack")) {
        const failed = await coordinator.execute(participant, () => transitionRelayRecord(state, tenantId, claimed.event_id, "failed"));
        return relayResult("retry_scheduled", failed);
      }
      const published = await coordinator.execute(participant, () => transitionRelayRecord(state, tenantId, claimed.event_id, "published"));
      return relayResult("published", published);
    },

    readConsumerEffect(request, consumer, eventId): DeterministicConsumerEffect | null {
      const tenantId = requireScope(request, "session:read");
      const normalizedEventId = parseUuidV7(eventId, "event_id");
      const consumerState = requireConsumer(consumer);
      const effect = consumerState.effects.get(tenantEventKey(tenantId, normalizedEventId));
      return effect === undefined ? null : immutableCopy(effect);
    },
  };
  return Object.freeze(repository);
}

export function createDeterministicIdempotentConsumer(nameInput: unknown): DeterministicIdempotentConsumer {
  if (typeof nameInput !== "string" || !CONSUMER_NAME_PATTERN.test(nameInput)) {
    throw new TransactionalOutboxConfigurationError();
  }
  const consumer = Object.freeze({ name: nameInput }) as DeterministicIdempotentConsumer;
  CONSUMER_EFFECTS.set(consumer, { effects: new Map<string, DeterministicConsumerEffect>() });
  return consumer;
}

function requireScope(request: AuthorizedRequestContext, scope: "session:read" | "session:write"): TenantId {
  const context = getAuthorizedTenantContext(request);
  if (!context.grantedScopes.includes(scope)) throw new TransactionalOutboxAuthorizationError();
  return context.tenantId;
}

function requireConsumer(consumer: DeterministicIdempotentConsumer): ConsumerEffectState {
  if (consumer === null || typeof consumer !== "object") throw new TransactionalOutboxConfigurationError();
  const state = CONSUMER_EFFECTS.get(consumer);
  if (state === undefined) throw new TransactionalOutboxConfigurationError();
  return state;
}

function parseFaultPoints(optionsInput: DeterministicTransactionalOutboxOptions | undefined): TransactionalOutboxFaultPoint[] {
  if (optionsInput === undefined) return [];
  const record = strictPlainRecord(optionsInput, ["faultPoints"]);
  if (!("faultPoints" in record)) return [];
  const values = record.faultPoints;
  if (!Array.isArray(values) || values.length > MAX_FAULT_POINTS) throw new TransactionalOutboxConfigurationError();
  const parsed: TransactionalOutboxFaultPoint[] = [];
  for (const value of values) {
    if (!TRANSACTIONAL_OUTBOX_FAULT_POINTS.includes(value as TransactionalOutboxFaultPoint)) {
      throw new TransactionalOutboxConfigurationError();
    }
    parsed.push(value as TransactionalOutboxFaultPoint);
  }
  return parsed;
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
  };
}

function cloneState(source: RepositoryState): RepositoryState {
  return {
    aggregates: new Map([...source.aggregates].map(([key, value]) => [key, immutableCopy(value)])),
    outbox: new Map([...source.outbox].map(([key, value]) => [key, immutableCopy(value)])),
    outboxKeysByTenant: new Map([...source.outboxKeysByTenant].map(([key, value]) => [key, new Set(value)])),
    outboxKeysByAggregate: new Map([...source.outboxKeysByAggregate].map(([key, value]) => [key, new Set(value)])),
  };
}

function addOutboxIndex(state: RepositoryState, tenantId: TenantId, aggregateKey: string, eventKey: string): void {
  const tenantKeys = state.outboxKeysByTenant.get(tenantId) ?? new Set<string>();
  tenantKeys.add(eventKey);
  state.outboxKeysByTenant.set(tenantId, tenantKeys);
  const aggregateKeys = state.outboxKeysByAggregate.get(aggregateKey) ?? new Set<string>();
  aggregateKeys.add(eventKey);
  state.outboxKeysByAggregate.set(aggregateKey, aggregateKeys);
}

function claimNextRecord(state: RepositoryState, tenantId: TenantId): TransactionalOutboxRecord | null {
  const tenantKeys = state.outboxKeysByTenant.get(tenantId) ?? new Set<string>();
  const candidates = [...tenantKeys]
    .map((key) => state.outbox.get(key))
    .filter((record): record is StoredOutboxRecord => record !== undefined)
    .filter((record) => record.status === "pending" || record.status === "failed")
    .sort(compareOutboxRecords);
  for (const record of candidates) {
    if (!isClaimableRecord(state, record)) continue;
    const claimed = immutableCopy<StoredOutboxRecord>({ ...record, status: "publishing", attempts: record.attempts + 1 });
    state.outbox.set(tenantEventKey(tenantId, record.event_id), claimed);
    return immutableCopy(claimed);
  }
  return null;
}

function isClaimableRecord(state: RepositoryState, record: StoredOutboxRecord): boolean {
  return (record.status === "pending" || record.status === "failed") && !hasUnpublishedPredecessor(state, record);
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

function transitionRelayRecord(
  state: RepositoryState,
  tenantId: TenantId,
  eventId: string,
  status: "published" | "failed",
): TransactionalOutboxRecord {
  const key = tenantEventKey(tenantId, eventId);
  const record = state.outbox.get(key);
  if (record === undefined || record.status !== "publishing") throw new TransactionalOutboxConflictError();
  const transitioned = immutableCopy<StoredOutboxRecord>({ ...record, status });
  state.outbox.set(key, transitioned);
  return immutableCopy(transitioned);
}

function recordConsumerDelivery(consumer: ConsumerEffectState, record: TransactionalOutboxRecord): void {
  const key = tenantEventKey(record.tenant_id, record.event_id);
  const existing = consumer.effects.get(key);
  const effect = existing === undefined
    ? { event_id: record.event_id, effect_count: 1, delivery_count: 1 }
    : { event_id: existing.event_id, effect_count: existing.effect_count, delivery_count: existing.delivery_count + 1 };
  consumer.effects.set(key, immutableCopy(effect));
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

function relayResult(
  outcome: Exclude<TransactionalOutboxRelayOutcome, "idle">,
  record: TransactionalOutboxRecord,
): TransactionalOutboxRelayResult {
  return Object.freeze({
    outcome,
    event_id: record.event_id,
    aggregate_id: record.aggregate_id,
    aggregate_version: record.aggregate_version,
    attempts: record.attempts,
  });
}

function emptyRelayResult(): TransactionalOutboxRelayResult {
  return Object.freeze({ outcome: "idle", event_id: null, aggregate_id: null, aggregate_version: null, attempts: null });
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
