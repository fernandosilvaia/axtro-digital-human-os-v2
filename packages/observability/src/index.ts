import { createHash, randomBytes } from "node:crypto";

import {
  createUuidV7,
  parseCorrelationId,
  parseDataClassification,
  parseSessionId,
  parseTenantId,
  type CorrelationId,
  type DataClassification,
  type SessionId,
  type TenantId,
} from "@axtro/domain";
import { REDACTED_VALUE, redactForLog } from "@axtro/security";

declare const traceIdBrand: unique symbol;
declare const spanIdBrand: unique symbol;

/** Strict W3C trace identifier, intentionally narrower than the domain trace field. */
export type TraceId = string & { readonly [traceIdBrand]: "TraceId" };
/** Strict W3C span identifier. */
export type SpanId = string & { readonly [spanIdBrand]: "SpanId" };

export const TELEMETRY_SCHEMA_VERSION = "1.0.0" as const;

export const TELEMETRY_SERVICE_NAMES = [
  "api",
  "realtime-worker",
  "provider-fake",
  "workflow-worker",
  "meeting-bot-worker",
  "axtro-supervisor",
  "event-relay",
] as const;
export type TelemetryServiceName = (typeof TELEMETRY_SERVICE_NAMES)[number];

export const TELEMETRY_SPAN_NAMES = [
  "api.request",
  "api.authentication",
  "session.command",
  "session.reduce",
  "worker.turn",
  "context.compose",
  "model.request",
  "model.first_output",
  "tts.request",
  "tts.first_audio",
  "avatar.publish",
  "channel.publish",
  "provider.request",
  "provider.fake.request",
  "action.evaluate",
  "action.execute",
  "outbox.relay",
  "workflow.run",
] as const;
export type TelemetrySpanName = (typeof TELEMETRY_SPAN_NAMES)[number];

export const TELEMETRY_EVENT_CODES = [
  "api.request.started",
  "api.request.completed",
  "api.request.failed",
  "worker.turn.started",
  "worker.turn.completed",
  "worker.turn.failed",
  "provider.fake.request.started",
  "provider.fake.request.completed",
  "provider.fake.request.failed",
  "outbox.relay.started",
  "outbox.relay.completed",
  "outbox.relay.failed",
  "workflow.run.started",
  "workflow.run.checkpointed",
  "workflow.run.retry_scheduled",
  "workflow.run.cancelled",
  "workflow.run.completed",
  "workflow.run.failed",
  "security.telemetry.rejected",
] as const;
export type TelemetryEventCode = (typeof TELEMETRY_EVENT_CODES)[number];

export type TelemetryLogLevel = "debug" | "info" | "warn" | "error";
export type TelemetryOutcome = "success" | "failure" | "cancelled" | "timeout" | "denied";
export const TELEMETRY_ERROR_CODES = [
  "internal_error",
  "authentication_failed",
  "tenant_not_authorized",
  "validation_failed",
  "policy_denied",
  "rate_limited",
  "timeout",
  "cancelled",
  "provider_unavailable",
] as const;
export type TelemetryErrorCode = (typeof TELEMETRY_ERROR_CODES)[number];
export type TelemetryAttributeValue = string | number | boolean;
export type TelemetryAttributes = Readonly<Record<string, TelemetryAttributeValue>>;

export interface TelemetryContext {
  readonly serviceName: TelemetryServiceName;
  readonly tenantId: TenantId;
  readonly sessionId: SessionId | null;
  readonly traceId: TraceId;
  readonly traceFlags: string;
  readonly correlationId: CorrelationId;
  readonly causationId: CorrelationId | null;
  readonly parentSpanId: SpanId | null;
}

export interface ActiveSpanContext extends TelemetryContext {
  readonly spanId: SpanId;
}

/** The only carrier supported in M0. It deliberately excludes baggage and tenant data. */
export interface InternalTraceCarrier {
  readonly traceparent: string;
}

export interface PublicApiTraceInput {
  readonly tenantId: unknown;
}

/** Values come from a validated internal event or service call, never an HTTP header. */
export interface TrustedInternalTraceInput {
  readonly serviceName: unknown;
  readonly tenantId: unknown;
  readonly sessionId: unknown;
  readonly correlationId: unknown;
  readonly causationId: unknown;
}

/** Correlation already validated on a canonical internal event. */
export interface TrustedEventTraceInput extends TrustedInternalTraceInput {
  readonly traceId: unknown;
}

export interface FakeProviderTelemetryInput {
  readonly carrier: unknown;
  readonly tenantId: unknown;
  readonly sessionId: unknown;
  readonly correlationId: unknown;
  readonly causationId: unknown;
  readonly provider: unknown;
}

export interface TelemetryIdGenerator {
  createTraceId(): unknown;
  createSpanId(): unknown;
  createCorrelationId(): unknown;
}

