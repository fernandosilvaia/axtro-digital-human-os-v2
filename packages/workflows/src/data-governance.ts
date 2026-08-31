import { getAuthorizedTenantContext, type AuthorizedRequestContext } from "@axtro/auth";
import { createHash } from "node:crypto";
import type {
  DataGovernanceCommand,
  DataGovernanceReceipt,
  DataGovernanceStatus,
  DataGovernanceWorkItem,
  DataLegalHold,
} from "@axtro/contracts-ts";
import { parseTenantId, parseUuidV7, sha256Canonical } from "@axtro/domain";

export const DATA_GOVERNANCE_WORKFLOW_TYPE = "data_governance_disposition" as const;
export const DATA_GOVERNANCE_WORKFLOW_VERSION = "1.0.0" as const;
export const DATA_DISPOSITION_TARGETS = [
  "database", "object_storage", "cache", "embedding_index",
  "provider_copy", "auth_identity", "vault_secret", "backup",
] as const;
export type DataDispositionTarget = (typeof DATA_DISPOSITION_TARGETS)[number];
export type DataDispositionOperation = "apply" | "reconcile" | "verify";
export type DataGovernanceCode = string & { readonly dataGovernanceCode: unique symbol };
export type DataGovernanceCommandInput = DataGovernanceCommand;
export type DataGovernanceStatusView = DataGovernanceStatus;
export type DataGovernanceWorkItemInput = DataGovernanceWorkItem;
export type DataGovernanceWorkItemView = DataGovernanceWorkItem;
export type DataLegalHoldInput = DataLegalHold;
export type DataGovernanceReceiptView = DataGovernanceReceipt;
type DataLegalHoldCommand = Extract<DataLegalHold, { record_type: "command" }>;

export interface DataGovernanceClock { now(): string; }
export interface DataGovernanceIdFactory { nextReceiptId(): string; }
export interface DataGovernanceRepositoryOptions {
  readonly clock: DataGovernanceClock;
  readonly id_factory: DataGovernanceIdFactory;
  readonly max_requests_per_tenant?: number;
  readonly default_max_attempts?: number;
}
export interface DataLegalHoldPlacement {
  readonly request_id: string;
  readonly work_item_ids: readonly string[];
  readonly hold: DataLegalHold;
}
export interface DataGovernanceClaimExecution {
  readonly request_id: string;
  readonly tenant_id: string;
  readonly scope_type: DataGovernanceCommand["scope_type"];
  readonly data_subject_id: string | null;
  readonly work_item: DataGovernanceWorkItem;
  readonly operation: DataDispositionOperation;
  readonly claim_token: string;
  readonly lease_expires_at: string;
}
export type DataGovernanceClaimResult =
  | Readonly<{ outcome: "claimed"; execution: DataGovernanceClaimExecution; status: DataGovernanceStatus }>
  | Readonly<{ outcome: "idle" | "busy" | "terminal"; execution: null; status: DataGovernanceStatus }>;
export type DataDispositionResult =
  | Readonly<{ outcome: "succeeded"; code: DataGovernanceCode; recoverable_until?: string }>
  | Readonly<{ outcome: "retryable" | "unknown" | "denied"; code: DataGovernanceCode }>;
export type DataGovernanceExternalOutcomeCode =
  | "applied"
  | "verified_absent"
  | "verified_content_free"
  | "effect_unknown"
  | "retryable_failure"
  | "permanent_failure"
  | "backup_recoverable";
export type DataGovernanceEvidenceKind =
  | "effect_receipt"
  | "object_absence"
  | "cache_absence"
  | "index_absence"
  | "provider_absence"
  | "auth_absence"
  | "vault_absence"
  | "backup_window_elapsed"
  | "transport_unknown"
  | "transport_failure"
  | "provider_denied"
  | "recovery_window";
export interface DataGovernanceExternalEvidenceEnvelope {
  readonly receipt_id: string;
  readonly outcome_code: DataGovernanceExternalOutcomeCode;
  readonly evidence_kind: DataGovernanceEvidenceKind;
  readonly evidence_fingerprint: string;
  readonly verifier_authority_id: string | null;
  readonly verifier_attestation_hmac: string | null;
  readonly recoverable_until: string | null;
}

export interface DataGovernanceExternalEvidenceFingerprintInput {
  readonly tenant_id: string;
  readonly request_id: string;
  readonly work_item_id: string;
  readonly attempt: number;
  readonly receipt_id: string;
  readonly operation: DataDispositionOperation;
  readonly lease_fence: number;
  readonly outcome_code: DataGovernanceExternalOutcomeCode;
  readonly evidence_kind: DataGovernanceEvidenceKind;
  readonly operation_identity: string;
  readonly attestation_challenge_hmac: string;
  readonly recoverable_until: string | null;
}

export function dataGovernanceExternalEvidenceFingerprint(
  input: DataGovernanceExternalEvidenceFingerprintInput,
): string {
  const canonicalRecoveryDeadline = input.recoverable_until === null
    ? ""
    : new Date(Date.parse(input.recoverable_until)).toISOString();
  const values = [
    "data-governance-external-evidence@1",
    input.tenant_id,
    input.request_id,
    input.work_item_id,
    String(input.attempt),
    input.receipt_id,
    input.operation,
    String(input.lease_fence),
    input.outcome_code,
    input.evidence_kind,
    input.operation_identity,
    input.attestation_challenge_hmac,
    canonicalRecoveryDeadline,
  ];
  const tuple = values.map((value) => `${Array.from(value).length}:${value};`).join("");
  return createHash("sha256").update(tuple, "utf8").digest("hex");
}
export type DataDispositionExternalResult = DataDispositionResult & Readonly<{
  evidence: DataGovernanceExternalEvidenceEnvelope;
}>;
export interface DataDispositionTargetContext {
  readonly request_id: string;
  readonly tenant_id: string;
  readonly scope_type: DataGovernanceCommand["scope_type"];
  readonly data_subject_id: string | null;
  readonly work_item_id: string;
  readonly target: DataDispositionTarget;
  readonly resource_class: DataGovernanceWorkItem["resource_class"];
  readonly action: DataGovernanceWorkItem["action"];
  readonly resource_locator_hmac: string;
  readonly idempotency_key: string;
  readonly operation_identity: string;
  readonly attestation_challenge_hmac: string;
  readonly attempt_receipt_id: string;
  readonly attempt: number;
  readonly lease_fence: number;
  readonly signal: AbortSignal;
}
export interface DataDispositionTargetPort {
  apply(context: DataDispositionTargetContext): Promise<DataDispositionExternalResult>;
  reconcile(context: DataDispositionTargetContext): Promise<DataDispositionExternalResult>;
  verify(context: DataDispositionTargetContext): Promise<DataDispositionExternalResult>;
}
export interface DataGovernanceMutationInput {
  readonly request_id: unknown;
  readonly work_item_id: unknown;
  readonly claim_token: unknown;
  readonly lease_fence: unknown;
  readonly operation: unknown;
  readonly attempt: unknown;
  readonly result: unknown;
  readonly retry_delay_ms: unknown;
}
export interface DataGovernanceRepository {
  /** Deterministic process-local fake. It is never a production execution port. */
  readonly repository_kind: "in_memory_test_fake";
  submit(request: AuthorizedRequestContext, command: DataGovernanceCommand): DataGovernanceStatus;
  requestApproval(request: AuthorizedRequestContext, requestId: unknown): DataGovernanceStatus;
  authorize(request: AuthorizedRequestContext, command: DataGovernanceCommand): DataGovernanceStatus;
  deny(request: AuthorizedRequestContext, input: Readonly<{ request_id: unknown; code: "policy_denied" | "authority_expired" }>): DataGovernanceStatus;
  beginInventory(request: AuthorizedRequestContext, requestId: unknown): DataGovernanceStatus;
  completeInventory(request: AuthorizedRequestContext, input: Readonly<{ request_id: unknown; work_items: readonly DataGovernanceWorkItem[] }>): DataGovernanceStatus;
  placeLegalHold(request: AuthorizedRequestContext, placement: DataLegalHoldPlacement): DataGovernanceStatus;
  releaseLegalHold(request: AuthorizedRequestContext, placement: DataLegalHoldPlacement): DataGovernanceStatus;
  expireLegalHold(request: AuthorizedRequestContext, placement: DataLegalHoldPlacement): DataGovernanceStatus;
  cancel(request: AuthorizedRequestContext, command: DataGovernanceCommand): DataGovernanceStatus;
  claimNext(request: AuthorizedRequestContext, input: Readonly<{ request_id: unknown; claim_token: unknown; lease_duration_ms: unknown; max_attempts: unknown }>): DataGovernanceClaimResult;
  checkpoint(request: AuthorizedRequestContext, input: DataGovernanceMutationInput): DataGovernanceStatus;
  readCommand(request: AuthorizedRequestContext, requestId: unknown): DataGovernanceCommand;
  readStatus(request: AuthorizedRequestContext, requestId: unknown): DataGovernanceStatus;
  listWorkItems(request: AuthorizedRequestContext, requestId: unknown): readonly DataGovernanceWorkItem[];
  listReceipts(request: AuthorizedRequestContext, requestId: unknown): readonly DataGovernanceReceipt[];
  listLegalHolds(request: AuthorizedRequestContext, requestId: unknown): readonly DataLegalHold[];
}

