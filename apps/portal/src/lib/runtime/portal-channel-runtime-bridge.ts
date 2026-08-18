import { createUuidV7, sha256Canonical } from "@axtro/domain";
import { createServiceRoleClient } from "../supabase/service.ts";

/**
 * ADR-038 control-plane boundary. This module deliberately has no provider
 * SDK imports: a grant authorizes a later provider reservation/dispatch, but
 * never creates a provider resource by itself.
 */
export const PORTAL_RUNTIME_BRIDGE_RPC = Object.freeze({
  admit: "portal_admit_runtime_channel_service",
  consume: "portal_consume_runtime_channel_grant_service",
  bind: "portal_bind_runtime_provider_channel_service",
  executeScene: "portal_execute_runtime_scene_service",
  status: "portal_runtime_channel_status_service",
});

const STATUS_CAPABILITIES = Object.freeze({
  admission: "channel_admission",
  providerDispatch: "provider_dispatch",
  scenePublish: "scene_publish",
});

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CHANNEL_PATTERN = /^[a-z][a-z0-9_]{2,63}$/;
const CHANNELS = new Set(["tavus_video", "recall_meeting"]);
const PROVIDER_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:._/-]{1,254}$/;
const PURPOSES = ["recording", "persistent_transcription", "behavioral_analysis", "visual_analysis"] as const;

export type PortalChannelPurpose = (typeof PURPOSES)[number];
export type PortalChannelConsumerKind = "tavus" | "recall" | "scene";
export type PortalRuntimeOutcomeCode =
  | "admitted"
  | "replayed"
  | "bound"
  | "scene_executed"
  | "bridge_disabled"
  | "kill_switch_active"
  | "channel_inactive"
  | "denied_disclosure"
  | "denied_essential_consent"
  | "denied_optional_consent"
  | "missing_actor_proof"
  | "one_mouth_conflict"
  | "grant_invalid"
  | "grant_consumed"
  | "stale_generation"
  | "scene_rejected"
  | "service_unavailable";

export interface PortalChannelConsentConfirmation {
  readonly disclosure: boolean;
  readonly essentialProcessing: boolean;
  readonly recording: boolean;
  readonly transcription: boolean;
  readonly behavioralAnalysis: boolean;
  readonly visualAnalysis: boolean;
}

export interface PortalChannelDisclosureConfirmation {
  readonly deliveredBy: "authenticated_portal" | "control_tower" | "provider_callback";
  /** Required for non-user channel admissions; issued and verified server-side. */
  readonly proofId?: string;
  readonly version?: string;
  readonly contentHash?: string;
  readonly channel?: "spoken" | "visual" | "chat";
  readonly language?: string;
}

export interface PortalChannelAdmissionEvidence {
  readonly admissionId: string;
  readonly sessionId: string;
  readonly disclosureId: string;
  readonly essentialConsentId: string;
  readonly optionalConsentIds: Readonly<Record<PortalChannelPurpose, string | null>>;
}

export interface AdmitPortalChannelInput {
  readonly tenantId: string;
  readonly agentId: string;
  /** A server-derived command ID. A browser must never choose this value. */
  readonly commandId: string;
  readonly channel: string;
  /**
   * Tenant-scoped UUIDv7 actor identity resolved from signed server session
   * metadata, never a browser-provided user id. Supabase auth user IDs are
   * UUIDv4 and are deliberately not accepted by the runtime contract.
   */
  readonly actorId?: string;
  /** Required for a non-user channel such as the control tower lead bridge. */
  readonly controlTowerActorId?: string;
  readonly requestedPurposes: readonly PortalChannelPurpose[];
  readonly confirmation: PortalChannelConsentConfirmation;
  readonly disclosure: PortalChannelDisclosureConfirmation;
  readonly externalRef?: string;
  /** Allows a transport retry to reuse its server-created evidence identifiers. */
  readonly evidence?: PortalChannelAdmissionEvidence;
  readonly presenterId?: string;
  readonly generation?: number;
}

