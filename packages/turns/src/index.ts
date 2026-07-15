import {
  getAuthorizedTenantContext,
  type AuthorizedRequestContext,
} from "@axtro/auth";
import {
  createDeterministicContextComposer,
  parseContextComposition,
  type ContextComposer,
} from "@axtro/context-composer";
import type { ContextComposition, EventEnvelope } from "@axtro/contracts-ts";
import {
  CURRENT_SCHEMA_VERSION,
  createUuidV7,
  parseCorrelationId,
  parseSessionId,
  parseTenantId,
  parseUuidV7,
  sha256Canonical,
  type CorrelationId,
  type InteractionAggregateState,
  type SessionId,
  type TenantId,
  type UuidV7,
} from "@axtro/domain";
import type { TransactionalOutboxRepository } from "@axtro/events";
import type {
  SessionActor,
  SessionActorRegistry,
  SessionActorReplayControl,
  SessionActorReplaySource,
  SessionRuntimeTimeoutScheduler,
} from "@axtro/session-runtime";

export const TURN_DRIVER_PRODUCER = "turn-driver";

export interface TurnDriverClock {
  now(): number;
}

export interface TurnDriverIdGenerator {
  nextId(): unknown;
}

export interface TurnCommandTraceInput {
  readonly trace_id: unknown;
  readonly correlation_id: unknown;
}

export interface TurnCommandTrace {
  readonly trace_id: string;
  readonly correlation_id: CorrelationId;
}

/** Trusted deadline fence supplied by an authenticated API or channel boundary. */
export interface TurnCommandControl {
  assertActive(): void;
  /** Optional trusted request cancellation, propagated to the Fast Lane. */
  readonly signal?: AbortSignal;
}

/** Server-owned registration. A request body never creates participant authority. */
export interface TurnParticipantRegistrationInput {
  readonly tenant_id: unknown;
  readonly session_id: unknown;
  readonly participant_id: unknown;
  readonly authenticated_actor_id: unknown;
}

export interface TurnParticipantDirectory {
  assertAuthorizedParticipant(
    request: AuthorizedRequestContext,
    sessionId: unknown,
    participantId: unknown,
  ): UuidV7;
}

export interface FastLaneConversationPatch {
  readonly active_topic: string | null;
  readonly open_questions: readonly string[];
  readonly repair_state: "none" | "clarifying";
  readonly incremental_summary: string;
}

/** The port can produce text and a bounded state patch only. It has no action or media fields. */
export interface FastLaneRequest {
  readonly tenant_id: TenantId;
  readonly session_id: SessionId;
  readonly speaker_participant_id: UuidV7;
  readonly presenter_id: UuidV7;
  readonly transcript_text: string;
  readonly language: string;
  readonly generation_id: number;
  readonly trace_id: string;
  readonly correlation_id: CorrelationId;
  /** Bounded, structured data only. A renderer must not treat provenance as instruction text. */
  readonly context: ContextComposition;
}

export interface FastLaneControl {
  readonly signal: AbortSignal;
  readonly timeout_ms: number;
}

export interface FastLaneResponse {
  readonly response_text: string;
  readonly patch: FastLaneConversationPatch;
}

export interface FastLanePort {
  respond(request: FastLaneRequest, control: FastLaneControl): Promise<FastLaneResponse>;
}

export interface DeterministicFastLaneFakeOptions {
  readonly outcome?: "success" | "failure";
  readonly response_text?: unknown;
  readonly patch?: unknown;
}

export interface SubmitTurnResult {
  readonly participant_event_id: UuidV7;
  readonly presenter_event_id: UuidV7;
  readonly generation_id: number;
  readonly response_text: string;
  readonly aggregate_version: number;
  readonly state_hash: string;
}

export interface InterruptTurnResult {
  readonly interruption_event_id: UuidV7;
  readonly generation_id: number;
  readonly cancellation_status: "cancelled" | "stale";
  readonly aggregate_version: number;
  readonly state_hash: string;
}

export interface TurnDriverMetrics {
  readonly participant_turns_committed: number;
  readonly presenter_turns_committed: number;
  readonly interruptions_committed: number;
  readonly generations_cancelled: number;
  readonly late_outputs_discarded: number;
  readonly fast_lane_failures: number;
  readonly fast_lane_timeouts: number;
  readonly last_fast_lane_duration_ms: number;
}

export interface TurnDriver {
  submitTurn(
    request: AuthorizedRequestContext,
    sessionId: unknown,
    input: unknown,
    idempotencyKey: unknown,
    trace: TurnCommandTraceInput,
    control?: TurnCommandControl,
  ): Promise<SubmitTurnResult>;
  interruptTurn(
    request: AuthorizedRequestContext,
    sessionId: unknown,
    input: unknown,
    idempotencyKey: unknown,
    trace: TurnCommandTraceInput,
    control?: TurnCommandControl,
  ): Promise<InterruptTurnResult>;
  getMetrics(request: AuthorizedRequestContext, sessionId: unknown): TurnDriverMetrics;
}

export interface TurnDriverOptions {
  readonly outbox: TransactionalOutboxRepository;
  readonly actors: SessionActorRegistry;
  readonly participants: TurnParticipantDirectory;
  readonly fast_lane: FastLanePort;
  readonly context_composer?: ContextComposer;
  readonly clock?: TurnDriverClock;
  readonly id_generator?: TurnDriverIdGenerator;
  readonly timeout_scheduler?: SessionRuntimeTimeoutScheduler;
  readonly fast_lane_timeout_ms?: unknown;
  readonly idempotency_capacity_per_tenant?: unknown;
  readonly max_session_lanes?: unknown;
  readonly max_waiters_per_session_lane?: unknown;
}

export class TurnDriverValidationError extends Error {
  constructor() {
    super("Textual turn input is invalid");
    this.name = "TurnDriverValidationError";
  }
}

export class TurnDriverAuthorizationError extends Error {
  constructor() {
    super("Textual turn is not authorized");
    this.name = "TurnDriverAuthorizationError";
  }
}

export class TurnDriverConflictError extends Error {
  constructor() {
    super("Textual turn conflicts with authoritative session state");
    this.name = "TurnDriverConflictError";
  }
}

export class TurnDriverRateLimitError extends Error {
  constructor() {
    super("Textual turn capacity is exhausted");
    this.name = "TurnDriverRateLimitError";
  }
}

export class TurnDriverTimeoutError extends Error {
  constructor() {
    super("Fast Lane exceeded its bounded deadline");
    this.name = "TurnDriverTimeoutError";
  }
}

export class TurnDriverGenerationCancelledError extends Error {
  constructor() {
    super("Textual generation was cancelled before output could be committed");
    this.name = "TurnDriverGenerationCancelledError";
  }
}

export class TurnDriverFastLaneError extends Error {
  constructor() {
    super("Fast Lane response was unavailable or invalid");
    this.name = "TurnDriverFastLaneError";
  }
}

export class TurnDriverConfigurationError extends Error {
  constructor() {
    super("Turn Driver configuration is invalid");
    this.name = "TurnDriverConfigurationError";
  }
}