export interface DataGovernanceExecutionWorkItem {
  readonly work_item_id: string;
  readonly surface: DataDispositionTarget;
  readonly resource_code: string;
  readonly resource_class: DataGovernanceWorkItem["resource_class"];
  readonly action: DataGovernanceWorkItem["action"];
  readonly resource_locator_hmac: string;
  readonly resource_count: number;
  readonly attempt: number;
  readonly max_attempts: number;
  readonly lease_fence: number;
  readonly operation_identity: string;
  readonly attestation_challenge_hmac: string | null;
}
export interface DataGovernanceExecutionLease {
  readonly request_id: string;
  readonly tenant_id: string;
  readonly scope_type: DataGovernanceCommand["scope_type"];
  readonly data_subject_id: string | null;
  readonly work_item: DataGovernanceExecutionWorkItem;
  readonly operation: DataDispositionOperation;
  readonly claim_token: string;
  readonly lease_expires_at: string;
}
export type DataGovernanceExecutionClaimResult =
  | Readonly<{
    outcome: "claimed";
    execution: DataGovernanceExecutionLease;
    status: DataGovernanceStatus | null;
  }>
  | Readonly<{
    outcome: "idle" | "busy" | "terminal";
    execution: null;
    status: DataGovernanceStatus | null;
  }>;
export interface DataGovernanceExecutionMutationResult {
  readonly work_item_id: string;
  readonly work_item_state: DataGovernanceWorkItem["state"];
  readonly outcome_code: string;
  readonly receipt_id: string | null;
  readonly replayed: boolean;
  readonly status: DataGovernanceStatus | null;
}
export interface DataGovernanceExternalBeginResult {
  readonly tenant_id: string;
  readonly work_item_id: string;
  readonly state: "applying";
  readonly operation: DataDispositionOperation;
  readonly operation_identity: string;
  readonly lease_fence: number;
  readonly claim_token: string;
  readonly replayed: boolean;
}
export interface DataGovernanceExecutionCompletionResult {
  readonly request_id: string;
  readonly state: "completed";
  readonly receipt_id: string;
  readonly replayed: boolean;
}
export interface DataGovernanceExecutionRepository {
  readonly execution_repository_kind: "durable_rpc" | "in_memory_test_adapter";
  claimNext(
    request: AuthorizedRequestContext,
    input: Readonly<{
      request_id: unknown;
      claim_token: unknown;
      lease_duration_ms: unknown;
    }>,
  ): Promise<DataGovernanceExecutionClaimResult>;
  applyDatabase(
    request: AuthorizedRequestContext,
    execution: DataGovernanceExecutionLease,
  ): Promise<DataGovernanceExecutionMutationResult>;
  beginExternal(
    request: AuthorizedRequestContext,
    execution: DataGovernanceExecutionLease,
  ): Promise<DataGovernanceExternalBeginResult>;
  recordExternalOutcome(
    request: AuthorizedRequestContext,
    execution: DataGovernanceExecutionLease,
    result: DataDispositionExternalResult,
  ): Promise<DataGovernanceExecutionMutationResult>;
  complete(
    request: AuthorizedRequestContext,
    input: Readonly<{ request_id: unknown; receipt_id: unknown }>,
  ): Promise<DataGovernanceExecutionCompletionResult>;
}

export class DataGovernanceConfigurationError extends Error {
  constructor() { super("Data governance configuration is invalid"); this.name = "DataGovernanceConfigurationError"; }
}
export class DataGovernanceAuthorizationError extends Error {
  constructor() { super("Data governance access is not authorized"); this.name = "DataGovernanceAuthorizationError"; }
}
export class DataGovernanceValidationError extends Error {
  constructor() { super("Data governance input is invalid"); this.name = "DataGovernanceValidationError"; }
}
export class DataGovernanceConflictError extends Error {
  constructor() { super("Data governance input conflicts with persisted state"); this.name = "DataGovernanceConflictError"; }
}
export class DataGovernanceNotFoundError extends Error {
  constructor() { super("Data governance request was not found"); this.name = "DataGovernanceNotFoundError"; }
}

interface StoredItem {
  view: DataGovernanceWorkItem;
  operation: DataDispositionOperation;
  leaseToken: string | null;
  leaseExpiresAt: string | null;
}
interface StoredHold {
  readonly records: DataLegalHold[];
  readonly workItemIds: readonly string[];
  active: boolean;
}
interface StoredRequest {
  readonly command: DataGovernanceCommand;
  readonly fingerprint: string;
  readonly commands: Map<string, string>;
  status: DataGovernanceStatus;
  readonly items: Map<string, StoredItem>;
  readonly holds: Map<string, StoredHold>;
  readonly receipts: DataGovernanceReceipt[];
  irreversibleEffectStarted: boolean;
}

