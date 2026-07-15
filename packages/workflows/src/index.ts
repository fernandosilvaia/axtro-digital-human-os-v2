import {
  assertAuthorizedTenantMatch,
  getAuthorizedTenantContext,
  type AuthorizedRequestContext,
} from "@axtro/auth";
import type {
  EventEnvelope,
  PostCallWorkflowCommand,
  PostCallWorkflowResult,
  PostCallWorkflowStatus,
  WorkflowEnqueueReceipt,
  WorkflowStepReceipt,
} from "@axtro/contracts-ts";
import {
  parseCorrelationId,
  parseSessionId,
  parseTenantId,
  parseUuidV7,
  sha256Canonical,
  type TenantId,
  type UuidV7,
} from "@axtro/domain";

export const POST_CALL_WORKFLOW_TYPE = "post_call_processing" as const;
export const POST_CALL_WORKFLOW_VERSION = "1.0.0" as const;
export const POST_CALL_WORKFLOW_STEPS = [
  "generate_summary",
  "evaluate",
  "record_follow_up_guard",
  "finalize",
] as const;
export type PostCallWorkflowStep = (typeof POST_CALL_WORKFLOW_STEPS)[number];

export const WORKFLOW_REPOSITORY_FAULT_POINTS = ["before_enqueue_commit"] as const;
export type WorkflowRepositoryFaultPoint = (typeof WORKFLOW_REPOSITORY_FAULT_POINTS)[number];

export interface WorkflowClock {
  now(): string;
}

export interface ManualWorkflowClock extends WorkflowClock {
  advanceBy(milliseconds: unknown): string;
}

export interface WorkflowIdFactory {
  nextId(kind: "command" | "run" | "follow_up"): UuidV7;
}

export interface DeterministicWorkflowIdFixtures {
  readonly command_ids: readonly unknown[];
  readonly run_ids: readonly unknown[];
  readonly follow_up_command_ids: readonly unknown[];
}

export interface SessionCompletionEvidence {
  readonly tenant_id: string;
  readonly session_id: string;
  readonly source_event_id: string;
  readonly source_event_fingerprint: string;
  readonly source_aggregate_version: number;
  readonly source_state_hash: string;
  readonly final_status: "completed";
  readonly canonical_event_count: number;
  readonly final_state_version: number;
  readonly evidence_event_ids: readonly string[];
}

export interface SessionCompletionEvidenceSource {
  readSessionCompletionEvidence(
    request: AuthorizedRequestContext,
    sessionId: string,
  ): SessionCompletionEvidence;
}

export interface SessionCompletionWorkflowSink {
  enqueueSessionCompletion(
    request: AuthorizedRequestContext,
    completionEvent: EventEnvelope,
  ): Promise<WorkflowEnqueueReceipt>;
}

export interface PostCallWorkflowRepositoryOptions {
  readonly evidence_source: SessionCompletionEvidenceSource;
  readonly clock: WorkflowClock;
  readonly id_factory: WorkflowIdFactory;
  readonly max_runs_per_tenant?: unknown;
  readonly default_max_attempts?: unknown;
  readonly fault_points?: readonly WorkflowRepositoryFaultPoint[];
}

export interface ClaimWorkflowStepInput {
  readonly workflow_run_id: unknown;
  readonly claim_token_factory: unknown;
  readonly lease_duration_ms: unknown;
  readonly max_attempts: unknown;
}

export interface WorkflowStepExecution {
  readonly tenant_id: string;
  readonly session_id: string;
  readonly workflow_run_id: string;
  readonly command_id: string;
  readonly source_event_id: string;
  readonly trace_id: string;
  readonly correlation_id: string;
  readonly causation_id: string | null;
  readonly step: PostCallWorkflowStep;
  readonly attempt: number;
  readonly claim_token: string;
  readonly lease_expires_at: string;
  readonly evidence: SessionCompletionEvidence;
  readonly summary: PostCallWorkflowResult["summary"] | null;
  readonly evaluation: PostCallWorkflowResult["evaluation"] | null;
  readonly follow_up_guard: PostCallWorkflowResult["follow_up_guard"] | null;
}

export type WorkflowClaimResult =
  | Readonly<{ outcome: "claimed"; execution: WorkflowStepExecution; status: PostCallWorkflowStatus }>
  | Readonly<{ outcome: "idle" | "busy" | "terminal"; execution: null; status: PostCallWorkflowStatus }>;

export interface CheckpointWorkflowStepInput {
  readonly workflow_run_id: unknown;
  readonly claim_token: unknown;
  readonly step: unknown;
  readonly attempt: unknown;
  readonly artifact: unknown;
}

export interface FailWorkflowStepInput {
  readonly workflow_run_id: unknown;
  readonly claim_token: unknown;
  readonly step: unknown;
  readonly attempt: unknown;
  readonly failure_code: unknown;
  readonly retryable: unknown;
  readonly retry_delay_ms: unknown;
}

export interface CancelWorkflowInput {
  readonly workflow_run_id: unknown;
}

export interface WorkflowMutationResult {
  readonly status: PostCallWorkflowStatus;
  readonly receipt: WorkflowStepReceipt;
  readonly result: PostCallWorkflowResult | null;
}

export interface PostCallWorkflowRepository extends SessionCompletionWorkflowSink {
  claimStep(request: AuthorizedRequestContext, input: ClaimWorkflowStepInput): WorkflowClaimResult;
  checkpointStep(request: AuthorizedRequestContext, input: CheckpointWorkflowStepInput): WorkflowMutationResult;
  failStep(request: AuthorizedRequestContext, input: FailWorkflowStepInput): WorkflowMutationResult;
  cancel(request: AuthorizedRequestContext, input: CancelWorkflowInput): PostCallWorkflowStatus;
  readStatus(request: AuthorizedRequestContext, workflowRunId: unknown): PostCallWorkflowStatus;
  readResult(request: AuthorizedRequestContext, workflowRunId: unknown): PostCallWorkflowResult | null;
  readCommand(request: AuthorizedRequestContext, workflowRunId: unknown): PostCallWorkflowCommand;
  readEnqueueReceipt(request: AuthorizedRequestContext, sourceEventId: unknown): WorkflowEnqueueReceipt | null;
  listStepReceipts(request: AuthorizedRequestContext, workflowRunId: unknown): readonly WorkflowStepReceipt[];
}

export class WorkflowConfigurationError extends Error {
  constructor() {
    super("Workflow configuration is invalid");
    this.name = "WorkflowConfigurationError";
  }
}

export class WorkflowAuthorizationError extends Error {
  constructor() {
    super("Workflow access is not authorized");
    this.name = "WorkflowAuthorizationError";
  }
}

export class WorkflowValidationError extends Error {
  constructor() {
    super("Workflow input is invalid");
    this.name = "WorkflowValidationError";
  }
}

