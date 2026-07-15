import {
  getAuthorizedTenantContext,
  type AuthorizedRequestContext,
} from "@axtro/auth";
import type { EventEnvelope, SessionStateSnapshot } from "@axtro/contracts-ts";
import {
  canonicalJson,
  deepFreeze,
  interactionStateHash,
  parseSessionId,
  parseUuidV7,
  reduceInteractionState,
  sha256Canonical,
  type InteractionAggregateState,
  type SessionId,
  type TenantId,
  type UuidV7,
} from "@axtro/domain";
import {
  SessionTimelineAuthorizationError,
  decodeInteractionEvent,
  type SessionTimelineRepository,
} from "@axtro/events";

export interface SessionActorSnapshot {
  readonly aggregate_version: number;
  readonly state: InteractionAggregateState;
  readonly state_hash: string;
}

export interface SessionReplayVerificationResult {
  readonly tenant_id: TenantId;
  readonly session_id: SessionId;
  readonly aggregate_version: number;
  readonly state: InteractionAggregateState;
  readonly state_hash: string;
  readonly snapshot_version: number | null;
  readonly full_event_count: number;
  readonly tail_event_count: number;
}

/**
 * Tenant-scoped read boundary. M1 deliberately has no actor write port: the
 * timeline writer commits an envelope before the actor observes it.
 */
export interface SessionActorReplaySource {
  loadSnapshot(
    request: AuthorizedRequestContext,
    sessionId: SessionId,
    control?: SessionActorReplayControl,
  ): Promise<SessionActorSnapshot | null>;
  listTimeline(
    request: AuthorizedRequestContext,
    sessionId: SessionId,
    afterVersion: number,
    control?: SessionActorReplayControl,
  ): Promise<readonly EventEnvelope[]>;
}

/** Local fake only, used to prove replay without selecting a durable store. */
export interface DeterministicSessionActorReplaySource extends SessionActorReplaySource {
  appendCanonicalEvent(event: unknown): void;
  storeSnapshot(snapshot: unknown): void;
  /** Closed test seam for malformed-cache recovery tests. Never use in a runtime adapter. */
  setSnapshotForTest(tenantId: unknown, sessionId: unknown, snapshot: unknown): void;
}

export interface SessionRuntimeClock {
  now(): number;
}

/** Internal cancellation boundary for replay-source I/O. */
export interface SessionActorReplayControl {
  readonly signal: AbortSignal;
  readonly timeout_ms: number;
}

