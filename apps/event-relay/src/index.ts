import { getAuthorizedTenantContext, type AuthorizedRequestContext } from "@axtro/auth";
import type { EventDeliveryReceipt, EventEnvelope } from "@axtro/contracts-ts";
import { parseUuidV7, sha256Canonical, type UuidV7 } from "@axtro/domain";
import {
  SESSION_TIMELINE_CONSUMER_NAME,
  SessionTimelineAuthorizationError,
  SessionTimelineCapacityError,
  SessionTimelineConflictError,
  SessionTimelineValidationError,
  type EventDeliveryFailureCode,
  type SessionTimelineRepository,
  type TransactionalOutboxRepository,
} from "@axtro/events";
import type { TelemetryRuntime, TelemetrySpan } from "@axtro/observability";

export const EVENT_RELAY_FAULT_POINTS = [
  "after_claim_before_effect",
  "after_effect_before_ack",
] as const;

export type EventRelayFaultPoint = (typeof EVENT_RELAY_FAULT_POINTS)[number];

export interface EventRelayClock {
  now(): string;
}

export interface ManualEventRelayClock extends EventRelayClock {
  advanceBy(milliseconds: unknown): string;
}

export interface EventRelayClaimTokenFactory {
  nextClaimToken(): UuidV7;
}

export type EventConsumerResult =
  | Readonly<{ outcome: "succeeded"; effect_hash: string }>
  | Readonly<{
    outcome: "failed";
    failure_code: Exclude<EventDeliveryFailureCode, "lease_expired" | "max_attempts_exhausted">;
    retryable: boolean;
  }>;

export interface CanonicalEventConsumer {
  readonly name: typeof SESSION_TIMELINE_CONSUMER_NAME;
  consume(request: AuthorizedRequestContext, event: EventEnvelope): Promise<EventConsumerResult>;
}

export interface EventRelayOptions {
  readonly outbox: TransactionalOutboxRepository;
  readonly consumer: CanonicalEventConsumer;
  readonly clock: EventRelayClock;
  readonly claim_token_factory: EventRelayClaimTokenFactory;
  readonly telemetry: TelemetryRuntime;
  readonly lease_duration_ms?: unknown;
  readonly max_attempts?: unknown;
  readonly retry_delay_ms?: unknown;
  readonly fault_points?: readonly EventRelayFaultPoint[];
}

export type EventRelayRunResult =
  | Readonly<{ outcome: "idle"; receipt: null }>
  | Readonly<{
    outcome: "published" | "retry_scheduled" | "dead_letter";
    receipt: EventDeliveryReceipt;
  }>;

export interface EventRelay {
  runOnce(request: AuthorizedRequestContext): Promise<EventRelayRunResult>;
}

export class EventRelayConfigurationError extends Error {
  constructor() {
    super("Event relay configuration is invalid");
    this.name = "EventRelayConfigurationError";
  }
}

export class EventRelayCrashError extends Error {
  readonly point: EventRelayFaultPoint;

  constructor(point: EventRelayFaultPoint) {
    super("Event relay stopped at a deterministic crash boundary");
    this.name = "EventRelayCrashError";
    this.point = point;
  }
}

export class EventRelayAuthorizationError extends Error {
  constructor() {
    super("Event relay access is not authorized");
    this.name = "EventRelayAuthorizationError";
  }
}

interface NormalizedRelayOptions {
  readonly outbox: TransactionalOutboxRepository;
  readonly consumer: CanonicalEventConsumer;
  readonly clock: EventRelayClock;
  readonly claimTokenFactory: EventRelayClaimTokenFactory;
  readonly telemetry: TelemetryRuntime;
  readonly leaseDurationMs: number;
  readonly maxAttempts: number;
  readonly retryDelayMs: number;
  readonly faultPoints: EventRelayFaultPoint[];
}

const DEFAULT_LEASE_DURATION_MS = 1_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 1_000;
const MIN_LEASE_DURATION_MS = 100;
const MAX_LEASE_DURATION_MS = 300_000;
const MAX_RETRY_DELAY_MS = 3_600_000;
const MAX_ATTEMPTS = 16;
const MAX_TOKEN_FIXTURES = 1_024;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const TRUSTED_CLOCKS = new WeakSet<object>();
const TRUSTED_TOKEN_FACTORIES = new WeakSet<object>();
const TRUSTED_CONSUMERS = new WeakSet<object>();

