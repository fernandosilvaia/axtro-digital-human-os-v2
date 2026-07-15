import {
  getAuthorizedTenantContext,
  type AuthorizedRequestContext,
} from "@axtro/auth";
import type {
  ConsentEvidence,
  DisclosureRecord,
  EventEnvelope,
  InteractionSessionState,
} from "@axtro/contracts-ts";
import {
  CURRENT_SCHEMA_VERSION,
  createUuidV7,
  parseCorrelationId,
  parseSessionId,
  parseTenantId,
  parseUuidV7,
  sha256Canonical,
  type CorrelationId,
  type SessionId,
  type TenantId,
  type UuidV7,
} from "@axtro/domain";
import type { TransactionalOutboxRepository } from "@axtro/events";

export const SESSION_LIFECYCLE_OPERATIONS = [
  "create_session",
  "activate_session",
  "complete_session",
] as const;

export type SessionLifecycleOperation = (typeof SESSION_LIFECYCLE_OPERATIONS)[number];
export type EssentialConsentStatus = "not_required" | "granted" | "denied" | "revoked";

export interface SessionLifecycleClock {
  now(): number;
}

export interface SessionLifecycleIdGenerator {
  nextId(): unknown;
}

/** Server-owned registration. It is never derived from a public request body. */
export interface SessionLifecycleRegistrationInput {
  readonly tenant_id: unknown;
  readonly agent_id: unknown;
  readonly role_pack_id: unknown;
  readonly role_pack_version: unknown;
  readonly presenter_id: unknown;
  readonly essential_consent_status?: unknown;
  /** Server-owned channel policy. M1 defaults to the local API channel only. */
  readonly allowed_channels?: unknown;
}

export interface SessionCommandTraceInput {
  readonly trace_id: unknown;
  readonly correlation_id: unknown;
}

export interface SessionCommandTrace {
  readonly trace_id: string;
  readonly correlation_id: CorrelationId;
}

/** Trusted cancellation fence supplied by the authenticated API boundary. */
export interface SessionCommandControl {
  assertActive(): void;
}

export interface DisclosureDeliveryRequest {
  readonly tenant_id: TenantId;
  readonly session_id: SessionId;
  readonly disclosure_id: UuidV7;
  readonly channel: InteractionSessionState["channel"]["type"];
  readonly language: string;
  readonly content_hash: string;
  readonly occurred_at: string;
}

/** Minimal receipt required before a `disclosure.delivered` event may be written. */
export interface DisclosureDeliveryReceipt {
  readonly delivery_channel: DisclosureRecord["delivery_channel"];
  readonly content_hash: string;
  readonly delivered_at: string;
  readonly receipt_hash: string;
}

/** Provider-shaped port. M1 composes only the deterministic local fake below. */
export interface DisclosureDeliveryPort {
  deliver(input: DisclosureDeliveryRequest, control: SessionCommandControl): Promise<DisclosureDeliveryReceipt>;
}

export interface DeterministicDisclosureDeliveryFakeOptions {
  readonly outcome?: "delivered" | "unavailable";
}

export interface SessionLifecycleApplicationOptions {
  readonly outbox: TransactionalOutboxRepository;
  readonly registrations: readonly SessionLifecycleRegistrationInput[];
  readonly clock?: SessionLifecycleClock;
  readonly idGenerator?: SessionLifecycleIdGenerator;
  /** Local deterministic persistence seam. A future SQL store replaces it. */
  readonly store?: DeterministicSessionLifecycleStore;
  /** Local fake only. The default is bounded per tenant and intentionally has no TTL. */
  readonly idempotency_capacity_per_tenant?: unknown;
  /** Local fake only. It returns a receipt before disclosure state is committed. */
  readonly disclosure_delivery?: DisclosureDeliveryPort;
}

export interface SessionTimelinePage {
  readonly items: readonly EventEnvelope[];
  readonly next_after_version: number | null;
}

export interface SessionLifecycleApplication {
  createSession(
    request: AuthorizedRequestContext,
    input: unknown,
    idempotencyKey: unknown,
    trace: SessionCommandTraceInput,
    control?: SessionCommandControl,
  ): Promise<InteractionSessionState>;
  getSession(request: AuthorizedRequestContext, sessionId: unknown): InteractionSessionState;
  activateSession(
    request: AuthorizedRequestContext,
    sessionId: unknown,
    input: unknown,
    idempotencyKey: unknown,
    trace: SessionCommandTraceInput,
    control?: SessionCommandControl,
  ): Promise<InteractionSessionState>;
  completeSession(
    request: AuthorizedRequestContext,
    sessionId: unknown,
    input: unknown,
    idempotencyKey: unknown,
    trace: SessionCommandTraceInput,
    control?: SessionCommandControl,
  ): Promise<InteractionSessionState>;
  listTimeline(
    request: AuthorizedRequestContext,
    sessionId: unknown,
    afterVersion: unknown,
  ): SessionTimelinePage;
  readDisclosureRecord(request: AuthorizedRequestContext, sessionId: unknown): DisclosureRecord | null;
  readConsentEvidence(request: AuthorizedRequestContext, sessionId: unknown): ConsentEvidence | null;
}

export class SessionLifecycleValidationError extends Error {
  constructor() {
    super("Session lifecycle request is invalid");
    this.name = "SessionLifecycleValidationError";
  }
}

export class SessionLifecycleConflictError extends Error {
  constructor() {
    super("Session lifecycle command conflicts with authoritative state");
    this.name = "SessionLifecycleConflictError";
  }
}

export class SessionLifecycleNotFoundError extends Error {
  constructor() {
    super("Session was not found in the authorized tenant");
    this.name = "SessionLifecycleNotFoundError";
  }
}

export class SessionLifecycleAuthorizationError extends Error {
  constructor() {
    super("Session lifecycle command is not authorized");
    this.name = "SessionLifecycleAuthorizationError";
  }
}

export class SessionLifecycleConfigurationError extends Error {
  constructor() {
    super("Session lifecycle configuration is invalid");
    this.name = "SessionLifecycleConfigurationError";
  }
}

export class SessionLifecycleRateLimitError extends Error {
  constructor() {
    super("Session lifecycle command capacity is exhausted");
    this.name = "SessionLifecycleRateLimitError";
  }
}

export class SessionLifecycleDisclosureDeliveryError extends Error {
  constructor() {
    super("Session disclosure delivery is unavailable");
    this.name = "SessionLifecycleDisclosureDeliveryError";
  }
}

