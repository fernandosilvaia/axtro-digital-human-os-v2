import type { AuthorizedRequestContext } from "@axtro/auth";
import type { PostCallWorkflowStatus } from "@axtro/contracts-ts";
import type {
  TelemetryEventCode,
  TelemetryRuntime,
  TelemetrySpan,
} from "@axtro/observability";
import {
  WorkflowActivityRetryableError,
  WorkflowConflictError,
  WorkflowPolicyDeniedError,
  WorkflowValidationError,
  type DeterministicPostCallActivities,
  type PostCallWorkflowRepository,
  type WorkflowMutationResult,
} from "@axtro/workflows";
import { parseUuidV7, type UuidV7 } from "@axtro/domain";

export * from "./data-governance.js";
export * from "./data-governance-postgres-repository.js";

export const WORKFLOW_WORKER_FAULT_POINTS = ["after_activity_before_checkpoint"] as const;
export type WorkflowWorkerFaultPoint = (typeof WORKFLOW_WORKER_FAULT_POINTS)[number];

export interface WorkflowClaimTokenFactory {
  nextClaimToken(): UuidV7;
}

export interface WorkflowWorkerOptions {
  readonly repository: PostCallWorkflowRepository;
  readonly activities: DeterministicPostCallActivities;
  readonly claim_token_factory: WorkflowClaimTokenFactory;
  readonly telemetry: TelemetryRuntime;
  readonly lease_duration_ms?: unknown;
  readonly max_attempts?: unknown;
  readonly retry_delay_ms?: unknown;
  readonly fault_points?: readonly WorkflowWorkerFaultPoint[];
}

export type WorkflowWorkerRunResult =
  | Readonly<{ outcome: "idle" | "busy" | "terminal"; status: PostCallWorkflowStatus; receipt: null }>
  | Readonly<{
    outcome: "checkpointed" | "retry_scheduled" | "completed" | "failed";
    status: PostCallWorkflowStatus;
    receipt: WorkflowMutationResult["receipt"];
  }>;

export interface WorkflowWorker {
  runOnce(request: AuthorizedRequestContext, workflowRunId: unknown): WorkflowWorkerRunResult;
  cancel(request: AuthorizedRequestContext, workflowRunId: unknown): PostCallWorkflowStatus;
}

export class WorkflowWorkerConfigurationError extends Error {
  constructor() {
    super("Workflow worker configuration is invalid");
    this.name = "WorkflowWorkerConfigurationError";
  }
}

export class WorkflowWorkerCrashError extends Error {
  readonly point: WorkflowWorkerFaultPoint;

  constructor(point: WorkflowWorkerFaultPoint) {
    super("Workflow worker stopped at a deterministic crash boundary");
    this.name = "WorkflowWorkerCrashError";
    this.point = point;
  }
}

interface NormalizedWorkerOptions {
  readonly repository: PostCallWorkflowRepository;
  readonly activities: DeterministicPostCallActivities;
  readonly tokenFactory: WorkflowClaimTokenFactory;
  readonly telemetry: TelemetryRuntime;
  readonly leaseDurationMs: number;
  readonly maxAttempts: number;
  readonly retryDelayMs: number;
  readonly faultPoints: WorkflowWorkerFaultPoint[];
}

interface WorkflowTelemetry {
  readonly runtime: TelemetryRuntime;
  readonly span: TelemetrySpan;
}

const DEFAULT_LEASE_DURATION_MS = 1_000;
const DEFAULT_MAX_ATTEMPTS = 4;
const DEFAULT_RETRY_DELAY_MS = 1_000;
const MAX_LEASE_DURATION_MS = 300_000;
const MAX_RETRY_DELAY_MS = 3_600_000;
const MAX_ATTEMPTS = 16;
const MAX_TOKEN_FIXTURES = 1_024;
const TRUSTED_TOKEN_FACTORIES = new WeakSet<object>();

