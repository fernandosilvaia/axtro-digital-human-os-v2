import { getAuthorizedTenantContext, type AuthorizedRequestContext } from "@axtro/auth";
import { parseTenantId, parseUuidV7 } from "@axtro/domain";
import {
  DataGovernanceConfigurationError,
  dataGovernanceExternalEvidenceFingerprint,
  type DataDispositionOperation,
  type DataDispositionTarget,
  type DataDispositionExternalResult,
  type DataGovernanceExecutionCompletionResult,
  type DataGovernanceExecutionLease,
  type DataGovernanceExecutionMutationResult,
  type DataGovernanceExecutionRepository,
  type DataGovernanceExecutionWorkItem,
  type DataGovernanceExternalBeginResult,
  type DataGovernanceWorkItemView,
} from "@axtro/workflows";

export interface DataGovernanceRpcResult {
  readonly data: unknown;
  readonly error: unknown;
}

export interface DataGovernanceRpcClient {
  rpc(
    name: string,
    parameters: Readonly<Record<string, unknown>>,
  ): PromiseLike<DataGovernanceRpcResult>;
}

export interface PostgresDataGovernanceExecutionRepositoryOptions {
  readonly client: DataGovernanceRpcClient;
  readonly worker_id: string;
}

export class DataGovernancePostgresRepositoryError extends Error {
  readonly code: "rpc_error" | "invalid_rpc_response" | "tenant_mismatch";

  constructor(code: DataGovernancePostgresRepositoryError["code"]) {
    super("Data governance PostgreSQL execution failed closed");
    this.name = "DataGovernancePostgresRepositoryError";
    this.code = code;
  }
}

const OPERATIONS: readonly DataDispositionOperation[] = ["apply", "reconcile", "verify"];
const TARGETS: readonly DataDispositionTarget[] = [
  "database", "object_storage", "cache", "embedding_index",
  "provider_copy", "auth_identity", "vault_secret", "backup",
];
const ACTIONS: readonly DataGovernanceExecutionWorkItem["action"][] = [
  "redact", "irreversible_delete", "crypto_erase", "cache_invalidate",
  "external_delete", "retain_content_free", "backup_expiry_wait",
];
const ITEM_STATES: readonly DataGovernanceExecutionMutationResult["work_item_state"][] = [
  "pending", "held", "leased", "applying", "retry_wait", "effect_unknown",
  "verification_pending", "verified", "operator_required", "retained_exception",
];
const HMAC = /^hmac-sha256:[0-9a-f]{64}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const RESOURCE_CODE = /^[a-z][a-z0-9_]{0,127}$/;
const NORMALIZED_CODE = /^[a-z][a-z0-9_]{0,63}$/;
const RESOURCE_CLASSES: readonly DataGovernanceWorkItemView["resource_class"][] = [
  "tenant_profile", "authentication_identity", "membership", "configuration",
  "contact_profile", "session_content", "transcript", "consent_evidence",
  "disclosure_evidence", "action_evidence", "workflow_evidence", "knowledge_content",
  "embedding", "provider_effect", "billing_evidence", "audit_evidence",
  "notification_payload", "runtime_evidence", "object_blob", "cache_entry",
  "provider_copy", "vault_secret", "backup_snapshot",
];

