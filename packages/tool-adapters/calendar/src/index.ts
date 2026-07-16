/**
 * M3-04: propose available slots and require an explicit, separate
 * confirmation before any external write. Default mode is dry-run — a
 * caller must set `dryRun: false` AND `approved: true` before the injected
 * write sink is ever invoked. Timezone and conflict checks are explicit,
 * never inferred.
 */
export const SUPPORTED_TIMEZONES = ["UTC", "America/Sao_Paulo", "America/New_York", "America/Los_Angeles", "Europe/Lisbon"] as const;
export type SupportedTimezone = (typeof SUPPORTED_TIMEZONES)[number];

export interface CalendarSlot {
  readonly startMs: number;
  readonly endMs: number;
  readonly timezone: SupportedTimezone;
}

export interface BusyInterval {
  readonly startMs: number;
  readonly endMs: number;
}

export interface CalendarAvailabilitySource {
  busyIntervals(participantId: string, windowStartMs: number, windowEndMs: number): Promise<readonly BusyInterval[]>;
}

export interface CalendarWriteSink {
  createEvent(input: { readonly tenantId: string; readonly participantIds: readonly string[]; readonly slot: CalendarSlot }): Promise<{ readonly externalEventId: string }>;
}

export class CalendarAdapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CalendarAdapterError";
  }
}

export interface ProposeSlotsRequest {
  readonly tenantId: string;
  readonly requesterActorId: string;
  readonly participantIds: readonly string[];
  readonly durationMinutes: number;
  readonly windowStartMs: number;
  readonly windowEndMs: number;
  readonly timezone: SupportedTimezone;
  readonly maxSlots?: number;
}

export interface ProposedSlotsResult {
  readonly proposalId: string;
  readonly slots: readonly CalendarSlot[];
  readonly expiresAtMs: number;
}

export type ConfirmSlotStatus = "dry_run_confirmed" | "confirmed" | "conflict" | "expired_proposal" | "not_approved" | "unknown_slot";

export interface ConfirmSlotRequest {
  readonly tenantId: string;
  readonly requesterActorId: string;
  readonly proposalId: string;
  readonly selectedSlot: CalendarSlot;
  readonly approved: boolean;
  readonly dryRun?: boolean;
  readonly idempotencyKey: string;
}

export interface ConfirmSlotResult {
  readonly status: ConfirmSlotStatus;
  readonly externalEventId: string | null;
  readonly dryRun: boolean;
}

export interface CalendarProposalPort {
  proposeSlots(rawRequest: unknown): Promise<ProposedSlotsResult>;
  confirmSlot(rawRequest: unknown): Promise<ConfirmSlotResult>;
}

export interface CalendarClock {
  now(): number;
}

export interface CreateCalendarProposalPortOptions {
  readonly clock?: CalendarClock;
  readonly proposalTtlMs?: number;
}

const systemClock: CalendarClock = Object.freeze({ now: () => Date.now() });
const DEFAULT_PROPOSAL_TTL_MS = 60 * 60 * 1_000;
const MAX_SLOTS_DEFAULT = 5;
const TENANT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
let proposalSequence = 0;

interface StoredProposal {
  readonly tenantId: string;
  readonly participantIds: readonly string[];
  readonly slots: readonly CalendarSlot[];
  readonly expiresAtMs: number;
}