export function createWorkflowWorker(optionsInput: WorkflowWorkerOptions): WorkflowWorker {
  const options = normalizeOptions(optionsInput);
  const faultPoints = [...options.faultPoints];
  const worker: WorkflowWorker = {
    runOnce(request: AuthorizedRequestContext, workflowRunId: unknown): WorkflowWorkerRunResult {
      const claim = options.repository.claimStep(request, {
        workflow_run_id: workflowRunId,
        claim_token_factory: options.tokenFactory,
        lease_duration_ms: options.leaseDurationMs,
        max_attempts: options.maxAttempts,
      });
      if (claim.outcome !== "claimed") {
        return Object.freeze({ outcome: claim.outcome, status: claim.status, receipt: null });
      }
      const execution = claim.execution;
      const telemetry = startTelemetry(options.telemetry, claim.status);
      let artifact: unknown;
      try {
        artifact = options.activities.runStep(execution);
      } catch (error) {
        const failure = classifyActivityFailure(error);
        const mutation = options.repository.failStep(request, {
          workflow_run_id: execution.workflow_run_id,
          claim_token: execution.claim_token,
          step: execution.step,
          attempt: execution.attempt,
          failure_code: failure.code,
          retryable: failure.retryable,
          retry_delay_ms: options.retryDelayMs,
        });
        const outcome = mutation.status.status === "failed" ? "failed" : "retry_scheduled";
        completeTelemetry(telemetry, mutation.status, outcome);
        return Object.freeze({ outcome, status: mutation.status, receipt: mutation.receipt });
      }

      try {
        crashAt(faultPoints, "after_activity_before_checkpoint");
        const mutation = options.repository.checkpointStep(request, {
          workflow_run_id: execution.workflow_run_id,
          claim_token: execution.claim_token,
          step: execution.step,
          attempt: execution.attempt,
          artifact,
        });
        const outcome = mutation.status.status === "completed" ? "completed" : "checkpointed";
        completeTelemetry(telemetry, mutation.status, outcome);
        return Object.freeze({ outcome, status: mutation.status, receipt: mutation.receipt });
      } catch (error) {
        failTelemetry(telemetry, execution.step);
        throw error;
      }
    },

    cancel(request: AuthorizedRequestContext, workflowRunId: unknown): PostCallWorkflowStatus {
      const status = options.repository.cancel(request, {
        workflow_run_id: workflowRunId,
      });
      const telemetry = startTelemetry(options.telemetry, status);
      completeTelemetry(telemetry, status, "cancelled");
      return status;
    },
  };
  return Object.freeze(worker);
}

export function createDeterministicWorkflowClaimTokenFactory(
  tokensInput: readonly unknown[],
): WorkflowClaimTokenFactory {
  if (!Array.isArray(tokensInput) || tokensInput.length < 1 || tokensInput.length > MAX_TOKEN_FIXTURES) {
    throw new WorkflowWorkerConfigurationError();
  }
  let tokens: UuidV7[];
  try {
    tokens = tokensInput.map((token) => parseUuidV7(token, "claim_token"));
  } catch {
    throw new WorkflowWorkerConfigurationError();
  }
  if (new Set(tokens).size !== tokens.length) throw new WorkflowWorkerConfigurationError();
  let index = 0;
  const factory: WorkflowClaimTokenFactory = Object.freeze({
    nextClaimToken(): UuidV7 {
      const token = tokens[index];
      if (token === undefined) throw new WorkflowWorkerConfigurationError();
      index += 1;
      return token;
    },
  });
  TRUSTED_TOKEN_FACTORIES.add(factory);
  return factory;
}

function normalizeOptions(value: WorkflowWorkerOptions): NormalizedWorkerOptions {
  const record = strictConfigurationRecord(value, [
    "repository",
    "activities",
    "claim_token_factory",
    "telemetry",
    "lease_duration_ms",
    "max_attempts",
    "retry_delay_ms",
    "fault_points",
  ]);
  const repository = record.repository as PostCallWorkflowRepository;
  const activities = record.activities as DeterministicPostCallActivities;
  const tokenFactory = record.claim_token_factory as WorkflowClaimTokenFactory;
  const telemetry = record.telemetry as TelemetryRuntime;
  if (
    repository === null
    || typeof repository !== "object"
    || typeof repository.claimStep !== "function"
    || typeof repository.checkpointStep !== "function"
    || typeof repository.failStep !== "function"
    || typeof repository.cancel !== "function"
    || activities === null
    || typeof activities !== "object"
    || typeof activities.runStep !== "function"
    || tokenFactory === null
    || typeof tokenFactory !== "object"
    || !TRUSTED_TOKEN_FACTORIES.has(tokenFactory)
    || telemetry === null
    || typeof telemetry !== "object"
    || typeof telemetry.startTrustedEventTrace !== "function"
    || typeof telemetry.startSpan !== "function"
    || typeof telemetry.log !== "function"
  ) throw new WorkflowWorkerConfigurationError();
  return Object.freeze({
    repository,
    activities,
    tokenFactory,
    telemetry,
    leaseDurationMs: optionalInteger(record.lease_duration_ms, DEFAULT_LEASE_DURATION_MS, 100, MAX_LEASE_DURATION_MS),
    maxAttempts: optionalInteger(record.max_attempts, DEFAULT_MAX_ATTEMPTS, 1, MAX_ATTEMPTS),
    retryDelayMs: optionalInteger(record.retry_delay_ms, DEFAULT_RETRY_DELAY_MS, 1, MAX_RETRY_DELAY_MS),
    faultPoints: parseFaultPoints(record.fault_points),
  });
}

