import {
  AuthenticationError,
  assertAuthorizedTenantMatch,
  createDevelopmentIdentityVerifier,
  getAuthorizedTenantContext,
  resolveAuthorizedRequestContext,
  withAuthorizedTenantTransaction,
  type AuthorizedRequestContext,
  type AuthorizedTenantTransaction,
  type DevelopmentIdentityRegistration,
  type IdentityVerifier,
  type RequestAuthenticationInput,
  type TenantTransactionRunner,
} from "@axtro/auth";
import type { RuntimeConfig } from "@axtro/config";
import type { TenantId } from "@axtro/domain";
import {
  type ActiveSpanContext,
  type InternalTraceCarrier,
  type TelemetryRuntime,
  type TelemetrySpan,
} from "@axtro/observability";
import {
  APPLICATION_SECURITY_LIMITS,
  createApplicationSecurityGate,
  toSafeApplicationSecurityFailure,
  type ApplicationSecurityClock,
  type ApplicationSecurityTimer,
  type BoundedRequestBodyCollector,
  type RequestBudget,
} from "@axtro/security";

export interface ApiAuthenticationMiddlewareOptions {
  readonly identityVerifier: IdentityVerifier;
  readonly transactionRunner: TenantTransactionRunner;
}

export interface DevelopmentApiAuthenticationMiddlewareOptions {
  readonly config: Pick<RuntimeConfig, "environment" | "dev_auth_enabled">;
  readonly registrations: readonly DevelopmentIdentityRegistration[];
  readonly transactionRunner: TenantTransactionRunner;
}

export interface ApiAuthenticationMiddleware {
  authenticate(headers: unknown): AuthorizedRequestContext;
  runWithTenantTransaction<Result>(
    headers: unknown,
    work: (input: AuthorizedTenantTransaction) => Promise<Result>,
  ): Promise<Result>;
}

/** Explicit M0 limits, kept code-owned until an approved endpoint policy exists. */
export const M0_API_SECURITY_LIMITS = Object.freeze({
  max_request_body_bytes: APPLICATION_SECURITY_LIMITS.maxRequestBodyBytes,
  max_header_count: APPLICATION_SECURITY_LIMITS.maxHeaderCount,
  max_header_name_bytes: APPLICATION_SECURITY_LIMITS.maxHeaderNameBytes,
  max_header_value_bytes: APPLICATION_SECURITY_LIMITS.maxHeaderValueBytes,
  max_header_bytes: APPLICATION_SECURITY_LIMITS.maxHeaderBytes,
  max_requests_per_window: APPLICATION_SECURITY_LIMITS.maxRequestsPerWindow,
  rate_limit_window_ms: APPLICATION_SECURITY_LIMITS.rateLimitWindowMs,
  max_rate_limit_buckets: APPLICATION_SECURITY_LIMITS.maxRateLimitBuckets,
  request_timeout_min_ms: 100,
  request_timeout_max_ms: 120_000,
});

export interface ApiSecurityPipelineOptions extends ApiAuthenticationMiddlewareOptions {
  readonly config: Pick<RuntimeConfig, "request_timeout_ms">;
  readonly clock?: ApplicationSecurityClock;
  readonly timer?: ApplicationSecurityTimer;
}

export interface DevelopmentApiSecurityPipelineOptions {
  readonly config: Pick<RuntimeConfig, "environment" | "dev_auth_enabled" | "request_timeout_ms">;
  readonly registrations: readonly DevelopmentIdentityRegistration[];
  readonly transactionRunner: TenantTransactionRunner;
  readonly clock?: ApplicationSecurityClock;
  readonly timer?: ApplicationSecurityTimer;
}

/** A bounded request handle does not expose raw headers to an application handler. */
export interface ApiSecuredRequest {
  readonly request: AuthorizedRequestContext;
  readonly deadlineAtMs: number;
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
  readBody(): Uint8Array;
  assertActive(): void;
  dispose(): void;
}

export interface ApiSecurityPipeline {
  readonly responseHeaders: Readonly<Record<string, string>>;
  createBodyCollector(): BoundedRequestBodyCollector;
  authorize(input: unknown): ApiSecuredRequest;
  run<Result>(
    input: unknown,
    work: (request: ApiSecuredRequest) => Result | Promise<Result>,
  ): Promise<Result>;
}

/** Matches the existing OpenAPI Problem schema after a trusted trace root exists. */
export interface ApiSecurityProblem {
  readonly type: "https://axtro.local/problems/request-rejected";
  readonly title: "Request rejected";
  readonly status: number;
  readonly detail: string;
  readonly trace_id: string;
}

