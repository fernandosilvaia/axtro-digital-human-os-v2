import { createHash, createHmac, randomBytes } from "node:crypto";
import { performance } from "node:perf_hooks";

import type { PortalTextPreviewAdmission as ContractAdmission } from "@axtro/contracts-ts";
import { createUuidV7 } from "@axtro/domain";

import {
  issueTextPreviewStateToken,
  MAX_TEXT_PREVIEW_EXCHANGES,
  textPreviewStateBindingFingerprint,
  verifyTextPreviewStateToken,
  type TextPreviewStateBinding,
  type TextPreviewStatePayload,
  type TextPreviewStateTurn,
} from "../agent-preview/state-token.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const SHA256_FINGERPRINT_PATTERN = /^sha256:[0-9a-f]{64}$/;
const HMAC_FINGERPRINT_PATTERN = /^hmac-sha256:[0-9a-f]{64}$/;
const TRACE_ID_PATTERN = /^[0-9a-f]{32}$/;
const STATE_SECRET_PATTERN = /^[0-9a-f]{64}$/;
const PROVIDER_REQUEST_ID_PATTERN = /^[!-~]{1,128}$/;
const JURISDICTION_PATTERN = /^[A-Z]{2}(?:-[A-Z0-9]{1,3})?$/;
const SEMVER_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+$/;
const TURN_LEASE_MAX_MS = 90_000;
const EGRESS_GRANT_MAX_MS = 15_000;
const PORT_TIMEOUT_MAX_MS = 5_000;
const ADMISSION_TTL_SECONDS = 3_600;
const MAXIMUM_UTF8_ASSISTANT_REPLY = "\u0800".repeat(4_000);
const COMMAND_CLAIM_FINGERPRINT_DOMAIN = "axtro:portal-text-preview-command-claim:v1\0";
const COMPLETION_FINGERPRINT_DOMAIN = "axtro:portal-text-preview-completion:v1\0";
const ESSENTIAL_PROFILE_FINGERPRINT = "sha256:5f07f0bb93393c7fcd4412516db48f30fb3095fb31e9352cd2cf849b260a5173";
const PERSISTED_PROFILE_FINGERPRINT = "sha256:5062dd979ac79778052389f27069a16dfa8f33fb175d38181774415b1ff585b8";
const PROVIDER_CONFIGURATION_FINGERPRINT = "sha256:70e60ec32d8a29d0f6264a0545e2ea1d215d02fe164d90dadaa63e99e59472de";

const ADMISSION_KEYS = Object.freeze([
  "schema_version",
  "admission_id",
  "tenant_id",
  "actor_id",
  "agent_id",
  "session_id",
  "presenter_id",
  "profile_id",
  "profile_version",
  "profile_fingerprint",
  "provider_configuration_fingerprint",
  "client_session_ref_hash",
  "command_fingerprint",
  "identity_disclosure_id",
  "data_use_disclosure_id",
  "essential_consent_id",
  "privacy_policy_id",
  "jurisdiction",
  "privacy_policy_version",
  "privacy_policy_fingerprint",
  "transcript_consent_id",
  "transcript_id",
  "persistent_transcript",
  "status",
  "ttl_seconds",
  "issued_at",
  "expires_at",
] as const);

export const PORTAL_TEXT_PREVIEW_RPC = Object.freeze({
  admit: "portal_admit_text_preview_authenticated",
  acquireTurn: "portal_acquire_text_preview_turn_service",
  authorizeEgress: "portal_authorize_text_preview_egress_service",
  completeTurn: "portal_complete_text_preview_turn_service",
  reconcileProviderResponse: "portal_reconcile_text_preview_provider_response_service",
  failTurn: "portal_fail_text_preview_turn_service",
});

/** Exact argument names owned by migration 0049. Adapters must not translate them positionally. */
export const PORTAL_TEXT_PREVIEW_RPC_ARGUMENTS = Object.freeze({
  admit: Object.freeze([
    "p_admission_id", "p_agent_id", "p_session_id", "p_presenter_id",
    "p_client_session_ref_hash", "p_profile_id", "p_profile_version", "p_profile_fingerprint",
    "p_provider_configuration_fingerprint", "p_command_fingerprint", "p_identity_disclosure_id",
    "p_identity_disclosure_version", "p_identity_disclosure_hash", "p_data_use_disclosure_id",
    "p_data_use_disclosure_version", "p_data_use_disclosure_hash", "p_essential_consent_id",
    "p_transcript_consent_id", "p_transcript_id", "p_persistent_transcript", "p_expect_existing",
    "p_trace_id", "p_correlation_id", "p_session_created_event_id", "p_session_created_outbox_id",
    "p_session_prepared_event_id", "p_session_prepared_outbox_id", "p_disclosure_event_id",
    "p_disclosure_outbox_id", "p_consent_event_id", "p_consent_outbox_id", "p_activated_event_id",
    "p_activated_outbox_id", "p_cleanup_event_id", "p_cleanup_outbox_id",
  ]),
  acquireTurn: Object.freeze([
    "p_claim_id", "p_attempt_id", "p_admission_id", "p_command_ref_hash",
    "p_command_fingerprint", "p_expected_generation", "p_outcome_event_id", "p_outcome_outbox_id",
  ]),
  authorizeEgress: Object.freeze([
    "p_egress_id", "p_admission_id", "p_claim_id", "p_attempt_id",
    "p_expected_generation", "p_kind", "p_ai_usage_reservation_id",
  ]),
  completeTurn: Object.freeze([
    "p_admission_id", "p_claim_id", "p_attempt_id", "p_expected_generation",
    "p_command_fingerprint", "p_completion_fingerprint", "p_provider_request_id",
    "p_user_turn", "p_assistant_turn",
  ]),
  reconcileProviderResponse: Object.freeze([
    "p_admission_id", "p_claim_id", "p_attempt_id", "p_expected_generation",
    "p_command_fingerprint", "p_provider_request_id",
  ]),
  failTurn: Object.freeze([
    "p_admission_id", "p_claim_id", "p_attempt_id", "p_expected_generation",
    "p_command_fingerprint", "p_reason_code", "p_provider_request_id",
  ]),
});