export function createCalendarProposalPort(
  availability: CalendarAvailabilitySource,
  writeSink: CalendarWriteSink,
  options: CreateCalendarProposalPortOptions = {},
): CalendarProposalPort {
  const clock = options.clock ?? systemClock;
  const proposalTtlMs = options.proposalTtlMs ?? DEFAULT_PROPOSAL_TTL_MS;
  const proposals = new Map<string, StoredProposal>();
  const idempotencyResults = new Map<string, ConfirmSlotResult>();

  return Object.freeze({
    async proposeSlots(rawRequest: unknown): Promise<ProposedSlotsResult> {
      const request = parseProposeRequest(rawRequest);
      const durationMs = request.durationMinutes * 60 * 1_000;
      const busyByParticipant = await Promise.all(
        request.participantIds.map((participantId) => availability.busyIntervals(participantId, request.windowStartMs, request.windowEndMs)),
      );
      const merged = mergeIntervals(busyByParticipant.flat());
      const maxSlots = request.maxSlots ?? MAX_SLOTS_DEFAULT;

      const slots: CalendarSlot[] = [];
      for (let cursor = request.windowStartMs; cursor + durationMs <= request.windowEndMs && slots.length < maxSlots; cursor += durationMs) {
        const candidateEnd = cursor + durationMs;
        const conflicts = merged.some((interval) => cursor < interval.endMs && candidateEnd > interval.startMs);
        if (!conflicts) slots.push(Object.freeze({ startMs: cursor, endMs: candidateEnd, timezone: request.timezone }));
      }

      proposalSequence += 1;
      const proposalId = `calendar-proposal-${proposalSequence}`;
      const expiresAtMs = clock.now() + proposalTtlMs;
      proposals.set(proposalId, Object.freeze({ tenantId: request.tenantId, participantIds: request.participantIds, slots: Object.freeze(slots), expiresAtMs }));
      return Object.freeze({ proposalId, slots: Object.freeze(slots), expiresAtMs });
    },

    async confirmSlot(rawRequest: unknown): Promise<ConfirmSlotResult> {
      const request = parseConfirmRequest(rawRequest);
      const idempotencyId = `${request.tenantId}:${request.idempotencyKey}`;
      const previous = idempotencyResults.get(idempotencyId);
      if (previous !== undefined) return previous;

      const dryRun = request.dryRun ?? true;
      const finalize = (result: ConfirmSlotResult): ConfirmSlotResult => {
        idempotencyResults.set(idempotencyId, result);
        return result;
      };

      const proposal = proposals.get(request.proposalId);
      if (proposal === undefined || proposal.tenantId !== request.tenantId) {
        return finalize(Object.freeze({ status: "expired_proposal", externalEventId: null, dryRun }));
      }
      if (clock.now() >= proposal.expiresAtMs) {
        return finalize(Object.freeze({ status: "expired_proposal", externalEventId: null, dryRun }));
      }
      const wasOffered = proposal.slots.some((slot) => sameSlot(slot, request.selectedSlot));
      if (!wasOffered) {
        return finalize(Object.freeze({ status: "unknown_slot", externalEventId: null, dryRun }));
      }

      // Re-check for conflicts at confirmation time — availability may have changed since the proposal.
      const busyByParticipant = await Promise.all(
        proposal.participantIds.map((participantId) => availability.busyIntervals(participantId, request.selectedSlot.startMs, request.selectedSlot.endMs)),
      );
      const stillConflicts = mergeIntervals(busyByParticipant.flat()).some(
        (interval) => request.selectedSlot.startMs < interval.endMs && request.selectedSlot.endMs > interval.startMs,
      );
      if (stillConflicts) return finalize(Object.freeze({ status: "conflict", externalEventId: null, dryRun }));

      if (!request.approved) return finalize(Object.freeze({ status: "not_approved", externalEventId: null, dryRun }));
      if (dryRun) return finalize(Object.freeze({ status: "dry_run_confirmed", externalEventId: null, dryRun: true }));

      const written = await writeSink.createEvent({ tenantId: request.tenantId, participantIds: proposal.participantIds, slot: request.selectedSlot });
      return finalize(Object.freeze({ status: "confirmed", externalEventId: written.externalEventId, dryRun: false }));
    },
  });
}

function sameSlot(a: CalendarSlot, b: CalendarSlot): boolean {
  return a.startMs === b.startMs && a.endMs === b.endMs && a.timezone === b.timezone;
}

function mergeIntervals(intervals: readonly BusyInterval[]): readonly BusyInterval[] {
  const sorted = [...intervals].sort((left, right) => left.startMs - right.startMs);
  const merged: BusyInterval[] = [];
  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (last !== undefined && interval.startMs <= last.endMs) {
      merged[merged.length - 1] = Object.freeze({ startMs: last.startMs, endMs: Math.max(last.endMs, interval.endMs) });
    } else {
      merged.push(Object.freeze({ ...interval }));
    }
  }
  return merged;
}

function parseTenantId(value: unknown): string {
  if (typeof value !== "string" || !TENANT_ID_PATTERN.test(value)) throw new CalendarAdapterError("invalid tenantId");
  return value;
}