const HMAC = /^hmac-sha256:[0-9a-f]{64}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const TRACE = /^[0-9a-f]{16,64}$/;
const RESOURCE_CLASSES: readonly DataGovernanceWorkItem["resource_class"][] = [
  "tenant_profile", "authentication_identity", "membership", "configuration",
  "contact_profile", "session_content", "transcript", "consent_evidence",
  "disclosure_evidence", "action_evidence", "workflow_evidence", "knowledge_content",
  "embedding", "provider_effect", "billing_evidence", "audit_evidence",
  "notification_payload", "runtime_evidence", "object_blob", "cache_entry",
  "provider_copy", "vault_secret", "backup_snapshot",
];
const HOLD_PURPOSES: readonly DataLegalHoldCommand["purpose_code"][] = [
  "litigation", "regulatory_inquiry", "tax_audit", "billing_dispute",
  "contractual_claim", "security_investigation",
];
const HOLD_AUTHORITIES: readonly DataLegalHoldCommand["authority_code"][] = [
  "court_order", "regulator_request", "statutory_duty", "counsel_instruction",
  "contractual_preservation",
];
const MAX_ITEMS = 4096;
const MAX_ATTEMPTS = 16;
const MAX_LEASE_MS = 300_000;
const MAX_RETRY_MS = 3_600_000;
const TRUSTED_CLOCKS = new WeakSet<object>();
const TRUSTED_ID_FACTORIES = new WeakSet<object>();

