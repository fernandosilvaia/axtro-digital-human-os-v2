import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../..", import.meta.url));
const provider = await import(pathToFileURL(join(root, "packages/provider-contracts/dist/index.js")).href);
const fakes = await import(pathToFileURL(join(root, "packages/provider-fakes/dist/index.js")).href);

const tenantAlpha = "018f1e2d-3c4b-7a01-8c9d-001122334455";
const tenantBeta = "018f1e2d-3c4b-7a02-8c9d-001122334456";
const references = Object.freeze({
  audio: provider.createProviderReference("ref_audio000000000001"),
  avatar: provider.createProviderReference("ref_avatar00000000001"),
  call: provider.createProviderReference("ref_call00000000000001"),
  channel: provider.createProviderReference("ref_channel00000000001"),
  content: provider.createProviderReference("ref_content00000000001"),
  meeting: provider.createProviderReference("ref_meeting00000000001"),
  model: provider.createProviderReference("ref_model0000000000001"),
  text: provider.createProviderReference("ref_text0000000000001"),
  voice: provider.createProviderReference("ref_voice000000000001"),
});

function createRegistry(bundle) {
  return provider.createProviderRegistry(bundle.entries, bundle.ports);
}

function ttsInput() {
  return { textReference: references.text, voiceReference: references.voice, language: "pt-BR" };
}

async function flushMicrotasks(turns = 4) {
  for (let turn = 0; turn < turns; turn += 1) await Promise.resolve();
}

async function settleWithClock(clock, work) {
  let settled = false;
  work.then(() => { settled = true; }, () => { settled = true; });
  for (let turn = 0; turn < 100 && !settled; turn += 1) {
    await clock.runAll();
    await flushMicrotasks();
  }
  assert.equal(settled, true, "manual fake clock did not settle the operation");
  return work;
}

function deterministicScenario(seed = "m012-seed-alpha") {
  return {
    schema_version: "2.0.0",
    seed,
    clock_start_ms: 100,
    plans: [
      {
        operation: "tts.synthesize",
        delay_ms: 12,
        partial_count: 2,
        partial_interval_ms: 4,
      },
    ],
  };
}

test("same serializable scenario and invocation sequence reproduce entries, refs, journal and replay descriptor", async () => {
  const execute = async (seed) => {
    const clock = fakes.createDeterministicFakeClock();
    const bundle = fakes.createDeterministicProviderFakes(deterministicScenario(seed), clock);
    const registry = createRegistry(bundle);
    const result = await settleWithClock(
      clock,
      registry.resolve("fake_tts", "tts").synthesize(ttsInput(), registry.createControl("fake_tts", "tts")),
    );
    return {
      entries: bundle.entries,
      result,
      journal: bundle.journal.snapshot(),
      replayDescriptor: bundle.replayDescriptor,
    };
  };

  const first = await execute("m012-seed-alpha");
  const second = await execute("m012-seed-alpha");
  const differentSeed = await execute("m012-seed-bravo");

  assert.deepEqual(first, second);
  assert.notEqual(first.result.mediaReference, differentSeed.result.mediaReference);
  assert.equal(JSON.stringify(first.journal).includes("m012-seed-alpha"), false);
  assert.equal(Object.isFrozen(first.entries), true);
  assert.equal(Object.isFrozen(first.replayDescriptor), true);
  assert.equal(first.replayDescriptor.schema_version, "2.0.0");
});

test("configured partial markers are monotonic, trace-safe and complete before the deterministic media reference", async () => {
  const clock = fakes.createDeterministicFakeClock();
  const bundle = fakes.createDeterministicProviderFakes(deterministicScenario(), clock);
  const registry = createRegistry(bundle);
  const output = await settleWithClock(
    clock,
    registry.resolve("fake_tts", "tts").synthesize(ttsInput(), registry.createControl("fake_tts", "tts")),
  );
  const journal = bundle.journal.snapshot();

  assert.match(output.mediaReference, /^ref_[a-z0-9]{12,64}$/);
  assert.deepEqual(journal.map((entry) => entry.phase), ["started", "partial", "partial", "completed"]);
  assert.deepEqual(journal.map((entry) => entry.simulated_at_ms), [100, 104, 108, 112]);
  assert.deepEqual(journal.map((entry) => entry.sequence), [1, 2, 3, 4]);
  for (const entry of journal) {
    assert.deepEqual(Object.keys(entry).sort(), ["failure_code", "invocation", "operation", "phase", "port_kind", "schema_version", "sequence", "simulated_at_ms"]);
    assert.equal(JSON.stringify(entry).includes("ref_"), false);
    assert.equal(JSON.stringify(entry).includes("m012-seed"), false);
  }
});

