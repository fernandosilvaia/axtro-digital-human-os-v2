import { createHash } from "node:crypto";

import type {
  FakeProviderJournalEntry as ContractFakeProviderJournalEntry,
  FakeProviderReplayDescriptor as ContractFakeProviderReplayDescriptor,
  FakeProviderScenario as ContractFakeProviderScenario,
} from "@axtro/contracts-ts";
import {
  PROVIDER_FAILURE_CODES,
  ProviderContractError,
  ProviderOperationError,
  getProviderOperationDeadlineBudget,
  type ProviderFailure,
  type ProviderFailureCode,
  type ProviderOperationControl,
  type ProviderPortKind,
} from "@axtro/provider-contracts";

export const FAKE_PROVIDER_OPERATIONS = [
  "channel.health",
  "channel.estimateCost",
  "channel.close",
  "channel.open",
  "channel.closeConnection",
  "realtime_model.health",
  "realtime_model.estimateCost",
  "realtime_model.close",
  "realtime_model.openSession",
  "realtime_model.closeSession",
  "stt.health",
  "stt.estimateCost",
  "stt.close",
  "stt.transcribe",
  "tts.health",
  "tts.estimateCost",
  "tts.close",
  "tts.synthesize",
  "avatar.health",
  "avatar.estimateCost",
  "avatar.close",
  "avatar.render",
  "meeting.health",
  "meeting.estimateCost",
  "meeting.close",
  "meeting.join",
  "meeting.leave",
  "telephony.health",
  "telephony.estimateCost",
  "telephony.close",
  "telephony.connect",
  "telephony.disconnect",
  "tool.health",
  "tool.estimateCost",
  "tool.close",
  "storage.health",
  "storage.estimateCost",
  "storage.close",
  "storage.read",
  "storage.write",
] as const;

export type FakeProviderOperation = (typeof FAKE_PROVIDER_OPERATIONS)[number];
export type FakeFailurePhase = "before_partials" | "after_partials";
export type FakeJournalPhase = ContractFakeProviderJournalEntry["phase"];
export type FakeProviderJournalEntry = ContractFakeProviderJournalEntry;
export type FakeProviderReplayDescriptor = ContractFakeProviderReplayDescriptor;
export type FakeProviderScenario = ContractFakeProviderScenario;

interface ParsedFakeProviderPlan {
  readonly operation: FakeProviderOperation;
  readonly invocation: number | null;
  readonly delayMs: number;
  readonly partialCount: number;
  readonly partialIntervalMs: number;
  readonly failureCode: ProviderFailureCode | null;
  readonly failurePhase: FakeFailurePhase;
}

interface ParsedFakeProviderScenario {
  readonly seed: string;
  readonly clockStartMs: number;
  readonly plans: readonly ParsedFakeProviderPlan[];
}

export interface FakeProviderJournal {
  snapshot(): readonly FakeProviderJournalEntry[];
}

export interface DeterministicFakeClock {
  advanceBy(milliseconds: unknown): void;
  runAll(): Promise<void>;
}

export interface FakeProviderInvocation {
  readonly portKind: ProviderPortKind;
  readonly operation: FakeProviderOperation;
  readonly invocation: number;
}

interface FakeProviderScheduler {
  wait(delayMs: number, signal: AbortSignal): Promise<void>;
}

interface ScheduledWait {
  readonly dueAtMs: number;
  readonly order: number;
  readonly signal: AbortSignal;
  readonly resolve: () => void;
  readonly reject: () => void;
  readonly onAbort: () => void;
}

const clocks = new WeakMap<object, FakeProviderScheduler>();
const MAX_DELAY_MS = 120_000;
const MAX_PLANS = 80;
const MAX_PARTIALS = 32;
const MAX_INVOCATION = 10_000;
const MAX_CLOCK_START_MS = 86_400_000;
const SEED_PATTERN = /^[a-z][a-z0-9_-]{7,63}$/;
const UUIDV7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const FORBIDDEN_SEED_TOKEN = /(secret|token|bearer|credential|password|api_?key)/;
const DEFAULT_PLAN: Omit<ParsedFakeProviderPlan, "operation" | "invocation"> = Object.freeze({
  delayMs: 0,
  partialCount: 0,
  partialIntervalMs: 0,
  failureCode: null,
  failurePhase: "before_partials",
});

