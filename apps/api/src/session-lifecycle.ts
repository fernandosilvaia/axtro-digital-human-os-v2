import { randomBytes } from "node:crypto";

import { AuthenticationError, TenantAuthorizationError } from "@axtro/auth";
import type { InteractionSessionState } from "@axtro/contracts-ts";
import type { TelemetryRuntime } from "@axtro/observability";
import {
  SessionLifecycleAuthorizationError,
  SessionLifecycleConflictError,
  SessionLifecycleDisclosureDeliveryError,
  SessionLifecycleNotFoundError,
  SessionLifecycleRateLimitError,
  SessionLifecycleValidationError,
  type SessionLifecycleApplication,
} from "@axtro/session-application";
import {
  ApplicationSecurityError,
  toSafeApplicationSecurityFailure,
} from "@axtro/security";

import {
  runAuthenticatedApiTelemetry,
  type ApiSecuredRequest,
  type ApiSecurityPipeline,
} from "./index.js";

export interface SessionLifecycleApiOptions {
  readonly security: ApiSecurityPipeline;
  readonly telemetry: TelemetryRuntime;
  readonly application: SessionLifecycleApplication;
}

export interface SessionLifecycleApiResponse<Body> {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Body;
}

export interface SessionLifecycleProblem {
  readonly type: "https://axtro.local/problems/session-lifecycle-rejected";
  readonly title: "Request rejected";
  readonly status: number;
  readonly detail: string;
  readonly trace_id: string;
}

export interface SessionLifecycleApi {
  createSession(input: unknown): Promise<SessionLifecycleApiResponse<InteractionSessionState | SessionLifecycleProblem>>;
  getSession(input: unknown): Promise<SessionLifecycleApiResponse<InteractionSessionState | SessionLifecycleProblem>>;
  activateSession(input: unknown): Promise<SessionLifecycleApiResponse<InteractionSessionState | SessionLifecycleProblem>>;
  completeSession(input: unknown): Promise<SessionLifecycleApiResponse<InteractionSessionState | SessionLifecycleProblem>>;
  listSessionTimeline(input: unknown): Promise<SessionLifecycleApiResponse<unknown | SessionLifecycleProblem>>;
}

interface EndpointOperationResult<Body> {
  readonly status: number;
  readonly body: Body;
}

interface EndpointContext {
  readonly secured: ApiSecuredRequest;
  readonly trace: Readonly<{ trace_id: string; correlation_id: string }>;
  readonly endpointInput: unknown;
}

/**
 * Framework-neutral implementations of the five M1 lifecycle OpenAPI
 * operations. A future HTTP transport is responsible only for converting wire
 * input to the bounded `{ headers, body }` ingress object and route values.
 */
export function createSessionLifecycleApi(optionsInput: SessionLifecycleApiOptions): SessionLifecycleApi {
  const options = normalizeOptions(optionsInput);
  return Object.freeze({
    async createSession(input: unknown): Promise<SessionLifecycleApiResponse<InteractionSessionState | SessionLifecycleProblem>> {
      return runOperation(options, input, "/v1/sessions", async (context) => {
        const endpoint = endpointRecord(context.endpointInput, ["inbound"]);
        const state = await options.application.createSession(
          context.secured.request,
          parseJsonBody(context.secured.readBody()),
          context.secured.readIdempotencyKey(),
          context.trace,
          commandControl(context.secured),
        );
        return Object.freeze({ status: 201, body: state });
      });
    },

    async getSession(input: unknown): Promise<SessionLifecycleApiResponse<InteractionSessionState | SessionLifecycleProblem>> {
      return runOperation(options, input, "/v1/sessions/:session_id", async (context) => {
        const endpoint = endpointRecord(context.endpointInput, ["inbound", "session_id"]);
        assertEmptyBody(context.secured.readBody());
        const state = options.application.getSession(context.secured.request, endpoint.session_id);
        return Object.freeze({ status: 200, body: state });
      });
    },

    async activateSession(input: unknown): Promise<SessionLifecycleApiResponse<InteractionSessionState | SessionLifecycleProblem>> {
      return runOperation(options, input, "/v1/sessions/:session_id/activate", async (context) => {
        const endpoint = endpointRecord(context.endpointInput, ["inbound", "session_id"]);
        const state = await options.application.activateSession(
          context.secured.request,
          endpoint.session_id,
          parseJsonBody(context.secured.readBody()),
          context.secured.readIdempotencyKey(),
          context.trace,
          commandControl(context.secured),
        );
        return Object.freeze({ status: 200, body: state });
      });
    },

    async completeSession(input: unknown): Promise<SessionLifecycleApiResponse<InteractionSessionState | SessionLifecycleProblem>> {
      return runOperation(options, input, "/v1/sessions/:session_id/complete", async (context) => {
        const endpoint = endpointRecord(context.endpointInput, ["inbound", "session_id"]);
        const state = await options.application.completeSession(
          context.secured.request,
          endpoint.session_id,
          parseJsonBody(context.secured.readBody()),
          context.secured.readIdempotencyKey(),
          context.trace,
          commandControl(context.secured),
        );
        return Object.freeze({ status: 200, body: state });
      });
    },

    async listSessionTimeline(input: unknown): Promise<SessionLifecycleApiResponse<unknown | SessionLifecycleProblem>> {
      return runOperation(options, input, "/v1/sessions/:session_id/timeline", async (context) => {
        const endpoint = endpointRecord(context.endpointInput, ["inbound", "session_id", "query"], true);
        const afterVersion = parseTimelineQuery(endpoint.query);
        assertEmptyBody(context.secured.readBody());
        const page = options.application.listTimeline(context.secured.request, endpoint.session_id, afterVersion);
        return Object.freeze({ status: 200, body: page });
      });
    },
  });
}