interface SubmitTurnCommand {
  readonly speakerParticipantId: UuidV7;
  readonly text: string;
  readonly language: string;
  readonly clientTurnId: string;
}

interface InterruptTurnCommand {
  readonly speakerParticipantId: UuidV7;
  readonly generationId: number;
  readonly clientInterruptId: string;
}

interface ParticipantRegistration {
  readonly tenantId: TenantId;
  readonly sessionId: SessionId;
  readonly participantId: UuidV7;
  readonly actorId: UuidV7;
}

interface NormalizedOptions {
  readonly outbox: TransactionalOutboxRepository;
  readonly actors: SessionActorRegistry;
  readonly participants: TurnParticipantDirectory;
  readonly fastLane: FastLanePort;
  readonly contextComposer: ContextComposer;
  readonly clock: TurnDriverClock;
  readonly idGenerator: TurnDriverIdGenerator;
  readonly timeoutScheduler: SessionRuntimeTimeoutScheduler;
  readonly fastLaneTimeoutMs: number;
  readonly idempotencyCapacityPerTenant: number;
  readonly maxSessionLanes: number;
  readonly maxWaitersPerSessionLane: number;
}

interface SessionLane {
  locked: boolean;
  readonly waiting: Array<() => void>;
}

interface SubmitCommandRecord {
  readonly operation: "submit";
  readonly fingerprint: string;
  readonly clientCommandId: string;
  readonly idempotencyKey: string;
  readonly result: Promise<SubmitTurnResult>;
}

interface InterruptCommandRecord {
  readonly operation: "interrupt";
  readonly fingerprint: string;
  readonly clientCommandId: string;
  readonly idempotencyKey: string;
  readonly result: Promise<InterruptTurnResult>;
}

type CommandRecord = SubmitCommandRecord | InterruptCommandRecord;

interface MutableMetrics {
  participantTurnsCommitted: number;
  presenterTurnsCommitted: number;
  interruptionsCommitted: number;
  generationsCancelled: number;
  lateOutputsDiscarded: number;
  fastLaneFailures: number;
  fastLaneTimeouts: number;
  lastFastLaneDurationMs: number;
}

interface PendingGeneration {
  readonly generationId: number;
  invalidated: boolean;
}

const DEFAULT_FAST_LANE_TIMEOUT_MS = 1_000;
const MAX_FAST_LANE_TIMEOUT_MS = 10_000;
const DEFAULT_IDEMPOTENCY_CAPACITY_PER_TENANT = 256;
const MAX_IDEMPOTENCY_CAPACITY_PER_TENANT = 4_096;
const DEFAULT_MAX_SESSION_LANES = 128;
const MAX_SESSION_LANES = 1_024;
const DEFAULT_MAX_WAITERS_PER_SESSION_LANE = 16;
const MAX_WAITERS_PER_SESSION_LANE = 128;
const MAX_TEXT_CHARACTERS = 8_000;
const MAX_TEXT_BYTES = 20_000;
const MAX_RESPONSE_CHARACTERS = 1_200;
const MAX_RESPONSE_BYTES = 4_000;
const MAX_PATCH_SUMMARY_CHARACTERS = 1_000;
const MAX_PATCH_OPEN_QUESTIONS = 50;
const MAX_PATCH_QUESTION_CHARACTERS = 500;
const LANGUAGE_PATTERN = /^[a-z]{2}(-[A-Z]{2})?$/;
const CLIENT_COMMAND_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/;
const TRACE_ID_PATTERN = /^[0-9a-f]{16,64}$/;
const DEFAULT_FAST_LANE_RESPONSE = "Thank you. I am ready to continue the conversation.";
const DEFAULT_FAST_LANE_PATCH: FastLaneConversationPatch = Object.freeze({
  active_topic: null,
  open_questions: Object.freeze([]),
  repair_state: "none",
  incremental_summary: "Presenter response generated by the deterministic local Fast Lane.",
});
const NOOP_COMMAND_CONTROL: TurnCommandControl = Object.freeze({ assertActive() {} });
const SYSTEM_TIMEOUT_SCHEDULER: SessionRuntimeTimeoutScheduler = Object.freeze({
  setTimeout: (callback: () => void, delayMs: number) => setTimeout(callback, delayMs),
  clearTimeout: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
});
const SYSTEM_CLOCK: TurnDriverClock = Object.freeze({ now: () => Date.now() });

/**
 * Server-owned local directory. It makes an asserted participant ID meaningful
 * only when the verified principal has a matching tenant and session binding.
 */
export function createDeterministicTurnParticipantDirectory(
  entriesInput: readonly TurnParticipantRegistrationInput[],
): TurnParticipantDirectory {
  if (!Array.isArray(entriesInput) || entriesInput.length === 0 || entriesInput.length > 4_096) {
    throw new TurnDriverConfigurationError();
  }
  const registrations = new Map<string, ParticipantRegistration>();
  const participantRegistrations = new Set<string>();
  for (const entry of entriesInput) {
    const record = strictRecord(entry, ["tenant_id", "session_id", "participant_id", "authenticated_actor_id"], TurnDriverConfigurationError);
    let registration: ParticipantRegistration;
    try {
      registration = Object.freeze({
        tenantId: parseTenantId(record.tenant_id),
        sessionId: parseSessionId(record.session_id),
        participantId: parseUuidV7(record.participant_id, "participant_id"),
        actorId: parseUuidV7(record.authenticated_actor_id, "authenticated_actor_id"),
      });
    } catch {
      throw new TurnDriverConfigurationError();
    }
    const key = participantDirectoryKey(registration.tenantId, registration.sessionId, registration.actorId);
    const participantKey = registeredParticipantKey(
      registration.tenantId,
      registration.sessionId,
      registration.participantId,
    );
    if (registrations.has(key) || participantRegistrations.has(participantKey)) {
      throw new TurnDriverConfigurationError();
    }
    registrations.set(key, registration);
    participantRegistrations.add(participantKey);
  }
  return Object.freeze({
    assertAuthorizedParticipant(request, sessionIdInput, participantIdInput): UuidV7 {
      const tenant = requireTurnAccess(request, "session:write");
      let sessionId: SessionId;
      let participantId: UuidV7;
      try {
        sessionId = parseSessionId(sessionIdInput);
        participantId = parseUuidV7(participantIdInput, "speaker_participant_id");
      } catch {
        throw new TurnDriverAuthorizationError();
      }
      const principal = request.principal;
      const registration = registrations.get(participantDirectoryKey(tenant.tenantId, sessionId, principal.actorId));
      if (registration === undefined || registration.participantId !== participantId) {
        throw new TurnDriverAuthorizationError();
      }
      return registration.participantId;
    },
  } satisfies TurnParticipantDirectory);
}

/**
 * Temporary M1 source. It performs only tenant-scoped reads of the existing
 * outbox and intentionally owns neither snapshots nor actor mutation.
 */
