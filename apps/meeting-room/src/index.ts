import { createHash } from "node:crypto";

import { createLocalRoomTransport, type RoomTransport } from "@axtro/meeting-gateway";
import { createProviderReference, createProviderRegistry, type ProviderRegistry } from "@axtro/provider-contracts";
import { createDeterministicFakeClock, createDeterministicProviderFakes, type DeterministicFakeClock, type FakeProviderJournal } from "@axtro/provider-fakes";

export interface FakeMeetingRoomRuntime {
  readonly registry: ProviderRegistry;
  readonly transport: RoomTransport;
  readonly clock: DeterministicFakeClock;
  readonly journal: FakeProviderJournal;
}

export interface CreateFakeMeetingRoomRuntimeInput {
  readonly roomReference: string;
  readonly seed: string;
  readonly clockStartMs?: number;
}

const ROOM_REFERENCE_PATTERN = /^[a-z0-9][a-z0-9_.:-]{0,127}$/;

/**
 * Bootstraps a single fake meeting room end-to-end: provider registry, one
 * deterministic ChannelPort connection, and the normalized RoomTransport on
 * top of it. This is the only place `@axtro/provider-fakes` is composed with
 * `@axtro/meeting-gateway` for M2-01 — everything downstream (turn coordinator,
 * behavior/scene directors) depends on `RoomTransport`, never on this wiring.
 */
export async function createFakeMeetingRoomRuntime(input: CreateFakeMeetingRoomRuntimeInput): Promise<FakeMeetingRoomRuntime> {
  const roomReference = parseRoomReference(input.roomReference);
  const clock = createDeterministicFakeClock(input.clockStartMs ?? 0);
  const bundle = createDeterministicProviderFakes({ schema_version: "2.0.0", seed: input.seed }, clock);
  const registry = createProviderRegistry(bundle.entries, bundle.ports);
  const channelPort = registry.resolve("fake_channel", "channel");
  const control = registry.createControl("fake_channel", "channel");
  const transportPromise = createLocalRoomTransport({
    channelPort,
    channelOpenRequest: { channelReference: createProviderReference(deterministicChannelReference(roomReference)) },
    control,
    roomReference,
  });
  await clock.runAll();
  const transport = await transportPromise;
  return Object.freeze({ registry, transport, clock, journal: bundle.journal });
}

function parseRoomReference(value: unknown): string {
  if (typeof value !== "string" || !ROOM_REFERENCE_PATTERN.test(value)) throw new Error("invalid room reference");
  return value;
}

function deterministicChannelReference(roomReference: string): string {
  return `ref_${createHash("sha256").update(roomReference, "utf8").digest("hex").slice(0, 40)}`;
}