test("failure injection remains closed, reproducible and redacted", async () => {
  const scenario = {
    schema_version: "2.0.0",
    seed: "m012-seed-failure",
    plans: [{ operation: "stt.transcribe", delay_ms: 0, failure_code: "capacity" }],
  };
  const bundle = fakes.createDeterministicProviderFakes(scenario);
  const registry = createRegistry(bundle);

  await assert.rejects(
    registry.resolve("fake_stt", "stt").transcribe(
      { audioReference: references.audio, language: "en-US" },
      registry.createControl("fake_stt", "stt"),
    ),
    (error) => error instanceof provider.ProviderOperationError
      && error.failure.code === "capacity"
      && !error.message.includes("m012-seed-failure"),
  );
  assert.deepEqual(bundle.journal.snapshot().map((entry) => [entry.phase, entry.failure_code]), [
    ["started", null],
    ["failed", "capacity"],
  ]);

  const clock = fakes.createDeterministicFakeClock();
  const afterPartialBundle = fakes.createDeterministicProviderFakes({
    schema_version: "2.0.0",
    seed: "m012-seed-after-partial",
    plans: [{
      operation: "tts.synthesize",
      delay_ms: 12,
      partial_count: 2,
      partial_interval_ms: 4,
      failure_code: "provider_internal",
      failure_phase: "after_partials",
    }],
  }, clock);
  const afterPartialRegistry = createRegistry(afterPartialBundle);
  await assert.rejects(
    settleWithClock(
      clock,
      afterPartialRegistry.resolve("fake_tts", "tts").synthesize(ttsInput(), afterPartialRegistry.createControl("fake_tts", "tts")),
    ),
    (error) => error instanceof provider.ProviderOperationError && error.failure.code === "provider_internal",
  );
  assert.deepEqual(afterPartialBundle.journal.snapshot().map((entry) => entry.phase), ["started", "partial", "partial", "failed"]);
});

