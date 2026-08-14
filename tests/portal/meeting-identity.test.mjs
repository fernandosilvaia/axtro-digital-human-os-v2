import assert from "node:assert/strict";
import test from "node:test";

import { isUuidV7 } from "../../packages/domain/dist/index.js";
import { deriveMeetingSessionId } from "../../apps/portal/src/lib/meetings/identity.ts";

const tenantA = "019f0000-0000-7000-8000-000000000001";
const tenantB = "019f0000-0000-7000-8000-000000000002";
const agentA = "019f0000-0000-7000-8000-000000000101";
const agentB = "019f0000-0000-7000-8000-000000000102";
// The browser generates commandId via crypto.randomUUID() — UUIDv4, not v7.
const commandA = "6b8f6c3a-4e2b-4a1a-9c3d-0f1e2d3c4b5a";
const commandB = "1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d";

test("meeting session identity is a stable tenant-scoped UUIDv7 receipt", () => {
  const first = deriveMeetingSessionId(tenantA, agentA, commandA);
  const replay = deriveMeetingSessionId(tenantA, agentA, commandA);
  assert.equal(first, replay);
  assert.equal(isUuidV7(first), true);
});

test("meeting session identity is stable regardless of commandId casing", () => {
  const lower = deriveMeetingSessionId(tenantA, agentA, commandA);
  const upper = deriveMeetingSessionId(tenantA, agentA, commandA.toUpperCase());
  assert.equal(lower, upper);
});

test("meeting session identity changes across every authority dimension", () => {
  const base = deriveMeetingSessionId(tenantA, agentA, commandA);
  assert.notEqual(deriveMeetingSessionId(tenantB, agentA, commandA), base);
  assert.notEqual(deriveMeetingSessionId(tenantA, agentB, commandA), base);
  assert.notEqual(deriveMeetingSessionId(tenantA, agentA, commandB), base);
});

test("meeting session identity accepts a browser-generated UUIDv4 commandId", () => {
  // Regression guard: deriveMeetingSessionId used to require commandId to be
  // a UUIDv7 and throw on the real-world v4 shape crypto.randomUUID() emits.
  assert.doesNotThrow(() => deriveMeetingSessionId(tenantA, agentA, commandA));
});

test("meeting session identity rejects non-UUID caller material", () => {
  assert.throws(() => deriveMeetingSessionId(tenantA, agentA, "not-a-uuid"));
  // Version nibble 9 is outside the 1-8 range every real UUID version uses.
  assert.throws(() => deriveMeetingSessionId(tenantA, agentA, "10000000-0000-9000-8000-000000000001"));
});
