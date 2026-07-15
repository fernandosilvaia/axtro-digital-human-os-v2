import type {
  ConversationState,
  EventEnvelope,
  InteractionQualityState,
  InteractionSessionState,
  RoleState,
  SalesState,
} from "@axtro/contracts-ts";

import { parseCorrelationId, parseSessionId, parseTenantId, parseUuidV7 } from "./ids.js";
import {
  parseDataClassification,
  parseSchemaVersion,
  type SchemaVersion,
} from "./schema.js";

export const INTERACTION_EVENT_TYPES = [
  "session.created",
  "session.prepared",
  "disclosure.delivered",
  "consent.recorded",
  "session.activated",
  "presenter.changed",
  "session.degraded",
  "session.completed",
  "session.failed",
  "turn.committed",
  "turn.interrupted",
  "role.updated",
  "quality.updated",
  "sales.installed",
  "sales.updated",
  "sales.uninstalled",
] as const;

export type InteractionEventType = (typeof INTERACTION_EVENT_TYPES)[number];

type RoleSeed = Omit<RoleState, "schema_version" | "session_id" | "tenant_id" | "updated_at">;
type ConversationCommit = Omit<ConversationState, "schema_version" | "session_id" | "tenant_id" | "updated_at">;
export interface TurnCommittedPayload extends ConversationCommit {
  readonly schema_version: SchemaVersion;
  readonly speaker_participant_id: string;
  readonly speaker_role: "participant" | "presenter";
  readonly transcript_text: string;
  readonly generation_id: number | null;
}
type QualityDimensionUpdate = Omit<InteractionQualityState["dimensions"][number], "updated_at">;
interface QualityUpdate {
  dimensions: QualityDimensionUpdate[];
  aggregate_confidence: number;
}
type SalesUpdate = Omit<SalesState, "schema_version" | "session_id" | "tenant_id" | "updated_at">;

export interface SessionCreatedPayload {
  agent_id: string;
  channel: InteractionSessionState["channel"];
  consent_status: "pending";
  disclosure_status: "pending";
  capabilities: InteractionSessionState["capabilities"];
  role: RoleSeed;
  language: string;
}

export interface InteractionEventPayloads {
  "session.created": SessionCreatedPayload;
  "session.prepared": Record<string, never>;
  "disclosure.delivered": { status: "delivered" | "acknowledged" };
  "consent.recorded": { status: InteractionSessionState["consent_status"] };
  "session.activated": { presenter_id: string };
  "presenter.changed": { expected_presenter_id: string | null; presenter_id: string };
  "session.degraded": { level: Exclude<InteractionSessionState["degradation_level"], "none" | "terminated"> };
  "session.completed": Record<string, never>;
  "session.failed": Record<string, never>;
  "turn.committed": TurnCommittedPayload;
  "turn.interrupted": Record<string, never>;
  "role.updated": RoleSeed;
  "quality.updated": QualityUpdate;
  "sales.installed": { state: SalesUpdate };
  "sales.updated": { state: SalesUpdate };
  "sales.uninstalled": Record<string, never>;
}

type InteractionEventBase = Omit<
  EventEnvelope,
  "schema_version" | "event_type" | "event_version" | "aggregate_type" | "session_id" | "payload_json"
> & {
  schema_version: SchemaVersion;
  event_version: 1;
  aggregate_type: "interaction_session";
  session_id: string;
};

export type InteractionEvent<T extends InteractionEventType> = InteractionEventBase & {
  event_type: T;
  payload: InteractionEventPayloads[T];
};

export type AnyInteractionEvent = {
  [T in InteractionEventType]: InteractionEvent<T>;
}[InteractionEventType];

export class DomainEventValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainEventValidationError";
  }
}

const EVENT_KEYS = [
  "schema_version",
  "event_id",
  "event_type",
  "event_version",
  "aggregate_type",
  "aggregate_id",
  "aggregate_version",
  "tenant_id",
  "session_id",
  "producer",
  "trace_id",
  "correlation_id",
  "causation_id",
  "data_classification",
  "occurred_at",
  "payload",
] as const;

