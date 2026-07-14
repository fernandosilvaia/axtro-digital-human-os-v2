import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../..", import.meta.url));
const provider = await import(pathToFileURL(join(root, "packages/provider-contracts/dist/index.js")).href);
const modelGateway = await import(pathToFileURL(join(root, "packages/model-gateway/dist/index.js")).href);
const voiceGateway = await import(pathToFileURL(join(root, "packages/voice-gateway/dist/index.js")).href);
const avatarGateway = await import(pathToFileURL(join(root, "packages/avatar-gateway/dist/index.js")).href);
const meetingGateway = await import(pathToFileURL(join(root, "packages/meeting-gateway/dist/index.js")).href);

const PORT_KINDS = ["channel", "realtime_model", "stt", "tts", "avatar", "meeting", "telephony", "tool", "storage"];
const evaluatedAt = "2026-07-14T20:00:00Z";
const tenantAlpha = "018f1e2d-3c4b-7a01-8c9d-001122334455";
const tenantBeta = "018f1e2d-3c4b-7a02-8c9d-001122334456";

function capability(portKind, providerId, overrides = {}) {
  return {
    schema_version: "2.0.0",
    provider_id: providerId,
    provider_type: portKind,
    capability: "deterministic_fake",
    version: "fake-v1",
    supported_regions: ["us-east"],
    languages: ["pt-BR", "en-US"],
    max_session_minutes: 60,
    supports_streaming: true,
    supports_barge_in: true,
    supports_data_residency: false,
    latency_class: "low",
    cost_model_ref: "spreadsheets/unit_economics_v2.xlsx",
    status: "candidate",
    evaluated_at: evaluatedAt,
    ...overrides,
  };
}

function entry(portKind, providerId, options = {}) {
  return {
    schema_version: "2.0.0",
    port_kind: portKind,
    provider_mode: "fake",
    provider_capabilities: options.capabilities ?? [capability(portKind, providerId)],
    default_timeout_ms: options.defaultTimeoutMs ?? 5000,
    supports_cancellation: options.supportsCancellation ?? true,
    health_status: options.healthStatus ?? "healthy",
    circuit_state: options.circuitState ?? "closed",
    fallback_provider_ids: options.fallbackProviderIds ?? [],
  };
}

function port(portKind, providerId, candidate, options = {}) {
  const base = {
    providerId,
    portKind,
    providerMode: "fake",
    capabilities: () => {
      if (options.capabilitiesError) throw options.capabilitiesError;
      return candidate.provider_capabilities;
    },
    health: async (control) => {
      options.onControl?.(control);
      return options.health ?? {
        status: "healthy",
        circuitState: "closed",
        checkedAt: evaluatedAt,
        latencyMs: 1,
        failure: null,
      };
    },
    estimateCost: async (input, control) => {
      options.onControl?.(control);
      return options.cost ?? { ...input, estimatedUsdMicros: 1 };
    },
    close: async (control) => {
      options.onControl?.(control);
      if (options.closeWork) return options.closeWork(control);
      if (options.closeError) throw options.closeError;
      return undefined;
    },
  };
  switch (portKind) {
    case "channel":
      return { ...base, open: async (_input, control) => {
        options.onControl?.(control);
        return { connectionReference: provider.createProviderReference("ref_connection0001"), state: "connected" };
      }, closeConnection: async () => undefined };
    case "realtime_model":
      return { ...base, openSession: async (_input, control) => {
        options.onControl?.(control);
        return { providerSessionReference: provider.createProviderReference("ref_session00000001"), expiresAt: "2026-07-14T21:00:00Z" };
      }, closeSession: async () => undefined };
    case "stt":
      return { ...base, transcribe: async (_input, control) => {
        options.onControl?.(control);
        return options.output ?? { outputReference: provider.createProviderReference("ref_output000000001"), dataClassification: "restricted" };
      } };
    case "tts":
      return { ...base, synthesize: async (_input, control) => {
        options.onControl?.(control);
        return options.output ?? { mediaReference: provider.createProviderReference("ref_media0000000001") };
      } };
    case "avatar":
      return { ...base, render: async (_input, control) => {
        options.onControl?.(control);
        return options.output ?? { mediaReference: provider.createProviderReference("ref_media0000000002") };
      } };
    case "meeting":
      return { ...base, join: async (_input, control) => {
        options.onControl?.(control);
        return { connectionReference: provider.createProviderReference("ref_connection0002"), lifecycle: "active" };
      }, leave: async () => undefined };
    case "telephony":
      return { ...base, connect: async (_input, control) => {
        options.onControl?.(control);
        return { connectionReference: provider.createProviderReference("ref_connection0003"), lifecycle: "active" };
      }, disconnect: async () => undefined };
    case "tool":
      return { ...base, executeAuthorized: async () => {
        options.toolCalls?.push("called");
        return { status: "succeeded" };
      } };
    case "storage":
      return { ...base, read: async (_input, control) => {
        options.onControl?.(control);
        options.storageReads?.push("read");
        return { outputReference: provider.createProviderReference("ref_output000000002"), dataClassification: "restricted" };
      }, write: async (input, control) => {
        options.onControl?.(control);
        return options.storageWriteResult ?? input.storageReference;
      } };
    default:
      throw new Error("unexpected port kind");
  }
}

