import type { ProviderCapability, ProviderRegistryEntry } from "@axtro/contracts-ts";

import {
  createIdempotentClose,
  createProviderOperationControl,
  normalizeProviderHealth,
  runProviderOperation,
  type ProviderOperationControl,
} from "./operation.js";
import {
  assertProviderReference,
  assertProviderStorageAccess,
  type AnyProviderPort,
  type AvatarRenderRequest,
  type ChannelConnection,
  type ChannelOpenRequest,
  type MeetingConnection,
  type MeetingJoinRequest,
  type ProviderCostEstimate,
  type ProviderCostEstimateResult,
  type ProviderMediaOutput,
  type ProviderPortForKind,
  type ProviderReference,
  type ProviderStorageAccess,
  type ProviderStorageReference,
  type RealtimeModelSession,
  type RealtimeModelSessionRequest,
  type SpeechToTextRequest,
  type StorageWriteRequest,
  type TelephonyConnectRequest,
  type TelephonyConnection,
  type TextToSpeechRequest,
  type UntrustedProviderOutput,
} from "./ports.js";
import {
  ProviderContractError,
  parseProviderCapabilityRecord,
  parseProviderId,
  parseProviderPortKind,
  parseProviderRegistryEntry,
  type ProviderId,
  type ProviderPortKind,
} from "./normalization.js";
import { assertAuthorizedToolExecution } from "./tool.js";

export interface ProviderCapabilityRequirement {
  readonly capability?: string;
  readonly region?: string;
  readonly language?: string;
  readonly requiresStreaming?: boolean;
  readonly requiresBargeIn?: boolean;
  readonly requiresDataResidency?: boolean;
  readonly minimumSessionMinutes?: number;
  readonly maximumLatencyClass?: "ultra_low" | "low" | "medium" | "batch";
  readonly requiresCancellation?: boolean;
}

export type ProviderEligibilityReason =
  | "capability_missing"
  | "capability_inactive"
  | "provider_unavailable"
  | "circuit_not_closed"
  | "cancellation_unsupported";

export interface ProviderCapabilityEligibility {
  readonly eligible: boolean;
  readonly reasons: readonly ProviderEligibilityReason[];
  readonly matchingCapabilities: readonly ProviderCapability[];
}

export interface ProviderRegistry {
  readonly entries: readonly ProviderRegistryEntry[];
  getEntry(providerId: unknown, portKind: unknown): ProviderRegistryEntry | null;
  getCapabilities(providerId: unknown, portKind: unknown): readonly ProviderCapability[];
  evaluateEligibility(
    providerId: unknown,
    portKind: unknown,
    requirement: unknown,
  ): ProviderCapabilityEligibility;
  resolve<Kind extends ProviderPortKind>(providerId: unknown, portKind: Kind): ProviderPortForKind<Kind>;
  resolveForRequirement<Kind extends ProviderPortKind>(
    providerId: unknown,
    portKind: Kind,
    requirement: unknown,
  ): ProviderPortForKind<Kind>;
  createControl(providerId: unknown, portKind: unknown, input?: unknown): ProviderOperationControl;
  fallbackFor(providerId: unknown, portKind: unknown): readonly ProviderId[];
}

/**
 * Build the M0 catalog once at bootstrap. It intentionally has no register,
 * promote, default-selection, or automatic-fallback method available to request runtimes.
 */