export interface PortalChannelGrant {
  readonly tenantId: string;
  readonly agentId: string;
  readonly channel: string;
  readonly sessionId: string;
  readonly grantId: string;
  readonly presenterId: string;
  readonly generationId: number;
  readonly commandFingerprint: string;
  readonly capabilitySet: readonly string[];
}

export type PortalChannelAdmissionResult =
  | Readonly<{ readonly outcome: "admitted" | "replayed"; readonly code: "admitted" | "replayed"; readonly grant: PortalChannelGrant }>
  | Readonly<{ readonly outcome: "rejected"; readonly code: Exclude<PortalRuntimeOutcomeCode, "admitted" | "replayed" | "bound" | "scene_executed"> }>;

export interface PortalChannelGrantInput {
  readonly grant: PortalChannelGrant;
}

export type PortalChannelConsumeResult =
  | Readonly<{ readonly outcome: "consumed"; readonly code: "admitted" | "replayed" }>
  | Readonly<{ readonly outcome: "rejected"; readonly code: "bridge_disabled" | "kill_switch_active" | "channel_inactive" | "grant_invalid" | "grant_consumed" | "service_unavailable" }>;

export interface BindPortalProviderChannelInput extends PortalChannelGrantInput {
  readonly reservationId: string;
  readonly provider: "tavus" | "recall";
  readonly providerRef: string;
  readonly providerUrl?: string | null;
  readonly bindingId?: string;
}

export type PortalProviderBindingResult =
  | Readonly<{ readonly outcome: "bound" | "replayed"; readonly code: "bound" | "replayed" }>
  | Readonly<{ readonly outcome: "rejected"; readonly code: "bridge_disabled" | "kill_switch_active" | "channel_inactive" | "grant_invalid" | "grant_consumed" | "service_unavailable" }>;

export interface PortalChannelStatusInput {
  readonly tenantId: string;
  readonly agentId: string;
  readonly channel: string;
  readonly capability: "channel_admission" | "provider_dispatch" | "scene_publish" | string;
}

export interface PortalChannelStatus {
  readonly active: true;
  readonly generationId: number | null;
}

export type PortalChannelStatusResult =
  | Readonly<{ readonly outcome: "active"; readonly code: "admitted"; readonly status: PortalChannelStatus }>
  | Readonly<{ readonly outcome: "rejected"; readonly code: "bridge_disabled" | "kill_switch_active" | "channel_inactive" | "service_unavailable" }>;

export interface SceneDirectiveLike {
  readonly manifestId: string;
  readonly generationId: number;
}

export type SceneSelectionLike =
  | Readonly<{ readonly outcome: "accepted"; readonly directive: SceneDirectiveLike }>
  | Readonly<{ readonly outcome: "rejected"; readonly reason: string }>;

/** Structural port for @axtro/scene-director; it stays injectable for deterministic tests. */
export interface PortalSceneDirector {
  selectScene(intent: unknown, availableChannelCapabilities: readonly string[]): SceneSelectionLike;
}

export interface ExecutePortalSceneIntentInput extends PortalChannelGrantInput {
  readonly sceneIntent: { readonly generationId: number } & Record<string, unknown>;
  readonly sceneId?: string;
}

export type PortalSceneExecutionResult =
  | Readonly<{ readonly outcome: "executed"; readonly code: "scene_executed"; readonly directive: SceneDirectiveLike }>
  | Readonly<{ readonly outcome: "rejected"; readonly code: "bridge_disabled" | "kill_switch_active" | "channel_inactive" | "grant_invalid" | "stale_generation" | "scene_rejected" | "service_unavailable" }>;

export interface PortalRuntimeRpcResult {
  readonly data: unknown;
  readonly error: { readonly message?: string } | null;
}

export interface PortalRuntimeRpcClient {
  rpc(name: string, parameters?: Readonly<Record<string, unknown>>): PromiseLike<PortalRuntimeRpcResult>;
}

export interface PortalChannelRuntimeBridgeDependencies {
  readonly rpc?: PortalRuntimeRpcClient;
  readonly env?: Pick<NodeJS.ProcessEnv, "PORTAL_RUNTIME_BRIDGE_ENABLED">;
  readonly idGenerator?: () => string;
  readonly sceneDirector?: PortalSceneDirector;
}