/** Injectable only so deterministic tests can fire a replay deadline directly. */
export interface SessionRuntimeTimeoutScheduler {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface SessionActorRegistryOptions {
  readonly source: SessionActorReplaySource;
  readonly max_actors?: unknown;
  readonly mailbox_capacity?: unknown;
  readonly max_dedupe_entries?: unknown;
  readonly source_timeout_ms?: unknown;
  readonly clock?: SessionRuntimeClock;
  readonly timeout_scheduler?: SessionRuntimeTimeoutScheduler;
}

export interface SessionActorRegistry {
  getActor(request: AuthorizedRequestContext, sessionId: unknown): Promise<SessionActor>;
  actorCount(): number;
}

export interface SessionActorEventResult {
  readonly event_id: UuidV7;
  readonly aggregate_version: number;
  readonly state: InteractionAggregateState;
  readonly state_hash: string;
  readonly trace_id: string;
  readonly correlation_id: UuidV7;
}

export interface SessionActorGeneration {
  readonly generation_id: number;
  readonly signal: AbortSignal;
}

export interface SessionActorGenerationCancellationInput {
  readonly command_id: unknown;
  readonly generation_id: unknown;
  readonly reason_code: unknown;
}

export interface SessionActorGenerationCancellationResult {
  readonly generation_id: number;
  readonly status: "cancelled" | "stale";
}

export interface SessionActorMetrics {
  readonly mailbox_depth: number;
  readonly mailbox_high_watermark: number;
  readonly reductions_applied: number;
  readonly duplicate_deliveries: number;
  readonly rejected_deliveries: number;
  readonly generation_cancellations: number;
  readonly last_queue_wait_ms: number;
  readonly last_reduction_duration_ms: number;
}

export interface SessionActor {
  getState(request: AuthorizedRequestContext): Promise<InteractionAggregateState>;
  snapshot(request: AuthorizedRequestContext): Promise<SessionActorSnapshot>;
  applyCanonicalEvent(request: AuthorizedRequestContext, event: unknown): Promise<SessionActorEventResult>;
  beginGeneration(request: AuthorizedRequestContext): Promise<SessionActorGeneration>;
  cancelGeneration(
    request: AuthorizedRequestContext,
    input: SessionActorGenerationCancellationInput,
  ): Promise<SessionActorGenerationCancellationResult>;
  canPublishGeneration(request: AuthorizedRequestContext, generationId: unknown): boolean;
  metrics(request: AuthorizedRequestContext): SessionActorMetrics;
}

export class SessionActorValidationError extends Error {
  constructor() {
    super("Session actor input is invalid");
    this.name = "SessionActorValidationError";
  }
}

export class SessionActorAuthorizationError extends Error {
  constructor() {
    super("Session actor access is not authorized");
    this.name = "SessionActorAuthorizationError";
  }
}

export class SessionActorConflictError extends Error {
  constructor() {
    super("Session actor command conflicts with authoritative state");
    this.name = "SessionActorConflictError";
  }
}

export class SessionActorReplayError extends Error {
  constructor() {
    super("Session actor replay data is invalid");
    this.name = "SessionActorReplayError";
  }
}

export class SessionActorReplayWindowError extends Error {
  constructor() {
    super("Session actor historical delivery is outside the replay window");
    this.name = "SessionActorReplayWindowError";
  }
}

export class SessionActorSourceTimeoutError extends Error {
  constructor() {
    super("Session actor replay source exceeded its deadline");
    this.name = "SessionActorSourceTimeoutError";
  }
}

export class SessionActorHistoricalLookupCapacityError extends Error {
  constructor() {
    super("Session actor historical replay lookup capacity is exhausted");
    this.name = "SessionActorHistoricalLookupCapacityError";
  }
}

export class SessionActorNotFoundError extends Error {
  constructor() {
    super("Session actor source has no canonical session history");
    this.name = "SessionActorNotFoundError";
  }
}

interface InternalReplayVerification {
  readonly result: SessionReplayVerificationResult;
  readonly replay: ReplayResult;
}

export class SessionActorCapacityError extends Error {
  constructor() {
    super("Session actor capacity is exhausted");
    this.name = "SessionActorCapacityError";
  }
}

export class SessionActorMailboxCapacityError extends Error {
  constructor() {
    super("Session actor mailbox is full");
    this.name = "SessionActorMailboxCapacityError";
  }
}

interface ActorAddress {
  readonly tenantId: TenantId;
  readonly sessionId: SessionId;
}

interface NormalizedRegistryOptions {
  readonly source: SessionActorReplaySource;
  readonly maxActors: number;
  readonly mailboxCapacity: number;
  readonly maxDedupeEntries: number;
  readonly sourceTimeoutMs: number;
  readonly clock: SessionRuntimeClock;
  readonly timeoutScheduler: SessionRuntimeTimeoutScheduler;
}

interface ParsedCanonicalEnvelope {
  readonly envelope: EventEnvelope;
  readonly eventId: UuidV7;
  readonly aggregateVersion: number;
  readonly traceId: string;
  readonly correlationId: UuidV7;
  readonly fingerprint: string;
  readonly reduce: (state: InteractionAggregateState | undefined) => InteractionAggregateState;
}

interface ReplayEntry {
  readonly parsed: ParsedCanonicalEnvelope;
  readonly state: InteractionAggregateState;
  readonly result: SessionActorEventResult;
}

interface ReplayResult {
  readonly state: InteractionAggregateState;
  readonly entries: readonly ReplayEntry[];
}

interface DeliveryRecord {
  readonly fingerprint: string;
  readonly result: Promise<SessionActorEventResult>;
  settled: boolean;
}

interface ControlRecord {
  readonly fingerprint: string;
  readonly result: Promise<SessionActorGenerationCancellationResult>;
  settled: boolean;
}

interface HistoricalLookupRecord {
  readonly fingerprint: string;
  readonly result: Promise<SessionActorEventResult | null>;
}

interface ActiveGeneration {
  readonly id: number;
  readonly controller: AbortController;
  valid: boolean;
}

interface MutableActorMetrics {
  mailboxDepth: number;
  mailboxHighWatermark: number;
  reductionsApplied: number;
  duplicateDeliveries: number;
  rejectedDeliveries: number;
  generationCancellations: number;
  lastQueueWaitMs: number;
  lastReductionDurationMs: number;
}

interface DeterministicReplaySourceState {
  readonly snapshots: Map<string, unknown>;
  readonly timelines: Map<string, EventEnvelope[]>;
}

const DETERMINISTIC_SOURCES = new WeakMap<object, DeterministicReplaySourceState>();
const DEFAULT_MAX_ACTORS = 128;
const MAX_ACTORS = 1_024;
const DEFAULT_MAILBOX_CAPACITY = 32;
const MAX_MAILBOX_CAPACITY = 512;
const DEFAULT_MAX_DEDUPE_ENTRIES = 1_024;
const MAX_DEDUPE_ENTRIES = 4_096;
const MAX_REPLAY_EVENTS = 10_000;
const DEFAULT_SOURCE_TIMEOUT_MS = 1_000;
const MAX_SOURCE_TIMEOUT_MS = 10_000;
const MAX_IN_FLIGHT_HISTORICAL_LOOKUPS = 1;
const GENERATION_REASON_CODES = ["barge_in", "safety_stop", "session_terminate", "superseded"] as const;
type GenerationReasonCode = (typeof GENERATION_REASON_CODES)[number];

/** Build a cache snapshot only after the existing domain validator accepts it. */
export function createSessionActorSnapshot(stateInput: InteractionAggregateState): SessionActorSnapshot {
  const state = immutableCopy(stateInput);
  const stateHash = interactionStateHash(state);
  return immutableCopy({
    aggregate_version: state.session.state_version,
    state,
    state_hash: stateHash,
  });
}

/**
 * Local deterministic replay source. It deliberately stores canonical events
 * only and provides no actor mutation or outbox operation.
 */
export function createDeterministicSessionActorReplaySource(): DeterministicSessionActorReplaySource {
  const source = {
    async loadSnapshot(request: AuthorizedRequestContext, sessionIdInput: SessionId): Promise<SessionActorSnapshot | null> {
      const tenantId = requireTenantScope(request, "session:read");
      const sessionId = parseSessionId(sessionIdInput);
      const state = requireDeterministicSource(source);
      const snapshot = state.snapshots.get(actorKey({ tenantId, sessionId }));
      return snapshot === undefined ? null : immutableCopy(snapshot) as SessionActorSnapshot;
    },

    async listTimeline(
      request: AuthorizedRequestContext,
      sessionIdInput: SessionId,
      afterVersionInput: number,
    ): Promise<readonly EventEnvelope[]> {
      const tenantId = requireTenantScope(request, "session:read");
      const sessionId = parseSessionId(sessionIdInput);
      const afterVersion = parseVersion(afterVersionInput, 0, SessionActorValidationError);
      const state = requireDeterministicSource(source);
      const timeline = state.timelines.get(actorKey({ tenantId, sessionId })) ?? [];
      return Object.freeze(
        timeline
          .filter((event) => event.aggregate_version > afterVersion)
          .map((event) => immutableCopy(event)),
      );
    },

    appendCanonicalEvent(eventInput: unknown): void {
      const parsed = parseCanonicalEnvelope(eventInput, undefined);
      const sessionId = parseEventSessionId(parsed);
      const state = requireDeterministicSource(source);
      const key = actorKey({ tenantId: parsed.eventTenantId, sessionId });
      const timeline = state.timelines.get(key) ?? [];
      timeline.push(immutableCopy(parsed.envelope));
      state.timelines.set(key, timeline);
    },

    storeSnapshot(snapshotInput: unknown): void {
      const snapshot = normalizeSnapshot(snapshotInput, undefined);
      const state = requireDeterministicSource(source);
      const tenantId = parseTenantIdForActor(snapshot.state.session.tenant_id, SessionActorReplayError);
      const sessionId = parseSessionIdForActor(snapshot.state.session.session_id, SessionActorReplayError);
      const key = actorKey({ tenantId, sessionId });
      state.snapshots.set(key, immutableCopy(snapshot));
    },

    setSnapshotForTest(tenantIdInput: unknown, sessionIdInput: unknown, snapshot: unknown): void {
      const tenantId = parseTenantIdForActor(tenantIdInput, SessionActorValidationError);
      const sessionId = parseSessionIdForActor(sessionIdInput, SessionActorValidationError);
      const state = requireDeterministicSource(source);
      state.snapshots.set(actorKey({ tenantId, sessionId }), immutableCopy(snapshot));
    },
  } satisfies DeterministicSessionActorReplaySource;
  DETERMINISTIC_SOURCES.set(source, { snapshots: new Map(), timelines: new Map() });
  return Object.freeze(source);
}

/** Adapt the tenant-scoped timeline repository without giving the Actor a write port. */
export function createSessionTimelineReplaySource(repositoryInput: SessionTimelineRepository): SessionActorReplaySource {
  if (
    repositoryInput === null
    || typeof repositoryInput !== "object"
    || typeof repositoryInput.listCanonicalEvents !== "function"
    || typeof repositoryInput.loadLatestSnapshot !== "function"
  ) throw new SessionActorValidationError();

  const source: SessionActorReplaySource = {
    async loadSnapshot(request, sessionIdInput, control): Promise<SessionActorSnapshot | null> {
      assertReplayControlActive(control);
      try {
        const snapshot = repositoryInput.loadLatestSnapshot(request, sessionIdInput);
        assertReplayControlActive(control);
        if (snapshot === null) return null;
        return actorSnapshotFromPersisted(snapshot, request, sessionIdInput);
      } catch (error) {
        if (error instanceof SessionTimelineAuthorizationError) throw new SessionActorAuthorizationError();
        throw error;
      }
    },

    async listTimeline(request, sessionIdInput, afterVersion, control): Promise<readonly EventEnvelope[]> {
      assertReplayControlActive(control);
      try {
        const timeline = repositoryInput.listCanonicalEvents(request, sessionIdInput, afterVersion);
        assertReplayControlActive(control);
        return timeline;
      } catch (error) {
        if (error instanceof SessionTimelineAuthorizationError) throw new SessionActorAuthorizationError();
        throw error;
      }
    },
  };
  return Object.freeze(source);
}

/**
 * Prove that authoritative replay from zero equals an optional snapshot plus a
 * separately read canonical tail. This function performs reads only.
 */
export async function verifySessionReplay(
  request: AuthorizedRequestContext,
  sessionIdInput: unknown,
  sourceInput: SessionActorReplaySource,
  control?: SessionActorReplayControl,
): Promise<SessionReplayVerificationResult> {
  const tenantId = requireTenantScope(request, "session:read");
  const sessionId = parseSessionIdForActor(sessionIdInput, SessionActorValidationError);
  const source = requireReplaySource(sourceInput);
  return (await verifySessionReplayInternal(request, { tenantId, sessionId }, source, control)).result;
}

/** Creates the per-tenant, per-session actor registry without a global mailbox. */
export function createSessionActorRegistry(optionsInput: SessionActorRegistryOptions): SessionActorRegistry {
  const options = normalizeRegistryOptions(optionsInput);
  const actors = new Map<string, InProcessSessionActor>();
  return Object.freeze({
    async getActor(request: AuthorizedRequestContext, sessionIdInput: unknown): Promise<SessionActor> {
      const tenantId = requireTenantScope(request, "session:read");
      const sessionId = parseSessionIdForActor(sessionIdInput, SessionActorValidationError);
      const address = Object.freeze({ tenantId, sessionId });
      const key = actorKey(address);
      let actor = actors.get(key);
      const created = actor === undefined;
      if (actor === undefined) {
        if (actors.size >= options.maxActors) throw new SessionActorCapacityError();
        actor = new InProcessSessionActor(address, options);
        actors.set(key, actor);
      }
      try {
        await actor.getState(request);
      } catch (error) {
        if (created && actors.get(key) === actor) actors.delete(key);
        throw error;
      }
      return actor;
    },

    actorCount(): number {
      return actors.size;
    },
  } satisfies SessionActorRegistry);
}

class InProcessSessionActor implements SessionActor {
  readonly #address: ActorAddress;
  readonly #source: SessionActorReplaySource;
  readonly #maxDedupeEntries: number;
  readonly #sourceTimeoutMs: number;
  readonly #clock: SessionRuntimeClock;
  readonly #timeoutScheduler: SessionRuntimeTimeoutScheduler;
  readonly #mailbox: BoundedActorMailbox;
  readonly #deliveries = new Map<string, DeliveryRecord>();
  readonly #historicalLookups = new Map<string, HistoricalLookupRecord>();
  readonly #controls = new Map<string, ControlRecord>();
  readonly #metrics: MutableActorMetrics = {
    mailboxDepth: 0,
    mailboxHighWatermark: 0,
    reductionsApplied: 0,
    duplicateDeliveries: 0,
    rejectedDeliveries: 0,
    generationCancellations: 0,
    lastQueueWaitMs: 0,
    lastReductionDurationMs: 0,
  };
  #state: InteractionAggregateState | undefined;
  #hydrating: Promise<void> | undefined;
  #nextGenerationId = 0;
  #activeGeneration: ActiveGeneration | null = null;

