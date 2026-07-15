import { randomBytes } from "node:crypto";

import { AuthenticationError, TenantAuthorizationError } from "@axtro/auth";
import type { TelemetryRuntime } from "@axtro/observability";
import {
  ApplicationSecurityError,
  toSafeApplicationSecurityFailure,
} from "@axtro/security";
import {
  TurnDriverAuthorizationError,
  TurnDriverConflictError,
  TurnDriverFastLaneError,
  TurnDriverGenerationCancelledError,
  TurnDriverRateLimitError,
  TurnDriverTimeoutError,
  TurnDriverValidationError,
  type TurnDriver,
} from "@axtro/turns";

import {
  runAuthenticatedApiTelemetry,
  type ApiSecuredRequest,
  type ApiSecurityPipeline,
} from "./index.js";

export interface TurnDriverApiOptions {
  readonly security: ApiSecurityPipeline;
  readonly telemetry: TelemetryRuntime;
  readonly driver: TurnDriver;
}

export interface TurnDriverAcceptedCommand {
  readonly command_id: string;
  readonly status: "accepted";
  readonly trace_id: string;
}

export interface TurnDriverProblem {
  readonly type: "https://axtro.local/problems/turn-driver-rejected";
  readonly title: "Request rejected";
  readonly status: number;
  readonly detail: string;
  readonly trace_id: string;
}

export interface TurnDriverApiResponse<Body> {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Body;
}

export interface TurnDriverApi {
  submitTurn(input: unknown): Promise<TurnDriverApiResponse<TurnDriverAcceptedCommand | TurnDriverProblem>>;
}

interface EndpointContext {
  readonly secured: ApiSecuredRequest;
  readonly trace: Readonly<{ trace_id: string; correlation_id: string }>;
  readonly endpointInput: unknown;
}

/**
 * Thin M1 adapter for the declared textual turn operation. It performs no
 * domain reduction, transcript logging, provider call, or direct action.
 */
export function createTurnDriverApi(optionsInput: TurnDriverApiOptions): TurnDriverApi {
  const options = normalizeOptions(optionsInput);
  return Object.freeze({
    async submitTurn(input: unknown): Promise<TurnDriverApiResponse<TurnDriverAcceptedCommand | TurnDriverProblem>> {
      return runOperation(options, input, "/v1/sessions/:session_id/turns", async (context) => {
        const endpoint = strictRecord(context.endpointInput, ["inbound", "session_id"]);
        const result = await options.driver.submitTurn(
          context.secured.request,
          endpoint.session_id,
          parseJsonBody(context.secured.readBody()),
          context.secured.readIdempotencyKey(),
          context.trace,
          commandControl(context.secured),
        );
        return Object.freeze({
          status: 202,
          body: Object.freeze({
            command_id: result.presenter_event_id,
            status: "accepted" as const,
            trace_id: context.trace.trace_id,
          }),
        });
      });
    },
  } satisfies TurnDriverApi);
}

async function runOperation(
  options: Required<TurnDriverApiOptions>,
  endpointInput: unknown,
  routeTemplate: string,
  operation: (context: EndpointContext) => Promise<Readonly<{ status: number; body: TurnDriverAcceptedCommand }>>,
): Promise<TurnDriverApiResponse<TurnDriverAcceptedCommand | TurnDriverProblem>> {
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
    return Object.freeze({
      status: result.status,
      headers: Object.freeze({ ...options.security.responseHeaders, "x-trace-id": traceId }),
      body: result.body,
    });
  } catch (error) {
    const status = problemStatus(error);
    return Object.freeze({
      status,
      headers: Object.freeze({
        ...options.security.responseHeaders,
        "content-type": "application/problem+json; charset=utf-8",
        "x-trace-id": traceId,
      }),
      body: Object.freeze({
        type: "https://axtro.local/problems/turn-driver-rejected",
        title: "Request rejected",
        status,
        detail: problemDetail(status),
        trace_id: traceId,
      }),
    });
  }
}

function normalizeOptions(value: TurnDriverApiOptions): Required<TurnDriverApiOptions> {
  const record = strictRecord(value, ["security", "telemetry", "driver"]);
  const security = record.security;
  const telemetry = record.telemetry;
  const driver = record.driver;
  if (security === null || typeof security !== "object" || typeof (security as ApiSecurityPipeline).run !== "function") {
    throw new TurnDriverValidationError();
  }
  if (telemetry === null || typeof telemetry !== "object" || typeof (telemetry as TelemetryRuntime).startPublicApiTrace !== "function") {
    throw new TurnDriverValidationError();
  }
  if (driver === null || typeof driver !== "object" || typeof (driver as TurnDriver).submitTurn !== "function") {
    throw new TurnDriverValidationError();
  }
  return Object.freeze({
    security: security as ApiSecurityPipeline,
    telemetry: telemetry as TelemetryRuntime,
    driver: driver as TurnDriver,
  });
}

function inboundFromEndpointInput(value: unknown): unknown {
  return strictRecord(value, ["inbound", "session_id"]).inbound;
}

function parseJsonBody(bytes: Uint8Array): unknown {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1) throw new TurnDriverValidationError();
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new TurnDriverValidationError();
  }
}

function commandControl(secured: ApiSecuredRequest): Readonly<{ assertActive(): void; signal: AbortSignal }> {
  return Object.freeze({ assertActive: () => secured.assertActive(), signal: secured.signal });
}

function strictRecord(value: unknown, requiredKeys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TurnDriverValidationError();
  let descriptors: Record<string, PropertyDescriptor>;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null || Object.getOwnPropertySymbols(value).length > 0) {
      throw new Error();
    }
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    throw new TurnDriverValidationError();
  }
  const keys = Object.keys(descriptors);
  if (keys.some((key) => !requiredKeys.includes(key)) || requiredKeys.some((key) => descriptors[key] === undefined)) {
    throw new TurnDriverValidationError();
  }
  for (const descriptor of Object.values(descriptors)) {
    if (!("value" in descriptor)) throw new TurnDriverValidationError();
  }
  return Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]));
}

function problemStatus(error: unknown): number {
  if (error instanceof TurnDriverValidationError) return 422;
  if (error instanceof TurnDriverAuthorizationError) return 403;
  if (error instanceof TurnDriverConflictError || error instanceof TurnDriverGenerationCancelledError) return 409;
  if (error instanceof TurnDriverRateLimitError) return 429;
  if (error instanceof TurnDriverTimeoutError) return 408;
  if (error instanceof TurnDriverFastLaneError) return 500;
  if (error instanceof ApplicationSecurityError) return toSafeApplicationSecurityFailure(error).status;
  if (error instanceof AuthenticationError) return 401;
  if (error instanceof TenantAuthorizationError) return 403;
  return 500;
}

function problemDetail(status: number): string {
  if (status === 401) return "Request authentication failed";
  if (status === 403) return "Textual turn is not authorized";
  if (status === 408) return "Textual turn exceeded the allowed time";
  if (status === 409) return "Textual turn conflicts with authoritative session state";
  if (status === 413 || status === 431) return "Request exceeded an application limit";
  if (status === 422) return "Textual turn did not match its contract";
  if (status === 429) return "Request exceeded a protected rate limit";
  if (status === 400) return "Request did not match the transport contract";
  return "Textual turn could not be completed";
}

function newRejectionTraceId(): string {
  return randomBytes(16).toString("hex");
}