export interface PortalChannelRuntimeBridge {
  admitPortalChannel(input: AdmitPortalChannelInput): Promise<PortalChannelAdmissionResult>;
  consumePortalChannelGrant(input: PortalChannelGrantInput & { readonly consumerKind: PortalChannelConsumerKind }): Promise<PortalChannelConsumeResult>;
  /** Atomic durable grant revalidation immediately before provider dispatch. */
  assertPortalProviderDispatchActive(input: PortalChannelGrantInput & { readonly consumerKind: "tavus" | "recall" }): Promise<PortalChannelConsumeResult>;
  bindPortalProviderChannel(input: BindPortalProviderChannelInput): Promise<PortalProviderBindingResult>;
  assertPortalChannelActive(input: PortalChannelStatusInput): Promise<PortalChannelStatusResult>;
  executePortalSceneIntent(input: ExecutePortalSceneIntentInput): Promise<PortalSceneExecutionResult>;
}

export class PortalRuntimeBridgeInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PortalRuntimeBridgeInputError";
  }
}

export class PortalRuntimeBridgeServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PortalRuntimeBridgeServiceError";
  }
}

function ownRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null ? value as Record<string, unknown> : null;
}

function readString(record: Record<string, unknown>, key: string): string | null {
  return typeof record[key] === "string" ? record[key] : null;
}

function readGeneration(record: Record<string, unknown>): number | null {
  const value = record.generationId ?? record.generation;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function assertUuid(value: unknown, name: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) throw new PortalRuntimeBridgeInputError(`${name} must be a UUID`);
  return value;
}

function assertUuidV7(value: unknown, name: string): string {
  const id = assertUuid(value, name);
  if (!UUID_V7_PATTERN.test(id)) throw new PortalRuntimeBridgeInputError(`${name} must be a UUIDv7`);
  return id;
}

function assertChannel(value: unknown): string {
  if (typeof value !== "string" || !CHANNELS.has(value)) throw new PortalRuntimeBridgeInputError("channel is invalid");
  return value;
}

function assertGeneration(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new PortalRuntimeBridgeInputError(`${name} is invalid`);
  return value;
}

function canonicalPurposes(value: readonly PortalChannelPurpose[]): readonly PortalChannelPurpose[] {
  if (!Array.isArray(value) || value.some((purpose) => !(PURPOSES as readonly string[]).includes(purpose))) {
    throw new PortalRuntimeBridgeInputError("requested purposes are invalid");
  }
  return Object.freeze([...new Set(value)].sort() as PortalChannelPurpose[]);
}

function checkedConfirmation(value: PortalChannelConsentConfirmation): PortalChannelConsentConfirmation {
  const record = ownRecord(value);
  const expected = ["behavioralAnalysis", "disclosure", "essentialProcessing", "recording", "transcription", "visualAnalysis"];
  if (!record || Object.keys(record).sort().join("\u001f") !== expected.join("\u001f") || expected.some((key) => typeof record[key] !== "boolean")) {
    throw new PortalRuntimeBridgeInputError("consent confirmation is invalid");
  }
  return Object.freeze({
    disclosure: record.disclosure as boolean,
    essentialProcessing: record.essentialProcessing as boolean,
    recording: record.recording as boolean,
    transcription: record.transcription as boolean,
    behavioralAnalysis: record.behavioralAnalysis as boolean,
    visualAnalysis: record.visualAnalysis as boolean,
  });
}

function consentFailure(confirmation: PortalChannelConsentConfirmation, purposes: readonly PortalChannelPurpose[]): PortalRuntimeOutcomeCode | null {
  if (!confirmation.disclosure) return "denied_disclosure";
  if (!confirmation.essentialProcessing) return "denied_essential_consent";
  const enabled: Readonly<Record<PortalChannelPurpose, boolean>> = {
    recording: confirmation.recording,
    persistent_transcription: confirmation.transcription,
    behavioral_analysis: confirmation.behavioralAnalysis,
    visual_analysis: confirmation.visualAnalysis,
  };
  return purposes.some((purpose) => !enabled[purpose]) ? "denied_optional_consent" : null;
}