/** Metadata is server-provided after auth. Public trace headers are not accepted. */
export interface AuthenticatedApiTelemetryInput {
  readonly routeTemplate: unknown;
}

export interface AuthenticatedApiTelemetryContext {
  readonly span: TelemetrySpan;
  readonly spanContext: ActiveSpanContext;
  readonly internalTraceCarrier: InternalTraceCarrier;
}

/**
 * Framework-neutral header extraction. It accepts only plain header records,
 * treats duplicate case-insensitive headers as invalid, and returns no raw
 * header object to application handlers.
 */
export function extractApiAuthenticationInput(headers: unknown): RequestAuthenticationInput {
  try {
    const record = headerRecord(headers);
    return Object.freeze({
      authorization: requiredSingleHeader(record, "authorization"),
      requestedTenantId: requiredSingleHeader(record, "x-tenant-id"),
    });
  } catch {
    throw new AuthenticationError();
  }
}

export function createApiAuthenticationMiddleware(
  options: ApiAuthenticationMiddlewareOptions,
): ApiAuthenticationMiddleware {
  return Object.freeze({
    authenticate(headers: unknown): AuthorizedRequestContext {
      return resolveAuthorizedRequestContext(
        extractApiAuthenticationInput(headers),
        options.identityVerifier,
      );
    },
    async runWithTenantTransaction<Result>(
      headers: unknown,
      work: (input: AuthorizedTenantTransaction) => Promise<Result>,
    ): Promise<Result> {
      const request = resolveAuthorizedRequestContext(
        extractApiAuthenticationInput(headers),
        options.identityVerifier,
      );
      return withAuthorizedTenantTransaction(request, options.transactionRunner, work);
    },
  });
}

/** M0 development-only constructor. It cannot instantiate a production verifier. */
export function createDevelopmentApiAuthenticationMiddleware(
  options: DevelopmentApiAuthenticationMiddlewareOptions,
): ApiAuthenticationMiddleware {
  return createApiAuthenticationMiddleware({
    identityVerifier: createDevelopmentIdentityVerifier(options.config, options.registrations),
    transactionRunner: options.transactionRunner,
  });
}

/**
 * Composes byte and header checks before authentication, then applies the
 * tenant-safe rate bucket and request budget. M1 HTTP routes must use this
 * pipeline instead of accepting raw request data directly.
 */
export function createApiSecurityPipeline(options: ApiSecurityPipelineOptions): ApiSecurityPipeline {
  const securityGate = createApplicationSecurityGate({
    requestTimeoutMs: options.config.request_timeout_ms,
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    ...(options.timer === undefined ? {} : { timer: options.timer }),
  });
  const authentication = createApiAuthenticationMiddleware(options);
  const budgets = new WeakMap<object, RequestBudget>();

  const authorize = (input: unknown): ApiSecuredRequest => {
    const ingress = securityGate.inspectInboundRequest(input);
    const request = authentication.authenticate(securityGate.readInboundHeaders(ingress));
    const tenantContext = getAuthorizedTenantContext(request);
    const budget = securityGate.admitAuthenticatedRequest({
      tenantId: tenantContext.tenantId,
      actorId: tenantContext.actorId,
      routeId: "api.m0",
    });
    const secured = Object.freeze({
      request,
      deadlineAtMs: budget.deadlineAtMs,
      timeoutMs: budget.timeoutMs,
      signal: budget.signal,
      readBody(): Uint8Array {
        budget.assertActive();
        return securityGate.readInboundBody(ingress);
      },
      assertActive(): void {
        budget.assertActive();
      },
      dispose(): void {
        budget.dispose();
      },
    }) as ApiSecuredRequest;
    budgets.set(secured, budget);
    return secured;
  };

  return Object.freeze({
    responseHeaders: securityGate.responseHeaders,
    createBodyCollector(): BoundedRequestBodyCollector {
      return securityGate.createBodyCollector();
    },
    authorize,
    async run<Result>(
      input: unknown,
      work: (request: ApiSecuredRequest) => Result | Promise<Result>,
    ): Promise<Result> {
      const secured = authorize(input);
      const budget = budgets.get(secured);
      if (budget === undefined) throw new AuthenticationError();
      return budget.run(() => work(secured));
    },
  });
}

/** M0 development-only security composition, with the same ingress ordering. */
export function createDevelopmentApiSecurityPipeline(
  options: DevelopmentApiSecurityPipelineOptions,
): ApiSecurityPipeline {
  return createApiSecurityPipeline({
    config: options.config,
    identityVerifier: createDevelopmentIdentityVerifier(options.config, options.registrations),
    transactionRunner: options.transactionRunner,
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    ...(options.timer === undefined ? {} : { timer: options.timer }),
  });
}