test("cancellation and deadline timeout fence late fake outputs without affecting an independent operation", async () => {
  const clock = fakes.createDeterministicFakeClock();
  const cancelledBundle = fakes.createDeterministicProviderFakes({
    schema_version: "2.0.0",
    seed: "m012-seed-cancel",
    plans: [{ operation: "tts.synthesize", delay_ms: 100, partial_count: 1, partial_interval_ms: 10 }],
  }, clock);
  const cancelledRegistry = createRegistry(cancelledBundle);
  const aborter = new AbortController();
  const cancelled = cancelledRegistry.resolve("fake_tts", "tts").synthesize(
    ttsInput(),
    cancelledRegistry.createControl("fake_tts", "tts", { signal: aborter.signal }),
  );
  await flushMicrotasks();
  clock.advanceBy(10);
  await flushMicrotasks();
  aborter.abort();
  await assert.rejects(
    cancelled,
    (error) => error instanceof provider.ProviderOperationError && error.failure.code === "cancelled",
  );
  await clock.runAll();
  await flushMicrotasks();
  assert.deepEqual(cancelledBundle.journal.snapshot().map((entry) => entry.phase), ["started", "partial", "cancelled"]);

  const raceClock = fakes.createDeterministicFakeClock();
  const raceBundle = fakes.createDeterministicProviderFakes({
    schema_version: "2.0.0",
    seed: "m012-seed-cancel-race",
    plans: [{ operation: "tts.synthesize", delay_ms: 10 }],
  }, raceClock);
  const raceRegistry = createRegistry(raceBundle);
  const raceAborter = new AbortController();
  const raced = raceRegistry.resolve("fake_tts", "tts").synthesize(
    ttsInput(),
    raceRegistry.createControl("fake_tts", "tts", { signal: raceAborter.signal }),
  );
  await flushMicrotasks();
  raceClock.advanceBy(10);
  raceAborter.abort();
  await assert.rejects(
    raced,
    (error) => error instanceof provider.ProviderOperationError && error.failure.code === "cancelled",
  );
  await flushMicrotasks();
  assert.deepEqual(raceBundle.journal.snapshot().map((entry) => entry.phase), ["started", "cancelled"]);

  const deadlineRaceClock = fakes.createDeterministicFakeClock();
  const deadlineRaceBundle = fakes.createDeterministicProviderFakes({
    schema_version: "2.0.0",
    seed: "m012-seed-deadline-race",
    plans: [{ operation: "tts.synthesize", delay_ms: 8_000 }],
  }, deadlineRaceClock);
  const deadlineRaceRegistry = createRegistry(deadlineRaceBundle);
  const deadlineRaceAborter = new AbortController();
  const deadlineRace = deadlineRaceRegistry.resolve("fake_tts", "tts").synthesize(
    ttsInput(),
    provider.createProviderOperationControl({ timeoutMs: 5_000, signal: deadlineRaceAborter.signal }),
  );
  await flushMicrotasks();
  deadlineRaceClock.advanceBy(5_000);
  deadlineRaceAborter.abort();
  await assert.rejects(
    deadlineRace,
    (error) => error instanceof provider.ProviderOperationError && error.failure.code === "cancelled",
  );
  assert.deepEqual(deadlineRaceBundle.journal.snapshot().map((entry) => [entry.phase, entry.failure_code]), [
    ["started", null],
    ["cancelled", "cancelled"],
  ]);

  const timeoutClock = fakes.createDeterministicFakeClock();
  const timeoutBundle = fakes.createDeterministicProviderFakes({
    schema_version: "2.0.0",
    seed: "m012-seed-timeout",
    plans: [{ operation: "tts.synthesize", delay_ms: 8_000 }],
  }, timeoutClock);
  const timeoutRegistry = createRegistry(timeoutBundle);
  const independent = timeoutRegistry.resolve("fake_stt", "stt").transcribe(
    { audioReference: references.audio, language: "pt-BR" },
    timeoutRegistry.createControl("fake_stt", "stt"),
  );
  const timedOut = timeoutRegistry.resolve("fake_tts", "tts").synthesize(
    ttsInput(),
    provider.createProviderOperationControl({ timeoutMs: 5_000 }),
  );
  await flushMicrotasks();
  timeoutClock.advanceBy(5_000);
  await assert.rejects(
    timedOut,
    (error) => error instanceof provider.ProviderOperationError && error.failure.code === "timeout",
  );
  assert.match((await independent).outputReference, /^ref_/);
  await timeoutClock.runAll();
  await flushMicrotasks();
  const timeoutEvents = timeoutBundle.journal.snapshot().filter((entry) => entry.operation === "tts.synthesize");
  assert.deepEqual(timeoutEvents.map((entry) => entry.phase), ["started", "timed_out"]);
  assert.equal(timeoutEvents.at(-1)?.failure_code, "timeout");

  const shortDeadlineClock = fakes.createDeterministicFakeClock();
  const shortDeadlineBundle = fakes.createDeterministicProviderFakes({
    schema_version: "2.0.0",
    seed: "m012-seed-short-deadline",
    plans: [{ operation: "tts.synthesize", delay_ms: 8_000 }],
  }, shortDeadlineClock);
  const shortDeadlineRegistry = createRegistry(shortDeadlineBundle);
  const now = Date.now();
  const shortDeadlineControl = provider.createProviderOperationControl({
    timeoutMs: 120_000,
    deadlineAt: now + 5_000,
  });
  assert.equal(provider.getProviderOperationDeadlineBudget(shortDeadlineControl) > 0, true);
  const shortDeadline = shortDeadlineRegistry.resolve("fake_tts", "tts").synthesize(ttsInput(), shortDeadlineControl);
  await flushMicrotasks();
  shortDeadlineClock.advanceBy(5_000);
  await assert.rejects(
    shortDeadline,
    (error) => error instanceof provider.ProviderOperationError && error.failure.code === "timeout",
  );
  assert.deepEqual(shortDeadlineBundle.journal.snapshot().map((entry) => entry.phase), ["started", "timed_out"]);
});