interface NormalizedRegistration {
  readonly tenantId: TenantId;
  readonly agentId: UuidV7;
  readonly rolePackId: string;
  readonly rolePackVersion: string;
  readonly presenterId: UuidV7;
  readonly essentialConsentStatus: EssentialConsentStatus;
  readonly allowedChannels: readonly InteractionSessionState["channel"]["type"][];
}

interface CreateSessionCommand {
  readonly agent_id: UuidV7;
  readonly role_pack_id: string;
  readonly role_pack_version: string;
  readonly channel: InteractionSessionState["channel"]["type"];
  readonly language: string;
}

interface ActivateSessionCommand {
  readonly presenter_id: UuidV7;
  readonly expected_state_version: number;
}

interface CompleteSessionCommand {
  readonly expected_state_version: number;
  readonly reason_hash: string;
}

interface IdempotencyRecord {
  readonly operation: SessionLifecycleOperation;
  readonly resource: string;
  readonly requestHash: string;
  readonly result: InteractionSessionState;
}

interface LocalStoreSnapshot {
  readonly participants: Map<string, Set<UuidV7>>;
  readonly disclosures: Map<string, DisclosureRecord>;
  readonly consents: Map<string, ConsentEvidence>;
  readonly disclosureReceipts: Map<string, DisclosureDeliveryReceipt>;
}

interface KeyLockState {
  locked: boolean;
  readonly waiting: Array<() => void>;
}

export interface DeterministicSessionLifecycleStore {
  readonly __deterministicSessionLifecycleStore?: never;
}

interface StoreState {
  readonly participants: Map<string, Set<UuidV7>>;
  readonly disclosures: Map<string, DisclosureRecord>;
  readonly consents: Map<string, ConsentEvidence>;
  readonly disclosureReceipts: Map<string, DisclosureDeliveryReceipt>;
  readonly idempotency: Map<string, IdempotencyRecord>;
  readonly idempotencyKeysByTenant: Map<TenantId, Set<string>>;
  readonly locks: Map<string, KeyLockState>;
}

const MAX_TIMELINE_PAGE_SIZE = 100;
const MAX_LOCKS = 1_024;
const MAX_WAITERS_PER_LOCK = 16;
const DEFAULT_IDEMPOTENCY_CAPACITY_PER_TENANT = 256;
const MAX_IDEMPOTENCY_CAPACITY_PER_TENANT = 1_024;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~-]{15,199}$/;
const ROLE_PACK_PATTERN = /^[a-z][a-z0-9._-]{0,199}$/;
const ROLE_PACK_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,49}$/;
const LANGUAGE_PATTERN = /^[a-z]{2}(-[A-Z]{2})?$/;
const TRACE_ID_PATTERN = /^[0-9a-f]{16,64}$/;
const CHANNELS: readonly InteractionSessionState["channel"]["type"][] = [
  "native_room",
  "telephone",
  "google_meet",
  "zoom",
  "teams",
  "web_widget",
  "api",
];
const ESSENTIAL_CONSENT_STATUSES: readonly EssentialConsentStatus[] = [
  "not_required",
  "granted",
  "denied",
  "revoked",
];
const DISCLOSURE_VERSION = "ai-identity@1";
const LIFECYCLE_PRODUCER = "session-application";
const STORES = new WeakMap<object, StoreState>();
const NOOP_COMMAND_CONTROL: SessionCommandControl = Object.freeze({ assertActive() {} });

/** Creates a local, shareable fake store for lifecycle tests and Walking Skeleton composition. */
export function createDeterministicSessionLifecycleStore(): DeterministicSessionLifecycleStore {
  const store = Object.freeze({}) as DeterministicSessionLifecycleStore;
  STORES.set(store, {
    participants: new Map(),
    disclosures: new Map(),
    consents: new Map(),
    disclosureReceipts: new Map(),
    idempotency: new Map(),
    idempotencyKeysByTenant: new Map(),
    locks: new Map(),
  });
  return store;
}

/**
 * Local deterministic disclosure delivery. It is deliberately the only M1
 * delivery implementation and has no provider SDK, network, clock or secret.
 */
export function createDeterministicDisclosureDeliveryFake(
  optionsInput: DeterministicDisclosureDeliveryFakeOptions = {},
): DisclosureDeliveryPort {
  const options = normalizeDisclosureDeliveryFakeOptions(optionsInput);
  return Object.freeze({
    async deliver(input: DisclosureDeliveryRequest, control: SessionCommandControl): Promise<DisclosureDeliveryReceipt> {
      const request = normalizeDisclosureDeliveryRequest(input);
      assertCommandActive(control);
      if (options.outcome === "unavailable") throw new SessionLifecycleDisclosureDeliveryError();
      const receipt = Object.freeze({
        delivery_channel: deliveryChannelFor(request.channel),
        content_hash: request.content_hash,
        delivered_at: request.occurred_at,
        receipt_hash: sha256Canonical({
          schema: "local-disclosure-delivery@1",
          tenant_id: request.tenant_id,
          session_id: request.session_id,
          disclosure_id: request.disclosure_id,
          channel: request.channel,
          language: request.language,
          content_hash: request.content_hash,
          delivered_at: request.occurred_at,
        }),
      } satisfies DisclosureDeliveryReceipt);
      assertCommandActive(control);
      return receipt;
    },
  });
}

/**
 * Deterministic in-process implementation for M1. It is a persistence seam,
 * not a production database adapter. A SQL implementation must retain its
 * tenant-scoped atomicity and idempotency semantics.
 */