const CHANNEL_TYPES = ["native_room", "telephone", "google_meet", "zoom", "teams", "web_widget", "api"] as const;
const CONSENT_STATUSES = ["not_required", "pending", "granted", "denied", "revoked"] as const;
const DISCLOSURE_STATUSES = ["pending", "delivered", "acknowledged", "failed"] as const;
const DEGRADATION_LEVELS = ["minor", "major", "voice_only", "text_only"] as const;
const MILESTONE_STATUSES = ["not_started", "in_progress", "completed", "blocked", "skipped"] as const;
const REPAIR_STATES = [
  "none",
  "clarifying",
  "recovering_interruption",
  "recovering_tool_failure",
  "recovering_connection",
] as const;
const TURN_SPEAKER_ROLES = ["participant", "presenter"] as const;
const EVIDENCE_KINDS = [
  "explicit_user_statement",
  "tool_verified",
  "knowledge_source",
  "derived_hypothesis",
  "operator_input",
  "system_observation",
] as const;
const QUALITY_DIMENSIONS = [
  "clarity",
  "explicit_interest",
  "engagement",
  "resistance",
  "urgency",
  "next_step_readiness",
  "relationship_continuity",
  "system_confidence",
] as const;
const FUNNEL_STAGES = [
  "opening",
  "discovery",
  "qualification",
  "solution_fit",
  "demonstration",
  "objection_handling",
  "proposal",
  "commitment",
  "follow_up",
  "closed_won",
  "closed_lost",
] as const;
const QUALIFICATION_DIMENSIONS = ["budget", "authority", "need", "timing", "impact", "decision_process"] as const;
const QUALIFICATION_STATUSES = ["unknown", "partial", "confirmed", "not_applicable"] as const;
const OBJECTION_STATUSES = ["open", "exploring", "addressed", "unresolved"] as const;
const PROPOSAL_STATUSES = ["not_started", "drafting", "presented", "revising", "accepted", "rejected", "expired"] as const;
const RFC3339_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const TRACE_ID_PATTERN = /^[0-9a-f]{16,64}$/;

/** Strictly normalizes a decoded internal event before it can reach a reducer. */
export function parseInteractionEvent(value: unknown): AnyInteractionEvent {
  const event = exactRecord(value, "event", EVENT_KEYS);
  const eventType = enumValue(event.event_type, INTERACTION_EVENT_TYPES, "event.event_type");
  const schemaVersion = parseSchemaVersion(stringValue(event.schema_version, "event.schema_version", 1, 20));
  const eventId = parseUuidV7(event.event_id, "event.event_id");
  const aggregateId = parseSessionId(event.aggregate_id);
  const tenantId = parseTenantId(event.tenant_id);
  const sessionId = parseSessionId(event.session_id);
  const correlationId = parseCorrelationId(event.correlation_id);
  const causationId = event.causation_id === null ? null : parseCorrelationId(event.causation_id);
  const traceId = traceIdValue(event.trace_id, "event.trace_id");
  const occurredAt = timestampValue(event.occurred_at, "event.occurred_at");
  const eventVersion = integerValue(event.event_version, "event.event_version", 1);
  const aggregateVersion = integerValue(event.aggregate_version, "event.aggregate_version", 1);

  if (eventVersion !== 1) throw new DomainEventValidationError("event.event_version must be 1");
  if (event.aggregate_type !== "interaction_session") {
    throw new DomainEventValidationError("event.aggregate_type must be interaction_session");
  }
  if (aggregateId !== sessionId) throw new DomainEventValidationError("event.aggregate_id must equal event.session_id");

  const producer = stringValue(event.producer, "event.producer", 1, 200);
  const dataClassification = parseDataClassification(stringValue(event.data_classification, "event.data_classification", 1, 20));
  const parsedPayload = parsePayload(eventType, event.payload, schemaVersion);
  if (eventType === "turn.committed" && dataClassification !== "restricted") {
    throw new DomainEventValidationError("turn.committed must use restricted data classification");
  }

  return {
    schema_version: schemaVersion,
    event_id: eventId,
    event_type: eventType,
    event_version: 1,
    aggregate_type: "interaction_session",
    aggregate_id: aggregateId,
    aggregate_version: aggregateVersion,
    tenant_id: tenantId,
    session_id: sessionId,
    producer,
    trace_id: traceId,
    correlation_id: correlationId,
    causation_id: causationId,
    data_classification: dataClassification,
    occurred_at: occurredAt,
    payload: parsedPayload,
  } as AnyInteractionEvent;
}

