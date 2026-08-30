import assert from "node:assert/strict";
import test from "node:test";

import { deterministicBusinessActionCommandId } from "../../apps/portal/src/lib/runtime/business-action-command-id.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TENANT_ID = "019b0000-0000-7000-8000-000000000001";
const AGENT_ID = "019b0000-0000-7000-8000-000000000002";
const SESSION_ID = "019b0000-0000-7000-8000-000000000003";

test("deterministicBusinessActionCommandId returns a UUID that matches portal-business-action-bridge.ts's UUID_PATTERN", () => {
  const commandId = deterministicBusinessActionCommandId(TENANT_ID, AGENT_ID, SESSION_ID, "register_lead", "tavus-tool-call-1");
  assert.match(commandId, UUID_PATTERN);
  // Version 5 specifically (RFC 4122 sec. 4.3): the third group's leading nibble.
  assert.match(commandId, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-/);
});

test("deterministicBusinessActionCommandId is a pure function: same five inputs always derive the same commandId", () => {
  const first = deterministicBusinessActionCommandId(TENANT_ID, AGENT_ID, SESSION_ID, "register_lead", "tavus-tool-call-1");
  const second = deterministicBusinessActionCommandId(TENANT_ID, AGENT_ID, SESSION_ID, "register_lead", "tavus-tool-call-1");
  assert.equal(first, second);
});

test("deterministicBusinessActionCommandId: a genuinely new tool_call_id derives a genuinely different commandId", () => {
  const first = deterministicBusinessActionCommandId(TENANT_ID, AGENT_ID, SESSION_ID, "register_lead", "tavus-tool-call-1");
  const second = deterministicBusinessActionCommandId(TENANT_ID, AGENT_ID, SESSION_ID, "register_lead", "tavus-tool-call-2");
  assert.notEqual(first, second);
});

test("deterministicBusinessActionCommandId: a different actionKind for the same tool_call_id also derives a different commandId", () => {
  const registerLead = deterministicBusinessActionCommandId(TENANT_ID, AGENT_ID, SESSION_ID, "register_lead", "tavus-tool-call-1");
  const proposeSlots = deterministicBusinessActionCommandId(TENANT_ID, AGENT_ID, SESSION_ID, "propose_meeting_slots", "tavus-tool-call-1");
  assert.notEqual(registerLead, proposeSlots);
});

test("deterministicBusinessActionCommandId: a different session (handoff to a new presenter mid-call) also derives a different commandId", () => {
  const first = deterministicBusinessActionCommandId(TENANT_ID, AGENT_ID, SESSION_ID, "register_lead", "tavus-tool-call-1");
  const otherSession = deterministicBusinessActionCommandId(TENANT_ID, AGENT_ID, "019b0000-0000-7000-8000-000000000099", "register_lead", "tavus-tool-call-1");
  assert.notEqual(first, otherSession);
});