test("scenario configuration is strict, immutable and cannot configure a tool call or untrusted scheduler", () => {
  const valid = deterministicScenario();
  const accessor = { schema_version: "2.0.0", seed: "m012-seed-accessor" };
  Object.defineProperty(accessor, "plans", { enumerable: true, get: () => [] });
  const invalid = [
    {},
    { seed: "short" },
    { seed: "m012-bearer-secret" },
    { seed: "a1234567-1234-7abc-8def-123456789abc" },
    { ...valid, endpoint: "https://provider.invalid" },
    { ...valid, tenant_id: tenantAlpha },
    { ...valid, plans: [{ operation: "tts.synthesize", callback: () => undefined }] },
    { ...valid, plans: [{ operation: "tts.synthesize", failure_code: "timeout" }] },
    { ...valid, plans: [{ operation: "tool.executeAuthorized" }] },
    accessor,
    Object.create(valid),
  ];
  for (const configuration of invalid) {
    assert.throws(() => fakes.createDeterministicProviderFakes(configuration), provider.ProviderContractError);
  }
  assert.throws(() => fakes.createDeterministicProviderFakes(valid, {}), provider.ProviderContractError);
  const bundle = fakes.createDeterministicProviderFakes(valid);
  assert.equal(Object.isFrozen(bundle), true);
  assert.equal(Object.isFrozen(bundle.replayDescriptor), true);
});

test("storage remains scoped and stateless while the ToolPort never runs a fake action", async () => {
  const clock = fakes.createDeterministicFakeClock();
  const bundle = fakes.createDeterministicProviderFakes({
    schema_version: "2.0.0",
    seed: "m012-seed-storage",
    plans: [{ operation: "storage.write", delay_ms: 100 }],
  }, clock);
  const registry = createRegistry(bundle);
  const authority = provider.createProviderStorageAuthority();
  const alphaScope = authority.createScope(tenantAlpha);
  const betaScope = authority.createScope(tenantBeta);
  const alphaReference = authority.issueReference(alphaScope);
  const storage = registry.resolve("fake_storage", "storage");
  const read = await storage.read(
    { storageScope: alphaScope, storageReference: alphaReference },
    registry.createControl("fake_storage", "storage"),
  );
  assert.match(read.outputReference, /^ref_/);
  const beforeCrossTenant = bundle.journal.snapshot().length;
  assert.throws(
    () => storage.read(
      { storageScope: betaScope, storageReference: alphaReference },
      registry.createControl("fake_storage", "storage"),
    ),
    (error) => error instanceof provider.ProviderContractError && error.code === "invalid_storage_reference",
  );
  assert.equal(bundle.journal.snapshot().length, beforeCrossTenant);

  const aborter = new AbortController();
  const write = storage.write({
    storageScope: alphaScope,
    storageReference: alphaReference,
    contentReference: references.text,
    dataClassification: "restricted",
  }, registry.createControl("fake_storage", "storage", { signal: aborter.signal }));
  await flushMicrotasks();
  aborter.abort();
  await assert.rejects(write, (error) => error instanceof provider.ProviderOperationError && error.failure.code === "cancelled");
  await clock.runAll();
  await flushMicrotasks();
  const writeEvents = bundle.journal.snapshot().filter((entry) => entry.operation === "storage.write");
  assert.deepEqual(writeEvents.map((entry) => entry.phase), ["started", "cancelled"]);
  assert.equal(JSON.stringify(bundle.journal.snapshot()).includes(tenantAlpha), false);
  assert.equal(JSON.stringify(bundle.journal.snapshot()).includes(tenantBeta), false);

  const tool = registry.resolve("fake_tool", "tool");
  await assert.rejects(
    tool.executeAuthorized({ forged: true }, registry.createControl("fake_tool", "tool")),
    (error) => error instanceof provider.ProviderContractError && error.code === "action_runtime_required",
  );
  assert.equal(bundle.journal.snapshot().some((entry) => entry.operation === "tool.executeAuthorized"), false);
  assert.equal(bundle.entries.length, 9);
  assert.equal(bundle.ports.length, 9);
});

test("a bootstrap-only raw fake port fails closed before journal output when its absolute deadline has expired", async () => {
  const bundle = fakes.createDeterministicProviderFakes({ schema_version: "2.0.0", seed: "m012-seed-raw-expired" });
  const rawTts = bundle.ports.find((port) => port.portKind === "tts");
  assert.notEqual(rawTts, undefined);
  const control = provider.createProviderOperationControl({ timeoutMs: 50 });
  await new Promise((resolve) => setTimeout(resolve, 60));
  await assert.rejects(
    rawTts.synthesize(ttsInput(), control),
    (error) => error instanceof provider.ProviderOperationError && error.failure.code === "timeout",
  );
  assert.deepEqual(bundle.journal.snapshot(), []);
});