function parseTimezone(value: unknown): SupportedTimezone {
  if (typeof value !== "string" || !(SUPPORTED_TIMEZONES as readonly string[]).includes(value)) {
    throw new CalendarAdapterError(`unsupported timezone: ${String(value)}`);
  }
  return value as SupportedTimezone;
}

function parseTimestampMs(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new CalendarAdapterError(`invalid ${label}`);
  return value;
}

function parseProposeRequest(value: unknown): ProposeSlotsRequest {
  if (value === null || typeof value !== "object") throw new CalendarAdapterError("invalid propose request");
  const record = value as Record<string, unknown>;
  const tenantId = parseTenantId(record.tenantId);
  if (typeof record.requesterActorId !== "string" || record.requesterActorId.length === 0) throw new CalendarAdapterError("invalid requesterActorId");
  if (!Array.isArray(record.participantIds) || record.participantIds.length === 0 || record.participantIds.length > 20) {
    throw new CalendarAdapterError("invalid participantIds");
  }
  const participantIds = record.participantIds.map((id, index) => {
    if (typeof id !== "string" || id.length === 0) throw new CalendarAdapterError(`invalid participantIds[${index}]`);
    return id;
  });
  if (typeof record.durationMinutes !== "number" || !Number.isSafeInteger(record.durationMinutes) || record.durationMinutes <= 0 || record.durationMinutes > 480) {
    throw new CalendarAdapterError("invalid durationMinutes");
  }
  const windowStartMs = parseTimestampMs(record.windowStartMs, "windowStartMs");
  const windowEndMs = parseTimestampMs(record.windowEndMs, "windowEndMs");
  if (windowEndMs <= windowStartMs) throw new CalendarAdapterError("windowEndMs must be after windowStartMs");
  const timezone = parseTimezone(record.timezone);
  if (record.maxSlots !== undefined && (typeof record.maxSlots !== "number" || !Number.isSafeInteger(record.maxSlots) || record.maxSlots <= 0 || record.maxSlots > 50)) {
    throw new CalendarAdapterError("invalid maxSlots");
  }
  return Object.freeze({
    tenantId,
    requesterActorId: record.requesterActorId,
    participantIds: Object.freeze(participantIds),
    durationMinutes: record.durationMinutes,
    windowStartMs,
    windowEndMs,
    timezone,
    ...(record.maxSlots === undefined ? {} : { maxSlots: record.maxSlots as number }),
  });
}

function parseSlot(value: unknown): CalendarSlot {
  if (value === null || typeof value !== "object") throw new CalendarAdapterError("invalid slot");
  const record = value as Record<string, unknown>;
  return Object.freeze({
    startMs: parseTimestampMs(record.startMs, "slot.startMs"),
    endMs: parseTimestampMs(record.endMs, "slot.endMs"),
    timezone: parseTimezone(record.timezone),
  });
}

function parseConfirmRequest(value: unknown): ConfirmSlotRequest {
  if (value === null || typeof value !== "object") throw new CalendarAdapterError("invalid confirm request");
  const record = value as Record<string, unknown>;
  const tenantId = parseTenantId(record.tenantId);
  if (typeof record.requesterActorId !== "string" || record.requesterActorId.length === 0) throw new CalendarAdapterError("invalid requesterActorId");
  if (typeof record.proposalId !== "string" || record.proposalId.length === 0) throw new CalendarAdapterError("invalid proposalId");
  if (typeof record.approved !== "boolean") throw new CalendarAdapterError("invalid approved");
  if (record.dryRun !== undefined && typeof record.dryRun !== "boolean") throw new CalendarAdapterError("invalid dryRun");
  if (typeof record.idempotencyKey !== "string" || record.idempotencyKey.length === 0) throw new CalendarAdapterError("invalid idempotencyKey");
  return Object.freeze({
    tenantId,
    requesterActorId: record.requesterActorId,
    proposalId: record.proposalId,
    selectedSlot: parseSlot(record.selectedSlot),
    approved: record.approved,
    ...(record.dryRun === undefined ? {} : { dryRun: record.dryRun as boolean }),
    idempotencyKey: record.idempotencyKey,
  });
}