export class WorkflowConflictError extends Error {
  constructor() {
    super("Workflow input conflicts with persisted state");
    this.name = "WorkflowConflictError";
  }
}

export class WorkflowNotFoundError extends Error {
  constructor() {
    super("Workflow run was not found");
    this.name = "WorkflowNotFoundError";
  }
}

export class WorkflowCapacityError extends Error {
  constructor() {
    super("Workflow capacity is exhausted");
    this.name = "WorkflowCapacityError";
  }
}

export class WorkflowRetryableError extends Error {
  constructor() {
    super("Workflow operation should be retried");
    this.name = "WorkflowRetryableError";
  }
}

export class WorkflowActivityRetryableError extends Error {
  constructor() {
    super("Deterministic workflow activity requested retry");
    this.name = "WorkflowActivityRetryableError";
  }
}

export class WorkflowPolicyDeniedError extends Error {
  constructor() {
    super("Workflow policy denied the deterministic activity");
    this.name = "WorkflowPolicyDeniedError";
  }
}

interface StoredClaim {
  readonly token: UuidV7;
  readonly step: PostCallWorkflowStep;
  readonly attempt: number;
  readonly startedAt: string;
  readonly expiresAt: string;
}

interface StoredRun {
  readonly command: PostCallWorkflowCommand;
  readonly commandFingerprint: string;
  readonly enqueueReceipt: WorkflowEnqueueReceipt;
  readonly evidence: SessionCompletionEvidence;
  status: PostCallWorkflowStatus;
  claim: StoredClaim | null;
  budgetPinned: boolean;
  readonly attemptsByStep: Record<PostCallWorkflowStep, number>;
  summary: PostCallWorkflowResult["summary"] | null;
  evaluation: PostCallWorkflowResult["evaluation"] | null;
  followUpGuard: PostCallWorkflowResult["follow_up_guard"] | null;
  result: PostCallWorkflowResult | null;
  readonly receipts: WorkflowStepReceipt[];
}

interface NormalizedRepositoryOptions {
  readonly evidenceSource: SessionCompletionEvidenceSource;
  readonly clock: WorkflowClock;
  readonly idFactory: WorkflowIdFactory;
  readonly maxRunsPerTenant: number;
  readonly defaultMaxAttempts: number;
  readonly faultPoints: WorkflowRepositoryFaultPoint[];
}

const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const TRACE_PATTERN = /^[0-9a-f]{16,64}$/;
const DEFAULT_MAX_RUNS_PER_TENANT = 128;
const MAX_RUNS_PER_TENANT = 1_024;
const DEFAULT_MAX_ATTEMPTS = 4;
const MAX_ATTEMPTS = 16;
const MAX_FIXTURE_IDS = 1_024;
const MAX_LEASE_DURATION_MS = 300_000;
const MAX_RETRY_DELAY_MS = 3_600_000;
const TRUSTED_CLOCKS = new WeakSet<object>();
const TRUSTED_ID_FACTORIES = new WeakSet<object>();

