/**
 * M2-08: time-bounded, silent specialists behind a bounded queue and
 * per-type bulkhead, per docs/architecture/SPECIALIST_AGENT_FABRIC.md. The
 * One Mouth Rule (Art. 2) is mechanically enforced by omission — this
 * module's public surface has no publish/speak method, and a
 * `SpecialistResult` can carry only structured, expiring, untrusted data.
 * A slow specialist never blocks the Presenter: every request is raced
 * against its own deadline and released back to the caller either way.
 */
export const SPECIALIST_TYPES = ["product", "pricing", "compliance", "research", "proposal", "tool_planner", "fact_checker"] as const;
export type SpecialistType = (typeof SPECIALIST_TYPES)[number];

export type SpecialistDataClassification = "internal" | "confidential" | "restricted";

export interface SpecialistRequest {
  readonly requestId: string;
  readonly tenantId: string;
  readonly sessionId: string;
  readonly specialistType: SpecialistType;
  readonly task: string;
  readonly allowedSources: readonly string[];
  readonly contextVersion: number;
  readonly deadlineMs: number;
  readonly dataClassification: SpecialistDataClassification;
}

export type SpecialistResultStatus = "completed" | "timeout" | "rejected_queue_full" | "error" | "invalid_result";

export interface SpecialistResult {
  readonly status: SpecialistResultStatus;
  readonly requestId: string;
  readonly specialistType: SpecialistType;
  readonly answer: Readonly<Record<string, unknown>> | null;
  readonly sources: readonly string[];
  readonly confidence: number | null;
  readonly assumptions: readonly string[];
  readonly prohibitedClaims: readonly string[];
  readonly expiresAtMs: number | null;
  readonly contextVersion: number;
  readonly untrusted: true;
}

export interface SpecialistHandlerOutput {
  readonly answer: Readonly<Record<string, unknown>>;
  readonly sources: readonly string[];
  readonly confidence: number;
  readonly assumptions: readonly string[];
  readonly prohibitedClaims: readonly string[];
  readonly ttlMs: number;
}

export interface SpecialistHandlerControl {
  readonly signal: AbortSignal;
}

export type SpecialistHandler = (request: SpecialistRequest, control: SpecialistHandlerControl) => Promise<SpecialistHandlerOutput>;

export interface SpecialistMetrics {
  readonly requested: number;
  readonly completed: number;
  readonly timedOut: number;
  readonly rejectedQueueFull: number;
  readonly errored: number;
  readonly invalidResult: number;
}

export interface SpecialistScheduler {
  wait(ms: number, signal: AbortSignal): Promise<void>;
}

export interface SpecialistFabricClock {
  now(): number;
}

export class SpecialistFabricError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpecialistFabricError";
  }
}

export interface SpecialistFabric {
  registerHandler(specialistType: SpecialistType, handler: SpecialistHandler): void;
  request(rawRequest: unknown): Promise<SpecialistResult>;
  metrics(specialistType: SpecialistType): SpecialistMetrics;
}

export interface CreateSpecialistFabricOptions {
  readonly maxConcurrencyPerType?: number;
  readonly maxQueueDepthPerType?: number;
  readonly scheduler?: SpecialistScheduler;
  readonly clock?: SpecialistFabricClock;
}

const REQUEST_ID_PATTERN = /^[a-z][a-z0-9_-]{2,63}$/;
const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const MAX_TASK_LENGTH = 4_000;
const MAX_SOURCES = 20;
const DEFAULT_MAX_CONCURRENCY = 2;
const DEFAULT_MAX_QUEUE_DEPTH = 8;

const realScheduler: SpecialistScheduler = Object.freeze({
  wait(ms: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.reject(new Error("aborted"));
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(new Error("aborted"));
        },
        { once: true },
      );
    });
  },
});
const systemClock: SpecialistFabricClock = Object.freeze({ now: () => Date.now() });

interface TypeState {
  activeCount: number;
  readonly queue: (() => void)[];
  metrics: {
    requested: number;
    completed: number;
    timedOut: number;
    rejectedQueueFull: number;
    errored: number;
    invalidResult: number;
  };
}