export function createOutboxSessionActorReplaySource(outbox: TransactionalOutboxRepository): SessionActorReplaySource {
  if (outbox === null || typeof outbox !== "object"
    || typeof outbox.listOutbox !== "function") {
    throw new TurnDriverConfigurationError();
  }
  return Object.freeze({
    async loadSnapshot(
      request: AuthorizedRequestContext,
      sessionIdInput: SessionId,
      control?: SessionActorReplayControl,
    ): Promise<null> {
      assertReplayControl(control);
      parseSessionId(sessionIdInput);
      assertReplayControl(control);
      return null;
    },
    async listTimeline(
      request: AuthorizedRequestContext,
      sessionIdInput: SessionId,
      afterVersion: number,
      control?: SessionActorReplayControl,
    ): Promise<readonly EventEnvelope[]> {
      assertReplayControl(control);
      const sessionId = parseSessionId(sessionIdInput);
      if (!Number.isSafeInteger(afterVersion) || afterVersion < 0) throw new TurnDriverValidationError();
      const records = outbox.listOutbox(request)
        .filter((record) => record.aggregate_id === sessionId && record.aggregate_version > afterVersion)
        .sort((left, right) => left.aggregate_version - right.aggregate_version)
        .map((record) => record.event);
      assertReplayControl(control);
      return Object.freeze(records);
    },
  } satisfies SessionActorReplaySource);
}

/** Local deterministic fake. It emits no journal and has no external integration surface. */
export function createDeterministicFastLaneFake(optionsInput?: DeterministicFastLaneFakeOptions): FastLanePort {
  const options = normalizeDeterministicFastLaneOptions(optionsInput);
  return Object.freeze({
    async respond(_request: FastLaneRequest, control: FastLaneControl): Promise<FastLaneResponse> {
      if (control.signal.aborted) throw new TurnDriverGenerationCancelledError();
      if (options.outcome === "failure") throw new TurnDriverFastLaneError();
      const response = Object.freeze({
        response_text: options.responseText,
        patch: immutablePatch(options.patch),
      });
      if (control.signal.aborted) throw new TurnDriverGenerationCancelledError();
      return response;
    },
  } satisfies FastLanePort);
}

/**
 * Creates the bounded command boundary. It never exposes a tool or provider
 * port, and it deliberately keeps Fast Lane work outside the session lane.
 */