export interface TelemetrySpan {
  readonly name: TelemetrySpanName;
  readonly context: ActiveSpanContext;
  end(input?: SpanEndInput): void;
}

export interface SpanEndInput {
  readonly outcome?: unknown;
  readonly errorCode?: unknown;
  readonly attributes?: unknown;
}

export interface TelemetrySpanRecord {
  readonly schema_version: typeof TELEMETRY_SCHEMA_VERSION;
  readonly name: TelemetrySpanName;
  readonly service_name: TelemetryServiceName;
  readonly tenant_id: TenantId;
  readonly session_id: SessionId | null;
  readonly trace_id: TraceId;
  readonly trace_flags: string;
  readonly span_id: SpanId;
  readonly parent_span_id: SpanId | null;
  readonly correlation_id: CorrelationId;
  readonly causation_id: CorrelationId | null;
  readonly started_at: string;
  readonly ended_at: string;
  readonly duration_ms: number;
  readonly outcome: TelemetryOutcome;
  readonly error_code: TelemetryErrorCode | null;
  readonly attributes: TelemetryAttributes;
}

export interface StructuredLogInput {
  readonly level: unknown;
  readonly eventCode: unknown;
  readonly context: unknown;
  readonly classification: unknown;
  readonly attributes?: unknown;
}

export interface StructuredLogRecord {
  readonly schema_version: typeof TELEMETRY_SCHEMA_VERSION;
  readonly timestamp: string;
  readonly level: TelemetryLogLevel;
  readonly event_code: TelemetryEventCode;
  readonly service_name: TelemetryServiceName;
  readonly tenant_id: TenantId;
  readonly session_id: SessionId | null;
  readonly trace_id: TraceId;
  readonly span_id: SpanId;
  readonly correlation_id: CorrelationId;
  readonly causation_id: CorrelationId | null;
  readonly data_classification: DataClassification;
  readonly payload_omitted: boolean;
  readonly attributes: TelemetryAttributes;
}

export interface TelemetrySink {
  emitSpan(record: TelemetrySpanRecord): void;
  emitLog(record: StructuredLogRecord): void;
}

export interface TelemetryRuntimeOptions {
  readonly sink?: TelemetrySink;
  readonly clock?: () => number;
  readonly idGenerator?: TelemetryIdGenerator;
  readonly minimumLogLevel?: TelemetryLogLevel;
  readonly secretValues?: readonly string[];
}

export class TelemetryValidationError extends Error {
  constructor() {
    super("Telemetry input is invalid");
    this.name = "TelemetryValidationError";
  }
}

const TRACE_ID_PATTERN = /^[0-9a-f]{32}$/;
const CANONICAL_EVENT_TRACE_ID_PATTERN = /^[0-9a-f]{16,64}$/;
const EVENT_TRACE_DERIVATION_DOMAIN = "axtro-event-trace-v1:";
const SPAN_ID_PATTERN = /^[0-9a-f]{16}$/;
const TRACE_FLAGS_PATTERN = /^[0-9a-f]{2}$/;
const W3C_TRACEPARENT_PATTERN = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;
const ZERO_TRACE_ID = "0".repeat(32);
const ZERO_SPAN_ID = "0".repeat(16);
const ATTRIBUTE_KEYS = [
  "component",
  "route_template",
  "provider",
  "provider_request_ref",
  "model_version",
  "capability_mode",
  "outcome",
  "error_code",
  "duration_ms",
  "attempt",
  "retry_count",
  "queue_depth",
  "operation",
  "status",
  "step",
] as const;
type TelemetryAttributeKey = (typeof ATTRIBUTE_KEYS)[number];
type NumericTelemetryAttributeKey = "duration_ms" | "attempt" | "retry_count" | "queue_depth";
type EnumeratedTelemetryAttributeKey = Exclude<TelemetryAttributeKey, NumericTelemetryAttributeKey | "provider_request_ref">;

