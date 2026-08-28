import assert from "node:assert/strict";
import test from "node:test";

import { createPortalBusinessActionBridge } from "../../apps/portal/src/lib/runtime/portal-business-action-bridge.ts";

const IDS = [
  "019b0000-0000-7000-8000-000000000001", "019b0000-0000-7000-8000-000000000002",
  "019b0000-0000-7000-8000-000000000003", "019b0000-0000-7000-8000-000000000004",
  "019b0000-0000-7000-8000-000000000005", "019b0000-0000-7000-8000-000000000006",
  "019b0000-0000-7000-8000-000000000007", "019b0000-0000-7000-8000-000000000008",
  "019b0000-0000-7000-8000-000000000009", "019b0000-0000-7000-8000-00000000000a",
  "019b0000-0000-7000-8000-00000000000b", "019b0000-0000-7000-8000-00000000000c",
];

function admissionInput(overrides = {}) {
  return {
    tenantId: IDS[0], agentId: IDS[1], sessionId: IDS[2], presenterId: IDS[3],
    actionKind: "register_lead", commandId: IDS[4], args: { contactName: "Ana Prospect" },
    ...overrides,
  };
}

function fakeBridge({ admission = null, registration = null, idGenerator = null } = {}) {
  const calls = [];
  let index = 5;
  const rpc = {
    async rpc(name, parameters) {
      calls.push({ name, parameters });
      if (name === "portal_admit_business_action_service") return {
        data: admission ?? { outcome: "issued", grantId: parameters.p_grant_id, sessionId: parameters.p_session_id, generation: parameters.p_generation },
        error: null,
      };
      if (name === "portal_register_business_lead_service") return {
        data: registration ?? { outcome: "succeeded", leadId: IDS[7], receiptId: parameters.p_receipt_id },
        error: null,
      };
      throw new Error(`unexpected RPC ${name}`);
    },
  };
  const bridge = createPortalBusinessActionBridge({
    rpc, env: { PORTAL_BUSINESS_ACTION_BRIDGE_ENABLED: "true" },
    idGenerator: idGenerator ?? (() => IDS[index++]),
  });
  return { bridge, calls };
}

test("business action bridge admits and registers a lead in one funnel", async () => {
  const { bridge, calls } = fakeBridge();
  const admitted = await bridge.admitBusinessAction(admissionInput());
  assert.equal(admitted.outcome, "issued");
  if (admitted.outcome === "rejected") return assert.fail("expected grant");
  assert.equal(admitted.grant.actionKind, "register_lead");
  const registered = await bridge.registerBusinessLead({
    grant: admitted.grant, contactName: "Ana Prospect", contactEmail: "ana@example.test",
  });
  assert.deepEqual(registered, { outcome: "registered", code: "registered", leadId: IDS[7] });
  assert.equal(calls.filter((call) => call.name === "portal_admit_business_action_service").length, 1);
  assert.equal(calls.filter((call) => call.name === "portal_register_business_lead_service").length, 1);
  assert.equal(calls[0].parameters.p_action_kind, "register_lead");
  assert.equal(calls[0].parameters.p_command_fingerprint.length, 64);
});

test("business action bridge fails closed on admission before any RPC when the flag is off", async () => {
  const { bridge, calls } = fakeBridge();
  const disabledBridge = createPortalBusinessActionBridge({ env: {}, rpc: { rpc: () => { throw new Error("must not be called"); } } });
  assert.deepEqual(await disabledBridge.admitBusinessAction(admissionInput()), { outcome: "rejected", code: "bridge_disabled" });
  assert.equal(calls.length, 0);
});

test("business action bridge fails closed on registration before any RPC when the flag is off", async () => {
  const disabledBridge = createPortalBusinessActionBridge({ env: {}, rpc: { rpc: () => { throw new Error("must not be called"); } } });
  const grant = {
    tenantId: IDS[0], agentId: IDS[1], sessionId: IDS[2], presenterId: IDS[3],
    actionKind: "register_lead", grantId: IDS[5], generationId: 0, commandFingerprint: "a".repeat(64),
  };
  assert.deepEqual(
    await disabledBridge.registerBusinessLead({ grant, contactName: "Ana Prospect", contactEmail: "ana@example.test" }),
    { outcome: "rejected", code: "bridge_disabled" },
  );
});

