import assert from "node:assert/strict";
import test from "node:test";

import { isUuidV7, uuidV7Timestamp } from "../../packages/domain/dist/index.js";
import { deriveMeetingSessionId } from "../../apps/portal/src/lib/meetings/identity.ts";

const tenantA = "019f0000-0000-7000-8000-000000000001";
const tenantB = "019f0000-0000-7000-8000-000000000002";
const agentA = "019f0000-0000-7000-8000-000000000101";
const agentB = "019f0000-0000-7000-8000-000000000102";
const commandA = "019f0000-0000-7000-8000-000000000201";
const commandB = "019f0000-0000-7000-8000-000000000202";

test("meeting session identity is a stable tenant-scoped UUIDv7 receipt", () => {
  const first = deriveMeetingSessionId(tenantA, agentA, commandA);
  const replay = deriveMeetingSessionId(tenantA, agentA, commandA);
  assert.equal(first, replay);
  assert.equal(isUuidV7(first), true);
  assert.equal(uuidV7Timestamp(first), uuidV7Timestamp(commandA));
});

test("meeting session identity changes across every authority dimension", () => {
  const base = deriveMeetingSessionId(tenantA, agentA, commandA);
  assert.notEqual(deriveMeetingSessionId(tenantB, agentA, commandA), base);
  assert.notEqual(deriveMeetingSessionId(tenantA, agentB, commandA), base);
  assert.notEqual(deriveMeetingSessionId(tenantA, agentA, commandB), base);
});

test("meeting session identity rejects non-UUIDv7 caller material", () => {
  assert.throws(() => deriveMeetingSessionId(tenantA, agentA, "10000000-0000-4000-8000-000000000001"));
});