function parsePayload<T extends InteractionEventType>(
  eventType: T,
  value: unknown,
  schemaVersion: SchemaVersion,
): InteractionEventPayloads[T] {
  switch (eventType) {
    case "session.created":
      return parseSessionCreated(value) as InteractionEventPayloads[T];
    case "session.prepared":
    case "session.completed":
    case "session.failed":
    case "turn.interrupted":
    case "sales.uninstalled":
      return emptyPayload(value, `payload for ${eventType}`) as InteractionEventPayloads[T];
    case "disclosure.delivered": {
      const payload = exactRecord(value, "payload for disclosure.delivered", ["status"]);
      return { status: enumValue(payload.status, ["delivered", "acknowledged"] as const, "payload.status") } as InteractionEventPayloads[T];
    }
    case "consent.recorded": {
      const payload = exactRecord(value, "payload for consent.recorded", ["status"]);
      return { status: enumValue(payload.status, CONSENT_STATUSES, "payload.status") } as InteractionEventPayloads[T];
    }
    case "session.activated": {
      const payload = exactRecord(value, "payload for session.activated", ["presenter_id"]);
      return { presenter_id: parseUuidV7(payload.presenter_id, "payload.presenter_id") } as unknown as InteractionEventPayloads[T];
    }
    case "presenter.changed": {
      const payload = exactRecord(value, "payload for presenter.changed", ["expected_presenter_id", "presenter_id"]);
      return {
        expected_presenter_id:
          payload.expected_presenter_id === null ? null : parseUuidV7(payload.expected_presenter_id, "payload.expected_presenter_id"),
        presenter_id: parseUuidV7(payload.presenter_id, "payload.presenter_id"),
      } as unknown as InteractionEventPayloads[T];
    }
    case "session.degraded": {
      const payload = exactRecord(value, "payload for session.degraded", ["level"]);
      return { level: enumValue(payload.level, DEGRADATION_LEVELS, "payload.level") } as InteractionEventPayloads[T];
    }
    case "turn.committed":
      return parseConversationCommit(value, schemaVersion) as InteractionEventPayloads[T];
    case "role.updated":
      return parseRoleSeed(value) as InteractionEventPayloads[T];
    case "quality.updated":
      return parseQualityUpdate(value) as InteractionEventPayloads[T];
    case "sales.installed":
    case "sales.updated": {
      const payload = exactRecord(value, `payload for ${eventType}`, ["state"]);
      return { state: parseSalesUpdate(payload.state) } as InteractionEventPayloads[T];
    }
  }
}

function parseSessionCreated(value: unknown): SessionCreatedPayload {
  const payload = exactRecord(value, "payload for session.created", [
    "agent_id",
    "channel",
    "consent_status",
    "disclosure_status",
    "capabilities",
    "role",
    "language",
  ]);
  const consentStatus = enumValue(payload.consent_status, CONSENT_STATUSES, "payload.consent_status");
  const disclosureStatus = enumValue(payload.disclosure_status, DISCLOSURE_STATUSES, "payload.disclosure_status");
  if (consentStatus !== "pending" || disclosureStatus !== "pending") {
    throw new DomainEventValidationError("session.created must begin with pending consent and disclosure");
  }
  return {
    agent_id: parseUuidV7(payload.agent_id, "payload.agent_id"),
    channel: parseChannel(payload.channel),
    consent_status: "pending",
    disclosure_status: "pending",
    capabilities: parseCapabilities(payload.capabilities),
    role: parseRoleSeed(payload.role),
    language: languageValue(payload.language, "payload.language"),
  };
}

function parseChannel(value: unknown): InteractionSessionState["channel"] {
  const channel = exactRecord(value, "payload.channel", ["type", "external_session_ref", "region"]);
  return {
    type: enumValue(channel.type, CHANNEL_TYPES, "payload.channel.type"),
    external_session_ref:
      channel.external_session_ref === null
        ? null
        : stringValue(channel.external_session_ref, "payload.channel.external_session_ref", 0, 500),
    region: stringValue(channel.region, "payload.channel.region", 2, 80),
  };
}

