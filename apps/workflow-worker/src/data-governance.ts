import type { AuthorizedRequestContext } from "@axtro/auth";
import { parseUuidV7, sha256Canonical } from "@axtro/domain";
import {
  DataGovernanceConfigurationError,
  dataGovernanceExternalEvidenceFingerprint,
  type DataDispositionOperation,
  type DataDispositionExternalResult,
  type DataDispositionResult,
  type DataDispositionTarget,
  type DataDispositionTargetContext,
  type DataDispositionTargetPort,
  type DataGovernanceCode,
  type DataGovernanceEvidenceKind,
  type DataGovernanceExternalBeginResult,
  type DataGovernanceExecutionLease,
  type DataGovernanceExecutionCompletionResult,
  type DataGovernanceExecutionMutationResult,
  type DataGovernanceExecutionRepository,
  type DataGovernanceExternalOutcomeCode,
  type DataGovernanceRepository,
  type DataGovernanceStatusView,
} from "@axtro/workflows";

export interface DataGovernanceClaimTokenFactory {
  nextClaimToken(): string;
}

export interface DataGovernanceWorkerOptions {
  readonly repository: DataGovernanceExecutionRepository;
  readonly ports: Readonly<Partial<Record<DataDispositionTarget, DataDispositionTargetPort>>>;
  readonly claim_token_factory: DataGovernanceClaimTokenFactory;
  readonly lease_duration_ms?: number;
  readonly operation_timeout_ms?: number;
  readonly allow_test_repository?: true;
}

export type DataGovernanceWorkerRunResult = Readonly<{
  outcome: "idle" | "busy" | "terminal" | "checkpointed" | "unacknowledged";
  status: DataGovernanceStatusView | null;
  work_item_id: string | null;
  operation: DataDispositionOperation | null;
  work_item_state: DataGovernanceExecutionMutationResult["work_item_state"] | null;
}>;

export interface DataGovernanceWorker {
  runOnce(request: AuthorizedRequestContext, requestId: unknown): Promise<DataGovernanceWorkerRunResult>;
  complete(request: AuthorizedRequestContext, requestId: unknown, receiptId: unknown): Promise<DataGovernanceExecutionCompletionResult>;
}

export interface DeterministicDataDispositionPortOptions {
  readonly scripts?: Readonly<Partial<Record<DataDispositionOperation, readonly DataDispositionResult[]>>>;
}

export interface DeterministicDataDispositionPort extends DataDispositionTargetPort {
  callCount(operation: DataDispositionOperation): number;
  journal(): readonly Readonly<{
    operation: DataDispositionOperation;
    tenant_id: string;
    request_id: string;
    scope_type: "tenant" | "data_subject";
    data_subject_id: string | null;
    work_item_id: string;
    resource_class: string;
    idempotency_key: string;
    resource_locator_hmac: string;
  }>[];
}

const TARGETS: readonly DataDispositionTarget[] = [
  "database", "object_storage", "cache", "embedding_index",
  "provider_copy", "auth_identity", "vault_secret", "backup",
];
const EXTERNAL_TARGETS: readonly DataDispositionTarget[] = [
  "object_storage", "cache", "embedding_index", "provider_copy",
  "auth_identity", "vault_secret", "backup",
];
const OPERATIONS: readonly DataDispositionOperation[] = ["apply", "reconcile", "verify"];
const DURABLE_LEASE_SAFETY_MARGIN_MS = 1_000;
const TRUSTED_TOKEN_FACTORIES = new WeakSet<object>();