export function createProviderRegistry(
  entriesInput: readonly unknown[],
  portsInput: readonly unknown[],
): ProviderRegistry {
  if (!Array.isArray(entriesInput) || !Array.isArray(portsInput) || entriesInput.length === 0) {
    throw new ProviderContractError();
  }
  const entries = entriesInput.map(parseProviderRegistryEntry);
  const entryByKey = new Map<string, ProviderRegistryEntry>();
  for (const entry of entries) {
    const key = registryKey(entry.provider_capabilities[0]!.provider_id, entry.port_kind);
    if (entryByKey.has(key)) throw new ProviderContractError("duplicate_provider");
    entryByKey.set(key, entry);
  }

  const portsByKey = new Map<string, AnyProviderPort>();
  for (const portInput of portsInput) {
    const port = normalizePort(portInput, entryByKey);
    const key = registryKey(port.providerId, port.portKind);
    if (portsByKey.has(key)) throw new ProviderContractError("duplicate_provider");
    if (!entryByKey.has(key)) throw new ProviderContractError("incompatible_port");
    portsByKey.set(key, port);
  }
  if (portsByKey.size !== entryByKey.size) throw new ProviderContractError("incompatible_port");

  for (const entry of entries) {
    for (const fallbackProviderId of entry.fallback_provider_ids) {
      const fallbackKey = registryKey(fallbackProviderId, entry.port_kind);
      if (!entryByKey.has(fallbackKey)) throw new ProviderContractError("incompatible_port");
    }
  }

  const frozenEntries = Object.freeze([...entries]);
  const getRequiredEntry = (providerId: unknown, portKind: unknown): ProviderRegistryEntry => {
    const key = registryKey(parseProviderId(providerId), parseProviderPortKind(portKind));
    const entry = entryByKey.get(key);
    if (entry === undefined) throw new ProviderContractError("provider_not_found");
    return entry;
  };
  const resolveExplicit = <Kind extends ProviderPortKind>(providerId: unknown, portKind: Kind): ProviderPortForKind<Kind> => {
    const entry = getRequiredEntry(providerId, portKind);
    const eligibility = evaluateEntryEligibility(entry, EMPTY_REQUIREMENT);
    assertEligible(eligibility);
    const port = portsByKey.get(registryKey(parseProviderId(providerId), portKind));
    if (port === undefined) throw new ProviderContractError("provider_not_found");
    return port as ProviderPortForKind<Kind>;
  };

  return Object.freeze({
    entries: frozenEntries,
    getEntry(providerId: unknown, portKind: unknown): ProviderRegistryEntry | null {
      const key = registryKey(parseProviderId(providerId), parseProviderPortKind(portKind));
      return entryByKey.get(key) ?? null;
    },
    getCapabilities(providerId: unknown, portKind: unknown): readonly ProviderCapability[] {
      return getRequiredEntry(providerId, portKind).provider_capabilities;
    },
    evaluateEligibility(providerId: unknown, portKind: unknown, requirement: unknown): ProviderCapabilityEligibility {
      return evaluateEntryEligibility(getRequiredEntry(providerId, portKind), parseRequirement(requirement));
    },
    resolve<Kind extends ProviderPortKind>(providerId: unknown, portKind: Kind): ProviderPortForKind<Kind> {
      return resolveExplicit(providerId, portKind);
    },
    resolveForRequirement<Kind extends ProviderPortKind>(
      providerId: unknown,
      portKind: Kind,
      requirement: unknown,
    ): ProviderPortForKind<Kind> {
      const entry = getRequiredEntry(providerId, portKind);
      const eligibility = evaluateEntryEligibility(entry, parseRequirement(requirement));
      assertEligible(eligibility);
      return resolveExplicit(providerId, portKind);
    },
    createControl(providerId: unknown, portKind: unknown, input?: unknown): ProviderOperationControl {
      const entry = getRequiredEntry(providerId, portKind);
      assertEligible(evaluateEntryEligibility(entry, EMPTY_REQUIREMENT));
      const signal = parseControlSignal(input);
      return signal === undefined
        ? createProviderOperationControl({ timeoutMs: entry.default_timeout_ms })
        : createProviderOperationControl({ timeoutMs: entry.default_timeout_ms, signal });
    },
    fallbackFor(providerId: unknown, portKind: unknown): readonly ProviderId[] {
      const entry = getRequiredEntry(providerId, portKind);
      return Object.freeze(entry.fallback_provider_ids.map((fallbackProviderId) => parseProviderId(fallbackProviderId)));
    },
  } satisfies ProviderRegistry);
}

const EMPTY_REQUIREMENT: ProviderCapabilityRequirement = Object.freeze({});
const LATENCY_ORDER: Readonly<Record<NonNullable<ProviderCapabilityRequirement["maximumLatencyClass"]>, number>> = Object.freeze({
  ultra_low: 0,
  low: 1,
  medium: 2,
  batch: 3,
});