test("business action bridge maps a durable kill switch from admission without issuing a grant", async () => {
  const { bridge, calls } = fakeBridge({ admission: { outcome: "blocked_kill_switch" } });
  assert.deepEqual(await bridge.admitBusinessAction(admissionInput()), { outcome: "rejected", code: "kill_switch_active" });
  assert.equal(calls.length, 1);
});

test("business action bridge surfaces disclosure and consent rejections verbatim", async () => {
  for (const code of ["denied_disclosure", "denied_essential_consent", "denied_purpose_consent", "presenter_mismatch", "agent_inactive"]) {
    const { bridge } = fakeBridge({ admission: { outcome: code } });
    assert.deepEqual(await bridge.admitBusinessAction(admissionInput()), { outcome: "rejected", code });
  }
});

test("business action bridge distinguishes a flipped kill switch from an expired grant on registration", async () => {
  const grant = {
    tenantId: IDS[0], agentId: IDS[1], sessionId: IDS[2], presenterId: IDS[3],
    actionKind: "register_lead", grantId: IDS[5], generationId: 0, commandFingerprint: "b".repeat(64),
  };
  const { bridge: killSwitchBridge } = fakeBridge({ registration: { outcome: "rejected", leadId: null, reason: "kill_switch_active" } });
  assert.deepEqual(
    await killSwitchBridge.registerBusinessLead({ grant, contactName: "Ana Prospect", contactPhone: "+55 11 90000-0000" }),
    { outcome: "rejected", code: "kill_switch_active" },
  );
  const { bridge: expiredBridge } = fakeBridge({ registration: { outcome: "rejected", leadId: null, reason: "grant_expired" } });
  assert.deepEqual(
    await expiredBridge.registerBusinessLead({ grant, contactName: "Ana Prospect", contactPhone: "+55 11 90000-0000" }),
    { outcome: "rejected", code: "grant_expired" },
  );
});

test("business action bridge replays a succeeded receipt idempotently", async () => {
  const grant = {
    tenantId: IDS[0], agentId: IDS[1], sessionId: IDS[2], presenterId: IDS[3],
    actionKind: "register_lead", grantId: IDS[5], generationId: 0, commandFingerprint: "c".repeat(64),
  };
  const { bridge, calls } = fakeBridge({ registration: { outcome: "succeeded", leadId: IDS[6] } });
  const first = await bridge.registerBusinessLead({ grant, contactName: "Ana Prospect", contactEmail: "ana@example.test" });
  const second = await bridge.registerBusinessLead({ grant, contactName: "Ana Prospect", contactEmail: "ana@example.test" });
  assert.deepEqual(first, { outcome: "registered", code: "registered", leadId: IDS[6] });
  assert.deepEqual(second, first);
  assert.equal(calls.length, 2, "the RPC is invoked twice; the database is what makes the second call idempotent");
});

test("business action bridge rejects register_lead without contactEmail or contactPhone before any RPC", async () => {
  const grant = {
    tenantId: IDS[0], agentId: IDS[1], sessionId: IDS[2], presenterId: IDS[3],
    actionKind: "register_lead", grantId: IDS[5], generationId: 0, commandFingerprint: "d".repeat(64),
  };
  const { bridge, calls } = fakeBridge();
  await assert.rejects(
    bridge.registerBusinessLead({ grant, contactName: "Ana Prospect" }),
    /register_lead requires contactEmail or contactPhone/,
  );
  assert.equal(calls.length, 0);
});

test("business action bridge rejects a malformed commandId before any RPC", async () => {
  const { bridge, calls } = fakeBridge();
  await assert.rejects(bridge.admitBusinessAction(admissionInput({ commandId: "not-a-uuid" })), /commandId must be a UUID/);
  assert.equal(calls.length, 0);
});
