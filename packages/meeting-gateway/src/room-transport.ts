import type { ChannelConnection, ChannelOpenRequest, ChannelPort, ProviderOperationControl } from "@axtro/provider-contracts";

/**
 * Normalized native-room transport boundary (M2-01). Session and turn-coordinator
 * code depends only on this interface, never on a concrete SDK. The first real
 * implementation is expected to be LiveKit-compatible (ADR-003, benchmark gate);
 * until that bake-off, only the local deterministic transport below exists.
 */
export type RoomParticipantRole = "presenter" | "attendee" | "specialist_silent";
export type RoomParticipantLifecycle = "joining" | "active" | "reconnecting" | "left" | "removed";
export type RoomTrackKind = "audio" | "video" | "data";
export type RoomLeaveReason = "graceful" | "disconnected" | "removed";

export interface RoomParticipant {
  readonly participantId: string;
  readonly role: RoomParticipantRole;
  readonly lifecycle: RoomParticipantLifecycle;
  readonly joinedAtMs: number;
  readonly updatedAtMs: number;
}

export interface RoomPublishedTrack {
  readonly trackId: string;
  readonly participantId: string;
  readonly kind: RoomTrackKind;
  readonly payloadReference: string;
  readonly publishedAtMs: number;
}

export type RoomTransportEvent =
  | { readonly type: "participant_joined"; readonly sequence: number; readonly atMs: number; readonly participantId: string; readonly role: RoomParticipantRole }
  | { readonly type: "participant_reconnecting"; readonly sequence: number; readonly atMs: number; readonly participantId: string }
  | { readonly type: "participant_reconnected"; readonly sequence: number; readonly atMs: number; readonly participantId: string }
  | { readonly type: "participant_left"; readonly sequence: number; readonly atMs: number; readonly participantId: string; readonly reason: RoomLeaveReason }
  | { readonly type: "track_published"; readonly sequence: number; readonly atMs: number; readonly trackId: string; readonly participantId: string; readonly kind: RoomTrackKind }
  | { readonly type: "track_unpublished"; readonly sequence: number; readonly atMs: number; readonly trackId: string; readonly reason: "explicit" | "participant_left" }
  | { readonly type: "room_closed"; readonly sequence: number; readonly atMs: number; readonly reason: string };

type DistributiveOmit<Value, Keys extends keyof never> = Value extends unknown ? Omit<Value, Keys> : never;
type RoomTransportEventInput = DistributiveOmit<RoomTransportEvent, "sequence" | "atMs">;

export type RoomTransportErrorCode =
  | "invalid_input"
  | "already_joined"
  | "unknown_participant"
  | "participant_not_active"
  | "unknown_track"
  | "capacity_exceeded"
  | "room_closed";

export class RoomTransportError extends Error {
  constructor(readonly code: RoomTransportErrorCode) {
    super(`room transport rejected the operation: ${code}`);
    this.name = "RoomTransportError";
  }
}

export interface RoomTransportClock {
  now(): number;
}

export interface RoomTransport {
  readonly roomReference: string;
  join(input: { readonly participantId: unknown; readonly role: unknown }): RoomParticipant;
  markReconnecting(participantId: unknown): RoomParticipant;
  reconnect(participantId: unknown): RoomParticipant;
  leave(participantId: unknown, reason?: unknown): void;
  publish(input: { readonly participantId: unknown; readonly kind: unknown; readonly payloadReference: unknown }): RoomPublishedTrack;
  unpublish(trackId: unknown): void;
  subscribe(participantId: unknown, trackId: unknown): RoomPublishedTrack;
  listParticipants(): readonly RoomParticipant[];
  listTracks(): readonly RoomPublishedTrack[];
  disconnect(reason?: unknown): Promise<void>;
  events(): readonly RoomTransportEvent[];
  isClosed(): boolean;
}

const ROLES = ["presenter", "attendee", "specialist_silent"] as const;
const TRACK_KINDS = ["audio", "video", "data"] as const;
const LEAVE_REASONS = ["graceful", "disconnected", "removed"] as const;
const PARTICIPANT_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const REFERENCE_PATTERN = /^[a-z0-9][a-z0-9_.:-]{0,127}$/;
const MAX_PARTICIPANTS = 64;
const MAX_TRACKS = 256;
const MAX_EVENTS = 4096;

const systemClock: RoomTransportClock = Object.freeze({ now: () => Date.now() });

