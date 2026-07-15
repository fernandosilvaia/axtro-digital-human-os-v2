import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import test from "node:test";

const root = fileURLToPath(new URL("../..", import.meta.url));
const provider = await import(pathToFileURL(join(root, "packages/provider-contracts/dist/index.js")).href);
const fakes = await import(pathToFileURL(join(root, "packages/provider-fakes/dist/index.js")).href);
const modelGateway = await import(pathToFileURL(join(root, "packages/model-gateway/dist/index.js")).href);

function registryFor(seed) {
  const clock = fakes.createDeterministicFakeClock(0);
  const bundle = fakes.createDeterministicProviderFakes({ schema_version: "2.0.0", seed }, clock);
  return { registry: provider.createProviderRegistry(bundle.entries, bundle.ports), clock };
}

async function withControl(registry, portKind, providerId, run) {
  const control = registry.createControl(providerId, portKind);
  return run(control);
}

test("modular path: STT -> LLM -> TTS runs in order and reports per-component timing", async () => {
  const { registry, clock } = registryFor("m2-modular-seed");
  const stt = registry.resolve("fake_stt", "stt");
  const tts = registry.resolve("fake_tts", "tts");
  const llm = modelGateway.createDeterministicTextGenerationFake("m2-llm-seed");
  const control = registry.createControl("fake_stt", "stt");

  let tick = 0;
  const clockStub = { now: () => (tick += 10) };
  const resultPromise = modelGateway.runModularConversationPath({
    stt,
    llm,
    tts,
    audioReference: provider.createProviderReference("ref_audio000000000001"),
    voiceReference: provider.createProviderReference("ref_voice000000000001"),
    language: "pt-BR",
    exactCapture: false,
    control,
    clock: clockStub,
  });
  await clock.runAll();
  const result = await resultPromise;

  assert.ok(result.transcriptReference.startsWith("ref_"));
  assert.ok(result.responseTextReference.startsWith("ref_"));
  assert.ok(result.audioReference.startsWith("ref_"));
  assert.ok(result.timing.sttCompletedAtMs >= result.timing.sttStartedAtMs);
  assert.ok(result.timing.llmCompletedAtMs >= result.timing.sttCompletedAtMs);
  assert.ok(result.timing.ttsCompletedAtMs >= result.timing.llmCompletedAtMs);
});

test("modular path: exact-capture mode produces a distinct deterministic reply from paraphrase mode", async () => {
  const llm = modelGateway.createDeterministicTextGenerationFake("m2-exact-capture-seed");
  const transcriptReference = provider.createProviderReference("ref_transcript0000000001");
  const noSignalControl = { timeoutMs: 5000, deadlineAt: Date.now() + 5000, signal: new AbortController().signal };

  const exact = await llm.generate({ transcriptReference, exactCapture: true }, noSignalControl);
  const paraphrase = await llm.generate({ transcriptReference, exactCapture: false }, noSignalControl);
  assert.notEqual(exact.responseTextReference, paraphrase.responseTextReference);

  const exactAgain = await llm.generate({ transcriptReference, exactCapture: true }, noSignalControl);
  assert.equal(exact.responseTextReference, exactAgain.responseTextReference, "same input is deterministic");
});

test("modular path: cancellation propagates and rejects the pipeline", async () => {
  const { registry, clock } = registryFor("m2-cancel-seed");
  const stt = registry.resolve("fake_stt", "stt");
  const tts = registry.resolve("fake_tts", "tts");
  const llm = modelGateway.createDeterministicTextGenerationFake("m2-cancel-llm-seed");
  const controller = new AbortController();
  const control = registry.createControl("fake_stt", "stt", { signal: controller.signal });

  const resultPromise = modelGateway.runModularConversationPath({
    stt,
    llm,
    tts,
    audioReference: provider.createProviderReference("ref_audio000000000001"),
    voiceReference: provider.createProviderReference("ref_voice000000000001"),
    language: "pt-BR",
    exactCapture: false,
    control,
  });
  controller.abort("cancelled");
  await clock.runAll();
  await assert.rejects(resultPromise);
});

test("S2S router: feature flag off never attempts a provider session and stays modular", async () => {
  let attempted = false;
  const result = await modelGateway.selectConversationPathMode({ s2sEnabled: false }, async () => {
    attempted = true;
  });
  assert.equal(result.mode, "modular");
  assert.equal(result.fallbackFromS2S, false);
  assert.equal(attempted, false);
});

test("S2S router: enabled and healthy provider selects s2s", async () => {
  const result = await modelGateway.selectConversationPathMode({ s2sEnabled: true }, async () => "session-opened");
  assert.equal(result.mode, "s2s");
  assert.equal(result.fallbackFromS2S, false);
});

test("S2S router: a failed session open falls back to modular instead of blocking the call", async () => {
  const result = await modelGateway.selectConversationPathMode({ s2sEnabled: true }, async () => {
    throw new Error("provider_unavailable");
  });
  assert.equal(result.mode, "modular");
  assert.equal(result.fallbackFromS2S, true);
});

test("S2S session: opens in s2s mode and renews ahead of provider-declared expiry", async () => {
  const { registry, clock } = registryFor("m2-s2s-session-seed");
  const realtimeModel = registry.resolve("fake_realtime_model", "realtime_model");
  const control = registry.createControl("fake_realtime_model", "realtime_model");
  const sessionReference = provider.createProviderReference("ref_session00000000001");

  const sessionPromise = modelGateway.openS2SSession(realtimeModel, sessionReference, control);
  await clock.runAll();
  const session = await sessionPromise;
  assert.ok(session.providerSessionReference.startsWith("ref_"));
  assert.equal(session.expiresAt, "2026-07-14T01:00:00.000Z");

  const nearExpiryMs = Date.parse(session.expiresAt) - 60_000;
  const renewPromise = modelGateway.renewS2SSessionIfNeeded({
    realtimeModel,
    session,
    sessionReference,
    control: registry.createControl("fake_realtime_model", "realtime_model"),
    nowMs: nearExpiryMs,
    renewBeforeExpiryMs: 120_000,
  });
  await clock.runAll();
  const renewal = await renewPromise;
  assert.equal(renewal.renewed, true);
  assert.notEqual(renewal.session.providerSessionReference, session.providerSessionReference);

  const noRenewal = await modelGateway.renewS2SSessionIfNeeded({
    realtimeModel,
    session: renewal.session,
    sessionReference,
    control: registry.createControl("fake_realtime_model", "realtime_model"),
    nowMs: Date.parse(renewal.session.expiresAt) - 3_600_000,
    renewBeforeExpiryMs: 120_000,
  });
  assert.equal(noRenewal.renewed, false);
  assert.equal(noRenewal.session.providerSessionReference, renewal.session.providerSessionReference);
});