export function createDeterministicSessionLifecycleApplication(
  optionsInput: SessionLifecycleApplicationOptions,
): SessionLifecycleApplication {
  const options = normalizeOptions(optionsInput);
  const registrations = new Map<string, NormalizedRegistration>();
  for (const registration of options.registrations) {
    const normalized = normalizeRegistration(registration);
    const key = registrationKey(normalized.tenantId, normalized.agentId, normalized.rolePackId, normalized.rolePackVersion);
    if (registrations.has(key)) throw new SessionLifecycleConfigurationError();
    registrations.set(key, normalized);
  }
  if (registrations.size === 0) throw new SessionLifecycleConfigurationError();

  const clock = options.clock ?? systemClock;
  const idGenerator = options.idGenerator ?? { nextId: () => createUuidV7(checkedNow(clock)) };
  const disclosureDelivery = options.disclosure_delivery ?? createDeterministicDisclosureDeliveryFake();
  const idempotencyCapacityPerTenant = options.idempotency_capacity_per_tenant === undefined
    ? DEFAULT_IDEMPOTENCY_CAPACITY_PER_TENANT
    : parseIdempotencyCapacity(options.idempotency_capacity_per_tenant);
  assertClock(clock);
  assertIdGenerator(idGenerator);
  assertDisclosureDeliveryPort(disclosureDelivery);
  const storeState = resolveStore(options.store);
  const {
    participants,
    disclosures,
    consents,
    disclosureReceipts,
    idempotency,
    idempotencyKeysByTenant,
    locks,
  } = storeState;

  const captureStore = (): LocalStoreSnapshot => ({
    participants: new Map([...participants].map(([key, value]) => [key, new Set(value)])),
    disclosures: new Map([...disclosures].map(([key, value]) => [key, immutableCopy(value)])),
    consents: new Map([...consents].map(([key, value]) => [key, immutableCopy(value)])),
    disclosureReceipts: new Map([...disclosureReceipts].map(([key, value]) => [key, immutableCopy(value)])),
  });

  const restoreStore = (snapshot: LocalStoreSnapshot): void => {
    participants.clear();
    disclosures.clear();
    consents.clear();
    disclosureReceipts.clear();
    for (const [key, value] of snapshot.participants) participants.set(key, new Set(value));
    for (const [key, value] of snapshot.disclosures) disclosures.set(key, immutableCopy(value));
    for (const [key, value] of snapshot.consents) consents.set(key, immutableCopy(value));
    for (const [key, value] of snapshot.disclosureReceipts) disclosureReceipts.set(key, immutableCopy(value));
  };

  const runWithRollback = async <Result>(work: () => Promise<Result>): Promise<Result> => {
    const snapshot = captureStore();
    try {
      return await work();
    } catch (error) {
      restoreStore(snapshot);
      throw error;
    }
  };

  const acquireLock = async (key: string): Promise<() => void> => {
    let state = locks.get(key);
    if (state === undefined) {
      if (locks.size >= MAX_LOCKS) throw new SessionLifecycleConflictError();
      state = { locked: false, waiting: [] };
      locks.set(key, state);
    }
    if (state.waiting.length >= MAX_WAITERS_PER_LOCK) throw new SessionLifecycleConflictError();
    return new Promise((resolve) => {
      const grant = (): void => {
        state!.locked = true;
        let released = false;
        resolve(() => {
          if (released) return;
          released = true;
          const next = state!.waiting.shift();
          if (next === undefined) {
            state!.locked = false;
            locks.delete(key);
            return;
          }
          next();
        });
      };
      if (!state.locked) {
        grant();
        return;
      }
      state.waiting.push(grant);
    });
  };

  const withLocks = async <Result>(keys: readonly string[], work: () => Promise<Result>): Promise<Result> => {
    const releases: Array<() => void> = [];
    try {
      for (const key of [...new Set(keys)].sort()) releases.push(await acquireLock(key));
      return await work();
    } finally {
      for (const release of releases.reverse()) release();
    }
  };

  const requireScope = (request: AuthorizedRequestContext, scope: "session:read" | "session:write"): TenantId => {
    const context = getAuthorizedTenantContext(request);
    if (
      !context.grantedScopes.includes(scope)
      || !context.purposes.includes("essential_processing")
    ) throw new SessionLifecycleAuthorizationError();
    return context.tenantId;
  };

  const requireRegistration = (tenantId: TenantId, command: CreateSessionCommand): NormalizedRegistration => {
    const registration = registrations.get(registrationKey(
      tenantId,
      command.agent_id,
      command.role_pack_id,
      command.role_pack_version,
    ));
    if (registration === undefined) throw new SessionLifecycleValidationError();
    return registration;
  };

  const currentState = (request: AuthorizedRequestContext, sessionId: SessionId): InteractionSessionState => {
    const aggregate = options.outbox.readInteractionAggregate(request, sessionId);
    if (aggregate === null) throw new SessionLifecycleNotFoundError();
    return immutableCopy(aggregate.session);
  };

  const mutate = async (
    request: AuthorizedRequestContext,
    tenantId: TenantId,
    operation: SessionLifecycleOperation,
    resource: string,
    idempotencyKey: string,
    fingerprint: unknown,
    sessionLockKey: string | null,
    control: SessionCommandControl,
    work: () => Promise<InteractionSessionState>,
  ): Promise<InteractionSessionState> => {
    assertCommandActive(control);
    const requestHash = sha256Canonical(fingerprint);
    const idempotencyStoreKey = tenantKey(tenantId, idempotencyKey);
    const lockKeys = sessionLockKey === null ? [idempotencyStoreKey] : [idempotencyStoreKey, sessionLockKey];
    return withLocks(lockKeys, async () => {
      assertCommandActive(control);
      const existing = idempotency.get(idempotencyStoreKey);
      if (existing !== undefined) {
        if (existing.operation !== operation || existing.resource !== resource || existing.requestHash !== requestHash) {
          throw new SessionLifecycleConflictError();
        }
        assertCommandActive(control);
        return immutableCopy(existing.result);
      }
      const tenantIdempotencyKeys = idempotencyKeysByTenant.get(tenantId) ?? new Set<string>();
      if (tenantIdempotencyKeys.size >= idempotencyCapacityPerTenant) throw new SessionLifecycleRateLimitError();
      const result = await runWithRollback(work);
      idempotency.set(idempotencyStoreKey, immutableCopy({
        operation,
        resource,
        requestHash,
        result,
      }));
      tenantIdempotencyKeys.add(idempotencyStoreKey);
      idempotencyKeysByTenant.set(tenantId, tenantIdempotencyKeys);
      return immutableCopy(result);
    });
  };

  const application: SessionLifecycleApplication = {
    async createSession(request, input, idempotencyKeyInput, traceInput, controlInput): Promise<InteractionSessionState> {
      const tenantId = requireScope(request, "session:write");
      const command = parseCreateSessionCommand(input);
      const idempotencyKey = parseIdempotencyKey(idempotencyKeyInput);
      const trace = parseCommandTrace(traceInput);
      const registration = requireRegistration(tenantId, command);
      const control = normalizeCommandControl(controlInput);
      if (!registration.allowedChannels.includes(command.channel)) throw new SessionLifecycleValidationError();
      return mutate(
        request,
        tenantId,
        "create_session",
        "/sessions",
        idempotencyKey,
        command,
        null,
        control,
        async () => {
          assertCommandActive(control);
          const timestamp = nowIso(clock);
          const sessionId = parseSessionId(nextId(idGenerator));
          const disclosureId = parseUuidV7(nextId(idGenerator), "disclosure_id");
          const consentId = registration.essentialConsentStatus === "not_required" ? null : parseUuidV7(nextId(idGenerator), "consent_id");
          const eventIds = [
            parseUuidV7(nextId(idGenerator), "event_id"),
            parseUuidV7(nextId(idGenerator), "event_id"),
            parseUuidV7(nextId(idGenerator), "event_id"),
            parseUuidV7(nextId(idGenerator), "event_id"),
          ];
          const createdId = eventIds[0];
          const preparedId = eventIds[1];
          const disclosureEventId = eventIds[2];
          const consentEventId = eventIds[3];
          if (createdId === undefined || preparedId === undefined || disclosureEventId === undefined || consentEventId === undefined) {
            throw new SessionLifecycleConfigurationError();
          }

          const disclosureContentHash = disclosureContentHashFor(command.language);
          const receipt = await disclosureDelivery.deliver(Object.freeze({
            tenant_id: tenantId,
            session_id: sessionId,
            disclosure_id: disclosureId,
            channel: command.channel,
            language: command.language,
            content_hash: disclosureContentHash,
            occurred_at: timestamp,
          }), control);
          assertCommandActive(control);
          const disclosure = disclosureRecord({
            disclosureId,
            sessionId,
            tenantId,
            channel: command.channel,
            language: command.language,
            receipt,
          });
          const consent = registration.essentialConsentStatus === "not_required" || consentId === null
            ? null
            : consentEvidence({
              consentId,
              sessionId,
              tenantId,
              status: registration.essentialConsentStatus,
              timestamp,
            });
          const sessionKey = tenantSessionKey(tenantId, sessionId);
          participants.set(sessionKey, new Set([registration.presenterId]));
          disclosures.set(sessionKey, immutableCopy(disclosure));
          disclosureReceipts.set(sessionKey, immutableCopy(normalizeDisclosureDeliveryReceipt(receipt, command.channel, disclosureContentHash)));
          if (consent !== null) consents.set(sessionKey, immutableCopy(consent));

          const events = [
            lifecycleEvent({
              eventId: createdId,
              eventType: "session.created",
              aggregateVersion: 1,
              tenantId,
              sessionId,
              trace,
              causationId: null,
              occurredAt: timestamp,
              payload: {
                agent_id: registration.agentId,
                channel: channelFromCommand(command.channel),
                consent_status: "pending",
                disclosure_status: "pending",
                capabilities: lifecycleCapabilities(),
                role: roleSeed(command, timestamp),
                language: command.language,
              },
            }),
            lifecycleEvent({
              eventId: preparedId,
              eventType: "session.prepared",
              aggregateVersion: 2,
              tenantId,
              sessionId,
              trace,
              causationId: createdId,
              occurredAt: timestamp,
              payload: {},
            }),
            lifecycleEvent({
              eventId: disclosureEventId,
              eventType: "disclosure.delivered",
              aggregateVersion: 3,
              tenantId,
              sessionId,
              trace,
              causationId: preparedId,
              occurredAt: timestamp,
              payload: { status: "delivered" },
            }),
            lifecycleEvent({
              eventId: consentEventId,
              eventType: "consent.recorded",
              aggregateVersion: 4,
              tenantId,
              sessionId,
              trace,
              causationId: disclosureEventId,
              occurredAt: timestamp,
              payload: { status: registration.essentialConsentStatus },
            }),
          ];
          assertCommandActive(control);
          const committed = await options.outbox.commitInteractionEvents(request, events, control);
          return immutableCopy(committed.aggregate.session);
        },
      );
    },

    getSession(request, sessionIdInput): InteractionSessionState {
      requireScope(request, "session:read");
      const sessionId = parseSessionIdentifier(sessionIdInput);
      return currentState(request, sessionId);
    },

    async activateSession(request, sessionIdInput, input, idempotencyKeyInput, traceInput, controlInput): Promise<InteractionSessionState> {
      const tenantId = requireScope(request, "session:write");
      const sessionId = parseSessionIdentifier(sessionIdInput);
      const command = parseActivateSessionCommand(input);
      const idempotencyKey = parseIdempotencyKey(idempotencyKeyInput);
      const trace = parseCommandTrace(traceInput);
      const control = normalizeCommandControl(controlInput);
      const resource = `/sessions/${sessionId}/activate`;
      return mutate(
        request,
        tenantId,
        "activate_session",
        resource,
        idempotencyKey,
        { session_id: sessionId, ...command },
        tenantSessionKey(tenantId, sessionId),
        control,
        async () => {
          assertCommandActive(control);
          const state = currentState(request, sessionId);
          if (state.state_version !== command.expected_state_version) throw new SessionLifecycleConflictError();
          if (state.status !== "ready") throw new SessionLifecycleConflictError();
          assertActivationEvidence(
            state,
            disclosures.get(tenantSessionKey(tenantId, sessionId)),
            consents.get(tenantSessionKey(tenantId, sessionId)),
            disclosureReceipts.get(tenantSessionKey(tenantId, sessionId)),
            clock,
          );
          const knownParticipants = participants.get(tenantSessionKey(tenantId, sessionId));
          if (knownParticipants === undefined || !knownParticipants.has(command.presenter_id)) {
            throw new SessionLifecycleConflictError();
          }
          const event = lifecycleEvent({
            eventId: nextId(idGenerator),
            eventType: "session.activated",
            aggregateVersion: state.state_version + 1,
            tenantId,
            sessionId,
            trace,
            causationId: latestEventId(options.outbox, request, sessionId),
            occurredAt: nowIso(clock),
            payload: { presenter_id: command.presenter_id },
          });
          assertCommandActive(control);
          const committed = await options.outbox.commitInteractionEvent(request, event, control);
          return immutableCopy(committed.aggregate.session);
        },
      );
    },

    async completeSession(request, sessionIdInput, input, idempotencyKeyInput, traceInput, controlInput): Promise<InteractionSessionState> {
      const tenantId = requireScope(request, "session:write");
      const sessionId = parseSessionIdentifier(sessionIdInput);
      const command = parseCompleteSessionCommand(input);
      const idempotencyKey = parseIdempotencyKey(idempotencyKeyInput);
      const trace = parseCommandTrace(traceInput);
      const control = normalizeCommandControl(controlInput);
      const resource = `/sessions/${sessionId}/complete`;
      return mutate(
        request,
        tenantId,
        "complete_session",
        resource,
        idempotencyKey,
        { session_id: sessionId, ...command },
        tenantSessionKey(tenantId, sessionId),
        control,
        async () => {
          assertCommandActive(control);
          const state = currentState(request, sessionId);
          if (state.state_version !== command.expected_state_version) throw new SessionLifecycleConflictError();
          if (state.status !== "ready" && state.status !== "active" && state.status !== "handoff_pending") {
            throw new SessionLifecycleConflictError();
          }
          const event = lifecycleEvent({
            eventId: nextId(idGenerator),
            eventType: "session.completed",
            aggregateVersion: state.state_version + 1,
            tenantId,
            sessionId,
            trace,
            causationId: latestEventId(options.outbox, request, sessionId),
            occurredAt: nowIso(clock),
            payload: {},
          });
          assertCommandActive(control);
          const committed = await options.outbox.commitInteractionEvent(request, event, control);
          return immutableCopy(committed.aggregate.session);
        },
      );
    },

    listTimeline(request, sessionIdInput, afterVersionInput): SessionTimelinePage {
      requireScope(request, "session:read");
      const sessionId = parseSessionIdentifier(sessionIdInput);
      currentState(request, sessionId);
      const afterVersion = parseAfterVersion(afterVersionInput);
      const items = options.outbox.listOutbox(request)
        .filter((record) => record.aggregate_id === sessionId)
        .filter((record) => record.aggregate_version > afterVersion)
        .sort((left, right) => left.aggregate_version - right.aggregate_version || left.event_id.localeCompare(right.event_id))
        .slice(0, MAX_TIMELINE_PAGE_SIZE)
        .map((record) => immutableCopy(record.event));
      const nextAfterVersion = items.length === MAX_TIMELINE_PAGE_SIZE
        ? items.at(-1)?.aggregate_version ?? null
        : null;
      return immutableCopy({ items, next_after_version: nextAfterVersion });
    },

    readDisclosureRecord(request, sessionIdInput): DisclosureRecord | null {
      const tenantId = requireScope(request, "session:read");
      const sessionId = parseSessionIdentifier(sessionIdInput);
      currentState(request, sessionId);
      const record = disclosures.get(tenantSessionKey(tenantId, sessionId));
      return record === undefined ? null : immutableCopy(record);
    },

    readConsentEvidence(request, sessionIdInput): ConsentEvidence | null {
      const tenantId = requireScope(request, "session:read");
      const sessionId = parseSessionIdentifier(sessionIdInput);
      currentState(request, sessionId);
      const record = consents.get(tenantSessionKey(tenantId, sessionId));
      return record === undefined ? null : immutableCopy(record);
    },
  };
  return Object.freeze(application);
}