function normalizePort(value: unknown, entries: ReadonlyMap<string, ProviderRegistryEntry>): AnyProviderPort {
  const record = plainRecord(value, "incompatible_port");
  const portKind = parseProviderPortKind(readRequired(record, "portKind", "incompatible_port"));
  const expectedKeys = [
    "providerId",
    "portKind",
    "providerMode",
    "capabilities",
    "health",
    "estimateCost",
    "close",
    ...PORT_OPERATION_METHODS[portKind],
  ];
  assertExactKeys(record, expectedKeys, "incompatible_port");
  const providerId = parseProviderId(readRequired(record, "providerId", "incompatible_port"));
  if (readRequired(record, "providerMode", "incompatible_port") !== "fake") throw new ProviderContractError("incompatible_port");
  const entry = entries.get(registryKey(providerId, portKind));
  if (entry === undefined) throw new ProviderContractError("incompatible_port");
  const capabilities = getFunction(record, "capabilities");
  try {
    assertCapabilities(capabilities.call(record), entry, portKind);
  } catch (error: unknown) {
    if (error instanceof ProviderContractError) throw error;
    throw new ProviderContractError("incompatible_port");
  }
  const health = getFunction(record, "health");
  const estimateCost = getFunction(record, "estimateCost");
  const close = getFunction(record, "close");
  const base = {
    providerId,
    portKind,
    providerMode: "fake" as const,
    capabilities: (): readonly ProviderCapability[] => entry.provider_capabilities,
    health: (control: ProviderOperationControl) => invoke(health, record, [], control, normalizeProviderHealth),
    estimateCost: (input: ProviderCostEstimate, control: ProviderOperationControl) => {
      const normalizedInput = normalizeCostEstimate(input);
      return invoke(estimateCost, record, [normalizedInput], control, (result) => normalizeCostEstimateResult(result, normalizedInput));
    },
    close: createIdempotentClose((control: ProviderOperationControl) => invoke(close, record, [], control, normalizeUndefined)),
  };

  switch (portKind) {
    case "channel": {
      const open = getFunction(record, "open");
      const closeConnection = getFunction(record, "closeConnection");
      return Object.freeze({
        ...base,
        open: (input: ChannelOpenRequest, control: ProviderOperationControl) => invoke(open, record, [normalizeChannelOpenRequest(input)], control, normalizeChannelConnection),
        closeConnection: (input: ChannelConnection, control: ProviderOperationControl) => invoke(closeConnection, record, [normalizeChannelConnection(input)], control, normalizeUndefined),
      }) as unknown as AnyProviderPort;
    }
    case "realtime_model": {
      const openSession = getFunction(record, "openSession");
      const closeSession = getFunction(record, "closeSession");
      return Object.freeze({
        ...base,
        openSession: (input: RealtimeModelSessionRequest, control: ProviderOperationControl) => invoke(openSession, record, [normalizeRealtimeModelSessionRequest(input)], control, normalizeRealtimeModelSession),
        closeSession: (input: RealtimeModelSession, control: ProviderOperationControl) => invoke(closeSession, record, [normalizeRealtimeModelSession(input)], control, normalizeUndefined),
      }) as unknown as AnyProviderPort;
    }
    case "stt": {
      const transcribe = getFunction(record, "transcribe");
      return Object.freeze({
        ...base,
        transcribe: (input: SpeechToTextRequest, control: ProviderOperationControl) => invoke(transcribe, record, [normalizeSpeechToTextRequest(input)], control, normalizeUntrustedProviderOutput),
      }) as unknown as AnyProviderPort;
    }
    case "tts": {
      const synthesize = getFunction(record, "synthesize");
      return Object.freeze({
        ...base,
        synthesize: (input: TextToSpeechRequest, control: ProviderOperationControl) => invoke(synthesize, record, [normalizeTextToSpeechRequest(input)], control, normalizeProviderMediaOutput),
      }) as unknown as AnyProviderPort;
    }
    case "avatar": {
      const render = getFunction(record, "render");
      return Object.freeze({
        ...base,
        render: (input: AvatarRenderRequest, control: ProviderOperationControl) => invoke(render, record, [normalizeAvatarRenderRequest(input)], control, normalizeProviderMediaOutput),
      }) as unknown as AnyProviderPort;
    }
    case "meeting": {
      const join = getFunction(record, "join");
      const leave = getFunction(record, "leave");
      return Object.freeze({
        ...base,
        join: (input: MeetingJoinRequest, control: ProviderOperationControl) => invoke(join, record, [normalizeMeetingJoinRequest(input)], control, normalizeMeetingConnection),
        leave: (input: MeetingConnection, control: ProviderOperationControl) => invoke(leave, record, [normalizeMeetingConnection(input)], control, normalizeUndefined),
      }) as unknown as AnyProviderPort;
    }
    case "telephony": {
      const connect = getFunction(record, "connect");
      const disconnect = getFunction(record, "disconnect");
      return Object.freeze({
        ...base,
        connect: (input: TelephonyConnectRequest, control: ProviderOperationControl) => invoke(connect, record, [normalizeTelephonyConnectRequest(input)], control, normalizeTelephonyConnection),
        disconnect: (input: TelephonyConnection, control: ProviderOperationControl) => invoke(disconnect, record, [normalizeTelephonyConnection(input)], control, normalizeUndefined),
      }) as unknown as AnyProviderPort;
    }
    case "tool": {
      return Object.freeze({
        ...base,
        async executeAuthorized(input: unknown, control: ProviderOperationControl): Promise<never> {
          void control;
          assertAuthorizedToolExecution(input);
          throw new ProviderContractError("action_runtime_required");
        },
      }) as unknown as AnyProviderPort;
    }
    case "storage": {
      const read = getFunction(record, "read");
      const write = getFunction(record, "write");
      return Object.freeze({
        ...base,
        read: (input: ProviderStorageAccess, control: ProviderOperationControl) => {
          const normalizedInput = normalizeProviderStorageAccess(input);
          return invoke(read, record, [normalizedInput], control, normalizeUntrustedProviderOutput);
        },
        write: async (input: StorageWriteRequest, control: ProviderOperationControl): Promise<ProviderStorageReference> => {
          const normalizedInput = normalizeStorageWriteRequest(input);
          const output = await invoke(write, record, [normalizedInput], control, normalizeStorageReference);
          assertProviderStorageAccess({ storageScope: normalizedInput.storageScope, storageReference: output });
          return output;
        },
      }) as unknown as AnyProviderPort;
    }
  }
}

