import type { CostEvent, ProviderCapability, ToolExecutionReceipt } from "@axtro/contracts-ts";
import { UUID_V7_PATTERN as TENANT_ID_PATTERN } from "@axtro/domain";

import type { ProviderOperationControl, ProviderHealth } from "./operation.js";
import { ProviderContractError, type ProviderId, type ProviderPortKind } from "./normalization.js";
import type { AuthorizedToolExecution } from "./tool.js";

declare const providerReferenceBrand: unique symbol;
declare const providerStorageReferenceBrand: unique symbol;
declare const providerStorageScopeBrand: unique symbol;

export type ProviderReference = string & { readonly [providerReferenceBrand]: "ProviderReference" };
/**
 * Process-local sealed capability. It is not a path, URL, tenant identifier or
 * serializable object-key representation.
 */
export type ProviderStorageReference = object & { readonly [providerStorageReferenceBrand]: "ProviderStorageReference" };
/** Server-side tenant scope that cannot be structurally recreated by a caller. */
export type ProviderStorageScope = object & { readonly [providerStorageScopeBrand]: "ProviderStorageScope" };
export type ProviderCostUnit = CostEvent["unit_type"];

export interface ProviderCostEstimate {
  readonly quantity: number;
  readonly unit: ProviderCostUnit;
}

export interface ProviderCostEstimateResult {
  readonly quantity: number;
  readonly unit: ProviderCostUnit;
  readonly estimatedUsdMicros: number;
}

/** Every provider remains fake-only until its own future bake-off and promotion gate. */
export interface ProviderPort<Kind extends ProviderPortKind> {
  readonly providerId: ProviderId;
  readonly portKind: Kind;
  readonly providerMode: "fake";
  capabilities(): readonly ProviderCapability[];
  health(control: ProviderOperationControl): Promise<ProviderHealth>;
  estimateCost(input: ProviderCostEstimate, control: ProviderOperationControl): Promise<ProviderCostEstimateResult>;
  close(control: ProviderOperationControl): Promise<void>;
}

export interface ChannelPort extends ProviderPort<"channel"> {
  open(input: ChannelOpenRequest, control: ProviderOperationControl): Promise<ChannelConnection>;
  closeConnection(input: ChannelConnection, control: ProviderOperationControl): Promise<void>;
}

export interface RealtimeModelPort extends ProviderPort<"realtime_model"> {
  openSession(input: RealtimeModelSessionRequest, control: ProviderOperationControl): Promise<RealtimeModelSession>;
  closeSession(input: RealtimeModelSession, control: ProviderOperationControl): Promise<void>;
}

export interface SpeechToTextPort extends ProviderPort<"stt"> {
  transcribe(input: SpeechToTextRequest, control: ProviderOperationControl): Promise<UntrustedProviderOutput>;
}

export interface TextToSpeechPort extends ProviderPort<"tts"> {
  synthesize(input: TextToSpeechRequest, control: ProviderOperationControl): Promise<ProviderMediaOutput>;
}

export interface AvatarPort extends ProviderPort<"avatar"> {
  render(input: AvatarRenderRequest, control: ProviderOperationControl): Promise<ProviderMediaOutput>;
}

export interface MeetingPort extends ProviderPort<"meeting"> {
  join(input: MeetingJoinRequest, control: ProviderOperationControl): Promise<MeetingConnection>;
  leave(input: MeetingConnection, control: ProviderOperationControl): Promise<void>;
}

export interface TelephonyPort extends ProviderPort<"telephony"> {
  connect(input: TelephonyConnectRequest, control: ProviderOperationControl): Promise<TelephonyConnection>;
  disconnect(input: TelephonyConnection, control: ProviderOperationControl): Promise<void>;
}

/** This port cannot accept model text, an arbitrary payload, or a forged policy decision. */
export interface ToolPort extends ProviderPort<"tool"> {
  executeAuthorized(input: AuthorizedToolExecution, control: ProviderOperationControl): Promise<ToolExecutionReceipt>;
}

export interface StoragePort extends ProviderPort<"storage"> {
  read(input: ProviderStorageAccess, control: ProviderOperationControl): Promise<UntrustedProviderOutput>;
  write(input: StorageWriteRequest, control: ProviderOperationControl): Promise<ProviderStorageReference>;
}

export type AnyProviderPort =
  | ChannelPort
  | RealtimeModelPort
  | SpeechToTextPort
  | TextToSpeechPort
  | AvatarPort
  | MeetingPort
  | TelephonyPort
  | ToolPort
  | StoragePort;

export type ProviderPortForKind<Kind extends ProviderPortKind> = Extract<AnyProviderPort, { readonly portKind: Kind }>;

export interface ChannelOpenRequest {
  readonly channelReference: ProviderReference;
}

export interface ChannelConnection {
  readonly connectionReference: ProviderReference;
  readonly state: "connected" | "disconnected";
}

export interface RealtimeModelSessionRequest {
  readonly sessionReference: ProviderReference;
  readonly mode: "modular" | "s2s";
}

export interface RealtimeModelSession {
  readonly providerSessionReference: ProviderReference;
  readonly expiresAt: string;
}