export interface CreateLocalRoomTransportInput {
  readonly channelPort: ChannelPort;
  readonly channelOpenRequest: ChannelOpenRequest;
  readonly control: ProviderOperationControl;
  readonly roomReference: string;
  readonly clock?: RoomTransportClock;
}

/**
 * Local, deterministic room transport. It opens exactly one underlying
 * ChannelPort connection and layers participant/track lifecycle semantics on
 * top of it, so a future LiveKit-backed ChannelPort can be substituted without
 * this module, or any caller of RoomTransport, changing.
 */
export async function createLocalRoomTransport(input: CreateLocalRoomTransportInput): Promise<RoomTransport> {
  const roomReference = parseRoomReference(input.roomReference);
  const clock = input.clock ?? systemClock;
  const channelConnection: ChannelConnection = await input.channelPort.open(input.channelOpenRequest, input.control);

  const participants = new Map<string, RoomParticipant>();
  const tracks = new Map<string, RoomPublishedTrack>();
  const events: RoomTransportEvent[] = [];
  let sequence = 0;
  let trackCounter = 0;
  let closed = false;

  const emit = (event: RoomTransportEventInput): void => {
    if (events.length >= MAX_EVENTS) events.shift();
    events.push(Object.freeze({ ...event, sequence: sequence += 1, atMs: clock.now() } as RoomTransportEvent));
  };
  const assertOpen = (): void => {
    if (closed) throw new RoomTransportError("room_closed");
  };
  const requireParticipant = (participantId: string): RoomParticipant => {
    const participant = participants.get(participantId);
    if (participant === undefined) throw new RoomTransportError("unknown_participant");
    return participant;
  };
  const requireActiveParticipant = (participantId: string): RoomParticipant => {
    const participant = requireParticipant(participantId);
    if (participant.lifecycle !== "active") throw new RoomTransportError("participant_not_active");
    return participant;
  };

  const transport: RoomTransport = Object.freeze({
    roomReference,
    join(rawInput: { readonly participantId: unknown; readonly role: unknown }): RoomParticipant {
      assertOpen();
      const participantId = parseParticipantId(rawInput?.participantId);
      const role = parseRole(rawInput?.role);
      const existing = participants.get(participantId);
      if (existing !== undefined && existing.lifecycle !== "left" && existing.lifecycle !== "removed") {
        throw new RoomTransportError("already_joined");
      }
      if (participants.size >= MAX_PARTICIPANTS) throw new RoomTransportError("capacity_exceeded");
      const now = clock.now();
      const participant: RoomParticipant = Object.freeze({ participantId, role, lifecycle: "active", joinedAtMs: now, updatedAtMs: now });
      participants.set(participantId, participant);
      emit({ type: "participant_joined", participantId, role });
      return participant;
    },
    markReconnecting(rawParticipantId: unknown): RoomParticipant {
      assertOpen();
      const participantId = parseParticipantId(rawParticipantId);
      const participant = requireActiveParticipant(participantId);
      const updated: RoomParticipant = Object.freeze({ ...participant, lifecycle: "reconnecting", updatedAtMs: clock.now() });
      participants.set(participantId, updated);
      emit({ type: "participant_reconnecting", participantId });
      return updated;
    },
    reconnect(rawParticipantId: unknown): RoomParticipant {
      assertOpen();
      const participantId = parseParticipantId(rawParticipantId);
      const participant = requireParticipant(participantId);
      if (participant.lifecycle !== "reconnecting") throw new RoomTransportError("participant_not_active");
      const updated: RoomParticipant = Object.freeze({ ...participant, lifecycle: "active", updatedAtMs: clock.now() });
      participants.set(participantId, updated);
      emit({ type: "participant_reconnected", participantId });
      return updated;
    },
    leave(rawParticipantId: unknown, rawReason: unknown): void {
      assertOpen();
      const participantId = parseParticipantId(rawParticipantId);
      const reason = parseLeaveReason(rawReason);
      const participant = requireParticipant(participantId);
      if (participant.lifecycle === "left" || participant.lifecycle === "removed") throw new RoomTransportError("participant_not_active");
      const lifecycle: RoomParticipantLifecycle = reason === "removed" ? "removed" : "left";
      participants.set(participantId, Object.freeze({ ...participant, lifecycle, updatedAtMs: clock.now() }));
      for (const track of [...tracks.values()]) {
        if (track.participantId !== participantId) continue;
        tracks.delete(track.trackId);
        emit({ type: "track_unpublished", trackId: track.trackId, reason: "participant_left" });
      }
      emit({ type: "participant_left", participantId, reason });
    },
    publish(rawInput: { readonly participantId: unknown; readonly kind: unknown; readonly payloadReference: unknown }): RoomPublishedTrack {
      assertOpen();
      const participantId = parseParticipantId(rawInput?.participantId);
      const kind = parseTrackKind(rawInput?.kind);
      const payloadReference = parseReference(rawInput?.payloadReference);
      requireActiveParticipant(participantId);
      if (tracks.size >= MAX_TRACKS) throw new RoomTransportError("capacity_exceeded");
      trackCounter += 1;
      const trackId = `${roomReference}:track:${trackCounter}`;
      const track: RoomPublishedTrack = Object.freeze({ trackId, participantId, kind, payloadReference, publishedAtMs: clock.now() });
      tracks.set(trackId, track);
      emit({ type: "track_published", trackId, participantId, kind });
      return track;
    },
    unpublish(rawTrackId: unknown): void {
      assertOpen();
      const trackId = parseTrackReference(rawTrackId);
      if (!tracks.has(trackId)) throw new RoomTransportError("unknown_track");
      tracks.delete(trackId);
      emit({ type: "track_unpublished", trackId, reason: "explicit" });
    },
    subscribe(rawParticipantId: unknown, rawTrackId: unknown): RoomPublishedTrack {
      assertOpen();
      const participantId = parseParticipantId(rawParticipantId);
      const trackId = parseTrackReference(rawTrackId);
      requireActiveParticipant(participantId);
      const track = tracks.get(trackId);
      if (track === undefined) throw new RoomTransportError("unknown_track");
      return track;
    },
    listParticipants(): readonly RoomParticipant[] {
      return Object.freeze([...participants.values()]);
    },
    listTracks(): readonly RoomPublishedTrack[] {
      return Object.freeze([...tracks.values()]);
    },
    async disconnect(rawReason: unknown): Promise<void> {
      if (closed) return;
      const reason = rawReason === undefined ? "graceful_shutdown" : parseCloseReason(rawReason);
      closed = true;
      for (const participant of participants.values()) {
        if (participant.lifecycle === "left" || participant.lifecycle === "removed") continue;
        participants.set(participant.participantId, Object.freeze({ ...participant, lifecycle: "removed", updatedAtMs: clock.now() }));
      }
      tracks.clear();
      emit({ type: "room_closed", reason });
      await input.channelPort.closeConnection(channelConnection, input.control);
    },
    events(): readonly RoomTransportEvent[] {
      return Object.freeze([...events]);
    },
    isClosed(): boolean {
      return closed;
    },
  });
  return transport;
}

