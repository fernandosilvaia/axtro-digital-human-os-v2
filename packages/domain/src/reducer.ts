import type {
  ConversationState,
  InteractionQualityState,
  InteractionSessionState,
  RoleState,
  SalesState,
} from "@axtro/contracts-ts";

import { canonicalJson, deepFreeze, sha256Canonical } from "./canonical.js";
import { type AnyInteractionEvent, parseInteractionEvent } from "./events.js";
import { parseSessionId, parseTenantId, parseUuidV7 } from "./ids.js";
import { parseSchemaVersion, type SchemaVersion } from "./schema.js";

export interface InteractionAggregateState {
  readonly schema_version: SchemaVersion;
  readonly session: InteractionSessionState;
  readonly conversation: ConversationState;
  readonly role: RoleState;
  readonly quality: InteractionQualityState;
  readonly extensions: Readonly<{
    readonly sales?: SalesState;
  }>;
}

export class AggregateVersionError extends Error {
  constructor(readonly expected: number, readonly received: number) {
    super(`Expected aggregate version ${expected}, received ${received}`);
    this.name = "AggregateVersionError";
  }
}

export class AggregateIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AggregateIdentityError";
  }
}

export class InteractionTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InteractionTransitionError";
  }
}

/**
 * Applies exactly one validated event. It does not read time, generate IDs,
 * perform I/O, call a provider, or invoke the Axtro Agent.
 */
export function reduceInteractionState(
  previous: InteractionAggregateState | undefined,
  eventInput: unknown,
): InteractionAggregateState {
  const event = parseInteractionEvent(eventInput);
  if (previous === undefined) return initialize(event);

  assertCurrentState(previous);
  assertEventMatchesState(previous, event);
  const state = cloneState(previous);

  switch (event.event_type) {
    case "session.created":
      throw new InteractionTransitionError("session.created can only initialize an aggregate");
    case "session.prepared":
      return advance(state, event, {
        status: transition(state.session.status, ["preparing"], "ready", event.event_type),
      });
    case "disclosure.delivered":
      assertNotTerminal(state, event.event_type);
      return advance(state, event, { disclosure_status: event.payload.status });
    case "consent.recorded":
      assertNotTerminal(state, event.event_type);
      return advance(state, event, { consent_status: event.payload.status });
    case "session.activated":
      return activate(state, event);
    case "presenter.changed":
      return changePresenter(state, event);
    case "session.degraded":
      assertNotTerminal(state, event.event_type);
      return advance(state, event, { degradation_level: event.payload.level });
    case "session.completed":
      return advance(state, event, {
        status: transition(state.session.status, ["ready", "active", "handoff_pending"], "completed", event.event_type),
        active_presenter_id: null,
      });
    case "session.failed":
      assertNotTerminal(state, event.event_type);
      return advance(state, event, { status: "failed", active_presenter_id: null, degradation_level: "terminated" });
    case "turn.committed":
      return commitTurn(state, event);
    case "turn.interrupted":
      return interruptTurn(state, event);
    case "role.updated":
      assertNotTerminal(state, event.event_type);
      return advance(state, event, { role: roleFromPayload(state, event) });
    case "quality.updated":
      assertNotTerminal(state, event.event_type);
      return advance(state, event, { quality: qualityFromPayload(state, event) });
    case "sales.installed":
      return installSales(state, event);
    case "sales.updated":
      return updateSales(state, event);
    case "sales.uninstalled":
      return uninstallSales(state, event);
  }
}

/** Replay is deterministic because every state-changing input is carried by the event sequence. */
export function replayInteraction(events: readonly unknown[]): InteractionAggregateState {
  let state: InteractionAggregateState | undefined;
  for (const event of events) state = reduceInteractionState(state, event);
  if (state === undefined) throw new InteractionTransitionError("cannot replay an empty event sequence");
  return state;
}

export function interactionStateHash(state: InteractionAggregateState): string {
  assertCurrentState(state);
  return sha256Canonical(state);
}

