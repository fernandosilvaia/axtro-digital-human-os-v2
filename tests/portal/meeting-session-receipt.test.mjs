import assert from "node:assert/strict";
import test from "node:test";

import { parseMeetingSessionReceipt } from "../../apps/portal/src/lib/meetings/session-receipt.ts";

const RESERVATION = "0198a8b2-3c4d-7e5f-8a90-1234567890ab";

function receipt(overrides = {}) {
  return {
    ok: true,
    terminal: false,
    status: "created",
    cameraState: "conversation_created",
    tavusCleanupRequired: false,
    tavusConversationId: "conversation-known-123",
    tavusReservationId: RESERVATION,
    ...overrides,
  };
}

test("normal meeting persistence remains conversation_created and is not a billing activation receipt", () => {
  const parsed = parseMeetingSessionReceipt(receipt());
  assert.equal(parsed.terminal, false);
  assert.equal(parsed.cameraState, "conversation_created");
  assert.equal(parsed.tavusCleanupRequired, false);
  assert.equal(Object.isFrozen(parsed), true);
});

test("a terminal pre-session receipt carries the exact Tavus cleanup identity", () => {
  const parsed = parseMeetingSessionReceipt(receipt({
    terminal: true,
    status: "ended",
    tavusCleanupRequired: true,
  }));
  assert.equal(parsed.terminal, true);
  assert.equal(parsed.tavusConversationId, "conversation-known-123");
  assert.equal(parsed.tavusReservationId, RESERVATION);
});

test("meeting persistence receipt rejects extra fields and inconsistent terminal cleanup", () => {
  assert.throws(() => parseMeetingSessionReceipt({ ...receipt(), tenantId: RESERVATION }), /invalid receipt shape/);
  assert.throws(() => parseMeetingSessionReceipt(receipt({ terminal: true, status: "created" })), /invalid receipt/);
  assert.throws(() => parseMeetingSessionReceipt(receipt({
    terminal: true,
    status: "failed",
    tavusCleanupRequired: true,
    tavusConversationId: null,
  })), /invalid receipt/);
});
