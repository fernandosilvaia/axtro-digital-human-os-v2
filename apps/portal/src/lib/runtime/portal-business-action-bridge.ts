import { createUuidV7, sha256Canonical } from "@axtro/domain";
import { createServiceRoleClient } from "../supabase/service.ts";

/**
 * ADR-039 wave 1a (register_lead) + ADR-041 (propose_meeting_slots/
 * confirm_meeting_slot wrappers, migration 0052, "Consequências": "ganha
 * dois wrappers novos... e sua ACTION_KINDS/PortalBusinessActionKind deixam
 * de ser um conjunto de um elemento só"). Deliberately independent of
 * portal-channel-runtime-bridge.ts: this module never imports
 * admitPortalChannel/consumePortalChannelGrant/assertPortalChannelActive,
 * which all check PORTAL_RUNTIME_BRIDGE_ENABLED internally -- calling them
 * would recreate the coupling ADR-039 asks this flag to avoid. What it
 * reuses is the durable *evidence* a channel admission already leaves on
 * public.sessions/public.consent_evidence, read by the service RPCs below,
 * never by portal_admit_runtime_channel_service.
 */
export const PORTAL_BUSINESS_ACTION_BRIDGE_RPC = Object.freeze({
  admit: "portal_admit_business_action_service",
  register: "portal_register_business_lead_service",
  propose: "portal_propose_business_meeting_slots_service",
  reserve: "portal_reserve_business_meeting_slot_service",
});

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/;
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PHONE_PATTERN = /^[0-9+()\-. ]{6,32}$/;
/** Same bound app.is_bounded_timezone (0052) enforces server-side: a plausible IANA-ish zone name, or the literal 'UTC'. */
const TIMEZONE_PATTERN = /^(UTC|[A-Za-z]+(\/[A-Za-z0-9_+-]+)+)$/;
const ACTION_KINDS = new Set(["register_lead", "propose_meeting_slots", "confirm_meeting_slot"]);
const MEETING_DURATIONS_MINUTES = new Set([15, 30, 45, 60]);

export type PortalBusinessActionKind = "register_lead" | "propose_meeting_slots" | "confirm_meeting_slot";

export type PortalBusinessActionOutcomeCode =
  | "issued"
  | "replayed"
  | "registered"
  | "proposed"
  | "reserved"
  | "bridge_disabled"
  | "kill_switch_active"
  | "agent_inactive"
  | "presenter_mismatch"
  | "denied_disclosure"
  | "denied_essential_consent"
  | "denied_purpose_consent"
  | "grant_expired"
  | "grant_invalid"
  | "grant_scope_mismatch"
  | "calendar_not_connected"
  | "auto_confirm_disabled"
  | "proposal_not_found"
  | "proposal_expired"
  | "slot_not_offered"
  | "slot_conflict"
  | "service_unavailable";

export type PortalBusinessActionRejectionCode = Exclude<
  PortalBusinessActionOutcomeCode,
  "issued" | "replayed" | "registered" | "proposed" | "reserved"
>;
type PortalBusinessActionBridgeEnv = Readonly<{ readonly PORTAL_BUSINESS_ACTION_BRIDGE_ENABLED?: string }>;

export interface BusinessActionGrant {
  readonly tenantId: string;
  readonly agentId: string;
  readonly sessionId: string;
  readonly presenterId: string;
  readonly actionKind: PortalBusinessActionKind;
  readonly grantId: string;
  readonly generationId: number;
  readonly commandFingerprint: string;
}

export interface AdmitBusinessActionInput {
  readonly tenantId: string;
  readonly agentId: string;
  readonly sessionId: string;
  readonly presenterId: string;
  readonly actionKind: PortalBusinessActionKind;
  /** Opaque per-call id (a Tavus tool_call_id in the future live-call caller); fingerprinted, never used as an authoritative resource id. */
  readonly commandId: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly generation?: number;
  /** Allows a transport retry to reuse the same grant id instead of minting a new one. */
  readonly grantId?: string;
}