function initialize(event: AnyInteractionEvent): InteractionAggregateState {
  if (event.event_type !== "session.created") {
    throw new InteractionTransitionError("the first event for an interaction aggregate must be session.created");
  }
  if (event.aggregate_version !== 1) throw new AggregateVersionError(1, event.aggregate_version);

  const { payload } = event;
  const session: InteractionSessionState = {
    schema_version: event.schema_version,
    session_id: event.session_id,
    tenant_id: event.tenant_id,
    agent_id: payload.agent_id,
    status: "preparing",
    active_presenter_id: null,
    channel: { ...payload.channel },
    state_version: event.aggregate_version,
    consent_status: "pending",
    disclosure_status: "pending",
    capabilities: { ...payload.capabilities },
    degradation_level: "none",
    started_at: null,
    updated_at: event.occurred_at,
  };
  const conversation: ConversationState = {
    schema_version: event.schema_version,
    session_id: event.session_id,
    tenant_id: event.tenant_id,
    turn_index: 0,
    active_topic: null,
    language: payload.language,
    open_questions: [],
    confirmed_facts: [],
    repair_state: "none",
    incremental_summary: "",
    updated_at: event.occurred_at,
  };
  const role: RoleState = {
    schema_version: event.schema_version,
    session_id: event.session_id,
    tenant_id: event.tenant_id,
    ...payload.role,
    milestones: payload.role.milestones.map((milestone) => ({ ...milestone, evidence_refs: [...milestone.evidence_refs] })),
    missing_fields: [...payload.role.missing_fields],
    next_best_action: { ...payload.role.next_best_action },
    updated_at: event.occurred_at,
  };
  const quality: InteractionQualityState = {
    schema_version: event.schema_version,
    session_id: event.session_id,
    tenant_id: event.tenant_id,
    dimensions: [
      {
        name: "system_confidence",
        value: 1,
        confidence: 1,
        evidence_refs: [],
        rationale: "Session initialized",
        updated_at: event.occurred_at,
        expires_at: null,
      },
    ],
    aggregate_confidence: 1,
    updated_at: event.occurred_at,
  };
  return freezeState({
    schema_version: event.schema_version,
    session,
    conversation,
    role,
    quality,
    extensions: {},
  });
}

function activate(state: InteractionAggregateState, event: Extract<AnyInteractionEvent, { event_type: "session.activated" }>): InteractionAggregateState {
  if (state.session.status !== "ready") {
    throw new InteractionTransitionError("session.activated requires a ready session");
  }
  if (state.session.disclosure_status !== "delivered" && state.session.disclosure_status !== "acknowledged") {
    throw new InteractionTransitionError("session.activated requires delivered disclosure");
  }
  if (state.session.consent_status !== "not_required" && state.session.consent_status !== "granted") {
    throw new InteractionTransitionError("session.activated requires allowed consent");
  }
  return advance(state, event, {
    status: "active",
    active_presenter_id: event.payload.presenter_id,
    started_at: state.session.started_at ?? event.occurred_at,
  });
}

function changePresenter(state: InteractionAggregateState, event: Extract<AnyInteractionEvent, { event_type: "presenter.changed" }>): InteractionAggregateState {
  if (state.session.status !== "active" && state.session.status !== "handoff_pending") {
    throw new InteractionTransitionError("presenter.changed requires an active or handoff-pending session");
  }
  if (state.session.active_presenter_id !== event.payload.expected_presenter_id) {
    throw new InteractionTransitionError("presenter.changed expected presenter does not own the floor");
  }
  return advance(state, event, { active_presenter_id: event.payload.presenter_id, status: "active" });
}

function commitTurn(state: InteractionAggregateState, event: Extract<AnyInteractionEvent, { event_type: "turn.committed" }>): InteractionAggregateState {
  if (state.session.status !== "active" || state.session.active_presenter_id === null) {
    throw new InteractionTransitionError("turn.committed requires one active presenter");
  }
  const expectedTurn = state.conversation.turn_index + 1;
  if (event.payload.turn_index !== expectedTurn) {
    throw new InteractionTransitionError(`turn.committed expected turn index ${expectedTurn}`);
  }
  if (event.payload.speaker_role === "presenter"
    && event.payload.speaker_participant_id !== state.session.active_presenter_id) {
    throw new InteractionTransitionError("turn.committed presenter does not own the active floor");
  }
  if (event.payload.speaker_role === "participant"
    && event.payload.speaker_participant_id === state.session.active_presenter_id) {
    throw new InteractionTransitionError("turn.committed participant cannot claim the presenter identity");
  }
  const {
    schema_version: _payloadSchemaVersion,
    speaker_participant_id: _speakerParticipantId,
    speaker_role: _speakerRole,
    transcript_text: _transcriptText,
    generation_id: _generationId,
    ...conversationPayload
  } = event.payload;
  return advance(state, event, {
    conversation: {
      schema_version: event.schema_version,
      session_id: state.session.session_id,
      tenant_id: state.session.tenant_id,
      ...conversationPayload,
      open_questions: [...conversationPayload.open_questions],
      confirmed_facts: conversationPayload.confirmed_facts.map((fact) => ({ ...fact })),
      updated_at: event.occurred_at,
    },
  });
}

