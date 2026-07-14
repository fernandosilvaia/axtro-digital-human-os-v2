export const APPLICATION_SECURITY_LIMITS = Object.freeze({
  maxHeaderCount: 32,
  maxHeaderNameBytes: 128,
  maxHeaderValueBytes: 4_096,
  maxHeaderBytes: 8_192,
  maxRequestBodyBytes: 65_536,
  maxRequestsPerWindow: 30,
  rateLimitWindowMs: 60_000,
  maxRateLimitBuckets: 1_024,
});

/** The profile is code-owned. API callers cannot add, reflect, or override headers. */
export const API_SECURE_RESPONSE_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "cache-control": "no-store",
  "content-security-policy": "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
  "content-type": "application/json; charset=utf-8",
  "cross-origin-opener-policy": "same-origin",
  "permissions-policy": "camera=(), geolocation=(), microphone=(), payment=()",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
});

export interface ApplicationSecurityClock {
  now(): number;
}

export interface ApplicationSecurityTimer {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface ApplicationSecurityGateOptions {
  readonly requestTimeoutMs: unknown;
  readonly clock?: ApplicationSecurityClock;
  readonly timer?: ApplicationSecurityTimer;
}

/** Opaque, per-gate ingress proof. It cannot be reconstructed from request data. */
export interface ValidatedApplicationIngress {
  readonly __validatedApplicationIngress?: never;
}

export interface AuthenticatedRequestAdmission {
  readonly tenantId: unknown;
  readonly actorId: unknown;
  readonly routeId: unknown;
  readonly cancellationSignal?: AbortSignal;
}

export interface BoundedRequestBodyCollector {
  append(chunk: unknown): void;
  finish(): Uint8Array;
}

export interface RequestBudget {
  readonly deadlineAtMs: number;
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
  assertActive(): void;
  dispose(): void;
  run<Result>(work: (signal: AbortSignal) => Result | Promise<Result>): Promise<Result>;
}

export interface ApplicationSecurityGate {
  readonly responseHeaders: Readonly<Record<string, string>>;
  createBodyCollector(): BoundedRequestBodyCollector;
  inspectInboundRequest(input: unknown): ValidatedApplicationIngress;
  readInboundHeaders(input: ValidatedApplicationIngress): Readonly<Record<string, string>>;
  readInboundBody(input: ValidatedApplicationIngress): Uint8Array;
  admitAuthenticatedRequest(input: AuthenticatedRequestAdmission): RequestBudget;
}

export type ApplicationSecurityErrorCode =
  | "invalid_ingress"
  | "header_limit_exceeded"
  | "request_body_too_large"
  | "rate_limited"
  | "rate_limiter_capacity"
  | "request_timed_out"
  | "request_cancelled"
  | "request_budget_disposed"
  | "security_runtime_invalid"
  | "security_clock_regressed";

export interface SafeApplicationSecurityFailure {
  readonly status: number;
  readonly code: ApplicationSecurityErrorCode | "internal_error";
  readonly retryAfterMs: number | null;
}

export class ApplicationSecurityError extends Error {
  readonly code: ApplicationSecurityErrorCode;
  readonly status: number;
  readonly retryAfterMs: number | null;