export function createPostgresDataGovernanceExecutionRepository(
  options: PostgresDataGovernanceExecutionRepositoryOptions,
): DataGovernanceExecutionRepository {
  const configuration = exactConfigurationRecord(options, ["client", "worker_id"]);
  if (!validClient(configuration.client)) throw new DataGovernanceConfigurationError();
  const client = configuration.client;
  const workerId = parseUuid(configuration.worker_id);

  const repository: DataGovernanceExecutionRepository = {
    execution_repository_kind: "durable_rpc" as const,

    async claimNext(request: AuthorizedRequestContext, input: Readonly<{ request_id: unknown; claim_token: unknown; lease_duration_ms: unknown }>) {
      const tenantId = authorizedTenant(request);
      const claimInput = exactConfigurationRecord(input, ["request_id", "claim_token", "lease_duration_ms"]);
      const requestId = parseUuid(claimInput.request_id);
      const claimToken = parseUuid(claimInput.claim_token);
      const leaseDurationMs = integer(claimInput.lease_duration_ms, 5_000, 300_000);
      const response = await rpc(client, "portal_lease_data_governance_work_items_service", {
        p_tenant_id: tenantId,
        p_request_id: requestId,
        p_worker_id: workerId,
        p_lease_token: claimToken,
        p_limit: 1,
        p_lease_seconds: Math.ceil(leaseDurationMs / 1_000),
      });
      if (!Array.isArray(response) || response.length > 1) throw invalidResponse();
      const row = response[0];
      if (row === undefined) return Object.freeze({ outcome: "idle" as const, execution: null, status: null });
      const execution = parseClaim(row, tenantId, requestId, claimToken);
      return Object.freeze({ outcome: "claimed" as const, execution, status: null });
    },

    async applyDatabase(request: AuthorizedRequestContext, execution: DataGovernanceExecutionLease) {
      const tenantId = assertExecutionTenant(request, execution);
      if (execution.work_item.surface !== "database" || execution.operation === "reconcile") throw new DataGovernanceConfigurationError();
      const response = await rpc(client, "portal_apply_data_governance_database_item_service", {
        p_tenant_id: tenantId,
        p_request_id: execution.request_id,
        p_item_id: execution.work_item.work_item_id,
        p_lease_token: execution.claim_token,
        p_fencing_token: execution.work_item.lease_fence,
      });
      return parseMutation(response, tenantId, execution.work_item.work_item_id, null, null);
    },

    async beginExternal(request: AuthorizedRequestContext, execution: DataGovernanceExecutionLease) {
      const tenantId = assertExecutionTenant(request, execution);
      if (execution.work_item.surface === "database") throw new DataGovernanceConfigurationError();
      const response = await rpc(client, "portal_begin_data_governance_external_operation_service", {
        p_tenant_id: tenantId,
        p_request_id: execution.request_id,
        p_item_id: execution.work_item.work_item_id,
        p_lease_token: execution.claim_token,
        p_fencing_token: execution.work_item.lease_fence,
        p_operation: execution.operation,
      });
      return parseExternalBegin(response, execution);
    },

    async recordExternalOutcome(request: AuthorizedRequestContext, execution: DataGovernanceExecutionLease, result: DataDispositionExternalResult) {
      const tenantId = assertExecutionTenant(request, execution);
      if (execution.work_item.surface === "database") throw new DataGovernanceConfigurationError();
      const evidence = validateEvidence(result, execution);
      const response = await rpc(client, "portal_record_data_governance_item_outcome_service", {
        p_tenant_id: tenantId,
        p_request_id: execution.request_id,
        p_item_id: execution.work_item.work_item_id,
        p_lease_token: execution.claim_token,
        p_receipt_id: evidence.receipt_id,
        p_operation: execution.operation,
        p_fencing_token: execution.work_item.lease_fence,
        p_outcome_code: evidence.outcome_code,
        p_evidence_kind: evidence.evidence_kind,
        p_evidence_fingerprint: evidence.evidence_fingerprint,
        p_verifier_authority_id: evidence.verifier_authority_id,
        p_verifier_attestation_hmac: evidence.verifier_attestation_hmac,
        p_recoverable_until: evidence.recoverable_until,
      });
      return parseMutation(response, tenantId, execution.work_item.work_item_id, evidence.receipt_id, evidence.outcome_code);
    },

    async complete(request: AuthorizedRequestContext, input: Readonly<{ request_id: unknown; receipt_id: unknown }>) {
      const tenantId = authorizedTenant(request);
      const completionInput = exactConfigurationRecord(input, ["request_id", "receipt_id"]);
      const requestId = parseUuid(completionInput.request_id);
      const receiptId = parseUuid(completionInput.receipt_id);
      const response = await rpc(client, "portal_complete_data_governance_request_service", {
        p_tenant_id: tenantId,
        p_request_id: requestId,
        p_receipt_id: receiptId,
      });
      return parseCompletion(response, tenantId, requestId, receiptId);
    },
  };
  return Object.freeze(repository);
}

