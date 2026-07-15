import { createHash } from "node:crypto";

import {
  getAuthorizedTenantContext,
  TenantAuthorizationError,
  type AuthorizedRequestContext,
} from "@axtro/auth";
import { parseSessionId, type SessionId } from "@axtro/domain";
import type { TelemetryRuntime, TelemetrySpan, TelemetryErrorCode } from "@axtro/observability";
import {
  OPERATIONS_CONSOLE_STYLES,
  OperationsConsoleRenderError,
  renderOperationsConsoleDocument,
  renderOperationsConsoleErrorDocument,
  type OperationsConsoleErrorKind,
} from "@axtro/ui";

import {
  OperationsConsoleAuthorizationError,
  OperationsConsoleCapacityError,
  OperationsConsoleIntegrityError,
  OperationsConsoleNotFoundError,
  OperationsConsoleValidationError,
  type OperationsConsoleReadModel,
} from "./operations-console-read-model.js";

export interface OperationsConsoleRouteOptions {
  readonly query: OperationsConsoleReadModel;
  readonly telemetry: TelemetryRuntime;
}

export interface OperationsConsoleRouteResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export interface OperationsConsoleRoute {
  handle(input: unknown): Promise<OperationsConsoleRouteResponse>;
}

export class OperationsConsoleRouteValidationError extends Error {
  constructor() {
    super("Operations console route input is invalid");
    this.name = "OperationsConsoleRouteValidationError";
  }
}

class OperationsConsoleUnauthenticatedError extends Error {}

const ROUTE_TEMPLATE = "/operations/sessions/:session_id" as const;
const STYLE_HASH = createHash("sha256").update(OPERATIONS_CONSOLE_STYLES, "utf8").digest("base64");
const BASE_HEADERS = Object.freeze({
  "cache-control": "private, no-store, max-age=0",
  "content-security-policy": `default-src 'none'; base-uri 'none'; connect-src 'none'; font-src 'none'; form-action 'none'; frame-ancestors 'none'; img-src 'none'; media-src 'none'; object-src 'none'; script-src 'none'; style-src 'sha256-${STYLE_HASH}'`,
  "content-type": "text/html; charset=utf-8",
  "permissions-policy": "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
});

interface NormalizedRouteInput {
  readonly request: AuthorizedRequestContext;
  readonly path: string;
}

interface ParsedPath {
  readonly sessionId: SessionId;
  readonly afterVersion: number;
}

interface ActiveTrace {
  readonly span: TelemetrySpan;
  readonly traceId: string;
  readonly correlationId: string;
}

export function createOperationsConsoleRoute(optionsInput: OperationsConsoleRouteOptions): OperationsConsoleRoute {
  const options = normalizeOptions(optionsInput);
  return Object.freeze({
    async handle(input: unknown): Promise<OperationsConsoleRouteResponse> {
      let trace: ActiveTrace | null = null;
      try {
        const routeInput = normalizeRouteInput(input);
        const tenant = authenticateAndAuthorize(routeInput.request);
        const path = parsePath(routeInput.path);
        trace = startTrace(options.telemetry, tenant.tenantId);
        const model = options.query.read(routeInput.request, path.sessionId, path.afterVersion);
        const body = renderOperationsConsoleDocument(model);
        completeTrace(options.telemetry, trace);
        return response(200, body, trace);
      } catch (error) {
        const failure = classifyFailure(error);
        if (trace !== null) failTrace(options.telemetry, trace, failure);
        return response(
          failure.status,
          renderOperationsConsoleErrorDocument(
            failure.kind,
            failure.includeCorrelation && trace !== null ? trace.correlationId : null,
          ),
          trace,
        );
      }
    },
  });
}

function normalizeOptions(value: OperationsConsoleRouteOptions): OperationsConsoleRouteOptions {
  const record = exactRecord(value, ["query", "telemetry"]);
  const query = readValue(record, "query") as OperationsConsoleReadModel;
  const telemetry = readValue(record, "telemetry") as TelemetryRuntime;
  if (typeof query?.read !== "function"
    || typeof telemetry?.startPublicWebTrace !== "function"
    || typeof telemetry?.startSpan !== "function"
    || typeof telemetry?.log !== "function") throw new OperationsConsoleRouteValidationError();
  return Object.freeze({ query, telemetry });
}

function normalizeRouteInput(value: unknown): NormalizedRouteInput {
  const record = exactRecord(value, ["request_context", "path"]);
  const request = readValue(record, "request_context") as AuthorizedRequestContext;
  const path = readValue(record, "path");
  if (typeof path !== "string" || path.length < 1 || path.length > 500) throw new OperationsConsoleRouteValidationError();
  return Object.freeze({ request, path });
}

function authenticateAndAuthorize(request: AuthorizedRequestContext) {
  try {
    const context = getAuthorizedTenantContext(request);
    if (context.actorType !== "human_operator"
      || !context.grantedScopes.includes("session:read")
      || !context.purposes.includes("essential_processing")) {
      throw new OperationsConsoleAuthorizationError();
    }
    return context;
  } catch (error) {
    if (error instanceof OperationsConsoleAuthorizationError) throw error;
    if (error instanceof TenantAuthorizationError) throw new OperationsConsoleUnauthenticatedError();
    throw new OperationsConsoleUnauthenticatedError();
  }
}