  constructor(code: ApplicationSecurityErrorCode, retryAfterMs: number | null = null) {
    const metadata = SECURITY_ERROR_METADATA[code];
    super(metadata.message);
    this.name = "ApplicationSecurityError";
    this.code = code;
    this.status = metadata.status;
    this.retryAfterMs = retryAfterMs;
  }
}

/** Convert only code-owned security errors into a response-safe shape. */
export function toSafeApplicationSecurityFailure(error: unknown): SafeApplicationSecurityFailure {
  if (error instanceof ApplicationSecurityError) {
    return Object.freeze({
      status: error.status,
      code: error.code,
      retryAfterMs: error.retryAfterMs,
    });
  }
  return Object.freeze({ status: 500, code: "internal_error", retryAfterMs: null });
}

/**
 * Creates a framework-neutral ingress boundary. The HTTP transport must feed
 * received chunks to the collector before it parses JSON or authenticates.
 */
export function createApplicationSecurityGate(options: ApplicationSecurityGateOptions): ApplicationSecurityGate {
  return new ApplicationSecurityGateImplementation(normalizeGateOptions(options));
}

const SECURITY_ERROR_METADATA: Readonly<Record<ApplicationSecurityErrorCode, Readonly<{ status: number; message: string }>>> = Object.freeze({
  invalid_ingress: Object.freeze({ status: 400, message: "Request input was rejected" }),
  header_limit_exceeded: Object.freeze({ status: 431, message: "Request headers were rejected" }),
  request_body_too_large: Object.freeze({ status: 413, message: "Request body was rejected" }),
  rate_limited: Object.freeze({ status: 429, message: "Request rate was rejected" }),
  rate_limiter_capacity: Object.freeze({ status: 429, message: "Request rate was rejected" }),
  request_timed_out: Object.freeze({ status: 408, message: "Request timed out" }),
  request_cancelled: Object.freeze({ status: 408, message: "Request was cancelled" }),
  request_budget_disposed: Object.freeze({ status: 500, message: "Request budget is unavailable" }),
  security_runtime_invalid: Object.freeze({ status: 500, message: "Request security runtime is unavailable" }),
  security_clock_regressed: Object.freeze({ status: 500, message: "Request security runtime is unavailable" }),
});

const HEADER_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const RATE_LABEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const textEncoder = new TextEncoder();

const systemClock: ApplicationSecurityClock = Object.freeze({
  now: () => Date.now(),
});

const systemTimer: ApplicationSecurityTimer = Object.freeze({
  setTimeout: (callback: () => void, delayMs: number): unknown => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle: unknown): void => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
});

interface NormalizedGateOptions {
  readonly requestTimeoutMs: number;
  readonly clock: ApplicationSecurityClock;
  readonly timer: ApplicationSecurityTimer;
}

interface NormalizedIngress {
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
}

interface RateBucket {
  readonly windowStartedAtMs: number;
  readonly requestCount: number;
  readonly lastObservedAtMs: number;
}

class ApplicationSecurityGateImplementation implements ApplicationSecurityGate {
  readonly responseHeaders = API_SECURE_RESPONSE_HEADERS;
  readonly #ingressEntries = new WeakMap<object, NormalizedIngress>();
  readonly #rateBuckets = new Map<string, RateBucket>();
  readonly #options: NormalizedGateOptions;
  #lastObservedAtMs = -1;

  constructor(options: NormalizedGateOptions) {
    this.#options = options;
  }

  createBodyCollector(): BoundedRequestBodyCollector {
    return new BoundedRequestBodyCollectorImplementation(APPLICATION_SECURITY_LIMITS.maxRequestBodyBytes);
  }

  inspectInboundRequest(input: unknown): ValidatedApplicationIngress {
    const record = exactRecord(input, ["headers", "body"], "invalid_ingress");
    const headers = normalizeHeaders(readData(record, "headers", "invalid_ingress"));
    const body = copyBoundedBody(readData(record, "body", "invalid_ingress"), APPLICATION_SECURITY_LIMITS.maxRequestBodyBytes);
    const proof = Object.freeze({}) as ValidatedApplicationIngress;
    this.#ingressEntries.set(proof, Object.freeze({ headers, body }));
    return proof;
  }