export function createDeterministicPostCallWorkflowRepository(
  optionsInput: PostCallWorkflowRepositoryOptions,
): PostCallWorkflowRepository {
  const options = normalizeRepositoryOptions(optionsInput);
  const runs = new Map<string, StoredRun>();
  const runIdsByTenant = new Map<TenantId, Set<string>>();
  const runKeyByEvent = new Map<string, string>();
  const runKeyBySession = new Map<string, string>();
  const usedClaimTokens = new Set<string>();
  const faultPoints = [...options.faultPoints];

  const repository: PostCallWorkflowRepository = {
    async enqueueSessionCompletion(request, completionEventInput): Promise<WorkflowEnqueueReceipt> {
      const authority = requireWorkflowAuthority(request, "workflow:dispatch", true);
      const event = parseCompletionEvent(request, authority.tenantId, completionEventInput);
      const sourceFingerprint = sha256Canonical(event);
      const eventKey = tenantIdentityKey(authority.tenantId, event.event_id);
      const existingRunKey = runKeyByEvent.get(eventKey);
      if (existingRunKey !== undefined) {
        const existing = runs.get(existingRunKey);
        if (existing === undefined || existing.command.source_event_fingerprint !== sourceFingerprint) {
          throw new WorkflowConflictError();
        }
        return immutableCopy(existing.enqueueReceipt);
      }
      const sessionKey = tenantIdentityKey(authority.tenantId, event.session_id);
      if (runKeyBySession.has(sessionKey)) throw new WorkflowConflictError();
      if ((runIdsByTenant.get(authority.tenantId)?.size ?? 0) >= options.maxRunsPerTenant) {
        throw new WorkflowCapacityError();
      }

      let evidence: SessionCompletionEvidence;
      try {
        evidence = normalizeEvidence(options.evidenceSource.readSessionCompletionEvidence(
          request,
          event.session_id,
        ));
      } catch (error) {
        if (
          error instanceof WorkflowAuthorizationError
          || error instanceof WorkflowValidationError
          || error instanceof WorkflowConflictError
          || error instanceof WorkflowCapacityError
        ) throw error;
        throw new WorkflowRetryableError();
      }
      assertEvidenceMatchesEvent(evidence, event, sourceFingerprint);
      crashAt(faultPoints, "before_enqueue_commit");

      const createdAt = normalizeTimestamp(options.clock.now());
      const commandId = options.idFactory.nextId("command");
      const workflowRunId = options.idFactory.nextId("run");
      const idempotencyKey = `post-call-processing/v1/${authority.tenantId}/${event.event_id}`;
      const command = immutableCopy<PostCallWorkflowCommand>({
        schema_version: "2.0.0",
        command_id: commandId,
        tenant_id: authority.tenantId,
        session_id: event.session_id,
        workflow_type: POST_CALL_WORKFLOW_TYPE,
        workflow_version: POST_CALL_WORKFLOW_VERSION,
        aggregate_type: "interaction_session",
        source_event_id: event.event_id,
        source_event_fingerprint: sourceFingerprint,
        source_aggregate_version: event.aggregate_version,
        source_state_hash: evidence.source_state_hash,
        trace_id: event.trace_id,
        correlation_id: event.correlation_id,
        causation_id: event.causation_id,
        idempotency_key: idempotencyKey,
        requested_by: authority.actorId,
        scheduled_at: createdAt,
        created_at: createdAt,
        data_classification: "internal",
      });
      const commandFingerprint = sha256Canonical(command);
      const receipt = immutableCopy<WorkflowEnqueueReceipt>({
        schema_version: "2.0.0",
        tenant_id: authority.tenantId,
        session_id: event.session_id,
        source_event_id: event.event_id,
        source_event_fingerprint: sourceFingerprint,
        command_id: commandId,
        workflow_run_id: workflowRunId,
        command_fingerprint: commandFingerprint,
        trace_id: event.trace_id,
        correlation_id: event.correlation_id,
        enqueued_at: createdAt,
        data_classification: "internal",
      });
      const status = immutableCopy<PostCallWorkflowStatus>({
        schema_version: "2.0.0",
        workflow_run_id: workflowRunId,
        command_id: commandId,
        tenant_id: authority.tenantId,
        session_id: event.session_id,
        source_event_id: event.event_id,
        source_event_fingerprint: sourceFingerprint,
        source_aggregate_version: event.aggregate_version,
        source_state_hash: evidence.source_state_hash,
        trace_id: event.trace_id,
        correlation_id: event.correlation_id,
        causation_id: event.causation_id,
        status: "queued",
        current_step: "generate_summary",
        state_version: 1,
        attempts: 0,
        max_attempts: options.defaultMaxAttempts,
        next_attempt_at: null,
        last_error_code: null,
        result_hash: null,
        started_at: null,
        updated_at: createdAt,
        completed_at: null,
        cancelled_at: null,
        data_classification: "internal",
      });
      const run: StoredRun = {
        command,
        commandFingerprint,
        enqueueReceipt: receipt,
        evidence: immutableCopy(evidence),
        status,
        claim: null,
        budgetPinned: false,
        attemptsByStep: {
          generate_summary: 0,
          evaluate: 0,
          record_follow_up_guard: 0,
          finalize: 0,
        },
        summary: null,
        evaluation: null,
        followUpGuard: null,
        result: null,
        receipts: [],
      };
      const runKey = tenantIdentityKey(authority.tenantId, workflowRunId);
      runs.set(runKey, run);
      runKeyByEvent.set(eventKey, runKey);
      runKeyBySession.set(sessionKey, runKey);
      const tenantRuns = runIdsByTenant.get(authority.tenantId) ?? new Set<string>();
      tenantRuns.add(runKey);
      runIdsByTenant.set(authority.tenantId, tenantRuns);
      return immutableCopy(receipt);
    },

    claimStep(request, input): WorkflowClaimResult {
      const authority = requireWorkflowAuthority(request, "workflow:execute", true);
      const record = strictPlainRecord(input, [
        "workflow_run_id",
        "claim_token_factory",
        "lease_duration_ms",
        "max_attempts",
      ]);
      const run = requireRun(runs, authority.tenantId, record.workflow_run_id);
      const now = normalizeTimestamp(options.clock.now());
      const nowMs = Date.parse(now);
      const leaseDurationMs = parseBoundedInteger(record.lease_duration_ms, 100, MAX_LEASE_DURATION_MS);
      const requestedMaxAttempts = parseBoundedInteger(record.max_attempts, 1, MAX_ATTEMPTS);
      if (isTerminal(run.status.status)) {
        return immutableCopy({ outcome: "terminal", execution: null, status: run.status });
      }
      if (run.status.status === "waiting" && run.status.next_attempt_at !== null) {
        if (nowMs < Date.parse(run.status.next_attempt_at)) {
          return immutableCopy({ outcome: "idle", execution: null, status: run.status });
        }
      }
      let replacingExpiredClaim = false;
      if (run.claim !== null) {
        if (nowMs < Date.parse(run.claim.expiresAt)) {
          return immutableCopy({ outcome: "busy", execution: null, status: run.status });
        }
        replacingExpiredClaim = true;
      }
      if (!run.budgetPinned) {
        run.budgetPinned = true;
        run.status = immutableCopy({ ...run.status, max_attempts: requestedMaxAttempts });
      }
      const step = run.status.current_step;
      const previousAttempts = run.attemptsByStep[step];
      if (previousAttempts >= run.status.max_attempts) {
        const expiredClaim = run.claim;
        run.claim = null;
        if (expiredClaim !== null) {
          run.receipts.push(createStepReceipt(run, expiredClaim, {
            completedAt: now,
            outcome: "failed",
            artifactHash: null,
            failureCode: "max_attempts_exhausted",
          }));
        }
        run.status = immutableCopy({
          ...run.status,
          status: "failed",
          state_version: run.status.state_version + 1,
          next_attempt_at: null,
          last_error_code: "max_attempts_exhausted",
          updated_at: now,
        });
        return immutableCopy({ outcome: "terminal", execution: null, status: run.status });
      }
      const claimToken = issueClaimToken(record.claim_token_factory);
      if (usedClaimTokens.has(tenantIdentityKey(authority.tenantId, claimToken))) {
        throw new WorkflowConflictError();
      }
      const attempt = previousAttempts + 1;
      run.attemptsByStep[step] = attempt;
      const expiresAt = new Date(nowMs + leaseDurationMs).toISOString();
      run.claim = Object.freeze({ token: claimToken, step, attempt, startedAt: now, expiresAt });
      usedClaimTokens.add(tenantIdentityKey(authority.tenantId, claimToken));
      run.status = immutableCopy({
        ...run.status,
        status: "running",
        state_version: run.status.state_version + 1,
        attempts: attempt,
        next_attempt_at: null,
        last_error_code: replacingExpiredClaim ? "lease_expired" : null,
        started_at: run.status.started_at ?? now,
        updated_at: now,
      });
      const execution = immutableCopy<WorkflowStepExecution>({
        tenant_id: authority.tenantId,
        session_id: run.command.session_id,
        workflow_run_id: run.status.workflow_run_id,
        command_id: run.command.command_id,
        source_event_id: run.command.source_event_id,
        trace_id: run.command.trace_id,
        correlation_id: run.command.correlation_id,
        causation_id: run.command.causation_id,
        step,
        attempt,
        claim_token: claimToken,
        lease_expires_at: expiresAt,
        evidence: run.evidence,
        summary: run.summary,
        evaluation: run.evaluation,
        follow_up_guard: run.followUpGuard,
      });
      return immutableCopy({ outcome: "claimed", execution, status: run.status });
    },

    checkpointStep(request, input): WorkflowMutationResult {
      const authority = requireWorkflowAuthority(request, "workflow:execute", true);
      const parsed = parseStepMutationInput(input);
      const run = requireRun(runs, authority.tenantId, parsed.workflowRunId);
      const completedAt = normalizeTimestamp(options.clock.now());
      const claim = requireActiveClaim(run, parsed.claimToken, parsed.step, parsed.attempt, completedAt);
      const artifact = validateCheckpointArtifact(run, parsed.step, parsed.artifact);
      const artifactHash = artifact === null ? null : sha256Canonical(artifact);
      const isFinal = parsed.step === "finalize";
      const receipt = createStepReceipt(run, claim, {
        completedAt,
        outcome: isFinal ? "completed" : "checkpointed",
        artifactHash,
        failureCode: null,
      });
      applyArtifact(run, parsed.step, artifact);
      run.claim = null;
      if (isFinal) {
        const result = buildCompletedResult(run, completedAt);
        run.result = result;
        run.status = immutableCopy({
          ...run.status,
          status: "completed",
          state_version: run.status.state_version + 1,
          attempts: run.attemptsByStep.finalize,
          next_attempt_at: null,
          last_error_code: null,
          result_hash: result.result_hash,
          updated_at: completedAt,
          completed_at: completedAt,
        });
      } else {
        const nextStep = POST_CALL_WORKFLOW_STEPS[POST_CALL_WORKFLOW_STEPS.indexOf(parsed.step) + 1];
        if (nextStep === undefined) throw new WorkflowConflictError();
        run.status = immutableCopy({
          ...run.status,
          status: "queued",
          current_step: nextStep,
          state_version: run.status.state_version + 1,
          attempts: run.attemptsByStep[nextStep],
          next_attempt_at: null,
          last_error_code: null,
          updated_at: completedAt,
        });
      }
      run.receipts.push(receipt);
      return immutableCopy({ status: run.status, receipt, result: run.result });
    },

    failStep(request, input): WorkflowMutationResult {
      const authority = requireWorkflowAuthority(request, "workflow:execute", true);
      const record = strictPlainRecord(input, [
        "workflow_run_id",
        "claim_token",
        "step",
        "attempt",
        "failure_code",
        "retryable",
        "retry_delay_ms",
      ]);
      const workflowRunId = parseWorkflowUuid(record.workflow_run_id);
      const claimToken = parseWorkflowUuid(record.claim_token);
      const step = parseStep(record.step);
      const attempt = parseBoundedInteger(record.attempt, 1, MAX_ATTEMPTS);
      const completedAt = normalizeTimestamp(options.clock.now());
      const failure = parseStepFailure(record.failure_code, record.retryable);
      const retryDelayMs = parseBoundedInteger(record.retry_delay_ms, 1, MAX_RETRY_DELAY_MS);
      const run = requireRun(runs, authority.tenantId, workflowRunId);
      const claim = requireActiveClaim(run, claimToken, step, attempt, completedAt);
      const exhausted = failure.retryable && attempt >= run.status.max_attempts;
      const terminal = !failure.retryable || exhausted;
      const failureCode = exhausted ? "max_attempts_exhausted" : failure.code;
      const receipt = createStepReceipt(run, claim, {
        completedAt,
        outcome: terminal ? "failed" : "retry_scheduled",
        artifactHash: null,
        failureCode,
      });
      run.claim = null;
      run.receipts.push(receipt);
      run.status = immutableCopy({
        ...run.status,
        status: terminal ? "failed" : "waiting",
        state_version: run.status.state_version + 1,
        attempts: attempt,
        next_attempt_at: terminal ? null : new Date(Date.parse(completedAt) + retryDelayMs).toISOString(),
        last_error_code: failureCode,
        updated_at: completedAt,
      });
      return immutableCopy({ status: run.status, receipt, result: null });
    },

    cancel(request, input): PostCallWorkflowStatus {
      const authority = requireWorkflowAuthority(request, "workflow:execute", false);
      const record = strictPlainRecord(input, ["workflow_run_id"]);
      const run = requireRun(runs, authority.tenantId, record.workflow_run_id);
      const cancelledAt = normalizeTimestamp(options.clock.now());
      if (run.status.status === "cancelled") return immutableCopy(run.status);
      if (run.status.status === "completed" || run.status.status === "failed") throw new WorkflowConflictError();
      const step = run.status.current_step;
      const attempt = run.claim === null ? run.attemptsByStep[step] + 1 : run.claim.attempt;
      const claim: StoredClaim = run.claim ?? Object.freeze({
        token: parseWorkflowUuid(run.status.workflow_run_id),
        step,
        attempt,
        startedAt: cancelledAt,
        expiresAt: new Date(Date.parse(cancelledAt) + 1).toISOString(),
      });
      if (run.claim === null) run.attemptsByStep[step] = attempt;
      const receipt = createStepReceipt(run, claim, {
        completedAt: cancelledAt,
        outcome: "cancelled",
        artifactHash: null,
        failureCode: null,
      });
      run.claim = null;
      run.receipts.push(receipt);
      run.status = immutableCopy({
        ...run.status,
        status: "cancelled",
        state_version: run.status.state_version + 1,
        attempts: attempt,
        next_attempt_at: null,
        last_error_code: null,
        updated_at: cancelledAt,
        cancelled_at: cancelledAt,
      });
      return immutableCopy(run.status);
    },

    readStatus(request, workflowRunId): PostCallWorkflowStatus {
      const authority = requireWorkflowAuthority(request, "workflow:observe", false);
      return immutableCopy(requireRun(runs, authority.tenantId, workflowRunId).status);
    },

    readResult(request, workflowRunId): PostCallWorkflowResult | null {
      const authority = requireWorkflowAuthority(request, "workflow:observe", true);
      const result = requireRun(runs, authority.tenantId, workflowRunId).result;
      return result === null ? null : immutableCopy(result);
    },

    readCommand(request, workflowRunId): PostCallWorkflowCommand {
      const authority = requireWorkflowAuthority(request, "workflow:observe", false);
      return immutableCopy(requireRun(runs, authority.tenantId, workflowRunId).command);
    },

    readEnqueueReceipt(request, sourceEventId): WorkflowEnqueueReceipt | null {
      const authority = requireWorkflowAuthority(request, "workflow:observe", false);
      const eventId = parseWorkflowUuid(sourceEventId);
      const runKey = runKeyByEvent.get(tenantIdentityKey(authority.tenantId, eventId));
      if (runKey === undefined) return null;
      const run = runs.get(runKey);
      return run === undefined ? null : immutableCopy(run.enqueueReceipt);
    },

    listStepReceipts(request, workflowRunId): readonly WorkflowStepReceipt[] {
      const authority = requireWorkflowAuthority(request, "workflow:observe", false);
      return Object.freeze(requireRun(runs, authority.tenantId, workflowRunId).receipts.map(immutableCopy));
    },
  };
  return Object.freeze(repository);
}