const PORT_OPERATION_METHODS: Readonly<Record<ProviderPortKind, readonly string[]>> = Object.freeze({
  channel: ["open", "closeConnection"],
  realtime_model: ["openSession", "closeSession"],
  stt: ["transcribe"],
  tts: ["synthesize"],
  avatar: ["render"],
  meeting: ["join", "leave"],
  telephony: ["connect", "disconnect"],
  tool: ["executeAuthorized"],
  storage: ["read", "write"],
});

function evaluateEntryEligibility(entry: ProviderRegistryEntry, requirement: ProviderCapabilityRequirement): ProviderCapabilityEligibility {
  const matchingCapabilities = entry.provider_capabilities.filter((capability) => matchesRequirement(capability, requirement));
  const reasons: ProviderEligibilityReason[] = [];
  if (matchingCapabilities.length === 0) reasons.push("capability_missing");
  if (matchingCapabilities.length > 0 && !matchingCapabilities.some(isCapabilityRuntimeEnabled)) reasons.push("capability_inactive");
  if (entry.health_status === "unavailable" || entry.health_status === "unknown") reasons.push("provider_unavailable");
  if (entry.circuit_state !== "closed") reasons.push("circuit_not_closed");
  if (requirement.requiresCancellation === true && !entry.supports_cancellation) reasons.push("cancellation_unsupported");
  return Object.freeze({
    eligible: reasons.length === 0,
    reasons: Object.freeze(reasons),
    matchingCapabilities: Object.freeze([...matchingCapabilities]),
  });
}

function assertEligible(eligibility: ProviderCapabilityEligibility): void {
  if (eligibility.eligible) return;
  if (eligibility.reasons.includes("capability_missing") || eligibility.reasons.includes("capability_inactive")) {
    throw new ProviderContractError("unsupported_capability");
  }
  throw new ProviderContractError("provider_unavailable");
}

