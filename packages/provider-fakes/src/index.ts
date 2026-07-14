import {
  ProviderContractError,
  createProviderReference,
  parseProviderId,
  type AnyProviderPort,
  type AuthorizedToolExecution,
  type AvatarRenderRequest,
  type AvatarPort,
  type ChannelConnection,
  type ChannelOpenRequest,
  type ChannelPort,
  type MeetingConnection,
  type MeetingJoinRequest,
  type MeetingPort,
  type ProviderCostEstimate,
  type ProviderCostEstimateResult,
  type ProviderHealth,
  type ProviderOperationControl,
  type ProviderPort,
  type ProviderPortKind,
  type ProviderReference,
  type ProviderRegistry,
  type ProviderMediaOutput,
  type ProviderStorageAccess,
  type RealtimeModelPort,
  type RealtimeModelSession,
  type RealtimeModelSessionRequest,
  type SpeechToTextRequest,
  type SpeechToTextPort,
  type StorageWriteRequest,
  type StoragePort,
  type TelephonyConnectRequest,
  type TelephonyConnection,
  type TelephonyPort,
  type TextToSpeechRequest,
  type TextToSpeechPort,
  type ToolPort,
  type UntrustedProviderOutput,
} from "@axtro/provider-contracts";
import type { FakeProviderReplayDescriptor, FakeProviderScenario } from "@axtro/contracts-ts";

import {
  FAKE_PROVIDER_OPERATIONS,
  DeterministicFakeProviderEngine,
  createFakeProviderReplayDescriptor,
  deterministicFakeReference,
  parseFakeProviderScenario,
  resolveFakeProviderScheduler,
  type DeterministicFakeClock,
  type FakeProviderInvocation,
  type FakeProviderJournal,
  type FakeProviderOperation,
} from "./scenario.js";

export {
  FAKE_PROVIDER_OPERATIONS,
  createDeterministicFakeClock,
  type DeterministicFakeClock,
  type FakeFailurePhase,
  type FakeJournalPhase,
  type FakeProviderJournal,
  type FakeProviderOperation,
} from "./scenario.js";
export type {
  FakeProviderJournalEntry,
  FakeProviderReplayDescriptor,
  FakeProviderScenario,
} from "@axtro/contracts-ts";

type ProviderRegistryEntry = ProviderRegistry["entries"][number];

export interface DeterministicFakeProviderBundle {
  readonly entries: readonly ProviderRegistryEntry[];
  /** Bootstrap-only adapter instances. Compose them with createProviderRegistry explicitly. */
  readonly ports: readonly AnyProviderPort[];
  readonly journal: FakeProviderJournal;
  readonly replayDescriptor: FakeProviderReplayDescriptor;
}

const PORT_KINDS = [
  "channel",
  "realtime_model",
  "stt",
  "tts",
  "avatar",
  "meeting",
  "telephony",
  "tool",
  "storage",
] as const satisfies readonly ProviderPortKind[];
const EVALUATED_AT = "2026-07-14T00:00:00.000Z";
const SESSION_EXPIRY = "2026-07-14T01:00:00.000Z";
const COST_MICROS_PER_UNIT: Readonly<Record<ProviderPortKind, number>> = Object.freeze({
  channel: 2,
  realtime_model: 3,
  stt: 2,
  tts: 2,
  avatar: 4,
  meeting: 2,
  telephony: 3,
  tool: 0,
  storage: 1,
});

/**
 * Construct only deterministic, local provider adapters. The caller owns the
 * explicit registry composition and remains unable to select a real provider.
 */
export function createDeterministicProviderFakes(
  scenarioInput: FakeProviderScenario,
  clockInput?: DeterministicFakeClock,
): DeterministicFakeProviderBundle;
export function createDeterministicProviderFakes(
  scenarioInput: unknown,
  clockInput?: DeterministicFakeClock,
): DeterministicFakeProviderBundle {
  const scenario = parseFakeProviderScenario(scenarioInput);
  const engine = new DeterministicFakeProviderEngine(scenario, resolveFakeProviderScheduler(clockInput));
  const entries = Object.freeze(PORT_KINDS.map(createEntry));
  const ports = Object.freeze(entries.map((entry) => createPort(entry, engine, scenario.seed)));
  return Object.freeze({
    entries,
    ports,
    journal: engine.journal,
    replayDescriptor: createFakeProviderReplayDescriptor(scenario),
  });
}