export interface SpeechToTextRequest {
  readonly audioReference: ProviderReference;
  readonly language: "pt-BR" | "en-US";
}

export interface TextToSpeechRequest {
  readonly textReference: ProviderReference;
  readonly voiceReference: ProviderReference;
  readonly language: "pt-BR" | "en-US";
}

export interface AvatarRenderRequest {
  readonly avatarReference: ProviderReference;
  readonly audioReference: ProviderReference;
}

export interface ProviderMediaOutput {
  readonly mediaReference: ProviderReference;
}

/** Provider outputs remain data. Parsing and authorization happen above this port. */
export interface UntrustedProviderOutput {
  readonly outputReference: ProviderReference;
  readonly dataClassification: "internal" | "confidential" | "restricted";
}

export interface MeetingJoinRequest {
  readonly meetingReference: ProviderReference;
}

export interface MeetingConnection {
  readonly connectionReference: ProviderReference;
  readonly lifecycle: "joining" | "waiting_room" | "active" | "removed" | "reconnecting" | "done";
}

export interface TelephonyConnectRequest {
  readonly callReference: ProviderReference;
}

export interface TelephonyConnection {
  readonly connectionReference: ProviderReference;
  readonly lifecycle: "connecting" | "active" | "disconnected" | "failed";
}

/** A scope and its reference are validated by the registry before any storage adapter runs. */
export interface ProviderStorageAccess {
  readonly storageScope: ProviderStorageScope;
  readonly storageReference: ProviderStorageReference;
}

export interface StorageWriteRequest extends ProviderStorageAccess {
  readonly contentReference: ProviderReference;
  readonly dataClassification: "internal" | "confidential" | "restricted";
}

/**
 * The control plane owns this authority after authenticating the caller. It
 * maps a tenant-scoped object key to one opaque reference outside the provider
 * wire. M0 deliberately does not expose object keys or tenant IDs here.
 */
export interface ProviderStorageAuthority {
  createScope(tenantId: unknown): ProviderStorageScope;
  issueReference(scope: ProviderStorageScope): ProviderStorageReference;
}

const storageScopes = new WeakMap<object, string>();
const storageReferenceOwners = new WeakMap<object, object>();
const PROVIDER_REFERENCE_PATTERN = /^ref_[a-z0-9]{12,64}$/;

/** Create a private capability authority, retained only by a trusted application boundary. */
export function createProviderStorageAuthority(): ProviderStorageAuthority {
  return Object.freeze({
    createScope(tenantId: unknown): ProviderStorageScope {
      if (typeof tenantId !== "string" || !TENANT_ID_PATTERN.test(tenantId)) {
        throw new ProviderContractError("invalid_storage_reference");
      }
      const scope = Object.freeze(Object.create(null)) as ProviderStorageScope;
      storageScopes.set(scope, tenantId);
      return scope;
    },
    issueReference(scope: ProviderStorageScope): ProviderStorageReference {
      assertProviderStorageScope(scope);
      const reference = Object.freeze(Object.create(null)) as ProviderStorageReference;
      storageReferenceOwners.set(reference, scope);
      return reference;
    },
  });
}

/** Reject cross-tenant, raw, copied and structurally forged storage references. */
export function assertProviderStorageAccess(value: unknown): asserts value is ProviderStorageAccess {
  const record = plainRecord(value);
  assertExactKeys(record, ["storageScope", "storageReference"]);
  const scope = readRequired(record, "storageScope");
  const reference = readRequired(record, "storageReference");
  assertProviderStorageScope(scope);
  if (reference === null || typeof reference !== "object" || storageReferenceOwners.get(reference) !== scope) {
    throw new ProviderContractError("invalid_storage_reference");
  }
}

/** Trusted boundaries mint opaque references. Raw paths, URLs, tenant IDs and provider IDs are invalid. */
export function createProviderReference(value: unknown): ProviderReference {
  if (typeof value !== "string" || !PROVIDER_REFERENCE_PATTERN.test(value)) throw new ProviderContractError();
  return value as ProviderReference;
}

export function assertProviderReference(value: unknown): asserts value is ProviderReference {
  if (typeof value !== "string" || !PROVIDER_REFERENCE_PATTERN.test(value)) throw new ProviderContractError();
}

function assertProviderStorageScope(value: unknown): asserts value is ProviderStorageScope {
  if (value === null || typeof value !== "object" || !storageScopes.has(value)) {
    throw new ProviderContractError("invalid_storage_reference");
  }
}

function plainRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ProviderContractError("invalid_storage_reference");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new ProviderContractError("invalid_storage_reference");
  return value as Record<string, unknown>;
}

function assertExactKeys(record: Record<string, unknown>, expected: readonly string[]): void {
  const keys = Reflect.ownKeys(record);
  if (keys.length !== expected.length || keys.some((key) => typeof key !== "string" || !expected.includes(key))) {
    throw new ProviderContractError("invalid_storage_reference");
  }
}

function readRequired(record: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor === undefined || !("value" in descriptor)) throw new ProviderContractError("invalid_storage_reference");
  return descriptor.value;
}