export type AdmitBusinessActionResult =
  | Readonly<{ readonly outcome: "issued" | "replayed"; readonly code: "issued" | "replayed"; readonly grant: BusinessActionGrant }>
  | Readonly<{ readonly outcome: "rejected"; readonly code: PortalBusinessActionRejectionCode }>;

export interface RegisterBusinessLeadInput {
  readonly grant: BusinessActionGrant;
  readonly contactName: string;
  readonly contactEmail?: string | null;
  readonly contactPhone?: string | null;
  readonly qualificationSummary?: string;
  readonly leadId?: string;
  readonly receiptId?: string;
}

export type RegisterBusinessLeadResult =
  | Readonly<{ readonly outcome: "registered"; readonly code: "registered"; readonly leadId: string }>
  | Readonly<{ readonly outcome: "rejected"; readonly code: "bridge_disabled" | "grant_invalid" | "kill_switch_active" | "grant_expired" | "service_unavailable" }>;

/** Application-generated (D-V2-010: this codebase always mints child-row ids client/server side, never asks Postgres for one for an unbounded list). */
export interface ProposedMeetingSlotInput {
  readonly id: string;
  readonly startAt: string;
  readonly endAt: string;
}

export interface ProposeBusinessMeetingSlotsInput {
  readonly grant: BusinessActionGrant;
  readonly durationMinutes: 15 | 30 | 45 | 60;
  readonly timezone: string;
  /** Already computed by the caller (ADR-041: this wrapper only persists, it never queries FreeBusy or does availability math itself). */
  readonly slots: readonly ProposedMeetingSlotInput[];
  readonly contactName?: string | null;
  readonly contactEmail?: string | null;
  readonly proposalId?: string;
  readonly receiptId?: string;
}

export type ProposeBusinessMeetingSlotsResult =
  | Readonly<{ readonly outcome: "proposed"; readonly code: "proposed"; readonly proposalId: string }>
  | Readonly<{
      readonly outcome: "rejected";
      readonly code: "bridge_disabled" | "grant_invalid" | "kill_switch_active" | "grant_expired" | "grant_scope_mismatch" | "service_unavailable";
    }>;

export interface ReserveBusinessMeetingSlotInput {
  readonly grant: BusinessActionGrant;
  readonly proposalId: string;
  readonly slotId: string;
  readonly contactEmail: string;
  readonly contactName?: string | null;
  readonly reservationId?: string;
  readonly receiptId?: string;
}

/**
 * "reserved" is a REAL row in portal_business_action_calendar_reservations,
 * not a Google Calendar event yet -- ADR-041 is explicit that no tenant has
 * auto_confirm_scheduling=true today, so "reserved" is unreachable in
 * production right now; it is modeled here (not collapsed into "rejected")
 * because the RPC itself distinguishes it, and collapsing it would make this
 * wrapper lie about what the database actually holds. The caller decides how
 * to talk about "reserved" to the model; this module never assumes it means
 * "the meeting is booked."
 */
export type ReserveBusinessMeetingSlotResult =
  | Readonly<{
      readonly outcome: "reserved";
      readonly code: "reserved";
      readonly reservationId: string;
      readonly googleEventId: string;
      readonly googleCalendarId: string | null;
      readonly startAt: string;
      readonly endAt: string;
      readonly timezone: string;
    }>
  | Readonly<{ readonly outcome: "replayed"; readonly code: "replayed"; readonly reservationId: string; readonly state: string; readonly googleEventId: string | null }>
  | Readonly<{
      readonly outcome: "rejected";
      readonly code:
        | "bridge_disabled"
        | "grant_invalid"
        | "kill_switch_active"
        | "grant_expired"
        | "grant_scope_mismatch"
        | "proposal_not_found"
        | "proposal_expired"
        | "slot_not_offered"
        | "calendar_not_connected"
        | "auto_confirm_disabled"
        | "slot_conflict"
        | "service_unavailable";
    }>;