function createEntry(portKind: ProviderPortKind): ProviderRegistryEntry {
  const providerId = `fake_${portKind}`;
  const capability = Object.freeze({
    schema_version: "2.0.0" as const,
    provider_id: providerId,
    provider_type: portKind,
    capability: "deterministic_fake",
    version: "fake-v1",
    supported_regions: Object.freeze(["us-east"]),
    languages: Object.freeze(["pt-BR", "en-US"]),
    max_session_minutes: 60,
    supports_streaming: portKind !== "storage" && portKind !== "tool",
    supports_barge_in: portKind === "channel" || portKind === "realtime_model" || portKind === "tts" || portKind === "avatar",
    supports_data_residency: false,
    latency_class: "low" as const,
    cost_model_ref: "spreadsheets/unit_economics_v2.xlsx",
    status: "candidate" as const,
    evaluated_at: EVALUATED_AT,
  });
  return Object.freeze({
    schema_version: "2.0.0" as const,
    port_kind: portKind,
    provider_mode: "fake" as const,
    provider_capabilities: Object.freeze([capability]),
    default_timeout_ms: 5_000,
    supports_cancellation: true,
    health_status: "healthy" as const,
    circuit_state: "closed" as const,
    fallback_provider_ids: Object.freeze([]),
  }) as unknown as ProviderRegistryEntry;
}

function createPort(
  entry: ProviderRegistryEntry,
  engine: DeterministicFakeProviderEngine,
  seed: string,
): AnyProviderPort {
  const portKind = entry.port_kind;
  const providerId = entry.provider_capabilities[0]?.provider_id;
  if (providerId === undefined) throw new ProviderContractError("incompatible_port");
  const base = createBasePort(portKind, providerId, entry, engine);
  const reference = (invocation: FakeProviderInvocation, resultKind: string, values: readonly ProviderReference[]): ProviderReference => {
    return createProviderReference(deterministicFakeReference(seed, invocation, resultKind, values));
  };

  switch (portKind) {
    case "channel":
      return Object.freeze({
        ...base,
        portKind: "channel" as const,
        async open(input: ChannelOpenRequest, control: ProviderOperationControl): Promise<ChannelConnection> {
          const invocation = await engine.run(operation("channel", "open"), control);
          return Object.freeze({ connectionReference: reference(invocation, "connection", [input.channelReference]), state: "connected" as const });
        },
        async closeConnection(_input: ChannelConnection, control: ProviderOperationControl): Promise<void> {
          await engine.run(operation("channel", "closeConnection"), control);
        },
      }) as ChannelPort;
    case "realtime_model":
      return Object.freeze({
        ...base,
        portKind: "realtime_model" as const,
        async openSession(input: RealtimeModelSessionRequest, control: ProviderOperationControl): Promise<RealtimeModelSession> {
          const invocation = await engine.run(operation("realtime_model", "openSession"), control);
          return Object.freeze({ providerSessionReference: reference(invocation, "session", [input.sessionReference]), expiresAt: SESSION_EXPIRY });
        },
        async closeSession(_input: RealtimeModelSession, control: ProviderOperationControl): Promise<void> {
          await engine.run(operation("realtime_model", "closeSession"), control);
        },
      }) as RealtimeModelPort;
    case "stt":
      return Object.freeze({
        ...base,
        portKind: "stt" as const,
        async transcribe(input: SpeechToTextRequest, control: ProviderOperationControl): Promise<UntrustedProviderOutput> {
          const invocation = await engine.run(operation("stt", "transcribe"), control);
          return Object.freeze({ outputReference: reference(invocation, "transcript", [input.audioReference]), dataClassification: "restricted" as const });
        },
      }) as SpeechToTextPort;
    case "tts":
      return Object.freeze({
        ...base,
        portKind: "tts" as const,
        async synthesize(input: TextToSpeechRequest, control: ProviderOperationControl): Promise<ProviderMediaOutput> {
          const invocation = await engine.run(operation("tts", "synthesize"), control);
          return Object.freeze({ mediaReference: reference(invocation, "audio", [input.textReference, input.voiceReference]) });
        },
      }) as TextToSpeechPort;
    case "avatar":
      return Object.freeze({
        ...base,
        portKind: "avatar" as const,
        async render(input: AvatarRenderRequest, control: ProviderOperationControl): Promise<ProviderMediaOutput> {
          const invocation = await engine.run(operation("avatar", "render"), control);
          return Object.freeze({ mediaReference: reference(invocation, "video", [input.avatarReference, input.audioReference]) });
        },
      }) as AvatarPort;
    case "meeting":
      return Object.freeze({
        ...base,
        portKind: "meeting" as const,
        async join(input: MeetingJoinRequest, control: ProviderOperationControl): Promise<MeetingConnection> {
          const invocation = await engine.run(operation("meeting", "join"), control);
          return Object.freeze({ connectionReference: reference(invocation, "connection", [input.meetingReference]), lifecycle: "active" as const });
        },
        async leave(_input: MeetingConnection, control: ProviderOperationControl): Promise<void> {
          await engine.run(operation("meeting", "leave"), control);
        },
      }) as MeetingPort;
    case "telephony":
      return Object.freeze({
        ...base,
        portKind: "telephony" as const,
        async connect(input: TelephonyConnectRequest, control: ProviderOperationControl): Promise<TelephonyConnection> {
          const invocation = await engine.run(operation("telephony", "connect"), control);
          return Object.freeze({ connectionReference: reference(invocation, "connection", [input.callReference]), lifecycle: "active" as const });
        },
        async disconnect(_input: TelephonyConnection, control: ProviderOperationControl): Promise<void> {
          await engine.run(operation("telephony", "disconnect"), control);
        },
      }) as TelephonyPort;
    case "tool":
      return Object.freeze({
        ...base,
        portKind: "tool" as const,
        async executeAuthorized(_input: AuthorizedToolExecution, _control: ProviderOperationControl): Promise<never> {
          throw new ProviderContractError("action_runtime_required");
        },
      }) as ToolPort;
    case "storage":
      return Object.freeze({
        ...base,
        portKind: "storage" as const,
        async read(_input: ProviderStorageAccess, control: ProviderOperationControl): Promise<UntrustedProviderOutput> {
          const invocation = await engine.run(operation("storage", "read"), control);
          return Object.freeze({ outputReference: reference(invocation, "storage_read", []), dataClassification: "restricted" as const });
        },
        async write(input: StorageWriteRequest, control: ProviderOperationControl) {
          await engine.run(operation("storage", "write"), control);
          return input.storageReference;
        },
      }) as StoragePort;
  }
}