function interruptTurn(state: InteractionAggregateState, event: Extract<AnyInteractionEvent, { event_type: "turn.interrupted" }>): InteractionAggregateState {
  if (state.session.status !== "active" || state.session.active_presenter_id === null) {
    throw new InteractionTransitionError("turn.interrupted requires one active presenter");
  }
  return advance(state, event, {
    conversation: {
      ...state.conversation,
      repair_state: "recovering_interruption",
      updated_at: event.occurred_at,
    },
  });
}

function roleFromPayload(
  state: InteractionAggregateState,
  event: Extract<AnyInteractionEvent, { event_type: "role.updated" }>,
): RoleState {
  return {
    schema_version: event.schema_version,
    session_id: state.session.session_id,
    tenant_id: state.session.tenant_id,
    ...event.payload,
    milestones: event.payload.milestones.map((milestone) => ({ ...milestone, evidence_refs: [...milestone.evidence_refs] })),
    missing_fields: [...event.payload.missing_fields],
    next_best_action: { ...event.payload.next_best_action },
    updated_at: event.occurred_at,
  };
}

function qualityFromPayload(
  state: InteractionAggregateState,
  event: Extract<AnyInteractionEvent, { event_type: "quality.updated" }>,
): InteractionQualityState {
  return {
    schema_version: event.schema_version,
    session_id: state.session.session_id,
    tenant_id: state.session.tenant_id,
    dimensions: event.payload.dimensions.map((dimension) => ({
      ...dimension,
      evidence_refs: [...dimension.evidence_refs],
      updated_at: event.occurred_at,
    })),
    aggregate_confidence: event.payload.aggregate_confidence,
    updated_at: event.occurred_at,
  };
}

function installSales(state: InteractionAggregateState, event: Extract<AnyInteractionEvent, { event_type: "sales.installed" }>): InteractionAggregateState {
  if (state.extensions.sales !== undefined) throw new InteractionTransitionError("sales state is already installed");
  return advance(state, event, { extensions: { sales: salesFromPayload(state, event) } });
}

function updateSales(state: InteractionAggregateState, event: Extract<AnyInteractionEvent, { event_type: "sales.updated" }>): InteractionAggregateState {
  if (state.extensions.sales === undefined) {
    throw new InteractionTransitionError("sales.updated requires an installed sales extension");
  }
  return advance(state, event, { extensions: { sales: salesFromPayload(state, event) } });
}

function uninstallSales(state: InteractionAggregateState, event: Extract<AnyInteractionEvent, { event_type: "sales.uninstalled" }>): InteractionAggregateState {
  if (state.extensions.sales === undefined) {
    throw new InteractionTransitionError("sales.uninstalled requires an installed sales extension");
  }
  return advance(state, event, { extensions: {} });
}

function salesFromPayload(
  state: InteractionAggregateState,
  event: Extract<AnyInteractionEvent, { event_type: "sales.installed" | "sales.updated" }>,
): SalesState {
  const { state: payload } = event.payload;
  return {
    schema_version: event.schema_version,
    session_id: state.session.session_id,
    tenant_id: state.session.tenant_id,
    ...payload,
    qualification: payload.qualification.map((dimension) => ({ ...dimension, evidence_refs: [...dimension.evidence_refs] })),
    objections: payload.objections.map((objection) => ({ ...objection, evidence_refs: [...objection.evidence_refs] })),
    updated_at: event.occurred_at,
  };
}