export interface DeterministicPostCallActivitiesOptions {
  readonly id_factory: WorkflowIdFactory;
  readonly retry_once_steps?: readonly PostCallWorkflowStep[];
}

export interface DeterministicPostCallActivities {
  runStep(execution: WorkflowStepExecution): unknown;
  effectCount(tenantId: unknown, workflowRunId: unknown, step: unknown): number;
}

export function createDeterministicPostCallActivities(
  optionsInput: DeterministicPostCallActivitiesOptions,
): DeterministicPostCallActivities {
  const record = strictConfigurationRecord(optionsInput, ["id_factory", "retry_once_steps"]);
  const idFactory = record.id_factory as WorkflowIdFactory;
  if (idFactory === null || typeof idFactory !== "object" || !TRUSTED_ID_FACTORIES.has(idFactory)) {
    throw new WorkflowConfigurationError();
  }
  const retryOnceSteps = parseRetryOnceSteps(record.retry_once_steps);
  const retriesTriggered = new Set<string>();
  const ledger = new Map<string, unknown>();
  const counts = new Map<string, number>();
  const activities: DeterministicPostCallActivities = {
    runStep(executionInput: WorkflowStepExecution): unknown {
      const execution = normalizeExecution(executionInput);
      const key = activityKey(execution.tenant_id, execution.workflow_run_id, execution.step);
      if (ledger.has(key)) return immutableCopy(ledger.get(key));
      if (retryOnceSteps.includes(execution.step) && !retriesTriggered.has(key)) {
        retriesTriggered.add(key);
        throw new WorkflowActivityRetryableError();
      }
      let artifact: unknown;
      switch (execution.step) {
        case "generate_summary":
          artifact = expectedSummary(execution.evidence);
          break;
        case "evaluate":
          if (execution.summary === null) throw new WorkflowConflictError();
          artifact = expectedEvaluation(execution.evidence);
          break;
        case "record_follow_up_guard": {
          if (execution.summary === null || execution.evaluation === null) throw new WorkflowConflictError();
          const commandId = idFactory.nextId("follow_up");
          artifact = immutableCopy<PostCallWorkflowResult["follow_up_guard"]>({
            command_id: commandId,
            mode: "deterministic_noop",
            status: "not_sent",
            external_effect: false,
            effect_hash: sha256Canonical({
              domain: "axtro-post-call-noop-v1",
              tenant_id: execution.tenant_id,
              session_id: execution.session_id,
              workflow_run_id: execution.workflow_run_id,
              source_event_id: execution.source_event_id,
              command_id: commandId,
            }),
          });
          break;
        }
        case "finalize":
          if (
            execution.summary === null
            || execution.evaluation === null
            || execution.follow_up_guard === null
          ) throw new WorkflowConflictError();
          artifact = null;
          break;
      }
      ledger.set(key, immutableCopy(artifact));
      counts.set(key, (counts.get(key) ?? 0) + 1);
      return immutableCopy(artifact);
    },
    effectCount(tenantIdInput: unknown, workflowRunIdInput: unknown, stepInput: unknown): number {
      const tenantId = parseTenantIdForWorkflow(tenantIdInput);
      const workflowRunId = parseWorkflowUuid(workflowRunIdInput);
      const step = parseStep(stepInput);
      return counts.get(activityKey(tenantId, workflowRunId, step)) ?? 0;
    },
  };
  return Object.freeze(activities);
}