const NUMERIC_ATTRIBUTE_KEYS = [
  "duration_ms",
  "attempt",
  "retry_count",
  "queue_depth",
] as const;
const LOCAL_PROVIDER_REFERENCE_PATTERN = /^local-[0-9a-f]{16}$/;
const ATTRIBUTE_VALUE_REGISTRY: Readonly<Record<EnumeratedTelemetryAttributeKey, readonly string[]>> = Object.freeze({
  component: [
    "api",
    "authentication",
    "turn_coordinator",
    "realtime_worker",
    "provider_fake",
    "outbox_relay",
    "workflow_worker",
    "action_runtime",
  ],
  route_template: [
    "/v1/sessions",
    "/v1/sessions/:session_id",
    "/v1/sessions/:session_id/activate",
    "/v1/sessions/:session_id/turns",
    "/v1/sessions/:session_id/action-intents",
    "/v1/sessions/:session_id/handoffs",
    "/v1/sessions/:session_id/complete",
    "/v1/sessions/:session_id/timeline",
    "/v1/role-pack-installations",
    "/v1/provider-connections",
    "/v1/usage/cost-events",
  ],
  provider: [
    "local-model-fake",
    "local-stt-fake",
    "local-tts-fake",
    "local-avatar-fake",
    "local-meeting-fake",
    "local-tool-fake",
  ],
  model_version: ["fake-v1"],
  capability_mode: ["fake", "modular", "s2s"],
  outcome: ["success", "failure", "cancelled", "timeout", "denied"],
  error_code: TELEMETRY_ERROR_CODES,
  operation: [
    "create_session",
    "activate_session",
    "submit_turn",
    "complete_session",
    "relay_event",
    "run_workflow_step",
    "evaluate_action",
    "execute_action",
  ],
  status: [
    "accepted",
    "queued",
    "running",
    "waiting",
    "checkpointed",
    "completed",
    "failed",
    "pending",
    "cancelled",
    "degraded",
    "published",
    "retry_scheduled",
    "dead_letter",
  ],
  step: [
    "generate_summary",
    "evaluate",
    "record_follow_up_guard",
    "finalize",
  ],
});
const DEVELOPMENT_BEARER_PATTERN = /(?:^|[^a-z0-9])dev_[a-z0-9][a-z0-9._-]{7,127}(?:$|[^a-z0-9])/i;
const EMAIL_PATTERN = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const PHONE_PATTERN = /(?:\+?\d[\s().-]?){8,}/;
const CPF_CNPJ_PATTERN = /\b\d{3}[.\s-]?\d{3}[.\s-]?\d{3}[\s-]?\d{2}\b|\b\d{2}[.\s-]?\d{3}[.\s-]?\d{3}[\/\s-]?\d{4}[\s-]?\d{2}\b/;
const SECRET_REFERENCE_PATTERN = /secret:\/\//i;
const LOG_LEVEL_PRIORITY: Readonly<Record<TelemetryLogLevel, number>> = Object.freeze({
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
});

const NOOP_SINK: TelemetrySink = Object.freeze({
  emitSpan() {},
  emitLog() {},
});

const DEFAULT_ID_GENERATOR: TelemetryIdGenerator = Object.freeze({
  createTraceId: () => randomBytes(16).toString("hex"),
  createSpanId: () => randomBytes(8).toString("hex"),
  createCorrelationId: () => createUuidV7(),
});

/** Deterministic test sink. Production callers inject their own backend adapter later. */
export class InMemoryTelemetrySink implements TelemetrySink {
  readonly spans: TelemetrySpanRecord[] = [];
  readonly logs: StructuredLogRecord[] = [];

  emitSpan(record: TelemetrySpanRecord): void {
    this.spans.push(record);
  }

  emitLog(record: StructuredLogRecord): void {
    this.logs.push(record);
  }
}

/**
 * M0 telemetry runtime. It has no global state, automatic instrumentation,
 * network exporter, or public trace-header parser.
 */
export class TelemetryRuntime {
  readonly #sink: TelemetrySink;
  readonly #clock: () => number;
  readonly #idGenerator: TelemetryIdGenerator;
  readonly #minimumLogLevel: TelemetryLogLevel;
  readonly #secretValues: readonly string[];
  #spanEmissionFailures = 0;
  #logEmissionFailures = 0;