export interface PortalBusinessActionRpcResult {
  readonly data: unknown;
  readonly error: { readonly message?: string } | null;
}

export interface PortalBusinessActionRpcClient {
  rpc(name: string, parameters?: Readonly<Record<string, unknown>>): PromiseLike<PortalBusinessActionRpcResult>;
}

export interface PortalBusinessActionBridgeDependencies {
  readonly rpc?: PortalBusinessActionRpcClient;
  readonly env?: PortalBusinessActionBridgeEnv;
  readonly idGenerator?: () => string;
}

export interface PortalBusinessActionBridge {
  admitBusinessAction(input: AdmitBusinessActionInput): Promise<AdmitBusinessActionResult>;
  registerBusinessLead(input: RegisterBusinessLeadInput): Promise<RegisterBusinessLeadResult>;
  proposeBusinessMeetingSlots(input: ProposeBusinessMeetingSlotsInput): Promise<ProposeBusinessMeetingSlotsResult>;
  reserveBusinessMeetingSlot(input: ReserveBusinessMeetingSlotInput): Promise<ReserveBusinessMeetingSlotResult>;
}

export class PortalBusinessActionBridgeInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PortalBusinessActionBridgeInputError";
  }
}

export class PortalBusinessActionBridgeServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PortalBusinessActionBridgeServiceError";
  }
}

function ownRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null ? value as Record<string, unknown> : null;
}

function readString(record: Record<string, unknown>, key: string): string | null {
  return typeof record[key] === "string" ? record[key] : null;
}

function readGeneration(record: Record<string, unknown>): number | null {
  const value = record.generation;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function assertUuid(value: unknown, name: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) throw new PortalBusinessActionBridgeInputError(`${name} must be a UUID`);
  return value;
}

function assertUuidV7(value: unknown, name: string): string {
  const id = assertUuid(value, name);
  if (!UUID_V7_PATTERN.test(id)) throw new PortalBusinessActionBridgeInputError(`${name} must be a UUIDv7`);
  return id;
}

function assertActionKind(value: unknown): PortalBusinessActionKind {
  if (typeof value !== "string" || !ACTION_KINDS.has(value)) throw new PortalBusinessActionBridgeInputError("actionKind is invalid");
  return value as PortalBusinessActionKind;
}

function assertGeneration(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new PortalBusinessActionBridgeInputError(`${name} is invalid`);
  return value;
}

function processEnabled(env: NodeJS.ProcessEnv | PortalBusinessActionBridgeEnv): boolean {
  return env.PORTAL_BUSINESS_ACTION_BRIDGE_ENABLED === "true";
}

async function rpcValue(client: PortalBusinessActionRpcClient, name: string, parameters: Readonly<Record<string, unknown>>): Promise<unknown> {
  const response = await client.rpc(name, parameters);
  if (response.error !== null) throw new PortalBusinessActionBridgeServiceError(`business action bridge ${name} failed: ${response.error.message ?? "unknown error"}`);
  return response.data;
}

async function rpc(client: PortalBusinessActionRpcClient, name: string, parameters: Readonly<Record<string, unknown>>): Promise<Record<string, unknown>> {
  const data = await rpcValue(client, name, parameters);
  const result = ownRecord(data);
  if (result === null) throw new PortalBusinessActionBridgeServiceError(`business action bridge ${name} returned an invalid receipt`);
  return result;
}

function rejection<TCode extends PortalBusinessActionRejectionCode>(code: TCode): Readonly<{ readonly outcome: "rejected"; readonly code: TCode }> {
  return Object.freeze({ outcome: "rejected", code });
}