function parseCapabilities(value: unknown): InteractionSessionState["capabilities"] {
  const capabilities = exactRecord(value, "payload.capabilities", ["audio", "video", "avatar", "screen_share", "tools", "handoff"]);
  return {
    audio: booleanValue(capabilities.audio, "payload.capabilities.audio"),
    video: booleanValue(capabilities.video, "payload.capabilities.video"),
    avatar: booleanValue(capabilities.avatar, "payload.capabilities.avatar"),
    screen_share: booleanValue(capabilities.screen_share, "payload.capabilities.screen_share"),
    tools: booleanValue(capabilities.tools, "payload.capabilities.tools"),
    handoff: booleanValue(capabilities.handoff, "payload.capabilities.handoff"),
  };
}

function parseRoleSeed(value: unknown): RoleSeed {
  const payload = exactRecord(value, "role state", [
    "role_pack_id",
    "role_pack_version",
    "objective",
    "stage",
    "milestones",
    "missing_fields",
    "next_best_action",
  ]);
  const milestones = arrayValue(payload.milestones, "role.milestones", 100).map((item, index) => {
    const milestone = exactRecord(item, `role.milestones[${index}]`, ["code", "status", "evidence_refs"]);
    return {
      code: stringValue(milestone.code, `role.milestones[${index}].code`, 1, 100),
      status: enumValue(milestone.status, MILESTONE_STATUSES, `role.milestones[${index}].status`),
      evidence_refs: uuidArray(milestone.evidence_refs, `role.milestones[${index}].evidence_refs`, 20),
    };
  });
  const action = exactRecord(payload.next_best_action, "role.next_best_action", ["action_code", "reason", "confidence", "expires_at"]);
  return {
    role_pack_id: stringValue(payload.role_pack_id, "role.role_pack_id", 1, 200),
    role_pack_version: stringValue(payload.role_pack_version, "role.role_pack_version", 1, 50),
    objective: stringValue(payload.objective, "role.objective", 1, 1000),
    stage: stringValue(payload.stage, "role.stage", 1, 120),
    milestones,
    missing_fields: stringArray(payload.missing_fields, "role.missing_fields", 100, 1, 120),
    next_best_action: {
      action_code: stringValue(action.action_code, "role.next_best_action.action_code", 1, 120),
      reason: stringValue(action.reason, "role.next_best_action.reason", 1, 500),
      confidence: boundedNumber(action.confidence, "role.next_best_action.confidence", 0, 1),
      expires_at: timestampValue(action.expires_at, "role.next_best_action.expires_at"),
    },
  };
}

function parseConversationCommit(value: unknown, schemaVersion: SchemaVersion): TurnCommittedPayload {
  const payload = exactRecord(value, "payload for turn.committed", [
    "schema_version",
    "speaker_participant_id",
    "speaker_role",
    "transcript_text",
    "generation_id",
    "turn_index",
    "active_topic",
    "language",
    "open_questions",
    "confirmed_facts",
    "repair_state",
    "incremental_summary",
  ]);
  const payloadSchemaVersion = parseSchemaVersion(stringValue(payload.schema_version, "turn.schema_version", 1, 20));
  if (payloadSchemaVersion !== schemaVersion) {
    throw new DomainEventValidationError("turn.committed payload schema_version must equal event schema_version");
  }
  const speakerRole = enumValue(payload.speaker_role, TURN_SPEAKER_ROLES, "turn.speaker_role");
  const generationId = payload.generation_id === null
    ? null
    : integerValue(payload.generation_id, "turn.generation_id", 1);
  if ((speakerRole === "participant" && generationId !== null)
    || (speakerRole === "presenter" && generationId === null)) {
    throw new DomainEventValidationError("turn generation_id must match speaker_role");
  }
  const confirmedFacts = arrayValue(payload.confirmed_facts, "conversation.confirmed_facts", 200).map((item, index) => {
    const fact = exactRecord(item, `conversation.confirmed_facts[${index}]`, [
      "evidence_id",
      "kind",
      "summary",
      "source_ref",
      "confidence",
      "observed_at",
      "expires_at",
    ]);
    const kind = enumValue(fact.kind, EVIDENCE_KINDS, `conversation.confirmed_facts[${index}].kind`);
    if (kind === "derived_hypothesis") {
      throw new DomainEventValidationError("derived hypotheses cannot be recorded as confirmed facts");
    }
    return {
      evidence_id: parseUuidV7(fact.evidence_id, `conversation.confirmed_facts[${index}].evidence_id`),
      kind,
      summary: stringValue(fact.summary, `conversation.confirmed_facts[${index}].summary`, 1, 500),
      source_ref: stringValue(fact.source_ref, `conversation.confirmed_facts[${index}].source_ref`, 1, 500),
      confidence: boundedNumber(fact.confidence, `conversation.confirmed_facts[${index}].confidence`, 0, 1),
      observed_at: timestampValue(fact.observed_at, `conversation.confirmed_facts[${index}].observed_at`),
      expires_at: fact.expires_at === null ? null : timestampValue(fact.expires_at, `conversation.confirmed_facts[${index}].expires_at`),
    };
  });
  return {
    schema_version: payloadSchemaVersion,
    speaker_participant_id: parseUuidV7(payload.speaker_participant_id, "turn.speaker_participant_id"),
    speaker_role: speakerRole,
    transcript_text: restrictedTextValue(payload.transcript_text, "turn.transcript_text"),
    generation_id: generationId,
    turn_index: integerValue(payload.turn_index, "conversation.turn_index", 1),
    active_topic: payload.active_topic === null ? null : stringValue(payload.active_topic, "conversation.active_topic", 0, 300),
    language: languageValue(payload.language, "conversation.language"),
    open_questions: stringArray(payload.open_questions, "conversation.open_questions", 50, 1, 500),
    confirmed_facts: confirmedFacts,
    repair_state: enumValue(payload.repair_state, REPAIR_STATES, "conversation.repair_state"),
    incremental_summary: stringValue(payload.incremental_summary, "conversation.incremental_summary", 0, 10_000),
  };
}