async function runOperation<Body>(
  options: Required<SessionLifecycleApiOptions>,
  endpointInput: unknown,
  routeTemplate: string,
  operation: (context: EndpointContext) => Promise<EndpointOperationResult<Body>>,
): Promise<SessionLifecycleApiResponse<Body | SessionLifecycleProblem>> {
  let traceId = newRejectionTraceId();
  try {
    const inbound = inboundFromEndpointInput(endpointInput);
    const result = await options.security.run(inbound, async (secured) => runAuthenticatedApiTelemetry(
      options.telemetry,
      secured.request,
      { routeTemplate },
      async ({ spanContext }) => {
        traceId = spanContext.traceId;
        return operation(Object.freeze({
          secured,
          trace: Object.freeze({ trace_id: spanContext.traceId, correlation_id: spanContext.correlationId }),
          endpointInput,
        }));
      },
    ));
    return successResponse(options.security, traceId, result);
  } catch (error) {
    return problemResponse(options.security, traceId, error);
  }
}

function successResponse<Body>(
  security: ApiSecurityPipeline,
  traceId: string,
  result: EndpointOperationResult<Body>,
): SessionLifecycleApiResponse<Body> {
  return Object.freeze({
    status: result.status,
    headers: Object.freeze({ ...security.responseHeaders, "x-trace-id": traceId }),
    body: result.body,
  });
}

function problemResponse(
  security: ApiSecurityPipeline,
  traceId: string,
  error: unknown,
): SessionLifecycleApiResponse<SessionLifecycleProblem> {
  const status = lifecycleProblemStatus(error);
  const body: SessionLifecycleProblem = Object.freeze({
    type: "https://axtro.local/problems/session-lifecycle-rejected",
    title: "Request rejected",
    status,
    detail: lifecycleProblemDetail(status),
    trace_id: traceId,
  });
  return Object.freeze({
    status,
    headers: Object.freeze({
      ...security.responseHeaders,
      "content-type": "application/problem+json; charset=utf-8",
      "x-trace-id": traceId,
    }),
    body,
  });
}

function lifecycleProblemStatus(error: unknown): number {
  if (error instanceof SessionLifecycleValidationError) return 422;
  if (error instanceof SessionLifecycleNotFoundError) return 404;
  if (error instanceof SessionLifecycleConflictError) return 409;
  if (error instanceof SessionLifecycleAuthorizationError) return 403;
  if (error instanceof SessionLifecycleRateLimitError) return 429;
  if (error instanceof SessionLifecycleDisclosureDeliveryError) return 503;
  if (error instanceof ApplicationSecurityError) return toSafeApplicationSecurityFailure(error).status;
  if (error instanceof AuthenticationError) return 401;
  if (error instanceof TenantAuthorizationError) return 403;
  return 500;
}