function capabilitySet(purposes: readonly PortalChannelPurpose[]): readonly string[] {
  return Object.freeze(["scene_presentation", ...purposes]);
}

function processEnabled(env: Pick<NodeJS.ProcessEnv, "PORTAL_RUNTIME_BRIDGE_ENABLED">): boolean {
  return env.PORTAL_RUNTIME_BRIDGE_ENABLED === "true";
}

async function rpcValue(client: PortalRuntimeRpcClient, name: string, parameters: Readonly<Record<string, unknown>>): Promise<unknown> {
  const response = await client.rpc(name, parameters);
  if (response.error !== null) throw new PortalRuntimeBridgeServiceError(`runtime bridge ${name} failed: ${response.error.message ?? "unknown error"}`);
  return response.data;
}

async function rpc(client: PortalRuntimeRpcClient, name: string, parameters: Readonly<Record<string, unknown>>): Promise<Record<string, unknown>> {
  const data = await rpcValue(client, name, parameters);
  const result = ownRecord(data);
  if (result === null) throw new PortalRuntimeBridgeServiceError(`runtime bridge ${name} returned an invalid receipt`);
  return result;
}

function rejection(code: Exclude<PortalRuntimeOutcomeCode, "admitted" | "replayed" | "bound" | "scene_executed">): Readonly<{ readonly outcome: "rejected"; readonly code: Exclude<PortalRuntimeOutcomeCode, "admitted" | "replayed" | "bound" | "scene_executed"> }> {
  return Object.freeze({ outcome: "rejected", code });
}

function asScopedRejection(code: unknown): "kill_switch_active" | "channel_inactive" {
  return code === "kill_switch_active" ? "kill_switch_active" : "channel_inactive";
}

function requiredSceneDirector(value: PortalSceneDirector | undefined): PortalSceneDirector {
  if (!value) throw new PortalRuntimeBridgeInputError("scene director is required to execute a scene");
  return value;
}

/**
 * This helper is server-only by convention: caller identity must already be
 * resolved from a signed session or server-issued control-tower proof. The
 * evidence IDs are passed to the v43 RPC, which writes/replays them atomically
 * with the session and grant; no client-side checkbox is durable authority.
 */
export function createPortalChannelAdmissionEvidence(
  requestedPurposes: readonly PortalChannelPurpose[],
  idGenerator: () => string = createUuidV7,
): PortalChannelAdmissionEvidence {
  const purposes = canonicalPurposes(requestedPurposes);
  const next = (name: string): string => assertUuid(idGenerator(), name);
  const optionalConsentIds: Record<PortalChannelPurpose, string | null> = {
    recording: null,
    persistent_transcription: null,
    behavioral_analysis: null,
    visual_analysis: null,
  };
  for (const purpose of purposes) optionalConsentIds[purpose] = next(`${purpose} consent id`);
  return Object.freeze({
    admissionId: next("admission id"),
    sessionId: next("session id"),
    disclosureId: next("disclosure id"),
    essentialConsentId: next("essential consent id"),
    optionalConsentIds: Object.freeze(optionalConsentIds),
  });
}