export function createEventRelay(optionsInput: EventRelayOptions): EventRelay {
  const options = normalizeRelayOptions(optionsInput);
  const faultPoints = [...options.faultPoints];
  return Object.freeze({
    async runOnce(request: AuthorizedRequestContext): Promise<EventRelayRunResult> {
      requireRelayContext(request);
      const claimToken = options.claimTokenFactory.nextClaimToken();
      const claimResult = await options.outbox.claimNextDelivery(request, {
        consumer_name: options.consumer.name,
        claim_token: claimToken,
        now: options.clock.now(),
        lease_duration_ms: options.leaseDurationMs,
        max_attempts: options.maxAttempts,
      });
      if (claimResult.outcome === "idle") return Object.freeze({ outcome: "idle", receipt: null });
      if (claimResult.outcome === "dead_lettered") {
        return Object.freeze({ outcome: "dead_letter", receipt: claimResult.receipt });
      }
      const claim = claimResult.claim;
      const telemetry = startRelayTelemetry(options.telemetry, claim.event, claim.attempt);
      try {
        crashAt(faultPoints, "after_claim_before_effect");

        let consumerResult: EventConsumerResult;
        try {
          consumerResult = await options.consumer.consume(request, claim.event);
        } catch {
          consumerResult = Object.freeze({
            outcome: "failed",
            failure_code: "consumer_retryable",
            retryable: true,
          });
        }
        const completedAt = options.clock.now();
        if (consumerResult.outcome === "succeeded") {
          crashAt(faultPoints, "after_effect_before_ack");
          const receipt = await options.outbox.acknowledgeDelivery(request, {
            event_id: claim.event_id,
            consumer_name: claim.consumer_name,
            claim_token: claim.claim_token,
            completed_at: completedAt,
            effect_hash: consumerResult.effect_hash,
          });
          completeRelayTelemetry(telemetry, receipt);
          return Object.freeze({ outcome: "published", receipt });
        }

        const receipt = await options.outbox.failDelivery(request, {
          event_id: claim.event_id,
          consumer_name: claim.consumer_name,
          claim_token: claim.claim_token,
          completed_at: completedAt,
          failure_code: consumerResult.failure_code,
          retryable: consumerResult.retryable,
          retry_delay_ms: consumerResult.retryable ? options.retryDelayMs : 0,
        });
        completeRelayTelemetry(telemetry, receipt);
        return Object.freeze({ outcome: receipt.status, receipt });
      } catch (error) {
        failRelayTelemetry(telemetry);
        throw error;
      }
    },
  });
}

interface RelayTelemetry {
  readonly runtime: TelemetryRuntime;
  readonly span: TelemetrySpan;
}

function startRelayTelemetry(
  runtime: TelemetryRuntime,
  event: EventEnvelope,
  attempt: number,
): RelayTelemetry | null {
  try {
    const context = runtime.startTrustedEventTrace({
      serviceName: "event-relay",
      tenantId: event.tenant_id,
      sessionId: event.session_id,
      traceId: event.trace_id,
      correlationId: event.correlation_id,
      causationId: event.causation_id,
    });
    const span = runtime.startSpan("outbox.relay", context, {
      component: "outbox_relay",
      operation: "relay_event",
      attempt,
    });
    runtime.log({
      level: "info",
      eventCode: "outbox.relay.started",
      context: span.context,
      classification: "internal",
      attributes: { status: "pending" },
    });
    return Object.freeze({ runtime, span });
  } catch {
    return null;
  }
}

function completeRelayTelemetry(telemetry: RelayTelemetry | null, receipt: EventDeliveryReceipt): void {
  if (telemetry === null) return;
  try {
    telemetry.span.end({ outcome: "success", attributes: { status: receipt.status } });
    telemetry.runtime.log({
      level: "info",
      eventCode: "outbox.relay.completed",
      context: telemetry.span.context,
      classification: "internal",
      attributes: { outcome: "success", status: receipt.status },
    });
  } catch {
    // Observability is deliberately outside the delivery transaction.
  }
}

