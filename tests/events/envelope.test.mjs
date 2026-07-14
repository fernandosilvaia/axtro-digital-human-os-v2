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