function matchesRequirement(capability: ProviderCapability, requirement: ProviderCapabilityRequirement): boolean {
  if (requirement.capability !== undefined && capability.capability !== requirement.capability) return false;
  if (requirement.region !== undefined && !capability.supported_regions.includes(requirement.region)) return false;
  if (requirement.language !== undefined && !capability.languages.includes(requirement.language)) return false;
  if (requirement.requiresStreaming === true && !capability.supports_streaming) return false;
  if (requirement.requiresBargeIn === true && !capability.supports_barge_in) return false;
  if (requirement.requiresDataResidency === true && !capability.supports_data_residency) return false;
  if (requirement.minimumSessionMinutes !== undefined && capability.max_session_minutes < requirement.minimumSessionMinutes) return false;
  if (requirement.maximumLatencyClass !== undefined && LATENCY_ORDER[capability.latency_class] > LATENCY_ORDER[requirement.maximumLatencyClass]) return false;
  return true;
}

function isCapabilityRuntimeEnabled(capability: ProviderCapability): boolean {
  return capability.status !== "deprecated" && capability.status !== "disabled";
}

function parseRequirement(value: unknown): ProviderCapabilityRequirement {
  const record = plainRecord(value, "unsupported_capability");
  const expected = [
    "capability",
    "region",
    "language",
    "requiresStreaming",
    "requiresBargeIn",
    "requiresDataResidency",
    "minimumSessionMinutes",
    "maximumLatencyClass",
    "requiresCancellation",
  ];
  assertKnownKeys(record, expected, "unsupported_capability");
  const requirement: {
    capability?: string;
    region?: string;
    language?: string;
    requiresStreaming?: boolean;
    requiresBargeIn?: boolean;
    requiresDataResidency?: boolean;
    minimumSessionMinutes?: number;
    maximumLatencyClass?: "ultra_low" | "low" | "medium" | "batch";
    requiresCancellation?: boolean;
  } = {};
  if (hasOwn(record, "capability")) requirement.capability = parsePattern(readRequired(record, "capability", "unsupported_capability"), /^[a-z][a-z0-9_]{0,99}$/);
  if (hasOwn(record, "region")) requirement.region = parsePattern(readRequired(record, "region", "unsupported_capability"), /^[a-z][a-z0-9-]{1,79}$/);
  if (hasOwn(record, "language")) requirement.language = parsePattern(readRequired(record, "language", "unsupported_capability"), /^[a-z]{2}(?:-[A-Z]{2})?$/);
  if (hasOwn(record, "requiresStreaming")) requirement.requiresStreaming = parseBoolean(readRequired(record, "requiresStreaming", "unsupported_capability"));
  if (hasOwn(record, "requiresBargeIn")) requirement.requiresBargeIn = parseBoolean(readRequired(record, "requiresBargeIn", "unsupported_capability"));
  if (hasOwn(record, "requiresDataResidency")) requirement.requiresDataResidency = parseBoolean(readRequired(record, "requiresDataResidency", "unsupported_capability"));
  if (hasOwn(record, "minimumSessionMinutes")) requirement.minimumSessionMinutes = parseInteger(readRequired(record, "minimumSessionMinutes", "unsupported_capability"), 1, 1440);
  if (hasOwn(record, "maximumLatencyClass")) requirement.maximumLatencyClass = parseLatencyClass(readRequired(record, "maximumLatencyClass", "unsupported_capability"));
  if (hasOwn(record, "requiresCancellation")) requirement.requiresCancellation = parseBoolean(readRequired(record, "requiresCancellation", "unsupported_capability"));
  return Object.freeze(requirement);
}

function parseControlSignal(value: unknown): AbortSignal | undefined {
  if (value === undefined) return undefined;
  const record = plainRecord(value, "invalid_operation_control");
  assertExactKeys(record, ["signal"], "invalid_operation_control");
  const signal = readRequired(record, "signal", "invalid_operation_control");
  if (typeof AbortSignal === "undefined" || !(signal instanceof AbortSignal)) {
    throw new ProviderContractError("invalid_operation_control");
  }
  return signal;
}