/**
 * A manual scheduler for deterministic fixtures. It is intentionally the only
 * injectable scheduler accepted by the bundle factory.
 */
export function createDeterministicFakeClock(startAtMs: unknown = 0): DeterministicFakeClock {
  let nowMs = parseInteger(startAtMs, 0, MAX_CLOCK_START_MS);
  let order = 0;
  const pending: ScheduledWait[] = [];
  const scheduler: FakeProviderScheduler = Object.freeze({
    wait(delayMs: number, signal: AbortSignal): Promise<void> {
      if (signal.aborted) return Promise.reject(new FakeWaitAborted());
      return new Promise<void>((resolve, reject) => {
        const scheduled: ScheduledWait = {
          dueAtMs: nowMs + delayMs,
          order: order += 1,
          signal,
          resolve: () => {
            signal.removeEventListener("abort", scheduled.onAbort);
            resolve();
          },
          reject: () => {
            signal.removeEventListener("abort", scheduled.onAbort);
            reject(new FakeWaitAborted());
          },
          onAbort: () => {
            const index = pending.indexOf(scheduled);
            if (index >= 0) pending.splice(index, 1);
            scheduled.reject();
          },
        };
        pending.push(scheduled);
        signal.addEventListener("abort", scheduled.onAbort, { once: true });
      });
    },
  });
  const clock = Object.freeze({
    advanceBy(milliseconds: unknown): void {
      nowMs += parseInteger(milliseconds, 0, MAX_CLOCK_START_MS);
      flushDue(pending, nowMs);
    },
    async runAll(): Promise<void> {
      while (pending.length > 0) {
        const next = nextScheduled(pending);
        nowMs = next.dueAtMs;
        flushDue(pending, nowMs);
        for (let turn = 0; turn < 4; turn += 1) await Promise.resolve();
      }
    },
  } satisfies DeterministicFakeClock);
  clocks.set(clock, scheduler);
  return clock;
}

/** Parse a closed, serializable fake scenario without allowing URLs, secrets, callbacks or tenant metadata. */
export function parseFakeProviderScenario(value: unknown): ParsedFakeProviderScenario {
  const record = strictRecord(value, ["schema_version", "seed", "clock_start_ms", "plans"], ["schema_version", "seed"]);
  if (readRequired(record, "schema_version") !== "2.0.0") throw new ProviderContractError();
  const seed = parseSeed(readRequired(record, "seed"));
  const clockStartMs = hasOwn(record, "clock_start_ms") ? parseInteger(readRequired(record, "clock_start_ms"), 0, MAX_CLOCK_START_MS) : 0;
  const plans = hasOwn(record, "plans") ? parsePlans(readRequired(record, "plans")) : [];
  return deepFreeze({ seed, clockStartMs, plans });
}

export function createFakeProviderReplayDescriptor(scenario: ParsedFakeProviderScenario): FakeProviderReplayDescriptor {
  const scenarioHash = hashText(JSON.stringify({
    schema_version: "2.0.0",
    seed: scenario.seed,
    clock_start_ms: scenario.clockStartMs,
    plans: scenario.plans.map((plan) => ({
      operation: plan.operation,
      ...(plan.invocation === null ? {} : { invocation: plan.invocation }),
      delay_ms: plan.delayMs,
      partial_count: plan.partialCount,
      partial_interval_ms: plan.partialIntervalMs,
      ...(plan.failureCode === null ? {} : { failure_code: plan.failureCode, failure_phase: plan.failurePhase }),
    })),
  }));
  return Object.freeze({
    schema_version: "2.0.0" as const,
    seed: scenario.seed,
    scenario_hash: scenarioHash,
  });
}