export function createDataGovernanceWorker(optionsInput: DataGovernanceWorkerOptions): DataGovernanceWorker {
  const options = configurationRecord(optionsInput, [
    "repository", "ports", "claim_token_factory", "lease_duration_ms",
    "operation_timeout_ms", "allow_test_repository",
  ]);
  const repository = options.repository as DataGovernanceExecutionRepository;
  const ports = options.ports as DataGovernanceWorkerOptions["ports"];
  const tokenFactory = options.claim_token_factory as DataGovernanceClaimTokenFactory;
  if (
    !repository
    || typeof repository.claimNext !== "function"
    || typeof repository.applyDatabase !== "function"
    || typeof repository.beginExternal !== "function"
    || typeof repository.recordExternalOutcome !== "function"
    || typeof repository.complete !== "function"
    || repository.execution_repository_kind !== "durable_rpc" && repository.execution_repository_kind !== "in_memory_test_adapter"
    || repository.execution_repository_kind === "in_memory_test_adapter" && options.allow_test_repository !== true
    || !plainObject(ports)
    || !tokenFactory
    || !TRUSTED_TOKEN_FACTORIES.has(tokenFactory)
  ) throw new DataGovernanceConfigurationError();
  for (const [target, port] of Object.entries(ports)) {
    if (!EXTERNAL_TARGETS.includes(target as DataDispositionTarget) || !validPort(port)) throw new DataGovernanceConfigurationError();
  }
  const leaseDuration = optionalInteger(options.lease_duration_ms, 5_000, 100, 300_000);
  const operationTimeout = optionalInteger(options.operation_timeout_ms, 2_000, 10, 300_000);
  if (repository.execution_repository_kind === "durable_rpc" && operationTimeout + DURABLE_LEASE_SAFETY_MARGIN_MS >= leaseDuration) {
    throw new DataGovernanceConfigurationError();
  }

  return Object.freeze({
    async runOnce(request: AuthorizedRequestContext, requestId: unknown): Promise<DataGovernanceWorkerRunResult> {
      const claim = await repository.claimNext(request, {
        request_id: requestId,
        claim_token: tokenFactory.nextClaimToken(),
        lease_duration_ms: leaseDuration,
      });
      if (claim.outcome !== "claimed") {
        return Object.freeze({ outcome: claim.outcome, status: claim.status, work_item_id: null, operation: null, work_item_state: null });
      }
      const execution = claim.execution;
      let mutation: DataGovernanceExecutionMutationResult;
      if (execution.work_item.surface === "database") {
        mutation = await repository.applyDatabase(request, execution);
      } else {
        const port = ports[execution.work_item.surface];
        if (port === undefined) {
          return Object.freeze({ outcome: "unacknowledged", status: claim.status, work_item_id: execution.work_item.work_item_id, operation: execution.operation, work_item_state: "leased" });
        }
        await repository.beginExternal(request, execution);
        const result = await invokeWithDeadline(port, execution, operationTimeout);
        if (result === null) {
          return Object.freeze({ outcome: "unacknowledged", status: claim.status, work_item_id: execution.work_item.work_item_id, operation: execution.operation, work_item_state: "leased" });
        }
        mutation = await repository.recordExternalOutcome(request, execution, result);
      }
      return Object.freeze({
        outcome: "checkpointed",
        status: mutation.status,
        work_item_id: execution.work_item.work_item_id,
        operation: execution.operation,
        work_item_state: mutation.work_item_state,
      });
    },
    complete(request: AuthorizedRequestContext, requestId: unknown, receiptId: unknown) {
      return repository.complete(request, { request_id: requestId, receipt_id: receiptId });
    },
  });
}

export function createDeterministicDataGovernanceClaimTokenFactory(
  tokensInput: readonly unknown[],
): DataGovernanceClaimTokenFactory {
  if (!Array.isArray(tokensInput) || tokensInput.length < 1 || tokensInput.length > 8192) {
    throw new DataGovernanceConfigurationError();
  }
  let tokens: string[];
  try { tokens = tokensInput.map((value) => parseUuidV7(value)); } catch { throw new DataGovernanceConfigurationError(); }
  if (new Set(tokens).size !== tokens.length) throw new DataGovernanceConfigurationError();
  let cursor = 0;
  const factory = Object.freeze({
    nextClaimToken(): string {
      const token = tokens[cursor];
      if (token === undefined) throw new DataGovernanceConfigurationError();
      cursor += 1;
      return token;
    },
  });
  TRUSTED_TOKEN_FACTORIES.add(factory);
  return factory;
}