export function createManualWorkflowClock(initialTime: unknown): ManualWorkflowClock {
  let currentMs = Date.parse(normalizeTimestamp(initialTime));
  const clock: ManualWorkflowClock = Object.freeze({
    now: () => new Date(currentMs).toISOString(),
    advanceBy(millisecondsInput: unknown): string {
      currentMs += parseBoundedInteger(millisecondsInput, 0, MAX_RETRY_DELAY_MS);
      return new Date(currentMs).toISOString();
    },
  });
  TRUSTED_CLOCKS.add(clock);
  return clock;
}

export function createDeterministicWorkflowIdFactory(
  fixturesInput: DeterministicWorkflowIdFixtures,
): WorkflowIdFactory {
  const record = strictConfigurationRecord(fixturesInput, [
    "command_ids",
    "run_ids",
    "follow_up_command_ids",
  ]);
  const fixtures = {
    command: parseIdFixtures(record.command_ids),
    run: parseIdFixtures(record.run_ids),
    follow_up: parseIdFixtures(record.follow_up_command_ids),
  };
  const all = [...fixtures.command, ...fixtures.run, ...fixtures.follow_up];
  if (new Set(all).size !== all.length) throw new WorkflowConfigurationError();
  const positions = { command: 0, run: 0, follow_up: 0 };
  const factory: WorkflowIdFactory = Object.freeze({
    nextId(kind: "command" | "run" | "follow_up"): UuidV7 {
      if (!(kind in fixtures)) throw new WorkflowConfigurationError();
      const values = fixtures[kind];
      const value = values[positions[kind]];
      if (value === undefined) throw new WorkflowConfigurationError();
      positions[kind] += 1;
      return value;
    },
  });
  TRUSTED_ID_FACTORIES.add(factory);
  return factory;
}

function normalizeRepositoryOptions(value: PostCallWorkflowRepositoryOptions): NormalizedRepositoryOptions {
  const record = strictConfigurationRecord(value, [
    "evidence_source",
    "clock",
    "id_factory",
    "max_runs_per_tenant",
    "default_max_attempts",
    "fault_points",
  ]);
  const evidenceSource = record.evidence_source as SessionCompletionEvidenceSource;
  const clock = record.clock as WorkflowClock;
  const idFactory = record.id_factory as WorkflowIdFactory;
  if (
    evidenceSource === null
    || typeof evidenceSource !== "object"
    || typeof evidenceSource.readSessionCompletionEvidence !== "function"
    || clock === null
    || typeof clock !== "object"
    || !TRUSTED_CLOCKS.has(clock)
    || idFactory === null
    || typeof idFactory !== "object"
    || !TRUSTED_ID_FACTORIES.has(idFactory)
  ) throw new WorkflowConfigurationError();
  return Object.freeze({
    evidenceSource,
    clock,
    idFactory,
    maxRunsPerTenant: optionalBoundedInteger(
      record.max_runs_per_tenant,
      DEFAULT_MAX_RUNS_PER_TENANT,
      1,
      MAX_RUNS_PER_TENANT,
    ),
    defaultMaxAttempts: optionalBoundedInteger(
      record.default_max_attempts,
      DEFAULT_MAX_ATTEMPTS,
      1,
      MAX_ATTEMPTS,
    ),
    faultPoints: parseRepositoryFaultPoints(record.fault_points),
  });
}

function requireWorkflowAuthority(
  request: AuthorizedRequestContext,
  scope: "workflow:dispatch" | "workflow:execute" | "workflow:observe",
  requireSessionRead: boolean,
): Readonly<{ tenantId: TenantId; actorId: string }> {
  try {
    const context = getAuthorizedTenantContext(request);
    if (
      request.principal.actorType !== "workflow"
      || request.principal.identityKind !== "service"
      || !context.grantedScopes.includes(scope)
      || (requireSessionRead && !context.grantedScopes.includes("session:read"))
      || !context.purposes.includes("essential_processing")
    ) throw new WorkflowAuthorizationError();
    return Object.freeze({ tenantId: context.tenantId, actorId: context.actorId });
  } catch (error) {
    if (error instanceof WorkflowAuthorizationError) throw error;
    throw new WorkflowAuthorizationError();
  }
}