  readInboundHeaders(input: ValidatedApplicationIngress): Readonly<Record<string, string>> {
    return Object.freeze({ ...this.#ingressEntry(input).headers });
  }

  readInboundBody(input: ValidatedApplicationIngress): Uint8Array {
    return this.#ingressEntry(input).body.slice();
  }

  admitAuthenticatedRequest(input: AuthenticatedRequestAdmission): RequestBudget {
    const admission = normalizeAdmission(input);
    const now = this.#now();
    this.#consumeRate(admission, now);
    return new RequestBudgetImplementation({
      clock: this.#options.clock,
      timer: this.#options.timer,
      timeoutMs: this.#options.requestTimeoutMs,
      startedAtMs: now,
      ...(admission.cancellationSignal === undefined ? {} : { cancellationSignal: admission.cancellationSignal }),
    });
  }

  #ingressEntry(input: ValidatedApplicationIngress): NormalizedIngress {
    if (input === null || typeof input !== "object") throw new ApplicationSecurityError("invalid_ingress");
    const entry = this.#ingressEntries.get(input);
    if (entry === undefined) throw new ApplicationSecurityError("invalid_ingress");
    return entry;
  }

  #now(): number {
    let current: number;
    try {
      current = this.#options.clock.now();
    } catch {
      throw new ApplicationSecurityError("security_runtime_invalid");
    }
    if (!Number.isSafeInteger(current) || current < 0) throw new ApplicationSecurityError("security_runtime_invalid");
    if (current < this.#lastObservedAtMs) throw new ApplicationSecurityError("security_clock_regressed");
    this.#lastObservedAtMs = current;
    return current;
  }

  #consumeRate(admission: NormalizedAdmission, now: number): void {
    const key = rateBucketKey(admission);
    const existing = this.#rateBuckets.get(key);
    if (existing === undefined) {
      this.#purgeExpiredBuckets(now);
      if (this.#rateBuckets.size >= APPLICATION_SECURITY_LIMITS.maxRateLimitBuckets) {
        throw new ApplicationSecurityError("rate_limiter_capacity", APPLICATION_SECURITY_LIMITS.rateLimitWindowMs);
      }
      this.#rateBuckets.set(key, Object.freeze({
        windowStartedAtMs: now,
        requestCount: 1,
        lastObservedAtMs: now,
      }));
      return;
    }
    if (now < existing.lastObservedAtMs) throw new ApplicationSecurityError("security_clock_regressed");
    if (now - existing.windowStartedAtMs >= APPLICATION_SECURITY_LIMITS.rateLimitWindowMs) {
      this.#rateBuckets.set(key, Object.freeze({
        windowStartedAtMs: now,
        requestCount: 1,
        lastObservedAtMs: now,
      }));
      return;
    }
    if (existing.requestCount >= APPLICATION_SECURITY_LIMITS.maxRequestsPerWindow) {
      const retryAfterMs = Math.max(1, APPLICATION_SECURITY_LIMITS.rateLimitWindowMs - (now - existing.windowStartedAtMs));
      throw new ApplicationSecurityError("rate_limited", retryAfterMs);
    }
    this.#rateBuckets.set(key, Object.freeze({
      windowStartedAtMs: existing.windowStartedAtMs,
      requestCount: existing.requestCount + 1,
      lastObservedAtMs: now,
    }));
  }

  #purgeExpiredBuckets(now: number): void {
    for (const [key, bucket] of this.#rateBuckets) {
      if (now >= bucket.windowStartedAtMs && now - bucket.windowStartedAtMs >= APPLICATION_SECURITY_LIMITS.rateLimitWindowMs) {
        this.#rateBuckets.delete(key);
      }
    }
  }
}

class BoundedRequestBodyCollectorImplementation implements BoundedRequestBodyCollector {
  readonly #maximumBytes: number;
  readonly #chunks: Uint8Array[] = [];
  #receivedBytes = 0;
  #failed = false;
  #finished = false;

  constructor(maximumBytes: number) {
    this.#maximumBytes = maximumBytes;
  }