export function createSpecialistFabric(options: CreateSpecialistFabricOptions = {}): SpecialistFabric {
  const maxConcurrency = options.maxConcurrencyPerType ?? DEFAULT_MAX_CONCURRENCY;
  const maxQueueDepth = options.maxQueueDepthPerType ?? DEFAULT_MAX_QUEUE_DEPTH;
  const scheduler = options.scheduler ?? realScheduler;
  const clock = options.clock ?? systemClock;
  const handlers = new Map<SpecialistType, SpecialistHandler>();
  const states = new Map<SpecialistType, TypeState>(SPECIALIST_TYPES.map((type) => [
    type,
    { activeCount: 0, queue: [], metrics: { requested: 0, completed: 0, timedOut: 0, rejectedQueueFull: 0, errored: 0, invalidResult: 0 } },
  ]));

  const stateFor = (type: SpecialistType): TypeState => {
    const state = states.get(type);
    if (state === undefined) throw new SpecialistFabricError(`unknown specialist type: ${type}`);
    return state;
  };

  const acquireSlot = (state: TypeState): Promise<void> => {
    if (state.activeCount < maxConcurrency) {
      state.activeCount += 1;
      return Promise.resolve();
    }
    if (state.queue.length >= maxQueueDepth) throw new QueueFullSignal();
    return new Promise<void>((resolve) => {
      state.queue.push(() => {
        state.activeCount += 1;
        resolve();
      });
    });
  };

  const releaseSlot = (state: TypeState): void => {
    state.activeCount -= 1;
    const next = state.queue.shift();
    if (next !== undefined) next();
  };

  return Object.freeze({
    registerHandler(specialistType: SpecialistType, handler: SpecialistHandler): void {
      if (!(SPECIALIST_TYPES as readonly string[]).includes(specialistType)) throw new SpecialistFabricError("unknown specialist type");
      if (typeof handler !== "function") throw new SpecialistFabricError("handler must be a function");
      handlers.set(specialistType, handler);
    },

    async request(rawRequest: unknown): Promise<SpecialistResult> {
      const request = parseRequest(rawRequest);
      const state = stateFor(request.specialistType);
      state.metrics.requested += 1;
      const handler = handlers.get(request.specialistType);
      if (handler === undefined) throw new SpecialistFabricError(`no handler registered for specialist type: ${request.specialistType}`);

      try {
        await acquireSlot(state);
      } catch (error: unknown) {
        if (error instanceof QueueFullSignal) {
          state.metrics.rejectedQueueFull += 1;
          return rejectedResult(request, "rejected_queue_full");
        }
        throw error;
      }

      const controller = new AbortController();
      let settled = false;
      try {
        const outcome = await Promise.race([
          handler(request, { signal: controller.signal }).then((output) => ({ kind: "handler" as const, output })),
          scheduler.wait(request.deadlineMs, controller.signal).then(() => ({ kind: "timeout" as const })),
        ]).catch((error: unknown) => ({ kind: "error" as const, error }));
        settled = true;
        if (outcome.kind === "timeout") {
          controller.abort("deadline_exceeded");
          state.metrics.timedOut += 1;
          return rejectedResult(request, "timeout");
        }
        if (outcome.kind === "error") {
          state.metrics.errored += 1;
          return rejectedResult(request, "error");
        }
        controller.abort("completed");
        const validated = validateHandlerOutput(outcome.output);
        if (validated === null) {
          state.metrics.invalidResult += 1;
          return rejectedResult(request, "invalid_result");
        }
        state.metrics.completed += 1;
        return Object.freeze({
          status: "completed" as const,
          requestId: request.requestId,
          specialistType: request.specialistType,
          answer: validated.answer,
          sources: validated.sources,
          confidence: validated.confidence,
          assumptions: validated.assumptions,
          prohibitedClaims: validated.prohibitedClaims,
          expiresAtMs: clock.now() + validated.ttlMs,
          contextVersion: request.contextVersion,
          untrusted: true as const,
        });
      } finally {
        if (!settled) controller.abort("released");
        releaseSlot(state);
      }
    },

    metrics(specialistType: SpecialistType): SpecialistMetrics {
      return Object.freeze({ ...stateFor(specialistType).metrics });
    },
  });
}

export function isSpecialistResultExpired(result: SpecialistResult, atMs: number): boolean {
  return result.expiresAtMs === null || atMs >= result.expiresAtMs;
}