export type PortalTextPreviewAdmission = ContractAdmission;
export type PortalTextPreviewPersistence = "disabled" | "saved" | "not_saved";
export type PortalTextPreviewEgressKind = "embedding" | "generation";

export interface PortalTextPreviewTurnGrant {
  readonly claimId: string;
  readonly attemptId: string;
  readonly admissionId: string;
  readonly generation: number;
  readonly commandFingerprint: string;
  readonly leaseExpiresAt: string;
}

export interface PortalTextPreviewEgressGrant {
  readonly egressId: string;
  readonly admissionId: string;
  readonly claimId: string;
  readonly attemptId: string;
  readonly generation: number;
  readonly kind: PortalTextPreviewEgressKind;
  readonly aiUsageReservationId: string;
  readonly authorizedAt: string;
  readonly expiresAt: string;
  readonly ttlMs: number;
  readonly localAuthorizedAtMonotonicMs: number;
}

export type PortalTextPreviewTurnBlockReason =
  | "invalid_request"
  | "admission_required"
  | "admission_expired"
  | "admission_mismatch"
  | "stale_generation"
  | "turn_in_flight"
  | "turn_already_processed"
  | "turn_replay_conflict"
  | "turn_failed"
  | "service_unavailable";

export type PortalTextPreviewTurnAcquisition =
  | Readonly<{ acquired: true; grant: PortalTextPreviewTurnGrant }>
  | Readonly<{ acquired: false; reason: PortalTextPreviewTurnBlockReason }>;

export interface PortalTextPreviewProfile {
  readonly profileId: ContractAdmission["profile_id"];
  readonly profileVersion: ContractAdmission["profile_version"];
  readonly profileFingerprint: string;
  readonly providerConfigurationFingerprint: string;
  readonly persistentTranscript: boolean;
}

export interface PortalTextPreviewDisclosureConfiguration {
  readonly identityVersion: string;
  readonly identityHash: string;
  readonly dataUseVersion: string;
  readonly dataUseHash: string;
}

export interface AdmitPortalTextPreviewInput {
  /** Must come from the authenticated server boundary, never from browser payload. */
  readonly authenticatedUserId: string;
  /** Expected result binding. The database derives the authoritative tenant. */
  readonly expectedTenantId: string;
  readonly agentId: string;
  readonly clientConversationId: string;
  readonly aiIdentityAcknowledged: true;
  readonly essentialProcessingAccepted: true;
  readonly persistentTranscript: boolean;
  readonly expectExisting: boolean;
}

type AdmissionArgs = Readonly<Record<(typeof PORTAL_TEXT_PREVIEW_RPC_ARGUMENTS.admit)[number], unknown>>;
type ClaimArgs = Readonly<Record<(typeof PORTAL_TEXT_PREVIEW_RPC_ARGUMENTS.acquireTurn)[number], unknown>>;
type EgressArgs = Readonly<Record<(typeof PORTAL_TEXT_PREVIEW_RPC_ARGUMENTS.authorizeEgress)[number], unknown>>;
type CompletionArgs = Readonly<Record<(typeof PORTAL_TEXT_PREVIEW_RPC_ARGUMENTS.completeTurn)[number], unknown>>;
type ReconciliationArgs = Readonly<Record<(typeof PORTAL_TEXT_PREVIEW_RPC_ARGUMENTS.reconcileProviderResponse)[number], unknown>>;
type FailureArgs = Readonly<Record<(typeof PORTAL_TEXT_PREVIEW_RPC_ARGUMENTS.failTurn)[number], unknown>>;

export interface PortalTextPreviewAdmissionPort {
  /** Creates durable disclosure, purpose consent and admission evidence atomically. */
  admit(args: AdmissionArgs): Promise<unknown>;
}

export interface PortalTextPreviewClaimPort {
  /** Revalidates live disclosure, policy and purpose consent before claiming a generation. */
  acquire(args: ClaimArgs): Promise<unknown>;
}

export interface PortalTextPreviewEgressPort {
  /** Revalidates all admission authority immediately before each provider egress. */
  authorize(args: EgressArgs): Promise<unknown>;
}

export interface PortalTextPreviewCompletionPort {
  /** Revalidates authority and commits one fenced terminal outcome. */
  complete(args: CompletionArgs): Promise<unknown>;
  reconcile(args: ReconciliationArgs): Promise<unknown>;
}

export interface PortalTextPreviewFailurePort {
  fail(args: FailureArgs): Promise<unknown>;
}

export interface PortalTextPreviewRuntimeDependencies {
  readonly ports: Readonly<{
    admission: PortalTextPreviewAdmissionPort;
    claim: PortalTextPreviewClaimPort;
    egress: PortalTextPreviewEgressPort;
    completion: PortalTextPreviewCompletionPort;
    failure: PortalTextPreviewFailurePort;
  }>;
  readonly profiles: Readonly<{
    essential: PortalTextPreviewProfile;
    persisted: PortalTextPreviewProfile;
  }>;
  readonly disclosures: PortalTextPreviewDisclosureConfiguration;
  readonly idGenerator?: () => string;
  readonly traceIdGenerator?: () => string;
  readonly now?: () => Date;
  readonly monotonicNow?: () => number;
  readonly portTimeoutMs?: number;
}

export class PortalTextPreviewRuntimeError extends Error {
  readonly code: PortalTextPreviewTurnBlockReason | "admission_invalid";

  constructor(code: PortalTextPreviewTurnBlockReason | "admission_invalid") {
    super(code);
    this.name = "PortalTextPreviewRuntimeError";
    this.code = code;
  }
}

function ownRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some((key) => typeof key !== "string")) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of ownKeys) {
      const descriptor = descriptors[String(key)];
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return null;
    }
    return value as Readonly<Record<string, unknown>>;
  } catch {
    return null;
  }
}