export function createPortalChannelRuntimeBridge(dependencies: PortalChannelRuntimeBridgeDependencies = {}): PortalChannelRuntimeBridge {
  const client = dependencies.rpc ?? createServiceRoleClient();
  const env = dependencies.env ?? process.env;
  const idGenerator = dependencies.idGenerator ?? createUuidV7;
  const sceneDirector = dependencies.sceneDirector;

  const assertPortalChannelActive = async (input: PortalChannelStatusInput): Promise<PortalChannelStatusResult> => {
    if (!processEnabled(env)) return rejection("bridge_disabled");
    const tenantId = assertUuidV7(input.tenantId, "tenantId");
    const agentId = assertUuidV7(input.agentId, "agentId");
    const channel = assertChannel(input.channel);
    if (typeof input.capability !== "string" || !CHANNEL_PATTERN.test(input.capability)) throw new PortalRuntimeBridgeInputError("runtime capability is invalid");
    try {
      const receipt = await rpc(client, PORTAL_RUNTIME_BRIDGE_RPC.status, {
        p_tenant_id: tenantId,
        p_agent_id: agentId,
        p_channel_kind: channel,
        p_capability: input.capability,
      });
      if (receipt.enabled !== true) return rejection(asScopedRejection(receipt.code));
      return Object.freeze({ outcome: "active", code: "admitted", status: Object.freeze({ active: true, generationId: readGeneration(receipt) }) });
    } catch (error) {
      if (error instanceof PortalRuntimeBridgeInputError) throw error;
      return rejection("service_unavailable");
    }
  };

  const admitPortalChannel = async (input: AdmitPortalChannelInput): Promise<PortalChannelAdmissionResult> => {
    if (!processEnabled(env)) return rejection("bridge_disabled");
    const tenantId = assertUuidV7(input.tenantId, "tenantId");
    const agentId = assertUuidV7(input.agentId, "agentId");
    const commandId = assertUuidV7(input.commandId, "commandId");
    const channel = assertChannel(input.channel);
    const purposes = canonicalPurposes(input.requestedPurposes);
    const confirmation = checkedConfirmation(input.confirmation);
    const failedConsent = consentFailure(confirmation, purposes);
    if (failedConsent) return rejection(failedConsent);

    const actorId = input.actorId === undefined ? null : assertUuidV7(input.actorId, "actorId");
    const controlTowerActorId = input.controlTowerActorId === undefined ? null : assertUuidV7(input.controlTowerActorId, "controlTowerActorId");
    if ((actorId === null) === (controlTowerActorId === null)) return rejection("missing_actor_proof");
    if (input.disclosure.deliveredBy === "control_tower" && (typeof input.disclosure.proofId !== "string" || input.disclosure.proofId.length < 16 || input.disclosure.proofId.length > 200)) {
      return rejection("missing_actor_proof");
    }
    if (input.disclosure.deliveredBy !== "authenticated_portal" && input.disclosure.deliveredBy !== "control_tower" && input.disclosure.deliveredBy !== "provider_callback") {
      throw new PortalRuntimeBridgeInputError("disclosure delivery source is invalid");
    }
    const evidence = input.evidence ?? createPortalChannelAdmissionEvidence(purposes, idGenerator);
    const presenterId = input.presenterId === undefined ? assertUuidV7(idGenerator(), "presenterId") : assertUuidV7(input.presenterId, "presenterId");
    const generation = input.generation === undefined ? 0 : assertGeneration(input.generation, "generation");
    const externalRef = input.externalRef === undefined ? null : input.externalRef;
    if (externalRef !== null && (typeof externalRef !== "string" || externalRef.length === 0 || externalRef.length > 200)) throw new PortalRuntimeBridgeInputError("externalRef is invalid");

    const preflight = await assertPortalChannelActive({ tenantId, agentId, channel, capability: STATUS_CAPABILITIES.admission });
    if (preflight.outcome === "rejected") return rejection(preflight.code);
    const commandFingerprint = sha256Canonical({
      tenantId,
      agentId,
      actorId: actorId ?? controlTowerActorId,
      channel,
      commandId,
      purposes,
      disclosure: input.disclosure,
      confirmation,
      externalRef,
    });
    try {
      const disclosureVersion = input.disclosure.version ?? "portal-runtime-v43";
      const disclosureHash = input.disclosure.contentHash ?? sha256Canonical({ version: disclosureVersion, content: "You are speaking with an Axtro virtual AI assistant." });
      const disclosureChannel = input.disclosure.channel ?? "chat";
      const disclosureLanguage = input.disclosure.language ?? "pt-BR";
      if (disclosureVersion.length === 0 || disclosureVersion.length > 100 || !/^[a-f0-9]{64}$/.test(disclosureHash) || !/^[a-z]{2}(-[A-Z]{2})?$/.test(disclosureLanguage)) {
        throw new PortalRuntimeBridgeInputError("disclosure evidence is invalid");
      }
      const effectiveActorId = actorId ?? controlTowerActorId!;
      const evidenceHash = (kind: string) => sha256Canonical({ actorId: effectiveActorId, commandId, tenantId, channel, kind, disclosureHash, confirmation });
      const subjectRef = `actor:${effectiveActorId}`;
      const optionalConsents = purposes.map((purpose) => ({
        id: assertUuidV7(evidence.optionalConsentIds[purpose], `${purpose} consent id`),
        capability: purpose,
        subjectRef,
        jurisdiction: "global",
        evidenceHash: evidenceHash(purpose),
        method: "click",
      }));
      const receipt = await rpc(client, PORTAL_RUNTIME_BRIDGE_RPC.admit, {
        p_admission_id: assertUuidV7(evidence.admissionId, "admissionId"),
        p_tenant_id: tenantId,
        p_actor_id: effectiveActorId,
        p_agent_id: agentId,
        p_session_id: assertUuidV7(evidence.sessionId, "sessionId"),
        p_presenter_id: presenterId,
        p_channel_kind: channel,
        p_capabilities: capabilitySet(purposes),
        p_command_fingerprint: commandFingerprint,
        p_generation: generation,
        p_disclosure_id: assertUuidV7(evidence.disclosureId, "disclosureId"),
        p_disclosure_version: disclosureVersion,
        p_disclosure_hash: disclosureHash,
        p_disclosure_channel: disclosureChannel,
        p_disclosure_language: disclosureLanguage,
        p_essential_consent: {
          id: assertUuidV7(evidence.essentialConsentId, "essentialConsentId"),
          subjectRef,
          jurisdiction: "global",
          evidenceHash: evidenceHash("essential_processing"),
          method: "click",
        },
        p_optional_consents: optionalConsents,
      });
      const outcome = receipt.outcome;
      if (outcome === "one_mouth_conflict") return rejection("one_mouth_conflict");
      if (outcome === "blocked_kill_switch") return rejection("kill_switch_active");
      if (outcome === "blocked_agent_inactive" || outcome === "expired") return rejection("channel_inactive");
      if (outcome !== "issued" && outcome !== "replayed") return rejection("service_unavailable");
      const sessionId = readString(receipt, "sessionId");
      const grantId = readString(receipt, "grantId");
      const receiptGeneration = readGeneration(receipt);
      if (!sessionId || !grantId || receiptGeneration === null) return rejection("service_unavailable");
      const grant: PortalChannelGrant = Object.freeze({
        tenantId,
        agentId,
        channel,
        sessionId: assertUuidV7(sessionId, "sessionId"),
        grantId: assertUuidV7(grantId, "grantId"),
        presenterId,
        generationId: receiptGeneration,
        commandFingerprint,
        capabilitySet: capabilitySet(purposes),
      });
      return Object.freeze({ outcome: outcome === "issued" ? "admitted" : "replayed", code: outcome === "issued" ? "admitted" : "replayed", grant });
    } catch (error) {
      if (error instanceof PortalRuntimeBridgeInputError) throw error;
      return rejection("service_unavailable");
    }
  };

  const consumePortalChannelGrant = async (input: PortalChannelGrantInput & { readonly consumerKind: PortalChannelConsumerKind }): Promise<PortalChannelConsumeResult> => {
    if (!processEnabled(env)) return rejection("bridge_disabled");
    if (input.consumerKind !== "tavus" && input.consumerKind !== "recall" && input.consumerKind !== "scene") {
      throw new PortalRuntimeBridgeInputError("grant consumer kind is invalid");
    }
    const grant = checkedGrant(input.grant);
    const preflight = await assertPortalChannelActive({ tenantId: grant.tenantId, agentId: grant.agentId, channel: grant.channel, capability: STATUS_CAPABILITIES.providerDispatch });
    if (preflight.outcome === "rejected") return rejection(preflight.code);
    try {
      const receipt = await rpc(client, PORTAL_RUNTIME_BRIDGE_RPC.consume, {
        p_grant_id: grant.grantId,
        p_command_fingerprint: grant.commandFingerprint,
        p_consumer_kind: input.consumerKind,
      });
      if (receipt.outcome === "acquired" || receipt.outcome === "replayed") return Object.freeze({ outcome: "consumed", code: receipt.outcome === "replayed" ? "replayed" : "admitted" });
      return rejection(receipt.code === "grant_invalid" ? "grant_invalid" : "grant_consumed");
    } catch (error) {
      if (error instanceof PortalRuntimeBridgeInputError) throw error;
      return rejection("service_unavailable");
    }
  };

  const assertPortalProviderDispatchActive = async (input: PortalChannelGrantInput & { readonly consumerKind: "tavus" | "recall" }): Promise<PortalChannelConsumeResult> =>
    consumePortalChannelGrant(input);

  const bindPortalProviderChannel = async (input: BindPortalProviderChannelInput): Promise<PortalProviderBindingResult> => {
    if (!processEnabled(env)) return rejection("bridge_disabled");
    const grant = checkedGrant(input.grant);
    const reservationId = assertUuid(input.reservationId, "reservationId");
    if (!PROVIDER_REF_PATTERN.test(input.providerRef)) throw new PortalRuntimeBridgeInputError("providerRef is invalid");
    if (input.providerUrl !== undefined && input.providerUrl !== null && (typeof input.providerUrl !== "string" || input.providerUrl.length > 2_000)) throw new PortalRuntimeBridgeInputError("providerUrl is invalid");
    const preflight = await assertPortalChannelActive({ tenantId: grant.tenantId, agentId: grant.agentId, channel: grant.channel, capability: STATUS_CAPABILITIES.providerDispatch });
    if (preflight.outcome === "rejected") return rejection(preflight.code);
    try {
      const receipt = await rpcValue(client, PORTAL_RUNTIME_BRIDGE_RPC.bind, {
        p_receipt_id: input.bindingId === undefined ? assertUuidV7(idGenerator(), "bindingId") : assertUuidV7(input.bindingId, "bindingId"),
        p_grant_id: grant.grantId,
        p_reservation_id: reservationId,
        p_provider_id: input.provider,
        p_provider_ref: input.providerRef,
        p_provider_url: input.providerUrl ?? null,
      });
      if (receipt === true) return Object.freeze({ outcome: "bound", code: "bound" });
      return rejection("grant_consumed");
    } catch (error) {
      if (error instanceof PortalRuntimeBridgeInputError) throw error;
      return rejection("service_unavailable");
    }
  };

  const executePortalSceneIntent = async (input: ExecutePortalSceneIntentInput): Promise<PortalSceneExecutionResult> => {
    if (!processEnabled(env)) return rejection("bridge_disabled");
    const grant = checkedGrant(input.grant);
    const generationId = assertGeneration(input.sceneIntent.generationId, "scene generation");
    const preflight = await assertPortalChannelActive({ tenantId: grant.tenantId, agentId: grant.agentId, channel: grant.channel, capability: STATUS_CAPABILITIES.scenePublish });
    if (preflight.outcome === "rejected") return rejection(preflight.code);
    if (generationId !== grant.generationId) return rejection("stale_generation");
    const consumed = await consumePortalChannelGrant({ grant, consumerKind: "scene" });
    if (consumed.outcome === "rejected") return rejection(consumed.code);
    const selected = requiredSceneDirector(sceneDirector).selectScene(input.sceneIntent, grant.capabilitySet);
    if (selected.outcome !== "accepted") return rejection("scene_rejected");
    if (selected.directive.generationId !== generationId) return rejection("stale_generation");
    try {
      const receipt = await rpcValue(client, PORTAL_RUNTIME_BRIDGE_RPC.executeScene, {
        p_receipt_id: input.sceneId === undefined ? assertUuidV7(idGenerator(), "sceneId") : assertUuidV7(input.sceneId, "sceneId"),
        p_grant_id: grant.grantId,
        p_scene_id: selected.directive.manifestId,
        p_manifest_id: selected.directive.manifestId,
        p_generation: generationId,
        p_outcome: "succeeded",
        p_effect_hash: sha256Canonical({ grantId: grant.grantId, directive: selected.directive, generationId }),
      });
      if (receipt !== true) return rejection("scene_rejected");
      return Object.freeze({ outcome: "executed", code: "scene_executed", directive: selected.directive });
    } catch (error) {
      if (error instanceof PortalRuntimeBridgeInputError) throw error;
      return rejection("service_unavailable");
    }
  };

  return Object.freeze({ admitPortalChannel, consumePortalChannelGrant, assertPortalProviderDispatchActive, bindPortalProviderChannel, assertPortalChannelActive, executePortalSceneIntent });
}