function parseCompletionEvent(
  request: AuthorizedRequestContext,
  tenantId: TenantId,
  value: unknown,
): EventEnvelope & { session_id: string } {
  const record = strictPlainRecord(value, [
    "schema_version",
    "event_id",
    "event_type",
    "event_version",
    "aggregate_type",
    "aggregate_id",
    "aggregate_version",
    "tenant_id",
    "session_id",
    "producer",
    "trace_id",
    "correlation_id",
    "causation_id",
    "data_classification",
    "payload_json",
    "occurred_at",
  ]);
  try {
    const eventId = parseUuidV7(record.event_id, "event_id");
    const eventTenantId = parseTenantId(record.tenant_id);
    const sessionId = parseSessionId(record.session_id);
    const aggregateId = parseSessionId(record.aggregate_id);
    const correlationId = parseCorrelationId(record.correlation_id);
    const causationId = record.causation_id === null ? null : parseCorrelationId(record.causation_id);
    assertAuthorizedTenantMatch(request, eventTenantId);
    if (
      eventTenantId !== tenantId
      || aggregateId !== sessionId
      || record.schema_version !== "2.0.0"
      || record.event_type !== "session.completed"
      || record.event_version !== 1
      || record.aggregate_type !== "interaction_session"
      || record.payload_json !== "{}"
      || record.data_classification !== "internal"
      || typeof record.producer !== "string"
      || record.producer.length < 1
      || record.producer.length > 200
      || typeof record.trace_id !== "string"
      || !TRACE_PATTERN.test(record.trace_id)
    ) throw new WorkflowValidationError();
    const aggregateVersion = parseBoundedInteger(record.aggregate_version, 1, 10_000_000);
    const occurredAt = normalizeTimestamp(record.occurred_at);
    return immutableCopy({
      schema_version: "2.0.0",
      event_id: eventId,
      event_type: "session.completed",
      event_version: 1,
      aggregate_type: "interaction_session",
      aggregate_id: aggregateId,
      aggregate_version: aggregateVersion,
      tenant_id: eventTenantId,
      session_id: sessionId,
      producer: record.producer,
      trace_id: record.trace_id,
      correlation_id: correlationId,
      causation_id: causationId,
      data_classification: "internal",
      payload_json: "{}",
      occurred_at: occurredAt,
    });
  } catch (error) {
    if (error instanceof WorkflowAuthorizationError) throw error;
    if (error instanceof WorkflowValidationError) throw error;
    throw new WorkflowValidationError();
  }
}

function normalizeEvidence(value: unknown): SessionCompletionEvidence {
  const record = strictPlainRecord(value, [
    "tenant_id",
    "session_id",
    "source_event_id",
    "source_event_fingerprint",
    "source_aggregate_version",
    "source_state_hash",
    "final_status",
    "canonical_event_count",
    "final_state_version",
    "evidence_event_ids",
  ]);
  try {
    const tenantId = parseTenantId(record.tenant_id);
    const sessionId = parseSessionId(record.session_id);
    const sourceEventId = parseUuidV7(record.source_event_id, "source_event_id");
    const sourceAggregateVersion = parseBoundedInteger(record.source_aggregate_version, 1, 10_000_000);
    const canonicalEventCount = parseBoundedInteger(record.canonical_event_count, 1, 10_000);
    const finalStateVersion = parseBoundedInteger(record.final_state_version, 1, 10_000_000);
    if (
      typeof record.source_event_fingerprint !== "string"
      || !SHA256_PATTERN.test(record.source_event_fingerprint)
      || typeof record.source_state_hash !== "string"
      || !SHA256_PATTERN.test(record.source_state_hash)
      || record.final_status !== "completed"
      || !Array.isArray(record.evidence_event_ids)
      || record.evidence_event_ids.length < 1
      || record.evidence_event_ids.length > 16
    ) throw new WorkflowValidationError();
    const evidenceEventIds = record.evidence_event_ids.map((eventId) => parseUuidV7(eventId, "evidence_event_id"));
    if (new Set(evidenceEventIds).size !== evidenceEventIds.length) throw new WorkflowValidationError();
    return immutableCopy({
      tenant_id: tenantId,
      session_id: sessionId,
      source_event_id: sourceEventId,
      source_event_fingerprint: record.source_event_fingerprint,
      source_aggregate_version: sourceAggregateVersion,
      source_state_hash: record.source_state_hash,
      final_status: "completed",
      canonical_event_count: canonicalEventCount,
      final_state_version: finalStateVersion,
      evidence_event_ids: evidenceEventIds,
    });
  } catch (error) {
    if (error instanceof WorkflowValidationError) throw error;
    throw new WorkflowValidationError();
  }
}

function assertEvidenceMatchesEvent(
  evidence: SessionCompletionEvidence,
  event: EventEnvelope & { session_id: string },
  sourceFingerprint: string,
): void {
  if (
    evidence.tenant_id !== event.tenant_id
    || evidence.session_id !== event.session_id
    || evidence.source_event_id !== event.event_id
    || evidence.source_event_fingerprint !== sourceFingerprint
    || evidence.source_aggregate_version !== event.aggregate_version
    || evidence.final_state_version !== event.aggregate_version
    || evidence.canonical_event_count !== event.aggregate_version
    || !evidence.evidence_event_ids.includes(event.event_id)
  ) throw new WorkflowConflictError();
}

function parseStepMutationInput(value: CheckpointWorkflowStepInput): Readonly<{
  workflowRunId: UuidV7;
  claimToken: UuidV7;
  step: PostCallWorkflowStep;
  attempt: number;
  artifact: unknown;
}> {
  const record = strictPlainRecord(value, [
    "workflow_run_id",
    "claim_token",
    "step",
    "attempt",
    "artifact",
  ]);
  return Object.freeze({
    workflowRunId: parseWorkflowUuid(record.workflow_run_id),
    claimToken: parseWorkflowUuid(record.claim_token),
    step: parseStep(record.step),
    attempt: parseBoundedInteger(record.attempt, 1, MAX_ATTEMPTS),
    artifact: record.artifact,
  });
}

function parseStepFailure(
  codeInput: unknown,
  retryableInput: unknown,
): Readonly<{
  code: "activity_retryable" | "invalid_source" | "policy_denied" | "internal_failure";
  retryable: boolean;
}> {
  if (retryableInput === true && codeInput === "activity_retryable") {
    return Object.freeze({ code: "activity_retryable", retryable: true });
  }
  if (
    retryableInput === false
    && (codeInput === "invalid_source" || codeInput === "policy_denied" || codeInput === "internal_failure")
  ) return Object.freeze({ code: codeInput, retryable: false });
  throw new WorkflowValidationError();
}

