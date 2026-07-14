import type { EventEnvelope } from "@axtro/contracts-ts";
import { canonicalJson, parseInteractionEvent, type AnyInteractionEvent } from "@axtro/domain";

export class EventEnvelopeDecodingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EventEnvelopeDecodingError";
  }
}

/**
 * Converts the internal discriminated event into the contract envelope stored
 * by the future timeline and outbox. The payload is canonical JSON so an event
 * has one reproducible representation, while the state hash remains separate.
 */
export function encodeInteractionEvent(eventInput: unknown): EventEnvelope {
  const event = parseInteractionEvent(eventInput);
  return {
    schema_version: event.schema_version,
    event_id: event.event_id,
    event_type: event.event_type,
    event_version: event.event_version,
    aggregate_type: event.aggregate_type,
    aggregate_id: event.aggregate_id,
    aggregate_version: event.aggregate_version,
    tenant_id: event.tenant_id,
    session_id: event.session_id,
    producer: event.producer,
    trace_id: event.trace_id,
    correlation_id: event.correlation_id,
    causation_id: event.causation_id,
    data_classification: event.data_classification,
    payload_json: canonicalJson(event.payload),
    occurred_at: event.occurred_at,
  };
}

/** Decode an event envelope without trusting its payload JSON or unknown keys. */
export function decodeInteractionEvent(value: unknown): AnyInteractionEvent {
  const envelope = exactEnvelope(value);
  let payload: unknown;
  try {
    payload = JSON.parse(envelope.payload_json);
  } catch {
    throw new EventEnvelopeDecodingError("event envelope payload_json must contain valid JSON");
  }
  return parseInteractionEvent({
    schema_version: envelope.schema_version,
    event_id: envelope.event_id,
    event_type: envelope.event_type,
    event_version: envelope.event_version,
    aggregate_type: envelope.aggregate_type,
    aggregate_id: envelope.aggregate_id,
    aggregate_version: envelope.aggregate_version,
    tenant_id: envelope.tenant_id,
    session_id: envelope.session_id,
    producer: envelope.producer,
    trace_id: envelope.trace_id,
    correlation_id: envelope.correlation_id,
    causation_id: envelope.causation_id,
    data_classification: envelope.data_classification,
    occurred_at: envelope.occurred_at,
    payload,
  });
}

function exactEnvelope(value: unknown): Record<string, unknown> & { payload_json: string } {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new EventEnvelopeDecodingError("event envelope must be a plain object");
  }
  const envelope = value as Record<string, unknown>;
  const expected = [
    "schema_version",
    "event_id",
    "event_type",
    "event_version",
    "aggregate_type",
    "aggregate_id",
    "aggregate_version",
    "tenant_id",
    "session_id",
    "producer",
    "trace_id",
    "correlation_id",
    "causation_id",
    "data_classification",
    "payload_json",
    "occurred_at",
  ];
  const actual = Object.keys(envelope).sort();
  const sortedExpected = [...expected].sort();
  if (actual.length !== sortedExpected.length || actual.some((key, index) => key !== sortedExpected[index])) {
    throw new EventEnvelopeDecodingError("event envelope contains missing or unknown keys");
  }
  if (typeof envelope.payload_json !== "string" || envelope.payload_json.length < 2 || envelope.payload_json.length > 250_000) {
    throw new EventEnvelopeDecodingError("event envelope payload_json must be a bounded JSON string");
  }
  return envelope as Record<string, unknown> & { payload_json: string };
}