function checkedGrant(value: PortalChannelGrant): PortalChannelGrant {
  const record = ownRecord(value);
  if (!record || !Array.isArray(record.capabilitySet)) throw new PortalRuntimeBridgeInputError("channel grant is invalid");
  const capabilitySet = record.capabilitySet;
  if (capabilitySet.some((capability) => typeof capability !== "string" || !CHANNEL_PATTERN.test(capability))) throw new PortalRuntimeBridgeInputError("channel grant capabilities are invalid");
  const commandFingerprint = readString(record, "commandFingerprint");
  if (!commandFingerprint || !/^[a-f0-9]{64}$/.test(commandFingerprint)) throw new PortalRuntimeBridgeInputError("channel grant command fingerprint is invalid");
  return Object.freeze({
    tenantId: assertUuidV7(record.tenantId, "grant.tenantId"),
    agentId: assertUuidV7(record.agentId, "grant.agentId"),
    channel: assertChannel(record.channel),
    sessionId: assertUuidV7(record.sessionId, "grant.sessionId"),
    grantId: assertUuidV7(record.grantId, "grant.grantId"),
    presenterId: assertUuidV7(record.presenterId, "grant.presenterId"),
    generationId: assertGeneration(record.generationId, "grant.generationId"),
    commandFingerprint,
    capabilitySet: Object.freeze([...new Set(capabilitySet)].sort()),
  });
}