export function resolveFakeProviderScheduler(value: unknown): FakeProviderScheduler {
  if (value === undefined) return SYSTEM_SCHEDULER;
  if (value === null || typeof value !== "object") throw new ProviderContractError();
  const scheduler = clocks.get(value);
  if (scheduler === undefined) throw new ProviderContractError();
  return scheduler;
}

/** Keep timing, partial markers and failure injection inside a non-PII, bundle-local journal. */
export class DeterministicFakeProviderEngine {
  readonly journal: FakeProviderJournal;

  private readonly events: FakeProviderJournalEntry[] = [];
  private readonly invocationCounts = new Map<FakeProviderOperation, number>();
  private sequence = 0;

  constructor(
    private readonly scenario: ParsedFakeProviderScenario,
    private readonly scheduler: FakeProviderScheduler,
  ) {
    this.journal = Object.freeze({
      snapshot: (): readonly FakeProviderJournalEntry[] => Object.freeze([...this.events]),
    } satisfies FakeProviderJournal);
  }

  async run(operation: FakeProviderOperation, control: ProviderOperationControl): Promise<FakeProviderInvocation> {
    if (control.signal.aborted) throw new ProviderOperationError(failure("cancelled"));
    const deadlineBudgetMs = Math.min(control.timeoutMs, getProviderOperationDeadlineBudget(control));
    if (deadlineBudgetMs <= 0) throw new ProviderOperationError(failure("timeout"));
    const operationAbort = new AbortController();
    let virtualTimeoutTriggered = false;
    const forwardCallerAbort = (): void => {
      if (!operationAbort.signal.aborted) {
        operationAbort.abort(control.signal.reason === "timeout" ? "timeout" : "cancelled");
      }
    };
    control.signal.addEventListener("abort", forwardCallerAbort, { once: true });
    void this.scheduler.wait(deadlineBudgetMs, operationAbort.signal).then(
      () => {
        if (operationAbort.signal.aborted) return;
        virtualTimeoutTriggered = true;
        operationAbort.abort("timeout");
      },
      () => undefined,
    );
    const signal = operationAbort.signal;
    const invocation = (this.invocationCounts.get(operation) ?? 0) + 1;
    this.invocationCounts.set(operation, invocation);
    const portKind = parsePortKind(operation);
    const plan = this.planFor(operation, invocation);
    let elapsedMs = 0;
    let terminal = false;
    const entry = { portKind, operation, invocation } satisfies FakeProviderInvocation;
    const emit = (phase: FakeJournalPhase, failureCode: ProviderFailureCode | null): void => {
      this.events.push(Object.freeze({
        schema_version: "2.0.0" as const,
        port_kind: portKind,
        operation,
        invocation,
        sequence: this.sequence += 1,
        phase,
        simulated_at_ms: this.scenario.clockStartMs + elapsedMs,
        failure_code: failureCode,
      }));
    };
    const emitTerminal = (phase: Exclude<FakeJournalPhase, "started" | "partial">, failureCode: ProviderFailureCode | null): void => {
      if (terminal) return;
      terminal = true;
      emit(phase, failureCode);
    };
    const wait = async (delayMs: number): Promise<void> => {
      if (signal.aborted) throw new FakeWaitAborted();
      if (delayMs === 0) return;
      await this.scheduler.wait(delayMs, signal);
      if (signal.aborted) throw new FakeWaitAborted();
      elapsedMs += delayMs;
    };

    emit("started", null);
    try {
      if (plan.failureCode !== null && plan.failurePhase === "before_partials") {
        await wait(plan.delayMs);
        emitTerminal("failed", plan.failureCode);
        throw new ProviderOperationError(failure(plan.failureCode));
      }
      for (let partial = 0; partial < plan.partialCount; partial += 1) {
        await wait(plan.partialIntervalMs);
        emit("partial", null);
      }
      await wait(plan.delayMs - (plan.partialCount * plan.partialIntervalMs));
      if (plan.failureCode !== null) {
        emitTerminal("failed", plan.failureCode);
        throw new ProviderOperationError(failure(plan.failureCode));
      }
      emitTerminal("completed", null);
      return Object.freeze(entry);
    } catch (error: unknown) {
      if (terminal) throw error;
      if (error instanceof FakeWaitAborted || signal.aborted) {
        const failureCode = virtualTimeoutTriggered || signal.reason === "timeout" ? "timeout" : "cancelled";
        emitTerminal(failureCode === "timeout" ? "timed_out" : "cancelled", failureCode);
        throw new ProviderOperationError(failure(failureCode));
      }
      const providerError = error as ProviderOperationError;
      const failureCode = error instanceof ProviderOperationError ? providerError.failure.code : "unknown";
      emitTerminal("failed", failureCode);
      throw error instanceof ProviderOperationError ? error : new ProviderOperationError(failure(failureCode));
    } finally {
      control.signal.removeEventListener("abort", forwardCallerAbort);
      if (!operationAbort.signal.aborted) operationAbort.abort("completed");
    }
  }