  constructor(address: ActorAddress, options: NormalizedRegistryOptions) {
    this.#address = address;
    this.#source = options.source;
    this.#maxDedupeEntries = options.maxDedupeEntries;
    this.#sourceTimeoutMs = options.sourceTimeoutMs;
    this.#clock = options.clock;
    this.#timeoutScheduler = options.timeoutScheduler;
    this.#mailbox = new BoundedActorMailbox(options.mailboxCapacity, () => this.#recordMailboxDepth());
  }

  async getState(request: AuthorizedRequestContext): Promise<InteractionAggregateState> {
    await this.#ensureHydrated(request);
    const state = this.#state;
    if (state === undefined) throw new SessionActorNotFoundError();
    return immutableCopy(state);
  }

  async snapshot(request: AuthorizedRequestContext): Promise<SessionActorSnapshot> {
    const state = await this.getState(request);
    return createSessionActorSnapshot(state);
  }

  async applyCanonicalEvent(request: AuthorizedRequestContext, eventInput: unknown): Promise<SessionActorEventResult> {
    this.#assertTenant(request, "session:write");
    await this.#ensureHydrated(request);
    const parsed = parseCanonicalEnvelope(eventInput, this.#address);
    const existing = this.#deliveries.get(parsed.eventId);
    if (existing !== undefined) {
      if (existing.fingerprint !== parsed.fingerprint) throw new SessionActorConflictError();
      this.#metrics.duplicateDeliveries += 1;
      return existing.result;
    }
    if (parsed.aggregateVersion <= this.#requireState().session.state_version) {
      const historical = await this.#lookupHistoricalDelivery(request, parsed);
      if (historical === null) throw new SessionActorReplayWindowError();
      this.#metrics.duplicateDeliveries += 1;
      return historical;
    }
    this.#evictSettledDeliveriesForCapacity();
    if (this.#deliveries.size >= this.#maxDedupeEntries) throw new SessionActorCapacityError();

    const queuedAt = this.#clock.now();
    let queued: Promise<SessionActorEventResult>;
    try {
      queued = this.#mailbox.enqueue("canonical", () => this.#reduceCanonicalEvent(parsed, queuedAt)).then((outcome) => {
        if (outcome.controller !== null) outcome.controller.abort("state_changed");
        return outcome.result;
      });
    } catch (error) {
      this.#metrics.rejectedDeliveries += 1;
      throw error;
    }
    const record: DeliveryRecord = { fingerprint: parsed.fingerprint, result: queued, settled: false };
    this.#deliveries.set(parsed.eventId, record);
    void queued.then(
      () => {
        record.settled = true;
      },
      () => {
        if (this.#deliveries.get(parsed.eventId) === record) this.#deliveries.delete(parsed.eventId);
        this.#metrics.rejectedDeliveries += 1;
      },
    );
    return queued;
  }

  async beginGeneration(request: AuthorizedRequestContext): Promise<SessionActorGeneration> {
    this.#assertTenant(request, "session:write");
    await this.#ensureHydrated(request);
    const transition = await this.#mailbox.enqueue("control", () => {
      const state = this.#requireState();
      if (isTerminal(state)) throw new SessionActorConflictError();
      const previous = this.#activeGeneration;
      if (previous !== null) previous.valid = false;
      const generation: ActiveGeneration = {
        id: this.#nextGenerationId += 1,
        controller: new AbortController(),
        valid: true,
      };
      this.#activeGeneration = generation;
      return Object.freeze({
        generation: Object.freeze({ generation_id: generation.id, signal: generation.controller.signal }),
        previousController: previous?.controller ?? null,
      });
    });
    if (transition.previousController !== null) transition.previousController.abort("superseded");
    return transition.generation;
  }

  async cancelGeneration(
    request: AuthorizedRequestContext,
    input: SessionActorGenerationCancellationInput,
  ): Promise<SessionActorGenerationCancellationResult> {
    this.#assertTenant(request, "session:write");
    await this.#ensureHydrated(request);
    const command = normalizeGenerationCancellation(input);
    const existing = this.#controls.get(command.commandId);
    if (existing !== undefined) {
      if (existing.fingerprint !== command.fingerprint) throw new SessionActorConflictError();
      return existing.result;
    }
    this.#evictSettledControlsForCapacity();
    if (this.#controls.size >= this.#maxDedupeEntries) throw new SessionActorCapacityError();

    let queued: Promise<SessionActorGenerationCancellationResult>;
    try {
      queued = this.#mailbox.enqueue("safety", () => {
        const active = this.#activeGeneration;
        if (active === null || active.id !== command.generationId || !active.valid) {
          return Object.freeze({
            result: Object.freeze({ generation_id: command.generationId, status: "stale" as const }),
            controller: null,
          });
        }
        active.valid = false;
        this.#activeGeneration = null;
        this.#metrics.generationCancellations += 1;
        return Object.freeze({
          result: Object.freeze({ generation_id: command.generationId, status: "cancelled" as const }),
          controller: active.controller,
        });
      }).then((outcome) => {
        if (outcome.controller !== null) outcome.controller.abort(command.reasonCode);
        return outcome.result;
      });
    } catch (error) {
      throw error;
    }
    const record: ControlRecord = { fingerprint: command.fingerprint, result: queued, settled: false };
    this.#controls.set(command.commandId, record);
    void queued.then(
      () => {
        record.settled = true;
      },
      () => {
        if (this.#controls.get(command.commandId) === record) this.#controls.delete(command.commandId);
      },
    );
    return queued;
  }

  canPublishGeneration(request: AuthorizedRequestContext, generationIdInput: unknown): boolean {
    this.#assertTenant(request, "session:read");
    const generationId = parseGenerationId(generationIdInput);
    const active = this.#activeGeneration;
    const state = this.#state;
    return active !== null
      && active.id === generationId
      && active.valid
      && state !== undefined
      && state.session.status === "active"
      && state.session.active_presenter_id !== null;
  }

  metrics(request: AuthorizedRequestContext): SessionActorMetrics {
    this.#assertTenant(request, "session:read");
    this.#recordMailboxDepth();
    return Object.freeze({
      mailbox_depth: this.#metrics.mailboxDepth,
      mailbox_high_watermark: this.#metrics.mailboxHighWatermark,
      reductions_applied: this.#metrics.reductionsApplied,
      duplicate_deliveries: this.#metrics.duplicateDeliveries,
      rejected_deliveries: this.#metrics.rejectedDeliveries,
      generation_cancellations: this.#metrics.generationCancellations,
      last_queue_wait_ms: this.#metrics.lastQueueWaitMs,
      last_reduction_duration_ms: this.#metrics.lastReductionDurationMs,
    });
  }

  async #ensureHydrated(request: AuthorizedRequestContext): Promise<void> {
    this.#assertTenant(request, "session:read");
    if (this.#state !== undefined) return;
    if (this.#hydrating !== undefined) return this.#hydrating;
    const hydrating = this.#hydrate(request);
    this.#hydrating = hydrating;
    try {
      await hydrating;
    } finally {
      if (this.#hydrating === hydrating) this.#hydrating = undefined;
    }
  }

  async #hydrate(request: AuthorizedRequestContext): Promise<void> {
    let verification: InternalReplayVerification;
    try {
      verification = await this.#readSourceWithDeadline((control) => (
        verifySessionReplayInternal(request, this.#address, this.#source, control)
      ));
    } catch (error) {
      if (error instanceof SessionActorAuthorizationError || error instanceof SessionActorSourceTimeoutError) throw error;
      if (error instanceof SessionActorCapacityError || error instanceof SessionActorNotFoundError) throw error;
      throw new SessionActorReplayError();
    }
    this.#state = verification.result.state;
    this.#deliveries.clear();
    for (const entry of verification.replay.entries.slice(-this.#maxDedupeEntries)) {
      this.#deliveries.set(entry.parsed.eventId, {
        fingerprint: entry.parsed.fingerprint,
        result: Promise.resolve(entry.result),
        settled: true,
      });
    }
  }

  #reduceCanonicalEvent(
    parsed: ParsedCanonicalEnvelope,
    queuedAt: number,
  ): Readonly<{ result: SessionActorEventResult; controller: AbortController | null }> {
    const prior = this.#requireState();
    const startedAt = this.#clock.now();
    let next: InteractionAggregateState;
    try {
      next = parsed.reduce(prior);
    } catch {
      throw new SessionActorConflictError();
    }
    const result = createEventResult(parsed, next);
    const active = this.#activeGeneration;
    let controller: AbortController | null = null;
    if (
      active !== null
      && (isTerminal(next) || next.session.active_presenter_id !== prior.session.active_presenter_id)
    ) {
      active.valid = false;
      this.#activeGeneration = null;
      controller = active.controller;
    }
    this.#state = next;
    this.#metrics.reductionsApplied += 1;
    this.#metrics.lastQueueWaitMs = nonNegativeDuration(startedAt - queuedAt);
    this.#metrics.lastReductionDurationMs = nonNegativeDuration(this.#clock.now() - startedAt);
    return Object.freeze({ result, controller });
  }

  #requireState(): InteractionAggregateState {
    if (this.#state === undefined) throw new SessionActorNotFoundError();
    return this.#state;
  }

  #assertTenant(request: AuthorizedRequestContext, scope: "session:read" | "session:write"): void {
    const tenantId = requireTenantScope(request, scope);
    if (tenantId !== this.#address.tenantId) throw new SessionActorAuthorizationError();
  }

  async #lookupHistoricalDelivery(
    request: AuthorizedRequestContext,
    parsed: ParsedCanonicalEnvelope,
  ): Promise<SessionActorEventResult | null> {
    const existing = this.#historicalLookups.get(parsed.eventId);
    if (existing !== undefined) {
      if (existing.fingerprint !== parsed.fingerprint) throw new SessionActorConflictError();
      return existing.result;
    }
    if (this.#historicalLookups.size >= MAX_IN_FLIGHT_HISTORICAL_LOOKUPS) {
      throw new SessionActorHistoricalLookupCapacityError();
    }
    const result = this.#performHistoricalLookup(request, parsed);
    const record: HistoricalLookupRecord = Object.freeze({ fingerprint: parsed.fingerprint, result });
    this.#historicalLookups.set(parsed.eventId, record);
    void result.then(
      () => {
        if (this.#historicalLookups.get(parsed.eventId) === record) this.#historicalLookups.delete(parsed.eventId);
      },
      () => {
        if (this.#historicalLookups.get(parsed.eventId) === record) this.#historicalLookups.delete(parsed.eventId);
      },
    );
    return result;
  }

  async #performHistoricalLookup(
    request: AuthorizedRequestContext,
    parsed: ParsedCanonicalEnvelope,
  ): Promise<SessionActorEventResult | null> {
    let timelineInput: readonly EventEnvelope[];
    try {
      timelineInput = await this.#readSourceWithDeadline((control) => (
        this.#source.listTimeline(request, this.#address.sessionId, 0, control)
      ));
    } catch (error) {
      if (error instanceof SessionActorAuthorizationError || error instanceof SessionActorSourceTimeoutError) throw error;
      throw new SessionActorReplayError();
    }
    let replay: ReplayResult;
    try {
      replay = replayTimeline(timelineInput, this.#address);
    } catch (error) {
      if (error instanceof SessionActorCapacityError) throw error;
      throw new SessionActorReplayError();
    }
    const entry = replay.entries.find((candidate) => candidate.parsed.eventId === parsed.eventId);
    if (entry === undefined) return null;
    if (entry.parsed.fingerprint !== parsed.fingerprint) throw new SessionActorConflictError();
    return entry.result;
  }

  async #readSourceWithDeadline<Result>(
    read: (control: SessionActorReplayControl) => Promise<Result>,
  ): Promise<Result> {
    const controller = new AbortController();
    const control = Object.freeze({ signal: controller.signal, timeout_ms: this.#sourceTimeoutMs });
    return new Promise<Result>((resolve, reject) => {
      let settled = false;
      let timerHandle: unknown;
      const settle = (callback: () => void): void => {
        if (settled) return;
        settled = true;
        try {
          this.#timeoutScheduler.clearTimeout(timerHandle);
        } catch {
          controller.abort("replay_source_scheduler_failure");
          reject(new SessionActorSourceTimeoutError());
          return;
        }
        callback();
      };
      try {
        timerHandle = this.#timeoutScheduler.setTimeout(() => {
          if (settled) return;
          controller.abort("replay_source_timeout");
          settle(() => reject(new SessionActorSourceTimeoutError()));
        }, this.#sourceTimeoutMs);
      } catch {
        controller.abort("replay_source_scheduler_failure");
        reject(new SessionActorSourceTimeoutError());
        return;
      }
      void Promise.resolve()
        .then(() => (settled ? undefined : read(control)))
        .then(
          (result) => {
            if (settled) return;
            settle(() => resolve(result as Result));
          },
          (error) => settle(() => reject(error)),
        );
    });
  }

  #evictSettledDeliveriesForCapacity(): void {
    while (this.#deliveries.size >= this.#maxDedupeEntries) {
      const settled = [...this.#deliveries.entries()].find(([, record]) => record.settled);
      if (settled === undefined) return;
      this.#deliveries.delete(settled[0]);
    }
  }

  /**
   * Preserve completed command dedupe until a new command needs the bounded
   * ledger. This prevents finished cancellations from consuming the safety
   * lane indefinitely while retaining idempotency for immediate retries.
   */
  #evictSettledControlsForCapacity(): void {
    while (this.#controls.size >= this.#maxDedupeEntries) {
      const settled = [...this.#controls.entries()].find(([, record]) => record.settled);
      if (settled === undefined) return;
      this.#controls.delete(settled[0]);
    }
  }

  #recordMailboxDepth(): void {
    const depth = this.#mailbox.depth;
    this.#metrics.mailboxDepth = depth;
    this.#metrics.mailboxHighWatermark = Math.max(this.#metrics.mailboxHighWatermark, depth);
  }
}