function issueClaimToken(value: unknown): UuidV7 {
  if (
    value === null
    || typeof value !== "object"
    || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
  ) throw new WorkflowValidationError();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const descriptor = descriptors.nextClaimToken;
  if (
    Object.keys(descriptors).length !== 1
    || descriptor === undefined
    || !("value" in descriptor)
    || typeof descriptor.value !== "function"
  ) throw new WorkflowValidationError();
  try {
    return parseWorkflowUuid(Reflect.apply(descriptor.value, value, []));
  } catch (error) {
    if (error instanceof WorkflowValidationError) throw error;
    throw new WorkflowValidationError();
  }
}

function requireActiveClaim(
  run: StoredRun,
  claimToken: UuidV7,
  step: PostCallWorkflowStep,
  attempt: number,
  completedAt: string,
): StoredClaim {
  const claim = run.claim;
  if (
    run.status.status !== "running"
    || claim === null
    || claim.token !== claimToken
    || claim.step !== step
    || claim.attempt !== attempt
    || Date.parse(completedAt) >= Date.parse(claim.expiresAt)
    || Date.parse(completedAt) < Date.parse(claim.startedAt)
  ) throw new WorkflowConflictError();
  return claim;
}

function validateCheckpointArtifact(run: StoredRun, step: PostCallWorkflowStep, value: unknown): unknown {
  switch (step) {
    case "generate_summary": {
      const expected = expectedSummary(run.evidence);
      if (sha256Canonical(value) !== sha256Canonical(expected)) throw new WorkflowValidationError();
      return expected;
    }
    case "evaluate": {
      if (run.summary === null) throw new WorkflowConflictError();
      const expected = expectedEvaluation(run.evidence);
      if (sha256Canonical(value) !== sha256Canonical(expected)) throw new WorkflowValidationError();
      return expected;
    }
    case "record_follow_up_guard": {
      if (run.summary === null || run.evaluation === null) throw new WorkflowConflictError();
      const record = strictPlainRecord(value, ["command_id", "mode", "status", "external_effect", "effect_hash"]);
      const commandId = parseWorkflowUuid(record.command_id);
      if (
        record.mode !== "deterministic_noop"
        || record.status !== "not_sent"
        || record.external_effect !== false
        || typeof record.effect_hash !== "string"
        || !SHA256_PATTERN.test(record.effect_hash)
        || record.effect_hash !== sha256Canonical({
          domain: "axtro-post-call-noop-v1",
          tenant_id: run.command.tenant_id,
          session_id: run.command.session_id,
          workflow_run_id: run.status.workflow_run_id,
          source_event_id: run.command.source_event_id,
          command_id: commandId,
        })
      ) throw new WorkflowValidationError();
      return immutableCopy<PostCallWorkflowResult["follow_up_guard"]>({
        command_id: commandId,
        mode: "deterministic_noop",
        status: "not_sent",
        external_effect: false,
        effect_hash: record.effect_hash,
      });
    }
    case "finalize":
      if (run.summary === null || run.evaluation === null || run.followUpGuard === null || value !== null) {
        throw new WorkflowValidationError();
      }
      return null;
  }
}

function applyArtifact(run: StoredRun, step: PostCallWorkflowStep, artifact: unknown): void {
  switch (step) {
    case "generate_summary":
      run.summary = immutableCopy(artifact as PostCallWorkflowResult["summary"]);
      break;
    case "evaluate":
      run.evaluation = immutableCopy(artifact as PostCallWorkflowResult["evaluation"]);
      break;
    case "record_follow_up_guard":
      run.followUpGuard = immutableCopy(artifact as PostCallWorkflowResult["follow_up_guard"]);
      break;
    case "finalize":
      break;
  }
}

function expectedSummary(evidence: SessionCompletionEvidence): PostCallWorkflowResult["summary"] {
  return immutableCopy({
    template_code: "deterministic_session_summary_v1",
    text: `Session completed with ${evidence.canonical_event_count} canonical events at aggregate version ${evidence.final_state_version}.`,
    canonical_event_count: evidence.canonical_event_count,
    final_state_version: evidence.final_state_version,
  });
}

function expectedEvaluation(evidence: SessionCompletionEvidence): PostCallWorkflowResult["evaluation"] {
  return immutableCopy({
    evaluator_version: "fake-structural-v1",
    outcome: "passed",
    score_basis_points: 10_000,
    evidence_event_ids: [...evidence.evidence_event_ids],
  });
}

function buildCompletedResult(run: StoredRun, completedAt: string): PostCallWorkflowResult {
  if (run.summary === null || run.evaluation === null || run.followUpGuard === null) {
    throw new WorkflowConflictError();
  }
  const base = {
    schema_version: "2.0.0" as const,
    tenant_id: run.command.tenant_id,
    session_id: run.command.session_id,
    workflow_run_id: run.status.workflow_run_id,
    command_id: run.command.command_id,
    source_event_id: run.command.source_event_id,
    source_event_fingerprint: run.command.source_event_fingerprint,
    source_aggregate_version: run.command.source_aggregate_version,
    source_state_hash: run.command.source_state_hash,
    trace_id: run.command.trace_id,
    correlation_id: run.command.correlation_id,
    causation_id: run.command.causation_id,
    summary: run.summary,
    evaluation: run.evaluation,
    follow_up_guard: run.followUpGuard,
    completed_at: completedAt,
    data_classification: "restricted" as const,
  };
  return immutableCopy({ ...base, result_hash: sha256Canonical(base) });
}

function createStepReceipt(
  run: StoredRun,
  claim: StoredClaim,
  input: Readonly<{
    completedAt: string;
    outcome: WorkflowStepReceipt["outcome"];
    artifactHash: string | null;
    failureCode: WorkflowStepReceipt["failure_code"];
  }>,
): WorkflowStepReceipt {
  return immutableCopy({
    schema_version: "2.0.0",
    tenant_id: run.command.tenant_id,
    session_id: run.command.session_id,
    workflow_run_id: run.status.workflow_run_id,
    command_id: run.command.command_id,
    source_event_id: run.command.source_event_id,
    step: claim.step,
    attempt: claim.attempt,
    outcome: input.outcome,
    artifact_hash: input.artifactHash,
    failure_code: input.failureCode,
    trace_id: run.command.trace_id,
    correlation_id: run.command.correlation_id,
    started_at: claim.startedAt,
    completed_at: input.completedAt,
    data_classification: "internal",
  });
}