  constructor(options: TelemetryRuntimeOptions = {}) {
    this.#sink = options.sink ?? NOOP_SINK;
    this.#clock = options.clock ?? Date.now;
    this.#idGenerator = options.idGenerator ?? DEFAULT_ID_GENERATOR;
    this.#minimumLogLevel = options.minimumLogLevel ?? "info";
    this.#secretValues = normalizeSecretValues(options.secretValues ?? []);
    if (!isTelemetrySink(this.#sink) || typeof this.#clock !== "function" || !isIdGenerator(this.#idGenerator)) {
      throw new TelemetryValidationError();
    }
    if (!isLogLevel(this.#minimumLogLevel)) throw new TelemetryValidationError();
  }

  /** Public API calls always become a server-minted root trace. */
  startPublicApiTrace(input: PublicApiTraceInput): TelemetryContext {
    const record = plainRecord(input);
    assertAllowedKeys(record, ["tenantId"]);
    const tenantId = parseTenant(readRequired(record, "tenantId"));
    return freezeContext({
      serviceName: "api",
      tenantId,
      sessionId: null,
      traceId: this.#newTraceId(),
      traceFlags: "01",
      correlationId: this.#newCorrelationId(),
      causationId: null,
      parentSpanId: null,
    });
  }

  /** Counters retain backend failures without letting telemetry alter business execution. */
  get emissionFailureCounts(): Readonly<{ span: number; log: number }> {
    return Object.freeze({ span: this.#spanEmissionFailures, log: this.#logEmissionFailures });
  }

  /** Continue only a trace that arrived through a validated internal boundary. */
  continueTrustedInternalTrace(input: TrustedInternalTraceInput, carrier: unknown): TelemetryContext {
    const trusted = normalizeTrustedInternalInput(input);
    const parent = parseInternalTraceCarrier(carrier);
    return freezeContext({
      ...trusted,
      traceId: parent.traceId,
      traceFlags: parent.traceFlags,
      parentSpanId: parent.parentSpanId,
    });
  }

  /** Continue a canonical event trace, deriving a stable W3C ID for legacy 16..64 hex values. */
  startTrustedEventTrace(input: TrustedEventTraceInput): TelemetryContext {
    const trusted = normalizeTrustedEventTraceInput(input);
    return freezeContext({
      ...trusted,
      traceFlags: "01",
      parentSpanId: null,
    });
  }

  /** Emit only the standard W3C field to an internal consumer. */
  injectInternalTraceparent(context: ActiveSpanContext): InternalTraceCarrier {
    const active = normalizeActiveSpanContext(context);
    return Object.freeze({ traceparent: `00-${active.traceId}-${active.spanId}-${active.traceFlags}` });
  }

  startSpan(name: TelemetrySpanName, context: TelemetryContext, attributes: unknown = {}): TelemetrySpan {
    const normalizedName = parseSpanName(name);
    const normalizedContext = normalizeTelemetryContext(context);
    const normalizedAttributes = normalizeAttributes(attributes, this.#secretValues);
    const startedAt = timestamp(this.#clock());
    const activeContext = freezeActiveSpanContext({
      ...normalizedContext,
      spanId: this.#newSpanId(),
    });
    return new ManagedTelemetrySpan(
      normalizedName,
      activeContext,
      normalizedAttributes,
      startedAt,
      this.#secretValues,
      (spanName, active, initialAttributes, start, endInput) => {
        const endedAt = timestamp(this.#clock());
        const finalAttributes = mergeAttributes(initialAttributes, endInput.attributes);
        const record = Object.freeze({
          schema_version: TELEMETRY_SCHEMA_VERSION,
          name: spanName,
          service_name: active.serviceName,
          tenant_id: active.tenantId,
          session_id: active.sessionId,
          trace_id: active.traceId,
          trace_flags: active.traceFlags,
          span_id: active.spanId,
          parent_span_id: active.parentSpanId,
          correlation_id: active.correlationId,
          causation_id: active.causationId,
          started_at: start.iso,
          ended_at: endedAt.iso,
          duration_ms: Math.max(0, endedAt.milliseconds - start.milliseconds),
          outcome: endInput.outcome,
          error_code: endInput.errorCode,
          attributes: finalAttributes,
        } satisfies TelemetrySpanRecord);
        this.#emitSpan(record);
      },
    );
  }

  async runWithSpan<Result>(
    name: TelemetrySpanName,
    context: TelemetryContext,
    work: (span: TelemetrySpan) => Promise<Result>,
    attributes: unknown = {},
  ): Promise<Result> {
    if (typeof work !== "function") throw new TelemetryValidationError();
    const span = this.startSpan(name, context, attributes);
    try {
      const result = await work(span);
      span.end({ outcome: "success" });
      return result;
    } catch (error) {
      span.end({ outcome: "failure", errorCode: "internal_error" });
      throw error;
    }
  }

  log(input: StructuredLogInput): StructuredLogRecord | null {
    const normalized = normalizeStructuredLogInput(input, this.#secretValues);
    if (LOG_LEVEL_PRIORITY[normalized.level] < LOG_LEVEL_PRIORITY[this.#minimumLogLevel]) return null;
    const current = timestamp(this.#clock());
    const record = Object.freeze({
      schema_version: TELEMETRY_SCHEMA_VERSION,
      timestamp: current.iso,
      level: normalized.level,
      event_code: normalized.eventCode,
      service_name: normalized.context.serviceName,
      tenant_id: normalized.context.tenantId,
      session_id: normalized.context.sessionId,
      trace_id: normalized.context.traceId,
      span_id: normalized.context.spanId,
      correlation_id: normalized.context.correlationId,
      causation_id: normalized.context.causationId,
      data_classification: normalized.classification,
      payload_omitted: normalized.classification === "restricted",
      attributes: normalized.attributes,
    } satisfies StructuredLogRecord);
    this.#emitLog(record);
    return record;
  }

  /** Generic boundary wrapper for M0 deterministic provider fakes. */
  async runWithFakeProviderTelemetry<Result>(
    input: FakeProviderTelemetryInput,
    work: (carrier: InternalTraceCarrier) => Promise<Result>,
  ): Promise<Result> {
    if (typeof work !== "function") throw new TelemetryValidationError();
    const record = plainRecord(input);
    assertAllowedKeys(
      record,
      ["carrier", "tenantId", "sessionId", "correlationId", "causationId", "provider"],
    );
    const context = this.continueTrustedInternalTrace({
      serviceName: "provider-fake",
      tenantId: readRequired(record, "tenantId"),
      sessionId: readRequired(record, "sessionId"),
      correlationId: readRequired(record, "correlationId"),
      causationId: readRequired(record, "causationId"),
    }, readRequired(record, "carrier"));
    const provider = readRequired(record, "provider");
    const attributes: Record<string, unknown> = { provider };
    const span = this.startSpan("provider.fake.request", context, attributes);
    const providerRequestRef = `local-${span.context.spanId}`;
    this.log({
      level: "info",
      eventCode: "provider.fake.request.started",
      context: span.context,
      classification: "internal",
      attributes: { provider, provider_request_ref: providerRequestRef },
    });
    try {
      const result = await work(this.injectInternalTraceparent(span.context));
      span.end({ outcome: "success", attributes: { provider_request_ref: providerRequestRef } });
      this.log({
        level: "info",
        eventCode: "provider.fake.request.completed",
        context: span.context,
        classification: "internal",
        attributes: { provider, provider_request_ref: providerRequestRef, outcome: "success" },
      });
      return result;
    } catch (error) {
      span.end({
        outcome: "failure",
        errorCode: "internal_error",
        attributes: { provider_request_ref: providerRequestRef },
      });
      this.log({
        level: "error",
        eventCode: "provider.fake.request.failed",
        context: span.context,
        classification: "internal",
        attributes: { provider, provider_request_ref: providerRequestRef, outcome: "failure", error_code: "internal_error" },
      });
      throw error;
    }
  }

  #newTraceId(): TraceId {
    try {
      return parseTraceId(this.#idGenerator.createTraceId());
    } catch {
      throw new TelemetryValidationError();
    }
  }

  #newSpanId(): SpanId {
    try {
      return parseSpanId(this.#idGenerator.createSpanId());
    } catch {
      throw new TelemetryValidationError();
    }
  }

  #newCorrelationId(): CorrelationId {
    try {
      return parseCorrelationId(this.#idGenerator.createCorrelationId());
    } catch {
      throw new TelemetryValidationError();
    }
  }

  #emitSpan(record: TelemetrySpanRecord): void {
    try {
      this.#sink.emitSpan(record);
    } catch {
      this.#spanEmissionFailures += 1;
    }
  }

  #emitLog(record: StructuredLogRecord): void {
    try {
      this.#sink.emitLog(record);
    } catch {
      this.#logEmissionFailures += 1;
    }
  }
}

export function createTelemetryRuntime(options: TelemetryRuntimeOptions = {}): TelemetryRuntime {
  return new TelemetryRuntime(options);
}

export function parseTraceId(value: unknown): TraceId {
  if (typeof value !== "string" || !TRACE_ID_PATTERN.test(value) || value === ZERO_TRACE_ID) {
    throw new TelemetryValidationError();
  }
  return value as TraceId;
}

export function parseSpanId(value: unknown): SpanId {
  if (typeof value !== "string" || !SPAN_ID_PATTERN.test(value) || value === ZERO_SPAN_ID) {
    throw new TelemetryValidationError();
  }
  return value as SpanId;
}

function parseTraceFlags(value: unknown): string {
  if (typeof value !== "string" || !TRACE_FLAGS_PATTERN.test(value)) throw new TelemetryValidationError();
  return value;
}

/** Parse the M0 W3C profile for trusted internal carriers only. */
export function parseInternalTraceCarrier(value: unknown): Readonly<{ traceId: TraceId; parentSpanId: SpanId; traceFlags: string }> {
  const record = plainRecord(value);
  assertAllowedKeys(record, ["traceparent"]);
  const traceparent = readRequired(record, "traceparent");
  if (typeof traceparent !== "string") throw new TelemetryValidationError();
  const match = W3C_TRACEPARENT_PATTERN.exec(traceparent);
  if (match === null || !TRACE_FLAGS_PATTERN.test(match[3]!)) throw new TelemetryValidationError();
  return Object.freeze({
    traceId: parseTraceId(match[1]),
    parentSpanId: parseSpanId(match[2]),
    traceFlags: match[3]!,
  });
}

class ManagedTelemetrySpan implements TelemetrySpan {
  readonly #finish: (
    name: TelemetrySpanName,
    context: ActiveSpanContext,
    initialAttributes: TelemetryAttributes,
    startedAt: Timestamp,
    endInput: NormalizedSpanEndInput,
  ) => void;
  readonly #initialAttributes: TelemetryAttributes;
  readonly #startedAt: Timestamp;
  readonly #secretValues: readonly string[];
  #ended = false;

  constructor(
    readonly name: TelemetrySpanName,
    readonly context: ActiveSpanContext,
    initialAttributes: TelemetryAttributes,
    startedAt: Timestamp,
    secretValues: readonly string[],
    finish: (
      name: TelemetrySpanName,
      context: ActiveSpanContext,
      initialAttributes: TelemetryAttributes,
      startedAt: Timestamp,
      endInput: NormalizedSpanEndInput,
    ) => void,
  ) {
    this.#initialAttributes = initialAttributes;
    this.#startedAt = startedAt;
    this.#secretValues = secretValues;
    this.#finish = finish;
  }

  end(input: SpanEndInput = {}): void {
    if (this.#ended) throw new TelemetryValidationError();
    const normalized = normalizeSpanEndInput(input, this.#secretValues);
    this.#ended = true;
    this.#finish(this.name, this.context, this.#initialAttributes, this.#startedAt, normalized);
  }
}

interface Timestamp {
  readonly milliseconds: number;
  readonly iso: string;
}

interface NormalizedSpanEndInput {
  readonly outcome: TelemetryOutcome;
  readonly errorCode: TelemetryErrorCode | null;
  readonly attributes: TelemetryAttributes;
}

interface NormalizedStructuredLogInput {
  readonly level: TelemetryLogLevel;
  readonly eventCode: TelemetryEventCode;
  readonly context: ActiveSpanContext;
  readonly classification: DataClassification;
  readonly attributes: TelemetryAttributes;
}

function normalizeTrustedInternalInput(value: unknown): Omit<TelemetryContext, "traceId" | "traceFlags" | "parentSpanId"> {
  const record = plainRecord(value);
  assertAllowedKeys(record, ["serviceName", "tenantId", "sessionId", "correlationId", "causationId"]);
  return Object.freeze({
    serviceName: parseServiceName(readRequired(record, "serviceName")),
    tenantId: parseTenant(readRequired(record, "tenantId")),
    sessionId: parseNullableSession(readRequired(record, "sessionId")),
    correlationId: parseCorrelation(readRequired(record, "correlationId")),
    causationId: parseNullableCorrelation(readRequired(record, "causationId")),
  });
}

function normalizeTrustedEventTraceInput(
  value: unknown,
): Omit<TelemetryContext, "traceFlags" | "parentSpanId"> {
  const record = plainRecord(value);
  assertAllowedKeys(record, ["serviceName", "tenantId", "sessionId", "correlationId", "causationId", "traceId"]);
  return Object.freeze({
    ...normalizeTrustedInternalInput({
      serviceName: readRequired(record, "serviceName"),
      tenantId: readRequired(record, "tenantId"),
      sessionId: readRequired(record, "sessionId"),
      correlationId: readRequired(record, "correlationId"),
      causationId: readRequired(record, "causationId"),
    }),
    traceId: normalizeCanonicalEventTraceId(readRequired(record, "traceId")),
  });
}

function normalizeCanonicalEventTraceId(value: unknown): TraceId {
  if (typeof value !== "string" || !CANONICAL_EVENT_TRACE_ID_PATTERN.test(value)) {
    throw new TelemetryValidationError();
  }
  if (value.length === 32 && value !== ZERO_TRACE_ID) return parseTraceId(value);
  return parseTraceId(
    createHash("sha256")
      .update(`${EVENT_TRACE_DERIVATION_DOMAIN}${value}`, "utf8")
      .digest("hex")
      .slice(0, 32),
  );
}

function normalizeTelemetryContext(value: unknown): TelemetryContext {
  const record = plainRecord(value);
  assertAllowedKeys(record, ["serviceName", "tenantId", "sessionId", "traceId", "traceFlags", "correlationId", "causationId", "parentSpanId"]);
  return freezeContext({
    serviceName: parseServiceName(readRequired(record, "serviceName")),
    tenantId: parseTenant(readRequired(record, "tenantId")),
    sessionId: parseNullableSession(readRequired(record, "sessionId")),
    traceId: parseTraceId(readRequired(record, "traceId")),
    traceFlags: parseTraceFlags(readRequired(record, "traceFlags")),
    correlationId: parseCorrelation(readRequired(record, "correlationId")),
    causationId: parseNullableCorrelation(readRequired(record, "causationId")),
    parentSpanId: parseNullableSpanId(readRequired(record, "parentSpanId")),
  });
}

function normalizeActiveSpanContext(value: unknown): ActiveSpanContext {
  const record = plainRecord(value);
  assertAllowedKeys(record, ["serviceName", "tenantId", "sessionId", "traceId", "traceFlags", "correlationId", "causationId", "parentSpanId", "spanId"]);
  return freezeActiveSpanContext({
    ...normalizeTelemetryContext({
      serviceName: readRequired(record, "serviceName"),
      tenantId: readRequired(record, "tenantId"),
      sessionId: readRequired(record, "sessionId"),
      traceId: readRequired(record, "traceId"),
      traceFlags: readRequired(record, "traceFlags"),
      correlationId: readRequired(record, "correlationId"),
      causationId: readRequired(record, "causationId"),
      parentSpanId: readRequired(record, "parentSpanId"),
    }),
    spanId: parseSpanId(readRequired(record, "spanId")),
  });
}

function normalizeSpanEndInput(value: unknown, secretValues: readonly string[]): NormalizedSpanEndInput {
  const record = plainRecord(value);
  assertAllowedKeys(record, ["outcome", "errorCode", "attributes"], ["outcome", "errorCode", "attributes"]);
  const outcomeValue = readOptional(record, "outcome");
  const errorCodeValue = readOptional(record, "errorCode");
  const attributesValue = readOptional(record, "attributes");
  return Object.freeze({
    outcome: outcomeValue === undefined ? "success" : parseOutcome(outcomeValue),
    errorCode: errorCodeValue === undefined ? null : parseErrorCode(errorCodeValue),
    attributes: attributesValue === undefined ? Object.freeze({}) : normalizeAttributes(attributesValue, secretValues),
  });
}

function normalizeStructuredLogInput(value: unknown, secretValues: readonly string[]): NormalizedStructuredLogInput {
  const record = plainRecord(value);
  assertAllowedKeys(record, ["level", "eventCode", "context", "classification", "attributes"], ["attributes"]);
  const classification = parseClassification(readRequired(record, "classification"));
  const attributesValue = readOptional(record, "attributes");
  return Object.freeze({
    level: parseLogLevel(readRequired(record, "level")),
    eventCode: parseEventCode(readRequired(record, "eventCode")),
    context: normalizeActiveSpanContext(readRequired(record, "context")),
    classification,
    attributes: classification === "restricted"
      ? Object.freeze({})
      : attributesValue === undefined ? Object.freeze({}) : normalizeAttributes(attributesValue, secretValues),
  });
}

function normalizeAttributes(value: unknown, secretValues: readonly string[]): TelemetryAttributes {
  const record = plainRecord(value);
  const output: Record<string, TelemetryAttributeValue> = {};
  for (const key of Object.keys(record).sort()) {
    if (!isTelemetryAttributeKey(key)) throw new TelemetryValidationError();
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (descriptor === undefined || !("value" in descriptor)) throw new TelemetryValidationError();
    output[key] = normalizeAttributeValue(key, descriptor.value, secretValues);
  }
  return Object.freeze(output);
}

function normalizeAttributeValue(
  key: TelemetryAttributeKey,
  value: unknown,
  secretValues: readonly string[],
): TelemetryAttributeValue {
  if (isNumericTelemetryAttributeKey(key)) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 10_000_000) {
      throw new TelemetryValidationError();
    }
    return value;
  }
  if (typeof value !== "string") throw new TelemetryValidationError();
  if (key === "provider_request_ref") {
    if (!LOCAL_PROVIDER_REFERENCE_PATTERN.test(value)) throw new TelemetryValidationError();
    return value;
  }
  if (containsSensitiveValue(value)) throw new TelemetryValidationError();
  if (!isEnumeratedTelemetryAttributeKey(key) || !ATTRIBUTE_VALUE_REGISTRY[key].includes(value)) {
    throw new TelemetryValidationError();
  }
  const redacted = redactForLog(value, { secretValues });
  return redacted === value ? value : REDACTED_VALUE;
}

function isTelemetryAttributeKey(value: string): value is TelemetryAttributeKey {
  return (ATTRIBUTE_KEYS as readonly string[]).includes(value);
}

function isNumericTelemetryAttributeKey(value: TelemetryAttributeKey): value is NumericTelemetryAttributeKey {
  return (NUMERIC_ATTRIBUTE_KEYS as readonly string[]).includes(value);
}

function isEnumeratedTelemetryAttributeKey(value: TelemetryAttributeKey): value is EnumeratedTelemetryAttributeKey {
  return value !== "provider_request_ref" && !isNumericTelemetryAttributeKey(value);
}

function containsSensitiveValue(value: string): boolean {
  return DEVELOPMENT_BEARER_PATTERN.test(value)
    || EMAIL_PATTERN.test(value)
    || PHONE_PATTERN.test(value)
    || CPF_CNPJ_PATTERN.test(value)
    || SECRET_REFERENCE_PATTERN.test(value);
}

function mergeAttributes(initial: TelemetryAttributes, ending: TelemetryAttributes): TelemetryAttributes {
  const output: Record<string, TelemetryAttributeValue> = { ...initial };
  for (const [key, value] of Object.entries(ending)) {
    if (Object.prototype.hasOwnProperty.call(output, key)) throw new TelemetryValidationError();
    output[key] = value;
  }
  return Object.freeze(output);
}

function freezeContext(value: TelemetryContext): TelemetryContext {
  return Object.freeze({ ...value });
}

function freezeActiveSpanContext(value: ActiveSpanContext): ActiveSpanContext {
  return Object.freeze({ ...value });
}

function timestamp(value: unknown): Timestamp {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new TelemetryValidationError();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new TelemetryValidationError();
  return Object.freeze({ milliseconds: value, iso: date.toISOString() });
}

function parseServiceName(value: unknown): TelemetryServiceName {
  if (typeof value !== "string" || !(TELEMETRY_SERVICE_NAMES as readonly string[]).includes(value)) {
    throw new TelemetryValidationError();
  }
  return value as TelemetryServiceName;
}

function parseSpanName(value: unknown): TelemetrySpanName {
  if (typeof value !== "string" || !(TELEMETRY_SPAN_NAMES as readonly string[]).includes(value)) {
    throw new TelemetryValidationError();
  }
  return value as TelemetrySpanName;
}

function parseEventCode(value: unknown): TelemetryEventCode {
  if (typeof value !== "string" || !(TELEMETRY_EVENT_CODES as readonly string[]).includes(value)) {
    throw new TelemetryValidationError();
  }
  return value as TelemetryEventCode;
}

function parseLogLevel(value: unknown): TelemetryLogLevel {
  if (!isLogLevel(value)) throw new TelemetryValidationError();
  return value;
}

function isLogLevel(value: unknown): value is TelemetryLogLevel {
  return value === "debug" || value === "info" || value === "warn" || value === "error";
}

function parseOutcome(value: unknown): TelemetryOutcome {
  if (value !== "success" && value !== "failure" && value !== "cancelled" && value !== "timeout" && value !== "denied") {
    throw new TelemetryValidationError();
  }
  return value;
}

function parseErrorCode(value: unknown): TelemetryErrorCode {
  if (typeof value !== "string" || !(TELEMETRY_ERROR_CODES as readonly string[]).includes(value)) {
    throw new TelemetryValidationError();
  }
  return value as TelemetryErrorCode;
}

function parseClassification(value: unknown): DataClassification {
  try {
    if (typeof value !== "string") throw new Error();
    return parseDataClassification(value);
  } catch {
    throw new TelemetryValidationError();
  }
}

function parseTenant(value: unknown): TenantId {
  try {
    return parseTenantId(value);
  } catch {
    throw new TelemetryValidationError();
  }
}

function parseNullableSession(value: unknown): SessionId | null {
  if (value === null) return null;
  try {
    return parseSessionId(value);
  } catch {
    throw new TelemetryValidationError();
  }
}

function parseCorrelation(value: unknown): CorrelationId {
  try {
    return parseCorrelationId(value);
  } catch {
    throw new TelemetryValidationError();
  }
}

function parseNullableCorrelation(value: unknown): CorrelationId | null {
  if (value === null) return null;
  return parseCorrelation(value);
}

function parseNullableSpanId(value: unknown): SpanId | null {
  if (value === null) return null;
  return parseSpanId(value);
}

function normalizeSecretValues(value: readonly string[]): readonly string[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) throw new TelemetryValidationError();
  const output: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !("value" in descriptor) || typeof descriptor.value !== "string" || descriptor.value.length === 0) {
      throw new TelemetryValidationError();
    }
    output.push(descriptor.value);
  }
  return Object.freeze(output);
}

function isTelemetrySink(value: unknown): value is TelemetrySink {
  return value !== null
    && typeof value === "object"
    && typeof (value as TelemetrySink).emitSpan === "function"
    && typeof (value as TelemetrySink).emitLog === "function";
}

function isIdGenerator(value: unknown): value is TelemetryIdGenerator {
  return value !== null
    && typeof value === "object"
    && typeof (value as TelemetryIdGenerator).createTraceId === "function"
    && typeof (value as TelemetryIdGenerator).createSpanId === "function"
    && typeof (value as TelemetryIdGenerator).createCorrelationId === "function";
}

function plainRecord(value: unknown): Record<string, unknown> {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error();
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new TelemetryValidationError();
  }
}

function assertAllowedKeys(record: Record<string, unknown>, expected: readonly string[], optional: readonly string[] = []): void {
  const allowed = new Set([...expected, ...optional]);
  const required = new Set(expected.filter((key) => !optional.includes(key)));
  const keys = Object.keys(record);
  if (keys.some((key) => !allowed.has(key)) || [...required].some((key) => !Object.prototype.hasOwnProperty.call(record, key))) {
    throw new TelemetryValidationError();
  }
}

function readRequired(record: Record<string, unknown>, key: string): unknown {
  const value = readOptional(record, key);
  if (value === undefined) throw new TelemetryValidationError();
  return value;
}

function readOptional(record: Record<string, unknown>, key: string): unknown | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor === undefined) return undefined;
  if (!("value" in descriptor)) throw new TelemetryValidationError();
  return descriptor.value;
}