function hasExactKeys(value: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isUuidV7(value: unknown): value is string {
  return typeof value === "string" && UUID_V7_PATTERN.test(value);
}

function timestamp(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value ? parsed : null;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new PortalTextPreviewRuntimeError("invalid_request");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = ownRecord(value);
  if (!record) throw new PortalTextPreviewRuntimeError("invalid_request");
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

function sha256Canonical(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function blocked(reason: PortalTextPreviewTurnBlockReason): PortalTextPreviewTurnAcquisition {
  return Object.freeze({ acquired: false, reason });
}

function blockReason(outcome: unknown): PortalTextPreviewTurnBlockReason {
  switch (outcome) {
    case "expired": return "admission_expired";
    case "not_authorized": return "admission_required";
    case "stale_generation": return "stale_generation";
    case "in_flight": return "turn_in_flight";
    case "already_processed":
    case "old_attempt": return "turn_already_processed";
    case "command_conflict":
    case "attempt_mismatch":
    case "claim_mismatch":
    case "conflict": return "turn_replay_conflict";
    case "failed": return "turn_failed";
    default: return "service_unavailable";
  }
}

function validateProfiles(dependencies: PortalTextPreviewRuntimeDependencies): void {
  const essential = dependencies.profiles.essential;
  const persisted = dependencies.profiles.persisted;
  const profiles = [essential, persisted];
  if (essential.persistentTranscript
    || !persisted.persistentTranscript
    || essential.profileId !== "openrouter_portal_text_essential_v1"
    || persisted.profileId !== "openrouter_portal_text_persisted_v1"
    || essential.profileFingerprint !== ESSENTIAL_PROFILE_FINGERPRINT
    || persisted.profileFingerprint !== PERSISTED_PROFILE_FINGERPRINT
    || profiles.some((profile) => profile.profileVersion !== "1.0.0"
      || !SHA256_FINGERPRINT_PATTERN.test(profile.profileFingerprint)
      || !SHA256_FINGERPRINT_PATTERN.test(profile.providerConfigurationFingerprint))
    || essential.providerConfigurationFingerprint !== PROVIDER_CONFIGURATION_FINGERPRINT
    || persisted.providerConfigurationFingerprint !== PROVIDER_CONFIGURATION_FINGERPRINT
    || !/^[a-z][a-z0-9._-]{2,99}$/.test(dependencies.disclosures.identityVersion)
    || !/^[a-z][a-z0-9._-]{2,99}$/.test(dependencies.disclosures.dataUseVersion)
    || !SHA256_PATTERN.test(dependencies.disclosures.identityHash)
    || !SHA256_PATTERN.test(dependencies.disclosures.dataUseHash)) {
    throw new PortalTextPreviewRuntimeError("admission_invalid");
  }
}

async function callPort<T>(operation: () => Promise<T>, timeoutMs: number): Promise<T> {
  let handle: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_resolve, reject) => {
        handle = setTimeout(() => {
          reject(new PortalTextPreviewRuntimeError("service_unavailable"));
        }, timeoutMs);
      }),
    ]);
  } catch (error) {
    if (error instanceof PortalTextPreviewRuntimeError) throw error;
    throw new PortalTextPreviewRuntimeError("service_unavailable");
  } finally {
    if (handle !== undefined) clearTimeout(handle);
  }
}

function parseAdmission(
  value: unknown,
  expected: Readonly<{
    tenantId: string;
    agentId: string;
    clientSessionRefHash: string;
    commandFingerprint: string;
    profile: PortalTextPreviewProfile;
  }>,
  nowMs: number,
): PortalTextPreviewAdmission {
  const receipt = ownRecord(value);
  if (!receipt || !hasExactKeys(receipt, ADMISSION_KEYS)) {
    throw new PortalTextPreviewRuntimeError("admission_invalid");
  }
  const issuedAt = timestamp(receipt.issued_at);
  const expiresAt = timestamp(receipt.expires_at);
  const transcriptConsentId = receipt.transcript_consent_id;
  const transcriptId = receipt.transcript_id;
  if (receipt.schema_version !== "2.0.0"
    || !isUuidV7(receipt.admission_id)
    || !isUuidV7(receipt.tenant_id)
    || !isUuidV7(receipt.actor_id)
    || !isUuidV7(receipt.agent_id)
    || !isUuidV7(receipt.session_id)
    || !isUuidV7(receipt.presenter_id)
    || !isUuidV7(receipt.identity_disclosure_id)
    || !isUuidV7(receipt.data_use_disclosure_id)
    || !isUuidV7(receipt.essential_consent_id)
    || !isUuidV7(receipt.privacy_policy_id)
    || (transcriptConsentId !== null && !isUuidV7(transcriptConsentId))
    || (transcriptId !== null && !isUuidV7(transcriptId))
    || typeof receipt.jurisdiction !== "string"
    || !JURISDICTION_PATTERN.test(receipt.jurisdiction)
    || typeof receipt.privacy_policy_version !== "string"
    || !SEMVER_PATTERN.test(receipt.privacy_policy_version)
    || typeof receipt.privacy_policy_fingerprint !== "string"
    || !SHA256_FINGERPRINT_PATTERN.test(receipt.privacy_policy_fingerprint)
    || typeof receipt.client_session_ref_hash !== "string"
    || !SHA256_PATTERN.test(receipt.client_session_ref_hash)
    || typeof receipt.command_fingerprint !== "string"
    || !SHA256_PATTERN.test(receipt.command_fingerprint)
    || receipt.tenant_id !== expected.tenantId
    || receipt.agent_id !== expected.agentId
    || receipt.client_session_ref_hash !== expected.clientSessionRefHash
    || receipt.command_fingerprint !== expected.commandFingerprint
    || receipt.profile_id !== expected.profile.profileId
    || receipt.profile_version !== expected.profile.profileVersion
    || receipt.profile_fingerprint !== expected.profile.profileFingerprint
    || receipt.provider_configuration_fingerprint !== expected.profile.providerConfigurationFingerprint
    || receipt.persistent_transcript !== expected.profile.persistentTranscript
    || (expected.profile.persistentTranscript
      ? transcriptConsentId === null || transcriptId === null
      : transcriptConsentId !== null || transcriptId !== null)
    || receipt.ttl_seconds !== ADMISSION_TTL_SECONDS
    || issuedAt === null
    || expiresAt === null
    || issuedAt > nowMs + 5_000
    || expiresAt - issuedAt !== ADMISSION_TTL_SECONDS * 1_000
    || (receipt.status !== "issued" && receipt.status !== "expired")) {
    throw new PortalTextPreviewRuntimeError("admission_invalid");
  }
  if (receipt.status !== "issued" || expiresAt <= nowMs) {
    throw new PortalTextPreviewRuntimeError("admission_expired");
  }
  return Object.freeze(receipt) as PortalTextPreviewAdmission;
}