type MailboxLane = "canonical" | "control" | "safety";

interface MailboxItem<Result> {
  readonly lane: MailboxLane;
  readonly sequence: number;
  readonly run: () => Result;
  readonly resolve: (result: Result) => void;
  readonly reject: (error: unknown) => void;
}

/**
 * This mailbox contains no I/O. It yields after each reduction so an arriving
 * safety control can preempt queued normal work without reordering canonical
 * events relative to one another.
 */
class BoundedActorMailbox {
  readonly #capacity: number;
  readonly #onDepthChange: () => void;
  readonly #items: MailboxItem<unknown>[] = [];
  #sequence = 0;
  #scheduled = false;
  #running = false;

  constructor(capacity: number, onDepthChange: () => void) {
    this.#capacity = capacity;
    this.#onDepthChange = onDepthChange;
  }

  get depth(): number {
    return this.#items.length + (this.#running ? 1 : 0);
  }

  enqueue<Result>(lane: MailboxLane, run: () => Result): Promise<Result> {
    const normalItems = this.#items.filter((item) => item.lane !== "safety").length;
    const normalCapacity = this.#capacity - 1;
    if ((lane === "safety" && this.#items.length >= this.#capacity) || (lane !== "safety" && normalItems >= normalCapacity)) {
      throw new SessionActorMailboxCapacityError();
    }
    const promise = new Promise<Result>((resolve, reject) => {
      this.#items.push({
        lane,
        sequence: this.#sequence += 1,
        run: run as () => unknown,
        resolve: resolve as (result: unknown) => void,
        reject,
      });
    });
    this.#onDepthChange();
    this.#schedule();
    return promise;
  }

  #schedule(): void {
    if (this.#scheduled || this.#running) return;
    this.#scheduled = true;
    queueMicrotask(() => this.#runOne());
  }

  #runOne(): void {
    this.#scheduled = false;
    if (this.#running) return;
    const item = this.#nextItem();
    if (item === undefined) {
      this.#onDepthChange();
      return;
    }
    this.#running = true;
    this.#onDepthChange();
    try {
      item.resolve(item.run());
    } catch (error) {
      item.reject(error);
    } finally {
      this.#running = false;
      this.#onDepthChange();
      if (this.#items.length > 0) this.#schedule();
    }
  }

  #nextItem(): MailboxItem<unknown> | undefined {
    const safetyIndex = this.#items.findIndex((item) => item.lane === "safety");
    const index = safetyIndex >= 0 ? safetyIndex : 0;
    return this.#items.splice(index, 1)[0];
  }
}

