import type { ChannelPort, MeetingPort, ProviderRegistry, TelephonyPort } from "@axtro/provider-contracts";

/** Composition boundaries only. No meeting or telephony provider is connected in M0. */
export function resolveChannelPort(registry: ProviderRegistry, providerId: unknown): ChannelPort {
  return registry.resolve(providerId, "channel");
}

export function resolveMeetingPort(registry: ProviderRegistry, providerId: unknown): MeetingPort {
  return registry.resolve(providerId, "meeting");
}

export function resolveTelephonyPort(registry: ProviderRegistry, providerId: unknown): TelephonyPort {
  return registry.resolve(providerId, "telephony");
}

export type { ChannelPort, MeetingPort, TelephonyPort, MeetingJoinRequest, TelephonyConnectRequest } from "@axtro/provider-contracts";

export {
  createLocalRoomTransport,
  RoomTransportError,
  type CreateLocalRoomTransportInput,
  type RoomLeaveReason,
  type RoomParticipant,
  type RoomParticipantLifecycle,
  type RoomParticipantRole,
  type RoomPublishedTrack,
  type RoomTrackKind,
  type RoomTransport,
  type RoomTransportClock,
  type RoomTransportErrorCode,
  type RoomTransportEvent,
} from "./room-transport.js";