function assertCapabilities(value: unknown, entry: ProviderRegistryEntry, portKind: ProviderPortKind): void {
  if (!Array.isArray(value)) throw new ProviderContractError("incompatible_port");
  const parsed = value.map((capability) => parseProviderCapabilityRecord(capability, portKind));
  if (parsed.length !== entry.provider_capabilities.length) throw new ProviderContractError("incompatible_port");
  const actual = parsed.map((capability) => JSON.stringify(capability));
  const expected = entry.provider_capabilities.map((capability) => JSON.stringify(capability));
  if (actual.some((capability, index) => capability !== expected[index])) throw new ProviderContractError("incompatible_port");
}

async function invoke<Result>(
  method: Function,
  receiver: Record<string, unknown>,
  args: readonly unknown[],
  control: ProviderOperationControl,
  normalizer: (value: unknown) => Result,
): Promise<Result> {
  return runProviderOperation(control, async (operationControl) => normalizer(await method.call(receiver, ...args, operationControl)));
}

function normalizeChannelOpenRequest(value: unknown): ChannelOpenRequest {
  const record = plainRecord(value, "invalid_contract");
  assertExactKeys(record, ["channelReference"], "invalid_contract");
  return Object.freeze({ channelReference: normalizeProviderReference(readRequired(record, "channelReference", "invalid_contract")) });
}

function normalizeChannelConnection(value: unknown): ChannelConnection {
  const record = plainRecord(value, "invalid_contract");
  assertExactKeys(record, ["connectionReference", "state"], "invalid_contract");
  return Object.freeze({
    connectionReference: normalizeProviderReference(readRequired(record, "connectionReference", "invalid_contract")),
    state: parseEnum(readRequired(record, "state", "invalid_contract"), ["connected", "disconnected"] as const, "invalid_contract"),
  });
}

function normalizeRealtimeModelSessionRequest(value: unknown): RealtimeModelSessionRequest {
  const record = plainRecord(value, "invalid_contract");
  assertExactKeys(record, ["sessionReference", "mode"], "invalid_contract");
  return Object.freeze({
    sessionReference: normalizeProviderReference(readRequired(record, "sessionReference", "invalid_contract")),
    mode: parseEnum(readRequired(record, "mode", "invalid_contract"), ["modular", "s2s"] as const, "invalid_contract"),
  });
}

function normalizeRealtimeModelSession(value: unknown): RealtimeModelSession {
  const record = plainRecord(value, "invalid_contract");
  assertExactKeys(record, ["providerSessionReference", "expiresAt"], "invalid_contract");
  return Object.freeze({
    providerSessionReference: normalizeProviderReference(readRequired(record, "providerSessionReference", "invalid_contract")),
    expiresAt: parseTimestamp(readRequired(record, "expiresAt", "invalid_contract")),
  });
}

function normalizeSpeechToTextRequest(value: unknown): SpeechToTextRequest {
  const record = plainRecord(value, "invalid_contract");
  assertExactKeys(record, ["audioReference", "language"], "invalid_contract");
  return Object.freeze({
    audioReference: normalizeProviderReference(readRequired(record, "audioReference", "invalid_contract")),
    language: parseEnum(readRequired(record, "language", "invalid_contract"), ["pt-BR", "en-US"] as const, "invalid_contract"),
  });
}

function normalizeTextToSpeechRequest(value: unknown): TextToSpeechRequest {
  const record = plainRecord(value, "invalid_contract");
  assertExactKeys(record, ["textReference", "voiceReference", "language"], "invalid_contract");
  return Object.freeze({
    textReference: normalizeProviderReference(readRequired(record, "textReference", "invalid_contract")),
    voiceReference: normalizeProviderReference(readRequired(record, "voiceReference", "invalid_contract")),
    language: parseEnum(readRequired(record, "language", "invalid_contract"), ["pt-BR", "en-US"] as const, "invalid_contract"),
  });
}

function normalizeAvatarRenderRequest(value: unknown): AvatarRenderRequest {
  const record = plainRecord(value, "invalid_contract");
  assertExactKeys(record, ["avatarReference", "audioReference"], "invalid_contract");
  return Object.freeze({
    avatarReference: normalizeProviderReference(readRequired(record, "avatarReference", "invalid_contract")),
    audioReference: normalizeProviderReference(readRequired(record, "audioReference", "invalid_contract")),
  });
}