function parseRoomReference(value: unknown): string {
  if (typeof value !== "string" || !REFERENCE_PATTERN.test(value)) throw new RoomTransportError("invalid_input");
  return value;
}

function parseParticipantId(value: unknown): string {
  if (typeof value !== "string" || !PARTICIPANT_ID_PATTERN.test(value)) throw new RoomTransportError("invalid_input");
  return value;
}

function parseRole(value: unknown): RoomParticipantRole {
  if (typeof value !== "string" || !(ROLES as readonly string[]).includes(value)) throw new RoomTransportError("invalid_input");
  return value as RoomParticipantRole;
}

function parseTrackKind(value: unknown): RoomTrackKind {
  if (typeof value !== "string" || !(TRACK_KINDS as readonly string[]).includes(value)) throw new RoomTransportError("invalid_input");
  return value as RoomTrackKind;
}

function parseLeaveReason(value: unknown): RoomLeaveReason {
  if (value === undefined) return "graceful";
  if (typeof value !== "string" || !(LEAVE_REASONS as readonly string[]).includes(value)) throw new RoomTransportError("invalid_input");
  return value as RoomLeaveReason;
}

function parseReference(value: unknown): string {
  if (typeof value !== "string" || !REFERENCE_PATTERN.test(value)) throw new RoomTransportError("invalid_input");
  return value;
}

function parseTrackReference(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 200) throw new RoomTransportError("invalid_input");
  return value;
}

function parseCloseReason(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 200) throw new RoomTransportError("invalid_input");
  return value;
}
