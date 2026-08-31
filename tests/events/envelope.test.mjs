import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../..", import.meta.url));
const domain = await import(pathToFileURL(join(root, "packages/domain/dist/index.js")).href);
const eventPackage = await import(pathToFileURL(join(root, "packages/events/dist/index.js")).href);
const fixture = JSON.parse(readFileSync(join(root, "tests/fixtures/reducers/walking-sequence.json"), "utf8"))[0];

test("event package encodes canonical payload JSON and decodes the same typed event", () => {
  const encoded = eventPackage.encodeInteractionEvent(fixture);
  const decoded = eventPackage.decodeInteractionEvent(encoded);
  assert.equal(encoded.payload_json, domain.canonicalJson(fixture.payload));
  assert.deepEqual(decoded, domain.parseInteractionEvent(fixture));
});

test("event package rejects malformed JSON and unrecognized envelope keys", () => {
  const encoded = eventPackage.encodeInteractionEvent(fixture);
  assert.throws(() => eventPackage.decodeInteractionEvent({ ...encoded, payload_json: "{" }), eventPackage.EventEnvelopeDecodingError);
  assert.throws(() => eventPackage.decodeInteractionEvent({ ...encoded, unknown_key: true }), eventPackage.EventEnvelopeDecodingError);
});

test("turn outcome uses the exact canonical payload emitted by migration 0049", () => {
  const event = {
    ...fixture,
    event_id: "019f0000-0000-7000-8000-000000000a02",
    event_type: "turn.outcome_recorded",
    aggregate_version: 6,
    data_classification: "internal",
    occurred_at: "2026-08-31T12:00:00.000Z",
    payload: {
      schema_version: "2.0.0",
      claim_id: "019f0000-0000-7000-8000-000000000a01",
      generation: 0,
      outcome: "succeeded",
      reason_code: "generation_succeeded",
      persistence: "persisted",
      resulting_turn_index: 2,
    },
  };
  const encoded = eventPackage.encodeInteractionEvent(event);
  assert.equal(encoded.payload_json, domain.canonicalJson(event.payload));
  assert.deepEqual(eventPackage.decodeInteractionEvent(encoded), domain.parseInteractionEvent(event));

  const withProviderMetadata = {
    ...encoded,
    payload_json: domain.canonicalJson({ ...event.payload, provider_request_id: "forbidden" }),
  };
  assert.throws(() => eventPackage.decodeInteractionEvent(withProviderMetadata), domain.DomainEventValidationError);
});