function parseClaim(
  value: unknown,
  tenantId: string,
  requestId: string,
  claimToken: string,
): DataGovernanceExecutionLease {
  const row = exactRecord(value, [
    "workItemId", "requestId", "tenantId", "resourceCode", "surface", "resourceClass", "scope", "subjectId",
    "resourceLocatorHmac", "action", "state", "resourceCount", "operation",
    "operationIdentity", "attestationChallengeHmac", "attemptCount", "maxAttempts",
    "leaseToken", "leaseExpiresAt", "fencingToken",
  ]);
  const parsedRequestId = parseUuid(row.requestId);
  const parsedTenantId = parseTenant(row.tenantId);
  const workItemId = parseUuid(row.workItemId);
  const parsedClaimToken = parseUuid(row.leaseToken);
  if (parsedRequestId !== requestId || parsedTenantId !== tenantId || parsedClaimToken !== claimToken || row.state !== "leased") throw invalidResponse();
  const resourceCode = stringMatching(row.resourceCode, RESOURCE_CODE);
  if (!TARGETS.includes(row.surface as DataDispositionTarget) || !RESOURCE_CLASSES.includes(row.resourceClass as DataGovernanceWorkItemView["resource_class"])) throw invalidResponse();
  const scope = row.scope;
  if (scope !== "tenant" && scope !== "data_subject") throw invalidResponse();
  const subjectId = row.subjectId === null ? null : parseUuid(row.subjectId);
  if (scope === "tenant" && subjectId !== null || scope === "data_subject" && subjectId === null) throw invalidResponse();
  const action = row.action;
  const operation = row.operation;
  if (!ACTIONS.includes(action as DataGovernanceExecutionWorkItem["action"]) || !OPERATIONS.includes(operation as DataDispositionOperation)) throw invalidResponse();
  const surface = row.surface as DataDispositionTarget;
  const resourceClass = row.resourceClass as DataGovernanceWorkItemView["resource_class"];
  const challenge = row.attestationChallengeHmac === null ? null : stringMatching(row.attestationChallengeHmac, HMAC);
  if (surface === "database" && challenge !== null || surface !== "database" && challenge === null) throw invalidResponse();
  return Object.freeze({
    request_id: parsedRequestId,
    tenant_id: tenantId,
    scope_type: scope,
    data_subject_id: subjectId,
    operation: operation as DataDispositionOperation,
    claim_token: parsedClaimToken,
    lease_expires_at: timestamp(row.leaseExpiresAt),
    work_item: Object.freeze({
      work_item_id: workItemId,
      surface,
      resource_code: resourceCode,
      resource_class: resourceClass,
      action: action as DataGovernanceExecutionWorkItem["action"],
      resource_locator_hmac: stringMatching(row.resourceLocatorHmac, HMAC),
      resource_count: integer(row.resourceCount, 1, 10_000),
      attempt: integer(row.attemptCount, 1, 16),
      max_attempts: integer(row.maxAttempts, 1, 16),
      lease_fence: integer(row.fencingToken, 1, Number.MAX_SAFE_INTEGER),
      operation_identity: stringMatching(row.operationIdentity, SHA256),
      attestation_challenge_hmac: challenge,
    }),
  });
}

function parseExternalBegin(value: unknown, execution: DataGovernanceExecutionLease): DataGovernanceExternalBeginResult {
  const row = exactRecord(value, [
    "tenantId", "workItemId", "state", "operation", "operationIdentity",
    "fencingToken", "leaseToken", "replayed",
  ]);
  if (
    parseTenant(row.tenantId) !== execution.tenant_id
    || parseUuid(row.workItemId) !== execution.work_item.work_item_id
    || row.state !== "applying"
    || row.operation !== execution.operation
    || stringMatching(row.operationIdentity, SHA256) !== execution.work_item.operation_identity
    || integer(row.fencingToken, 1, Number.MAX_SAFE_INTEGER) !== execution.work_item.lease_fence
    || parseUuid(row.leaseToken) !== execution.claim_token
  ) throw invalidResponse();
  return Object.freeze({
    tenant_id: execution.tenant_id,
    work_item_id: execution.work_item.work_item_id,
    state: "applying",
    operation: execution.operation,
    operation_identity: execution.work_item.operation_identity,
    lease_fence: execution.work_item.lease_fence,
    claim_token: execution.claim_token,
    replayed: boolean(row.replayed),
  });
}

function parseMutation(value: unknown, tenantId: string, workItemId: string, expectedReceiptId: string | null, expectedOutcomeCode: string | null): DataGovernanceExecutionMutationResult {
  const receiptExpected = expectedReceiptId !== null;
  const expected = receiptExpected
    ? ["tenantId", "workItemId", "state", "outcomeCode", "receiptId", "replayed"]
    : ["tenantId", "workItemId", "state", "outcomeCode"];
  const row = exactRecord(value, expected);
  if (parseTenant(row.tenantId) !== tenantId || parseUuid(row.workItemId) !== workItemId || !ITEM_STATES.includes(row.state as DataGovernanceExecutionMutationResult["work_item_state"])) throw invalidResponse();
  const receiptId = receiptExpected ? parseUuid(row.receiptId) : null;
  const replayed = receiptExpected ? boolean(row.replayed) : false;
  if (expectedReceiptId !== null && receiptId !== expectedReceiptId) throw invalidResponse();
  const outcomeCode = stringMatching(row.outcomeCode, NORMALIZED_CODE);
  if (expectedOutcomeCode !== null && outcomeCode !== expectedOutcomeCode) throw invalidResponse();
  return Object.freeze({
    work_item_id: workItemId,
    work_item_state: row.state as DataGovernanceExecutionMutationResult["work_item_state"],
    outcome_code: outcomeCode,
    receipt_id: receiptId,
    replayed,
    status: null,
  });
}