export function createInMemoryDataGovernanceRepository(options: DataGovernanceRepositoryOptions): DataGovernanceRepository {
  if (!plainObject(options) || !TRUSTED_CLOCKS.has(options.clock) || !TRUSTED_ID_FACTORIES.has(options.id_factory)) throw new DataGovernanceConfigurationError();
  const maxRequests = optionalInteger(options.max_requests_per_tenant, 128, 1, 1024);
  const defaultMaxAttempts = optionalInteger(options.default_max_attempts, 4, 1, MAX_ATTEMPTS);
  const requests = new Map<string, StoredRequest>();
  const idempotency = new Map<string, string>();
  const usedTokens = new Set<string>();

  const repository: DataGovernanceRepository = {
    repository_kind: "in_memory_test_fake",
    submit(request, commandInput) {
      const tenantId = authority(request, "dispatch");
      const command = normalizeCommand(commandInput, tenantId, "request_deletion");
      if (command.actor_id !== request.principal.actorId) throw new DataGovernanceAuthorizationError();
      const fingerprint = sha256Canonical(command);
      if (command.request_fingerprint !== requestFingerprint(command)) throw new DataGovernanceConflictError();
      const replayKey = key(tenantId, command.idempotency_key);
      const existingId = idempotency.get(replayKey);
      if (existingId !== undefined) {
        const existing = requests.get(key(tenantId, existingId));
        if (existing === undefined || existing.fingerprint !== fingerprint) throw new DataGovernanceConflictError();
        return copy(existing.status);
      }
      const tenantCount = [...requests.values()].filter((entry) => entry.command.tenant_id === tenantId).length;
      if (tenantCount >= maxRequests) throw new DataGovernanceConflictError();
      const now = timestamp(options.clock.now());
      const status = initialStatus(command, now);
      const stored: StoredRequest = {
        command, fingerprint, commands: new Map([[`id:${command.command_id}`, fingerprint], [`idem:${command.idempotency_key}`, fingerprint]]), status,
        items: new Map(), holds: new Map(), receipts: [], irreversibleEffectStarted: false,
      };
      requests.set(key(tenantId, command.request_id), stored);
      idempotency.set(replayKey, command.request_id);
      appendReceipt(stored, options.id_factory, "request_admitted", null, null, now);
      return copy(status);
    },
    requestApproval(request, requestId) {
      const stored = requireStored(requests, request, requestId, "dispatch");
      requireState(stored, ["requested"]);
      return transition(stored, "approval_pending", options.clock.now(), "approval_required");
    },
    authorize(request, commandInput) {
      const stored = requireStored(requests, request, commandInput.request_id, "dispatch");
      const command = normalizeCommand(commandInput, stored.command.tenant_id, "authorize_execution");
      if (command.actor_id !== request.principal.actorId) throw new DataGovernanceAuthorizationError();
      if (commandReplay(stored, command)) return copy(stored.status);
      requireState(stored, ["approval_pending"]);
      const now = timestamp(options.clock.now());
      if (command.authorization_expires_at === null || Date.parse(command.authorization_expires_at) <= Date.parse(now)) {
        const status = transition(stored, "expired", now, "authorization_expired");
        appendReceipt(stored, options.id_factory, "request_expired", null, "authority_expired", now);
        return status;
      }
      const status = transition(stored, "authorized", now, null);
      appendReceipt(stored, options.id_factory, "execution_authorized", null, null, now);
      return status;
    },
    deny(request, decision) {
      const stored = requireStored(requests, request, decision.request_id, "dispatch");
      requireState(stored, ["requested", "approval_pending"]);
      const now = timestamp(options.clock.now());
      const expired = decision.code === "authority_expired";
      const status = transition(stored, expired ? "expired" : "denied", now, expired ? "authorization_expired" : "policy_denied");
      appendReceipt(stored, options.id_factory, expired ? "request_expired" : "policy_denied", null, decision.code, now);
      return status;
    },
    beginInventory(request, requestId) {
      const stored = requireStored(requests, request, requestId, "execute");
      requireState(stored, ["authorized"]);
      return transition(stored, "inventorying", options.clock.now(), "inventory_incomplete");
    },
    completeInventory(request, inventory) {
      if (!plainObject(inventory) || !Array.isArray(inventory.work_items)) throw new DataGovernanceValidationError();
      const stored = requireStored(requests, request, inventory.request_id, "execute");
      requireState(stored, ["inventorying"]);
      if (inventory.work_items.length < 1 || inventory.work_items.length > MAX_ITEMS) throw new DataGovernanceValidationError();
      const now = timestamp(options.clock.now());
      const normalizedItems = inventory.work_items.map((raw) => normalizeWorkItem(raw, stored, defaultMaxAttempts, now));
      if (new Set(normalizedItems.map((item) => item.work_item_id)).size !== normalizedItems.length || normalizedItems.some((item) => stored.items.has(item.work_item_id))) throw new DataGovernanceConflictError();
      for (const item of normalizedItems) {
        stored.items.set(item.work_item_id, { view: item, operation: "apply", leaseToken: null, leaseExpiresAt: null });
      }
      refreshHeldItems(stored, now);
      stored.status = copy({ ...stored.status, inventory_fingerprint: sha256Canonical([...stored.items.values()].map(({ view }) => view)) });
      const blocked = [...stored.items.values()].some(({ view }) => view.state === "held");
      const status = transition(stored, blocked ? "blocked_by_legal_hold" : "ready", now, blocked ? "legal_hold_active" : null);
      appendReceipt(stored, options.id_factory, blocked ? "legal_hold_blocked" : "inventory_completed", null, blocked ? "legal_hold_active" : null, now);
      return status;
    },
    placeLegalHold(request, placementInput) {
      const placement = normalizePlacement(placementInput);
      const stored = requireStored(requests, request, placement.request_id, "execute");
      if (stored.irreversibleEffectStarted) throw new DataGovernanceConflictError();
      requireState(stored, ["authorized", "inventorying", "ready", "blocked_by_legal_hold"]);
      const hold = normalizeHoldCommand(placement.hold, stored.command.tenant_id, "create");
      validateHoldItems(stored, placement.work_item_ids, hold.artifact_count);
      const previous = stored.holds.get(hold.hold_id);
      if (previous !== undefined) {
        if (sha256Canonical(previous.records[0]) !== sha256Canonical(hold)) throw new DataGovernanceConflictError();
        return copy(stored.status);
      }
      stored.holds.set(hold.hold_id, {
        records: [hold, createHoldReceipt(hold, options.id_factory, "created", options.clock.now())],
        workItemIds: placement.work_item_ids.map(uuid),
        active: true,
      });
      const now = timestamp(options.clock.now());
      refreshHeldItems(stored, now);
      const blocked = stored.items.size > 0;
      const status = transition(stored, blocked ? "blocked_by_legal_hold" : stored.status.state, now, blocked ? "legal_hold_active" : stored.status.status_code);
      if (blocked) appendReceipt(stored, options.id_factory, "legal_hold_blocked", null, "legal_hold_active", now);
      return status;
    },
    releaseLegalHold(request, placementInput) {
      const placement = normalizePlacement(placementInput);
      const stored = requireStored(requests, request, placement.request_id, "execute");
      const hold = normalizeHoldCommand(placement.hold, stored.command.tenant_id, "release");
      const ledger = stored.holds.get(hold.hold_id);
      if (ledger === undefined) throw new DataGovernanceNotFoundError();
      if (holdCommandReplay(ledger, hold)) return copy(stored.status);
      if (!ledger.active) throw new DataGovernanceConflictError();
      assertHoldContinuation(ledger, hold);
      validateHoldItems(stored, placement.work_item_ids, hold.artifact_count);
      ledger.records.push(hold, createHoldReceipt(hold, options.id_factory, "released", options.clock.now()));
      ledger.active = false;
      const now = timestamp(options.clock.now());
      refreshHeldItems(stored, now);
      return transition(stored, hasActionableUnheld(stored, Date.parse(now)) ? "ready" : "blocked_by_legal_hold", now, null);
    },
    expireLegalHold(request, placementInput) {
      const placement = normalizePlacement(placementInput);
      const stored = requireStored(requests, request, placement.request_id, "execute");
      const hold = normalizeHoldCommand(placement.hold, stored.command.tenant_id, "expire");
      const ledger = stored.holds.get(hold.hold_id);
      if (ledger === undefined) throw new DataGovernanceNotFoundError();
      if (holdCommandReplay(ledger, hold)) return copy(stored.status);
      if (!ledger.active || Date.parse(timestamp(options.clock.now())) < Date.parse(hold.expires_at)) throw new DataGovernanceConflictError();
      assertHoldContinuation(ledger, hold);
      validateHoldItems(stored, placement.work_item_ids, hold.artifact_count);
      ledger.records.push(hold, createHoldReceipt(hold, options.id_factory, "expired", options.clock.now()));
      ledger.active = false;
      const now = timestamp(options.clock.now());
      refreshHeldItems(stored, now);
      return transition(stored, hasActionableUnheld(stored, Date.parse(now)) ? "ready" : "blocked_by_legal_hold", now, null);
    },
    cancel(request, commandInput) {
      const stored = requireStored(requests, request, commandInput.request_id, "dispatch");
      const command = normalizeCommand(commandInput, stored.command.tenant_id, "cancel_request");
      if (command.actor_id !== request.principal.actorId) throw new DataGovernanceAuthorizationError();
      if (commandReplay(stored, command)) return copy(stored.status);
      if (stored.irreversibleEffectStarted) throw new DataGovernanceConflictError();
      requireState(stored, ["requested", "approval_pending", "authorized", "inventorying", "ready", "blocked_by_legal_hold"]);
      const now = timestamp(options.clock.now());
      const status = transition(stored, "cancelled", now, "cancelled_before_irreversible_effect");
      appendReceipt(stored, options.id_factory, "request_cancelled", null, "cancelled_before_irreversible_effect", now);
      return status;
    },
    claimNext(request, claimInput) {
      if (!plainObject(claimInput)) throw new DataGovernanceValidationError();
      const stored = requireStored(requests, request, claimInput.request_id, "execute");
      if (terminal(stored.status.state)) return copy({ outcome: "terminal", execution: null, status: stored.status });
      const runnable = ["ready", "blocked_by_legal_hold", "executing_redaction", "executing_irreversible_deletion", "retry_wait", "effect_unknown", "verifying"];
      if (!runnable.includes(stored.status.state)) return copy({ outcome: "idle", execution: null, status: stored.status });
      const now = timestamp(options.clock.now());
      const nowMs = Date.parse(now);
      const leaseMs = integer(claimInput.lease_duration_ms, 100, MAX_LEASE_MS);
      const requestedMaxAttempts = integer(claimInput.max_attempts, 1, MAX_ATTEMPTS);
      const claimToken = uuid(claimInput.claim_token);
      if (usedTokens.has(key(stored.command.tenant_id, claimToken))) throw new DataGovernanceConflictError();
      refreshHeldItems(stored, now);
      const item = [...stored.items.values()].find((candidate) => eligible(candidate, stored, nowMs));
      if (item === undefined) {
        const busy = [...stored.items.values()].some((candidate) => candidate.view.state === "leased");
        return copy({ outcome: busy ? "busy" : "idle", execution: null, status: stored.status });
      }
      let operation = item.view.state === "effect_unknown" ? "reconcile" : item.view.state === "verification_pending" ? "verify" : item.operation;
      if (item.view.state === "leased" && item.operation === "apply") {
        item.leaseToken = null;
        item.leaseExpiresAt = null;
        if (item.view.surface === "database") {
          item.view = copy({ ...item.view, state: "operator_required", lease_fence: null, lease_token_digest: null, failure_code: "operator_intervention_required", updated_at: now });
          transition(stored, "operator_required", now, "operator_intervention_required");
          appendReceipt(stored, options.id_factory, "operator_required", item, "operator_intervention_required", now);
          return copy({ outcome: "terminal", execution: null, status: stored.status });
        }
        operation = "reconcile";
        item.operation = operation;
        item.view = copy({ ...item.view, state: "effect_unknown", lease_fence: null, lease_token_digest: null, failure_code: "external_effect_unknown", updated_at: now });
        transition(stored, "effect_unknown", now, "external_effect_unknown");
        appendReceipt(stored, options.id_factory, "effect_unknown", item, "external_effect_unknown", now);
      }
      const attempt = item.view.attempt + 1;
      const maxAttempts = item.view.attempt === 0 ? requestedMaxAttempts : item.view.max_attempts;
      if (attempt > maxAttempts) {
        item.view = copy({ ...item.view, state: "operator_required", failure_code: "retry_budget_exhausted", updated_at: now });
        transition(stored, "operator_required", now, "retry_budget_exhausted");
        return copy({ outcome: "terminal", execution: null, status: stored.status });
      }
      const leaseFence = (item.view.lease_fence ?? 0) + 1;
      const leaseExpiresAt = new Date(nowMs + leaseMs).toISOString();
      item.operation = operation;
      item.leaseToken = claimToken;
      item.leaseExpiresAt = leaseExpiresAt;
      item.view = copy({ ...item.view, state: "leased", attempt, max_attempts: maxAttempts, lease_fence: leaseFence, lease_token_digest: sha256Canonical({ claim_token: claimToken }), next_attempt_at: null, failure_code: null, updated_at: now });
      if (operation === "apply") stored.irreversibleEffectStarted = true;
      usedTokens.add(key(stored.command.tenant_id, claimToken));
      const state = operation === "verify" ? "verifying" : operation === "reconcile" ? "effect_unknown" : item.view.action === "redact" ? "executing_redaction" : "executing_irreversible_deletion";
      transition(stored, state, now, null, item.view.action, attempt);
      return copy({
        outcome: "claimed",
        execution: {
          request_id: stored.command.request_id,
          tenant_id: stored.command.tenant_id,
          scope_type: stored.command.scope_type,
          data_subject_id: stored.command.data_subject_id,
          work_item: item.view,
          operation,
          claim_token: claimToken,
          lease_expires_at: leaseExpiresAt,
        },
        status: stored.status,
      });
    },
    checkpoint(request, mutation) {
      if (!plainObject(mutation)) throw new DataGovernanceValidationError();
      const stored = requireStored(requests, request, mutation.request_id, "execute");
      const workItemId = uuid(mutation.work_item_id);
      const item = stored.items.get(workItemId);
      if (item === undefined) throw new DataGovernanceNotFoundError();
      const now = timestamp(options.clock.now());
      const claimToken = uuid(mutation.claim_token);
      const operation = parseOperation(mutation.operation);
      const attempt = integer(mutation.attempt, 1, MAX_ATTEMPTS);
      const leaseFence = integer(mutation.lease_fence, 1, 10_000_000);
      if (item.view.state !== "leased" || item.leaseToken !== claimToken || item.operation !== operation || item.view.attempt !== attempt || item.view.lease_fence !== leaseFence || item.leaseExpiresAt === null || Date.parse(item.leaseExpiresAt) < Date.parse(now)) throw new DataGovernanceConflictError();
      const result = parseResult(mutation.result, item.view.surface);
      const retryDelay = integer(mutation.retry_delay_ms, 1, MAX_RETRY_MS);
      item.leaseToken = null;
      item.leaseExpiresAt = null;
      if (result.outcome === "succeeded") {
        item.operation = "verify";
        item.view = copy({ ...item.view, state: operation === "verify" ? "verified" : "verification_pending", resource_locator_hmac: operation === "verify" ? null : item.view.resource_locator_hmac, lease_fence: null, lease_token_digest: null, verification_digest: operation === "verify" ? sha256Canonical({ result, work_item_id: workItemId }) : null, recoverable_until: result.recoverable_until ?? item.view.recoverable_until, updated_at: now });
        const outcome = operation === "verify" ? "verification_completed" : item.view.action === "redact" ? "redaction_completed" : "irreversible_deletion_completed";
        appendReceipt(stored, options.id_factory, outcome, item, null, now);
      } else if (result.outcome === "retryable") {
        item.operation = operation;
        const exhausted = attempt >= item.view.max_attempts;
        item.view = copy({ ...item.view, state: exhausted ? "operator_required" : "retry_wait", lease_fence: null, lease_token_digest: null, next_attempt_at: exhausted ? null : new Date(Date.parse(now) + retryDelay).toISOString(), failure_code: exhausted ? "retry_budget_exhausted" : "external_retryable", updated_at: now });
        appendReceipt(stored, options.id_factory, exhausted ? "operator_required" : "retry_scheduled", item, exhausted ? "retry_budget_exhausted" : "external_retryable", now);
      } else if (result.outcome === "unknown") {
        if (operation === "verify") {
          item.operation = "verify";
          const exhausted = attempt >= item.view.max_attempts;
          item.view = copy({ ...item.view, state: exhausted ? "operator_required" : "retry_wait", lease_fence: null, lease_token_digest: null, next_attempt_at: exhausted ? null : new Date(Date.parse(now) + retryDelay).toISOString(), failure_code: exhausted ? "retry_budget_exhausted" : "external_retryable", updated_at: now });
          appendReceipt(stored, options.id_factory, exhausted ? "operator_required" : "retry_scheduled", item, exhausted ? "retry_budget_exhausted" : "external_retryable", now);
        } else if (operation === "apply" && item.view.surface === "database") {
          item.view = copy({ ...item.view, state: "operator_required", lease_fence: null, lease_token_digest: null, failure_code: "operator_intervention_required", updated_at: now });
          appendReceipt(stored, options.id_factory, "operator_required", item, "operator_intervention_required", now);
        } else {
          item.operation = "reconcile";
          item.view = copy({ ...item.view, state: "effect_unknown", lease_fence: null, lease_token_digest: null, failure_code: "external_effect_unknown", updated_at: now });
          appendReceipt(stored, options.id_factory, "effect_unknown", item, "external_effect_unknown", now);
        }
      } else {
        item.view = copy({ ...item.view, state: "operator_required", lease_fence: null, lease_token_digest: null, failure_code: "operator_intervention_required", updated_at: now });
        appendReceipt(stored, options.id_factory, "operator_required", item, "operator_intervention_required", now);
      }
      updateAggregate(stored, now, options.id_factory);
      return copy(stored.status);
    },
    readCommand(request, requestId) { return copy(requireStored(requests, request, requestId, "observe").command); },
    readStatus(request, requestId) { return copy(requireStored(requests, request, requestId, "observe").status); },
    listWorkItems(request, requestId) { return Object.freeze([...requireStored(requests, request, requestId, "observe").items.values()].map(({ view }) => copy(view))); },
    listReceipts(request, requestId) { return Object.freeze(requireStored(requests, request, requestId, "observe").receipts.map(copy)); },
    listLegalHolds(request, requestId) { return Object.freeze([...requireStored(requests, request, requestId, "observe").holds.values()].flatMap(({ records }) => records.map(copy))); },
  };
  return Object.freeze(repository);
}