export function createTurnDriver(optionsInput: TurnDriverOptions): TurnDriver {
  const options = normalizeOptions(optionsInput);
  const lanes = new Map<string, SessionLane>();
  const commandByIdempotency = new Map<string, CommandRecord>();
  const commandByClientId = new Map<string, CommandRecord>();
  const commandKeysByTenant = new Map<TenantId, Set<string>>();
  const metricsBySession = new Map<string, MutableMetrics>();
  const pendingGenerations = new Map<string, PendingGeneration>();

  const metricsFor = (tenantId: TenantId, sessionId: SessionId): MutableMetrics => {
    const key = tenantSessionKey(tenantId, sessionId);
    const existing = metricsBySession.get(key);
    if (existing !== undefined) return existing;
    const created: MutableMetrics = {
      participantTurnsCommitted: 0,
      presenterTurnsCommitted: 0,
      interruptionsCommitted: 0,
      generationsCancelled: 0,
      lateOutputsDiscarded: 0,
      fastLaneFailures: 0,
      fastLaneTimeouts: 0,
      lastFastLaneDurationMs: 0,
    };
    metricsBySession.set(key, created);
    return created;
  };

  const withSessionLane = async <Result>(sessionKey: string, work: () => Promise<Result>): Promise<Result> => {
    let lane = lanes.get(sessionKey);
    if (lane === undefined) {
      if (lanes.size >= options.maxSessionLanes) throw new TurnDriverRateLimitError();
      lane = { locked: false, waiting: [] };
      lanes.set(sessionKey, lane);
    }
    if (lane.locked) {
      if (lane.waiting.length >= options.maxWaitersPerSessionLane) throw new TurnDriverRateLimitError();
      await new Promise<void>((resolve) => lane!.waiting.push(resolve));
    }
    lane.locked = true;
    try {
      return await work();
    } finally {
      const next = lane.waiting.shift();
      if (next === undefined) {
        lane.locked = false;
        lanes.delete(sessionKey);
      } else {
        next();
      }
    }
  };

  const beginCommand = <Result extends SubmitTurnResult | InterruptTurnResult>(input: {
    readonly tenantId: TenantId;
    readonly sessionId: SessionId;
    readonly participantId: UuidV7;
    readonly operation: "submit" | "interrupt";
    readonly clientCommandId: string;
    readonly idempotencyKey: string;
    readonly fingerprint: string;
    readonly work: () => Promise<Result>;
  }): Promise<Result> => {
    const idempotencyStoreKey = commandIdempotencyKey(
      input.tenantId,
      input.sessionId,
      input.participantId,
      input.idempotencyKey,
    );
    const clientStoreKey = commandClientKey(
      input.tenantId,
      input.sessionId,
      input.participantId,
      input.clientCommandId,
    );
    const priorByKey = commandByIdempotency.get(idempotencyStoreKey);
    const priorByClient = commandByClientId.get(clientStoreKey);
    const prior = priorByKey ?? priorByClient;
    if (prior !== undefined) {
      if (prior.operation !== input.operation
        || prior.fingerprint !== input.fingerprint
        || prior.clientCommandId !== input.clientCommandId
        || prior.idempotencyKey !== input.idempotencyKey) {
        throw new TurnDriverConflictError();
      }
      return prior.result as Promise<Result>;
    }
    const tenantKeys = commandKeysByTenant.get(input.tenantId) ?? new Set<string>();
    if (tenantKeys.size >= options.idempotencyCapacityPerTenant) throw new TurnDriverRateLimitError();
    let resolveResult!: (result: Result) => void;
    let rejectResult!: (error: unknown) => void;
    const result = new Promise<Result>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });
    const record: CommandRecord = input.operation === "submit"
      ? Object.freeze({
        operation: "submit",
        fingerprint: input.fingerprint,
        clientCommandId: input.clientCommandId,
        idempotencyKey: input.idempotencyKey,
        result: result as Promise<SubmitTurnResult>,
      })
      : Object.freeze({
        operation: "interrupt",
        fingerprint: input.fingerprint,
        clientCommandId: input.clientCommandId,
        idempotencyKey: input.idempotencyKey,
        result: result as Promise<InterruptTurnResult>,
      });
    commandByIdempotency.set(idempotencyStoreKey, record);
    commandByClientId.set(clientStoreKey, record);
    tenantKeys.add(idempotencyStoreKey);
    commandKeysByTenant.set(input.tenantId, tenantKeys);
    void input.work().then(resolveResult, rejectResult);
    return result;
  };

  const invalidateFailedGeneration = async (
    request: AuthorizedRequestContext,
    actor: SessionActor,
    sessionKey: string,
    generationId: number,
    metrics: MutableMetrics,
  ): Promise<void> => {
    const pending = pendingGenerations.get(sessionKey);
    if (pending === undefined || pending.generationId !== generationId || pending.invalidated) return;
    pending.invalidated = true;
    try {
      const cancellation = await actor.cancelGeneration(request, {
        command_id: nextId(options.idGenerator),
        generation_id: generationId,
        reason_code: "safety_stop",
      });
      if (cancellation.status === "cancelled") metrics.generationsCancelled += 1;
    } catch {
      // The local fence remains authoritative even if actor cleanup has already raced or failed closed.
    } finally {
      if (pendingGenerations.get(sessionKey) === pending) pendingGenerations.delete(sessionKey);
    }
  };

  const submitTurn = async (
    request: AuthorizedRequestContext,
    sessionIdInput: unknown,
    input: unknown,
    idempotencyKeyInput: unknown,
    traceInput: TurnCommandTraceInput,
    controlInput?: TurnCommandControl,
  ): Promise<SubmitTurnResult> => {
    const access = requireTurnAccess(request, "session:write", true);
    const sessionId = parseSessionIdOrValidation(sessionIdInput);
    const command = parseSubmitTurnCommand(input);
    const idempotencyKey = parseClientCommandId(idempotencyKeyInput);
    const trace = parseTrace(traceInput);
    const control = normalizeCommandControl(controlInput);
    options.participants.assertAuthorizedParticipant(request, sessionId, command.speakerParticipantId);
    const sessionKey = tenantSessionKey(access.tenantId, sessionId);
    const fingerprint = sha256Canonical({
      operation: "submit",
      session_id: sessionId,
      speaker_participant_id: command.speakerParticipantId,
      text: command.text,
      language: command.language,
      client_turn_id: command.clientTurnId,
    });
    return beginCommand({
      tenantId: access.tenantId,
      sessionId,
      participantId: command.speakerParticipantId,
      operation: "submit",
      clientCommandId: command.clientTurnId,
      idempotencyKey,
      fingerprint,
      work: async () => {
        control.assertActive();
        const actor = await options.actors.getActor(request, sessionId);
        const sessionKey = tenantSessionKey(access.tenantId, sessionId);
        const prepared = await withSessionLane(sessionKey, async () => {
          control.assertActive();
          const state = requireActiveSession(options.outbox, request, sessionId, command.language);
          if (state.session.active_presenter_id === null) throw new TurnDriverConflictError();
          const presenterId = parseUuidV7(state.session.active_presenter_id, "active_presenter_id");
          const participantEvent = createTurnEvent({
            eventId: nextId(options.idGenerator),
            aggregateVersion: state.session.state_version + 1,
            tenantId: access.tenantId,
            sessionId,
            trace,
            causationId: latestEventId(options.outbox, request, sessionId),
            occurredAt: nowIso(options.clock),
            speakerParticipantId: command.speakerParticipantId,
            speakerRole: "participant",
            transcriptText: command.text,
            generationId: null,
            conversation: participantConversationPayload(state),
          });
          const committed = await options.outbox.commitInteractionEvent(request, participantEvent, control);
          const projected = await actor.applyCanonicalEvent(request, committed.outbox.event);
          const generation = await actor.beginGeneration(request);
          pendingGenerations.set(sessionKey, { generationId: generation.generation_id, invalidated: false });
          metricsFor(access.tenantId, sessionId).participantTurnsCommitted += 1;
          return Object.freeze({
            actor,
            participantEventId: projected.event_id,
            presenterId,
            generationId: generation.generation_id,
            generationSignal: generation.signal,
            state: projected.state,
          });
        });
        let fastLaneResponse: FastLaneResponse;
        const startedAt = options.clock.now();
        try {
          const stateSnapshot = options.contextComposer.captureProjectedState(request, prepared.state);
          const context = assertFastLaneContext(
            options.contextComposer.compose(request, { state_snapshot: stateSnapshot }),
            access.tenantId,
            sessionId,
            prepared.state.session.state_version,
            checkedNow(options.clock),
          );
          fastLaneResponse = await runFastLane(options, {
            tenant_id: access.tenantId,
            session_id: sessionId,
            speaker_participant_id: command.speakerParticipantId,
            presenter_id: prepared.presenterId,
            transcript_text: command.text,
            language: command.language,
            generation_id: prepared.generationId,
            trace_id: trace.trace_id,
            correlation_id: trace.correlation_id,
            context,
          }, prepared.generationSignal, control.signal);
        } catch (error) {
          const metrics = metricsFor(access.tenantId, sessionId);
          metrics.lastFastLaneDurationMs = duration(options.clock, startedAt);
          if (error instanceof TurnDriverTimeoutError) metrics.fastLaneTimeouts += 1;
          else if (error instanceof TurnDriverGenerationCancelledError) metrics.lateOutputsDiscarded += 1;
          else metrics.fastLaneFailures += 1;
          await invalidateFailedGeneration(
            request,
            prepared.actor,
            sessionKey,
            prepared.generationId,
            metrics,
          );
          throw error;
        }
        const metrics = metricsFor(access.tenantId, sessionId);
        metrics.lastFastLaneDurationMs = duration(options.clock, startedAt);
        try {
          return await withSessionLane(sessionKey, async () => {
          control.assertActive();
          const pending = pendingGenerations.get(sessionKey);
          if (pending === undefined || pending.generationId !== prepared.generationId || pending.invalidated
            || !prepared.actor.canPublishGeneration(request, prepared.generationId)) {
            metrics.lateOutputsDiscarded += 1;
            throw new TurnDriverGenerationCancelledError();
          }
          const state = requireActiveSession(options.outbox, request, sessionId, command.language);
          if (state.session.active_presenter_id !== prepared.presenterId) {
            metrics.lateOutputsDiscarded += 1;
            throw new TurnDriverGenerationCancelledError();
          }
          const presenterEvent = createTurnEvent({
            eventId: nextId(options.idGenerator),
            aggregateVersion: state.session.state_version + 1,
            tenantId: access.tenantId,
            sessionId,
            trace,
            causationId: prepared.participantEventId,
            occurredAt: nowIso(options.clock),
            speakerParticipantId: prepared.presenterId,
            speakerRole: "presenter",
            transcriptText: fastLaneResponse.response_text,
            generationId: prepared.generationId,
            conversation: presenterConversationPayload(state, fastLaneResponse.patch),
          });
          const committed = await options.outbox.commitInteractionEvent(request, presenterEvent, control);
          const projected = await prepared.actor.applyCanonicalEvent(request, committed.outbox.event);
          pendingGenerations.delete(sessionKey);
          metrics.presenterTurnsCommitted += 1;
          return Object.freeze({
            participant_event_id: prepared.participantEventId,
            presenter_event_id: projected.event_id,
            generation_id: prepared.generationId,
            response_text: fastLaneResponse.response_text,
            aggregate_version: projected.aggregate_version,
            state_hash: projected.state_hash,
          });
          });
        } catch (error) {
          await invalidateFailedGeneration(
            request,
            prepared.actor,
            sessionKey,
            prepared.generationId,
            metrics,
          );
          throw error;
        }
      },
    });
  };

  const interruptTurn = async (
    request: AuthorizedRequestContext,
    sessionIdInput: unknown,
    input: unknown,
    idempotencyKeyInput: unknown,
    traceInput: TurnCommandTraceInput,
    controlInput?: TurnCommandControl,
  ): Promise<InterruptTurnResult> => {
    const access = requireTurnAccess(request, "session:write");
    const sessionId = parseSessionIdOrValidation(sessionIdInput);
    const command = parseInterruptTurnCommand(input);
    const idempotencyKey = parseClientCommandId(idempotencyKeyInput);
    const trace = parseTrace(traceInput);
    const control = normalizeCommandControl(controlInput);
    options.participants.assertAuthorizedParticipant(request, sessionId, command.speakerParticipantId);
    const sessionKey = tenantSessionKey(access.tenantId, sessionId);
    const fingerprint = sha256Canonical({
      operation: "interrupt",
      session_id: sessionId,
      speaker_participant_id: command.speakerParticipantId,
      generation_id: command.generationId,
      client_interrupt_id: command.clientInterruptId,
    });
    return beginCommand({
      tenantId: access.tenantId,
      sessionId,
      participantId: command.speakerParticipantId,
      operation: "interrupt",
      clientCommandId: command.clientInterruptId,
      idempotencyKey,
      fingerprint,
      work: async () => {
        control.assertActive();
        const pending = pendingGenerations.get(sessionKey);
        if (pending === undefined || pending.generationId !== command.generationId || pending.invalidated) {
          throw new TurnDriverConflictError();
        }
        // This local fence runs before the first await so a just-observed interruption
        // always wins the race against a Fast Lane continuation.
        pending.invalidated = true;
        const actor = await options.actors.getActor(request, sessionId);
        const metrics = metricsFor(access.tenantId, sessionId);
        return withSessionLane(sessionKey, async () => {
          control.assertActive();
          if (pendingGenerations.get(sessionKey) !== pending) throw new TurnDriverConflictError();
          const cancellation = await actor.cancelGeneration(request, {
            command_id: nextId(options.idGenerator),
            generation_id: command.generationId,
            reason_code: "barge_in",
          });
          if (cancellation.status !== "cancelled") {
            if (pendingGenerations.get(sessionKey) === pending) pendingGenerations.delete(sessionKey);
            throw new TurnDriverConflictError();
          }
          metrics.generationsCancelled += 1;
          const state = requireActiveSession(options.outbox, request, sessionId, undefined);
          const interruption = createInterruptionEvent({
            eventId: nextId(options.idGenerator),
            aggregateVersion: state.session.state_version + 1,
            tenantId: access.tenantId,
            sessionId,
            trace,
            causationId: latestEventId(options.outbox, request, sessionId),
            occurredAt: nowIso(options.clock),
          });
          const committed = await options.outbox.commitInteractionEvent(request, interruption, control);
          const projected = await actor.applyCanonicalEvent(request, committed.outbox.event);
          if (pendingGenerations.get(sessionKey) === pending) pendingGenerations.delete(sessionKey);
          metrics.interruptionsCommitted += 1;
          return Object.freeze({
            interruption_event_id: projected.event_id,
            generation_id: command.generationId,
            cancellation_status: cancellation.status,
            aggregate_version: projected.aggregate_version,
            state_hash: projected.state_hash,
          });
        });
      },
    });
  };

  return Object.freeze({
    submitTurn,
    interruptTurn,
    getMetrics(request, sessionIdInput): TurnDriverMetrics {
      const access = requireTurnAccess(request, "session:read");
      const sessionId = parseSessionIdOrValidation(sessionIdInput);
      const metrics = metricsFor(access.tenantId, sessionId);
      return Object.freeze({
        participant_turns_committed: metrics.participantTurnsCommitted,
        presenter_turns_committed: metrics.presenterTurnsCommitted,
        interruptions_committed: metrics.interruptionsCommitted,
        generations_cancelled: metrics.generationsCancelled,
        late_outputs_discarded: metrics.lateOutputsDiscarded,
        fast_lane_failures: metrics.fastLaneFailures,
        fast_lane_timeouts: metrics.fastLaneTimeouts,
        last_fast_lane_duration_ms: metrics.lastFastLaneDurationMs,
      });
    },
  } satisfies TurnDriver);
}

