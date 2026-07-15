import {
  assertAuthorizedTenantMatch,
  getAuthorizedTenantContext,
  type AuthorizedRequestContext,
} from "@axtro/auth";
import type { EventEnvelope, SessionStateSnapshot } from "@axtro/contracts-ts";
import {
  canonicalJson,
  interactionStateHash,
  parseSessionId,
  parseUuidV7,
  reduceInteractionState,
  replayInteraction,
  sha256Canonical,
  type InteractionAggregateState,
  type SessionId,
  type TenantId,
  type UuidV7,
} from "@axtro/domain";

import { decodeInteractionEvent, encodeInteractionEvent } from "./codec.js";

export interface SessionTimelineRepositoryOptions {
  readonly max_sessions_per_tenant?: unknown;
  readonly max_events_per_session?: unknown;
  readonly max_snapshot_bytes?: unknown;
}

export interface SessionSnapshotMetadata {
  readonly snapshot_id: unknown;
  readonly created_at: unknown;
}

export interface SessionTimelineAppendReceipt {
  readonly tenant_id: TenantId;
  readonly session_id: SessionId;
  readonly event_id: UuidV7;
  readonly aggregate_version: number;
  readonly event_fingerprint: string;
  readonly state_hash: string;
}

export interface SessionTimelineRepository {
  appendCanonicalEvent(
    request: AuthorizedRequestContext,
    event: unknown,
  ): SessionTimelineAppendReceipt;
  listCanonicalEvents(
    request: AuthorizedRequestContext,
    sessionId: unknown,
    afterVersion: unknown,
  ): readonly EventEnvelope[];
  loadLatestSnapshot(
    request: AuthorizedRequestContext,
    sessionId: unknown,
  ): SessionStateSnapshot | null;
  materializeSnapshot(
    request: AuthorizedRequestContext,
    sessionId: unknown,
    metadata: SessionSnapshotMetadata,
  ): SessionStateSnapshot;
}

export class SessionTimelineAuthorizationError extends Error {
  constructor() {
    super("Session timeline access is not authorized");
    this.name = "SessionTimelineAuthorizationError";
  }
}

export class SessionTimelineValidationError extends Error {
  constructor() {
    super("Session timeline input is invalid");
    this.name = "SessionTimelineValidationError";
  }
}

export class SessionTimelineConflictError extends Error {
  constructor() {
    super("Session timeline input conflicts with canonical history");
    this.name = "SessionTimelineConflictError";
  }
}

export class SessionTimelineCapacityError extends Error {
  constructor() {
    super("Session timeline capacity is exhausted");
    this.name = "SessionTimelineCapacityError";
  }
}

interface StoredTimelineEvent {
  readonly envelope: EventEnvelope;
  readonly fingerprint: string;
  readonly receipt: SessionTimelineAppendReceipt;
}

interface StoredTimeline {
  readonly events: StoredTimelineEvent[];
  authoritativeState: InteractionAggregateState;
  snapshot: SessionStateSnapshot | null;
}

interface NormalizedOptions {
  readonly maxSessionsPerTenant: number;
  readonly maxEventsPerSession: number;
  readonly maxSnapshotBytes: number;
}

interface ParsedCanonicalEvent {
  readonly tenantId: TenantId;
  readonly sessionId: SessionId;
  readonly eventId: UuidV7;
  readonly aggregateVersion: number;
  readonly envelope: EventEnvelope;
  readonly domainEvent: ReturnType<typeof decodeInteractionEvent>;
  readonly fingerprint: string;
}

const DEFAULT_MAX_SESSIONS_PER_TENANT = 128;
const MAX_SESSIONS_PER_TENANT = 1_024;
const DEFAULT_MAX_EVENTS_PER_SESSION = 10_000;
const MAX_EVENTS_PER_SESSION = 10_000;
const DEFAULT_MAX_SNAPSHOT_BYTES = 1_000_000;
const MAX_SNAPSHOT_BYTES = 2_000_000;