function normalizeExecution(value: WorkflowStepExecution): WorkflowStepExecution {
  const record = strictPlainRecord(value, [
    "tenant_id",
    "session_id",
    "workflow_run_id",
    "command_id",
    "source_event_id",
    "trace_id",
    "correlation_id",
    "causation_id",
    "step",
    "attempt",
    "claim_token",
    "lease_expires_at",
    "evidence",
    "summary",
    "evaluation",
    "follow_up_guard",
  ]);
  const tenantId = parseTenantIdForWorkflow(record.tenant_id);
  const sessionId = parseSessionIdForWorkflow(record.session_id);
  const workflowRunId = parseWorkflowUuid(record.workflow_run_id);
  const commandId = parseWorkflowUuid(record.command_id);
  const sourceEventId = parseWorkflowUuid(record.source_event_id);
  const correlationId = parseWorkflowUuid(record.correlation_id);
  const causationId = record.causation_id === null ? null : parseWorkflowUuid(record.causation_id);
  const claimToken = parseWorkflowUuid(record.claim_token);
  const evidence = normalizeEvidence(record.evidence);
  if (
    typeof record.trace_id !== "string"
    || !TRACE_PATTERN.test(record.trace_id)
    || evidence.tenant_id !== tenantId
    || evidence.session_id !== sessionId
    || evidence.source_event_id !== sourceEventId
  ) throw new WorkflowValidationError();
  return immutableCopy({
    tenant_id: tenantId,
    session_id: sessionId,
    workflow_run_id: workflowRunId,
    command_id: commandId,
    source_event_id: sourceEventId,
    trace_id: record.trace_id,
    correlation_id: correlationId,
    causation_id: causationId,
    step: parseStep(record.step),
    attempt: parseBoundedInteger(record.attempt, 1, MAX_ATTEMPTS),
    claim_token: claimToken,
    lease_expires_at: normalizeTimestamp(record.lease_expires_at),
    evidence,
    summary: record.summary as PostCallWorkflowResult["summary"] | null,
    evaluation: record.evaluation as PostCallWorkflowResult["evaluation"] | null,
    follow_up_guard: record.follow_up_guard as PostCallWorkflowResult["follow_up_guard"] | null,
  });
}

function requireRun(
  runs: Map<string, StoredRun>,
  tenantId: TenantId,
  workflowRunIdInput: unknown,
): StoredRun {
  const workflowRunId = parseWorkflowUuid(workflowRunIdInput);
  const run = runs.get(tenantIdentityKey(tenantId, workflowRunId));
  if (run === undefined) throw new WorkflowNotFoundError();
  return run;
}

function isTerminal(status: PostCallWorkflowStatus["status"]): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

function parseStep(value: unknown): PostCallWorkflowStep {
  if (typeof value !== "string" || !POST_CALL_WORKFLOW_STEPS.includes(value as PostCallWorkflowStep)) {
    throw new WorkflowValidationError();
  }
  return value as PostCallWorkflowStep;
}

function parseRetryOnceSteps(value: unknown): readonly PostCallWorkflowStep[] {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value) || value.length > POST_CALL_WORKFLOW_STEPS.length) {
    throw new WorkflowConfigurationError();
  }
  const steps = value.map((step) => parseStep(step));
  if (new Set(steps).size !== steps.length) throw new WorkflowConfigurationError();
  return Object.freeze(steps);
}

function parseRepositoryFaultPoints(value: unknown): WorkflowRepositoryFaultPoint[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > WORKFLOW_REPOSITORY_FAULT_POINTS.length) {
    throw new WorkflowConfigurationError();
  }
  const values: WorkflowRepositoryFaultPoint[] = [];
  for (const point of value) {
    if (
      typeof point !== "string"
      || !WORKFLOW_REPOSITORY_FAULT_POINTS.includes(point as WorkflowRepositoryFaultPoint)
      || values.includes(point as WorkflowRepositoryFaultPoint)
    ) throw new WorkflowConfigurationError();
    values.push(point as WorkflowRepositoryFaultPoint);
  }
  return values;
}

function crashAt(faultPoints: WorkflowRepositoryFaultPoint[], point: WorkflowRepositoryFaultPoint): void {
  const index = faultPoints.indexOf(point);
  if (index < 0) return;
  faultPoints.splice(index, 1);
  throw new WorkflowRetryableError();
}

function parseIdFixtures(value: unknown): UuidV7[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_FIXTURE_IDS) {
    throw new WorkflowConfigurationError();
  }
  try {
    return value.map((entry) => parseUuidV7(entry));
  } catch {
    throw new WorkflowConfigurationError();
  }
}

function parseWorkflowUuid(value: unknown): UuidV7 {
  try {
    return parseUuidV7(value);
  } catch {
    throw new WorkflowValidationError();
  }
}

function parseTenantIdForWorkflow(value: unknown): TenantId {
  try {
    return parseTenantId(value);
  } catch {
    throw new WorkflowValidationError();
  }
}

function parseSessionIdForWorkflow(value: unknown): string {
  try {
    return parseSessionId(value);
  } catch {
    throw new WorkflowValidationError();
  }
}

function parseBoundedInteger(value: unknown, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new WorkflowValidationError();
  }
  return value;
}

function optionalBoundedInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined) return fallback;
  try {
    return parseBoundedInteger(value, minimum, maximum);
  } catch {
    throw new WorkflowConfigurationError();
  }
}

function normalizeTimestamp(value: unknown): string {
  if (typeof value !== "string" || value.length < 20 || value.length > 40) throw new WorkflowValidationError();
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) throw new WorkflowValidationError();
  return new Date(milliseconds).toISOString();
}

function strictPlainRecord(value: unknown, allowedKeys: readonly string[]): Record<string, unknown> {
  if (
    value === null
    || typeof value !== "object"
    || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
  ) throw new WorkflowValidationError();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!allowedKeys.includes(key) || !("value" in descriptor)) throw new WorkflowValidationError();
  }
  if (Object.keys(descriptors).length !== allowedKeys.length) throw new WorkflowValidationError();
  return Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]));
}

function strictConfigurationRecord(value: unknown, allowedKeys: readonly string[]): Record<string, unknown> {
  try {
    if (
      value === null
      || typeof value !== "object"
      || Array.isArray(value)
      || Object.getPrototypeOf(value) !== Object.prototype
    ) throw new WorkflowConfigurationError();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (!allowedKeys.includes(key) || !("value" in descriptor)) throw new WorkflowConfigurationError();
    }
    return Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]));
  } catch (error) {
    if (error instanceof WorkflowConfigurationError) throw error;
    throw new WorkflowConfigurationError();
  }
}

function tenantIdentityKey(tenantId: string, id: string): string {
  return `${tenantId}\u0000${id}`;
}

function activityKey(tenantId: string, workflowRunId: string, step: PostCallWorkflowStep): string {
  return `${tenantId}\u0000${workflowRunId}\u0000${step}`;
}

function immutableCopy<Value>(value: Value): Value {
  return deepFreeze(structuredClone(value));
}

function deepFreeze<Value>(value: Value): Value {
  if (value === null || typeof value !== "object") return value;
  for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  return Object.freeze(value);
}