function normalizeOptions(value: TurnDriverOptions): NormalizedOptions {
  const record = strictRecord(value, [
    "outbox",
    "actors",
    "participants",
    "fast_lane",
    "context_composer",
    "clock",
    "id_generator",
    "timeout_scheduler",
    "fast_lane_timeout_ms",
    "idempotency_capacity_per_tenant",
    "max_session_lanes",
    "max_waiters_per_session_lane",
  ], TurnDriverConfigurationError, true);
  const outbox = record.outbox;
  const actors = record.actors;
  const participants = record.participants;
  const fastLane = record.fast_lane;
  const clock = record.clock === undefined ? SYSTEM_CLOCK : normalizeClock(record.clock);
  const contextComposer = record.context_composer === undefined
    ? createDeterministicContextComposer({ clock })
    : record.context_composer;
  if (outbox === null || typeof outbox !== "object" || typeof (outbox as TransactionalOutboxRepository).commitInteractionEvent !== "function") {
    throw new TurnDriverConfigurationError();
  }
  if (actors === null || typeof actors !== "object" || typeof (actors as SessionActorRegistry).getActor !== "function") {
    throw new TurnDriverConfigurationError();
  }
  if (participants === null || typeof participants !== "object"
    || typeof (participants as TurnParticipantDirectory).assertAuthorizedParticipant !== "function") {
    throw new TurnDriverConfigurationError();
  }
  if (fastLane === null || typeof fastLane !== "object" || typeof (fastLane as FastLanePort).respond !== "function") {
    throw new TurnDriverConfigurationError();
  }
  if (contextComposer === null || typeof contextComposer !== "object"
    || typeof (contextComposer as ContextComposer).captureProjectedState !== "function"
    || typeof (contextComposer as ContextComposer).compose !== "function") {
    throw new TurnDriverConfigurationError();
  }
  const idGenerator = record.id_generator === undefined
    ? Object.freeze({ nextId: () => createUuidV7(checkedNow(clock)) })
    : normalizeIdGenerator(record.id_generator);
  const timeoutScheduler = record.timeout_scheduler === undefined
    ? SYSTEM_TIMEOUT_SCHEDULER
    : normalizeTimeoutScheduler(record.timeout_scheduler);
  return Object.freeze({
    outbox: outbox as TransactionalOutboxRepository,
    actors: actors as SessionActorRegistry,
    participants: participants as TurnParticipantDirectory,
    fastLane: fastLane as FastLanePort,
    contextComposer: contextComposer as ContextComposer,
    clock,
    idGenerator,
    timeoutScheduler,
    fastLaneTimeoutMs: boundedInteger(record.fast_lane_timeout_ms, DEFAULT_FAST_LANE_TIMEOUT_MS, 1, MAX_FAST_LANE_TIMEOUT_MS, TurnDriverConfigurationError),
    idempotencyCapacityPerTenant: boundedInteger(
      record.idempotency_capacity_per_tenant,
      DEFAULT_IDEMPOTENCY_CAPACITY_PER_TENANT,
      1,
      MAX_IDEMPOTENCY_CAPACITY_PER_TENANT,
      TurnDriverConfigurationError,
    ),
    maxSessionLanes: boundedInteger(record.max_session_lanes, DEFAULT_MAX_SESSION_LANES, 1, MAX_SESSION_LANES, TurnDriverConfigurationError),
    maxWaitersPerSessionLane: boundedInteger(
      record.max_waiters_per_session_lane,
      DEFAULT_MAX_WAITERS_PER_SESSION_LANE,
      0,
      MAX_WAITERS_PER_SESSION_LANE,
      TurnDriverConfigurationError,
    ),
  });
}

