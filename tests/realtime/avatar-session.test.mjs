import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import test from "node:test";

const root = fileURLToPath(new URL("../..", import.meta.url));
const provider = await import(pathToFileURL(join(root, "packages/provider-contracts/dist/index.js")).href);
const fakes = await import(pathToFileURL(join(root, "packages/provider-fakes/dist/index.js")).href);
const avatarGateway = await import(pathToFileURL(join(root, "packages/avatar-gateway/dist/index.js")).href);

async function flushMicrotasks(turns = 4) {
  for (let turn = 0; turn < turns; turn += 1) await Promise.resolve();
}

function registryFor(seed, plans = []) {
  const clock = fakes.createDeterministicFakeClock(0);
  const bundle = fakes.createDeterministicProviderFakes({ schema_version: "2.0.0", seed, plans }, clock);
  return { registry: provider.createProviderRegistry(bundle.entries, bundle.ports), clock };
}

test("avatar session: a healthy warm-up followed by render delivers the segment", async () => {
  const { registry, clock } = registryFor("m2-avatar-happy-seed");
  const avatarPort = registry.resolve("fake_avatar", "avatar");
  const session = avatarGateway.createAvatarSession(avatarPort);

  const warmUpPromise = session.warmUp(registry.createControl("fake_avatar", "avatar"));
  await clock.runAll();
  const warmUp = await warmUpPromise;
  assert.equal(warmUp.ready, true);
  assert.equal(session.isDisabled(), false);

  const renderPromise = session.renderSegment(
    {
      avatarReference: provider.createProviderReference("ref_avatar00000000001"),
      audioReference: provider.createProviderReference("ref_audio000000000001"),
      generationId: 1,
    },
    (generationId) => generationId === 1,
    registry.createControl("fake_avatar", "avatar"),
  );
  await clock.runAll();
  const outcome = await renderPromise;
  assert.equal(outcome.status, "rendered");
  assert.ok(outcome.mediaReference.startsWith("ref_"));
});

test("avatar session: a render failure degrades to voice-only and disables the session, without throwing", async () => {
  const { registry, clock } = registryFor("m2-avatar-failure-seed", [
    { operation: "avatar.render", failure_code: "provider_internal" },
  ]);
  const avatarPort = registry.resolve("fake_avatar", "avatar");
  const session = avatarGateway.createAvatarSession(avatarPort);

  const renderPromise = session.renderSegment(
    {
      avatarReference: provider.createProviderReference("ref_avatar00000000001"),
      audioReference: provider.createProviderReference("ref_audio000000000001"),
      generationId: 1,
    },
    () => true,
    registry.createControl("fake_avatar", "avatar"),
  );
  await clock.runAll();
  const outcome = await renderPromise;
  assert.equal(outcome.status, "degraded_to_voice_only");
  assert.equal(outcome.mediaReference, null);
  assert.equal(session.isDisabled(), true, "the session disables itself instead of retrying blindly");

  // A second attempt after disablement never touches the provider again this session.
  const secondPromise = session.renderSegment(
    {
      avatarReference: provider.createProviderReference("ref_avatar00000000001"),
      audioReference: provider.createProviderReference("ref_audio000000000001"),
      generationId: 2,
    },
    () => true,
    registry.createControl("fake_avatar", "avatar"),
  );
  await clock.runAll();
  const second = await secondPromise;
  assert.equal(second.status, "disabled");
});

test("avatar session: warm-up timeout disables the session before any render is attempted", async () => {
  const { registry, clock } = registryFor("m2-avatar-warmup-timeout-seed", [
    { operation: "avatar.health", delay_ms: 30_000 },
  ]);
  const avatarPort = registry.resolve("fake_avatar", "avatar");
  const session = avatarGateway.createAvatarSession(avatarPort);

  const warmUpPromise = session.warmUp(registry.createControl("fake_avatar", "avatar"));
  await flushMicrotasks();
  await clock.runAll();
  await flushMicrotasks();
  const warmUp = await warmUpPromise;
  assert.equal(warmUp.ready, false);
  assert.equal(session.isDisabled(), true);

  const renderPromise = session.renderSegment(
    {
      avatarReference: provider.createProviderReference("ref_avatar00000000001"),
      audioReference: provider.createProviderReference("ref_audio000000000001"),
      generationId: 1,
    },
    () => true,
    registry.createControl("fake_avatar", "avatar"),
  );
  await clock.runAll();
  const outcome = await renderPromise;
  assert.equal(outcome.status, "disabled", "a session disabled by warm-up timeout never attempts to render");
});

test("avatar session: a segment for a cancelled generation is discarded, never delivered as a late lip-sync frame", async () => {
  const { registry, clock } = registryFor("m2-avatar-cancel-seed");
  const avatarPort = registry.resolve("fake_avatar", "avatar");
  const session = avatarGateway.createAvatarSession(avatarPort);

  let activeGenerationId = 1;
  const renderPromise = session.renderSegment(
    {
      avatarReference: provider.createProviderReference("ref_avatar00000000001"),
      audioReference: provider.createProviderReference("ref_audio000000000001"),
      generationId: 1,
    },
    (generationId) => generationId === activeGenerationId,
    registry.createControl("fake_avatar", "avatar"),
  );
  // Barge-in cancels generation 1 and starts generation 2 while the provider is still rendering.
  activeGenerationId = 2;
  await clock.runAll();
  const outcome = await renderPromise;
  assert.equal(outcome.status, "discarded_late");
  assert.equal(outcome.mediaReference, null);
  assert.equal(session.isDisabled(), false, "a discarded late frame is not a provider failure");
});