function lifecycleProblemDetail(status: number): string {
  if (status === 404) return "Session was not found in the authorized tenant";
  if (status === 409) return "Session command conflicts with authoritative state";
  if (status === 403) return "Session command is not authorized";
  if (status === 401) return "Request authentication failed";
  if (status === 422) return "Session lifecycle request did not match its contract";
  if (status === 429) return "Request exceeded a protected rate limit";
  if (status === 408) return "Request could not complete in the allowed time";
  if (status === 413 || status === 431) return "Request exceeded an application limit";
  if (status === 503) return "Required local delivery capability is unavailable";
  if (status === 400) return "Request did not match the transport contract";
  return "Request was rejected by application controls";
}

function newRejectionTraceId(): string {
  return randomBytes(16).toString("hex");
}

function commandControl(secured: ApiSecuredRequest): Readonly<{ assertActive(): void }> {
  return Object.freeze({ assertActive: () => secured.assertActive() });
}

function inboundFromEndpointInput(value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new SessionLifecycleValidationError();
  let descriptor: PropertyDescriptor | undefined;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new Error();
    descriptor = Object.getOwnPropertyDescriptor(value, "inbound");
  } catch {
    throw new SessionLifecycleValidationError();
  }
  if (descriptor === undefined || !("value" in descriptor)) throw new SessionLifecycleValidationError();
  return descriptor.value;
}

function normalizeOptions(value: SessionLifecycleApiOptions): Required<SessionLifecycleApiOptions> {
  const record = strictRecord(value, ["security", "telemetry", "application"], false);
  const security = record.security;
  const telemetry = record.telemetry;
  const application = record.application;
  if (security === null || typeof security !== "object" || typeof (security as ApiSecurityPipeline).run !== "function") {
    throw new SessionLifecycleValidationError();
  }
  if (telemetry === null || typeof telemetry !== "object" || typeof (telemetry as TelemetryRuntime).startPublicApiTrace !== "function") {
    throw new SessionLifecycleValidationError();
  }
  if (application === null || typeof application !== "object" || typeof (application as SessionLifecycleApplication).createSession !== "function") {
    throw new SessionLifecycleValidationError();
  }
  return Object.freeze({
    security: security as ApiSecurityPipeline,
    telemetry: telemetry as TelemetryRuntime,
    application: application as SessionLifecycleApplication,
  });
}

function endpointRecord(value: unknown, requiredKeys: readonly string[], allowsOptionalQuery = false): Record<string, unknown> {
  const allowedKeys = allowsOptionalQuery ? requiredKeys : requiredKeys;
  const record = strictRecord(value, allowedKeys, allowsOptionalQuery);
  for (const key of requiredKeys) {
    if (allowsOptionalQuery && key === "query" && !(key in record)) continue;
    if (!(key in record)) throw new SessionLifecycleValidationError();
  }
  return record;
}

function parseTimelineQuery(value: unknown): unknown {
  if (value === undefined) return undefined;
  const record = strictRecord(value, ["after_version"], true);
  return record.after_version;
}

function parseJsonBody(bytes: Uint8Array): unknown {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1) throw new SessionLifecycleValidationError();
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new SessionLifecycleValidationError();
  }
}

function assertEmptyBody(bytes: Uint8Array): void {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== 0) throw new SessionLifecycleValidationError();
}

function strictRecord(value: unknown, allowedKeys: readonly string[], optionalKeys: boolean): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new SessionLifecycleValidationError();
  let prototype: object | null;
  let descriptors: Record<string, PropertyDescriptor>;
  try {
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
    if (Object.getOwnPropertySymbols(value).length > 0) throw new Error();
  } catch {
    throw new SessionLifecycleValidationError();
  }
  if (prototype !== Object.prototype && prototype !== null) throw new SessionLifecycleValidationError();
  const keys = Object.keys(descriptors);
  if (keys.some((key) => !allowedKeys.includes(key))) throw new SessionLifecycleValidationError();
  for (const key of allowedKeys) {
    const descriptor = descriptors[key];
    if (descriptor === undefined) {
      if (optionalKeys) continue;
      throw new SessionLifecycleValidationError();
    }
    if (!("value" in descriptor)) throw new SessionLifecycleValidationError();
  }
  return Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]));
}