function normalizeDeterministicFastLaneOptions(input: DeterministicFastLaneFakeOptions | undefined): Readonly<{
  outcome: "success" | "failure";
  responseText: string;
  patch: FastLaneConversationPatch;
}> {
  if (input === undefined) return Object.freeze({ outcome: "success", responseText: DEFAULT_FAST_LANE_RESPONSE, patch: DEFAULT_FAST_LANE_PATCH });
  const record = strictRecord(input, ["outcome", "response_text", "patch"], TurnDriverConfigurationError, true);
  if (record.outcome !== undefined && record.outcome !== "success" && record.outcome !== "failure") {
    throw new TurnDriverConfigurationError();
  }
  const responseText = record.response_text === undefined
    ? DEFAULT_FAST_LANE_RESPONSE
    : normalizeResponseText(record.response_text, TurnDriverConfigurationError);
  const patch = record.patch === undefined
    ? DEFAULT_FAST_LANE_PATCH
    : normalizeFastLanePatch(record.patch, TurnDriverConfigurationError);
  return Object.freeze({ outcome: record.outcome === undefined ? "success" : record.outcome, responseText, patch });
}

function requireTurnAccess(
  request: AuthorizedRequestContext,
  scope: "session:read" | "session:write",
  alsoRequiresRead = false,
): ReturnType<typeof getAuthorizedTenantContext> {
  try {
    const context = getAuthorizedTenantContext(request);
    if (!context.grantedScopes.includes(scope)
      || alsoRequiresRead && !context.grantedScopes.includes("session:read")
      || !context.purposes.includes("essential_processing")) {
      throw new TurnDriverAuthorizationError();
    }
    return context;
  } catch (error) {
    if (error instanceof TurnDriverAuthorizationError) throw error;
    throw new TurnDriverAuthorizationError();
  }
}

function parseSubmitTurnCommand(input: unknown): SubmitTurnCommand {
  const record = strictRecord(input, ["schema_version", "speaker_participant_id", "text", "language", "client_turn_id"], TurnDriverValidationError);
  if (record.schema_version !== CURRENT_SCHEMA_VERSION) throw new TurnDriverValidationError();
  try {
    return Object.freeze({
      speakerParticipantId: parseUuidV7(record.speaker_participant_id, "speaker_participant_id"),
      text: normalizeRestrictedText(record.text, TurnDriverValidationError),
      language: parseLanguage(record.language),
      clientTurnId: parseClientCommandId(record.client_turn_id),
    });
  } catch (error) {
    if (error instanceof TurnDriverValidationError) throw error;
    throw new TurnDriverValidationError();
  }
}

function parseInterruptTurnCommand(input: unknown): InterruptTurnCommand {
  const record = strictRecord(input, ["speaker_participant_id", "generation_id", "client_interrupt_id"], TurnDriverValidationError);
  try {
    return Object.freeze({
      speakerParticipantId: parseUuidV7(record.speaker_participant_id, "speaker_participant_id"),
      generationId: boundedInteger(record.generation_id, 0, 1, Number.MAX_SAFE_INTEGER, TurnDriverValidationError),
      clientInterruptId: parseClientCommandId(record.client_interrupt_id),
    });
  } catch (error) {
    if (error instanceof TurnDriverValidationError) throw error;
    throw new TurnDriverValidationError();
  }
}

function parseTrace(input: TurnCommandTraceInput): TurnCommandTrace {
  const record = strictRecord(input, ["trace_id", "correlation_id"], TurnDriverValidationError);
  if (typeof record.trace_id !== "string" || !TRACE_ID_PATTERN.test(record.trace_id)) throw new TurnDriverValidationError();
  try {
    return Object.freeze({ trace_id: record.trace_id, correlation_id: parseCorrelationId(record.correlation_id) });
  } catch {
    throw new TurnDriverValidationError();
  }
}

function normalizeCommandControl(input: TurnCommandControl | undefined): TurnCommandControl {
  if (input === undefined) return NOOP_COMMAND_CONTROL;
  if (input === null || typeof input !== "object" || typeof input.assertActive !== "function") {
    throw new TurnDriverValidationError();
  }
  if (input.signal !== undefined) normalizeAbortSignal(input.signal);
  return input;
}

function normalizeAbortSignal(value: unknown): AbortSignal {
  if (value === null || typeof value !== "object") throw new TurnDriverValidationError();
  const signal = value as AbortSignal;
  if (typeof signal.aborted !== "boolean"
    || typeof signal.addEventListener !== "function"
    || typeof signal.removeEventListener !== "function") {
    throw new TurnDriverValidationError();
  }
  return signal;
}

function requireActiveSession(
  outbox: TransactionalOutboxRepository,
  request: AuthorizedRequestContext,
  sessionId: SessionId,
  requiredLanguage: string | undefined,
): InteractionAggregateState {
  const state = outbox.readInteractionAggregate(request, sessionId);
  if (state === null || state.session.status !== "active" || state.session.active_presenter_id === null) {
    throw new TurnDriverConflictError();
  }
  if (requiredLanguage !== undefined && state.conversation.language !== requiredLanguage) throw new TurnDriverConflictError();
  return state;
}

function participantConversationPayload(state: InteractionAggregateState): Record<string, unknown> {
  return Object.freeze({
    turn_index: state.conversation.turn_index + 1,
    active_topic: state.conversation.active_topic,
    language: state.conversation.language,
    open_questions: [...state.conversation.open_questions],
    confirmed_facts: state.conversation.confirmed_facts.map((fact) => ({ ...fact })),
    repair_state: "none",
    incremental_summary: "Participant turn committed by the textual Walking Skeleton.",
  });
}

function presenterConversationPayload(state: InteractionAggregateState, patch: FastLaneConversationPatch): Record<string, unknown> {
  return Object.freeze({
    turn_index: state.conversation.turn_index + 1,
    active_topic: patch.active_topic,
    language: state.conversation.language,
    open_questions: [...patch.open_questions],
    confirmed_facts: state.conversation.confirmed_facts.map((fact) => ({ ...fact })),
    repair_state: patch.repair_state,
    incremental_summary: patch.incremental_summary,
  });
}