function advance(
  state: InteractionAggregateState,
  event: Exclude<AnyInteractionEvent, Extract<AnyInteractionEvent, { event_type: "session.created" }>>,
  changes: {
    status?: InteractionSessionState["status"];
    active_presenter_id?: string | null;
    degradation_level?: InteractionSessionState["degradation_level"];
    consent_status?: InteractionSessionState["consent_status"];
    disclosure_status?: InteractionSessionState["disclosure_status"];
    started_at?: string | null;
    conversation?: ConversationState;
    role?: RoleState;
    quality?: InteractionQualityState;
    extensions?: InteractionAggregateState["extensions"];
  },
): InteractionAggregateState {
  const { conversation, role, quality, extensions, ...sessionChanges } = changes;
  return freezeState({
    ...state,
    session: {
      ...state.session,
      ...sessionChanges,
      state_version: event.aggregate_version,
      updated_at: event.occurred_at,
    },
    conversation: conversation ?? state.conversation,
    role: role ?? state.role,
    quality: quality ?? state.quality,
    extensions: extensions ?? state.extensions,
  });
}

function assertCurrentState(state: InteractionAggregateState): void {
  exactStateRecord(state, "state", ["schema_version", "session", "conversation", "role", "quality", "extensions"]);
  exactStateRecord(state.session, "state.session", [
    "schema_version",
    "session_id",
    "tenant_id",
    "agent_id",
    "status",
    "active_presenter_id",
    "channel",
    "state_version",
    "consent_status",
    "disclosure_status",
    "capabilities",
    "degradation_level",
    "started_at",
    "updated_at",
  ]);
  exactStateRecord(state.conversation, "state.conversation", [
    "schema_version",
    "session_id",
    "tenant_id",
    "turn_index",
    "active_topic",
    "language",
    "open_questions",
    "confirmed_facts",
    "repair_state",
    "incremental_summary",
    "updated_at",
  ]);
  exactStateRecord(state.role, "state.role", [
    "schema_version",
    "session_id",
    "tenant_id",
    "role_pack_id",
    "role_pack_version",
    "objective",
    "stage",
    "milestones",
    "missing_fields",
    "next_best_action",
    "updated_at",
  ]);
  exactStateRecord(state.quality, "state.quality", [
    "schema_version",
    "session_id",
    "tenant_id",
    "dimensions",
    "aggregate_confidence",
    "updated_at",
  ]);
  exactStateRecord(state.extensions, "state.extensions", ["sales"], true);
  const schemaVersion = parseSchemaVersion(stateString(state.schema_version, "state.schema_version"));
  parseSchemaVersion(stateString(state.session.schema_version, "state.session.schema_version"));
  parseSchemaVersion(stateString(state.conversation.schema_version, "state.conversation.schema_version"));
  parseSchemaVersion(stateString(state.role.schema_version, "state.role.schema_version"));
  parseSchemaVersion(stateString(state.quality.schema_version, "state.quality.schema_version"));
  parseSessionId(state.session.session_id);
  parseTenantId(state.session.tenant_id);
  parseUuidV7(state.session.agent_id, "state.session.agent_id");
  const stateVersion = stateInteger(state.session.state_version, "state.session.state_version", 1);
  stateTimestamp(state.session.updated_at, "state.session.updated_at");
  if (state.session.started_at !== null) stateTimestamp(state.session.started_at, "state.session.started_at");
  if (state.session.active_presenter_id !== null) parseUuidV7(state.session.active_presenter_id, "state.session.active_presenter_id");
  assertEnum(state.session.status, ["preparing", "ready", "active", "handoff_pending", "completed", "failed"] as const, "state.session.status");
  assertEnum(state.session.consent_status, ["not_required", "pending", "granted", "denied", "revoked"] as const, "state.session.consent_status");
  assertEnum(state.session.disclosure_status, ["pending", "delivered", "acknowledged", "failed"] as const, "state.session.disclosure_status");
  assertEnum(state.session.degradation_level, ["none", "minor", "major", "voice_only", "text_only", "terminated"] as const, "state.session.degradation_level");
  stateInteger(state.conversation.turn_index, "state.conversation.turn_index", 0);
  stateTimestamp(state.conversation.updated_at, "state.conversation.updated_at");
  stateTimestamp(state.role.updated_at, "state.role.updated_at");
  stateTimestamp(state.quality.updated_at, "state.quality.updated_at");

  if (state.conversation.session_id !== state.session.session_id || state.role.session_id !== state.session.session_id) {
    throw new AggregateIdentityError("substates must match the session identifier");
  }
  if (state.conversation.tenant_id !== state.session.tenant_id || state.role.tenant_id !== state.session.tenant_id) {
    throw new AggregateIdentityError("substates must match the tenant identifier");
  }
  if (state.quality.session_id !== state.session.session_id || state.quality.tenant_id !== state.session.tenant_id) {
    throw new AggregateIdentityError("quality state must match the interaction aggregate");
  }
  parseSessionId(state.conversation.session_id);
  parseTenantId(state.conversation.tenant_id);
  parseSessionId(state.role.session_id);
  parseTenantId(state.role.tenant_id);
  parseSessionId(state.quality.session_id);
  parseTenantId(state.quality.tenant_id);
  if (state.session.status === "active" || state.session.status === "handoff_pending") {
    if (state.session.active_presenter_id === null) {
      throw new InteractionTransitionError("an active session must have exactly one active presenter");
    }
    if (state.session.disclosure_status !== "delivered" && state.session.disclosure_status !== "acknowledged") {
      throw new InteractionTransitionError("an active session requires delivered disclosure evidence");
    }
    if (state.session.consent_status !== "not_required" && state.session.consent_status !== "granted") {
      throw new InteractionTransitionError("an active session requires an allowed consent outcome");
    }
    if (state.session.started_at === null) throw new InteractionTransitionError("an active session must have a start timestamp");
  } else if (state.session.active_presenter_id !== null) {
    throw new InteractionTransitionError("only active or handoff-pending sessions may own the presenter floor");
  }
  if (stateVersion < 1) throw new AggregateVersionError(1, stateVersion);

  const sales = state.extensions.sales;
  if (sales !== undefined) {
    exactStateRecord(sales, "state.extensions.sales", [
      "schema_version",
      "session_id",
      "tenant_id",
      "funnel_stage",
      "methodology",
      "qualification",
      "objections",
      "proposal_status",
      "conversion_probability",
      "next_step",
      "updated_at",
    ]);
    parseSchemaVersion(stateString(sales.schema_version, "state.extensions.sales.schema_version"));
    parseSessionId(sales.session_id);
    parseTenantId(sales.tenant_id);
    stateTimestamp(sales.updated_at, "state.extensions.sales.updated_at");
    if (sales.session_id !== state.session.session_id || sales.tenant_id !== state.session.tenant_id) {
      throw new AggregateIdentityError("sales state must match the interaction aggregate");
    }
  }
  validateSnapshotPayloads(state, schemaVersion);
  canonicalJson(state);
}