  private planFor(operation: FakeProviderOperation, invocation: number): ParsedFakeProviderPlan {
    const specific = this.scenario.plans.find((plan) => plan.operation === operation && plan.invocation === invocation);
    const general = this.scenario.plans.find((plan) => plan.operation === operation && plan.invocation === null);
    return specific ?? general ?? Object.freeze({ operation, invocation: null, ...DEFAULT_PLAN });
  }
}

export function deterministicFakeReference(
  seed: string,
  invocation: FakeProviderInvocation,
  resultKind: string,
  inputReferences: readonly string[],
): string {
  return `ref_${hashText([seed, invocation.portKind, invocation.operation, String(invocation.invocation), resultKind, ...inputReferences].join("\u0000")).slice(0, 40)}`;
}

function parsePlans(value: unknown): readonly ParsedFakeProviderPlan[] {
  const items = strictArray(value, 0, MAX_PLANS);
  const plans = items.map(parsePlan);
  const keys = new Set<string>();
  for (const plan of plans) {
    const key = `${plan.operation}:${plan.invocation ?? "all"}`;
    if (keys.has(key)) throw new ProviderContractError();
    keys.add(key);
  }
  return Object.freeze(plans);
}

function parsePlan(value: unknown): ParsedFakeProviderPlan {
  const record = strictRecord(
    value,
    ["operation", "invocation", "delay_ms", "partial_count", "partial_interval_ms", "failure_code", "failure_phase"],
    ["operation"],
  );
  const operation = parseOperation(readRequired(record, "operation"));
  const invocation = hasOwn(record, "invocation") ? parseInteger(readRequired(record, "invocation"), 1, MAX_INVOCATION) : null;
  const delayMs = hasOwn(record, "delay_ms") ? parseInteger(readRequired(record, "delay_ms"), 0, MAX_DELAY_MS) : 0;
  const partialCount = hasOwn(record, "partial_count") ? parseInteger(readRequired(record, "partial_count"), 0, MAX_PARTIALS) : 0;
  const partialIntervalMs = hasOwn(record, "partial_interval_ms") ? parseInteger(readRequired(record, "partial_interval_ms"), 0, MAX_DELAY_MS) : 0;
  const failureCode = hasOwn(record, "failure_code") ? parseInjectedFailureCode(readRequired(record, "failure_code")) : null;
  const failurePhase = hasOwn(record, "failure_phase") ? parseFailurePhase(readRequired(record, "failure_phase")) : "before_partials";
  if (partialCount === 0 && partialIntervalMs !== 0) throw new ProviderContractError();
  if (partialCount * partialIntervalMs > delayMs) throw new ProviderContractError();
  if (failureCode === null && hasOwn(record, "failure_phase")) throw new ProviderContractError();
  if (failureCode !== null && failurePhase === "before_partials" && partialCount !== 0) throw new ProviderContractError();
  if (failureCode !== null && failurePhase === "after_partials" && partialCount === 0) throw new ProviderContractError();
  return Object.freeze({ operation, invocation, delayMs, partialCount, partialIntervalMs, failureCode, failurePhase });
}