function createTurnEvent(input: {
  readonly eventId: UuidV7;
  readonly aggregateVersion: number;
  readonly tenantId: TenantId;
  readonly sessionId: SessionId;
  readonly trace: TurnCommandTrace;
  readonly causationId: UuidV7 | null;
  readonly occurredAt: string;
  readonly speakerParticipantId: UuidV7;
  readonly speakerRole: "participant" | "presenter";
  readonly transcriptText: string;
  readonly generationId: number | null;
  readonly conversation: Record<string, unknown>;
}): Record<string, unknown> {
  return Object.freeze({
    schema_version: CURRENT_SCHEMA_VERSION,
    event_id: input.eventId,
    event_type: "turn.committed",
    event_version: 1,
    aggregate_type: "interaction_session",
    aggregate_id: input.sessionId,
    aggregate_version: input.aggregateVersion,
    tenant_id: input.tenantId,
    session_id: input.sessionId,
    producer: TURN_DRIVER_PRODUCER,
    trace_id: input.trace.trace_id,
    correlation_id: input.trace.correlation_id,
    causation_id: input.causationId,
    data_classification: "restricted",
    occurred_at: input.occurredAt,
    payload: Object.freeze({
      schema_version: CURRENT_SCHEMA_VERSION,
      speaker_participant_id: input.speakerParticipantId,
      speaker_role: input.speakerRole,
      transcript_text: input.transcriptText,
      generation_id: input.generationId,
      ...input.conversation,
    }),
  });
}

function createInterruptionEvent(input: {
  readonly eventId: UuidV7;
  readonly aggregateVersion: number;
  readonly tenantId: TenantId;
  readonly sessionId: SessionId;
  readonly trace: TurnCommandTrace;
  readonly causationId: UuidV7 | null;
  readonly occurredAt: string;
}): Record<string, unknown> {
  return Object.freeze({
    schema_version: CURRENT_SCHEMA_VERSION,
    event_id: input.eventId,
    event_type: "turn.interrupted",
    event_version: 1,
    aggregate_type: "interaction_session",
    aggregate_id: input.sessionId,
    aggregate_version: input.aggregateVersion,
    tenant_id: input.tenantId,
    session_id: input.sessionId,
    producer: TURN_DRIVER_PRODUCER,
    trace_id: input.trace.trace_id,
    correlation_id: input.trace.correlation_id,
    causation_id: input.causationId,
    data_classification: "internal",
    occurred_at: input.occurredAt,
    payload: Object.freeze({}),
  });
}

async function runFastLane(
  options: NormalizedOptions,
  request: FastLaneRequest,
  generationSignal: AbortSignal,
  commandSignal: AbortSignal | undefined,
): Promise<FastLaneResponse> {
  const controller = new AbortController();
  let timerHandle: unknown;
  let settled = false;
  return new Promise<FastLaneResponse>((resolve, reject) => {
    const cleanup = (): void => {
      generationSignal.removeEventListener("abort", onGenerationAbort);
      commandSignal?.removeEventListener("abort", onCommandAbort);
      try {
        options.timeoutScheduler.clearTimeout(timerHandle);
      } catch {
        // The result has already been fenced. Scheduler cleanup must not expose a raw failure.
      }
    };
    const settle = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const onGenerationAbort = (): void => {
      controller.abort("generation_cancelled");
      settle(() => reject(new TurnDriverGenerationCancelledError()));
    };
    const onCommandAbort = (): void => {
      controller.abort("request_cancelled");
      settle(() => reject(new TurnDriverGenerationCancelledError()));
    };
    if (generationSignal.aborted) {
      onGenerationAbort();
      return;
    }
    if (commandSignal?.aborted) {
      onCommandAbort();
      return;
    }
    generationSignal.addEventListener("abort", onGenerationAbort, { once: true });
    commandSignal?.addEventListener("abort", onCommandAbort, { once: true });
    try {
      timerHandle = options.timeoutScheduler.setTimeout(() => {
        controller.abort("fast_lane_timeout");
        settle(() => reject(new TurnDriverTimeoutError()));
      }, options.fastLaneTimeoutMs);
    } catch {
      controller.abort("fast_lane_scheduler_failure");
      settle(() => reject(new TurnDriverTimeoutError()));
      return;
    }
    const control = Object.freeze({ signal: controller.signal, timeout_ms: options.fastLaneTimeoutMs });
    void Promise.resolve()
      .then(() => options.fastLane.respond(request, control))
      .then(
        (response) => {
          if (settled || controller.signal.aborted) return;
          try {
            const normalized = normalizeFastLaneResponse(response);
            settle(() => resolve(normalized));
          } catch {
            settle(() => reject(new TurnDriverFastLaneError()));
          }
        },
        () => {
          if (settled) return;
          if (controller.signal.aborted) {
            settle(() => reject(new TurnDriverGenerationCancelledError()));
            return;
          }
          settle(() => reject(new TurnDriverFastLaneError()));
        },
      );
  });
}

function assertFastLaneContext(
  value: unknown,
  tenantId: TenantId,
  sessionId: SessionId,
  contextVersion: number,
  now: number,
): ContextComposition {
  try {
    const context = parseContextComposition(value);
    if (context.tenant_id !== tenantId || context.session_id !== sessionId || context.context_version !== contextVersion) {
      throw new TurnDriverFastLaneError();
    }
    assertFastLaneContextFreshness(context, now);
    return context;
  } catch (error) {
    if (error instanceof TurnDriverFastLaneError) throw error;
    throw new TurnDriverFastLaneError();
  }
}

function assertFastLaneContextFreshness(context: ContextComposition, now: number): void {
  if (contextTimestampMilliseconds(context.composed_at) > now) throw new TurnDriverFastLaneError();
  if (context.expires_at !== null && contextTimestampMilliseconds(context.expires_at) <= now) {
    throw new TurnDriverFastLaneError();
  }
  for (const entry of context.entries) {
    const observedAt = contextTimestampMilliseconds(entry.provenance.observed_at);
    if (observedAt > now) throw new TurnDriverFastLaneError();
    if (entry.provenance.expires_at !== null) {
      const expiresAt = contextTimestampMilliseconds(entry.provenance.expires_at);
      if (expiresAt <= now || observedAt > expiresAt) throw new TurnDriverFastLaneError();
    }
  }
}

function contextTimestampMilliseconds(value: string): number {
  const milliseconds = Date.parse(value);
  if (!Number.isSafeInteger(milliseconds)) throw new TurnDriverFastLaneError();
  return milliseconds;
}

function normalizeFastLaneResponse(value: unknown): FastLaneResponse {
  const record = strictRecord(value, ["response_text", "patch"], TurnDriverFastLaneError);
  return Object.freeze({
    response_text: normalizeResponseText(record.response_text, TurnDriverFastLaneError),
    patch: normalizeFastLanePatch(record.patch, TurnDriverFastLaneError),
  });
}