function failRelayTelemetry(telemetry: RelayTelemetry | null): void {
  if (telemetry === null) return;
  try {
    telemetry.span.end({ outcome: "failure", errorCode: "internal_error", attributes: { status: "failed" } });
    telemetry.runtime.log({
      level: "error",
      eventCode: "outbox.relay.failed",
      context: telemetry.span.context,
      classification: "internal",
      attributes: { outcome: "failure", error_code: "internal_error", status: "failed" },
    });
  } catch {
    // Telemetry failure must never acknowledge, retry or dead-letter an event.
  }
}

function requireRelayContext(request: AuthorizedRequestContext): void {
  try {
    const context = getAuthorizedTenantContext(request);
    if (
      request.principal.actorType !== "workflow"
      || request.principal.identityKind !== "service"
      || !context.grantedScopes.includes("event:relay")
      || !context.grantedScopes.includes("session:write")
      || !context.purposes.includes("essential_processing")
    ) throw new EventRelayAuthorizationError();
  } catch (error) {
    if (error instanceof EventRelayAuthorizationError) throw error;
    throw new EventRelayAuthorizationError();
  }
}

export function createSessionTimelineConsumer(timeline: SessionTimelineRepository): CanonicalEventConsumer {
  if (
    timeline === null
    || typeof timeline !== "object"
    || typeof timeline.appendCanonicalEvent !== "function"
  ) throw new EventRelayConfigurationError();
  const consumer: CanonicalEventConsumer = Object.freeze({
    name: SESSION_TIMELINE_CONSUMER_NAME,
    async consume(request: AuthorizedRequestContext, event: EventEnvelope): Promise<EventConsumerResult> {
      try {
        const receipt = timeline.appendCanonicalEvent(request, event);
        if (
          receipt.tenant_id !== event.tenant_id
          || receipt.session_id !== event.session_id
          || receipt.event_id !== event.event_id
          || receipt.aggregate_version !== event.aggregate_version
          || receipt.event_fingerprint !== sha256Canonical(event)
          || !SHA256_PATTERN.test(receipt.state_hash)
        ) {
          return Object.freeze({ outcome: "failed", failure_code: "consumer_rejected", retryable: false });
        }
        return Object.freeze({ outcome: "succeeded", effect_hash: receipt.state_hash });
      } catch (error) {
        if (error instanceof SessionTimelineConflictError) {
          return Object.freeze({ outcome: "failed", failure_code: "timeline_conflict", retryable: false });
        }
        if (error instanceof SessionTimelineValidationError) {
          return Object.freeze({ outcome: "failed", failure_code: "timeline_invalid", retryable: false });
        }
        if (error instanceof SessionTimelineCapacityError) {
          return Object.freeze({ outcome: "failed", failure_code: "timeline_capacity", retryable: true });
        }
        if (error instanceof SessionTimelineAuthorizationError) {
          return Object.freeze({ outcome: "failed", failure_code: "consumer_rejected", retryable: false });
        }
        return Object.freeze({ outcome: "failed", failure_code: "consumer_retryable", retryable: true });
      }
    },
  });
  TRUSTED_CONSUMERS.add(consumer);
  return consumer;
}

export function createManualEventRelayClock(initialTime: unknown): ManualEventRelayClock {
  let currentMs = parseTimestamp(initialTime);
  const clock: ManualEventRelayClock = Object.freeze({
    now: () => new Date(currentMs).toISOString(),
    advanceBy(millisecondsInput: unknown): string {
      const milliseconds = parseBoundedInteger(millisecondsInput, 0, MAX_RETRY_DELAY_MS);
      currentMs += milliseconds;
      return new Date(currentMs).toISOString();
    },
  });
  TRUSTED_CLOCKS.add(clock);
  return clock;
}

export function createDeterministicClaimTokenFactory(tokensInput: readonly unknown[]): EventRelayClaimTokenFactory {
  if (!Array.isArray(tokensInput) || tokensInput.length < 1 || tokensInput.length > MAX_TOKEN_FIXTURES) {
    throw new EventRelayConfigurationError();
  }
  const tokens = tokensInput.map((value) => parseClaimToken(value));
  if (new Set(tokens).size !== tokens.length) throw new EventRelayConfigurationError();
  let index = 0;
  const factory: EventRelayClaimTokenFactory = Object.freeze({
    nextClaimToken(): UuidV7 {
      const token = tokens[index];
      if (token === undefined) throw new EventRelayConfigurationError();
      index += 1;
      return token;
    },
  });
  TRUSTED_TOKEN_FACTORIES.add(factory);
  return factory;
}