function checkedGrant(value: BusinessActionGrant): BusinessActionGrant {
  const record = ownRecord(value);
  if (record === null) throw new PortalBusinessActionBridgeInputError("business action grant is invalid");
  const commandFingerprint = readString(record, "commandFingerprint");
  if (!commandFingerprint || !FINGERPRINT_PATTERN.test(commandFingerprint)) throw new PortalBusinessActionBridgeInputError("grant.commandFingerprint is invalid");
  return Object.freeze({
    tenantId: assertUuidV7(record.tenantId, "grant.tenantId"),
    agentId: assertUuidV7(record.agentId, "grant.agentId"),
    sessionId: assertUuidV7(record.sessionId, "grant.sessionId"),
    presenterId: assertUuidV7(record.presenterId, "grant.presenterId"),
    actionKind: assertActionKind(record.actionKind),
    grantId: assertUuidV7(record.grantId, "grant.grantId"),
    generationId: assertGeneration(record.generationId, "grant.generationId"),
    commandFingerprint,
  });
}

export function createPortalBusinessActionBridge(dependencies: PortalBusinessActionBridgeDependencies = {}): PortalBusinessActionBridge {
  const client = dependencies.rpc ?? createServiceRoleClient();
  const env = dependencies.env ?? process.env;
  const idGenerator = dependencies.idGenerator ?? createUuidV7;

  const admitBusinessAction = async (input: AdmitBusinessActionInput): Promise<AdmitBusinessActionResult> => {
    if (!processEnabled(env)) return rejection("bridge_disabled");
    const tenantId = assertUuidV7(input.tenantId, "tenantId");
    const agentId = assertUuidV7(input.agentId, "agentId");
    const sessionId = assertUuidV7(input.sessionId, "sessionId");
    const presenterId = assertUuidV7(input.presenterId, "presenterId");
    const actionKind = assertActionKind(input.actionKind);
    const commandId = assertUuid(input.commandId, "commandId");
    const generation = input.generation === undefined ? 0 : assertGeneration(input.generation, "generation");
    const grantId = input.grantId === undefined ? assertUuidV7(idGenerator(), "grantId") : assertUuidV7(input.grantId, "grantId");
    const commandFingerprint = sha256Canonical({ tenantId, agentId, sessionId, actionKind, commandId, args: input.args });

    try {
      const receipt = await rpc(client, PORTAL_BUSINESS_ACTION_BRIDGE_RPC.admit, {
        p_grant_id: grantId,
        p_tenant_id: tenantId,
        p_agent_id: agentId,
        p_session_id: sessionId,
        p_presenter_id: presenterId,
        p_action_kind: actionKind,
        p_command_fingerprint: commandFingerprint,
        p_generation: generation,
      });
      const outcome = receipt.outcome;
      if (outcome === "blocked_kill_switch") return rejection("kill_switch_active");
      if (outcome === "agent_inactive" || outcome === "presenter_mismatch" || outcome === "denied_disclosure" || outcome === "denied_essential_consent" || outcome === "denied_purpose_consent") {
        return rejection(outcome);
      }
      if (outcome === "expired") return rejection("grant_expired");
      if (outcome !== "issued" && outcome !== "replayed") return rejection("service_unavailable");
      const receiptSessionId = readString(receipt, "sessionId");
      const receiptGrantId = readString(receipt, "grantId");
      const receiptGeneration = readGeneration(receipt);
      if (!receiptSessionId || !receiptGrantId || receiptGeneration === null) return rejection("service_unavailable");
      const grant: BusinessActionGrant = Object.freeze({
        tenantId,
        agentId,
        sessionId: assertUuidV7(receiptSessionId, "sessionId"),
        presenterId,
        actionKind,
        grantId: assertUuidV7(receiptGrantId, "grantId"),
        generationId: receiptGeneration,
        commandFingerprint,
      });
      return Object.freeze({ outcome: outcome === "issued" ? "issued" : "replayed", code: outcome === "issued" ? "issued" : "replayed", grant });
    } catch (error) {
      if (error instanceof PortalBusinessActionBridgeInputError) throw error;
      return rejection("service_unavailable");
    }
  };

  const registerBusinessLead = async (input: RegisterBusinessLeadInput): Promise<RegisterBusinessLeadResult> => {
    if (!processEnabled(env)) return rejection("bridge_disabled");
    const grant = checkedGrant(input.grant);
    if (grant.actionKind !== "register_lead") throw new PortalBusinessActionBridgeInputError("grant.actionKind must be register_lead");
    const contactName = input.contactName.trim();
    if (contactName.length === 0 || contactName.length > 200) throw new PortalBusinessActionBridgeInputError("contactName is invalid");
    const contactEmail = input.contactEmail === undefined || input.contactEmail === null ? null : input.contactEmail.trim();
    const contactPhone = input.contactPhone === undefined || input.contactPhone === null ? null : input.contactPhone.trim();
    if (contactEmail === null && contactPhone === null) throw new PortalBusinessActionBridgeInputError("register_lead requires contactEmail or contactPhone");
    if (contactEmail !== null && (contactEmail.length === 0 || !EMAIL_PATTERN.test(contactEmail))) throw new PortalBusinessActionBridgeInputError("contactEmail is invalid");
    if (contactPhone !== null && !PHONE_PATTERN.test(contactPhone)) throw new PortalBusinessActionBridgeInputError("contactPhone is invalid");
    const qualificationSummary = input.qualificationSummary ?? "";
    if (qualificationSummary.length > 2_000) throw new PortalBusinessActionBridgeInputError("qualificationSummary is invalid");

    try {
      const receipt = await rpc(client, PORTAL_BUSINESS_ACTION_BRIDGE_RPC.register, {
        p_lead_id: input.leadId === undefined ? assertUuidV7(idGenerator(), "leadId") : assertUuidV7(input.leadId, "leadId"),
        p_receipt_id: input.receiptId === undefined ? assertUuidV7(idGenerator(), "receiptId") : assertUuidV7(input.receiptId, "receiptId"),
        p_grant_id: grant.grantId,
        p_contact_name: contactName,
        p_contact_email: contactEmail,
        p_contact_phone: contactPhone,
        p_qualification_summary: qualificationSummary,
      });
      if (receipt.outcome === "succeeded") {
        const leadId = readString(receipt, "leadId");
        if (!leadId) return rejection("service_unavailable");
        return Object.freeze({ outcome: "registered", code: "registered", leadId: assertUuidV7(leadId, "leadId") });
      }
      if (receipt.outcome === "rejected") {
        const reason = readString(receipt, "reason");
        if (reason === "kill_switch_active" || reason === "grant_expired") return rejection(reason);
        return rejection("grant_invalid");
      }
      return rejection("grant_invalid");
    } catch (error) {
      if (error instanceof PortalBusinessActionBridgeInputError) throw error;
      return rejection("service_unavailable");
    }
  };

  const proposeBusinessMeetingSlots = async (input: ProposeBusinessMeetingSlotsInput): Promise<ProposeBusinessMeetingSlotsResult> => {
    if (!processEnabled(env)) return rejection("bridge_disabled");
    const grant = checkedGrant(input.grant);
    if (grant.actionKind !== "propose_meeting_slots") throw new PortalBusinessActionBridgeInputError("grant.actionKind must be propose_meeting_slots");
    if (!MEETING_DURATIONS_MINUTES.has(input.durationMinutes)) throw new PortalBusinessActionBridgeInputError("durationMinutes is invalid");
    if (!TIMEZONE_PATTERN.test(input.timezone)) throw new PortalBusinessActionBridgeInputError("timezone is invalid");
    if (!Array.isArray(input.slots) || input.slots.length < 1 || input.slots.length > 50) throw new PortalBusinessActionBridgeInputError("slots is invalid");
    const seenSlotIds = new Set<string>();
    const slots = input.slots.map((slot) => {
      const id = assertUuidV7(slot.id, "slot.id");
      if (seenSlotIds.has(id)) throw new PortalBusinessActionBridgeInputError("duplicate slot id in slots");
      seenSlotIds.add(id);
      const startMs = Date.parse(slot.startAt);
      const endMs = Date.parse(slot.endAt);
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) throw new PortalBusinessActionBridgeInputError("slot startAt/endAt is invalid");
      return { id, startAt: slot.startAt, endAt: slot.endAt };
    });
    const contactName = input.contactName === undefined || input.contactName === null ? null : input.contactName.trim();
    if (contactName !== null && (contactName.length === 0 || contactName.length > 200)) throw new PortalBusinessActionBridgeInputError("contactName is invalid");
    const contactEmail = input.contactEmail === undefined || input.contactEmail === null ? null : input.contactEmail.trim();
    if (contactEmail !== null && (contactEmail.length === 0 || !EMAIL_PATTERN.test(contactEmail))) throw new PortalBusinessActionBridgeInputError("contactEmail is invalid");

    try {
      const receipt = await rpc(client, PORTAL_BUSINESS_ACTION_BRIDGE_RPC.propose, {
        p_receipt_id: input.receiptId === undefined ? assertUuidV7(idGenerator(), "receiptId") : assertUuidV7(input.receiptId, "receiptId"),
        p_proposal_id: input.proposalId === undefined ? assertUuidV7(idGenerator(), "proposalId") : assertUuidV7(input.proposalId, "proposalId"),
        p_grant_id: grant.grantId,
        p_tenant_id: grant.tenantId,
        p_agent_id: grant.agentId,
        p_session_id: grant.sessionId,
        p_presenter_id: grant.presenterId,
        p_duration_minutes: input.durationMinutes,
        p_timezone: input.timezone,
        p_slots: slots,
        p_contact_name: contactName,
        p_contact_email: contactEmail,
      });
      if (receipt.outcome === "succeeded") {
        const proposalId = readString(receipt, "proposalId");
        if (!proposalId) return rejection("service_unavailable");
        return Object.freeze({ outcome: "proposed", code: "proposed", proposalId: assertUuidV7(proposalId, "proposalId") });
      }
      if (receipt.outcome === "rejected") {
        const reason = readString(receipt, "reason");
        if (reason === "kill_switch_active" || reason === "grant_expired" || reason === "grant_scope_mismatch") return rejection(reason);
        return rejection("grant_invalid");
      }
      return rejection("grant_invalid");
    } catch (error) {
      if (error instanceof PortalBusinessActionBridgeInputError) throw error;
      return rejection("service_unavailable");
    }
  };

  const reserveBusinessMeetingSlot = async (input: ReserveBusinessMeetingSlotInput): Promise<ReserveBusinessMeetingSlotResult> => {
    if (!processEnabled(env)) return rejection("bridge_disabled");
    const grant = checkedGrant(input.grant);
    if (grant.actionKind !== "confirm_meeting_slot") throw new PortalBusinessActionBridgeInputError("grant.actionKind must be confirm_meeting_slot");
    const proposalId = assertUuidV7(input.proposalId, "proposalId");
    const slotId = assertUuidV7(input.slotId, "slotId");
    const contactEmail = input.contactEmail.trim();
    if (contactEmail.length === 0 || !EMAIL_PATTERN.test(contactEmail)) throw new PortalBusinessActionBridgeInputError("contactEmail is invalid");
    const contactName = input.contactName === undefined || input.contactName === null ? null : input.contactName.trim();
    if (contactName !== null && (contactName.length === 0 || contactName.length > 200)) throw new PortalBusinessActionBridgeInputError("contactName is invalid");

    try {
      const receipt = await rpc(client, PORTAL_BUSINESS_ACTION_BRIDGE_RPC.reserve, {
        p_reservation_id: input.reservationId === undefined ? assertUuidV7(idGenerator(), "reservationId") : assertUuidV7(input.reservationId, "reservationId"),
        p_receipt_id: input.receiptId === undefined ? assertUuidV7(idGenerator(), "receiptId") : assertUuidV7(input.receiptId, "receiptId"),
        p_grant_id: grant.grantId,
        p_tenant_id: grant.tenantId,
        p_agent_id: grant.agentId,
        p_session_id: grant.sessionId,
        p_presenter_id: grant.presenterId,
        p_proposal_id: proposalId,
        p_slot_id: slotId,
        p_contact_email: contactEmail,
        p_contact_name: contactName,
      });
      // Never assume success: the reserve RPC's own vocabulary is
      // reserved/replayed/rejected, never "succeeded" -- and "reserved" is a
      // durable DB row, not proof any Google Calendar event exists yet
      // (ADR-041, see the type doc above ReserveBusinessMeetingSlotResult).
      if (receipt.outcome === "reserved") {
        const reservationId = readString(receipt, "reservationId");
        const googleEventId = readString(receipt, "googleEventId");
        const startAt = readString(receipt, "startAt");
        const endAt = readString(receipt, "endAt");
        const timezone = readString(receipt, "timezone");
        if (!reservationId || !googleEventId || !startAt || !endAt || !timezone) return rejection("service_unavailable");
        return Object.freeze({
          outcome: "reserved",
          code: "reserved",
          reservationId: assertUuidV7(reservationId, "reservationId"),
          googleEventId,
          googleCalendarId: readString(receipt, "googleCalendarId"),
          startAt,
          endAt,
          timezone,
        });
      }
      if (receipt.outcome === "replayed") {
        const reservationId = readString(receipt, "reservationId");
        const state = readString(receipt, "state");
        if (!reservationId || !state) return rejection("service_unavailable");
        return Object.freeze({ outcome: "replayed", code: "replayed", reservationId: assertUuidV7(reservationId, "reservationId"), state, googleEventId: readString(receipt, "googleEventId") });
      }
      if (receipt.outcome === "rejected") {
        const reason = readString(receipt, "reason");
        if (
          reason === "kill_switch_active" ||
          reason === "grant_expired" ||
          reason === "grant_scope_mismatch" ||
          reason === "auto_confirm_disabled" ||
          reason === "proposal_not_found" ||
          reason === "proposal_expired" ||
          reason === "slot_not_offered" ||
          reason === "calendar_not_connected" ||
          reason === "slot_conflict"
        ) {
          return rejection(reason);
        }
        return rejection("grant_invalid");
      }
      return rejection("service_unavailable");
    } catch (error) {
      if (error instanceof PortalBusinessActionBridgeInputError) throw error;
      return rejection("service_unavailable");
    }
  };

  return Object.freeze({ admitBusinessAction, registerBusinessLead, proposeBusinessMeetingSlots, reserveBusinessMeetingSlot });
}

/** Production convenience wrappers. Prefer an injected bridge in tests. */
export async function admitBusinessAction(input: AdmitBusinessActionInput, dependencies?: PortalBusinessActionBridgeDependencies): Promise<AdmitBusinessActionResult> {
  return createPortalBusinessActionBridge(dependencies).admitBusinessAction(input);
}

export async function registerBusinessLead(input: RegisterBusinessLeadInput, dependencies?: PortalBusinessActionBridgeDependencies): Promise<RegisterBusinessLeadResult> {
  return createPortalBusinessActionBridge(dependencies).registerBusinessLead(input);
}

export async function proposeBusinessMeetingSlots(input: ProposeBusinessMeetingSlotsInput, dependencies?: PortalBusinessActionBridgeDependencies): Promise<ProposeBusinessMeetingSlotsResult> {
  return createPortalBusinessActionBridge(dependencies).proposeBusinessMeetingSlots(input);
}

export async function reserveBusinessMeetingSlot(input: ReserveBusinessMeetingSlotInput, dependencies?: PortalBusinessActionBridgeDependencies): Promise<ReserveBusinessMeetingSlotResult> {
  return createPortalBusinessActionBridge(dependencies).reserveBusinessMeetingSlot(input);
}