function normalizeRegistryOptions(value: SessionActorRegistryOptions): NormalizedRegistryOptions {
  const record = strictRecord(
    value,
    ["source", "max_actors", "mailbox_capacity", "max_dedupe_entries", "source_timeout_ms", "clock", "timeout_scheduler"],
    SessionActorValidationError,
  );
  const source = readRequired(record, "source", SessionActorValidationError);
  if (source === null || typeof source !== "object"
    || typeof (source as SessionActorReplaySource).loadSnapshot !== "function"
    || typeof (source as SessionActorReplaySource).listTimeline !== "function") {
    throw new SessionActorValidationError();
  }
  const maxActors = optionalBoundedInteger(record, "max_actors", DEFAULT_MAX_ACTORS, 1, MAX_ACTORS, SessionActorValidationError);
  const mailboxCapacity = optionalBoundedInteger(record, "mailbox_capacity", DEFAULT_MAILBOX_CAPACITY, 2, MAX_MAILBOX_CAPACITY, SessionActorValidationError);
  const maxDedupeEntries = optionalBoundedInteger(record, "max_dedupe_entries", DEFAULT_MAX_DEDUPE_ENTRIES, 1, MAX_DEDUPE_ENTRIES, SessionActorValidationError);
  const sourceTimeoutMs = optionalBoundedInteger(
    record,
    "source_timeout_ms",
    DEFAULT_SOURCE_TIMEOUT_MS,
    1,
    MAX_SOURCE_TIMEOUT_MS,
    SessionActorValidationError,
  );
  const clockInput = optionalData(record, "clock", SessionActorValidationError);
  const clock = clockInput === undefined ? SYSTEM_CLOCK : normalizeClock(clockInput);
  const timeoutSchedulerInput = optionalData(record, "timeout_scheduler", SessionActorValidationError);
  const timeoutScheduler = timeoutSchedulerInput === undefined
    ? SYSTEM_TIMEOUT_SCHEDULER
    : normalizeTimeoutScheduler(timeoutSchedulerInput);
  return Object.freeze({
    source: source as SessionActorReplaySource,
    maxActors,
    mailboxCapacity,
    maxDedupeEntries,
    sourceTimeoutMs,
    clock,
    timeoutScheduler,
  });
}

