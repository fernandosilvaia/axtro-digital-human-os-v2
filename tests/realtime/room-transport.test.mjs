import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import test from "node:test";

const root = fileURLToPath(new URL("../..", import.meta.url));
const provider = await import(pathToFileURL(join(root, "packages/provider-contracts/dist/index.js")).href);
const fakes = await import(pathToFileURL(join(root, "packages/provider-fakes/dist/index.js")).href);
const meeting = await import(pathToFileURL(join(root, "packages/meeting-gateway/dist/index.js")).href);

function manualClock(startMs = 0) {
  let value = startMs;
  return { now: () => value, advance: (deltaMs) => { value += deltaMs; } };
}

async function createTransport(roomReference = "room_alpha") {
  const clock = fakes.createDeterministicFakeClock(0);
  const bundle = fakes.createDeterministicProviderFakes({ schema_version: "2.0.0", seed: "m2-room-transport-seed" }, clock);
  const registry = provider.createProviderRegistry(bundle.entries, bundle.ports);
  const channelPort = registry.resolve("fake_channel", "channel");
  const control = registry.createControl("fake_channel", "channel");
  void clock.runAll();
  const transportPromise = meeting.createLocalRoomTransport({
    channelPort,
    channelOpenRequest: { channelReference: provider.createProviderReference("ref_room00000000000001") },
    control,
    roomReference,
    clock: manualClock(0),
  });
  await clock.runAll();
  return transportPromise;
}

test("room transport: join, publish, subscribe and disconnect are normalized and swappable", async () => {
  const transport = await createTransport();
  const presenter = transport.join({ participantId: "presenter-1", role: "presenter" });
  assert.equal(presenter.lifecycle, "active");
  const attendee = transport.join({ participantId: "attendee-1", role: "attendee" });
  assert.equal(attendee.lifecycle, "active");

  const track = transport.publish({ participantId: "presenter-1", kind: "audio", payloadReference: "audio-ref-1" });
  assert.equal(track.participantId, "presenter-1");
  assert.equal(track.kind, "audio");

  const subscribed = transport.subscribe("attendee-1", track.trackId);
  assert.equal(subscribed.trackId, track.trackId);

  assert.deepEqual(
    transport.listParticipants().map((participant) => participant.participantId).sort(),
    ["attendee-1", "presenter-1"],
  );

  await transport.disconnect("scenario_complete");
  assert.equal(transport.isClosed(), true);
  assert.equal(transport.listTracks().length, 0);
  for (const participant of transport.listParticipants()) assert.equal(participant.lifecycle, "removed");

  const eventTypes = transport.events().map((event) => event.type);
  assert.deepEqual(eventTypes, [
    "participant_joined",
    "participant_joined",
    "track_published",
    "room_closed",
  ]);
});

test("room transport: participant lifecycle rejects duplicate join and inactive publish", async () => {
  const transport = await createTransport();
  transport.join({ participantId: "presenter-1", role: "presenter" });
  assert.throws(() => transport.join({ participantId: "presenter-1", role: "presenter" }), (error) => error.code === "already_joined");

  transport.leave("presenter-1", "graceful");
  assert.throws(
    () => transport.publish({ participantId: "presenter-1", kind: "audio", payloadReference: "audio-ref-1" }),
    (error) => error.code === "participant_not_active",
  );
  assert.throws(() => transport.leave("presenter-1"), (error) => error.code === "participant_not_active");

  await transport.disconnect();
});

test("room transport: reconnect preserves participant identity across a network drop", async () => {
  const transport = await createTransport();
  transport.join({ participantId: "attendee-1", role: "attendee" });
  const track = transport.publish({ participantId: "attendee-1", kind: "video", payloadReference: "video-ref-1" });

  const reconnecting = transport.markReconnecting("attendee-1");
  assert.equal(reconnecting.lifecycle, "reconnecting");
  assert.throws(
    () => transport.publish({ participantId: "attendee-1", kind: "audio", payloadReference: "audio-ref-2" }),
    (error) => error.code === "participant_not_active",
  );

  const reconnected = transport.reconnect("attendee-1");
  assert.equal(reconnected.lifecycle, "active");
  assert.equal(reconnected.joinedAtMs, reconnecting.joinedAtMs, "identity and join time survive reconnect");

  const stillSubscribable = transport.subscribe("attendee-1", track.trackId);
  assert.equal(stillSubscribable.trackId, track.trackId);

  await transport.disconnect();
});

test("room transport: unknown participant and unknown track are rejected", async () => {
  const transport = await createTransport();
  assert.throws(() => transport.leave("ghost"), (error) => error.code === "unknown_participant");
  transport.join({ participantId: "presenter-1", role: "presenter" });
  assert.throws(() => transport.subscribe("presenter-1", "nonexistent-track"), (error) => error.code === "unknown_track");
  assert.throws(() => transport.unpublish("nonexistent-track"), (error) => error.code === "unknown_track");
  await transport.disconnect();
});

test("room transport: closed room rejects further mutation and disconnect is idempotent", async () => {
  const transport = await createTransport();
  transport.join({ participantId: "presenter-1", role: "presenter" });
  await transport.disconnect("done");
  await transport.disconnect("done-again");
  assert.throws(() => transport.join({ participantId: "attendee-1", role: "attendee" }), (error) => error.code === "room_closed");
  const closedEvents = transport.events().filter((event) => event.type === "room_closed");
  assert.equal(closedEvents.length, 1, "disconnect is idempotent and emits room_closed once");
});

test("room transport: two independently created rooms never share state", async () => {
  const transportA = await createTransport("room_a");
  const transportB = await createTransport("room_b");
  transportA.join({ participantId: "presenter-1", role: "presenter" });
  assert.equal(transportB.listParticipants().length, 0);
  await transportA.disconnect();
  await transportB.disconnect();
});