function normalizeOptions(value: SessionLifecycleApplicationOptions): SessionLifecycleApplicationOptions {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new SessionLifecycleConfigurationError();
  const record = strictRecord(
    value,
    ["outbox", "registrations", "clock", "idGenerator", "store", "idempotency_capacity_per_tenant", "disclosure_delivery"],
    true,
    SessionLifecycleConfigurationError,
  );
  const outbox = readData(record, "outbox", SessionLifecycleConfigurationError);
  const registrations = readData(record, "registrations", SessionLifecycleConfigurationError);
  if (outbox === null || typeof outbox !== "object" || typeof (outbox as TransactionalOutboxRepository).commitInteractionEvent !== "function"
    || typeof (outbox as TransactionalOutboxRepository).commitInteractionEvents !== "function") {
    throw new SessionLifecycleConfigurationError();
  }
  if (!Array.isArray(registrations)) throw new SessionLifecycleConfigurationError();
  const clock = optionalData(record, "clock", SessionLifecycleConfigurationError);
  const idGenerator = optionalData(record, "idGenerator", SessionLifecycleConfigurationError);
  const store = optionalData(record, "store", SessionLifecycleConfigurationError);
  const idempotencyCapacity = optionalData(record, "idempotency_capacity_per_tenant", SessionLifecycleConfigurationError);
  const disclosureDelivery = optionalData(record, "disclosure_delivery", SessionLifecycleConfigurationError);
  return Object.freeze({
    outbox: outbox as TransactionalOutboxRepository,
    registrations: registrations as readonly SessionLifecycleRegistrationInput[],
    ...(clock === undefined ? {} : { clock: clock as SessionLifecycleClock }),
    ...(idGenerator === undefined ? {} : { idGenerator: idGenerator as SessionLifecycleIdGenerator }),
    ...(store === undefined ? {} : { store: store as DeterministicSessionLifecycleStore }),
    ...(idempotencyCapacity === undefined ? {} : { idempotency_capacity_per_tenant: idempotencyCapacity }),
    ...(disclosureDelivery === undefined ? {} : { disclosure_delivery: disclosureDelivery as DisclosureDeliveryPort }),
  });
}