function normalizeClock(value: unknown): SessionRuntimeClock {
  if (value === null || typeof value !== "object" || typeof (value as SessionRuntimeClock).now !== "function") {
    throw new SessionActorValidationError();
  }
  return Object.freeze({
    now(): number {
      const timestamp = (value as SessionRuntimeClock).now();
      if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) throw new SessionActorValidationError();
      return timestamp;
    },
  });
}

function normalizeTimeoutScheduler(value: unknown): SessionRuntimeTimeoutScheduler {
  const record = strictRecord(value, ["setTimeout", "clearTimeout"], SessionActorValidationError);
  const setTimeout = readRequired(record, "setTimeout", SessionActorValidationError);
  const clearTimeout = readRequired(record, "clearTimeout", SessionActorValidationError);
  if (typeof setTimeout !== "function" || typeof clearTimeout !== "function") throw new SessionActorValidationError();
  return Object.freeze({
    setTimeout(callback: () => void, delayMs: number): unknown {
      return Reflect.apply(setTimeout, value, [callback, delayMs]);
    },
    clearTimeout(handle: unknown): void {
      Reflect.apply(clearTimeout, value, [handle]);
    },
  });
}

function parseCanonicalEnvelope(value: unknown, address: ActorAddress | undefined): ParsedCanonicalEnvelope & { readonly eventTenantId: TenantId } {
  let event;
  try {
    event = decodeInteractionEvent(value);
  } catch {
    throw new SessionActorValidationError();
  }
  const sessionId = parseEventSessionIdFromEvent(event.session_id);
  const tenantId = parseTenantIdForActor(event.tenant_id, SessionActorValidationError);
  if (event.aggregate_id !== sessionId || (address !== undefined && (tenantId !== address.tenantId || sessionId !== address.sessionId))) {
    throw new SessionActorAuthorizationError();
  }
  const envelope = immutableCopy(value) as EventEnvelope;
  const eventId = parseUuidV7(event.event_id, "event_id");
  const aggregateVersion = parseVersion(event.aggregate_version, 1, SessionActorValidationError);
  const traceId = event.trace_id;
  const correlationId = parseUuidV7(event.correlation_id, "correlation_id");
  return Object.freeze({
    envelope,
    eventId,
    aggregateVersion,
    traceId,
    correlationId,
    fingerprint: sha256Canonical(envelope),
    eventTenantId: tenantId,
    reduce: (state: InteractionAggregateState | undefined) => reduceInteractionState(state, event),
  });
}

function replayTimeline(
  timelineInput: unknown,
  address: ActorAddress,
): ReplayResult {
  if (!Array.isArray(timelineInput) || timelineInput.length < 1 || timelineInput.length > MAX_REPLAY_EVENTS) {
    if (Array.isArray(timelineInput) && timelineInput.length > MAX_REPLAY_EVENTS) throw new SessionActorCapacityError();
    throw new SessionActorNotFoundError();
  }
  const entries: ReplayEntry[] = [];
  const eventFingerprints = new Map<string, string>();
  let state: InteractionAggregateState | undefined;
  for (const envelope of timelineInput) {
    let parsed: ParsedCanonicalEnvelope & { readonly eventTenantId: TenantId };
    try {
      parsed = parseCanonicalEnvelope(envelope, address);
    } catch (error) {
      if (error instanceof SessionActorAuthorizationError) throw new SessionActorReplayError();
      if (error instanceof SessionActorValidationError) throw new SessionActorReplayError();
      throw error;
    }
    const knownFingerprint = eventFingerprints.get(parsed.eventId);
    if (knownFingerprint !== undefined) throw new SessionActorReplayError();
    eventFingerprints.set(parsed.eventId, parsed.fingerprint);
    try {
      state = parsed.reduce(state);
    } catch {
      throw new SessionActorReplayError();
    }
    entries.push(Object.freeze({ parsed, state, result: createEventResult(parsed, state) }));
  }
  if (state === undefined) throw new SessionActorNotFoundError();
  return Object.freeze({ state, entries: Object.freeze(entries) });
}

