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

function fakeBridge({ admission = null, registration = null, proposal = null, reservation = null, idGenerator = null } = {}) {
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
      if (name === "portal_propose_business_meeting_slots_service") return {
        data: proposal ?? { outcome: "succeeded", proposalId: parameters.p_proposal_id, receiptId: parameters.p_receipt_id },
        error: null,
      };
      if (name === "portal_reserve_business_meeting_slot_service") return {
        data: reservation ?? {
          outcome: "reserved", reservationId: parameters.p_reservation_id, state: "reserved",
          googleEventId: parameters.p_reservation_id.replaceAll("-", ""), googleCalendarId: "primary",
          startAt: "2026-09-01T13:00:00.000Z", endAt: "2026-09-01T13:30:00.000Z", timezone: "America/Sao_Paulo",
        },
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

function meetingSlotsGrant(overrides = {}) {
  return {
    tenantId: IDS[0], agentId: IDS[1], sessionId: IDS[2], presenterId: IDS[3],
    actionKind: "propose_meeting_slots", grantId: IDS[5], generationId: 0, commandFingerprint: "e".repeat(64),
    ...overrides,
  };
}

function confirmSlotGrant(overrides = {}) {
  return {
    tenantId: IDS[0], agentId: IDS[1], sessionId: IDS[2], presenterId: IDS[3],
    actionKind: "confirm_meeting_slot", grantId: IDS[5], generationId: 0, commandFingerprint: "f".repeat(64),
    ...overrides,
  };
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

// ---------------------------------------------------------------------------
// proposeBusinessMeetingSlots (ADR-041)
// ---------------------------------------------------------------------------

const SLOT_A = "019b0000-0000-7000-8000-000000000101";
const SLOT_B = "019b0000-0000-7000-8000-000000000102";

test("proposeBusinessMeetingSlots persists the already-computed slots and returns the proposalId", async () => {
  const { bridge, calls } = fakeBridge();
  const grant = meetingSlotsGrant();
  const result = await bridge.proposeBusinessMeetingSlots({
    grant, durationMinutes: 30, timezone: "America/Sao_Paulo",
    slots: [
      { id: SLOT_A, startAt: "2026-09-01T13:00:00.000Z", endAt: "2026-09-01T13:30:00.000Z" },
      { id: SLOT_B, startAt: "2026-09-01T14:00:00.000Z", endAt: "2026-09-01T14:30:00.000Z" },
    ],
    contactName: "Ana Prospect", contactEmail: "ana@example.test",
  });
  assert.equal(result.outcome, "proposed");
  if (result.outcome !== "proposed") return assert.fail("expected proposed");
  const call = calls.find((entry) => entry.name === "portal_propose_business_meeting_slots_service");
  assert.ok(call);
  assert.equal(call.parameters.p_grant_id, grant.grantId);
  assert.equal(call.parameters.p_duration_minutes, 30);
  assert.equal(call.parameters.p_timezone, "America/Sao_Paulo");
  assert.deepEqual(call.parameters.p_slots, [
    { id: SLOT_A, startAt: "2026-09-01T13:00:00.000Z", endAt: "2026-09-01T13:30:00.000Z" },
    { id: SLOT_B, startAt: "2026-09-01T14:00:00.000Z", endAt: "2026-09-01T14:30:00.000Z" },
  ]);
  assert.equal(call.parameters.p_contact_name, "Ana Prospect");
  assert.equal(call.parameters.p_contact_email, "ana@example.test");
  assert.equal(result.proposalId, call.parameters.p_proposal_id);
});

test("proposeBusinessMeetingSlots fails closed before any RPC when the flag is off", async () => {
  const disabledBridge = createPortalBusinessActionBridge({ env: {}, rpc: { rpc: () => { throw new Error("must not be called"); } } });
  const result = await disabledBridge.proposeBusinessMeetingSlots({
    grant: meetingSlotsGrant(), durationMinutes: 30, timezone: "America/Sao_Paulo",
    slots: [{ id: SLOT_A, startAt: "2026-09-01T13:00:00.000Z", endAt: "2026-09-01T13:30:00.000Z" }],
  });
  assert.deepEqual(result, { outcome: "rejected", code: "bridge_disabled" });
});

test("proposeBusinessMeetingSlots rejects a grant whose actionKind is not propose_meeting_slots, before any RPC", async () => {
  const { bridge, calls } = fakeBridge();
  await assert.rejects(
    bridge.proposeBusinessMeetingSlots({
      grant: meetingSlotsGrant({ actionKind: "register_lead" }), durationMinutes: 30, timezone: "America/Sao_Paulo",
      slots: [{ id: SLOT_A, startAt: "2026-09-01T13:00:00.000Z", endAt: "2026-09-01T13:30:00.000Z" }],
    }),
    /grant\.actionKind must be propose_meeting_slots/,
  );
  assert.equal(calls.length, 0);
});

test("proposeBusinessMeetingSlots rejects a duration outside the closed allowlist, before any RPC", async () => {
  const { bridge, calls } = fakeBridge();
  await assert.rejects(
    bridge.proposeBusinessMeetingSlots({
      grant: meetingSlotsGrant(), durationMinutes: 20, timezone: "America/Sao_Paulo",
      slots: [{ id: SLOT_A, startAt: "2026-09-01T13:00:00.000Z", endAt: "2026-09-01T13:30:00.000Z" }],
    }),
    /durationMinutes is invalid/,
  );
  assert.equal(calls.length, 0);
});

test("proposeBusinessMeetingSlots rejects an unbounded timezone string, before any RPC", async () => {
  const { bridge, calls } = fakeBridge();
  await assert.rejects(
    bridge.proposeBusinessMeetingSlots({
      grant: meetingSlotsGrant(), durationMinutes: 30, timezone: "not a timezone",
      slots: [{ id: SLOT_A, startAt: "2026-09-01T13:00:00.000Z", endAt: "2026-09-01T13:30:00.000Z" }],
    }),
    /timezone is invalid/,
  );
  assert.equal(calls.length, 0);
});

test("proposeBusinessMeetingSlots rejects a duplicate slot id, before any RPC", async () => {
  const { bridge, calls } = fakeBridge();
  await assert.rejects(
    bridge.proposeBusinessMeetingSlots({
      grant: meetingSlotsGrant(), durationMinutes: 30, timezone: "America/Sao_Paulo",
      slots: [
        { id: SLOT_A, startAt: "2026-09-01T13:00:00.000Z", endAt: "2026-09-01T13:30:00.000Z" },
        { id: SLOT_A, startAt: "2026-09-01T14:00:00.000Z", endAt: "2026-09-01T14:30:00.000Z" },
      ],
    }),
    /duplicate slot id/,
  );
  assert.equal(calls.length, 0);
});

test("proposeBusinessMeetingSlots rejects a slot whose endAt is not after startAt, before any RPC", async () => {
  const { bridge, calls } = fakeBridge();
  await assert.rejects(
    bridge.proposeBusinessMeetingSlots({
      grant: meetingSlotsGrant(), durationMinutes: 30, timezone: "America/Sao_Paulo",
      slots: [{ id: SLOT_A, startAt: "2026-09-01T13:30:00.000Z", endAt: "2026-09-01T13:00:00.000Z" }],
    }),
    /slot startAt\/endAt is invalid/,
  );
  assert.equal(calls.length, 0);
});

test("proposeBusinessMeetingSlots maps declared RPC rejection reasons verbatim and defaults an unknown reason to grant_invalid", async () => {
  for (const reason of ["kill_switch_active", "grant_expired", "grant_scope_mismatch"]) {
    const { bridge } = fakeBridge({ proposal: { outcome: "rejected", reason } });
    const result = await bridge.proposeBusinessMeetingSlots({
      grant: meetingSlotsGrant(), durationMinutes: 30, timezone: "America/Sao_Paulo",
      slots: [{ id: SLOT_A, startAt: "2026-09-01T13:00:00.000Z", endAt: "2026-09-01T13:30:00.000Z" }],
    });
    assert.deepEqual(result, { outcome: "rejected", code: reason });
  }
  const { bridge: unknownReasonBridge } = fakeBridge({ proposal: { outcome: "rejected", reason: "something_new" } });
  const unknownResult = await unknownReasonBridge.proposeBusinessMeetingSlots({
    grant: meetingSlotsGrant(), durationMinutes: 30, timezone: "America/Sao_Paulo",
    slots: [{ id: SLOT_A, startAt: "2026-09-01T13:00:00.000Z", endAt: "2026-09-01T13:30:00.000Z" }],
  });
  assert.deepEqual(unknownResult, { outcome: "rejected", code: "grant_invalid" });
});

// ---------------------------------------------------------------------------
// reserveBusinessMeetingSlot (ADR-041)
// ---------------------------------------------------------------------------

test("reserveBusinessMeetingSlot returns a reserved receipt but never claims a Google Calendar event exists", async () => {
  const { bridge, calls } = fakeBridge();
  const grant = confirmSlotGrant();
  const result = await bridge.reserveBusinessMeetingSlot({
    grant, proposalId: IDS[8], slotId: SLOT_A, contactEmail: "ana@example.test", contactName: "Ana Prospect",
  });
  assert.equal(result.outcome, "reserved");
  if (result.outcome !== "reserved") return assert.fail("expected reserved");
  assert.equal(typeof result.googleEventId, "string");
  const call = calls.find((entry) => entry.name === "portal_reserve_business_meeting_slot_service");
  assert.equal(call.parameters.p_proposal_id, IDS[8]);
  assert.equal(call.parameters.p_slot_id, SLOT_A);
  assert.equal(call.parameters.p_contact_email, "ana@example.test");
});

test("reserveBusinessMeetingSlot replays an existing reservation idempotently by grant_id", async () => {
  const { bridge } = fakeBridge({ reservation: { outcome: "replayed", reservationId: IDS[9], state: "reserved", googleEventId: "abc123" } });
  const result = await bridge.reserveBusinessMeetingSlot({
    grant: confirmSlotGrant(), proposalId: IDS[8], slotId: SLOT_A, contactEmail: "ana@example.test",
  });
  assert.deepEqual(result, { outcome: "replayed", code: "replayed", reservationId: IDS[9], state: "reserved", googleEventId: "abc123" });
});

test("reserveBusinessMeetingSlot propagates auto_confirm_disabled instead of assuming success -- the only outcome reachable today per ADR-041", async () => {
  const { bridge } = fakeBridge({ reservation: { outcome: "rejected", reason: "auto_confirm_disabled" } });
  const result = await bridge.reserveBusinessMeetingSlot({
    grant: confirmSlotGrant(), proposalId: IDS[8], slotId: SLOT_A, contactEmail: "ana@example.test",
  });
  assert.deepEqual(result, { outcome: "rejected", code: "auto_confirm_disabled" });
});

test("reserveBusinessMeetingSlot maps every declared RPC rejection reason verbatim", async () => {
  for (const reason of ["kill_switch_active", "grant_expired", "grant_scope_mismatch", "proposal_not_found", "proposal_expired", "slot_not_offered", "calendar_not_connected", "slot_conflict"]) {
    const { bridge } = fakeBridge({ reservation: { outcome: "rejected", reason } });
    const result = await bridge.reserveBusinessMeetingSlot({
      grant: confirmSlotGrant(), proposalId: IDS[8], slotId: SLOT_A, contactEmail: "ana@example.test",
    });
    assert.deepEqual(result, { outcome: "rejected", code: reason });
  }
});

test("reserveBusinessMeetingSlot defaults an undeclared rejection reason to grant_invalid, and a wholly unexpected RPC outcome to service_unavailable", async () => {
  const { bridge: undeclaredReasonBridge } = fakeBridge({ reservation: { outcome: "rejected", reason: "something_new" } });
  const undeclaredResult = await undeclaredReasonBridge.reserveBusinessMeetingSlot({
    grant: confirmSlotGrant(), proposalId: IDS[8], slotId: SLOT_A, contactEmail: "ana@example.test",
  });
  assert.deepEqual(undeclaredResult, { outcome: "rejected", code: "grant_invalid" });

  const { bridge: unexpectedOutcomeBridge } = fakeBridge({ reservation: { outcome: "something_else" } });
  const unexpectedResult = await unexpectedOutcomeBridge.reserveBusinessMeetingSlot({
    grant: confirmSlotGrant(), proposalId: IDS[8], slotId: SLOT_A, contactEmail: "ana@example.test",
  });
  assert.deepEqual(unexpectedResult, { outcome: "rejected", code: "service_unavailable" });
});

test("reserveBusinessMeetingSlot fails closed before any RPC when the flag is off", async () => {
  const disabledBridge = createPortalBusinessActionBridge({ env: {}, rpc: { rpc: () => { throw new Error("must not be called"); } } });
  const result = await disabledBridge.reserveBusinessMeetingSlot({
    grant: confirmSlotGrant(), proposalId: IDS[8], slotId: SLOT_A, contactEmail: "ana@example.test",
  });
  assert.deepEqual(result, { outcome: "rejected", code: "bridge_disabled" });
});

test("reserveBusinessMeetingSlot rejects a grant whose actionKind is not confirm_meeting_slot, before any RPC", async () => {
  const { bridge, calls } = fakeBridge();
  await assert.rejects(
    bridge.reserveBusinessMeetingSlot({
      grant: confirmSlotGrant({ actionKind: "propose_meeting_slots" }), proposalId: IDS[8], slotId: SLOT_A, contactEmail: "ana@example.test",
    }),
    /grant\.actionKind must be confirm_meeting_slot/,
  );
  assert.equal(calls.length, 0);
});

test("reserveBusinessMeetingSlot rejects an invalid contactEmail, before any RPC", async () => {
  const { bridge, calls } = fakeBridge();
  await assert.rejects(
    bridge.reserveBusinessMeetingSlot({
      grant: confirmSlotGrant(), proposalId: IDS[8], slotId: SLOT_A, contactEmail: "not-an-email",
    }),
    /contactEmail is invalid/,
  );
  assert.equal(calls.length, 0);
});
