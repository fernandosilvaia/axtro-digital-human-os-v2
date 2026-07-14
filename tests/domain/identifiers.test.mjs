import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import test from "node:test";

const root = fileURLToPath(new URL("../..", import.meta.url));
const domain = await import(pathToFileURL(join(root, "packages/domain/dist/index.js")).href);
const entropy = Uint8Array.from([0x0a, 0xbc, 0x7f, 1, 2, 3, 4, 5, 6, 7]);

test("uuidv7 generation is deterministic, sortable, and RFC variant valid", () => {
  const first = domain.uuidV7FromParts(1_700_000_000_000, entropy);
  const second = domain.uuidV7FromParts(1_700_000_000_001, entropy);
  assert.equal(first, "018bcfe5-6800-7abc-bf01-020304050607");
  assert.equal(domain.isUuidV7(first), true);
  assert.equal(first < second, true);
  assert.equal(domain.uuidV7Timestamp(first), 1_700_000_000_000);
});

test("uuidv7 property loop preserves timestamp, version, and variant", () => {
  for (let offset = 0; offset < 128; offset += 1) {
    const generated = domain.uuidV7FromParts(
      1_700_000_000_000 + offset,
      Uint8Array.from(Array.from({ length: 10 }, (_, index) => (offset * 17 + index) & 0xff)),
    );
    assert.equal(domain.isUuidV7(generated), true);
    assert.equal(domain.uuidV7Timestamp(generated), 1_700_000_000_000 + offset);
    assert.equal(generated[14], "7");
    assert.equal("89ab".includes(generated[19]), true);
  }
});

test("uuidv7 boundary rejects v4 and invalid RFC variants", () => {
  assert.throws(() => domain.parseUuidV7("550e8400-e29b-41d4-a716-446655440000", "session_id"));
  assert.throws(() => domain.parseUuidV7("00000000-0000-7000-0000-000000000000", "tenant_id"));
  assert.throws(() => domain.uuidV7FromParts(-1, entropy));
  assert.throws(() => domain.uuidV7FromParts(1, Uint8Array.from([1])));
  const coercible = { toString: () => "018bcfe5-6800-7abc-bf01-020304050607" };
  assert.throws(() => domain.parseTenantId(coercible));
  assert.throws(() => domain.parseActorId(coercible));
  assert.throws(() => domain.parseCorrelationId(coercible));
});

test("tenant and trace contexts are explicit and survive serialization", () => {
  const tenantId = domain.uuidV7FromParts(1_700_000_000_000, entropy);
  const actorId = domain.uuidV7FromParts(1_700_000_000_001, entropy);
  const correlationId = domain.uuidV7FromParts(1_700_000_000_002, entropy);
  const context = domain.createTenantContext({
    tenantId,
    actorId,
    actorType: "presenter",
    grantedScopes: ["session:write"],
    purposes: ["essential_processing"],
  });
  const trace = domain.createTraceContext({
    traceId: "0123456789abcdef0123456789abcdef",
    correlationId,
    causationId: null,
  });
  const restored = JSON.parse(JSON.stringify({ context, trace }));
  assert.equal(domain.assertTenantMatch(context, restored.context.tenantId), tenantId);
  assert.equal(restored.trace.correlationId, correlationId);
  assert.throws(() => domain.assertTenantMatch(context, actorId));
  assert.throws(() => domain.createTenantContext({
    tenantId,
    actorId,
    actorType: "untrusted_actor",
    grantedScopes: [],
    purposes: [],
  }));
  assert.throws(() => domain.createTenantContext({
    tenantId,
    actorId,
    actorType: undefined,
    grantedScopes: [],
    purposes: [],
  }));
  assert.throws(() => domain.createTraceContext({
    traceId: { toString: () => "0123456789abcdef" },
    correlationId,
    causationId: null,
  }));
});

test("schema version and data classification are constrained at boundaries", () => {
  assert.equal(domain.parseSchemaVersion("2.0.0"), "2.0.0");
  assert.equal(domain.parseDataClassification("restricted"), "restricted");
  assert.throws(() => domain.parseSchemaVersion("1.0.0"));
  assert.throws(() => domain.parseDataClassification("secret"));
});