function normalizeProviderMediaOutput(value: unknown): ProviderMediaOutput {
  const record = plainRecord(value, "invalid_contract");
  assertExactKeys(record, ["mediaReference"], "invalid_contract");
  return Object.freeze({ mediaReference: normalizeProviderReference(readRequired(record, "mediaReference", "invalid_contract")) });
}

function normalizeUntrustedProviderOutput(value: unknown): UntrustedProviderOutput {
  const record = plainRecord(value, "invalid_contract");
  assertExactKeys(record, ["outputReference", "dataClassification"], "invalid_contract");
  return Object.freeze({
    outputReference: normalizeProviderReference(readRequired(record, "outputReference", "invalid_contract")),
    dataClassification: parseEnum(readRequired(record, "dataClassification", "invalid_contract"), ["internal", "confidential", "restricted"] as const, "invalid_contract"),
  });
}

function normalizeMeetingJoinRequest(value: unknown): MeetingJoinRequest {
  const record = plainRecord(value, "invalid_contract");
  assertExactKeys(record, ["meetingReference"], "invalid_contract");
  return Object.freeze({ meetingReference: normalizeProviderReference(readRequired(record, "meetingReference", "invalid_contract")) });
}

function normalizeMeetingConnection(value: unknown): MeetingConnection {
  const record = plainRecord(value, "invalid_contract");
  assertExactKeys(record, ["connectionReference", "lifecycle"], "invalid_contract");
  return Object.freeze({
    connectionReference: normalizeProviderReference(readRequired(record, "connectionReference", "invalid_contract")),
    lifecycle: parseEnum(readRequired(record, "lifecycle", "invalid_contract"), ["joining", "waiting_room", "active", "removed", "reconnecting", "done"] as const, "invalid_contract"),
  });
}

function normalizeTelephonyConnectRequest(value: unknown): TelephonyConnectRequest {
  const record = plainRecord(value, "invalid_contract");
  assertExactKeys(record, ["callReference"], "invalid_contract");
  return Object.freeze({ callReference: normalizeProviderReference(readRequired(record, "callReference", "invalid_contract")) });
}

function normalizeTelephonyConnection(value: unknown): TelephonyConnection {
  const record = plainRecord(value, "invalid_contract");
  assertExactKeys(record, ["connectionReference", "lifecycle"], "invalid_contract");
  return Object.freeze({
    connectionReference: normalizeProviderReference(readRequired(record, "connectionReference", "invalid_contract")),
    lifecycle: parseEnum(readRequired(record, "lifecycle", "invalid_contract"), ["connecting", "active", "disconnected", "failed"] as const, "invalid_contract"),
  });
}

function normalizeProviderStorageAccess(value: unknown): ProviderStorageAccess {
  assertProviderStorageAccess(value);
  const record = value as unknown as Record<string, unknown>;
  return Object.freeze({
    storageScope: readRequired(record, "storageScope", "invalid_storage_reference") as ProviderStorageAccess["storageScope"],
    storageReference: readRequired(record, "storageReference", "invalid_storage_reference") as ProviderStorageAccess["storageReference"],
  });
}

function normalizeStorageWriteRequest(value: unknown): StorageWriteRequest {
  const record = plainRecord(value, "invalid_storage_reference");
  assertExactKeys(record, ["storageScope", "storageReference", "contentReference", "dataClassification"], "invalid_storage_reference");
  const access = normalizeProviderStorageAccess({
    storageScope: readRequired(record, "storageScope", "invalid_storage_reference"),
    storageReference: readRequired(record, "storageReference", "invalid_storage_reference"),
  });
  return Object.freeze({
    ...access,
    contentReference: normalizeProviderReference(readRequired(record, "contentReference", "invalid_storage_reference")),
    dataClassification: parseEnum(readRequired(record, "dataClassification", "invalid_storage_reference"), ["internal", "confidential", "restricted"] as const, "invalid_storage_reference"),
  });
}

function normalizeStorageReference(value: unknown): ProviderStorageReference {
  if (value === null || typeof value !== "object") throw new ProviderContractError("invalid_storage_reference");
  return value as ProviderStorageReference;
}