/** Build the contract-defined problem document without echoing request input or error text. */
export function toApiSecurityProblem(error: unknown, traceId: unknown): ApiSecurityProblem {
  if (typeof traceId !== "string" || !/^[0-9a-f]{16,64}$/.test(traceId)) {
    throw new AuthenticationError();
  }
  const failure = toSafeApplicationSecurityFailure(error);
  return Object.freeze({
    type: "https://axtro.local/problems/request-rejected",
    title: "Request rejected",
    status: failure.status,
    detail: securityProblemDetail(failure.code),
    trace_id: traceId,
  });
}

/** M1 routes must call this before accepting a tenant ID from path or body. */
export function assertApiResourceTenant(request: AuthorizedRequestContext, tenantId: unknown): TenantId {
  return assertAuthorizedTenantMatch(request, tenantId);
}

/**
 * Starts a new telemetry root only after the authenticated context is present.
 * It intentionally has no public traceparent argument. Internal consumers get
 * a narrow W3C carrier generated from the API span.
 */
export async function runAuthenticatedApiTelemetry<Result>(
  runtime: TelemetryRuntime,
  request: AuthorizedRequestContext,
  input: AuthenticatedApiTelemetryInput,
  work: (context: AuthenticatedApiTelemetryContext) => Promise<Result>,
): Promise<Result> {
  if (runtime === null || typeof runtime !== "object" || typeof runtime.startPublicApiTrace !== "function") {
    throw new AuthenticationError();
  }
  if (typeof work !== "function") throw new AuthenticationError();
  const metadata = apiTelemetryInput(input);
  const tenantId = getAuthorizedTenantContext(request).tenantId;
  const trace = runtime.startPublicApiTrace({ tenantId });
  const span = runtime.startSpan("api.request", trace, { route_template: metadata.routeTemplate });
  runtime.log({
    level: "info",
    eventCode: "api.request.started",
    context: span.context,
    classification: "internal",
    attributes: { route_template: metadata.routeTemplate },
  });
  try {
    const result = await work(Object.freeze({
      span,
      spanContext: span.context,
      internalTraceCarrier: runtime.injectInternalTraceparent(span.context),
    }));
    span.end({ outcome: "success" });
    runtime.log({
      level: "info",
      eventCode: "api.request.completed",
      context: span.context,
      classification: "internal",
      attributes: { route_template: metadata.routeTemplate, outcome: "success" },
    });
    return result;
  } catch (error) {
    span.end({ outcome: "failure", errorCode: "internal_error" });
    runtime.log({
      level: "error",
      eventCode: "api.request.failed",
      context: span.context,
      classification: "internal",
      attributes: { route_template: metadata.routeTemplate, outcome: "failure", error_code: "internal_error" },
    });
    throw error;
  }
}

function headerRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid headers");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new Error("invalid headers");
  return value as Record<string, unknown>;
}

function requiredSingleHeader(headers: Record<string, unknown>, expectedName: string): unknown {
  const descriptors = Object.entries(Object.getOwnPropertyDescriptors(headers));
  const matching = descriptors.filter(([name]) => name.toLowerCase() === expectedName);
  if (matching.length !== 1) throw new Error("invalid headers");
  const descriptor = matching[0]![1];
  if (!("value" in descriptor)) throw new Error("invalid headers");
  return descriptor.value;
}

function apiTelemetryInput(value: AuthenticatedApiTelemetryInput): Readonly<{ routeTemplate: unknown }> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new AuthenticationError();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new AuthenticationError();
  const record = value as unknown as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.some((key) => key !== "routeTemplate") || !Object.prototype.hasOwnProperty.call(record, "routeTemplate")) {
    throw new AuthenticationError();
  }
  const routeDescriptor = Object.getOwnPropertyDescriptor(record, "routeTemplate");
  if (routeDescriptor === undefined || !("value" in routeDescriptor)) throw new AuthenticationError();
  return Object.freeze({
    routeTemplate: routeDescriptor.value,
  });
}

function securityProblemDetail(code: string): string {
  if (code === "rate_limited" || code === "rate_limiter_capacity") return "Request exceeded a protected rate limit";
  if (code === "request_timed_out" || code === "request_cancelled") return "Request could not complete in the allowed time";
  if (code === "request_body_too_large" || code === "header_limit_exceeded") return "Request exceeded an application limit";
  return "Request was rejected by application security controls";
}