async function verifySessionReplayInternal(
  request: AuthorizedRequestContext,
  address: ActorAddress,
  source: SessionActorReplaySource,
  control?: SessionActorReplayControl,
): Promise<InternalReplayVerification> {
  assertReplayControlActive(control);
  let snapshotInput: SessionActorSnapshot | null;
  let fullTimelineInput: readonly EventEnvelope[];
  try {
    [snapshotInput, fullTimelineInput] = await Promise.all([
      source.loadSnapshot(request, address.sessionId, control),
      source.listTimeline(request, address.sessionId, 0, control),
    ]);
  } catch (error) {
    if (error instanceof SessionActorAuthorizationError || error instanceof SessionActorSourceTimeoutError) throw error;
    throw new SessionActorReplayError();
  }
  assertReplayControlActive(control);
  const fullReplay = replayTimeline(fullTimelineInput, address);
  const snapshot = snapshotInput === null ? null : normalizeSnapshot(snapshotInput, address);
  if (snapshot === null) {
    return Object.freeze({
      result: immutableCopy({
        tenant_id: address.tenantId,
        session_id: address.sessionId,
        aggregate_version: fullReplay.state.session.state_version,
        state: fullReplay.state,
        state_hash: interactionStateHash(fullReplay.state),
        snapshot_version: null,
        full_event_count: fullReplay.entries.length,
        tail_event_count: fullReplay.entries.length,
      }),
      replay: fullReplay,
    });
  }

  assertSnapshotMatchesReplay(snapshot, fullReplay);
  let tailTimelineInput: readonly EventEnvelope[];
  try {
    tailTimelineInput = await source.listTimeline(request, address.sessionId, snapshot.aggregate_version, control);
  } catch (error) {
    if (error instanceof SessionActorAuthorizationError || error instanceof SessionActorSourceTimeoutError) throw error;
    throw new SessionActorReplayError();
  }
  assertReplayControlActive(control);
  const snapshotReplay = replayTailFromSnapshot(snapshot, tailTimelineInput, address);
  assertTailMatchesAuthoritativeReplay(snapshot, snapshotReplay, fullReplay);

  const authoritativeHash = interactionStateHash(fullReplay.state);
  const snapshotTailHash = interactionStateHash(snapshotReplay.state);
  if (
    authoritativeHash !== snapshotTailHash
    || fullReplay.state.session.state_version !== snapshotReplay.state.session.state_version
    || canonicalJson(fullReplay.state) !== canonicalJson(snapshotReplay.state)
  ) throw new SessionActorReplayError();

  return Object.freeze({
    result: immutableCopy({
      tenant_id: address.tenantId,
      session_id: address.sessionId,
      aggregate_version: fullReplay.state.session.state_version,
      state: fullReplay.state,
      state_hash: authoritativeHash,
      snapshot_version: snapshot.aggregate_version,
      full_event_count: fullReplay.entries.length,
      tail_event_count: snapshotReplay.entries.length,
    }),
    replay: fullReplay,
  });
}

function replayTailFromSnapshot(
  snapshot: SessionActorSnapshot,
  timelineInput: unknown,
  address: ActorAddress,
): ReplayResult {
  if (!Array.isArray(timelineInput) || timelineInput.length > MAX_REPLAY_EVENTS) {
    if (Array.isArray(timelineInput) && timelineInput.length > MAX_REPLAY_EVENTS) throw new SessionActorCapacityError();
    throw new SessionActorReplayError();
  }
  const entries: ReplayEntry[] = [];
  const eventIds = new Set<string>();
  let state = snapshot.state;
  for (const envelope of timelineInput) {
    let parsed: ParsedCanonicalEnvelope & { readonly eventTenantId: TenantId };
    try {
      parsed = parseCanonicalEnvelope(envelope, address);
    } catch {
      throw new SessionActorReplayError();
    }
    if (eventIds.has(parsed.eventId)) throw new SessionActorReplayError();
    eventIds.add(parsed.eventId);
    try {
      state = parsed.reduce(state);
    } catch {
      throw new SessionActorReplayError();
    }
    entries.push(Object.freeze({ parsed, state, result: createEventResult(parsed, state) }));
  }
  return Object.freeze({ state, entries: Object.freeze(entries) });
}

function assertTailMatchesAuthoritativeReplay(
  snapshot: SessionActorSnapshot,
  tailReplay: ReplayResult,
  fullReplay: ReplayResult,
): void {
  const authoritativeTail = fullReplay.entries.filter(
    (entry) => entry.parsed.aggregateVersion > snapshot.aggregate_version,
  );
  if (authoritativeTail.length !== tailReplay.entries.length) throw new SessionActorReplayError();
  for (let index = 0; index < authoritativeTail.length; index += 1) {
    const authoritative = authoritativeTail[index];
    const tail = tailReplay.entries[index];
    if (
      authoritative === undefined
      || tail === undefined
      || authoritative.parsed.eventId !== tail.parsed.eventId
      || authoritative.parsed.aggregateVersion !== tail.parsed.aggregateVersion
      || authoritative.parsed.fingerprint !== tail.parsed.fingerprint
    ) throw new SessionActorReplayError();
  }
}

function normalizeSnapshot(value: unknown, address: ActorAddress | undefined): SessionActorSnapshot {
  const record = strictRecord(value, ["aggregate_version", "state", "state_hash"], SessionActorReplayError);
  const aggregateVersion = parseVersion(readRequired(record, "aggregate_version", SessionActorReplayError), 1, SessionActorReplayError);
  const state = readRequired(record, "state", SessionActorReplayError) as InteractionAggregateState;
  const stateHash = readRequired(record, "state_hash", SessionActorReplayError);
  if (typeof stateHash !== "string" || !/^[0-9a-f]{64}$/.test(stateHash)) throw new SessionActorReplayError();
  let calculatedHash: string;
  try {
    calculatedHash = interactionStateHash(state);
  } catch {
    throw new SessionActorReplayError();
  }
  if (calculatedHash !== stateHash || state.session.state_version !== aggregateVersion) throw new SessionActorReplayError();
  if (address !== undefined && (state.session.tenant_id !== address.tenantId || state.session.session_id !== address.sessionId)) {
    throw new SessionActorReplayError();
  }
  return immutableCopy({ aggregate_version: aggregateVersion, state, state_hash: stateHash });
}

function assertSnapshotMatchesReplay(snapshot: SessionActorSnapshot, replay: ReplayResult): void {
  const atSnapshot = replay.entries.find((entry) => entry.parsed.aggregateVersion === snapshot.aggregate_version);
  if (atSnapshot === undefined || atSnapshot.result.state_hash !== snapshot.state_hash) throw new SessionActorReplayError();
}

function createEventResult(parsed: ParsedCanonicalEnvelope, state: InteractionAggregateState): SessionActorEventResult {
  return immutableCopy({
    event_id: parsed.eventId,
    aggregate_version: parsed.aggregateVersion,
    state,
    state_hash: interactionStateHash(state),
    trace_id: parsed.traceId,
    correlation_id: parsed.correlationId,
  });
}