function admissionBinding(admission: PortalTextPreviewAdmission, userId: string): TextPreviewStateBinding {
  return {
    tenantId: admission.tenant_id,
    userId,
    actorId: admission.actor_id,
    agentId: admission.agent_id,
    sessionId: admission.session_id,
    admissionId: admission.admission_id,
    clientSessionRefHash: admission.client_session_ref_hash,
    profileId: admission.profile_id,
    profileVersion: admission.profile_version,
    profileFingerprint: admission.profile_fingerprint,
    providerConfigurationFingerprint: admission.provider_configuration_fingerprint,
    privacyPolicyId: admission.privacy_policy_id,
    jurisdiction: admission.jurisdiction,
    privacyPolicyVersion: admission.privacy_policy_version,
    privacyPolicyFingerprint: admission.privacy_policy_fingerprint,
    persistentTranscript: admission.persistent_transcript,
  };
}

function validGeneration(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) < MAX_TEXT_PREVIEW_EXCHANGES;
}

function validGrant(grant: PortalTextPreviewTurnGrant): boolean {
  return isUuidV7(grant.claimId)
    && isUuidV7(grant.attemptId)
    && isUuidV7(grant.admissionId)
    && validGeneration(grant.generation)
    && SHA256_PATTERN.test(grant.commandFingerprint)
    && timestamp(grant.leaseExpiresAt) !== null;
}

