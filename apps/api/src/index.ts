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