function registryWithAllPorts() {
  const entries = PORT_KINDS.map((portKind) => entry(portKind, `fake_${portKind}`));
  const ports = entries.map((candidate) => port(candidate.port_kind, candidate.provider_capabilities[0].provider_id, candidate));
  return provider.createProviderRegistry(entries, ports);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

test("registry binds all nine fake-only ports immutably with explicit resolution", () => {
  const registry = registryWithAllPorts();

  assert.equal(registry.entries.length, PORT_KINDS.length);
  for (const portKind of PORT_KINDS) {
    const resolved = registry.resolve(`fake_${portKind}`, portKind);
    assert.equal(resolved.providerMode, "fake");
    assert.equal(resolved.portKind, portKind);
    assert.equal(resolved.capabilities().length, 1);
  }
  assert.equal(typeof registry.register, "undefined");
  assert.equal(typeof registry.selectDefault, "undefined");
  assert.equal(typeof registry.resolveFallback, "undefined");
  assert.equal(Object.isFrozen(registry.entries), true);
  assert.equal(Object.isFrozen(registry.entries[0].provider_capabilities), true);
  assert.throws(() => registry.resolve("fake_realtime_model", "avatar"), provider.ProviderContractError);
  assert.throws(() => registry.resolve("https://provider.invalid", "avatar"), provider.ProviderContractError);
});

test("every non-governed port method receives a normalized control and fixture-shaped input", async () => {
  const registry = registryWithAllPorts();
  const channel = registry.resolve("fake_channel", "channel");
  const channelConnection = await channel.open({ channelReference: provider.createProviderReference("ref_channel00000001") }, registry.createControl("fake_channel", "channel"));
  await channel.closeConnection(channelConnection, registry.createControl("fake_channel", "channel"));

  const model = registry.resolve("fake_realtime_model", "realtime_model");
  const modelSession = await model.openSession({ sessionReference: provider.createProviderReference("ref_modelsess000001"), mode: "modular" }, registry.createControl("fake_realtime_model", "realtime_model"));
  await model.closeSession(modelSession, registry.createControl("fake_realtime_model", "realtime_model"));

  const stt = registry.resolve("fake_stt", "stt");
  assert.equal((await stt.transcribe({ audioReference: provider.createProviderReference("ref_audio000000001"), language: "pt-BR" }, registry.createControl("fake_stt", "stt"))).dataClassification, "restricted");
  const tts = registry.resolve("fake_tts", "tts");
  assert.match((await tts.synthesize({ textReference: provider.createProviderReference("ref_text0000000001"), voiceReference: provider.createProviderReference("ref_voice000000001"), language: "en-US" }, registry.createControl("fake_tts", "tts"))).mediaReference, /^ref_/);
  const avatar = registry.resolve("fake_avatar", "avatar");
  assert.match((await avatar.render({ avatarReference: provider.createProviderReference("ref_avatar00000001"), audioReference: provider.createProviderReference("ref_audio000000002") }, registry.createControl("fake_avatar", "avatar"))).mediaReference, /^ref_/);

  const meeting = registry.resolve("fake_meeting", "meeting");
  const meetingConnection = await meeting.join({ meetingReference: provider.createProviderReference("ref_meeting0000001") }, registry.createControl("fake_meeting", "meeting"));
  await meeting.leave(meetingConnection, registry.createControl("fake_meeting", "meeting"));
  const telephony = registry.resolve("fake_telephony", "telephony");
  const callConnection = await telephony.connect({ callReference: provider.createProviderReference("ref_call0000000001") }, registry.createControl("fake_telephony", "telephony"));
  await telephony.disconnect(callConnection, registry.createControl("fake_telephony", "telephony"));

  const authority = provider.createProviderStorageAuthority();
  const scope = authority.createScope(tenantAlpha);
  const storageReference = authority.issueReference(scope);
  const storage = registry.resolve("fake_storage", "storage");
  await storage.read({ storageScope: scope, storageReference }, registry.createControl("fake_storage", "storage"));
  const written = await storage.write({
    storageScope: scope,
    storageReference,
    contentReference: provider.createProviderReference("ref_content00000002"),
    dataClassification: "restricted",
  }, registry.createControl("fake_storage", "storage"));
  assert.equal(written, storageReference);
  await avatar.close(registry.createControl("fake_avatar", "avatar"));
});

test("capability requirements resolve explicit interchangeable ports without automatic fallback or promotion", () => {
  const primaryCapabilities = [
    capability("realtime_model", "fake_model_primary", {
      capability: "fast_realtime",
      supported_regions: ["us-east"],
      languages: ["pt-BR"],
      max_session_minutes: 90,
      supports_data_residency: true,
      latency_class: "ultra_low",
    }),
    capability("realtime_model", "fake_model_primary", {
      capability: "batch_summary",
      max_session_minutes: 15,
      supports_streaming: false,
      supports_barge_in: false,
      latency_class: "batch",
    }),
  ];
  const primaryEntry = entry("realtime_model", "fake_model_primary", {
    capabilities: primaryCapabilities,
    fallbackProviderIds: ["fake_model_fallback"],
  });
  const fallbackEntry = entry("realtime_model", "fake_model_fallback", {
    capabilities: [capability("realtime_model", "fake_model_fallback", {
      capability: "fast_realtime",
      supported_regions: ["us-east"],
      languages: ["pt-BR"],
      max_session_minutes: 90,
      supports_data_residency: true,
      latency_class: "ultra_low",
    })],
  });
  const registry = provider.createProviderRegistry(
    [primaryEntry, fallbackEntry],
    [port("realtime_model", "fake_model_primary", primaryEntry), port("realtime_model", "fake_model_fallback", fallbackEntry)],
  );
  const requirement = {
    capability: "fast_realtime",
    region: "us-east",
    language: "pt-BR",
    requiresStreaming: true,
    requiresBargeIn: true,
    requiresDataResidency: true,
    minimumSessionMinutes: 60,
    maximumLatencyClass: "low",
    requiresCancellation: true,
  };

  const eligibility = registry.evaluateEligibility("fake_model_primary", "realtime_model", requirement);
  assert.deepEqual(eligibility.reasons, []);
  assert.equal(eligibility.eligible, true);
  assert.equal(eligibility.matchingCapabilities.length, 1);
  assert.equal(registry.resolveForRequirement("fake_model_primary", "realtime_model", requirement).providerId, "fake_model_primary");
  assert.equal(modelGateway.resolveRealtimeModelPort(registry, "fake_model_fallback").providerId, "fake_model_fallback");
  assert.deepEqual(registry.fallbackFor("fake_model_primary", "realtime_model"), ["fake_model_fallback"]);
  assert.throws(
    () => registry.resolveForRequirement("fake_model_primary", "realtime_model", { ...requirement, capability: "unsupported" }),
    (error) => error instanceof provider.ProviderContractError && error.code === "unsupported_capability",
  );
  assert.equal(voiceGateway.resolveSpeechToTextPort(registryWithAllPorts(), "fake_stt").portKind, "stt");
  assert.equal(voiceGateway.resolveTextToSpeechPort(registryWithAllPorts(), "fake_tts").portKind, "tts");
  assert.equal(avatarGateway.resolveAvatarPort(registryWithAllPorts(), "fake_avatar").portKind, "avatar");
  assert.equal(meetingGateway.resolveChannelPort(registryWithAllPorts(), "fake_channel").portKind, "channel");
  assert.equal(meetingGateway.resolveMeetingPort(registryWithAllPorts(), "fake_meeting").portKind, "meeting");
  assert.equal(meetingGateway.resolveTelephonyPort(registryWithAllPorts(), "fake_telephony").portKind, "telephony");
});

test("runtime selection fails closed for inactive capabilities, unavailable health, and non-closed circuits", () => {
  const disabled = entry("avatar", "fake_disabled", {
    capabilities: [capability("avatar", "fake_disabled", { status: "disabled" })],
  });
  const unavailable = entry("avatar", "fake_unavailable", { healthStatus: "unavailable" });
  const circuitOpen = entry("avatar", "fake_open", { circuitState: "open" });
  const fallback = entry("avatar", "fake_fallback");
  const registry = provider.createProviderRegistry(
    [disabled, unavailable, circuitOpen, fallback],
    [
      port("avatar", "fake_disabled", disabled),
      port("avatar", "fake_unavailable", unavailable),
      port("avatar", "fake_open", circuitOpen),
      port("avatar", "fake_fallback", fallback),
    ],
  );
  for (const providerId of ["fake_disabled", "fake_unavailable", "fake_open"]) {
    assert.throws(() => registry.resolve(providerId, "avatar"), provider.ProviderContractError);
  }
  assert.equal(registry.getEntry("fake_unavailable", "avatar").health_status, "unavailable");
  assert.equal(registry.resolve("fake_fallback", "avatar").providerId, "fake_fallback");
});

test("registry rejects tenant data, invalid capability bindings, duplicate ports, and non-fake entries", () => {
  const candidate = entry("avatar", "fake_avatar");
  assert.throws(() => provider.parseProviderRegistryEntry({ ...candidate, tenant_id: tenantAlpha }), provider.ProviderContractError);
  assert.throws(() => provider.parseProviderRegistryEntry({ ...candidate, secret_handle: "secret://provider/credential" }), provider.ProviderContractError);
  assert.throws(() => provider.parseProviderRegistryEntry({ ...candidate, provider_mode: "real" }), provider.ProviderContractError);
  assert.throws(() => provider.parseProviderRegistryEntry({
    ...candidate,
    provider_capabilities: [{ ...candidate.provider_capabilities[0], provider_id: "https://provider.invalid" }],
  }), provider.ProviderContractError);
  assert.throws(() => provider.parseProviderRegistryEntry({
    ...candidate,
    provider_capabilities: [
      candidate.provider_capabilities[0],
      { ...candidate.provider_capabilities[0], capability: "another", provider_id: "other_provider" },
    ],
  }), provider.ProviderContractError);
  const avatarPort = port("avatar", "fake_avatar", candidate);
  assert.throws(() => provider.createProviderRegistry([candidate, candidate], [avatarPort]), provider.ProviderContractError);
  assert.throws(() => provider.createProviderRegistry([candidate], [port("tts", "fake_avatar", entry("tts", "fake_avatar"))]), provider.ProviderContractError);
  const maliciousCapabilityPort = { ...avatarPort, capabilities: () => [{ ...candidate.provider_capabilities[0], capability: "unregistered" }] };
  assert.throws(() => provider.createProviderRegistry([candidate], [maliciousCapabilityPort]), provider.ProviderContractError);
  const throwingCapabilityPort = port("avatar", "fake_avatar", candidate, { capabilitiesError: new Error("Bearer bootstrap_secret_must_not_escape") });
  assert.throws(
    () => provider.createProviderRegistry([candidate], [throwingCapabilityPort]),
    (error) => error instanceof provider.ProviderContractError && !error.message.includes("bootstrap_secret"),
  );
  const poisoned = JSON.parse(JSON.stringify(candidate));
  Object.defineProperty(poisoned, "__proto__", { value: "poisoned", enumerable: true });
  assert.throws(() => provider.parseProviderRegistryEntry(poisoned), provider.ProviderContractError);
});

test("operation controls derive and abort adapter signals for caller cancellation and deadlines", async () => {
  assert.throws(() => provider.createProviderOperationControl({ timeoutMs: 0 }), provider.ProviderContractError);
  assert.throws(() => provider.createProviderOperationControl({ timeoutMs: Infinity }), provider.ProviderContractError);
  assert.throws(() => provider.createProviderOperationControl({ timeoutMs: 121_000 }), provider.ProviderContractError);
  assert.throws(() => provider.createProviderOperationControl({ timeoutMs: 100, deadlineAt: Date.now() - 1 }), provider.ProviderContractError);

  const aborted = new AbortController();
  aborted.abort();
  let started = false;
  await assert.rejects(
    provider.runProviderOperation(provider.createProviderOperationControl({ timeoutMs: 100, signal: aborted.signal }), async () => {
      started = true;
      return "unexpected";
    }),
    (error) => error instanceof provider.ProviderOperationError && error.failure.code === "cancelled",
  );
  assert.equal(started, false);

  const immediateAbort = new AbortController();
  let immediateStarted = false;
  const immediatelyCancelled = provider.runProviderOperation(
    provider.createProviderOperationControl({ timeoutMs: 100, signal: immediateAbort.signal }),
    async () => {
      immediateStarted = true;
      return "must-not-start";
    },
  );
  immediateAbort.abort();
  await assert.rejects(immediatelyCancelled, (error) => error instanceof provider.ProviderOperationError && error.failure.code === "cancelled");
  await Promise.resolve();
  assert.equal(immediateStarted, false);

  const midFlightAbort = new AbortController();
  let cancellationSeenByAdapter = false;
  const cancelledWork = provider.runProviderOperation(
    provider.createProviderOperationControl({ timeoutMs: 200, signal: midFlightAbort.signal }),
    async (operationControl) => new Promise((resolve) => {
      operationControl.signal.addEventListener("abort", () => {
        cancellationSeenByAdapter = operationControl.signal.aborted;
        resolve("late-cancelled-result");
      }, { once: true });
    }),
  );
  const independentWork = provider.runProviderOperation(
    provider.createProviderOperationControl({ timeoutMs: 200 }),
    async () => {
      await delay(10);
      return "independent-result";
    },
  );
  setTimeout(() => midFlightAbort.abort(), 10);
  await assert.rejects(cancelledWork, (error) => error instanceof provider.ProviderOperationError && error.failure.code === "cancelled");
  assert.equal(cancellationSeenByAdapter, true);
  assert.equal(await independentWork, "independent-result");

  let timeoutSeenByAdapter = false;
  const timeoutWork = provider.runProviderOperation(
    provider.createProviderOperationControl({ timeoutMs: 50 }),
    async (operationControl) => new Promise((resolve) => {
      operationControl.signal.addEventListener("abort", () => {
        timeoutSeenByAdapter = operationControl.signal.aborted;
        resolve("late-timeout-result");
      }, { once: true });
    }),
  );
  await assert.rejects(timeoutWork, (error) => error instanceof provider.ProviderOperationError && error.failure.code === "timeout");
  assert.equal(timeoutSeenByAdapter, true);

  let closeCalls = 0;
  const close = provider.createIdempotentClose(async () => { closeCalls += 1; });
  const closeControl = provider.createProviderOperationControl({ timeoutMs: 100 });
  await Promise.all([close(closeControl), close(closeControl), close(closeControl)]);
  assert.equal(closeCalls, 1);
});

test("registry normalizes health, costs and operation results and applies catalog default timeout", async () => {
  const candidate = entry("avatar", "fake_avatar", { defaultTimeoutMs: 1234 });
  let observedSignal;
  const strictPort = port("avatar", "fake_avatar", candidate, {
    onControl: (control) => { observedSignal = control.signal; },
    health: {
      status: "degraded",
      circuitState: "half_open",
      checkedAt: evaluatedAt,
      latencyMs: 42,
      failureCode: "transient_network",
    },
  });
  const registry = provider.createProviderRegistry([candidate], [strictPort]);
  const control = registry.createControl("fake_avatar", "avatar");
  assert.equal(control.timeoutMs, 1234);
  const health = await registry.resolve("fake_avatar", "avatar").health(control);
  assert.deepEqual(health, {
    status: "degraded",
    circuitState: "half_open",
    checkedAt: evaluatedAt,
    latencyMs: 42,
    failure: { code: "transient_network", retryable: true },
  });
  assert.equal(observedSignal instanceof AbortSignal, true);
  assert.notEqual(observedSignal, control.signal);
  const estimate = await registry.resolve("fake_avatar", "avatar").estimateCost({ quantity: 1, unit: "megabyte" }, registry.createControl("fake_avatar", "avatar"));
  assert.deepEqual(estimate, { quantity: 1, unit: "megabyte", estimatedUsdMicros: 1 });
  assert.throws(() => provider.normalizeProviderHealth({ ...health, endpoint: "https://provider.invalid" }), provider.ProviderContractError);
  const rawError = new Error("Bearer dev_provider_secret_should_not_escape");
  const normalized = provider.normalizeProviderFailure(rawError);
  assert.deepEqual(normalized, { code: "unknown", retryable: false });
  assert.equal(JSON.stringify(normalized).includes("dev_provider_secret"), false);

  const malformedHealthPort = port("avatar", "fake_malformed_health", entry("avatar", "fake_malformed_health"), {
    health: { status: "healthy", circuitState: "closed", checkedAt: evaluatedAt, latencyMs: 1, endpoint: "https://provider.invalid" },
  });
  const malformedHealthEntry = entry("avatar", "fake_malformed_health");
  const malformedRegistry = provider.createProviderRegistry([malformedHealthEntry], [malformedHealthPort]);
  await assert.rejects(
    malformedRegistry.resolve("fake_malformed_health", "avatar").health(malformedRegistry.createControl("fake_malformed_health", "avatar")),
    (error) => error instanceof provider.ProviderOperationError && error.failure.code === "unknown",
  );

  const closeEntry = entry("avatar", "fake_close_error");
  const closeRegistry = provider.createProviderRegistry([closeEntry], [port("avatar", "fake_close_error", closeEntry, {
    closeError: new Error("Bearer close_secret_must_not_escape"),
  })]);
  await assert.rejects(
    closeRegistry.resolve("fake_close_error", "avatar").close(closeRegistry.createControl("fake_close_error", "avatar")),
    (error) => error instanceof provider.ProviderOperationError && error.failure.code === "unknown" && !error.message.includes("close_secret"),
  );

  const closeAbort = new AbortController();
  let closeAbortSeenByAdapter = false;
  let markCloseStarted;
  const closeStarted = new Promise((resolve) => { markCloseStarted = resolve; });
  const closingEntry = entry("avatar", "fake_close_cancel");
  const closingRegistry = provider.createProviderRegistry([closingEntry], [port("avatar", "fake_close_cancel", closingEntry, {
    closeWork: async (operationControl) => new Promise((resolve) => {
      markCloseStarted();
      operationControl.signal.addEventListener("abort", () => {
        closeAbortSeenByAdapter = operationControl.signal.aborted;
        resolve();
      }, { once: true });
    }),
  })]);
  const closing = closingRegistry.resolve("fake_close_cancel", "avatar").close(
    closingRegistry.createControl("fake_close_cancel", "avatar", { signal: closeAbort.signal }),
  );
  await closeStarted;
  closeAbort.abort();
  await assert.rejects(closing, (error) => error instanceof provider.ProviderOperationError && error.failure.code === "cancelled");
  assert.equal(closeAbortSeenByAdapter, true);

  let closeTimeoutSeenByAdapter = false;
  let markTimeoutCloseStarted;
  const timeoutCloseStarted = new Promise((resolve) => { markTimeoutCloseStarted = resolve; });
  const timeoutEntry = entry("avatar", "fake_close_timeout", { defaultTimeoutMs: 50 });
  const timeoutRegistry = provider.createProviderRegistry([timeoutEntry], [port("avatar", "fake_close_timeout", timeoutEntry, {
    closeWork: async (operationControl) => new Promise((resolve) => {
      markTimeoutCloseStarted();
      operationControl.signal.addEventListener("abort", () => {
        closeTimeoutSeenByAdapter = operationControl.signal.aborted;
        resolve();
      }, { once: true });
    }),
  })]);
  const timingOutClose = timeoutRegistry.resolve("fake_close_timeout", "avatar").close(
    timeoutRegistry.createControl("fake_close_timeout", "avatar"),
  );
  await timeoutCloseStarted;
  await assert.rejects(timingOutClose, (error) => error instanceof provider.ProviderOperationError && error.failure.code === "timeout");
  assert.equal(closeTimeoutSeenByAdapter, true);
});

test("tool port cannot execute forged intents before the Action Runtime and never calls the adapter", async () => {
  const toolCalls = [];
  const candidate = entry("tool", "fake_tool");
  const registry = provider.createProviderRegistry([candidate], [port("tool", "fake_tool", candidate, { toolCalls })]);
  const forged = {
    intent: { schema_version: "2.0.0", intent_id: "forged" },
    decision: { schema_version: "2.0.0", outcome: "allow" },
  };
  assert.equal(typeof provider.createAuthorizedToolExecution, "undefined");
  await assert.rejects(
    registry.resolve("fake_tool", "tool").executeAuthorized(forged, registry.createControl("fake_tool", "tool")),
    (error) => error instanceof provider.ProviderContractError && error.code === "action_runtime_required",
  );
  assert.deepEqual(toolCalls, []);
});

test("storage references are sealed to a tenant scope and cross-tenant access is rejected before the adapter", async () => {
  const authority = provider.createProviderStorageAuthority();
  const alphaScope = authority.createScope(tenantAlpha);
  const betaScope = authority.createScope(tenantBeta);
  const alphaReference = authority.issueReference(alphaScope);
  const betaReference = authority.issueReference(betaScope);
  const storageReads = [];
  const candidate = entry("storage", "fake_storage");
  const registry = provider.createProviderRegistry([candidate], [port("storage", "fake_storage", candidate, { storageReads })]);
  const storage = registry.resolve("fake_storage", "storage");
  const control = registry.createControl("fake_storage", "storage");
  const result = await storage.read({ storageScope: alphaScope, storageReference: alphaReference }, control);
  assert.equal(result.dataClassification, "restricted");
  assert.deepEqual(storageReads, ["read"]);
  assert.throws(
    () => storage.read({ storageScope: betaScope, storageReference: alphaReference }, registry.createControl("fake_storage", "storage")),
    (error) => error instanceof provider.ProviderContractError && error.code === "invalid_storage_reference",
  );
  assert.deepEqual(storageReads, ["read"]);
  assert.throws(
    () => storage.read({ storageScope: alphaScope, storageReference: {} }, registry.createControl("fake_storage", "storage")),
    provider.ProviderContractError,
  );
  assert.equal(JSON.stringify(alphaScope).includes(tenantAlpha), false);
  assert.equal(JSON.stringify(alphaReference).includes(tenantAlpha), false);
  assert.equal(typeof provider.createProviderStorageReference, "undefined");

  const wrongWritePort = port("storage", "fake_wrong_write", entry("storage", "fake_wrong_write"), { storageWriteResult: betaReference });
  const wrongWriteEntry = entry("storage", "fake_wrong_write");
  const wrongWriteRegistry = provider.createProviderRegistry([wrongWriteEntry], [wrongWritePort]);
  await assert.rejects(
    wrongWriteRegistry.resolve("fake_wrong_write", "storage").write({
      storageScope: alphaScope,
      storageReference: alphaReference,
      contentReference: provider.createProviderReference("ref_content00000001"),
      dataClassification: "restricted",
    }, wrongWriteRegistry.createControl("fake_wrong_write", "storage")),
    (error) => error instanceof provider.ProviderContractError && error.code === "invalid_storage_reference",
  );
});

test("provider contracts have no provider SDK dependency", () => {
  const manifest = JSON.parse(readFileSync(join(root, "packages/provider-contracts/package.json"), "utf8"));
  assert.deepEqual(Object.keys(manifest.dependencies), ["@axtro/contracts-ts"]);
  const source = readFileSync(join(root, "packages/provider-contracts/src/index.ts"), "utf8").toLowerCase();
  for (const token of ["openai", "livekit", "tavus", "telnyx", "recall", "heygen"]) {
    assert.equal(source.includes(token), false);
  }
});