export function createDeterministicDataDispositionPort(
  optionsInput: DeterministicDataDispositionPortOptions = {},
): DeterministicDataDispositionPort {
  if (!plainObject(optionsInput) || (optionsInput.scripts !== undefined && !plainObject(optionsInput.scripts))) {
    throw new DataGovernanceConfigurationError();
  }
  const scripts = new Map<DataDispositionOperation, DataDispositionResult[]>();
  for (const operation of OPERATIONS) {
    const values = optionsInput.scripts?.[operation] ?? [];
    if (!Array.isArray(values) || values.length > 128) throw new DataGovernanceConfigurationError();
    scripts.set(operation, values.map(normalizeFakeResult));
  }
  const cursor = new Map<DataDispositionOperation, number>();
  const calls: Array<{
    operation: DataDispositionOperation;
    tenant_id: string;
    request_id: string;
    scope_type: "tenant" | "data_subject";
    data_subject_id: string | null;
    work_item_id: string;
    resource_class: string;
    idempotency_key: string;
    resource_locator_hmac: string;
  }> = [];
  const invoke = async (operation: DataDispositionOperation, context: DataDispositionTargetContext): Promise<DataDispositionExternalResult> => {
    if (context.signal.aborted) throw new DataGovernanceConfigurationError();
    calls.push(Object.freeze({
      operation,
      tenant_id: context.tenant_id,
      request_id: context.request_id,
      scope_type: context.scope_type,
      data_subject_id: context.data_subject_id,
      work_item_id: context.work_item_id,
      resource_class: context.resource_class,
      idempotency_key: context.idempotency_key,
      resource_locator_hmac: context.resource_locator_hmac,
    }));
    const position = cursor.get(operation) ?? 0;
    cursor.set(operation, position + 1);
    const scripted = scripts.get(operation)?.[position];
    const result = scripted !== undefined
      ? structuredClone(scripted)
      : Object.freeze({ outcome: "succeeded", code: code(operation === "verify" ? "absence_verified" : "effect_confirmed") } as const);
    return addDeterministicFakeEvidence(result, context, operation);
  };
  return Object.freeze({
    apply: (context: DataDispositionTargetContext) => invoke("apply", context),
    reconcile: (context: DataDispositionTargetContext) => invoke("reconcile", context),
    verify: (context: DataDispositionTargetContext) => invoke("verify", context),
    callCount: (operation: DataDispositionOperation) => calls.filter((entry) => entry.operation === operation).length,
    journal: () => Object.freeze(calls.map((entry) => Object.freeze({ ...entry }))),
  });
}