/**
 * Deterministic M1 persistence model for the authoritative session timeline.
 * It has no network, database client, broker, provider, timer or global scan.
 */
export function createDeterministicSessionTimelineRepository(
  optionsInput?: SessionTimelineRepositoryOptions,
): SessionTimelineRepository {
  const options = normalizeOptions(optionsInput);
  const timelines = new Map<string, StoredTimeline>();
  const sessionKeysByTenant = new Map<TenantId, Set<string>>();
  const eventsByTenantIdentity = new Map<string, StoredTimelineEvent>();

  const repository: SessionTimelineRepository = {
    appendCanonicalEvent(request, eventInput): SessionTimelineAppendReceipt {
      const tenantId = requireScope(request, "session:write");
      const parsed = parseCanonicalEvent(request, tenantId, eventInput);
      const key = tenantSessionKey(tenantId, parsed.sessionId);
      const existingTimeline = timelines.get(key);
      const existingEvent = eventsByTenantIdentity.get(tenantEventKey(tenantId, parsed.eventId));
      if (existingEvent !== undefined) {
        if (existingEvent.fingerprint !== parsed.fingerprint) throw new SessionTimelineConflictError();
        return immutableCopy(existingEvent.receipt);
      }

      if (existingTimeline === undefined) {
        const tenantSessions = sessionKeysByTenant.get(tenantId);
        if ((tenantSessions?.size ?? 0) >= options.maxSessionsPerTenant) throw new SessionTimelineCapacityError();
      } else if (existingTimeline.events.length >= options.maxEventsPerSession) {
        throw new SessionTimelineCapacityError();
      }

      const expectedVersion = (existingTimeline?.events.length ?? 0) + 1;
      if (parsed.aggregateVersion !== expectedVersion) throw new SessionTimelineConflictError();

      let nextState: InteractionAggregateState;
      try {
        nextState = reduceInteractionState(existingTimeline?.authoritativeState, parsed.domainEvent);
      } catch {
        throw new SessionTimelineConflictError();
      }
      const stateHash = interactionStateHash(nextState);
      const receipt = immutableCopy<SessionTimelineAppendReceipt>({
        tenant_id: tenantId,
        session_id: parsed.sessionId,
        event_id: parsed.eventId,
        aggregate_version: parsed.aggregateVersion,
        event_fingerprint: parsed.fingerprint,
        state_hash: stateHash,
      });
      const storedEvent = immutableCopy<StoredTimelineEvent>({
        envelope: parsed.envelope,
        fingerprint: parsed.fingerprint,
        receipt,
      });

      if (existingTimeline === undefined) {
        const timeline: StoredTimeline = {
          events: [storedEvent],
          authoritativeState: immutableCopy(nextState),
          snapshot: null,
        };
        timelines.set(key, timeline);
        eventsByTenantIdentity.set(tenantEventKey(tenantId, parsed.eventId), storedEvent);
        const tenantSessions = sessionKeysByTenant.get(tenantId) ?? new Set<string>();
        tenantSessions.add(key);
        sessionKeysByTenant.set(tenantId, tenantSessions);
      } else {
        existingTimeline.events.push(storedEvent);
        eventsByTenantIdentity.set(tenantEventKey(tenantId, parsed.eventId), storedEvent);
        existingTimeline.authoritativeState = immutableCopy(nextState);
      }
      return immutableCopy(receipt);
    },

    listCanonicalEvents(request, sessionIdInput, afterVersionInput): readonly EventEnvelope[] {
      const tenantId = requireScope(request, "session:read");
      const sessionId = parseSessionIdForTimeline(sessionIdInput);
      const afterVersion = parseBoundedInteger(afterVersionInput, 0, MAX_EVENTS_PER_SESSION);
      const timeline = timelines.get(tenantSessionKey(tenantId, sessionId));
      if (timeline === undefined) return Object.freeze([]);
      return Object.freeze(
        timeline.events
          .filter((entry) => entry.receipt.aggregate_version > afterVersion)
          .map((entry) => immutableCopy(entry.envelope)),
      );
    },

    loadLatestSnapshot(request, sessionIdInput): SessionStateSnapshot | null {
      const tenantId = requireScope(request, "session:read");
      const sessionId = parseSessionIdForTimeline(sessionIdInput);
      const snapshot = timelines.get(tenantSessionKey(tenantId, sessionId))?.snapshot ?? null;
      return snapshot === null ? null : immutableCopy(snapshot);
    },

    materializeSnapshot(request, sessionIdInput, metadataInput): SessionStateSnapshot {
      const tenantId = requireScope(request, "session:write");
      if (requireScope(request, "session:read") !== tenantId) throw new SessionTimelineAuthorizationError();
      const sessionId = parseSessionIdForTimeline(sessionIdInput);
      const metadata = parseSnapshotMetadata(metadataInput);
      const timeline = timelines.get(tenantSessionKey(tenantId, sessionId));
      if (timeline === undefined || timeline.events.length < 1) throw new SessionTimelineConflictError();

      let replayed: InteractionAggregateState;
      try {
        replayed = replayInteraction(timeline.events.map((entry) => decodeInteractionEvent(entry.envelope)));
      } catch {
        throw new SessionTimelineConflictError();
      }
      const stateHash = interactionStateHash(replayed);
      if (
        stateHash !== interactionStateHash(timeline.authoritativeState)
        || replayed.session.tenant_id !== tenantId
        || replayed.session.session_id !== sessionId
      ) throw new SessionTimelineConflictError();

      const snapshot = immutableCopy<SessionStateSnapshot>({
        schema_version: "2.0.0",
        snapshot_id: metadata.snapshotId,
        tenant_id: tenantId,
        session_id: sessionId,
        aggregate_version: replayed.session.state_version,
        state: immutableCopy(replayed),
        state_hash: stateHash,
        created_at: metadata.createdAt,
      });
      const snapshotBytes = new TextEncoder().encode(canonicalJson(snapshot)).byteLength;
      if (snapshotBytes > options.maxSnapshotBytes) throw new SessionTimelineCapacityError();

      const existing = timeline.snapshot;
      if (existing !== null && existing.aggregate_version === snapshot.aggregate_version) {
        if (sha256Canonical(existing) !== sha256Canonical(snapshot)) throw new SessionTimelineConflictError();
        return immutableCopy(existing);
      }
      timeline.snapshot = snapshot;
      return immutableCopy(snapshot);
    },
  };
  return Object.freeze(repository);
}