  append(chunk: unknown): void {
    if (this.#failed || this.#finished) throw new ApplicationSecurityError("invalid_ingress");
    let copy: Uint8Array;
    try {
      copy = copyBoundedBody(chunk, this.#maximumBytes);
    } catch (error) {
      this.#failClosed();
      throw error;
    }
    const nextLength = this.#receivedBytes + copy.byteLength;
    if (!Number.isSafeInteger(nextLength) || nextLength > this.#maximumBytes) {
      this.#failClosed();
      throw new ApplicationSecurityError("request_body_too_large");
    }
    this.#chunks.push(copy);
    this.#receivedBytes = nextLength;
  }

  finish(): Uint8Array {
    if (this.#failed || this.#finished) throw new ApplicationSecurityError("invalid_ingress");
    this.#finished = true;
    const output = new Uint8Array(this.#receivedBytes);
    let offset = 0;
    for (const chunk of this.#chunks) {
      output.set(chunk, offset);
      offset += chunk.byteLength;
    }
    this.#chunks.length = 0;
    return output;
  }

  #failClosed(): void {
    this.#failed = true;
    this.#chunks.length = 0;
    this.#receivedBytes = 0;
  }
}

interface RequestBudgetInput {
  readonly clock: ApplicationSecurityClock;
  readonly timer: ApplicationSecurityTimer;
  readonly timeoutMs: number;
  readonly startedAtMs: number;
  readonly cancellationSignal?: AbortSignal;
}

class RequestBudgetImplementation implements RequestBudget {
  readonly deadlineAtMs: number;
  readonly timeoutMs: number;
  readonly #clock: ApplicationSecurityClock;
  readonly #timer: ApplicationSecurityTimer;
  readonly #controller = new AbortController();
  readonly #cancellationSignal: AbortSignal | undefined;
  #timerHandle: unknown | null = null;
  #cancellationListener: (() => void) | null = null;
  #abortKind: "timeout" | "cancelled" | null = null;
  #disposed = false;

  constructor(input: RequestBudgetInput) {
    this.#clock = input.clock;
    this.#timer = input.timer;
    this.timeoutMs = input.timeoutMs;
    const deadline = input.startedAtMs + input.timeoutMs;
    if (!Number.isSafeInteger(deadline)) throw new ApplicationSecurityError("security_runtime_invalid");
    this.deadlineAtMs = deadline;
    this.#cancellationSignal = input.cancellationSignal;
    try {
      this.#timerHandle = this.#timer.setTimeout(() => this.#abort("timeout"), this.timeoutMs);
    } catch {
      throw new ApplicationSecurityError("security_runtime_invalid");
    }
    if (this.#cancellationSignal !== undefined) this.#attachCancellationSignal(this.#cancellationSignal);
  }

  get signal(): AbortSignal {
    return this.#controller.signal;
  }

  assertActive(): void {
    if (this.#disposed) throw new ApplicationSecurityError("request_budget_disposed");
    if (!this.signal.aborted && this.#now() >= this.deadlineAtMs) this.#abort("timeout");
    if (this.signal.aborted) throw this.#abortError();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#clearTimer();
    if (this.#cancellationSignal !== undefined && this.#cancellationListener !== null) {
      this.#cancellationSignal.removeEventListener("abort", this.#cancellationListener);
      this.#cancellationListener = null;
    }
  }

  async run<Result>(work: (signal: AbortSignal) => Result | Promise<Result>): Promise<Result> {
    if (typeof work !== "function") throw new ApplicationSecurityError("security_runtime_invalid");
    this.assertActive();
    return new Promise<Result>((resolve, reject) => {
      let settled = false;
      const complete = (completion: () => void) => {
        if (settled) return;
        settled = true;
        this.signal.removeEventListener("abort", onAbort);
        this.dispose();
        completion();
      };
      const onAbort = () => complete(() => reject(this.#abortError()));
      this.signal.addEventListener("abort", onAbort, { once: true });
      Promise.resolve()
        .then(() => {
          this.assertActive();
          return work(this.signal);
        })
        .then(
          (result) => {
            if (settled) return;
            try {
              this.assertActive();
              complete(() => resolve(result));
            } catch (error) {
              complete(() => reject(error));
            }
          },
          (error: unknown) => complete(() => reject(error)),
        );
    });
  }

  #attachCancellationSignal(signal: AbortSignal): void {
    if (signal.aborted) {
      this.#abort("cancelled");
      return;
    }
    const listener = () => this.#abort("cancelled");
    this.#cancellationListener = listener;
    signal.addEventListener("abort", listener, { once: true });
  }

  #abort(kind: "timeout" | "cancelled"): void {
    if (this.signal.aborted || this.#disposed) return;
    this.#abortKind = kind;
    this.#clearTimer();
    this.#controller.abort();
  }

  #clearTimer(): void {
    if (this.#timerHandle === null) return;
    const handle = this.#timerHandle;
    this.#timerHandle = null;
    try {
      this.#timer.clearTimeout(handle);
    } catch {
      // Cleanup must not turn a rejected request into a successful one.
    }
  }

  #now(): number {
    let current: number;
    try {
      current = this.#clock.now();
    } catch {
      throw new ApplicationSecurityError("security_runtime_invalid");
    }
    if (!Number.isSafeInteger(current) || current < 0) throw new ApplicationSecurityError("security_runtime_invalid");
    return current;
  }

  #abortError(): ApplicationSecurityError {
    return new ApplicationSecurityError(this.#abortKind === "cancelled" ? "request_cancelled" : "request_timed_out");
  }
}

interface NormalizedAdmission {
  readonly tenantId: string;
  readonly actorId: string;
  readonly routeId: string;
  readonly cancellationSignal: AbortSignal | undefined;
}

function normalizeGateOptions(value: ApplicationSecurityGateOptions): NormalizedGateOptions {
  const record = exactRecord(value, ["requestTimeoutMs", "clock", "timer"], "security_runtime_invalid", true);
  const timeout = readData(record, "requestTimeoutMs", "security_runtime_invalid");
  if (typeof timeout !== "number" || !Number.isSafeInteger(timeout) || timeout < 100 || timeout > 120_000) {
    throw new ApplicationSecurityError("security_runtime_invalid");
  }
  const clock = hasData(record, "clock") ? normalizeClock(readData(record, "clock", "security_runtime_invalid")) : systemClock;
  const timer = hasData(record, "timer") ? normalizeTimer(readData(record, "timer", "security_runtime_invalid")) : systemTimer;
  return Object.freeze({ requestTimeoutMs: timeout, clock, timer });
}

function normalizeAdmission(value: AuthenticatedRequestAdmission): NormalizedAdmission {
  const record = exactRecord(value, ["tenantId", "actorId", "routeId", "cancellationSignal"], "security_runtime_invalid", true);
  const cancellationSignal = hasData(record, "cancellationSignal")
    ? normalizeAbortSignal(readData(record, "cancellationSignal", "security_runtime_invalid"))
    : undefined;
  return Object.freeze({
    tenantId: normalizeRateLabel(readData(record, "tenantId", "security_runtime_invalid")),
    actorId: normalizeRateLabel(readData(record, "actorId", "security_runtime_invalid")),
    routeId: normalizeRateLabel(readData(record, "routeId", "security_runtime_invalid")),
    cancellationSignal,
  });
}

function normalizeClock(value: unknown): ApplicationSecurityClock {
  if (value === null || typeof value !== "object" || typeof (value as ApplicationSecurityClock).now !== "function") {
    throw new ApplicationSecurityError("security_runtime_invalid");
  }
  return value as ApplicationSecurityClock;
}

function normalizeTimer(value: unknown): ApplicationSecurityTimer {
  if (value === null || typeof value !== "object") throw new ApplicationSecurityError("security_runtime_invalid");
  const timer = value as ApplicationSecurityTimer;
  if (typeof timer.setTimeout !== "function" || typeof timer.clearTimeout !== "function") {
    throw new ApplicationSecurityError("security_runtime_invalid");
  }
  return timer;
}

function normalizeAbortSignal(value: unknown): AbortSignal {
  if (value === null || typeof value !== "object") throw new ApplicationSecurityError("security_runtime_invalid");
  const signal = value as AbortSignal;
  if (typeof signal.aborted !== "boolean" || typeof signal.addEventListener !== "function" || typeof signal.removeEventListener !== "function") {
    throw new ApplicationSecurityError("security_runtime_invalid");
  }
  return signal;
}

function normalizeHeaders(value: unknown): Readonly<Record<string, string>> {
  const record = plainRecord(value, "invalid_ingress");
  let descriptors: Record<string, PropertyDescriptor>;
  try {
    descriptors = Object.getOwnPropertyDescriptors(record);
    if (Object.getOwnPropertySymbols(record).length > 0) throw new Error("symbols are not supported");
  } catch {
    throw new ApplicationSecurityError("invalid_ingress");
  }
  const names = Object.keys(descriptors);
  if (names.length > APPLICATION_SECURITY_LIMITS.maxHeaderCount) throw new ApplicationSecurityError("header_limit_exceeded");
  const normalized: Record<string, string> = {};
  const seen = new Set<string>();
  let totalBytes = 0;
  for (const name of names) {
    const descriptor = descriptors[name];
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
      throw new ApplicationSecurityError("invalid_ingress");
    }
    if (!HEADER_NAME_PATTERN.test(name) || byteLength(name) > APPLICATION_SECURITY_LIMITS.maxHeaderNameBytes) {
      throw new ApplicationSecurityError("header_limit_exceeded");
    }
    if (typeof descriptor.value !== "string" || /[\u0000-\u001F\u007F]/.test(descriptor.value)) {
      throw new ApplicationSecurityError("invalid_ingress");
    }
    if (byteLength(descriptor.value) > APPLICATION_SECURITY_LIMITS.maxHeaderValueBytes) {
      throw new ApplicationSecurityError("header_limit_exceeded");
    }
    const canonicalName = name.toLowerCase();
    if (seen.has(canonicalName)) throw new ApplicationSecurityError("invalid_ingress");
    seen.add(canonicalName);
    totalBytes += byteLength(name) + byteLength(descriptor.value);
    if (!Number.isSafeInteger(totalBytes) || totalBytes > APPLICATION_SECURITY_LIMITS.maxHeaderBytes) {
      throw new ApplicationSecurityError("header_limit_exceeded");
    }
    normalized[canonicalName] = descriptor.value;
  }
  return Object.freeze(normalized);
}

function copyBoundedBody(value: unknown, maximumBytes: number): Uint8Array {
  if (!(value instanceof Uint8Array)) throw new ApplicationSecurityError("invalid_ingress");
  let byteLength: number;
  try {
    byteLength = value.byteLength;
  } catch {
    throw new ApplicationSecurityError("invalid_ingress");
  }
  if (!Number.isSafeInteger(byteLength) || byteLength < 0) throw new ApplicationSecurityError("invalid_ingress");
  if (byteLength > maximumBytes) throw new ApplicationSecurityError("request_body_too_large");
  try {
    return new Uint8Array(value);
  } catch {
    throw new ApplicationSecurityError("invalid_ingress");
  }
}

function exactRecord(
  value: unknown,
  expectedKeys: readonly string[],
  errorCode: ApplicationSecurityErrorCode,
  optionalKeys = false,
): Record<string, unknown> {
  const record = plainRecord(value, errorCode);
  let descriptors: Record<string, PropertyDescriptor>;
  try {
    descriptors = Object.getOwnPropertyDescriptors(record);
    if (Object.getOwnPropertySymbols(record).length > 0) throw new Error("symbols are not supported");
  } catch {
    throw new ApplicationSecurityError(errorCode);
  }
  const keys = Object.keys(descriptors);
  if (keys.some((key) => !expectedKeys.includes(key))) throw new ApplicationSecurityError(errorCode);
  for (const key of expectedKeys) {
    const descriptor = descriptors[key];
    if (descriptor === undefined) {
      if (optionalKeys && isOptionalSecurityKey(key)) continue;
      throw new ApplicationSecurityError(errorCode);
    }
    if (!("value" in descriptor)) throw new ApplicationSecurityError(errorCode);
  }
  return record;
}

function isOptionalSecurityKey(key: string): boolean {
  return key === "clock" || key === "timer" || key === "cancellationSignal";
}

function plainRecord(value: unknown, errorCode: ApplicationSecurityErrorCode): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new ApplicationSecurityError(errorCode);
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new Error("invalid prototype");
  } catch {
    throw new ApplicationSecurityError(errorCode);
  }
  return value as Record<string, unknown>;
}

function readData(record: Record<string, unknown>, key: string, errorCode: ApplicationSecurityErrorCode): unknown {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(record, key);
  } catch {
    throw new ApplicationSecurityError(errorCode);
  }
  if (descriptor === undefined || !("value" in descriptor)) throw new ApplicationSecurityError(errorCode);
  return descriptor.value;
}

function hasData(record: Record<string, unknown>, key: string): boolean {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    return descriptor !== undefined && "value" in descriptor;
  } catch {
    return false;
  }
}

function normalizeRateLabel(value: unknown): string {
  if (typeof value !== "string" || !RATE_LABEL_PATTERN.test(value)) throw new ApplicationSecurityError("security_runtime_invalid");
  return value;
}

function rateBucketKey(value: NormalizedAdmission): string {
  return `${value.tenantId.length}:${value.tenantId}|${value.actorId.length}:${value.actorId}|${value.routeId.length}:${value.routeId}`;
}

function byteLength(value: string): number {
  return textEncoder.encode(value).byteLength;
}