class QueueFullSignal extends Error {}

function rejectedResult(request: SpecialistRequest, status: Exclude<SpecialistResultStatus, "completed">): SpecialistResult {
  return Object.freeze({
    status,
    requestId: request.requestId,
    specialistType: request.specialistType,
    answer: null,
    sources: Object.freeze([]),
    confidence: null,
    assumptions: Object.freeze([]),
    prohibitedClaims: Object.freeze([]),
    expiresAtMs: null,
    contextVersion: request.contextVersion,
    untrusted: true as const,
  });
}

function validateHandlerOutput(output: unknown): SpecialistHandlerOutput | null {
  if (output === null || typeof output !== "object") return null;
  const record = output as Record<string, unknown>;
  if (record.answer === null || typeof record.answer !== "object" || Array.isArray(record.answer)) return null;
  if (!Array.isArray(record.sources) || record.sources.some((s) => typeof s !== "string") || record.sources.length > MAX_SOURCES) return null;
  if (typeof record.confidence !== "number" || !Number.isFinite(record.confidence) || record.confidence < 0 || record.confidence > 1) return null;
  if (!Array.isArray(record.assumptions) || record.assumptions.some((a) => typeof a !== "string")) return null;
  if (!Array.isArray(record.prohibitedClaims) || record.prohibitedClaims.some((c) => typeof c !== "string")) return null;
  if (typeof record.ttlMs !== "number" || !Number.isFinite(record.ttlMs) || record.ttlMs <= 0 || record.ttlMs > 3_600_000) return null;
  return Object.freeze({
    answer: Object.freeze({ ...(record.answer as Record<string, unknown>) }),
    sources: Object.freeze([...(record.sources as string[])]),
    confidence: record.confidence,
    assumptions: Object.freeze([...(record.assumptions as string[])]),
    prohibitedClaims: Object.freeze([...(record.prohibitedClaims as string[])]),
    ttlMs: record.ttlMs,
  });
}

function parseRequest(value: unknown): SpecialistRequest {
  if (value === null || typeof value !== "object") throw new SpecialistFabricError("invalid specialist request");
  const record = value as Record<string, unknown>;
  if (typeof record.requestId !== "string" || !REQUEST_ID_PATTERN.test(record.requestId)) throw new SpecialistFabricError("invalid requestId");
  if (typeof record.tenantId !== "string" || !ID_PATTERN.test(record.tenantId)) throw new SpecialistFabricError("invalid tenantId");
  if (typeof record.sessionId !== "string" || !ID_PATTERN.test(record.sessionId)) throw new SpecialistFabricError("invalid sessionId");
  if (typeof record.specialistType !== "string" || !(SPECIALIST_TYPES as readonly string[]).includes(record.specialistType)) {
    throw new SpecialistFabricError("invalid specialistType");
  }
  if (typeof record.task !== "string" || record.task.length === 0 || record.task.length > MAX_TASK_LENGTH) throw new SpecialistFabricError("invalid task");
  if (!Array.isArray(record.allowedSources) || record.allowedSources.some((s) => typeof s !== "string") || record.allowedSources.length > MAX_SOURCES) {
    throw new SpecialistFabricError("invalid allowedSources");
  }
  if (typeof record.contextVersion !== "number" || !Number.isSafeInteger(record.contextVersion) || record.contextVersion < 0) {
    throw new SpecialistFabricError("invalid contextVersion");
  }
  if (typeof record.deadlineMs !== "number" || !Number.isFinite(record.deadlineMs) || record.deadlineMs <= 0 || record.deadlineMs > 60_000) {
    throw new SpecialistFabricError("invalid deadlineMs");
  }
  if (record.dataClassification !== "internal" && record.dataClassification !== "confidential" && record.dataClassification !== "restricted") {
    throw new SpecialistFabricError("invalid dataClassification");
  }
  return Object.freeze({
    requestId: record.requestId,
    tenantId: record.tenantId,
    sessionId: record.sessionId,
    specialistType: record.specialistType as SpecialistType,
    task: record.task,
    allowedSources: Object.freeze([...(record.allowedSources as string[])]),
    contextVersion: record.contextVersion,
    deadlineMs: record.deadlineMs,
    dataClassification: record.dataClassification,
  });
}