function normalizeGenerationCancellation(value: SessionActorGenerationCancellationInput): Readonly<{
  commandId: UuidV7;
  generationId: number;
  reasonCode: GenerationReasonCode;
  fingerprint: string;
}> {
  const record = strictRecord(value, ["command_id", "generation_id", "reason_code"], SessionActorValidationError);
  const commandId = parseUuidV7(readRequired(record, "command_id", SessionActorValidationError), "command_id");
  const generationId = parseGenerationId(readRequired(record, "generation_id", SessionActorValidationError));
  const reasonCode = readRequired(record, "reason_code", SessionActorValidationError);
  if (typeof reasonCode !== "string" || !GENERATION_REASON_CODES.includes(reasonCode as GenerationReasonCode)) {
    throw new SessionActorValidationError();
  }
  return Object.freeze({
    commandId,
    generationId,
    reasonCode: reasonCode as GenerationReasonCode,
    fingerprint: sha256Canonical({ generation_id: generationId, reason_code: reasonCode }),
  });
}

function parseGenerationId(value: unknown): number {
  return parseVersion(value, 1, SessionActorValidationError);
}

function requireTenantScope(request: AuthorizedRequestContext, scope: "session:read" | "session:write"): TenantId {
  try {
    const context = getAuthorizedTenantContext(request);
    if (!context.grantedScopes.includes(scope)) throw new SessionActorAuthorizationError();
    return context.tenantId;
  } catch (error) {
    if (error instanceof SessionActorAuthorizationError) throw error;
    throw new SessionActorAuthorizationError();
  }
}

function requireDeterministicSource(value: object): DeterministicReplaySourceState {
  const state = DETERMINISTIC_SOURCES.get(value);
  if (state === undefined) throw new SessionActorValidationError();
  return state;
}

function requireReplaySource(value: SessionActorReplaySource): SessionActorReplaySource {
  if (
    value === null
    || typeof value !== "object"
    || typeof value.loadSnapshot !== "function"
    || typeof value.listTimeline !== "function"
  ) throw new SessionActorValidationError();
  return value;
}

function actorSnapshotFromPersisted(
  snapshotInput: SessionStateSnapshot,
  request: AuthorizedRequestContext,
  sessionIdInput: unknown,
): SessionActorSnapshot {
  const tenantId = requireTenantScope(request, "session:read");
  const sessionId = parseSessionIdForActor(sessionIdInput, SessionActorValidationError);
  let snapshotId: UuidV7;
  try {
    snapshotId = parseUuidV7(snapshotInput.snapshot_id, "snapshot_id");
  } catch {
    throw new SessionActorReplayError();
  }
  if (
    snapshotInput.schema_version !== "2.0.0"
    || snapshotInput.tenant_id !== tenantId
    || snapshotInput.session_id !== sessionId
    || typeof snapshotInput.created_at !== "string"
    || !Number.isFinite(Date.parse(snapshotInput.created_at))
    || snapshotId.length < 1
  ) throw new SessionActorReplayError();
  const normalized = normalizeSnapshot({
    aggregate_version: snapshotInput.aggregate_version,
    state: snapshotInput.state,
    state_hash: snapshotInput.state_hash,
  }, { tenantId, sessionId });
  if (
    normalized.aggregate_version !== snapshotInput.aggregate_version
    || normalized.state_hash !== snapshotInput.state_hash
  ) throw new SessionActorReplayError();
  return normalized;
}

function assertReplayControlActive(control: SessionActorReplayControl | undefined): void {
  if (control === undefined) return;
  if (
    control === null
    || typeof control !== "object"
    || !(control.signal instanceof AbortSignal)
    || typeof control.timeout_ms !== "number"
    || !Number.isSafeInteger(control.timeout_ms)
    || control.timeout_ms < 1
    || control.signal.aborted
  ) throw new SessionActorSourceTimeoutError();
}

function parseEventSessionId(parsed: ParsedCanonicalEnvelope & { readonly eventTenantId: TenantId }): SessionId {
  return parseEventSessionIdFromEvent(parsed.envelope.session_id);
}

function parseEventSessionIdFromEvent(value: unknown): SessionId {
  if (value === null) throw new SessionActorValidationError();
  return parseSessionIdForActor(value, SessionActorValidationError);
}

function parseTenantIdForActor(value: unknown, ErrorType: new () => Error): TenantId {
  try {
    const tenantId = parseUuidV7(value, "tenant_id");
    return tenantId as TenantId;
  } catch {
    throw new ErrorType();
  }
}

function parseSessionIdForActor(value: unknown, ErrorType: new () => Error): SessionId {
  try {
    return parseSessionId(value);
  } catch {
    throw new ErrorType();
  }
}

function parseVersion(value: unknown, minimum: number, ErrorType: new () => Error): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) throw new ErrorType();
  return value;
}

function optionalBoundedInteger(
  record: Record<string, unknown>,
  key: string,
  fallback: number,
  minimum: number,
  maximum: number,
  ErrorType: new () => Error,
): number {
  const value = optionalData(record, key, ErrorType);
  if (value === undefined) return fallback;
  const parsed = parseVersion(value, minimum, ErrorType);
  if (parsed > maximum) throw new ErrorType();
  return parsed;
}

function strictRecord(value: unknown, allowedKeys: readonly string[], ErrorType: new () => Error): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new ErrorType();
  }
  const record = value as Record<string, unknown>;
  const keys = Reflect.ownKeys(record);
  if (keys.some((key) => typeof key !== "string" || !allowedKeys.includes(key))) throw new ErrorType();
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (descriptor === undefined || !("value" in descriptor)) throw new ErrorType();
  }
  return record;
}

function readRequired(record: Record<string, unknown>, key: string, ErrorType: new () => Error): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor === undefined || !("value" in descriptor)) throw new ErrorType();
  return descriptor.value;
}

function optionalData(record: Record<string, unknown>, key: string, ErrorType: new () => Error): unknown | undefined {
  if (!Object.prototype.hasOwnProperty.call(record, key)) return undefined;
  return readRequired(record, key, ErrorType);
}

function actorKey(address: ActorAddress): string {
  return `${address.tenantId}:${address.sessionId}`;
}

function immutableCopy<T>(value: T): T {
  return deepFreeze(JSON.parse(canonicalJson(value)) as T);
}

function isTerminal(state: InteractionAggregateState): boolean {
  return state.session.status === "completed" || state.session.status === "failed";
}

function nonNegativeDuration(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

const SYSTEM_CLOCK: SessionRuntimeClock = Object.freeze({ now: () => Date.now() });

const SYSTEM_TIMEOUT_SCHEDULER: SessionRuntimeTimeoutScheduler = Object.freeze({
  setTimeout(callback: () => void, delayMs: number): unknown {
    return globalThis.setTimeout(callback, delayMs);
  },
  clearTimeout(handle: unknown): void {
    globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>);
  },
});
