import {
  ProviderContractError,
  parseProviderCircuitState,
  parseProviderFailureCode,
  parseProviderHealthStatus,
  type ProviderCircuitState,
  type ProviderFailureCode,
  type ProviderHealthStatus,
} from "./normalization.js";

export interface ProviderOperationControl {
  readonly timeoutMs: number;
  readonly deadlineAt: number;
  readonly signal: AbortSignal;
}

export interface ProviderFailure {
  readonly code: ProviderFailureCode;
  readonly retryable: boolean;
}

export interface ProviderHealth {
  readonly status: ProviderHealthStatus;
  readonly circuitState: ProviderCircuitState;
  readonly checkedAt: string;
  readonly latencyMs: number;
  readonly failure: ProviderFailure | null;
}

export type ProviderOperation<Result> = (control: ProviderOperationControl) => Result | Promise<Result>;

const operationControls = new WeakSet<object>();
const adapterDeadlineBudgets = new WeakMap<object, number>();

/** A normalized failure intentionally contains no raw provider response or message. */
export class ProviderOperationError extends Error {
  constructor(readonly failure: ProviderFailure) {
    super("Provider operation did not complete");
    this.name = "ProviderOperationError";
  }
}

/** Create an explicit, finite control object. It cannot carry tenant, headers or credentials. */
export function createProviderOperationControl(value: unknown): ProviderOperationControl {
  const now = Date.now();
  const record = plainRecord(value);
  assertAllowedKeys(record, ["timeoutMs", "deadlineAt", "signal"], ["deadlineAt", "signal"]);
  const timeoutMs = parseFiniteInteger(readRequired(record, "timeoutMs"), 50, 120_000);
  const deadlineValue = readOptional(record, "deadlineAt");
  const deadlineAt = deadlineValue === undefined
    ? now + timeoutMs
    : parseFiniteInteger(deadlineValue, now + 1, now + timeoutMs);
  const signalValue = readOptional(record, "signal");
  const signal = signalValue === undefined ? new AbortController().signal : parseAbortSignal(signalValue);
  return markOperationControl({ timeoutMs, deadlineAt, signal });
}

/**
 * Return the deadline budget at the adapter boundary. The budget is captured
 * once for a derived adapter control, or derived from the absolute deadline
 * for a bootstrap-only raw adapter invocation.
 */
export function getProviderOperationDeadlineBudget(control: ProviderOperationControl): number {
  assertProviderOperationControl(control);
  return adapterDeadlineBudgets.get(control) ?? Math.max(0, control.deadlineAt - Date.now());
}

/**
 * Derive the adapter control for one operation. Both caller cancellation and
 * deadline expiry abort that signal before the caller observes the normalized
 * failure. Late completion is deliberately ignored.
 */
export async function runProviderOperation<Result>(
  control: ProviderOperationControl,
  operation: ProviderOperation<Result>,
): Promise<Result> {
  assertProviderOperationControl(control);
  if (typeof operation !== "function") throw new ProviderContractError("invalid_operation_control");
  if (control.signal.aborted) throw new ProviderOperationError(failure("cancelled"));
  const deadlineBudgetMs = getProviderOperationDeadlineBudget(control);
  if (deadlineBudgetMs <= 0) throw new ProviderOperationError(failure("timeout"));

  const operationAbort = new AbortController();
  const operationControl = markOperationControl({
    timeoutMs: control.timeoutMs,
    deadlineAt: control.deadlineAt,
    signal: operationAbort.signal,
  }, deadlineBudgetMs);

  return new Promise<Result>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (result: { readonly kind: "resolve"; readonly value: Result } | { readonly kind: "reject"; readonly value: ProviderOperationError }): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      control.signal.removeEventListener("abort", onCallerAbort);
      if (result.kind === "resolve") resolve(result.value);
      else reject(result.value);
    };
    const fail = (code: ProviderFailureCode): void => {
      if (!operationAbort.signal.aborted) operationAbort.abort(code);
      finish({ kind: "reject", value: new ProviderOperationError(failure(code)) });
    };
    const onCallerAbort = (): void => fail("cancelled");

    control.signal.addEventListener("abort", onCallerAbort, { once: true });
    timer = setTimeout(() => fail("timeout"), deadlineBudgetMs);
    Promise.resolve()
      .then(async () => {
        if (settled || operationAbort.signal.aborted) return;
        const result = await operation(operationControl);
        finish({ kind: "resolve", value: result });
      })
      .catch((error: unknown) => finish({ kind: "reject", value: new ProviderOperationError(normalizeProviderFailure(error)) }));
  });
}