function parseQualityUpdate(value: unknown): QualityUpdate {
  const payload = exactRecord(value, "payload for quality.updated", ["dimensions", "aggregate_confidence"]);
  const dimensions = arrayValue(payload.dimensions, "quality.dimensions", 8, 1).map((item, index) => {
    const dimension = exactRecord(item, `quality.dimensions[${index}]`, [
      "name",
      "value",
      "confidence",
      "evidence_refs",
      "rationale",
      "expires_at",
    ]);
    return {
      name: enumValue(dimension.name, QUALITY_DIMENSIONS, `quality.dimensions[${index}].name`),
      value: boundedNumber(dimension.value, `quality.dimensions[${index}].value`, 0, 1),
      confidence: boundedNumber(dimension.confidence, `quality.dimensions[${index}].confidence`, 0, 1),
      evidence_refs: uuidArray(dimension.evidence_refs, `quality.dimensions[${index}].evidence_refs`, 50),
      rationale: stringValue(dimension.rationale, `quality.dimensions[${index}].rationale`, 0, 500),
      expires_at: dimension.expires_at === null ? null : timestampValue(dimension.expires_at, `quality.dimensions[${index}].expires_at`),
    };
  });
  const dimensionNames = new Set(dimensions.map((dimension) => dimension.name));
  if (dimensionNames.size !== dimensions.length) throw new DomainEventValidationError("quality.dimensions cannot repeat a dimension name");
  return {
    dimensions,
    aggregate_confidence: boundedNumber(payload.aggregate_confidence, "quality.aggregate_confidence", 0, 1),
  };
}

function parseSalesUpdate(value: unknown): SalesUpdate {
  const payload = exactRecord(value, "sales state", [
    "funnel_stage",
    "methodology",
    "qualification",
    "objections",
    "proposal_status",
    "conversion_probability",
    "next_step",
  ]);
  const qualification = arrayValue(payload.qualification, "sales.qualification", 20).map((item, index) => {
    const dimension = exactRecord(item, `sales.qualification[${index}]`, ["dimension", "status", "value_summary", "evidence_refs"]);
    return {
      dimension: enumValue(dimension.dimension, QUALIFICATION_DIMENSIONS, `sales.qualification[${index}].dimension`),
      status: enumValue(dimension.status, QUALIFICATION_STATUSES, `sales.qualification[${index}].status`),
      value_summary:
        dimension.value_summary === null
          ? null
          : stringValue(dimension.value_summary, `sales.qualification[${index}].value_summary`, 0, 500),
      evidence_refs: uuidArray(dimension.evidence_refs, `sales.qualification[${index}].evidence_refs`, 20),
    };
  });
  const objections = arrayValue(payload.objections, "sales.objections", 50).map((item, index) => {
    const objection = exactRecord(item, `sales.objections[${index}]`, ["objection_id", "category", "summary", "status", "evidence_refs"]);
    return {
      objection_id: parseUuidV7(objection.objection_id, `sales.objections[${index}].objection_id`),
      category: stringValue(objection.category, `sales.objections[${index}].category`, 1, 120),
      summary: stringValue(objection.summary, `sales.objections[${index}].summary`, 1, 500),
      status: enumValue(objection.status, OBJECTION_STATUSES, `sales.objections[${index}].status`),
      evidence_refs: uuidArray(objection.evidence_refs, `sales.objections[${index}].evidence_refs`, 20),
    };
  });
  return {
    funnel_stage: enumValue(payload.funnel_stage, FUNNEL_STAGES, "sales.funnel_stage"),
    methodology: stringValue(payload.methodology, "sales.methodology", 1, 120),
    qualification,
    objections,
    proposal_status: enumValue(payload.proposal_status, PROPOSAL_STATUSES, "sales.proposal_status"),
    conversion_probability: boundedNumber(payload.conversion_probability, "sales.conversion_probability", 0, 1),
    next_step: payload.next_step === null ? null : stringValue(payload.next_step, "sales.next_step", 0, 1000),
  };
}