function resolveStore(value: DeterministicSessionLifecycleStore | undefined): StoreState {
  const store = value ?? createDeterministicSessionLifecycleStore();
  if (store === null || typeof store !== "object") throw new SessionLifecycleConfigurationError();
  const state = STORES.get(store);
  if (state === undefined) throw new SessionLifecycleConfigurationError();
  return state;
}

function normalizeRegistration(value: SessionLifecycleRegistrationInput): NormalizedRegistration {
  const record = strictRecord(
    value,
    ["tenant_id", "agent_id", "role_pack_id", "role_pack_version", "presenter_id", "essential_consent_status", "allowed_channels"],
    true,
    SessionLifecycleConfigurationError,
  );
  const tenantId = parseTenantId(readData(record, "tenant_id", SessionLifecycleConfigurationError));
  const agentId = parseUuidV7(readData(record, "agent_id", SessionLifecycleConfigurationError), "agent_id");
  const rolePackId = parseRolePackId(readData(record, "role_pack_id", SessionLifecycleConfigurationError));
  const rolePackVersion = parseRolePackVersion(readData(record, "role_pack_version", SessionLifecycleConfigurationError));
  const presenterId = parseUuidV7(readData(record, "presenter_id", SessionLifecycleConfigurationError), "presenter_id");
  const statusInput = optionalData(record, "essential_consent_status", SessionLifecycleConfigurationError);
  const essentialConsentStatus = statusInput === undefined ? "not_required" : parseEssentialConsentStatus(statusInput);
  const allowedChannelsInput = optionalData(record, "allowed_channels", SessionLifecycleConfigurationError);
  const allowedChannels = allowedChannelsInput === undefined ? Object.freeze(["api"] as const) : parseAllowedChannels(allowedChannelsInput);
  return Object.freeze({ tenantId, agentId, rolePackId, rolePackVersion, presenterId, essentialConsentStatus, allowedChannels });
}