function normalizeFastLanePatch(value: unknown, ErrorType: new () => Error): FastLaneConversationPatch {
  const record = strictRecord(value, ["active_topic", "open_questions", "repair_state", "incremental_summary"], ErrorType);
  const activeTopic = record.active_topic === null
    ? null
    : boundedString(record.active_topic, 0, 300, ErrorType);
  if (!Array.isArray(record.open_questions) || record.open_questions.length > MAX_PATCH_OPEN_QUESTIONS) {
    throw new ErrorType();
  }
  const openQuestions = record.open_questions.map((question) => boundedString(question, 1, MAX_PATCH_QUESTION_CHARACTERS, ErrorType));
  if (record.repair_state !== "none" && record.repair_state !== "clarifying") throw new ErrorType();
  return Object.freeze({
    active_topic: activeTopic,
    open_questions: Object.freeze(openQuestions),
    repair_state: record.repair_state,
    incremental_summary: boundedString(record.incremental_summary, 0, MAX_PATCH_SUMMARY_CHARACTERS, ErrorType),
  });
}

function immutablePatch(patch: FastLaneConversationPatch): FastLaneConversationPatch {
  return Object.freeze({
    active_topic: patch.active_topic,
    open_questions: Object.freeze([...patch.open_questions]),
    repair_state: patch.repair_state,
    incremental_summary: patch.incremental_summary,
  });
}

function normalizeResponseText(value: unknown, ErrorType: new () => Error): string {
  const text = boundedString(value, 1, MAX_RESPONSE_CHARACTERS, ErrorType);
  if (text.includes("\u0000") || new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) throw new ErrorType();
  return text;
}

function normalizeRestrictedText(value: unknown, ErrorType: new () => Error): string {
  const text = boundedString(value, 1, MAX_TEXT_CHARACTERS, ErrorType);
  if (text.includes("\u0000") || new TextEncoder().encode(text).byteLength > MAX_TEXT_BYTES) throw new ErrorType();
  return text;
}

function parseLanguage(value: unknown): string {
  if (typeof value !== "string" || !LANGUAGE_PATTERN.test(value)) throw new TurnDriverValidationError();
  return value;
}

function parseClientCommandId(value: unknown): string {
  if (typeof value !== "string" || !CLIENT_COMMAND_ID_PATTERN.test(value)) throw new TurnDriverValidationError();
  return value;
}

function parseSessionIdOrValidation(value: unknown): SessionId {
  try {
    return parseSessionId(value);
  } catch {
    throw new TurnDriverValidationError();
  }
}

function latestEventId(outbox: TransactionalOutboxRepository, request: AuthorizedRequestContext, sessionId: SessionId): UuidV7 | null {
  const records = outbox.listOutbox(request)
    .filter((record) => record.aggregate_id === sessionId)
    .sort((left, right) => left.aggregate_version - right.aggregate_version);
  const last = records.at(-1);
  if (last === undefined) return null;
  try {
    return parseUuidV7(last.event_id, "event_id");
  } catch {
    throw new TurnDriverConflictError();
  }
}

function nextId(generator: TurnDriverIdGenerator): UuidV7 {
  try {
    return parseUuidV7(generator.nextId(), "event_id");
  } catch {
    throw new TurnDriverConfigurationError();
  }
}

function nowIso(clock: TurnDriverClock): string {
  const now = checkedNow(clock);
  return new Date(now).toISOString();
}

function checkedNow(clock: TurnDriverClock): number {
  const value = clock.now();
  if (!Number.isSafeInteger(value) || value < 0) throw new TurnDriverConfigurationError();
  return value;
}

function duration(clock: TurnDriverClock, startedAt: number): number {
  const current = checkedNow(clock);
  return current >= startedAt ? current - startedAt : 0;
}

function normalizeClock(value: unknown): TurnDriverClock {
  if (value === null || typeof value !== "object" || typeof (value as TurnDriverClock).now !== "function") {
    throw new TurnDriverConfigurationError();
  }
  return value as TurnDriverClock;
}

function normalizeIdGenerator(value: unknown): TurnDriverIdGenerator {
  if (value === null || typeof value !== "object" || typeof (value as TurnDriverIdGenerator).nextId !== "function") {
    throw new TurnDriverConfigurationError();
  }
  return value as TurnDriverIdGenerator;
}

function normalizeTimeoutScheduler(value: unknown): SessionRuntimeTimeoutScheduler {
  if (value === null || typeof value !== "object"
    || typeof (value as SessionRuntimeTimeoutScheduler).setTimeout !== "function"
    || typeof (value as SessionRuntimeTimeoutScheduler).clearTimeout !== "function") {
    throw new TurnDriverConfigurationError();
  }
  return value as SessionRuntimeTimeoutScheduler;
}

function assertReplayControl(control: SessionActorReplayControl | undefined): void {
  if (control !== undefined && control.signal.aborted) throw new TurnDriverGenerationCancelledError();
}

function boundedInteger(
  value: unknown,
  defaultValue: number,
  minimum: number,
  maximum: number,
  ErrorType: new () => Error,
): number {
  if (value === undefined) return defaultValue;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new ErrorType();
  }
  return value;
}

function boundedString(value: unknown, minimum: number, maximum: number, ErrorType: new () => Error): string {
  if (typeof value !== "string" || value.length < minimum || value.length > maximum) throw new ErrorType();
  return value;
}

function strictRecord(
  value: unknown,
  allowedKeys: readonly string[],
  ErrorType: new () => Error,
  optional = false,
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new ErrorType();
  let descriptors: Record<string, PropertyDescriptor>;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null || Object.getOwnPropertySymbols(value).length > 0) {
      throw new Error();
    }
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    throw new ErrorType();
  }
  const keys = Object.keys(descriptors);
  if (keys.some((key) => !allowedKeys.includes(key))) throw new ErrorType();
  if (!optional && allowedKeys.some((key) => descriptors[key] === undefined)) throw new ErrorType();
  for (const descriptor of Object.values(descriptors)) {
    if (!("value" in descriptor)) throw new ErrorType();
  }
  return Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]));
}

function tenantSessionKey(tenantId: TenantId, sessionId: SessionId): string {
  return `${tenantId}:${sessionId}`;
}

function participantDirectoryKey(tenantId: TenantId, sessionId: SessionId, actorId: UuidV7): string {
  return `${tenantId}:${sessionId}:${actorId}`;
}

function registeredParticipantKey(tenantId: TenantId, sessionId: SessionId, participantId: UuidV7): string {
  return `${tenantId}:${sessionId}:${participantId}`;
}

function commandIdempotencyKey(
  tenantId: TenantId,
  sessionId: SessionId,
  participantId: UuidV7,
  idempotencyKey: string,
): string {
  return `${tenantId}:${sessionId}:${participantId}:key:${idempotencyKey}`;
}

function commandClientKey(
  tenantId: TenantId,
  sessionId: SessionId,
  participantId: UuidV7,
  clientCommandId: string,
): string {
  return `${tenantId}:${sessionId}:${participantId}:client:${clientCommandId}`;
}