function exactRecord(value: unknown, label: string, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new DomainEventValidationError(`${label} must be a plain object`);
  }
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new DomainEventValidationError(`${label} must contain exactly: ${expected.join(", ")}`);
  }
  return record;
}

function emptyPayload(value: unknown, label: string): Record<string, never> {
  exactRecord(value, label, []);
  return {};
}

function stringValue(value: unknown, label: string, minimum: number, maximum: number): string {
  if (typeof value !== "string" || value.length < minimum || value.length > maximum) {
    throw new DomainEventValidationError(`${label} must be a string between ${minimum} and ${maximum} characters`);
  }
  return value;
}

function restrictedTextValue(value: unknown, label: string): string {
  const text = stringValue(value, label, 1, 8_000);
  if (text.includes("\u0000") || new TextEncoder().encode(text).byteLength > 20_000) {
    throw new DomainEventValidationError(`${label} exceeds restricted text limits`);
  }
  return text;
}

function languageValue(value: unknown, label: string): string {
  const language = stringValue(value, label, 2, 5);
  if (!/^[a-z]{2}(-[A-Z]{2})?$/.test(language)) {
    throw new DomainEventValidationError(`${label} must be a supported language tag`);
  }
  return language;
}

function timestampValue(value: unknown, label: string): string {
  const timestamp = stringValue(value, label, 20, 64);
  if (!RFC3339_PATTERN.test(timestamp) || Number.isNaN(Date.parse(timestamp))) {
    throw new DomainEventValidationError(`${label} must be an RFC3339 timestamp`);
  }
  return timestamp;
}

function traceIdValue(value: unknown, label: string): string {
  const traceId = stringValue(value, label, 16, 64);
  if (!TRACE_ID_PATTERN.test(traceId)) throw new DomainEventValidationError(`${label} must be lower-case hexadecimal`);
  return traceId;
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new DomainEventValidationError(`${label} must be boolean`);
  return value;
}

function integerValue(value: unknown, label: string, minimum: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) {
    throw new DomainEventValidationError(`${label} must be an integer of at least ${minimum}`);
  }
  return value;
}

function boundedNumber(value: unknown, label: string, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new DomainEventValidationError(`${label} must be a finite number between ${minimum} and ${maximum}`);
  }
  return value;
}

function enumValue<T extends readonly string[]>(value: unknown, allowed: T, label: string): T[number] {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new DomainEventValidationError(`${label} is not an allowed value`);
  }
  return value as T[number];
}

function arrayValue(value: unknown, label: string, maximum: number, minimum = 0): unknown[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    throw new DomainEventValidationError(`${label} must be an array with ${minimum} to ${maximum} items`);
  }
  return value;
}

function stringArray(value: unknown, label: string, maximum: number, itemMinimum: number, itemMaximum: number): string[] {
  return arrayValue(value, label, maximum).map((item, index) => stringValue(item, `${label}[${index}]`, itemMinimum, itemMaximum));
}

function uuidArray(value: unknown, label: string, maximum: number): string[] {
  return arrayValue(value, label, maximum).map((item, index) => parseUuidV7(item, `${label}[${index}]`));
}