/** Map unknown adapter failures to the closed taxonomy without preserving raw details. */
export function normalizeProviderFailure(error: unknown): ProviderFailure {
  if (error instanceof ProviderOperationError) return error.failure;
  return failure("unknown");
}

/** Normalize a read-only health result. Extra fields such as endpoint or raw error are rejected. */
export function normalizeProviderHealth(value: unknown): ProviderHealth {
  const record = plainRecord(value);
  assertAllowedKeys(record, ["status", "circuitState", "checkedAt", "latencyMs", "failureCode"], ["failureCode"]);
  const failureCode = readOptional(record, "failureCode");
  const health = {
    status: parseProviderHealthStatus(readRequired(record, "status")),
    circuitState: parseProviderCircuitState(readRequired(record, "circuitState")),
    checkedAt: parseTimestamp(readRequired(record, "checkedAt")),
    latencyMs: parseFiniteInteger(readRequired(record, "latencyMs"), 0, 120_000),
    failure: failureCode === undefined ? null : failure(parseProviderFailureCode(failureCode)),
  } satisfies ProviderHealth;
  return Object.freeze(health);
}

/** Close an adapter at most once, including when the original close rejects. */
export function createIdempotentClose(
  close: (control: ProviderOperationControl) => void | Promise<void>,
): (control: ProviderOperationControl) => Promise<void> {
  if (typeof close !== "function") throw new ProviderContractError("invalid_contract");
  let completed: Promise<void> | undefined;
  return (control: ProviderOperationControl): Promise<void> => {
    completed ??= Promise.resolve().then(() => close(control));
    return completed;
  };
}

function markOperationControl(value: ProviderOperationControl, deadlineBudgetMs?: number): ProviderOperationControl {
  const control = Object.freeze(value);
  operationControls.add(control);
  if (deadlineBudgetMs !== undefined) adapterDeadlineBudgets.set(control, deadlineBudgetMs);
  return control;
}

function assertProviderOperationControl(value: unknown): asserts value is ProviderOperationControl {
  if (value === null || typeof value !== "object" || !operationControls.has(value)) {
    throw new ProviderContractError("invalid_operation_control");
  }
}

function failure(code: ProviderFailureCode): ProviderFailure {
  return Object.freeze({ code, retryable: isRetryable(code) });
}

function isRetryable(code: ProviderFailureCode): boolean {
  return code === "rate_limited" || code === "capacity" || code === "timeout" || code === "transient_network";
}

function parseAbortSignal(value: unknown): AbortSignal {
  if (typeof AbortSignal === "undefined" || !(value instanceof AbortSignal)) {
    throw new ProviderContractError("invalid_operation_control");
  }
  return value;
}

function parseFiniteInteger(value: unknown, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new ProviderContractError("invalid_operation_control");
  }
  return value;
}

function parseTimestamp(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) {
    throw new ProviderContractError("invalid_contract");
  }
  if (!Number.isFinite(Date.parse(value))) throw new ProviderContractError("invalid_contract");
  return value;
}

function plainRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new ProviderContractError("invalid_operation_control");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new ProviderContractError("invalid_operation_control");
  return value as Record<string, unknown>;
}

function assertAllowedKeys(record: Record<string, unknown>, expected: readonly string[], optional: readonly string[]): void {
  for (const key of Reflect.ownKeys(record)) {
    if (typeof key !== "string" || !expected.includes(key)) throw new ProviderContractError("invalid_operation_control");
  }
  for (const key of expected) {
    if (!optional.includes(key) && !Object.prototype.hasOwnProperty.call(record, key)) {
      throw new ProviderContractError("invalid_operation_control");
    }
  }
}

function readRequired(record: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor === undefined || !("value" in descriptor)) throw new ProviderContractError("invalid_operation_control");
  return descriptor.value;
}

function readOptional(record: Record<string, unknown>, key: string): unknown | undefined {
  if (!Object.prototype.hasOwnProperty.call(record, key)) return undefined;
  return readRequired(record, key);
}