function normalizeCostEstimate(value: unknown): ProviderCostEstimate {
  const record = plainRecord(value, "invalid_contract");
  assertExactKeys(record, ["quantity", "unit"], "invalid_contract");
  return Object.freeze({
    quantity: parseFiniteNumber(readRequired(record, "quantity", "invalid_contract"), 0, Number.MAX_SAFE_INTEGER),
    unit: parseEnum(readRequired(record, "unit", "invalid_contract"), ["minute", "second", "token", "character", "megabyte", "request", "seat", "flat"] as const, "invalid_contract"),
  });
}

function normalizeCostEstimateResult(value: unknown, input: ProviderCostEstimate): ProviderCostEstimateResult {
  const record = plainRecord(value, "invalid_contract");
  assertExactKeys(record, ["quantity", "unit", "estimatedUsdMicros"], "invalid_contract");
  const quantity = parseFiniteNumber(readRequired(record, "quantity", "invalid_contract"), 0, Number.MAX_SAFE_INTEGER);
  const unit = parseEnum(readRequired(record, "unit", "invalid_contract"), ["minute", "second", "token", "character", "megabyte", "request", "seat", "flat"] as const, "invalid_contract");
  if (quantity !== input.quantity || unit !== input.unit) throw new ProviderContractError("invalid_contract");
  return Object.freeze({
    quantity,
    unit,
    estimatedUsdMicros: parseInteger(readRequired(record, "estimatedUsdMicros", "invalid_contract"), 0, Number.MAX_SAFE_INTEGER),
  });
}

function normalizeProviderReference(value: unknown): ProviderReference {
  assertProviderReference(value);
  return value;
}

function normalizeUndefined(value: unknown): undefined {
  if (value !== undefined) throw new ProviderContractError("invalid_contract");
  return undefined;
}

function assertUndefined(value: unknown): void {
  normalizeUndefined(value);
}

function registryKey(providerId: ProviderId | string, portKind: ProviderPortKind): string {
  return `${portKind}:${providerId}`;
}

function getFunction(record: Record<string, unknown>, key: string): Function {
  const value = readRequired(record, key, "incompatible_port");
  if (typeof value !== "function") throw new ProviderContractError("incompatible_port");
  return value;
}

function plainRecord(value: unknown, code: ConstructorParameters<typeof ProviderContractError>[0]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new ProviderContractError(code);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new ProviderContractError(code);
  return value as Record<string, unknown>;
}

function assertExactKeys(record: Record<string, unknown>, expected: readonly string[], code: ConstructorParameters<typeof ProviderContractError>[0]): void {
  const keys = Reflect.ownKeys(record);
  if (keys.length !== expected.length || keys.some((key) => typeof key !== "string" || !expected.includes(key))) {
    throw new ProviderContractError(code);
  }
}

function assertKnownKeys(record: Record<string, unknown>, expected: readonly string[], code: ConstructorParameters<typeof ProviderContractError>[0]): void {
  if (Reflect.ownKeys(record).some((key) => typeof key !== "string" || !expected.includes(key))) {
    throw new ProviderContractError(code);
  }
}

function readRequired(record: Record<string, unknown>, key: string, code: ConstructorParameters<typeof ProviderContractError>[0]): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor === undefined || !("value" in descriptor)) throw new ProviderContractError(code);
  return descriptor.value;
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function parsePattern(value: unknown, pattern: RegExp): string {
  if (typeof value !== "string" || !pattern.test(value)) throw new ProviderContractError("unsupported_capability");
  return value;
}

function parseBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw new ProviderContractError("unsupported_capability");
  return value;
}

function parseInteger(value: unknown, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new ProviderContractError("invalid_contract");
  }
  return value;
}

function parseFiniteNumber(value: unknown, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new ProviderContractError("invalid_contract");
  }
  return value;
}

function parseTimestamp(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new ProviderContractError("invalid_contract");
  }
  return value;
}

function parseLatencyClass(value: unknown): NonNullable<ProviderCapabilityRequirement["maximumLatencyClass"]> {
  return parseEnum(value, ["ultra_low", "low", "medium", "batch"] as const, "unsupported_capability");
}

function parseEnum<const Value extends string>(
  value: unknown,
  values: readonly Value[],
  code: ConstructorParameters<typeof ProviderContractError>[0],
): Value {
  if (typeof value !== "string" || !(values as readonly string[]).includes(value)) throw new ProviderContractError(code);
  return value as Value;
}