export function createPortalTextPreviewRuntime(dependencies: PortalTextPreviewRuntimeDependencies) {
  validateProfiles(dependencies);
  const idGenerator = dependencies.idGenerator ?? (() => createUuidV7());
  const traceIdGenerator = dependencies.traceIdGenerator ?? (() => randomBytes(16).toString("hex"));
  const now = dependencies.now ?? (() => new Date());
  const monotonicNow = dependencies.monotonicNow ?? (() => performance.now());
  const portTimeoutMs = dependencies.portTimeoutMs ?? PORT_TIMEOUT_MAX_MS;
  if (!Number.isInteger(portTimeoutMs) || portTimeoutMs < 1 || portTimeoutMs > PORT_TIMEOUT_MAX_MS) {
    throw new PortalTextPreviewRuntimeError("service_unavailable");
  }
  type TurnAuthority = {
    readonly grant: PortalTextPreviewTurnGrant;
    readonly egress: Map<PortalTextPreviewEgressKind, PortalTextPreviewEgressGrant>;
    terminal: "open" | "completion_pending" | "succeeded" | "failed";
    completionFingerprint: string | null;
    providerRequestId: string | null;
    persistence: PortalTextPreviewPersistence | null;
  };
  const admissionAuthorities = new Map<string, Readonly<{
    admission: PortalTextPreviewAdmission;
    authenticatedUserId: string;
  }>>();
  const turnAuthorities = new Map<string, TurnAuthority>();

  function ownedAdmission(
    admission: PortalTextPreviewAdmission,
    authenticatedUserId?: string,
  ): boolean {
    const authority = admissionAuthorities.get(admission.admission_id);
    return authority !== undefined
      && authority.admission === admission
      && (authenticatedUserId === undefined || authority.authenticatedUserId === authenticatedUserId);
  }

  function ownedTurn(grant: PortalTextPreviewTurnGrant): TurnAuthority | null {
    const authority = turnAuthorities.get(grant.claimId);
    return authority?.grant === grant ? authority : null;
  }

  function mintUnique(existing: ReadonlySet<string>): string {
    const value = idGenerator();
    if (!isUuidV7(value) || existing.has(value)) {
      throw new PortalTextPreviewRuntimeError("service_unavailable");
    }
    return value;
  }

  async function admitPortalTextPreview(input: AdmitPortalTextPreviewInput): Promise<PortalTextPreviewAdmission> {
    if (!isUuid(input.authenticatedUserId)
      || !isUuidV7(input.expectedTenantId)
      || !isUuidV7(input.agentId)
      || !isUuid(input.clientConversationId)
      || input.aiIdentityAcknowledged !== true
      || input.essentialProcessingAccepted !== true
      || typeof input.persistentTranscript !== "boolean"
      || typeof input.expectExisting !== "boolean") {
      throw new PortalTextPreviewRuntimeError("admission_invalid");
    }
    const profile = input.persistentTranscript
      ? dependencies.profiles.persisted
      : dependencies.profiles.essential;
    const clientSessionRefHash = sha256Canonical({
      userId: input.authenticatedUserId,
      tenantId: input.expectedTenantId,
      agentId: input.agentId,
      clientConversationId: input.clientConversationId,
    });
    const commandFingerprint = sha256Canonical({
      userId: input.authenticatedUserId,
      tenantId: input.expectedTenantId,
      agentId: input.agentId,
      clientSessionRefHash,
      profileId: profile.profileId,
      profileVersion: profile.profileVersion,
      profileFingerprint: profile.profileFingerprint,
      providerConfigurationFingerprint: profile.providerConfigurationFingerprint,
      identityDisclosureVersion: dependencies.disclosures.identityVersion,
      identityDisclosureHash: dependencies.disclosures.identityHash,
      dataUseDisclosureVersion: dependencies.disclosures.dataUseVersion,
      dataUseDisclosureHash: dependencies.disclosures.dataUseHash,
      persistentTranscript: input.persistentTranscript,
    });
    const ids = new Set<string>();
    const mint = () => {
      const value = mintUnique(ids);
      ids.add(value);
      return value;
    };
    const admissionId = mint();
    const sessionId = mint();
    const presenterId = mint();
    const identityDisclosureId = mint();
    const dataUseDisclosureId = mint();
    const essentialConsentId = mint();
    const transcriptConsentId = input.persistentTranscript ? mint() : null;
    const transcriptId = input.persistentTranscript ? mint() : null;
    const traceId = traceIdGenerator();
    if (!TRACE_ID_PATTERN.test(traceId)) throw new PortalTextPreviewRuntimeError("admission_invalid");
    const args: AdmissionArgs = Object.freeze({
      p_admission_id: admissionId,
      p_agent_id: input.agentId,
      p_session_id: sessionId,
      p_presenter_id: presenterId,
      p_client_session_ref_hash: clientSessionRefHash,
      p_profile_id: profile.profileId,
      p_profile_version: profile.profileVersion,
      p_profile_fingerprint: profile.profileFingerprint,
      p_provider_configuration_fingerprint: profile.providerConfigurationFingerprint,
      p_command_fingerprint: commandFingerprint,
      p_identity_disclosure_id: identityDisclosureId,
      p_identity_disclosure_version: dependencies.disclosures.identityVersion,
      p_identity_disclosure_hash: dependencies.disclosures.identityHash,
      p_data_use_disclosure_id: dataUseDisclosureId,
      p_data_use_disclosure_version: dependencies.disclosures.dataUseVersion,
      p_data_use_disclosure_hash: dependencies.disclosures.dataUseHash,
      p_essential_consent_id: essentialConsentId,
      p_transcript_consent_id: transcriptConsentId,
      p_transcript_id: transcriptId,
      p_persistent_transcript: input.persistentTranscript,
      p_expect_existing: input.expectExisting,
      p_trace_id: traceId,
      p_correlation_id: admissionId,
      p_session_created_event_id: mint(),
      p_session_created_outbox_id: mint(),
      p_session_prepared_event_id: mint(),
      p_session_prepared_outbox_id: mint(),
      p_disclosure_event_id: mint(),
      p_disclosure_outbox_id: mint(),
      p_consent_event_id: mint(),
      p_consent_outbox_id: mint(),
      p_activated_event_id: mint(),
      p_activated_outbox_id: mint(),
      p_cleanup_event_id: mint(),
      p_cleanup_outbox_id: mint(),
    });
    const receipt = await callPort(() => dependencies.ports.admission.admit(args), portTimeoutMs);
    const admission = parseAdmission(receipt, {
      tenantId: input.expectedTenantId,
      agentId: input.agentId,
      clientSessionRefHash,
      commandFingerprint,
      profile,
    }, now().getTime());
    admissionAuthorities.set(admission.admission_id, Object.freeze({
      admission,
      authenticatedUserId: input.authenticatedUserId,
    }));
    return admission;
  }

  function stateForAdmission(
    admission: PortalTextPreviewAdmission,
    authenticatedUserId: string,
    token: string | null,
    stateSecret: string,
  ): TextPreviewStatePayload {
    if (!isUuid(authenticatedUserId) || !STATE_SECRET_PATTERN.test(stateSecret)) {
      throw new PortalTextPreviewRuntimeError("invalid_request");
    }
    if (!ownedAdmission(admission, authenticatedUserId)) {
      throw new PortalTextPreviewRuntimeError("admission_mismatch");
    }
    const current = now();
    const bindingFingerprint = textPreviewStateBindingFingerprint(
      admissionBinding(admission, authenticatedUserId),
    );
    if (token === null) {
      return Object.freeze({
        schema_version: "2.0.0",
        admission_id: admission.admission_id,
        binding_fingerprint: bindingFingerprint,
        profile_id: admission.profile_id,
        profile_version: admission.profile_version,
        profile_fingerprint: admission.profile_fingerprint,
        generation: 0,
        turns: Object.freeze([]),
        issued_at: current.toISOString(),
        expires_at: admission.expires_at,
      });
    }
    let state: TextPreviewStatePayload;
    try {
      state = verifyTextPreviewStateToken(token, stateSecret, current);
    } catch {
      throw new PortalTextPreviewRuntimeError("admission_mismatch");
    }
    if (state.admission_id !== admission.admission_id
      || state.binding_fingerprint !== bindingFingerprint
      || state.profile_id !== admission.profile_id
      || state.profile_version !== admission.profile_version
      || state.profile_fingerprint !== admission.profile_fingerprint) {
      throw new PortalTextPreviewRuntimeError("admission_mismatch");
    }
    return state;
  }

  async function acquireTurn(input: Readonly<{
    admission: PortalTextPreviewAdmission;
    state: TextPreviewStatePayload;
    commandId: string;
    userMessage: string;
    stateSecret: string;
  }>): Promise<PortalTextPreviewTurnAcquisition> {
    if (!isUuid(input.commandId)
      || typeof input.userMessage !== "string"
      || input.userMessage.length < 1
      || input.userMessage.length > 2_000
      || !/\S/.test(input.userMessage)
      || !STATE_SECRET_PATTERN.test(input.stateSecret)
      || !validGeneration(input.state.generation)
      || input.state.admission_id !== input.admission.admission_id
      || input.state.profile_id !== input.admission.profile_id
      || input.state.profile_version !== input.admission.profile_version
      || input.state.profile_fingerprint !== input.admission.profile_fingerprint
      || !ownedAdmission(input.admission)) {
      return blocked("invalid_request");
    }
    const ids = new Set([input.admission.admission_id]);
    const mint = () => {
      const value = mintUnique(ids);
      ids.add(value);
      return value;
    };
    let claimId: string;
    let attemptId: string;
    let outcomeEventId: string;
    let outcomeOutboxId: string;
    try {
      claimId = mint();
      attemptId = mint();
      outcomeEventId = mint();
      outcomeOutboxId = mint();
    } catch {
      return blocked("service_unavailable");
    }
    const commandRefHash = sha256Canonical({ commandId: input.commandId });
    const commandFingerprint = createHmac("sha256", Buffer.from(input.stateSecret, "hex"))
      .update(COMMAND_CLAIM_FINGERPRINT_DOMAIN, "utf8")
      .update(canonicalJson({
        admissionId: input.admission.admission_id,
        bindingFingerprint: input.state.binding_fingerprint,
        generation: input.state.generation,
        state: input.state.turns,
        userMessage: input.userMessage,
      }), "utf8")
      .digest("hex");
    const args: ClaimArgs = Object.freeze({
      p_claim_id: claimId,
      p_attempt_id: attemptId,
      p_admission_id: input.admission.admission_id,
      p_command_ref_hash: commandRefHash,
      p_command_fingerprint: commandFingerprint,
      p_expected_generation: input.state.generation,
      p_outcome_event_id: outcomeEventId,
      p_outcome_outbox_id: outcomeOutboxId,
    });
    let value: unknown;
    try {
      value = await callPort(() => dependencies.ports.claim.acquire(args), portTimeoutMs);
    } catch {
      return blocked("service_unavailable");
    }
    const receipt = ownRecord(value);
    if (!receipt || typeof receipt.outcome !== "string") return blocked("service_unavailable");
    if (receipt.outcome !== "acquired") {
      if (receipt.outcome === "failed"
        && hasExactKeys(receipt, ["outcome", "reasonCode"])
        && typeof receipt.reasonCode === "string") return blocked("turn_failed");
      return hasExactKeys(receipt, ["outcome"])
        ? blocked(blockReason(receipt.outcome))
        : blocked("service_unavailable");
    }
    const acquiredAt = now().getTime();
    const leaseExpiresAt = timestamp(receipt.leaseExpiresAt);
    if (!hasExactKeys(receipt, ["outcome", "claimId", "attemptId", "generation", "leaseExpiresAt"])
      || receipt.claimId !== claimId
      || receipt.attemptId !== attemptId
      || receipt.generation !== input.state.generation
      || leaseExpiresAt === null
      || leaseExpiresAt <= acquiredAt
      || leaseExpiresAt - acquiredAt > TURN_LEASE_MAX_MS) return blocked("service_unavailable");
    const grant = Object.freeze({
      claimId,
      attemptId,
      admissionId: input.admission.admission_id,
      generation: input.state.generation,
      commandFingerprint,
      leaseExpiresAt: receipt.leaseExpiresAt as string,
    });
    turnAuthorities.set(claimId, {
      grant,
      egress: new Map(),
      terminal: "open",
      completionFingerprint: null,
      providerRequestId: null,
      persistence: null,
    });
    return Object.freeze({
      acquired: true,
      grant,
    });
  }

  function assertTurnGrantCurrent(grant: PortalTextPreviewTurnGrant): void {
    const lease = timestamp(grant.leaseExpiresAt);
    if (!validGrant(grant)
      || ownedTurn(grant) === null
      || lease === null
      || lease <= now().getTime()) {
      throw new PortalTextPreviewRuntimeError("turn_failed");
    }
  }

  function assertEgressGrantShapeCurrent(
    turnGrant: PortalTextPreviewTurnGrant,
    egressGrant: PortalTextPreviewEgressGrant,
  ): void {
    const authorizedAt = timestamp(egressGrant.authorizedAt);
    const expiresAt = timestamp(egressGrant.expiresAt);
    const turnExpiresAt = timestamp(turnGrant.leaseExpiresAt);
    const elapsed = monotonicNow() - egressGrant.localAuthorizedAtMonotonicMs;
    if (!isUuidV7(egressGrant.egressId)
      || egressGrant.admissionId !== turnGrant.admissionId
      || egressGrant.claimId !== turnGrant.claimId
      || egressGrant.attemptId !== turnGrant.attemptId
      || egressGrant.generation !== turnGrant.generation
      || (egressGrant.kind !== "embedding" && egressGrant.kind !== "generation")
      || !isUuidV7(egressGrant.aiUsageReservationId)
      || authorizedAt === null
      || expiresAt === null
      || turnExpiresAt === null
      || expiresAt <= now().getTime()
      || expiresAt <= authorizedAt
      || expiresAt - authorizedAt > EGRESS_GRANT_MAX_MS
      || expiresAt > turnExpiresAt
      || egressGrant.ttlMs !== expiresAt - authorizedAt
      || !Number.isFinite(elapsed)
      || elapsed < 0
      || elapsed >= egressGrant.ttlMs) {
      throw new PortalTextPreviewRuntimeError("turn_failed");
    }
  }

  function assertOwnedEgressGrantCurrent(
    turnGrant: PortalTextPreviewTurnGrant,
    egressGrant: PortalTextPreviewEgressGrant,
    requireOpenTurn: boolean,
  ): void {
    assertTurnGrantCurrent(turnGrant);
    const authority = ownedTurn(turnGrant);
    if (!authority
      || (requireOpenTurn && authority.terminal !== "open")
      || authority.egress.get(egressGrant.kind) !== egressGrant) {
      throw new PortalTextPreviewRuntimeError("turn_failed");
    }
    assertEgressGrantShapeCurrent(turnGrant, egressGrant);
  }

  function assertTurnEgressGrantCurrent(
    turnGrant: PortalTextPreviewTurnGrant,
    egressGrant: PortalTextPreviewEgressGrant,
  ): void {
    assertOwnedEgressGrantCurrent(turnGrant, egressGrant, true);
  }

  async function authorizeTurnEgress(
    turnGrant: PortalTextPreviewTurnGrant,
    kind: PortalTextPreviewEgressKind,
    aiUsageReservationId: string,
  ): Promise<PortalTextPreviewEgressGrant> {
    if (!validGrant(turnGrant)
      || (kind !== "embedding" && kind !== "generation")
      || !isUuidV7(aiUsageReservationId)) {
      throw new PortalTextPreviewRuntimeError("invalid_request");
    }
    assertTurnGrantCurrent(turnGrant);
    const authority = ownedTurn(turnGrant)!;
    if (authority.terminal !== "open") {
      throw new PortalTextPreviewRuntimeError("turn_failed");
    }
    const cached = authority.egress.get(kind);
    if (cached) {
      if (cached.aiUsageReservationId !== aiUsageReservationId) {
        throw new PortalTextPreviewRuntimeError("turn_replay_conflict");
      }
      assertTurnEgressGrantCurrent(turnGrant, cached);
      return cached;
    }
    const egressId = mintUnique(new Set([
      turnGrant.admissionId,
      turnGrant.claimId,
      turnGrant.attemptId,
    ]));
    const args: EgressArgs = Object.freeze({
      p_egress_id: egressId,
      p_admission_id: turnGrant.admissionId,
      p_claim_id: turnGrant.claimId,
      p_attempt_id: turnGrant.attemptId,
      p_expected_generation: turnGrant.generation,
      p_kind: kind,
      p_ai_usage_reservation_id: aiUsageReservationId,
    });
    const localRequestedAt = monotonicNow();
    let receipt: Readonly<Record<string, unknown>> | null = null;
    let recovering = false;
    try {
      receipt = ownRecord(await callPort(() => dependencies.ports.egress.authorize(args), portTimeoutMs));
    } catch (error) {
      if (!(error instanceof PortalTextPreviewRuntimeError)
        || error.code !== "service_unavailable") throw error;
      assertTurnGrantCurrent(turnGrant);
      recovering = true;
      receipt = ownRecord(await callPort(() => dependencies.ports.egress.authorize(args), portTimeoutMs));
    }
    if (!receipt
      || !hasExactKeys(receipt, ["outcome", "egressId", "kind", "authorizedAt", "expiresAt"])
      || (receipt.outcome !== "authorized" && !(recovering && receipt.outcome === "already_authorized"))
      || receipt.egressId !== egressId
      || receipt.kind !== kind
      || typeof receipt.authorizedAt !== "string"
      || typeof receipt.expiresAt !== "string") {
      throw new PortalTextPreviewRuntimeError("turn_failed");
    }
    const authorizedAt = timestamp(receipt.authorizedAt);
    const expiresAt = timestamp(receipt.expiresAt);
    if (authorizedAt === null || expiresAt === null) {
      throw new PortalTextPreviewRuntimeError("turn_failed");
    }
    const grant = Object.freeze({
      egressId,
      admissionId: turnGrant.admissionId,
      claimId: turnGrant.claimId,
      attemptId: turnGrant.attemptId,
      generation: turnGrant.generation,
      kind,
      aiUsageReservationId,
      authorizedAt: receipt.authorizedAt,
      expiresAt: receipt.expiresAt,
      ttlMs: expiresAt - authorizedAt,
      localAuthorizedAtMonotonicMs: localRequestedAt,
    });
    assertEgressGrantShapeCurrent(turnGrant, grant);
    if (authority.terminal !== "open" || authority.egress.has(kind)) {
      throw new PortalTextPreviewRuntimeError("turn_failed");
    }
    authority.egress.set(kind, grant);
    try {
      assertTurnEgressGrantCurrent(turnGrant, grant);
    } catch (error) {
      authority.egress.delete(kind);
      throw error;
    }
    return grant;
  }

  async function completeTurn(
    admission: PortalTextPreviewAdmission,
    grant: PortalTextPreviewTurnGrant,
    userMessage: string,
    assistantReply: string,
    providerRequestId: string | null,
    stateSecret: string,
  ): Promise<PortalTextPreviewPersistence> {
    if (!validGrant(grant)
      || grant.admissionId !== admission.admission_id
      || !ownedAdmission(admission)
      || typeof userMessage !== "string"
      || userMessage.length < 1
      || userMessage.length > 2_000
      || typeof assistantReply !== "string"
      || assistantReply.length < 1
      || assistantReply.length > 4_000
      || (providerRequestId !== null && !PROVIDER_REQUEST_ID_PATTERN.test(providerRequestId))
      || !STATE_SECRET_PATTERN.test(stateSecret)) {
      throw new PortalTextPreviewRuntimeError("invalid_request");
    }
    assertTurnGrantCurrent(grant);
    const authority = ownedTurn(grant)!;
    const generationEgress = authority.egress.get("generation");
    if (!generationEgress) throw new PortalTextPreviewRuntimeError("turn_failed");
    assertOwnedEgressGrantCurrent(grant, generationEgress, false);
    const completionFingerprint = `hmac-sha256:${createHmac("sha256", Buffer.from(stateSecret, "hex"))
      .update(COMPLETION_FINGERPRINT_DOMAIN, "utf8")
      .update(canonicalJson({
        admissionId: admission.admission_id,
        claimId: grant.claimId,
        attemptId: grant.attemptId,
        expectedGeneration: grant.generation,
        commandFingerprint: grant.commandFingerprint,
        providerRequestId,
        userMessage,
        assistantReply,
      }), "utf8")
      .digest("hex")}`;
    if (!HMAC_FINGERPRINT_PATTERN.test(completionFingerprint)) {
      throw new PortalTextPreviewRuntimeError("turn_failed");
    }
    if (authority.terminal === "succeeded") {
      if (authority.completionFingerprint !== completionFingerprint
        || authority.providerRequestId !== providerRequestId
        || authority.persistence === null) {
        throw new PortalTextPreviewRuntimeError("turn_replay_conflict");
      }
      return authority.persistence;
    }
    if (authority.terminal !== "open") {
      throw new PortalTextPreviewRuntimeError("turn_failed");
    }
    authority.terminal = "completion_pending";
    authority.completionFingerprint = completionFingerprint;
    authority.providerRequestId = providerRequestId;
    const args: CompletionArgs = Object.freeze({
      p_admission_id: admission.admission_id,
      p_claim_id: grant.claimId,
      p_attempt_id: grant.attemptId,
      p_expected_generation: grant.generation,
      p_command_fingerprint: grant.commandFingerprint,
      p_completion_fingerprint: completionFingerprint,
      p_provider_request_id: providerRequestId,
      p_user_turn: admission.persistent_transcript ? userMessage : null,
      p_assistant_turn: admission.persistent_transcript ? assistantReply : null,
    });
    const receipt = ownRecord(await callPort(
      () => dependencies.ports.completion.complete(args),
      portTimeoutMs,
    ));
    if (!receipt
      || !hasExactKeys(receipt, ["outcome", "persistence", "providerRequestId"])
      || receipt.outcome !== "succeeded"
      || receipt.providerRequestId !== providerRequestId
      || (receipt.persistence !== "disabled"
        && receipt.persistence !== "saved"
        && receipt.persistence !== "not_saved")
      || (!admission.persistent_transcript && receipt.persistence !== "disabled")
      || (admission.persistent_transcript && receipt.persistence === "disabled")) {
      throw new PortalTextPreviewRuntimeError("service_unavailable");
    }
    authority.terminal = "succeeded";
    authority.persistence = receipt.persistence;
    return receipt.persistence;
  }

  async function failTurn(
    grant: PortalTextPreviewTurnGrant,
    reasonCode: "generation_failed" | "generated_reply_invalid" | "state_issue_failed" | "provider_response_uncommitted",
    providerRequestId: string | null,
  ): Promise<boolean> {
    if (!validGrant(grant)
      || (providerRequestId !== null && !PROVIDER_REQUEST_ID_PATTERN.test(providerRequestId))
      || (reasonCode === "provider_response_uncommitted") !== (providerRequestId !== null)) return false;
    const authority = ownedTurn(grant);
    if (!authority || authority.terminal === "succeeded" || authority.terminal === "failed") return false;
    const args: FailureArgs = Object.freeze({
      p_admission_id: grant.admissionId,
      p_claim_id: grant.claimId,
      p_attempt_id: grant.attemptId,
      p_expected_generation: grant.generation,
      p_command_fingerprint: grant.commandFingerprint,
      p_reason_code: reasonCode,
      p_provider_request_id: providerRequestId,
    });
    try {
      const receipt = ownRecord(await callPort(() => dependencies.ports.failure.fail(args), portTimeoutMs));
      const failed = receipt !== null
        && hasExactKeys(receipt, ["outcome"])
        && receipt.outcome === "failed";
      if (failed) authority.terminal = "failed";
      return failed;
    } catch {
      return false;
    }
  }

  async function reconcileProviderResponse(
    grant: PortalTextPreviewTurnGrant,
    providerRequestId: string,
  ): Promise<"succeeded" | "failed"> {
    if (!validGrant(grant) || !PROVIDER_REQUEST_ID_PATTERN.test(providerRequestId)) {
      throw new PortalTextPreviewRuntimeError("invalid_request");
    }
    const authority = ownedTurn(grant);
    if (!authority || authority.providerRequestId !== providerRequestId) {
      throw new PortalTextPreviewRuntimeError("turn_failed");
    }
    if (authority.terminal === "succeeded") return "succeeded";
    if (authority.terminal === "failed") return "failed";
    if (authority.terminal !== "completion_pending") {
      throw new PortalTextPreviewRuntimeError("turn_failed");
    }
    const args: ReconciliationArgs = Object.freeze({
      p_admission_id: grant.admissionId,
      p_claim_id: grant.claimId,
      p_attempt_id: grant.attemptId,
      p_expected_generation: grant.generation,
      p_command_fingerprint: grant.commandFingerprint,
      p_provider_request_id: providerRequestId,
    });
    const receipt = ownRecord(await callPort(
      () => dependencies.ports.completion.reconcile(args),
      portTimeoutMs,
    ));
    if (receipt
      && hasExactKeys(receipt, ["outcome", "providerRequestId"])
      && receipt.outcome === "succeeded"
      && receipt.providerRequestId === providerRequestId) {
      authority.terminal = "succeeded";
      return "succeeded";
    }
    if (receipt
      && hasExactKeys(receipt, ["outcome", "reasonCode", "providerRequestId"])
      && receipt.outcome === "failed"
      && receipt.reasonCode === "provider_response_uncommitted"
      && receipt.providerRequestId === providerRequestId) {
      authority.terminal = "failed";
      return "failed";
    }
    throw new PortalTextPreviewRuntimeError("turn_failed");
  }

  function nextStatePayload(
    admission: PortalTextPreviewAdmission,
    state: TextPreviewStatePayload,
    userMessage: string,
    assistantReply: string,
  ): Readonly<TextPreviewStatePayload> {
    if (state.generation >= MAX_TEXT_PREVIEW_EXCHANGES) {
      throw new PortalTextPreviewRuntimeError("invalid_request");
    }
    const turns: readonly TextPreviewStateTurn[] = Object.freeze([
      ...state.turns,
      Object.freeze({ role: "user" as const, content: userMessage }),
      Object.freeze({ role: "assistant" as const, content: assistantReply }),
    ]);
    return Object.freeze({
      ...state,
      generation: state.generation + 1,
      turns,
      issued_at: now().toISOString(),
      expires_at: admission.expires_at,
    });
  }

  function preflightNextStateCapacity(
    admission: PortalTextPreviewAdmission,
    state: TextPreviewStatePayload,
    userMessage: string,
    stateSecret: string,
  ): void {
    issueTextPreviewStateToken(
      nextStatePayload(admission, state, userMessage, MAXIMUM_UTF8_ASSISTANT_REPLY),
      stateSecret,
      now(),
    );
  }

  function issueNextState(
    admission: PortalTextPreviewAdmission,
    state: TextPreviewStatePayload,
    userMessage: string,
    assistantReply: string,
    stateSecret: string,
  ): string {
    return issueTextPreviewStateToken(
      nextStatePayload(admission, state, userMessage, assistantReply),
      stateSecret,
      now(),
    );
  }

  return Object.freeze({
    admitPortalTextPreview,
    stateForAdmission,
    acquireTurn,
    assertTurnGrantCurrent,
    authorizeTurnEgress,
    assertTurnEgressGrantCurrent,
    completeTurn,
    failTurn,
    reconcileProviderResponse,
    preflightNextStateCapacity,
    issueNextState,
  });
}