function createBasePort(
  portKind: ProviderPortKind,
  providerId: string,
  entry: ProviderRegistryEntry,
  engine: DeterministicFakeProviderEngine,
): ProviderPort<ProviderPortKind> {
  return Object.freeze({
    providerId: parseProviderId(providerId),
    portKind,
    providerMode: "fake" as const,
    capabilities: () => entry.provider_capabilities,
    async health(control: ProviderOperationControl): Promise<ProviderHealth> {
      await engine.run(operation(portKind, "health"), control);
      return Object.freeze({ status: "healthy" as const, circuitState: "closed" as const, checkedAt: EVALUATED_AT, latencyMs: 0, failureCode: undefined }) as unknown as ProviderHealth;
    },
    async estimateCost(input: ProviderCostEstimate, control: ProviderOperationControl): Promise<ProviderCostEstimateResult> {
      await engine.run(operation(portKind, "estimateCost"), control);
      const estimatedUsdMicros = Math.min(Number.MAX_SAFE_INTEGER, Math.round(input.quantity * COST_MICROS_PER_UNIT[portKind]));
      return Object.freeze({ quantity: input.quantity, unit: input.unit, estimatedUsdMicros });
    },
    async close(control: ProviderOperationControl) {
      await engine.run(operation(portKind, "close"), control);
    },
  }) as unknown as ProviderPort<ProviderPortKind>;
}

function operation(portKind: ProviderPortKind, method: string): FakeProviderOperation {
  const value = `${portKind}.${method}`;
  if (!(FAKE_PROVIDER_OPERATIONS as readonly string[]).includes(value)) throw new ProviderContractError("invalid_contract");
  return value as FakeProviderOperation;
}