function parseCreateSessionCommand(value: unknown): CreateSessionCommand {
  const record = strictRecord(value, ["agent_id", "role_pack_id", "role_pack_version", "channel", "language"], false, SessionLifecycleValidationError);
  return Object.freeze({
    agent_id: parseUuidV7(readData(record, "agent_id", SessionLifecycleValidationError), "agent_id"),
    role_pack_id: parseRolePackId(readData(record, "role_pack_id", SessionLifecycleValidationError)),
    role_pack_version: parseRolePackVersion(readData(record, "role_pack_version", SessionLifecycleValidationError)),
    channel: parseChannel(readData(record, "channel", SessionLifecycleValidationError)),
    language: parseLanguage(readData(record, "language", SessionLifecycleValidationError)),
  });
}

function parseActivateSessionCommand(value: unknown): ActivateSessionCommand {
  const record = strictRecord(value, ["presenter_id", "expected_state_version"], false, SessionLifecycleValidationError);
  return Object.freeze({
    presenter_id: parseUuidV7(readData(record, "presenter_id", SessionLifecycleValidationError), "presenter_id"),
    expected_state_version: parseStateVersion(readData(record, "expected_state_version", SessionLifecycleValidationError)),
  });
}

function parseCompleteSessionCommand(value: unknown): CompleteSessionCommand {
  const record = strictRecord(value, ["reason", "expected_state_version"], false, SessionLifecycleValidationError);
  const reason = readData(record, "reason", SessionLifecycleValidationError);
  if (typeof reason !== "string" || reason.length < 1 || reason.length > 500 || /[\u0000-\u001F\u007F]/.test(reason)) {
    throw new SessionLifecycleValidationError();
  }
  return Object.freeze({
    expected_state_version: parseStateVersion(readData(record, "expected_state_version", SessionLifecycleValidationError)),
    reason_hash: sha256Canonical({ reason }),
  });
}

function parseCommandTrace(value: SessionCommandTraceInput): SessionCommandTrace {
  const record = strictRecord(value, ["trace_id", "correlation_id"], false, SessionLifecycleValidationError);
  const traceId = readData(record, "trace_id", SessionLifecycleValidationError);
  if (typeof traceId !== "string" || !TRACE_ID_PATTERN.test(traceId)) throw new SessionLifecycleValidationError();
  return Object.freeze({
    trace_id: traceId,
    correlation_id: parseCorrelationId(readData(record, "correlation_id", SessionLifecycleValidationError)),
  });
}

function parseIdempotencyKey(value: unknown): string {
  if (typeof value !== "string" || !IDEMPOTENCY_KEY_PATTERN.test(value)) throw new SessionLifecycleValidationError();
  return value;
}

function parseSessionIdentifier(value: unknown): SessionId {
  try {
    return parseSessionId(value);
  } catch {
    throw new SessionLifecycleValidationError();
  }
}

function parseAfterVersion(value: unknown): number {
  if (value === undefined) return 0;
  return parseStateVersion(value);
}

function parseStateVersion(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new SessionLifecycleValidationError();
  return value;
}

function parseIdempotencyCapacity(value: unknown): number {
  if (!Number.isSafeInteger(value) || typeof value !== "number" || value < 1 || value > MAX_IDEMPOTENCY_CAPACITY_PER_TENANT) {
    throw new SessionLifecycleConfigurationError();
  }
  return value;
}

function normalizeCommandControl(value: SessionCommandControl | undefined): SessionCommandControl {
  if (value === undefined) return NOOP_COMMAND_CONTROL;
  if (value === null || typeof value !== "object" || typeof value.assertActive !== "function") {
    throw new SessionLifecycleValidationError();
  }
  return value;
}

function assertCommandActive(control: SessionCommandControl): void {
  try {
    control.assertActive();
  } catch (error) {
    throw error;
  }
}

function parseAllowedChannels(value: unknown): readonly InteractionSessionState["channel"]["type"][] {
  if (!Array.isArray(value) || value.length < 1 || value.length > CHANNELS.length) throw new SessionLifecycleConfigurationError();
  const parsed = value.map((channel) => {
    try {
      return parseChannel(channel);
    } catch {
      throw new SessionLifecycleConfigurationError();
    }
  });
  if (new Set(parsed).size !== parsed.length) throw new SessionLifecycleConfigurationError();
  return Object.freeze(parsed);
}

function normalizeDisclosureDeliveryFakeOptions(value: DeterministicDisclosureDeliveryFakeOptions): Readonly<{ outcome: "delivered" | "unavailable" }> {
  const record = strictRecord(value, ["outcome"], true, SessionLifecycleConfigurationError);
  const outcome = optionalData(record, "outcome", SessionLifecycleConfigurationError);
  if (outcome !== undefined && outcome !== "delivered" && outcome !== "unavailable") throw new SessionLifecycleConfigurationError();
  return Object.freeze({ outcome: outcome === undefined ? "delivered" : outcome });
}

function normalizeDisclosureDeliveryRequest(value: DisclosureDeliveryRequest): DisclosureDeliveryRequest {
  const record = strictRecord(
    value,
    ["tenant_id", "session_id", "disclosure_id", "channel", "language", "content_hash", "occurred_at"],
    false,
    SessionLifecycleValidationError,
  );
  const contentHash = readData(record, "content_hash", SessionLifecycleValidationError);
  const occurredAt = readData(record, "occurred_at", SessionLifecycleValidationError);
  if (typeof contentHash !== "string" || !/^[0-9a-f]{64}$/.test(contentHash)) throw new SessionLifecycleValidationError();
  if (!isRfc3339Timestamp(occurredAt)) throw new SessionLifecycleValidationError();
  return Object.freeze({
    tenant_id: parseTenantId(readData(record, "tenant_id", SessionLifecycleValidationError)),
    session_id: parseSessionIdentifier(readData(record, "session_id", SessionLifecycleValidationError)),
    disclosure_id: parseUuidV7(readData(record, "disclosure_id", SessionLifecycleValidationError), "disclosure_id"),
    channel: parseChannel(readData(record, "channel", SessionLifecycleValidationError)),
    language: parseLanguage(readData(record, "language", SessionLifecycleValidationError)),
    content_hash: contentHash,
    occurred_at: occurredAt,
  });
}