function parseCompletion(value: unknown, tenantId: string, requestId: string, receiptId: string): DataGovernanceExecutionCompletionResult {
  const row = exactRecord(value, ["requestId", "tenantId", "state", "receiptId", "replayed"]);
  const replayed = boolean(row.replayed);
  const returnedReceiptId = parseUuid(row.receiptId);
  if (parseUuid(row.requestId) !== requestId || parseTenant(row.tenantId) !== tenantId || row.state !== "completed" || !replayed && returnedReceiptId !== receiptId) throw invalidResponse();
  return Object.freeze({ request_id: requestId, state: "completed", receipt_id: returnedReceiptId, replayed });
}

function validateEvidence(result: DataDispositionExternalResult, execution: DataGovernanceExecutionLease): DataDispositionExternalResult["evidence"] {
  const resultRecord = exactConfigurationRecord(result, "recoverable_until" in result
    ? ["outcome", "code", "recoverable_until", "evidence"]
    : ["outcome", "code", "evidence"]);
  if (!(resultRecord.outcome === "succeeded" || resultRecord.outcome === "retryable" || resultRecord.outcome === "unknown" || resultRecord.outcome === "denied")
    || typeof resultRecord.code !== "string" || !NORMALIZED_CODE.test(resultRecord.code)) throw new DataGovernanceConfigurationError();
  const evidence = exactConfigurationRecord(resultRecord.evidence, [
    "receipt_id", "outcome_code", "evidence_kind", "evidence_fingerprint",
    "verifier_authority_id", "verifier_attestation_hmac", "recoverable_until",
  ]);
  const receiptId = parseUuid(evidence.receipt_id);
  const expectedOutcome = resultRecord.outcome === "succeeded"
    ? execution.work_item.surface === "backup" && resultRecord.recoverable_until !== undefined
      ? "backup_recoverable"
      : execution.operation === "verify" ? execution.work_item.action === "redact" ? "verified_content_free" : "verified_absent" : "applied"
    : resultRecord.outcome === "retryable" ? "retryable_failure"
      : resultRecord.outcome === "unknown" ? "effect_unknown" : "permanent_failure";
  if (evidence.outcome_code !== expectedOutcome || evidence.evidence_kind !== expectedEvidenceKind(expectedOutcome, execution.work_item.surface)) {
    throw new DataGovernanceConfigurationError();
  }
  const terminalVerification = evidence.outcome_code === "verified_absent" || evidence.outcome_code === "verified_content_free";
  const verifierId = evidence.verifier_authority_id === null ? null : parseUuid(evidence.verifier_authority_id);
  const verifierHmac = evidence.verifier_attestation_hmac === null
    ? null
    : typeof evidence.verifier_attestation_hmac === "string"
      ? evidence.verifier_attestation_hmac
      : (() => { throw new DataGovernanceConfigurationError(); })();
  if (terminalVerification && (verifierId === null || typeof verifierHmac !== "string" || !HMAC.test(verifierHmac))
    || !terminalVerification && (verifierId !== null || verifierHmac !== null)) throw new DataGovernanceConfigurationError();
  const recoverableUntil = evidence.recoverable_until === null ? null : timestamp(evidence.recoverable_until);
  if (resultRecord.recoverable_until !== undefined && timestamp(resultRecord.recoverable_until) !== recoverableUntil) throw new DataGovernanceConfigurationError();
  const evidenceKind = stringMatching(evidence.evidence_kind, NORMALIZED_CODE) as DataDispositionExternalResult["evidence"]["evidence_kind"];
  const outcomeCode = stringMatching(evidence.outcome_code, NORMALIZED_CODE) as DataDispositionExternalResult["evidence"]["outcome_code"];
  const evidenceFingerprint = stringMatching(evidence.evidence_fingerprint, SHA256);
  if (evidenceFingerprint !== dataGovernanceExternalEvidenceFingerprint({
    tenant_id: execution.tenant_id,
    request_id: execution.request_id,
    work_item_id: execution.work_item.work_item_id,
    attempt: execution.work_item.attempt,
    receipt_id: receiptId,
    operation: execution.operation,
    lease_fence: execution.work_item.lease_fence,
    outcome_code: outcomeCode,
    evidence_kind: evidenceKind,
    operation_identity: execution.work_item.operation_identity,
    attestation_challenge_hmac: execution.work_item.attestation_challenge_hmac ?? "",
    recoverable_until: recoverableUntil,
  })) throw new DataGovernanceConfigurationError();
  return Object.freeze({
    receipt_id: receiptId,
    outcome_code: outcomeCode,
    evidence_kind: evidenceKind,
    evidence_fingerprint: evidenceFingerprint,
    verifier_authority_id: verifierId,
    verifier_attestation_hmac: verifierHmac,
    recoverable_until: recoverableUntil,
  });
}