function parsePath(value: string): ParsedPath {
  try {
    if (!value.startsWith("/") || value.startsWith("//") || value.includes("#")) throw new Error();
    const url = new URL(value, "https://operations.axtro.invalid");
    if (url.origin !== "https://operations.axtro.invalid") throw new Error();
    const match = /^\/operations\/sessions\/([0-9a-f-]{36})$/.exec(url.pathname);
    if (match === null) throw new Error();
    const sessionId = parseSessionId(match[1]);
    const keys = [...url.searchParams.keys()];
    if (keys.some((key) => key !== "after") || url.searchParams.getAll("after").length > 1) throw new Error();
    const afterValue = url.searchParams.get("after");
    const afterVersion = afterValue === null ? 0 : parseAfterQuery(afterValue);
    return Object.freeze({ sessionId, afterVersion });
  } catch {
    throw new OperationsConsoleRouteValidationError();
  }
}

function parseAfterQuery(value: string): number {
  if (!/^(?:0|[1-9][0-9]{0,4})$/.test(value)) throw new OperationsConsoleRouteValidationError();
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > 10_000) throw new OperationsConsoleRouteValidationError();
  return parsed;
}

function startTrace(telemetry: TelemetryRuntime, tenantId: string): ActiveTrace {
  const context = telemetry.startPublicWebTrace({ tenantId });
  const span = telemetry.startSpan("web.request", context, {
    component: "operations_console",
    route_template: ROUTE_TEMPLATE,
    operation: "view_operations_session",
  });
  telemetry.log({
    level: "info",
    eventCode: "web.request.started",
    context: span.context,
    classification: "internal",
    attributes: {
      component: "operations_console",
      route_template: ROUTE_TEMPLATE,
      operation: "view_operations_session",
    },
  });
  return Object.freeze({
    span,
    traceId: span.context.traceId,
    correlationId: span.context.correlationId,
  });
}

function completeTrace(telemetry: TelemetryRuntime, trace: ActiveTrace): void {
  trace.span.end({ outcome: "success", attributes: { outcome: "success" } });
  telemetry.log({
    level: "info",
    eventCode: "web.request.completed",
    context: trace.span.context,
    classification: "internal",
    attributes: {
      component: "operations_console",
      route_template: ROUTE_TEMPLATE,
      operation: "view_operations_session",
      outcome: "success",
    },
  });
}

function failTrace(
  telemetry: TelemetryRuntime,
  trace: ActiveTrace,
  failure: FailureDescriptor,
): void {
  const outcome = failure.status === 403 || failure.status === 404 ? "denied" : "failure";
  trace.span.end({ outcome, errorCode: failure.errorCode, attributes: { outcome, error_code: failure.errorCode } });
  telemetry.log({
    level: failure.status >= 500 ? "error" : "warn",
    eventCode: "web.request.failed",
    context: trace.span.context,
    classification: "internal",
    attributes: {
      component: "operations_console",
      route_template: ROUTE_TEMPLATE,
      operation: "view_operations_session",
      outcome,
      error_code: failure.errorCode,
    },
  });
}

interface FailureDescriptor {
  readonly status: number;
  readonly kind: OperationsConsoleErrorKind;
  readonly errorCode: TelemetryErrorCode;
  readonly includeCorrelation: boolean;
}

function classifyFailure(error: unknown): FailureDescriptor {
  if (error instanceof OperationsConsoleUnauthenticatedError) {
    return Object.freeze({ status: 401, kind: "unauthenticated", errorCode: "authentication_failed", includeCorrelation: false });
  }
  if (error instanceof OperationsConsoleAuthorizationError) {
    return Object.freeze({ status: 403, kind: "forbidden", errorCode: "tenant_not_authorized", includeCorrelation: false });
  }
  if (error instanceof OperationsConsoleNotFoundError) {
    return Object.freeze({ status: 404, kind: "not_found", errorCode: "validation_failed", includeCorrelation: false });
  }
  if (error instanceof OperationsConsoleValidationError || error instanceof OperationsConsoleRouteValidationError) {
    return Object.freeze({ status: 400, kind: "invalid_request", errorCode: "validation_failed", includeCorrelation: false });
  }
  if (error instanceof OperationsConsoleCapacityError
    || error instanceof OperationsConsoleIntegrityError
    || error instanceof OperationsConsoleRenderError) {
    return Object.freeze({ status: 503, kind: "unavailable", errorCode: "internal_error", includeCorrelation: true });
  }
  return Object.freeze({ status: 500, kind: "unavailable", errorCode: "internal_error", includeCorrelation: true });
}

function response(status: number, body: string, trace: ActiveTrace | null): OperationsConsoleRouteResponse {
  const headers: Record<string, string> = { ...BASE_HEADERS };
  if (trace !== null) {
    headers["x-trace-id"] = trace.traceId;
    headers["x-correlation-id"] = trace.correlationId;
  }
  return Object.freeze({ status, headers: Object.freeze(headers), body });
}

function exactRecord(value: unknown, expected: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new OperationsConsoleRouteValidationError();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new OperationsConsoleRouteValidationError();
  if (Object.getOwnPropertySymbols(value).length > 0) throw new OperationsConsoleRouteValidationError();
  const names = Object.getOwnPropertyNames(value).sort();
  const keys = [...expected].sort();
  if (names.length !== keys.length || names.some((key, index) => key !== keys[index])) {
    throw new OperationsConsoleRouteValidationError();
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor)) throw new OperationsConsoleRouteValidationError();
  }
  return value as Record<string, unknown>;
}

function readValue(record: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor === undefined || !("value" in descriptor)) throw new OperationsConsoleRouteValidationError();
  return descriptor.value;
}