function assertDisclosureDeliveryPort(value: DisclosureDeliveryPort): void {
  if (value === null || typeof value !== "object" || typeof value.deliver !== "function") {
    throw new SessionLifecycleConfigurationError();
  }
}

function normalizeDisclosureDeliveryReceipt(
  value: DisclosureDeliveryReceipt,
  channel: InteractionSessionState["channel"]["type"],
  expectedContentHash: string,
): DisclosureDeliveryReceipt {
  const record = strictRecord(
    value,
    ["delivery_channel", "content_hash", "delivered_at", "receipt_hash"],
    false,
    SessionLifecycleDisclosureDeliveryError,
  );
  const deliveryChannel = readData(record, "delivery_channel", SessionLifecycleDisclosureDeliveryError);
  const contentHash = readData(record, "content_hash", SessionLifecycleDisclosureDeliveryError);
  const deliveredAt = readData(record, "delivered_at", SessionLifecycleDisclosureDeliveryError);
  const receiptHash = readData(record, "receipt_hash", SessionLifecycleDisclosureDeliveryError);
  if (deliveryChannel !== deliveryChannelFor(channel)
    || contentHash !== expectedContentHash
    || !isRfc3339Timestamp(deliveredAt)
    || typeof receiptHash !== "string"
    || !/^[0-9a-f]{64}$/.test(receiptHash)) {
    throw new SessionLifecycleDisclosureDeliveryError();
  }
  const normalizedDeliveryChannel = deliveryChannel as DisclosureDeliveryReceipt["delivery_channel"];
  return Object.freeze({
    delivery_channel: normalizedDeliveryChannel,
    content_hash: contentHash,
    delivered_at: deliveredAt,
    receipt_hash: receiptHash,
  });
}

function isRfc3339Timestamp(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
}

function parseRolePackId(value: unknown): string {
  if (typeof value !== "string" || !ROLE_PACK_PATTERN.test(value)) throw new SessionLifecycleValidationError();
  return value;
}

function parseRolePackVersion(value: unknown): string {
  if (typeof value !== "string" || !ROLE_PACK_VERSION_PATTERN.test(value)) throw new SessionLifecycleValidationError();
  return value;
}

function parseChannel(value: unknown): InteractionSessionState["channel"]["type"] {
  if (typeof value !== "string" || !CHANNELS.includes(value as InteractionSessionState["channel"]["type"])) {
    throw new SessionLifecycleValidationError();
  }
  return value as InteractionSessionState["channel"]["type"];
}

function parseLanguage(value: unknown): string {
  if (typeof value !== "string" || !LANGUAGE_PATTERN.test(value)) throw new SessionLifecycleValidationError();
  return value;
}

function parseEssentialConsentStatus(value: unknown): EssentialConsentStatus {
  if (typeof value !== "string" || !ESSENTIAL_CONSENT_STATUSES.includes(value as EssentialConsentStatus)) {
    throw new SessionLifecycleConfigurationError();
  }
  return value as EssentialConsentStatus;
}

function lifecycleEvent(input: {
  readonly eventId: UuidV7;
  readonly eventType: string;
  readonly aggregateVersion: number;
  readonly tenantId: TenantId;
  readonly sessionId: SessionId;
  readonly trace: SessionCommandTrace;
  readonly causationId: UuidV7 | null;
  readonly occurredAt: string;
  readonly payload: Record<string, unknown>;
}): Record<string, unknown> {
  return Object.freeze({
    schema_version: CURRENT_SCHEMA_VERSION,
    event_id: input.eventId,
    event_type: input.eventType,
    event_version: 1,
    aggregate_type: "interaction_session",
    aggregate_id: input.sessionId,
    aggregate_version: input.aggregateVersion,
    tenant_id: input.tenantId,
    session_id: input.sessionId,
    producer: LIFECYCLE_PRODUCER,
    trace_id: input.trace.trace_id,
    correlation_id: input.trace.correlation_id,
    causation_id: input.causationId,
    data_classification: "internal",
    occurred_at: input.occurredAt,
    payload: input.payload,
  });
}

function channelFromCommand(type: InteractionSessionState["channel"]["type"]): InteractionSessionState["channel"] {
  return Object.freeze({ type, external_session_ref: null, region: "local-dev" });
}

function lifecycleCapabilities(): InteractionSessionState["capabilities"] {
  return Object.freeze({ audio: false, video: false, avatar: false, screen_share: false, tools: true, handoff: true });
}

function roleSeed(command: CreateSessionCommand, timestamp: string): Record<string, unknown> {
  return Object.freeze({
    role_pack_id: command.role_pack_id,
    role_pack_version: command.role_pack_version,
    objective: "Advance the installed role-pack objective using confirmed information.",
    stage: "opening",
    milestones: [],
    missing_fields: ["participant_goal"],
    next_best_action: Object.freeze({
      action_code: "deliver_disclosure",
      reason: "The virtual-agent disclosure is required before the session can activate.",
      confidence: 1,
      expires_at: timestamp,
    }),
  });
}

function disclosureRecord(input: {
  readonly disclosureId: UuidV7;
  readonly sessionId: SessionId;
  readonly tenantId: TenantId;
  readonly channel: InteractionSessionState["channel"]["type"];
  readonly language: string;
  readonly receipt: DisclosureDeliveryReceipt;
}): DisclosureRecord {
  const receipt = normalizeDisclosureDeliveryReceipt(
    input.receipt,
    input.channel,
    disclosureContentHashFor(input.language),
  );
  return immutableCopy({
    schema_version: CURRENT_SCHEMA_VERSION,
    disclosure_id: input.disclosureId,
    session_id: input.sessionId,
    tenant_id: input.tenantId,
    disclosure_type: "ai_identity",
    version: DISCLOSURE_VERSION,
    content_hash: receipt.content_hash,
    delivery_channel: receipt.delivery_channel,
    language: input.language,
    delivered_at: receipt.delivered_at,
    acknowledged: false,
    acknowledged_at: null,
  } satisfies DisclosureRecord);
}

function disclosureContentHashFor(language: string): string {
  return sha256Canonical({ disclosure_type: "ai_identity", version: DISCLOSURE_VERSION, language });
}

function deliveryChannelFor(channel: InteractionSessionState["channel"]["type"]): DisclosureRecord["delivery_channel"] {
  return channel === "api" || channel === "web_widget" ? "chat" : "spoken";
}