function normalizeRelayOptions(value: EventRelayOptions): NormalizedRelayOptions {
  const record = strictPlainRecord(value, [
    "outbox",
    "consumer",
    "clock",
    "claim_token_factory",
    "telemetry",
    "lease_duration_ms",
    "max_attempts",
    "retry_delay_ms",
    "fault_points",
  ]);
  const outbox = record.outbox as TransactionalOutboxRepository;
  const consumer = record.consumer as CanonicalEventConsumer;
  const clock = record.clock as EventRelayClock;
  const claimTokenFactory = record.claim_token_factory as EventRelayClaimTokenFactory;
  const telemetry = record.telemetry as TelemetryRuntime;
  if (
    outbox === null
    || typeof outbox !== "object"
    || typeof outbox.claimNextDelivery !== "function"
    || typeof outbox.acknowledgeDelivery !== "function"
    || typeof outbox.failDelivery !== "function"
    || consumer === null
    || typeof consumer !== "object"
    || !TRUSTED_CONSUMERS.has(consumer)
    || consumer.name !== SESSION_TIMELINE_CONSUMER_NAME
    || clock === null
    || typeof clock !== "object"
    || !TRUSTED_CLOCKS.has(clock)
    || claimTokenFactory === null
    || typeof claimTokenFactory !== "object"
    || !TRUSTED_TOKEN_FACTORIES.has(claimTokenFactory)
    || telemetry === null
    || typeof telemetry !== "object"
    || typeof telemetry.startTrustedEventTrace !== "function"
    || typeof telemetry.startSpan !== "function"
    || typeof telemetry.log !== "function"
  ) throw new EventRelayConfigurationError();
  return Object.freeze({
    outbox,
    consumer,
    clock,
    claimTokenFactory,
    telemetry,
    leaseDurationMs: optionalBoundedInteger(
      record.lease_duration_ms,
      DEFAULT_LEASE_DURATION_MS,
      MIN_LEASE_DURATION_MS,
      MAX_LEASE_DURATION_MS,
    ),
    maxAttempts: optionalBoundedInteger(record.max_attempts, DEFAULT_MAX_ATTEMPTS, 1, MAX_ATTEMPTS),
    retryDelayMs: optionalBoundedInteger(record.retry_delay_ms, DEFAULT_RETRY_DELAY_MS, 0, MAX_RETRY_DELAY_MS),
    faultPoints: parseFaultPoints(record.fault_points),
  });
}

function parseFaultPoints(value: unknown): EventRelayFaultPoint[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > EVENT_RELAY_FAULT_POINTS.length) {
    throw new EventRelayConfigurationError();
  }
  const parsed: EventRelayFaultPoint[] = [];
  for (const point of value) {
    if (!EVENT_RELAY_FAULT_POINTS.includes(point as EventRelayFaultPoint) || parsed.includes(point as EventRelayFaultPoint)) {
      throw new EventRelayConfigurationError();
    }
    parsed.push(point as EventRelayFaultPoint);
  }
  return parsed;
}

function crashAt(faultPoints: EventRelayFaultPoint[], point: EventRelayFaultPoint): void {
  const index = faultPoints.indexOf(point);
  if (index < 0) return;
  faultPoints.splice(index, 1);
  throw new EventRelayCrashError(point);
}

function strictPlainRecord(value: unknown, allowedKeys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new EventRelayConfigurationError();
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!allowedKeys.includes(key) || !("value" in descriptor)) throw new EventRelayConfigurationError();
  }
  return Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]));
}

function parseTimestamp(value: unknown): number {
  if (typeof value !== "string" || value.length < 20 || value.length > 40) throw new EventRelayConfigurationError();
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new EventRelayConfigurationError();
  return timestamp;
}

function parseClaimToken(value: unknown): UuidV7 {
  try {
    return parseUuidV7(value, "claim_token");
  } catch {
    throw new EventRelayConfigurationError();
  }
}

function parseBoundedInteger(value: unknown, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new EventRelayConfigurationError();
  }
  return value;
}

function optionalBoundedInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return value === undefined ? fallback : parseBoundedInteger(value, minimum, maximum);
}