async function rpc(client: DataGovernanceRpcClient, name: string, parameters: Readonly<Record<string, unknown>>): Promise<unknown> {
  let response: DataGovernanceRpcResult;
  try { response = await client.rpc(name, parameters); } catch { throw new DataGovernancePostgresRepositoryError("rpc_error"); }
  if (!plainObject(response) || response.error !== null) throw new DataGovernancePostgresRepositoryError("rpc_error");
  return response.data;
}

function assertExecutionTenant(request: AuthorizedRequestContext, execution: DataGovernanceExecutionLease): string {
  const tenantId = authorizedTenant(request);
  if (tenantId !== execution.tenant_id) throw new DataGovernancePostgresRepositoryError("tenant_mismatch");
  return tenantId;
}

function authorizedTenant(request: AuthorizedRequestContext): string {
  try {
    const context = getAuthorizedTenantContext(request);
    if (!context.grantedScopes.includes("workflow:execute") || !context.purposes.includes("essential_processing")) throw new Error();
    return parseTenantId(context.tenantId);
  } catch { throw new DataGovernancePostgresRepositoryError("tenant_mismatch"); }
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!plainObject(value)) throw invalidResponse();
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.length || ownKeys.some((key) => typeof key !== "string" || !keys.includes(key))) throw invalidResponse();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.values(descriptors).some((descriptor) => !("value" in descriptor))) throw invalidResponse();
  return Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]));
}

function exactConfigurationRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!plainObject(value)) throw new DataGovernanceConfigurationError();
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.length || ownKeys.some((key) => typeof key !== "string" || !keys.includes(key))) throw new DataGovernanceConfigurationError();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.values(descriptors).some((descriptor) => !("value" in descriptor))) throw new DataGovernanceConfigurationError();
  return Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]));
}

function expectedEvidenceKind(outcomeCode: string, target: DataDispositionTarget): string {
  if (outcomeCode === "applied") return "effect_receipt";
  if (outcomeCode === "effect_unknown") return "transport_unknown";
  if (outcomeCode === "retryable_failure") return "transport_failure";
  if (outcomeCode === "permanent_failure") return "provider_denied";
  if (outcomeCode === "backup_recoverable") return "recovery_window";
  switch (target) {
    case "object_storage": return "object_absence";
    case "cache": return "cache_absence";
    case "embedding_index": return "index_absence";
    case "provider_copy": return "provider_absence";
    case "auth_identity": return "auth_absence";
    case "vault_secret": return "vault_absence";
    case "backup": return "backup_window_elapsed";
    case "database": throw new DataGovernanceConfigurationError();
  }
}

function validClient(value: unknown): value is DataGovernanceRpcClient {
  return value !== null && typeof value === "object" && typeof (value as DataGovernanceRpcClient).rpc === "function";
}

function parseUuid(value: unknown): string {
  try { return parseUuidV7(value); } catch { throw invalidResponse(); }
}

function parseTenant(value: unknown): string {
  try { return parseTenantId(value); } catch { throw invalidResponse(); }
}

function timestamp(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw invalidResponse();
  return new Date(Date.parse(value)).toISOString();
}

function integer(value: unknown, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) throw invalidResponse();
  return value;
}

function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw invalidResponse();
  return value;
}

function stringMatching(value: unknown, pattern: RegExp): string {
  if (typeof value !== "string" || !pattern.test(value)) throw invalidResponse();
  return value;
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function invalidResponse(): DataGovernancePostgresRepositoryError {
  return new DataGovernancePostgresRepositoryError("invalid_rpc_response");
}