function classifyActivityFailure(error: unknown): Readonly<{
  code: "activity_retryable" | "invalid_source" | "policy_denied" | "internal_failure";
  retryable: boolean;
}> {
  if (error instanceof WorkflowActivityRetryableError) {
    return Object.freeze({ code: "activity_retryable", retryable: true });
  }
  if (error instanceof WorkflowPolicyDeniedError) {
    return Object.freeze({ code: "policy_denied", retryable: false });
  }
  if (error instanceof WorkflowConflictError || error instanceof WorkflowValidationError) {
    return Object.freeze({ code: "invalid_source", retryable: false });
  }
  return Object.freeze({ code: "internal_failure", retryable: false });
}

function startTelemetry(runtime: TelemetryRuntime, status: PostCallWorkflowStatus): WorkflowTelemetry | null {
  try {
    const context = runtime.startTrustedEventTrace({
      serviceName: "workflow-worker",
      tenantId: status.tenant_id,
      sessionId: status.session_id,
      traceId: status.trace_id,
      correlationId: status.correlation_id,
      causationId: status.causation_id,
    });
    const span = runtime.startSpan("workflow.run", context, {
      component: "workflow_worker",
      operation: "run_workflow_step",
    });
    runtime.log({
      level: "info",
      eventCode: "workflow.run.started",
      context: span.context,
      classification: "internal",
      attributes: { step: status.current_step, status: "running", attempt: Math.max(1, status.attempts) },
    });
    return Object.freeze({ runtime, span });
  } catch {
    return null;
  }
}

function completeTelemetry(
  telemetry: WorkflowTelemetry | null,
  status: PostCallWorkflowStatus,
  outcome: "checkpointed" | "retry_scheduled" | "completed" | "failed" | "cancelled",
): void {
  if (telemetry === null) return;
  try {
    const eventCode: TelemetryEventCode = `workflow.run.${outcome}`;
    const spanOutcome = outcome === "cancelled" ? "cancelled" : outcome === "failed" ? "failure" : "success";
    const spanAttributes = { step: status.current_step, status: outcome, attempt: Math.max(1, status.attempts) };
    if (outcome === "failed") {
      telemetry.span.end({ outcome: spanOutcome, errorCode: "internal_error", attributes: spanAttributes });
    } else if (outcome === "cancelled") {
      telemetry.span.end({ outcome: spanOutcome, errorCode: "cancelled", attributes: spanAttributes });
    } else {
      telemetry.span.end({ outcome: spanOutcome, attributes: spanAttributes });
    }
    telemetry.runtime.log({
      level: outcome === "failed" ? "error" : outcome === "retry_scheduled" ? "warn" : "info",
      eventCode,
      context: telemetry.span.context,
      classification: "internal",
      attributes: {
        step: status.current_step,
        status: outcome,
        attempt: Math.max(1, status.attempts),
        ...(outcome === "failed" ? { outcome: "failure", error_code: "internal_error" } : {}),
      },
    });
  } catch {
    // Telemetry is outside workflow state and never changes a checkpoint.
  }
}

function failTelemetry(telemetry: WorkflowTelemetry | null, step: string): void {
  if (telemetry === null) return;
  try {
    telemetry.span.end({
      outcome: "failure",
      errorCode: "internal_error",
      attributes: { step, status: "failed", outcome: "failure", error_code: "internal_error" },
    });
    telemetry.runtime.log({
      level: "error",
      eventCode: "workflow.run.failed",
      context: telemetry.span.context,
      classification: "internal",
      attributes: { step, status: "failed", outcome: "failure", error_code: "internal_error" },
    });
  } catch {
    // Telemetry failure cannot acknowledge a step.
  }
}

function parseFaultPoints(value: unknown): WorkflowWorkerFaultPoint[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > WORKFLOW_WORKER_FAULT_POINTS.length) {
    throw new WorkflowWorkerConfigurationError();
  }
  const values: WorkflowWorkerFaultPoint[] = [];
  for (const point of value) {
    if (
      typeof point !== "string"
      || !WORKFLOW_WORKER_FAULT_POINTS.includes(point as WorkflowWorkerFaultPoint)
      || values.includes(point as WorkflowWorkerFaultPoint)
    ) throw new WorkflowWorkerConfigurationError();
    values.push(point as WorkflowWorkerFaultPoint);
  }
  return values;
}

function crashAt(faultPoints: WorkflowWorkerFaultPoint[], point: WorkflowWorkerFaultPoint): void {
  const index = faultPoints.indexOf(point);
  if (index < 0) return;
  faultPoints.splice(index, 1);
  throw new WorkflowWorkerCrashError(point);
}

function optionalInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new WorkflowWorkerConfigurationError();
  }
  return value;
}

function strictConfigurationRecord(value: unknown, allowedKeys: readonly string[]): Record<string, unknown> {
  if (
    value === null
    || typeof value !== "object"
    || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
  ) throw new WorkflowWorkerConfigurationError();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!allowedKeys.includes(key) || !("value" in descriptor)) throw new WorkflowWorkerConfigurationError();
  }
  return Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]));
}