function consentEvidence(input: {
  readonly consentId: UuidV7;
  readonly sessionId: SessionId;
  readonly tenantId: TenantId;
  readonly status: Exclude<EssentialConsentStatus, "not_required">;
  readonly timestamp: string;
}): ConsentEvidence {
  return immutableCopy({
    schema_version: CURRENT_SCHEMA_VERSION,
    consent_id: input.consentId,
    session_id: input.sessionId,
    tenant_id: input.tenantId,
    subject_ref: "session-policy:essential-processing",
    consent_type: "essential_processing",
    purpose: "Essential processing needed to perform the interaction.",
    status: input.status,
    method: "system_import",
    disclosure_version: DISCLOSURE_VERSION,
    jurisdiction: "local-development",
    evidence_hash: sha256Canonical({ session_id: input.sessionId, status: input.status, version: DISCLOSURE_VERSION }),
    captured_at: input.timestamp,
    expires_at: null,
    revoked_at: input.status === "revoked" ? input.timestamp : null,
  } satisfies ConsentEvidence);
}

function assertActivationEvidence(
  state: InteractionSessionState,
  disclosure: DisclosureRecord | undefined,
  consent: ConsentEvidence | undefined,
  receipt: DisclosureDeliveryReceipt | undefined,
  clock: SessionLifecycleClock,
): void {
  if (
    disclosure === undefined
    || receipt === undefined
    || disclosure.disclosure_type !== "ai_identity"
    || disclosure.delivered_at.length === 0
    || receipt.content_hash !== disclosure.content_hash
    || receipt.delivery_channel !== disclosure.delivery_channel
    || receipt.delivered_at !== disclosure.delivered_at
    || !/^[0-9a-f]{64}$/.test(receipt.receipt_hash)
  ) {
    throw new SessionLifecycleConflictError();
  }
  if (state.disclosure_status !== "delivered" && state.disclosure_status !== "acknowledged") {
    throw new SessionLifecycleConflictError();
  }
  if (state.consent_status === "not_required") return;
  if (state.consent_status !== "granted" || consent === undefined || consent.status !== "granted" || consent.revoked_at !== null) {
    throw new SessionLifecycleConflictError();
  }
  if (consent.expires_at !== null && Date.parse(consent.expires_at) <= checkedNow(clock)) throw new SessionLifecycleConflictError();
}

function latestEventId(outbox: TransactionalOutboxRepository, request: AuthorizedRequestContext, sessionId: SessionId): UuidV7 {
  const record = outbox.listOutbox(request)
    .filter((candidate) => candidate.aggregate_id === sessionId)
    .sort((left, right) => right.aggregate_version - left.aggregate_version || right.event_id.localeCompare(left.event_id))[0];
  if (record === undefined) throw new SessionLifecycleNotFoundError();
  return parseUuidV7(record.event_id, "event_id");
}

function registrationKey(tenantId: TenantId, agentId: UuidV7, rolePackId: string, rolePackVersion: string): string {
  return `${tenantId}\u0000${agentId}\u0000${rolePackId}\u0000${rolePackVersion}`;
}

function tenantKey(tenantId: TenantId, value: string): string {
  return `${tenantId}\u0000${value}`;
}

function tenantSessionKey(tenantId: TenantId, sessionId: SessionId): string {
  return `${tenantId}\u0000${sessionId}`;
}

const systemClock: SessionLifecycleClock = Object.freeze({ now: () => Date.now() });

function assertClock(value: SessionLifecycleClock): void {
  if (value === null || typeof value !== "object" || typeof value.now !== "function") throw new SessionLifecycleConfigurationError();
  checkedNow(value);
}

function assertIdGenerator(value: SessionLifecycleIdGenerator): void {
  if (value === null || typeof value !== "object" || typeof value.nextId !== "function") throw new SessionLifecycleConfigurationError();
}

function checkedNow(clock: SessionLifecycleClock): number {
  let now: unknown;
  try {
    now = clock.now();
  } catch {
    throw new SessionLifecycleConfigurationError();
  }
  if (typeof now !== "number" || !Number.isSafeInteger(now) || now < 0 || now > 8_640_000_000_000_000) {
    throw new SessionLifecycleConfigurationError();
  }
  return now;
}

function nowIso(clock: SessionLifecycleClock): string {
  try {
    return new Date(checkedNow(clock)).toISOString();
  } catch {
    throw new SessionLifecycleConfigurationError();
  }
}

function nextId(generator: SessionLifecycleIdGenerator): UuidV7 {
  try {
    return parseUuidV7(generator.nextId(), "server_generated_id");
  } catch {
    throw new SessionLifecycleConfigurationError();
  }
}

function strictRecord<ErrorType extends Error>(
  value: unknown,
  allowedKeys: readonly string[],
  optionalKeys: boolean,
  ErrorConstructor: new () => ErrorType,
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new ErrorConstructor();
  let prototype: object | null;
  let descriptors: Record<string, PropertyDescriptor>;
  try {
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
    if (Object.getOwnPropertySymbols(value).length > 0) throw new Error();
  } catch {
    throw new ErrorConstructor();
  }
  if (prototype !== Object.prototype && prototype !== null) throw new ErrorConstructor();
  const keys = Object.keys(descriptors);
  if (keys.some((key) => !allowedKeys.includes(key))) throw new ErrorConstructor();
  for (const key of allowedKeys) {
    const descriptor = descriptors[key];
    if (descriptor === undefined) {
      if (optionalKeys) continue;
      throw new ErrorConstructor();
    }
    if (!("value" in descriptor)) throw new ErrorConstructor();
  }
  return Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]));
}

function readData<ErrorType extends Error>(record: Record<string, unknown>, key: string, ErrorConstructor: new () => ErrorType): unknown {
  if (!Object.prototype.hasOwnProperty.call(record, key)) throw new ErrorConstructor();
  return record[key];
}

function optionalData<ErrorType extends Error>(record: Record<string, unknown>, key: string, ErrorConstructor: new () => ErrorType): unknown | undefined {
  if (!Object.prototype.hasOwnProperty.call(record, key)) return undefined;
  const value = record[key];
  if (value === undefined) throw new ErrorConstructor();
  return value;
}

function immutableCopy<Value>(value: Value): Value {
  return deepFreeze(structuredClone(value));
}

function deepFreeze<Value>(value: Value): Value {
  if (value === null || typeof value !== "object") return value;
  for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  return Object.freeze(value);
}