function validateSnapshotPayloads(state: InteractionAggregateState, schemaVersion: SchemaVersion): void {
  const envelope = (eventType: string, payload: unknown) => ({
    schema_version: schemaVersion,
    event_id: state.session.session_id,
    event_type: eventType,
    event_version: 1,
    aggregate_type: "interaction_session",
    aggregate_id: state.session.session_id,
    aggregate_version: 1,
    tenant_id: state.session.tenant_id,
    session_id: state.session.session_id,
    producer: "snapshot-validator",
    trace_id: "0123456789abcdef0123456789abcdef",
    correlation_id: state.session.session_id,
    causation_id: null,
    data_classification: eventType === "turn.committed" ? "restricted" : "internal",
    occurred_at: state.session.updated_at,
    payload,
  });
  const rolePayload = {
    role_pack_id: state.role.role_pack_id,
    role_pack_version: state.role.role_pack_version,
    objective: state.role.objective,
    stage: state.role.stage,
    milestones: state.role.milestones,
    missing_fields: state.role.missing_fields,
    next_best_action: state.role.next_best_action,
  };
  parseInteractionEvent(envelope("session.created", {
    agent_id: state.session.agent_id,
    channel: state.session.channel,
    consent_status: "pending",
    disclosure_status: "pending",
    capabilities: state.session.capabilities,
    role: rolePayload,
    language: state.conversation.language,
  }));
  parseInteractionEvent(envelope("role.updated", rolePayload));
  parseInteractionEvent(envelope("turn.committed", {
    schema_version: state.schema_version,
    speaker_participant_id: state.session.active_presenter_id ?? state.session.agent_id,
    speaker_role: "presenter",
    transcript_text: "Snapshot validation turn.",
    generation_id: 1,
    turn_index: Math.max(1, state.conversation.turn_index),
    active_topic: state.conversation.active_topic,
    language: state.conversation.language,
    open_questions: state.conversation.open_questions,
    confirmed_facts: state.conversation.confirmed_facts,
    repair_state: state.conversation.repair_state,
    incremental_summary: state.conversation.incremental_summary,
  }));
  const dimensions = stateArray(state.quality.dimensions, "state.quality.dimensions").map((value, index) => {
    const dimension = exactStateRecord(value, `state.quality.dimensions[${index}]`, [
      "name",
      "value",
      "confidence",
      "evidence_refs",
      "rationale",
      "updated_at",
      "expires_at",
    ]);
    stateTimestamp(dimension.updated_at, `state.quality.dimensions[${index}].updated_at`);
    return {
      name: dimension.name,
      value: dimension.value,
      confidence: dimension.confidence,
      evidence_refs: dimension.evidence_refs,
      rationale: dimension.rationale,
      expires_at: dimension.expires_at,
    };
  });
  parseInteractionEvent(envelope("quality.updated", {
    dimensions,
    aggregate_confidence: state.quality.aggregate_confidence,
  }));
  if (state.extensions.sales !== undefined) {
    const sales = state.extensions.sales;
    parseInteractionEvent(envelope("sales.installed", {
      state: {
        funnel_stage: sales.funnel_stage,
        methodology: sales.methodology,
        qualification: sales.qualification,
        objections: sales.objections,
        proposal_status: sales.proposal_status,
        conversion_probability: sales.conversion_probability,
        next_step: sales.next_step,
      },
    }));
  }
}