function parseOperation(value: unknown): FakeProviderOperation {
  if (typeof value !== "string" || !(FAKE_PROVIDER_OPERATIONS as readonly string[]).includes(value)) throw new ProviderContractError();
  return value as FakeProviderOperation;
}

function parsePortKind(operation: FakeProviderOperation): ProviderPortKind {
  const portKind = operation.slice(0, operation.indexOf("."));
  if (![
    "channel",
    "realtime_model",
    "stt",
    "tts",
    "avatar",
    "meeting",
    "telephony",
    "tool",
    "storage",
  ].includes(portKind)) throw new ProviderContractError();
  return portKind as ProviderPortKind;
}

function parseInjectedFailureCode(value: unknown): ProviderFailureCode {
  if (typeof value !== "string" || !(PROVIDER_FAILURE_CODES as readonly string[]).includes(value)) throw new ProviderContractError();
  if (value === "cancelled" || value === "timeout") throw new ProviderContractError();
  return value as ProviderFailureCode;
}

function parseFailurePhase(value: unknown): FakeFailurePhase {
  if (value !== "before_partials" && value !== "after_partials") throw new ProviderContractError();
  return value;
}

function parseSeed(value: unknown): string {
  if (typeof value !== "string" || !SEED_PATTERN.test(value) || UUIDV7_PATTERN.test(value) || FORBIDDEN_SEED_TOKEN.test(value)) {
    throw new ProviderContractError();
  }
  return value;
}

function failure(code: ProviderFailureCode): ProviderFailure {
  return Object.freeze({
    code,
    retryable: code === "rate_limited" || code === "capacity" || code === "timeout" || code === "transient_network",
  });
}

function strictRecord(value: unknown, allowed: readonly string[], required: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new ProviderContractError();
  }
  const record = value as Record<string, unknown>;
  const keys = Reflect.ownKeys(record);
  if (keys.some((key) => typeof key !== "string" || !allowed.includes(key))) throw new ProviderContractError();
  for (const key of required) {
    if (!hasOwn(record, key)) throw new ProviderContractError();
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (descriptor === undefined || !("value" in descriptor)) throw new ProviderContractError();
  }
  return record;
}

function strictArray(value: unknown, minimum: number, maximum: number): readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length < minimum || value.length > maximum) {
    throw new ProviderContractError();
  }
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => key !== "length" && (typeof key !== "string" || !/^\d+$/.test(key)))) throw new ProviderContractError();
  const items: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !("value" in descriptor)) throw new ProviderContractError();
    items.push(descriptor.value);
  }
  return Object.freeze(items);
}

function readRequired(record: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor === undefined || !("value" in descriptor)) throw new ProviderContractError();
  return descriptor.value;
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function parseInteger(value: unknown, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new ProviderContractError();
  }
  return value;
}

function hashText(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function deepFreeze<const Value>(value: Value): Value {
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item);
  } else if (value !== null && typeof value === "object") {
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return Object.freeze(value);
}

function nextScheduled(pending: readonly ScheduledWait[]): ScheduledWait {
  const next = [...pending].sort((left, right) => (left.dueAtMs - right.dueAtMs) || (left.order - right.order))[0];
  if (next === undefined) throw new ProviderContractError();
  return next;
}

function flushDue(pending: ScheduledWait[], nowMs: number): void {
  while (true) {
    const next = pending.filter((item) => item.dueAtMs <= nowMs).sort((left, right) => (left.dueAtMs - right.dueAtMs) || (left.order - right.order))[0];
    if (next === undefined) return;
    const index = pending.indexOf(next);
    pending.splice(index, 1);
    next.resolve();
  }
}

class FakeWaitAborted extends Error {}

const SYSTEM_SCHEDULER: FakeProviderScheduler = Object.freeze({
  wait(delayMs: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.reject(new FakeWaitAborted());
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (callback: () => void): void => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        callback();
      };
      const timer = setTimeout(() => finish(resolve), delayMs);
      const onAbort = (): void => {
        clearTimeout(timer);
        finish(() => reject(new FakeWaitAborted()));
      };
      signal.addEventListener("abort", onAbort, { once: true });
    });
  },
});