export function createManualDataGovernanceClock(initial: unknown): DataGovernanceClock & { advanceBy(ms: unknown): string } {
  let nowMs = Date.parse(timestamp(initial));
  const clock = Object.freeze({ now: () => new Date(nowMs).toISOString(), advanceBy(ms: unknown) { nowMs += integer(ms, 0, MAX_RETRY_MS); return new Date(nowMs).toISOString(); } });
  TRUSTED_CLOCKS.add(clock);
  return clock;
}
export function createDeterministicDataGovernanceIdFactory(idsInput: readonly unknown[]): DataGovernanceIdFactory {
  if (!Array.isArray(idsInput) || idsInput.length < 1 || idsInput.length > 8192) throw new DataGovernanceConfigurationError();
  const ids = idsInput.map(uuid);
  if (new Set(ids).size !== ids.length) throw new DataGovernanceConfigurationError();
  let cursor = 0;
  const factory = Object.freeze({ nextReceiptId() { const value = ids[cursor]; if (value === undefined) throw new DataGovernanceConfigurationError(); cursor += 1; return value; } });
  TRUSTED_ID_FACTORIES.add(factory);
  return factory;
}
export function dataGovernanceRequestFingerprint(command: DataGovernanceCommand): string { return requestFingerprint(command); }

function normalizeCommand(value: DataGovernanceCommand, tenantId: string, expectedType: DataGovernanceCommand["command_type"]): DataGovernanceCommand {
  assertExactRecord(value, ["schema_version", "governance_version", "command_id", "request_id", "tenant_id", "command_type", "scope_type", "data_subject_id", "requested_action", "actor_id", "policy_decision_id", "approval_ids", "policy_version", "inventory_version", "request_fingerprint", "idempotency_key", "trace_id", "correlation_id", "causation_id", "issued_at", "authorization_expires_at", "data_classification"]);
  if (!Array.isArray(value.approval_ids)) throw new DataGovernanceValidationError();
  const approvalIds = value.approval_ids.map(uuid);
  const command = copy({ ...value, command_id: uuid(value.command_id), request_id: uuid(value.request_id), tenant_id: parseTenantId(value.tenant_id), data_subject_id: value.data_subject_id === null ? null : uuid(value.data_subject_id), actor_id: uuid(value.actor_id), policy_decision_id: value.policy_decision_id === null ? null : uuid(value.policy_decision_id), approval_ids: approvalIds, correlation_id: uuid(value.correlation_id), causation_id: value.causation_id === null ? null : uuid(value.causation_id), issued_at: timestamp(value.issued_at), authorization_expires_at: value.authorization_expires_at === null ? null : timestamp(value.authorization_expires_at) });
  if (command.tenant_id !== tenantId) throw new DataGovernanceAuthorizationError();
  const expectedIdempotencyKey = `data-governance/v1/${command.tenant_id}/${command.request_id}/${command.command_id}`;
  const invalidAuthorityShape = expectedType === "request_deletion"
    ? command.policy_decision_id !== null || command.approval_ids.length !== 0 || command.authorization_expires_at !== null
    : expectedType === "authorize_execution"
      ? command.policy_decision_id === null || command.authorization_expires_at === null || command.approval_ids.length !== (command.scope_type === "tenant" ? 2 : 1)
      : command.approval_ids.length !== 0 || command.authorization_expires_at !== null;
  const approvalsInvalid = new Set(command.approval_ids).size !== command.approval_ids.length
    || [...command.approval_ids].sort().some((id, index) => id !== command.approval_ids[index]);
  if (command.schema_version !== "2.0.0" || command.governance_version !== "1.0.0" || command.command_type !== expectedType || command.scope_type !== "tenant" && command.scope_type !== "data_subject" || command.requested_action !== "redact" && command.requested_action !== "irreversible_delete" || invalidAuthorityShape || approvalsInvalid || command.idempotency_key !== expectedIdempotencyKey || command.policy_version !== "1.0.0" || command.inventory_version !== "1.0.0" || command.data_classification !== "internal" || !TRACE.test(command.trace_id) || !SHA256.test(command.request_fingerprint) || command.scope_type === "tenant" && (command.data_subject_id !== null || command.requested_action === "redact") || command.scope_type === "data_subject" && command.data_subject_id === null) throw new DataGovernanceValidationError();
  return command;
}
function normalizeWorkItem(value: DataGovernanceWorkItem, stored: StoredRequest, defaultMaxAttempts: number, now: string): DataGovernanceWorkItem {
  assertExactRecord(value, ["schema_version", "governance_version", "work_item_id", "request_id", "tenant_id", "surface", "resource_class", "action", "state", "resource_locator_hmac", "resource_count", "attempt", "max_attempts", "lease_fence", "lease_token_digest", "next_attempt_at", "failure_code", "verification_digest", "retention_exception_code", "recoverable_until", "correlation_id", "created_at", "updated_at", "data_classification"]);
  const item = copy({ ...value, work_item_id: uuid(value.work_item_id), request_id: uuid(value.request_id), tenant_id: parseTenantId(value.tenant_id), recoverable_until: value.recoverable_until === null ? null : timestamp(value.recoverable_until), correlation_id: uuid(value.correlation_id), created_at: timestamp(value.created_at), updated_at: timestamp(value.updated_at) });
  if (item.schema_version !== "2.0.0" || item.governance_version !== "1.0.0" || item.request_id !== stored.command.request_id || item.tenant_id !== stored.command.tenant_id || item.state !== "pending" || !DATA_DISPOSITION_TARGETS.includes(item.surface) || !RESOURCE_CLASSES.includes(item.resource_class) || invalidRequestedAction(item, stored.command.requested_action) || typeof item.resource_locator_hmac !== "string" || !HMAC.test(item.resource_locator_hmac) || !Number.isSafeInteger(item.resource_count) || item.resource_count < 1 || item.resource_count > 10_000 || item.attempt !== 0 || item.max_attempts !== defaultMaxAttempts || item.lease_fence !== null || item.lease_token_digest !== null || item.next_attempt_at !== null || item.failure_code !== null || item.verification_digest !== null || item.retention_exception_code !== null || item.surface === "backup" && item.recoverable_until === null || item.surface !== "backup" && item.recoverable_until !== null || item.data_classification !== "internal" || Date.parse(item.updated_at) > Date.parse(now)) throw new DataGovernanceValidationError();
  return item;
}
function invalidRequestedAction(item: DataGovernanceWorkItem, requestedAction: DataGovernanceCommand["requested_action"]): boolean {
  if (requestedAction === "redact") return item.action !== (item.surface === "backup" ? "backup_expiry_wait" : "redact");
  switch (item.surface) {
    case "database": return item.action !== "irreversible_delete";
    case "cache": return item.action !== "cache_invalidate";
    case "embedding_index": return item.action !== "external_delete";
    case "backup": return item.action !== "backup_expiry_wait";
    case "object_storage":
    case "provider_copy":
    case "auth_identity":
    case "vault_secret":
      return item.action !== "external_delete" && item.action !== "crypto_erase";
  }
}
function normalizePlacement(value: DataLegalHoldPlacement): DataLegalHoldPlacement {
  assertExactRecord(value, ["request_id", "work_item_ids", "hold"]);
  if (!Array.isArray(value.work_item_ids) || !plainObject(value.hold)) throw new DataGovernanceValidationError();
  return Object.freeze({ request_id: uuid(value.request_id), work_item_ids: value.work_item_ids.map(uuid), hold: value.hold });
}
function normalizeHoldCommand(value: DataLegalHold, tenantId: string, operation: "create" | "release" | "expire"): DataLegalHoldCommand {
  assertExactRecord(value, ["schema_version", "governance_version", "record_type", "operation", "hold_id", "tenant_id", "command_id", "receipt_id", "scope_type", "scope_hmac", "artifact_count", "purpose_code", "authority_code", "authorized_by_actor_id", "authorization_id", "starts_at", "expires_at", "outcome", "outcome_code", "record_fingerprint", "trace_id", "correlation_id", "recorded_at", "data_classification"]);
  if (value.record_type !== "command") throw new DataGovernanceValidationError();
  const hold = copy({ ...value, hold_id: uuid(value.hold_id), tenant_id: parseTenantId(value.tenant_id), command_id: uuid(value.command_id), authorized_by_actor_id: uuid(value.authorized_by_actor_id), authorization_id: uuid(value.authorization_id), correlation_id: uuid(value.correlation_id), starts_at: timestamp(value.starts_at), expires_at: timestamp(value.expires_at), recorded_at: timestamp(value.recorded_at) });
  if (hold.schema_version !== "2.0.0" || hold.governance_version !== "1.0.0" || hold.operation !== operation || hold.tenant_id !== tenantId || hold.receipt_id !== null || hold.scope_type !== "artifact_set" && hold.scope_type !== "data_subject" || !HMAC.test(hold.scope_hmac) || !Number.isSafeInteger(hold.artifact_count) || hold.artifact_count < 1 || hold.artifact_count > 10_000 || !HOLD_PURPOSES.includes(hold.purpose_code) || !HOLD_AUTHORITIES.includes(hold.authority_code) || hold.outcome !== null || hold.outcome_code !== null || hold.expires_at <= hold.starts_at || !SHA256.test(hold.record_fingerprint) || !TRACE.test(hold.trace_id) || hold.data_classification !== "internal") throw new DataGovernanceValidationError();
  return hold;
}
function createHoldReceipt(command: DataLegalHoldCommand, ids: DataGovernanceIdFactory, outcome: "created" | "released" | "expired", nowInput: unknown): DataLegalHold {
  const now = timestamp(nowInput);
  const base = {
    schema_version: "2.0.0" as const,
    governance_version: "1.0.0" as const,
    record_type: "receipt" as const,
    operation: command.operation,
    hold_id: command.hold_id,
    tenant_id: command.tenant_id,
    command_id: command.command_id,
    receipt_id: uuid(ids.nextReceiptId()),
    scope_type: command.scope_type,
    scope_hmac: null,
    artifact_count: command.artifact_count,
    purpose_code: command.purpose_code,
    authority_code: command.authority_code,
    authorized_by_actor_id: null,
    authorization_id: command.authorization_id,
    starts_at: command.starts_at,
    expires_at: command.expires_at,
    outcome,
    outcome_code: null,
    trace_id: command.trace_id,
    correlation_id: command.correlation_id,
    recorded_at: now,
    data_classification: "internal" as const,
  };
  return copy({ ...base, record_fingerprint: sha256Canonical(base) });
}
function assertHoldContinuation(ledger: StoredHold, command: DataLegalHoldCommand): void {
  const created = ledger.records[0];
  if (created?.record_type !== "command" || created.operation !== "create" || created.scope_hmac !== command.scope_hmac || created.scope_type !== command.scope_type || created.artifact_count !== command.artifact_count) throw new DataGovernanceConflictError();
}
function holdCommandReplay(ledger: StoredHold, command: DataLegalHoldCommand): boolean {
  const previous = ledger.records.find((record) => record.record_type === "command" && record.command_id === command.command_id);
  if (previous === undefined) return false;
  if (sha256Canonical(previous) !== sha256Canonical(command)) throw new DataGovernanceConflictError();
  return true;
}
function validateHoldItems(stored: StoredRequest, workItemIds: readonly string[], artifactCount: number): void {
  if (workItemIds.length < 1 || workItemIds.length !== artifactCount || new Set(workItemIds).size !== workItemIds.length) throw new DataGovernanceValidationError();
  if (stored.items.size > 0 && workItemIds.some((id) => !stored.items.has(id))) throw new DataGovernanceValidationError();
}
function parseResult(value: unknown, surface: DataDispositionTarget): DataDispositionResult {
  if (!plainObject(value) || !(["succeeded", "retryable", "unknown", "denied"] as const).includes(value.outcome as never)) throw new DataGovernanceValidationError();
  const code = governanceCode(value.code);
  if (value.outcome !== "succeeded") return Object.freeze({ outcome: value.outcome as "retryable" | "unknown" | "denied", code });
  if (surface === "backup") { if (typeof value.recoverable_until !== "string") throw new DataGovernanceValidationError(); return Object.freeze({ outcome: "succeeded", code, recoverable_until: timestamp(value.recoverable_until) }); }
  if (value.recoverable_until !== undefined) throw new DataGovernanceValidationError();
  return Object.freeze({ outcome: "succeeded", code });
}
function requestFingerprint(command: DataGovernanceCommand): string {
  return sha256Canonical({ governance_version: command.governance_version, request_id: command.request_id, tenant_id: command.tenant_id, scope_type: command.scope_type, data_subject_id: command.data_subject_id, requested_action: command.requested_action, policy_version: command.policy_version, inventory_version: command.inventory_version });
}
function initialStatus(command: DataGovernanceCommand, now: string): DataGovernanceStatus {
  return copy({ schema_version: "2.0.0", governance_version: "1.0.0", request_id: command.request_id, tenant_id: command.tenant_id, scope_type: command.scope_type, state: "requested", state_version: 1, active_action: null, policy_version: "1.0.0", inventory_version: "1.0.0", inventory_fingerprint: null, work_item_count: 0, verified_work_item_count: 0, held_work_item_count: 0, retained_exception_count: 0, attempt: 0, next_attempt_at: null, status_code: null, trace_id: command.trace_id, correlation_id: command.correlation_id, updated_at: now, completed_at: null, data_classification: "internal" });
}
function transition(stored: StoredRequest, state: DataGovernanceStatus["state"], nowInput: unknown, statusCode: DataGovernanceStatus["status_code"], action: DataGovernanceStatus["active_action"] = null, attempt = stored.status.attempt): DataGovernanceStatus {
  const now = timestamp(nowInput);
  const items = [...stored.items.values()].map(({ view }) => view);
  stored.status = copy({ ...stored.status, state, state_version: stored.status.state_version + 1, active_action: action, work_item_count: items.length, verified_work_item_count: items.filter((item) => item.state === "verified").length, held_work_item_count: items.filter((item) => item.state === "held").length, retained_exception_count: items.filter((item) => item.state === "retained_exception").length, attempt, next_attempt_at: state === "retry_wait" ? items.map((item) => item.next_attempt_at).filter((value): value is string => value !== null).sort()[0] ?? null : null, status_code: statusCode, updated_at: now, completed_at: terminal(state) ? now : null });
  return copy(stored.status);
}
function updateAggregate(stored: StoredRequest, now: string, ids: DataGovernanceIdFactory): void {
  const items = [...stored.items.values()];
  let state: DataGovernanceStatus["state"];
  let code: DataGovernanceStatus["status_code"] = null;
  if (items.some(({ view }) => view.state === "operator_required")) { state = "operator_required"; code = "operator_intervention_required"; }
  else if (items.some(({ view }) => view.state === "effect_unknown")) { state = "effect_unknown"; code = "external_effect_unknown"; }
  else if (items.some(({ view }) => view.state === "retry_wait")) { state = "retry_wait"; code = "external_retryable"; }
  else if (items.every(({ view }) => view.state === "verified" || view.state === "retained_exception")) state = "completed";
  else if (!hasActionableUnheld(stored, Date.parse(now))) { state = "blocked_by_legal_hold"; code = "legal_hold_active"; }
  else if (items.some(({ view }) => view.state === "verification_pending")) state = "verifying";
  else state = items.some(({ view }) => view.action === "redact") ? "executing_redaction" : "executing_irreversible_deletion";
  const activeAction = [
    "executing_redaction",
    "executing_irreversible_deletion",
    "retry_wait",
    "effect_unknown",
    "verifying",
  ].includes(state) ? stored.command.requested_action : null;
  transition(stored, state, now, code, activeAction);
  if (state === "completed") appendReceipt(stored, ids, "request_completed", null, null, now);
}
function appendReceipt(stored: StoredRequest, ids: DataGovernanceIdFactory, outcome: DataGovernanceReceipt["outcome"], item: StoredItem | null, outcomeCode: DataGovernanceReceipt["outcome_code"], now: string): void {
  const resultingState: DataGovernanceReceipt["resulting_state"] = outcome === "retry_scheduled" ? "retry_wait"
    : outcome === "effect_unknown" ? "effect_unknown"
      : outcome === "operator_required" ? "operator_required"
        : outcome === "redaction_completed" ? "verifying"
          : outcome === "legal_hold_blocked" ? "blocked_by_legal_hold"
            : stored.status.state;
  const views = [...stored.items.values()].map(({ view }) => view);
  const base = { schema_version: "2.0.0" as const, governance_version: "1.0.0" as const, receipt_id: uuid(ids.nextReceiptId()), request_id: stored.command.request_id, tenant_id: stored.command.tenant_id, scope_type: stored.command.scope_type, outcome, resulting_state: resultingState, work_item_id: item?.view.work_item_id ?? null, surface: item?.view.surface ?? null, action: item?.view.action ?? null, policy_version: "1.0.0" as const, inventory_version: "1.0.0" as const, inventory_fingerprint: stored.status.inventory_fingerprint, affected_resource_count: item?.view.resource_count ?? views.reduce((sum, view) => sum + view.resource_count, 0), verified_resource_count: views.filter((view) => view.state === "verified").reduce((sum, view) => sum + view.resource_count, 0), retained_exception_count: views.filter((view) => view.state === "retained_exception").reduce((sum, view) => sum + view.resource_count, 0), outcome_code: outcomeCode, trace_id: stored.command.trace_id, correlation_id: stored.command.correlation_id, causation_id: stored.command.command_id, recorded_at: timestamp(now), data_classification: "internal" as const };
  stored.receipts.push(copy<DataGovernanceReceipt>({ ...base, receipt_fingerprint: sha256Canonical(base) }));
}
function commandReplay(stored: StoredRequest, command: DataGovernanceCommand): boolean {
  if (command.request_id !== stored.command.request_id || command.scope_type !== stored.command.scope_type || command.data_subject_id !== stored.command.data_subject_id || command.requested_action !== stored.command.requested_action || command.request_fingerprint !== stored.command.request_fingerprint) throw new DataGovernanceConflictError();
  const fingerprint = sha256Canonical(command);
  const byId = stored.commands.get(`id:${command.command_id}`);
  const byIdempotency = stored.commands.get(`idem:${command.idempotency_key}`);
  if (byId !== undefined && byId !== fingerprint || byIdempotency !== undefined && byIdempotency !== fingerprint) throw new DataGovernanceConflictError();
  if (byId !== undefined || byIdempotency !== undefined) return true;
  stored.commands.set(`id:${command.command_id}`, fingerprint);
  stored.commands.set(`idem:${command.idempotency_key}`, fingerprint);
  return false;
}
function eligible(item: StoredItem, stored: StoredRequest, nowMs: number): boolean {
  if (isHeld(stored, item.view.work_item_id, nowMs)) return false;
  if (item.view.state === "pending" || item.view.state === "effect_unknown" || item.view.state === "verification_pending") return true;
  if (item.view.state === "retry_wait") return item.view.next_attempt_at !== null && Date.parse(item.view.next_attempt_at) <= nowMs;
  if (item.view.state === "leased" && item.leaseExpiresAt !== null) return Date.parse(item.leaseExpiresAt) <= nowMs;
  return false;
}
function refreshHeldItems(stored: StoredRequest, now: string): void {
  const nowMs = Date.parse(now);
  for (const item of stored.items.values()) {
    if (item.view.state !== "pending" && item.view.state !== "held") continue;
    const held = isHeld(stored, item.view.work_item_id, nowMs);
    item.view = copy({ ...item.view, state: held ? "held" : "pending", failure_code: held ? "legal_hold_active" : null, updated_at: now });
  }
}
function hasActionableUnheld(stored: StoredRequest, nowMs: number): boolean { return [...stored.items.values()].some((item) => item.view.state !== "verified" && item.view.state !== "retained_exception" && item.view.state !== "operator_required" && !isHeld(stored, item.view.work_item_id, nowMs)); }
function isHeld(stored: StoredRequest, id: string, _nowMs: number): boolean { return [...stored.holds.values()].some((hold) => hold.active && hold.workItemIds.includes(id)); }
function terminal(state: DataGovernanceStatus["state"]): boolean { return ["completed", "denied", "expired", "cancelled", "operator_required"].includes(state); }
function requireState(stored: StoredRequest, states: readonly DataGovernanceStatus["state"][]): void { if (!states.includes(stored.status.state)) throw new DataGovernanceConflictError(); }
function requireStored(requests: Map<string, StoredRequest>, request: AuthorizedRequestContext, idInput: unknown, mode: "dispatch" | "execute" | "observe"): StoredRequest {
  const tenantId = authority(request, mode);
  const stored = requests.get(key(tenantId, uuid(idInput)));
  if (stored === undefined) throw new DataGovernanceNotFoundError();
  return stored;
}
function authority(request: AuthorizedRequestContext, mode: "dispatch" | "execute" | "observe"): string {
  try {
    const context = getAuthorizedTenantContext(request);
    const needed = mode === "dispatch" ? "workflow:dispatch" : mode === "execute" ? "workflow:execute" : "workflow:observe";
    if (!context.grantedScopes.includes(needed) || !context.purposes.includes("essential_processing")) throw new Error();
    if (mode === "execute" && (request.principal.identityKind !== "service" || request.principal.actorType !== "workflow")) throw new Error();
    return context.tenantId;
  } catch { throw new DataGovernanceAuthorizationError(); }
}
function parseOperation(value: unknown): DataDispositionOperation { if (value !== "apply" && value !== "reconcile" && value !== "verify") throw new DataGovernanceValidationError(); return value; }
function governanceCode(value: unknown): DataGovernanceCode { if (typeof value !== "string" || !/^[a-z][a-z0-9_]{0,63}$/.test(value)) throw new DataGovernanceValidationError(); return value as DataGovernanceCode; }
function uuid(value: unknown): string { try { return parseUuidV7(value); } catch { throw new DataGovernanceValidationError(); } }
function timestamp(value: unknown): string { if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new DataGovernanceValidationError(); return new Date(Date.parse(value)).toISOString(); }
function integer(value: unknown, min: number, max: number): number { if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) throw new DataGovernanceValidationError(); return value; }
function optionalInteger(value: unknown, fallback: number, min: number, max: number): number { return value === undefined ? fallback : integer(value, min, max); }
function key(tenantId: string, id: string): string { return `${tenantId}:${id}`; }
function plainObject(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype; }
function assertExactRecord(value: unknown, expectedKeys: readonly string[]): asserts value is Record<string, unknown> {
  if (!plainObject(value)) throw new DataGovernanceValidationError();
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== expectedKeys.length || ownKeys.some((keyValue) => typeof keyValue !== "string" || !expectedKeys.includes(keyValue))) throw new DataGovernanceValidationError();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.values(descriptors).some((descriptor) => !("value" in descriptor))) throw new DataGovernanceValidationError();
}
function copy<T>(value: T): T { return deepFreeze(structuredClone(value)); }
function deepFreeze<T>(value: T): T { if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value; for (const child of Object.values(value)) deepFreeze(child); return Object.freeze(value); }