function exactStateRecord(value: unknown, label: string, keys: readonly string[], optionalKeys = false): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new InteractionTransitionError(`${label} must be a plain object`);
  }
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  const valid = optionalKeys
    ? actual.every((key) => expected.includes(key))
    : actual.length === expected.length && actual.every((key, index) => key === expected[index]);
  if (!valid) throw new InteractionTransitionError(`${label} contains missing or unknown fields`);
  return record;
}

function stateString(value: unknown, label: string): string {
  if (typeof value !== "string") throw new InteractionTransitionError(`${label} must be a string`);
  return value;
}

function stateInteger(value: unknown, label: string, minimum: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) {
    throw new InteractionTransitionError(`${label} must be an integer of at least ${minimum}`);
  }
  return value;
}

function stateTimestamp(value: unknown, label: string): string {
  const timestamp = stateString(value, label);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(timestamp) || Number.isNaN(Date.parse(timestamp))) {
    throw new InteractionTransitionError(`${label} must be an RFC3339 timestamp`);
  }
  return timestamp;
}

function assertEnum<T extends readonly string[]>(value: unknown, allowed: T, label: string): asserts value is T[number] {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new InteractionTransitionError(`${label} is not an allowed value`);
  }
}

function stateArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new InteractionTransitionError(`${label} must be an array`);
  return value;
}

function assertEventMatchesState(state: InteractionAggregateState, event: AnyInteractionEvent): void {
  const expectedVersion = state.session.state_version + 1;
  if (event.aggregate_version !== expectedVersion) {
    throw new AggregateVersionError(expectedVersion, event.aggregate_version);
  }
  if (event.aggregate_id !== state.session.session_id || event.session_id !== state.session.session_id) {
    throw new AggregateIdentityError("event session identifier does not match the aggregate");
  }
  if (event.tenant_id !== state.session.tenant_id) {
    throw new AggregateIdentityError("event tenant identifier does not match the aggregate");
  }
}

function assertNotTerminal(state: InteractionAggregateState, eventType: string): void {
  if (state.session.status === "completed" || state.session.status === "failed") {
    throw new InteractionTransitionError(`${eventType} cannot alter a terminal session`);
  }
}

function transition<T extends InteractionSessionState["status"]>(
  actual: InteractionSessionState["status"],
  allowed: readonly InteractionSessionState["status"][],
  next: T,
  eventType: string,
): T {
  if (!allowed.includes(actual)) {
    throw new InteractionTransitionError(`${eventType} is invalid while session status is ${actual}`);
  }
  return next;
}

function cloneState(state: InteractionAggregateState): InteractionAggregateState {
  return JSON.parse(canonicalJson(state)) as InteractionAggregateState;
}

function freezeState(state: InteractionAggregateState): InteractionAggregateState {
  return deepFreeze(state);
}