async function invokeWithDeadline(
  port: DataDispositionTargetPort,
  execution: DataGovernanceExecutionLease,
  timeoutMs: number,
): Promise<DataDispositionExternalResult | null> {
  const resourceLocatorHmac = execution.work_item.resource_locator_hmac;
  if (typeof resourceLocatorHmac !== "string" || !/^hmac-sha256:[0-9a-f]{64}$/.test(resourceLocatorHmac)) {
    return null;
  }
  if (execution.work_item.attestation_challenge_hmac === null) return null;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const context: DataDispositionTargetContext = Object.freeze({
    request_id: execution.request_id,
    tenant_id: execution.tenant_id,
    scope_type: execution.scope_type,
    data_subject_id: execution.data_subject_id,
    work_item_id: execution.work_item.work_item_id,
    target: execution.work_item.surface,
    resource_class: execution.work_item.resource_class,
    action: execution.work_item.action,
    resource_locator_hmac: resourceLocatorHmac,
    idempotency_key: sha256Canonical({
      profile: "data_governance_disposition@1.0.0",
      tenant_id: execution.tenant_id,
      request_id: execution.request_id,
      work_item_id: execution.work_item.work_item_id,
      operation: execution.operation,
    }),
    operation_identity: execution.work_item.operation_identity,
    attestation_challenge_hmac: execution.work_item.attestation_challenge_hmac,
    attempt_receipt_id: execution.claim_token,
    attempt: execution.work_item.attempt,
    lease_fence: execution.work_item.lease_fence,
    signal: controller.signal,
  });
  const method = port[execution.operation].bind(port);
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(null);
    }, timeoutMs);
  });
  try {
    const result = await Promise.race([method(context), deadline]);
    return result === null ? null : normalizeExternalResult(result, execution);
  } catch {
    return null;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function addDeterministicFakeEvidence(
  result: DataDispositionResult,
  context: DataDispositionTargetContext,
  operation: DataDispositionOperation,
): DataDispositionExternalResult {
  const outcomeCode = externalOutcomeCode(result, context.target, context.action, operation);
  const terminalVerification = outcomeCode === "verified_absent" || outcomeCode === "verified_content_free";
  const recoverableUntil = result.outcome === "succeeded" && result.recoverable_until !== undefined
    ? new Date(Date.parse(result.recoverable_until)).toISOString()
    : null;
  const evidenceKind = expectedEvidenceKind(outcomeCode, context.target);
  const evidence = Object.freeze({
    receipt_id: context.attempt_receipt_id,
    outcome_code: outcomeCode,
    evidence_kind: evidenceKind,
    evidence_fingerprint: dataGovernanceExternalEvidenceFingerprint({
      tenant_id: context.tenant_id,
      request_id: context.request_id,
      work_item_id: context.work_item_id,
      attempt: context.attempt,
      receipt_id: context.attempt_receipt_id,
      operation,
      lease_fence: context.lease_fence,
      outcome_code: outcomeCode,
      evidence_kind: evidenceKind,
      operation_identity: context.operation_identity,
      attestation_challenge_hmac: context.attestation_challenge_hmac,
      recoverable_until: recoverableUntil,
    }),
    verifier_authority_id: terminalVerification ? context.attempt_receipt_id : null,
    verifier_attestation_hmac: terminalVerification
      ? `hmac-sha256:${sha256Canonical({ fake: true, operation_identity: context.operation_identity, evidence: "verified" })}`
      : null,
    recoverable_until: recoverableUntil,
  });
  return Object.freeze({ ...result, evidence });
}

function normalizeExternalResult(
  value: DataDispositionExternalResult,
  execution: DataGovernanceExecutionLease,
): DataDispositionExternalResult {
  const valueRecord = exactConfigurationRecord(value, "recoverable_until" in value
    ? ["outcome", "code", "recoverable_until", "evidence"]
    : ["outcome", "code", "evidence"]);
  const evidence = exactConfigurationRecord(valueRecord.evidence, [
    "receipt_id", "outcome_code", "evidence_kind", "evidence_fingerprint",
    "verifier_authority_id", "verifier_attestation_hmac", "recoverable_until",
  ]);
  const result = normalizeFakeResult(valueRecord as unknown as DataDispositionResult);
  const receiptId = parseUuidV7(evidence.receipt_id);
  const outcomeCode = externalOutcomeCode(result, execution.work_item.surface, execution.work_item.action, execution.operation);
  if (evidence.outcome_code !== outcomeCode) throw new DataGovernanceConfigurationError();
  const evidenceKind = expectedEvidenceKind(outcomeCode, execution.work_item.surface);
  if (evidence.evidence_kind !== evidenceKind || typeof evidence.evidence_fingerprint !== "string" || !/^[0-9a-f]{64}$/.test(evidence.evidence_fingerprint)) {
    throw new DataGovernanceConfigurationError();
  }
  const terminalVerification = outcomeCode === "verified_absent" || outcomeCode === "verified_content_free";
  const verifierAuthorityId = evidence.verifier_authority_id === null ? null : parseUuidV7(evidence.verifier_authority_id);
  const verifierAttestationHmac = evidence.verifier_attestation_hmac === null
    ? null
    : typeof evidence.verifier_attestation_hmac === "string"
      ? evidence.verifier_attestation_hmac
      : (() => { throw new DataGovernanceConfigurationError(); })();
  if (
    terminalVerification && (verifierAuthorityId === null || typeof verifierAttestationHmac !== "string" || !/^hmac-sha256:[0-9a-f]{64}$/.test(verifierAttestationHmac))
    || !terminalVerification && (verifierAuthorityId !== null || verifierAttestationHmac !== null)
  ) throw new DataGovernanceConfigurationError();
  const recoverableUntil = evidence.recoverable_until === null
    ? null
    : normalizeTimestamp(evidence.recoverable_until);
  if (result.outcome === "succeeded" && result.recoverable_until !== undefined && recoverableUntil !== new Date(Date.parse(result.recoverable_until)).toISOString()) {
    throw new DataGovernanceConfigurationError();
  }
  return Object.freeze({
    ...result,
    evidence: Object.freeze({
      receipt_id: receiptId,
      outcome_code: outcomeCode,
      evidence_kind: evidenceKind,
      evidence_fingerprint: evidence.evidence_fingerprint,
      verifier_authority_id: verifierAuthorityId,
      verifier_attestation_hmac: verifierAttestationHmac,
      recoverable_until: recoverableUntil,
    }),
  });
}

function externalOutcomeCode(
  result: DataDispositionResult,
  target: DataDispositionTarget,
  action: DataGovernanceExecutionLease["work_item"]["action"],
  operation: DataDispositionOperation,
): DataGovernanceExternalOutcomeCode {
  if (result.outcome === "succeeded") {
    if (target === "backup" && result.recoverable_until !== undefined) return "backup_recoverable";
    if (operation === "verify") return action === "redact" ? "verified_content_free" : "verified_absent";
    return "applied";
  }
  if (result.outcome === "retryable") return "retryable_failure";
  if (result.outcome === "unknown") return "effect_unknown";
  return "permanent_failure";
}

function expectedEvidenceKind(
  outcomeCode: DataGovernanceExternalOutcomeCode,
  target: DataDispositionTarget,
): DataGovernanceEvidenceKind {
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

function normalizeTimestamp(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new DataGovernanceConfigurationError();
  return new Date(Date.parse(value)).toISOString();
}

export function createInMemoryDataGovernanceExecutionRepositoryForTests(
  repository: DataGovernanceRepository,
  options: Readonly<{ database_results?: readonly DataDispositionResult[] }> = {},
): DataGovernanceExecutionRepository {
  if (repository?.repository_kind !== "in_memory_test_fake" || !plainObject(options)) throw new DataGovernanceConfigurationError();
  const databaseResults = [...(options.database_results ?? [])].map(normalizeFakeResult);
  let databaseCursor = 0;
  const checkpoint = (
    request: AuthorizedRequestContext,
    execution: DataGovernanceExecutionLease,
    result: DataDispositionResult,
  ): DataGovernanceExecutionMutationResult => {
    const status = repository.checkpoint(request, {
      request_id: execution.request_id,
      work_item_id: execution.work_item.work_item_id,
      claim_token: execution.claim_token,
      lease_fence: execution.work_item.lease_fence,
      operation: execution.operation,
      attempt: execution.work_item.attempt,
      result,
      retry_delay_ms: 100,
    });
    const item = repository.listWorkItems(request, execution.request_id)
      .find((entry) => entry.work_item_id === execution.work_item.work_item_id);
    if (item === undefined) throw new DataGovernanceConfigurationError();
    return Object.freeze({
      work_item_id: item.work_item_id,
      work_item_state: item.state,
      outcome_code: result.code,
      receipt_id: null,
      replayed: false,
      status,
    });
  };
  const executionRepository: DataGovernanceExecutionRepository = {
    execution_repository_kind: "in_memory_test_adapter" as const,
    async claimNext(request: AuthorizedRequestContext, input: Readonly<{ request_id: unknown; claim_token: unknown; lease_duration_ms: unknown }>) {
      const claim = repository.claimNext(request, { ...input, max_attempts: 4 });
      if (claim.outcome !== "claimed") return claim;
      const item = claim.execution.work_item;
      if (item.lease_fence === null || item.resource_locator_hmac === null) throw new DataGovernanceConfigurationError();
      const operationIdentity = sha256Canonical({ request_id: claim.execution.request_id, work_item_id: item.work_item_id, operation: claim.execution.operation, lease_fence: item.lease_fence });
      return Object.freeze({
        outcome: "claimed" as const,
        status: claim.status,
        execution: Object.freeze({
          request_id: claim.execution.request_id,
          tenant_id: claim.execution.tenant_id,
          scope_type: claim.execution.scope_type,
          data_subject_id: claim.execution.data_subject_id,
          operation: claim.execution.operation,
          claim_token: claim.execution.claim_token,
          lease_expires_at: claim.execution.lease_expires_at,
          work_item: Object.freeze({
            work_item_id: item.work_item_id,
            surface: item.surface,
            resource_code: `test_${item.surface}`,
            resource_class: item.resource_class,
            action: item.action,
            resource_locator_hmac: item.resource_locator_hmac,
            resource_count: item.resource_count,
            attempt: item.attempt,
            max_attempts: item.max_attempts,
            lease_fence: item.lease_fence,
            operation_identity: operationIdentity,
            attestation_challenge_hmac: item.surface === "database" ? null : `hmac-sha256:${sha256Canonical({ operationIdentity, claim_token: claim.execution.claim_token })}`,
          }),
        }),
      });
    },
    async applyDatabase(request: AuthorizedRequestContext, execution: DataGovernanceExecutionLease) {
      if (execution.work_item.surface !== "database") throw new DataGovernanceConfigurationError();
      const result = databaseResults[databaseCursor] ?? Object.freeze({ outcome: "succeeded", code: code("effect_confirmed") } as const);
      databaseCursor += 1;
      return checkpoint(request, execution, result);
    },
    async beginExternal(request: AuthorizedRequestContext, execution: DataGovernanceExecutionLease): Promise<DataGovernanceExternalBeginResult> {
      if (execution.work_item.surface === "database") throw new DataGovernanceConfigurationError();
      repository.readStatus(request, execution.request_id);
      return Object.freeze({
        tenant_id: execution.tenant_id,
        work_item_id: execution.work_item.work_item_id,
        state: "applying",
        operation: execution.operation,
        operation_identity: execution.work_item.operation_identity,
        lease_fence: execution.work_item.lease_fence,
        claim_token: execution.claim_token,
        replayed: false,
      });
    },
    async recordExternalOutcome(request: AuthorizedRequestContext, execution: DataGovernanceExecutionLease, result: DataDispositionExternalResult) {
      if (execution.work_item.surface === "database") throw new DataGovernanceConfigurationError();
      const status = repository.checkpoint(request, {
        request_id: execution.request_id,
        work_item_id: execution.work_item.work_item_id,
        claim_token: execution.claim_token,
        lease_fence: execution.work_item.lease_fence,
        operation: execution.operation,
        attempt: execution.work_item.attempt,
        result,
        retry_delay_ms: 100,
      });
      const item = repository.listWorkItems(request, execution.request_id)
        .find((entry) => entry.work_item_id === execution.work_item.work_item_id);
      if (item === undefined) throw new DataGovernanceConfigurationError();
      return Object.freeze({ work_item_id: item.work_item_id, work_item_state: item.state, outcome_code: result.code, receipt_id: result.evidence.receipt_id, replayed: false, status });
    },
    async complete(request: AuthorizedRequestContext, input: Readonly<{ request_id: unknown; receipt_id: unknown }>) {
      const requestId = parseUuidV7(input.request_id);
      const receiptId = parseUuidV7(input.receipt_id);
      const status = repository.readStatus(request, requestId);
      if (status.state !== "completed") throw new DataGovernanceConfigurationError();
      return Object.freeze({ request_id: requestId, state: "completed" as const, receipt_id: receiptId, replayed: false });
    },
  };
  return Object.freeze(executionRepository);
}

function validPort(value: unknown): value is DataDispositionTargetPort {
  return value !== null
    && typeof value === "object"
    && typeof (value as DataDispositionTargetPort).apply === "function"
    && typeof (value as DataDispositionTargetPort).reconcile === "function"
    && typeof (value as DataDispositionTargetPort).verify === "function";
}

function normalizeFakeResult(value: DataDispositionResult): DataDispositionResult {
  if (!plainObject(value) || !(["succeeded", "retryable", "unknown", "denied"] as const).includes(value.outcome)) {
    throw new DataGovernanceConfigurationError();
  }
  const normalizedCode = code(value.code);
  if (value.outcome === "succeeded" && value.recoverable_until !== undefined) {
    if (!Number.isFinite(Date.parse(value.recoverable_until))) throw new DataGovernanceConfigurationError();
    return Object.freeze({ outcome: "succeeded", code: normalizedCode, recoverable_until: new Date(Date.parse(value.recoverable_until)).toISOString() });
  }
  return Object.freeze({ outcome: value.outcome, code: normalizedCode });
}

function code(value: unknown): DataGovernanceCode {
  if (typeof value !== "string" || !/^[a-z][a-z0-9_]{0,63}$/.test(value)) throw new DataGovernanceConfigurationError();
  return value as DataGovernanceCode;
}

function optionalInteger(value: unknown, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new DataGovernanceConfigurationError();
  }
  return value;
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function configurationRecord(value: unknown, allowedKeys: readonly string[]): Record<string, unknown> {
  if (!plainObject(value)) throw new DataGovernanceConfigurationError();
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key !== "string" || !allowedKeys.includes(key))) throw new DataGovernanceConfigurationError();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.values(descriptors).some((descriptor) => !("value" in descriptor))) throw new DataGovernanceConfigurationError();
  return Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]));
}

function exactConfigurationRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  const record = configurationRecord(value, keys);
  if (Reflect.ownKeys(record).length !== keys.length) throw new DataGovernanceConfigurationError();
  return record;
}