test("the bundle executes every non-governed fake port locally without credentials or provider selection", async () => {
  const bundle = fakes.createDeterministicProviderFakes({ schema_version: "2.0.0", seed: "m012-seed-all-ports" });
  const registry = createRegistry(bundle);
  for (const entry of bundle.entries) {
    const providerId = entry.provider_capabilities[0].provider_id;
    const port = registry.resolve(providerId, entry.port_kind);
    assert.equal(port.providerMode, "fake");
    assert.equal((await port.health(registry.createControl(providerId, entry.port_kind))).status, "healthy");
    assert.equal((await port.estimateCost({ quantity: 1, unit: "request" }, registry.createControl(providerId, entry.port_kind))).quantity, 1);
  }

  const channel = registry.resolve("fake_channel", "channel");
  const channelConnection = await channel.open({ channelReference: references.channel }, registry.createControl("fake_channel", "channel"));
  await channel.closeConnection(channelConnection, registry.createControl("fake_channel", "channel"));
  const model = registry.resolve("fake_realtime_model", "realtime_model");
  const session = await model.openSession({ sessionReference: references.model, mode: "modular" }, registry.createControl("fake_realtime_model", "realtime_model"));
  await model.closeSession(session, registry.createControl("fake_realtime_model", "realtime_model"));
  assert.match((await registry.resolve("fake_stt", "stt").transcribe({ audioReference: references.audio, language: "pt-BR" }, registry.createControl("fake_stt", "stt"))).outputReference, /^ref_/);
  assert.match((await registry.resolve("fake_tts", "tts").synthesize(ttsInput(), registry.createControl("fake_tts", "tts"))).mediaReference, /^ref_/);
  assert.match((await registry.resolve("fake_avatar", "avatar").render({ avatarReference: references.avatar, audioReference: references.audio }, registry.createControl("fake_avatar", "avatar"))).mediaReference, /^ref_/);
  const meeting = registry.resolve("fake_meeting", "meeting");
  const meetingConnection = await meeting.join({ meetingReference: references.meeting }, registry.createControl("fake_meeting", "meeting"));
  await meeting.leave(meetingConnection, registry.createControl("fake_meeting", "meeting"));
  const telephony = registry.resolve("fake_telephony", "telephony");
  const callConnection = await telephony.connect({ callReference: references.call }, registry.createControl("fake_telephony", "telephony"));
  await telephony.disconnect(callConnection, registry.createControl("fake_telephony", "telephony"));
  const authority = provider.createProviderStorageAuthority();
  const scope = authority.createScope(tenantAlpha);
  const storageReference = authority.issueReference(scope);
  const storage = registry.resolve("fake_storage", "storage");
  await storage.read({ storageScope: scope, storageReference }, registry.createControl("fake_storage", "storage"));
  assert.equal(await storage.write({
    storageScope: scope,
    storageReference,
    contentReference: references.content,
    dataClassification: "restricted",
  }, registry.createControl("fake_storage", "storage")), storageReference);
});

test("provider fakes add no provider SDK, network, random or implicit clock dependency", () => {
  const manifest = JSON.parse(readFileSync(join(root, "packages/provider-fakes/package.json"), "utf8"));
  assert.deepEqual(manifest.dependencies, {
    "@axtro/contracts-ts": "workspace:*",
    "@axtro/provider-contracts": "workspace:*",
  });
  const source = ["index.ts", "scenario.ts"]
    .map((file) => readFileSync(join(root, "packages/provider-fakes/src", file), "utf8"))
    .join("\n");
  for (const token of ["Math.random", "Date.now", "fetch(", "openai", "livekit", "tavus", "telnyx", "recall", "heygen"]) {
    assert.equal(source.toLowerCase().includes(token.toLowerCase()), false);
  }
  const scenarioSchema = JSON.parse(readFileSync(join(root, "contracts/schemas/fake_provider_scenario.schema.json"), "utf8"));
  const journalSchema = JSON.parse(readFileSync(join(root, "contracts/schemas/fake_provider_journal_entry.schema.json"), "utf8"));
  assert.deepEqual(scenarioSchema.$defs.fake_provider_operation.enum, [...fakes.FAKE_PROVIDER_OPERATIONS]);
  assert.equal(
    journalSchema.properties.operation.$ref,
    "https://schemas.axtro.ai/v2/fake_provider_scenario.schema.json#/$defs/fake_provider_operation",
  );
});