function normalizeOptions(value: SessionTimelineRepositoryOptions | undefined): NormalizedOptions {
  if (value === undefined) {
    return Object.freeze({
      maxSessionsPerTenant: DEFAULT_MAX_SESSIONS_PER_TENANT,
      maxEventsPerSession: DEFAULT_MAX_EVENTS_PER_SESSION,
      maxSnapshotBytes: DEFAULT_MAX_SNAPSHOT_BYTES,
    });
  }
  const record = strictPlainRecord(value, ["max_sessions_per_tenant", "max_events_per_session", "max_snapshot_bytes"]);
  return Object.freeze({
    maxSessionsPerTenant: optionalBoundedInteger(
      record.max_sessions_per_tenant,
      DEFAULT_MAX_SESSIONS_PER_TENANT,
      1,
      MAX_SESSIONS_PER_TENANT,
    ),
    maxEventsPerSession: optionalBoundedInteger(
      record.max_events_per_session,
      DEFAULT_MAX_EVENTS_PER_SESSION,
      1,
      MAX_EVENTS_PER_SESSION,
    ),
    maxSnapshotBytes: optionalBoundedInteger(
      record.max_snapshot_bytes,
      DEFAULT_MAX_SNAPSHOT_BYTES,
      1_024,
      MAX_SNAPSHOT_BYTES,
    ),
  });
}