/** Production convenience wrappers. Prefer an injected bridge in tests. */
export async function admitPortalChannel(input: AdmitPortalChannelInput, dependencies?: PortalChannelRuntimeBridgeDependencies): Promise<PortalChannelAdmissionResult> {
  return createPortalChannelRuntimeBridge(dependencies).admitPortalChannel(input);
}

export async function consumePortalChannelGrant(input: PortalChannelGrantInput & { readonly consumerKind: PortalChannelConsumerKind }, dependencies?: PortalChannelRuntimeBridgeDependencies): Promise<PortalChannelConsumeResult> {
  return createPortalChannelRuntimeBridge(dependencies).consumePortalChannelGrant(input);
}

export async function assertPortalProviderDispatchActive(input: PortalChannelGrantInput & { readonly consumerKind: "tavus" | "recall" }, dependencies?: PortalChannelRuntimeBridgeDependencies): Promise<PortalChannelConsumeResult> {
  return createPortalChannelRuntimeBridge(dependencies).assertPortalProviderDispatchActive(input);
}

export async function bindPortalProviderChannel(input: BindPortalProviderChannelInput, dependencies?: PortalChannelRuntimeBridgeDependencies): Promise<PortalProviderBindingResult> {
  return createPortalChannelRuntimeBridge(dependencies).bindPortalProviderChannel(input);
}

export async function assertPortalChannelActive(input: PortalChannelStatusInput, dependencies?: PortalChannelRuntimeBridgeDependencies): Promise<PortalChannelStatusResult> {
  return createPortalChannelRuntimeBridge(dependencies).assertPortalChannelActive(input);
}

export async function executePortalSceneIntent(input: ExecutePortalSceneIntentInput, dependencies?: PortalChannelRuntimeBridgeDependencies): Promise<PortalSceneExecutionResult> {
  return createPortalChannelRuntimeBridge(dependencies).executePortalSceneIntent(input);
}