function parseCanonicalEvent(
  request: AuthorizedRequestContext,
  tenantId: TenantId,
  value: unknown,
): ParsedCanonicalEvent {
  let domainEvent: ReturnType<typeof decodeInteractionEvent>;
  try {
    domainEvent = decodeInteractionEvent(value);
  } catch {
    throw new SessionTimelineValidationError();
  }
  try {
    assertAuthorizedTenantMatch(request, domainEvent.tenant_id);
  } catch {
    throw new SessionTimelineAuthorizationError();
  }
  if (domainEvent.tenant_id !== tenantId) throw new SessionTimelineAuthorizationError();

  let sessionId: SessionId;
  let eventId: UuidV7;
  try {
    sessionId = parseSessionId(domainEvent.session_id);
    eventId = parseUuidV7(domainEvent.event_id, "event_id");
  } catch {
    throw new SessionTimelineValidationError();
  }
  if (domainEvent.aggregate_id !== sessionId) throw new SessionTimelineValidationError();
  const envelope = immutableCopy(encodeInteractionEvent(domainEvent));
  return Object.freeze({
    tenantId,
    sessionId,
    eventId,
    aggregateVersion: parseBoundedInteger(domainEvent.aggregate_version, 1, MAX_EVENTS_PER_SESSION),
    envelope,
    domainEvent,
    fingerprint: sha256Canonical(envelope),
  });
}

function parseSnapshotMetadata(value: SessionSnapshotMetadata): Readonly<{ snapshotId: UuidV7; createdAt: string }> {
  const record = strictPlainRecord(value, ["snapshot_id", "created_at"]);
  let snapshotId: UuidV7;
  try {
    snapshotId = parseUuidV7(record.snapshot_id, "snapshot_id");
  } catch {
    throw new SessionTimelineValidationError();
  }
  if (typeof record.created_at !== "string" || record.created_at.length > 40) throw new SessionTimelineValidationError();
  const timestamp = Date.parse(record.created_at);
  if (!Number.isFinite(timestamp)) throw new SessionTimelineValidationError();
  const createdAt = new Date(timestamp).toISOString();
  return Object.freeze({ snapshotId, createdAt });
}

function requireScope(request: AuthorizedRequestContext, scope: "session:read" | "session:write"): TenantId {
  try {
    const context = getAuthorizedTenantContext(request);
    if (
      !context.grantedScopes.includes(scope)
      || !context.purposes.includes("essential_processing")
    ) throw new SessionTimelineAuthorizationError();
    return context.tenantId;
  } catch (error) {
    if (error instanceof SessionTimelineAuthorizationError) throw error;
    throw new SessionTimelineAuthorizationError();
  }
}

function parseSessionIdForTimeline(value: unknown): SessionId {
  try {
    return parseSessionId(value);
  } catch {
    throw new SessionTimelineValidationError();
  }
}

function parseBoundedInteger(value: unknown, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new SessionTimelineValidationError();
  }
  return value;
}

function optionalBoundedInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined) return fallback;
  return parseBoundedInteger(value, minimum, maximum);
}

function strictPlainRecord(value: unknown, allowedKeys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new SessionTimelineValidationError();
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!allowedKeys.includes(key) || !("value" in descriptor)) throw new SessionTimelineValidationError();
  }
  return Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]));
}

function tenantSessionKey(tenantId: TenantId, sessionId: SessionId): string {
  return `${tenantId}\u0000${sessionId}`;
}

function tenantEventKey(tenantId: TenantId, eventId: UuidV7): string {
  return `${tenantId}\u0000${eventId}`;
}

function immutableCopy<Value>(value: Value): Value {
  return deepFreeze(structuredClone(value));
}

function deepFreeze<Value>(value: Value): Value {
  if (value === null || typeof value !== "object") return value;
  for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  return Object.freeze(value);
}
