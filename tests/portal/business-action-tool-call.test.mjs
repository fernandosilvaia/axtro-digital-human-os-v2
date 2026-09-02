import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { test } from "node:test";

import ts from "typescript";

import { formatDateTime } from "../../apps/portal/src/lib/format-date.ts";
import { deterministicBusinessActionCommandId } from "../../apps/portal/src/lib/runtime/business-action-command-id.ts";
import { isBusinessActionToolName } from "../../apps/portal/src/lib/runtime/tool-call-names.ts";

/**
 * ADR-041, "O funil ponta a ponta de uma tool call de negócio". Server
 * Action com "use server" + imports por alias @/ -- mesmo mecanismo de
 * calendar-connection.test.mjs/billing-action-runtime.test.mjs:
 * ts.transpileModule + vm.Script com um require fake, porque um import()
 * direto não resolve o alias @/ fora do bundler do Next (confirmado: um
 * import() direto deste arquivo falha com ERR_MODULE_NOT_FOUND antes de
 * qualquer coisa relacionada a esta ADR).
 *
 * deterministicBusinessActionCommandId e isBusinessActionToolName entram
 * REAIS (não fakes) no require mock: são funções puras já cobertas pelos
 * próprios testes unitários delas (business-action-command-id.test.mjs,
 * tool-call-names.test.mjs); usá-las de verdade aqui é o que deixa os
 * testes de replay/commandId-diferente abaixo genuínos, não uma simulação.
 */
const actionSource = await readFile(
  new URL("../../apps/portal/src/lib/actions/business-action-tool-call.ts", import.meta.url),
  "utf8",
);

/**
 * Objetos devolvidos pelo código compilado dentro de vm.runInNewContext vêm
 * de outro realm V8 (outro Object.prototype) -- assert.deepEqual falharia
 * por identidade de protótipo mesmo com o shape idêntico (mesmo aviso já
 * registrado em calendar-connection.test.mjs); comparação por propriedade é
 * o padrão certo aqui.
 */
function assertResult(actual, expected) {
  assert.equal(actual.status, expected.status);
  assert.equal(actual.output, expected.output);
}

const TENANT_ID = "019b0000-0000-7000-8000-000000000001";
const AGENT_ID = "019b0000-0000-7000-8000-000000000002";
const SESSION_ID = "019b0000-0000-7000-8000-000000000003";
const PRESENTER_ID = "019b0000-0000-7000-8000-000000000004";
const GRANT_ID = "019b0000-0000-7000-8000-000000000005";
const LEAD_ID = "019b0000-0000-7000-8000-000000000006";
const PROPOSAL_ID = "019b0000-0000-7000-8000-000000000007";
const RECEIPT_ID = "019b0000-0000-7000-8000-000000000008";
const SLOT_ID = "019b0000-0000-7000-8000-000000000009";
const RESERVATION_ID = "019b0000-0000-7000-8000-00000000000a";
const DEFAULT_PROPOSED_SLOTS = [
  { id: "019b0000-0000-7000-8000-000000000101", startAt: "2026-09-02T13:00:00.000Z", endAt: "2026-09-02T13:30:00.000Z", timezone: "America/Sao_Paulo" },
  { id: "019b0000-0000-7000-8000-000000000102", startAt: "2026-09-02T14:00:00.000Z", endAt: "2026-09-02T14:30:00.000Z", timezone: "America/Sao_Paulo" },
];

function defaultGrant(input) {
  return {
    tenantId: input.tenantId,
    agentId: input.agentId,
    sessionId: input.sessionId,
    presenterId: input.presenterId,
    actionKind: input.actionKind,
    grantId: GRANT_ID,
    generationId: input.generation ?? 0,
    commandFingerprint: "a".repeat(64),
  };
}

function loadBusinessActionToolCall(options = {}) {
  const calls = { fetchOverview: 0, fetchAgents: 0, liveContext: [], admit: [], registerLead: [], proposeMeetingSlots: [], resolveSlot: [], reserveSlot: [] };
  const overview = options.overview ?? { provisioned: true, tenant: { id: TENANT_ID } };
  const agents = options.agents ?? [{ id: AGENT_ID }];
  const liveContextResult = options.liveContextResult ?? {
    outcome: "found",
    context: { sessionId: SESSION_ID, presenterId: PRESENTER_ID, generation: 0 },
  };

  const mocks = new Map([
    ["@/lib/paid-effects", {
      // Fake propositalmente simples (não é o sha256 real de paid-effects/index.ts):
      // só precisa ser determinístico por (commandId, discriminator) para os
      // testes de idempotência abaixo fazerem sentido; a chave real já tem
      // cobertura própria em paid-effect-intents.test.mjs.
      paidEffectIntentKey(commandId, discriminator) {
        return `${commandId}:${discriminator}`;
      },
    }],
    ["@/lib/portal-data", {
      async fetchTenantOverview() {
        calls.fetchOverview += 1;
        return overview;
      },
      async fetchAgents() {
        calls.fetchAgents += 1;
        return agents;
      },
    }],
    ["@/lib/runtime/business-action-command-id", {
      deterministicBusinessActionCommandId,
    }],
    ["@/lib/runtime/tool-call-names", {
      isBusinessActionToolName,
    }],
    ["@/lib/runtime/portal-live-call-context", {
      async resolveLiveBusinessActionCallContext(input) {
        calls.liveContext.push(input);
        return typeof options.liveContext === "function" ? options.liveContext(input) : liveContextResult;
      },
    }],
    ["@/lib/runtime/portal-business-action-bridge", {
      async admitBusinessAction(input) {
        calls.admit.push(input);
        if (typeof options.admit === "function") return options.admit(input, calls.admit.length);
        return options.admissionResult ?? { outcome: "issued", code: "issued", grant: defaultGrant(input) };
      },
      async registerBusinessLead(input) {
        calls.registerLead.push(input);
        if (typeof options.registerLead === "function") return options.registerLead(input);
        return options.registerLeadResult ?? { outcome: "registered", code: "registered", leadId: LEAD_ID };
      },
      async resolveBusinessActionMeetingSlot(input) {
        calls.resolveSlot.push(input);
        if (typeof options.resolveSlot === "function") return options.resolveSlot(input);
        return options.resolveSlotResult ?? { outcome: "found", slotId: SLOT_ID, startAt: DEFAULT_PROPOSED_SLOTS[0].startAt, endAt: DEFAULT_PROPOSED_SLOTS[0].endAt, timezone: DEFAULT_PROPOSED_SLOTS[0].timezone };
      },
      async reserveBusinessMeetingSlot(input) {
        calls.reserveSlot.push(input);
        if (typeof options.reserveSlot === "function") return options.reserveSlot(input);
        return options.reserveSlotResult ?? {
          outcome: "reserved", code: "reserved", reservationId: RESERVATION_ID, googleEventId: "google-event-1", googleCalendarId: null,
          startAt: DEFAULT_PROPOSED_SLOTS[0].startAt, endAt: DEFAULT_PROPOSED_SLOTS[0].endAt, timezone: DEFAULT_PROPOSED_SLOTS[0].timezone,
        };
      },
    }],
    ["@/lib/google-calendar/propose-meeting-slots", {
      async proposeGoogleCalendarMeetingSlots(input) {
        calls.proposeMeetingSlots.push(input);
        if (typeof options.proposeMeetingSlots === "function") return options.proposeMeetingSlots(input);
        return options.proposeMeetingSlotsResult ?? { outcome: "succeeded", proposalId: PROPOSAL_ID, receiptId: RECEIPT_ID, slots: DEFAULT_PROPOSED_SLOTS };
      },
    }],
    ["@/lib/format-date", { formatDateTime }],
  ]);

  const compiled = ts.transpileModule(actionSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: "business-action-tool-call.ts",
  }).outputText;
  const moduleObj = { exports: {} };
  const requireMock = (specifier) => {
    const resolved = mocks.get(specifier);
    if (resolved === undefined) throw new Error(`Unexpected business-action-tool-call import: ${specifier}`);
    return resolved;
  };
  const wrapper = new vm.Script(`(function (require, module, exports) { ${compiled}\n})`, {
    filename: "business-action-tool-call.runtime.cjs",
  });
  // NÃO passe Object/Error/String/Date explicitamente aqui: o código
  // compilado faz JSON.parse(...) e depois Object.getPrototypeOf(x) ===
  // Object.prototype (isPlainObject) -- se Object vier do realm de FORA do
  // vm (este processo de teste) mas o objeto vier de dentro (outro realm,
  // criado pelo JSON.parse do PRÓPRIO vm), a comparação falha sempre,
  // mesmo com shape idêntico (confirmado author-side com um repro isolado
  // antes de fixar isto). Sem overrides, o vm auto-popula um conjunto
  // consistente de intrínsecos do MESMO realm; só process/setTimeout
  // precisam ser injetados (são globais do Node, não da linguagem).
  wrapper.runInNewContext({ process, setTimeout })(requireMock, moduleObj, moduleObj.exports);
  return { actions: moduleObj.exports, calls };
}

// ---------------------------------------------------------------------------
// register_lead
// ---------------------------------------------------------------------------

test("register_lead succeeds end to end and returns the literal ADR-041 success text", async () => {
  const { actions, calls } = loadBusinessActionToolCall();
  const result = await actions.executeBusinessActionToolCall(
    AGENT_ID, "019b0000-0000-7000-8000-0000000000c1", "presentation", "register_lead", "tavus-call-1",
    JSON.stringify({ contactName: "Ana Prospect", contactEmail: "ana@example.test" }),
  );
  assertResult(result, { status: "success", output: "Lead registrado." });
  assert.equal(calls.admit.length, 1);
  assert.equal(calls.admit[0].actionKind, "register_lead");
  assert.equal(calls.registerLead.length, 1);
  assert.equal(calls.registerLead[0].contactName, "Ana Prospect");
  assert.equal(calls.registerLead[0].contactEmail, "ana@example.test");
});

test("register_lead accepts a string JSON arguments payload (Tavus sends properties.arguments as a string)", async () => {
  const { actions } = loadBusinessActionToolCall();
  const result = await actions.executeBusinessActionToolCall(
    AGENT_ID, "019b0000-0000-7000-8000-0000000000c1", "presentation", "register_lead", "tavus-call-1",
    JSON.stringify({ contactName: "Ana Prospect", contactPhone: "+55 11 90000-0000" }),
  );
  assert.equal(result.status, "success");
});

test("register_lead admission rejection never reaches registerBusinessLead and maps to the Handoff text", async () => {
  const { actions, calls } = loadBusinessActionToolCall({ admissionResult: { outcome: "rejected", code: "denied_purpose_consent" } });
  const result = await actions.executeBusinessActionToolCall(
    AGENT_ID, "019b0000-0000-7000-8000-0000000000c1", "presentation", "register_lead", "tavus-call-1",
    JSON.stringify({ contactName: "Ana Prospect", contactEmail: "ana@example.test" }),
  );
  assertResult(result, { status: "error", output: "Ação indisponível agora. Ofereça transferir para o time humano, com a doutrina de handoff já definida." });
  assert.equal(calls.registerLead.length, 0);
});

test("register_lead registration rejection maps to the Handoff text", async () => {
  const { actions } = loadBusinessActionToolCall({ registerLeadResult: { outcome: "rejected", code: "grant_expired" } });
  const result = await actions.executeBusinessActionToolCall(
    AGENT_ID, "019b0000-0000-7000-8000-0000000000c1", "presentation", "register_lead", "tavus-call-1",
    JSON.stringify({ contactName: "Ana Prospect", contactEmail: "ana@example.test" }),
  );
  assertResult(result, { status: "error", output: "Ação indisponível agora. Ofereça transferir para o time humano, com a doutrina de handoff já definida." });
});

// ---------------------------------------------------------------------------
// propose_meeting_slots
// ---------------------------------------------------------------------------

test("propose_meeting_slots succeeds and returns a formatted, 0-based-indexed slot list for the model to read aloud", async () => {
  const { actions, calls } = loadBusinessActionToolCall();
  const result = await actions.executeBusinessActionToolCall(
    AGENT_ID, "019b0000-0000-7000-8000-0000000000c1", "presentation", "propose_meeting_slots", "tavus-call-1",
    JSON.stringify({ durationMinutes: 30, contactName: "Ana Prospect", contactEmail: "ana@example.test" }),
  );
  assert.equal(result.status, "success");
  assert.equal(
    result.output,
    `Horários disponíveis:\nHorário 0: ${formatDateTime(DEFAULT_PROPOSED_SLOTS[0].startAt, DEFAULT_PROPOSED_SLOTS[0].timezone)}\nHorário 1: ${formatDateTime(DEFAULT_PROPOSED_SLOTS[1].startAt, DEFAULT_PROPOSED_SLOTS[1].timezone)}`,
  );
  assert.equal(calls.proposeMeetingSlots.length, 1);
  assert.equal(calls.proposeMeetingSlots[0].grantId, GRANT_ID, "the grant issued by admission must flow into the calendar orchestration, never a fresh/fabricated id");
  assert.equal(calls.proposeMeetingSlots[0].durationMinutes, 30);
  assert.equal(calls.proposeMeetingSlots[0].contactEmail, "ana@example.test");
});

test("propose_meeting_slots is admitted (grant recorded) even when the calendar RPC itself is never reached because it rejects", async () => {
  const { actions, calls } = loadBusinessActionToolCall({ proposeMeetingSlotsResult: { outcome: "rejected", reason: "grant_expired" } });
  const result = await actions.executeBusinessActionToolCall(
    AGENT_ID, "019b0000-0000-7000-8000-0000000000c1", "presentation", "propose_meeting_slots", "tavus-call-1",
    JSON.stringify({ durationMinutes: 30 }),
  );
  assertResult(result, { status: "error", output: "Ação indisponível agora. Ofereça transferir para o time humano, com a doutrina de handoff já definida." });
  assert.equal(calls.admit.length, 1, "the grant is still recorded even though the calendar RPC itself rejects");
  assert.equal(calls.admit[0].actionKind, "propose_meeting_slots");
});

for (const outcome of ["not_connected", "no_availability", "reauth_required", "service_unavailable"]) {
  test(`propose_meeting_slots maps a declared "${outcome}" outcome to Handoff -- none of these are retryable by calling propose_meeting_slots again with different arguments`, async () => {
    const { actions } = loadBusinessActionToolCall({ proposeMeetingSlotsResult: { outcome } });
    const result = await actions.executeBusinessActionToolCall(
      AGENT_ID, "019b0000-0000-7000-8000-0000000000c1", "presentation", "propose_meeting_slots", "tavus-call-1",
      JSON.stringify({ durationMinutes: 30 }),
    );
    assertResult(result, { status: "error", output: "Ação indisponível agora. Ofereça transferir para o time humano, com a doutrina de handoff já definida." });
  });
}

// ---------------------------------------------------------------------------
// confirm_meeting_slot
// ---------------------------------------------------------------------------

test("confirm_meeting_slot resolves the model's 0-based slotIndex to a real slotId before reserving, and its genuine reservation is still Handoff this wave (ADR-041: auto_confirm_scheduling is false for every tenant today)", async () => {
  const { actions, calls } = loadBusinessActionToolCall();
  const result = await actions.executeBusinessActionToolCall(
    AGENT_ID, "019b0000-0000-7000-8000-0000000000c1", "presentation", "confirm_meeting_slot", "tavus-call-1",
    JSON.stringify({ proposalId: PROPOSAL_ID, slotIndex: 0, contactEmail: "ana@example.test" }),
  );
  assertResult(result, { status: "error", output: "Ação indisponível agora. Ofereça transferir para o time humano, com a doutrina de handoff já definida." });
  assert.equal(calls.resolveSlot.length, 1);
  assert.equal(calls.resolveSlot[0].proposalId, PROPOSAL_ID);
  assert.equal(calls.resolveSlot[0].slotIndex, 0);
  assert.equal(calls.reserveSlot.length, 1);
  assert.equal(calls.reserveSlot[0].slotId, SLOT_ID, "the resolved slotId, never the model's raw slotIndex, must reach reserveBusinessMeetingSlot");
  assert.equal(calls.reserveSlot[0].proposalId, PROPOSAL_ID);
  assert.equal(calls.reserveSlot[0].contactEmail, "ana@example.test");
});

test("confirm_meeting_slot treats a replayed reservation the same as a fresh one -- still Handoff, never a fabricated success text", async () => {
  const { actions } = loadBusinessActionToolCall({
    reserveSlotResult: { outcome: "replayed", code: "replayed", reservationId: RESERVATION_ID, state: "reserved", googleEventId: null },
  });
  const result = await actions.executeBusinessActionToolCall(
    AGENT_ID, "019b0000-0000-7000-8000-0000000000c1", "presentation", "confirm_meeting_slot", "tavus-call-1",
    JSON.stringify({ proposalId: PROPOSAL_ID, slotIndex: 0, contactEmail: "ana@example.test" }),
  );
  assertResult(result, { status: "error", output: "Ação indisponível agora. Ofereça transferir para o time humano, com a doutrina de handoff já definida." });
});

test("confirm_meeting_slot maps an unresolved slotIndex/proposal (0060's anti-oracle not_found) to the retryable text, and never calls reserveBusinessMeetingSlot", async () => {
  const { actions, calls } = loadBusinessActionToolCall({ resolveSlotResult: { outcome: "not_found" } });
  const result = await actions.executeBusinessActionToolCall(
    AGENT_ID, "019b0000-0000-7000-8000-0000000000c1", "presentation", "confirm_meeting_slot", "tavus-call-1",
    JSON.stringify({ proposalId: PROPOSAL_ID, slotIndex: 3, contactEmail: "ana@example.test" }),
  );
  assertResult(result, { status: "error", output: "Esse horário não está mais disponível. Ofereça consultar novos horários com propose_meeting_slots." });
  assert.equal(calls.reserveSlot.length, 0);
});

test("confirm_meeting_slot maps a resolve-layer service_unavailable to Handoff, and never calls reserveBusinessMeetingSlot", async () => {
  const { actions, calls } = loadBusinessActionToolCall({ resolveSlotResult: { outcome: "service_unavailable" } });
  const result = await actions.executeBusinessActionToolCall(
    AGENT_ID, "019b0000-0000-7000-8000-0000000000c1", "presentation", "confirm_meeting_slot", "tavus-call-1",
    JSON.stringify({ proposalId: PROPOSAL_ID, slotIndex: 0, contactEmail: "ana@example.test" }),
  );
  assertResult(result, { status: "error", output: "Ação indisponível agora. Ofereça transferir para o time humano, com a doutrina de handoff já definida." });
  assert.equal(calls.reserveSlot.length, 0);
});

test("confirm_meeting_slot maps reserveBusinessMeetingSlot's slot_conflict rejection to the retryable text", async () => {
  const { actions } = loadBusinessActionToolCall({ reserveSlotResult: { outcome: "rejected", code: "slot_conflict" } });
  const result = await actions.executeBusinessActionToolCall(
    AGENT_ID, "019b0000-0000-7000-8000-0000000000c1", "presentation", "confirm_meeting_slot", "tavus-call-1",
    JSON.stringify({ proposalId: PROPOSAL_ID, slotIndex: 0, contactEmail: "ana@example.test" }),
  );
  assertResult(result, { status: "error", output: "Esse horário não está mais disponível. Ofereça consultar novos horários com propose_meeting_slots." });
});

test("confirm_meeting_slot maps reserveBusinessMeetingSlot's calendar_not_connected rejection to Handoff", async () => {
  const { actions } = loadBusinessActionToolCall({ reserveSlotResult: { outcome: "rejected", code: "calendar_not_connected" } });
  const result = await actions.executeBusinessActionToolCall(
    AGENT_ID, "019b0000-0000-7000-8000-0000000000c1", "presentation", "confirm_meeting_slot", "tavus-call-1",
    JSON.stringify({ proposalId: PROPOSAL_ID, slotIndex: 0, contactEmail: "ana@example.test" }),
  );
  assertResult(result, { status: "error", output: "Ação indisponível agora. Ofereça transferir para o time humano, com a doutrina de handoff já definida." });
});

test("confirm_meeting_slot rejects a slotIndex above the table's own 0..49 bound before admission", async () => {
  const { actions, calls } = loadBusinessActionToolCall();
  const result = await actions.executeBusinessActionToolCall(
    AGENT_ID, "019b0000-0000-7000-8000-0000000000c1", "presentation", "confirm_meeting_slot", "tavus-call-1",
    JSON.stringify({ proposalId: PROPOSAL_ID, slotIndex: 50, contactEmail: "ana@example.test" }),
  );
  assert.equal(result.status, "error");
  assert.equal(calls.admit.length, 0);
});

// ---------------------------------------------------------------------------
// Contexto de sessão / tenant / agente
// ---------------------------------------------------------------------------

test("an agent that does not belong to the tenant never reaches the live call context lookup", async () => {
  const { actions, calls } = loadBusinessActionToolCall({ agents: [{ id: "019b0000-0000-7000-8000-0000000000ff" }] });
  const result = await actions.executeBusinessActionToolCall(
    AGENT_ID, "019b0000-0000-7000-8000-0000000000c1", "presentation", "register_lead", "tavus-call-1",
    JSON.stringify({ contactName: "Ana Prospect", contactEmail: "ana@example.test" }),
  );
  assertResult(result, { status: "error", output: "Ação indisponível agora. Ofereça transferir para o time humano, com a doutrina de handoff já definida." });
  assert.equal(calls.liveContext.length, 0);
});

test("session context not found maps to its own dedicated outcome text and never reaches admission", async () => {
  const { actions, calls } = loadBusinessActionToolCall({ liveContextResult: { outcome: "not_found" } });
  const result = await actions.executeBusinessActionToolCall(
    AGENT_ID, "019b0000-0000-7000-8000-0000000000c1", "presentation", "register_lead", "tavus-call-1",
    JSON.stringify({ contactName: "Ana Prospect", contactEmail: "ana@example.test" }),
  );
  assertResult(result, { status: "error", output: "Sessão desta chamada não está pronta para esta ação. Não repita a tentativa; ofereça o handoff." });
  assert.equal(calls.admit.length, 0);
});

test("a terminal session (already ended) also maps to the session-not-found text", async () => {
  const { actions } = loadBusinessActionToolCall({ liveContextResult: { outcome: "session_terminal" } });
  const result = await actions.executeBusinessActionToolCall(
    AGENT_ID, "019b0000-0000-7000-8000-0000000000c1", "presentation", "register_lead", "tavus-call-1",
    JSON.stringify({ contactName: "Ana Prospect", contactEmail: "ana@example.test" }),
  );
  assert.equal(result.output, "Sessão desta chamada não está pronta para esta ação. Não repita a tentativa; ofereça o handoff.");
});

test("the live call context is looked up with the same idempotency discriminator startVideoConversation/startPresentationConversation already use", async () => {
  const { actions, calls } = loadBusinessActionToolCall();
  await actions.executeBusinessActionToolCall(
    AGENT_ID, "019b0000-0000-7000-8000-0000000000c1", "video", "register_lead", "tavus-call-1",
    JSON.stringify({ contactName: "Ana Prospect", contactEmail: "ana@example.test" }),
  );
  await actions.executeBusinessActionToolCall(
    AGENT_ID, "019b0000-0000-7000-8000-0000000000c1", "presentation", "register_lead", "tavus-call-2",
    JSON.stringify({ contactName: "Ana Prospect", contactEmail: "ana@example.test" }),
  );
  assert.equal(calls.liveContext[0].idempotencyKey, "019b0000-0000-7000-8000-0000000000c1:tavus:video");
  assert.equal(calls.liveContext[1].idempotencyKey, "019b0000-0000-7000-8000-0000000000c1:tavus:presentation");
});

// ---------------------------------------------------------------------------
// Argumentos: parse e schema
// ---------------------------------------------------------------------------

test("a malformed JSON string argument never reaches admission and maps to Handoff", async () => {
  const { actions, calls } = loadBusinessActionToolCall();
  const result = await actions.executeBusinessActionToolCall(
    AGENT_ID, "019b0000-0000-7000-8000-0000000000c1", "presentation", "register_lead", "tavus-call-1",
    "{not valid json",
  );
  assertResult(result, { status: "error", output: "Ação indisponível agora. Ofereça transferir para o time humano, com a doutrina de handoff já definida." });
  assert.equal(calls.admit.length, 0);
});

test("an argument outside the register_lead schema (missing contactName) never reaches admission", async () => {
  const { actions, calls } = loadBusinessActionToolCall();
  const result = await actions.executeBusinessActionToolCall(
    AGENT_ID, "019b0000-0000-7000-8000-0000000000c1", "presentation", "register_lead", "tavus-call-1",
    JSON.stringify({ contactEmail: "ana@example.test" }),
  );
  assertResult(result, { status: "error", output: "Ação indisponível agora. Ofereça transferir para o time humano, com a doutrina de handoff já definida." });
  assert.equal(calls.admit.length, 0);
});

test("register_lead with neither contactEmail nor contactPhone is a schema violation, not an internal exception", async () => {
  const { actions, calls } = loadBusinessActionToolCall();
  const result = await actions.executeBusinessActionToolCall(
    AGENT_ID, "019b0000-0000-7000-8000-0000000000c1", "presentation", "register_lead", "tavus-call-1",
    JSON.stringify({ contactName: "Ana Prospect" }),
  );
  assert.equal(result.status, "error");
  assert.equal(calls.admit.length, 0);
});

test("propose_meeting_slots rejects a durationMinutes outside the closed enum before admission", async () => {
  const { actions, calls } = loadBusinessActionToolCall();
  const result = await actions.executeBusinessActionToolCall(
    AGENT_ID, "019b0000-0000-7000-8000-0000000000c1", "presentation", "propose_meeting_slots", "tavus-call-1",
    JSON.stringify({ durationMinutes: 20 }),
  );
  assert.equal(result.status, "error");
  assert.equal(calls.admit.length, 0);
});

test("confirm_meeting_slot rejects a negative slotIndex before admission", async () => {
  const { actions, calls } = loadBusinessActionToolCall();
  const result = await actions.executeBusinessActionToolCall(
    AGENT_ID, "019b0000-0000-7000-8000-0000000000c1", "presentation", "confirm_meeting_slot", "tavus-call-1",
    JSON.stringify({ proposalId: "proposal-1", slotIndex: -1, contactEmail: "ana@example.test" }),
  );
  assert.equal(result.status, "error");
  assert.equal(calls.admit.length, 0);
});

test("a toolName that is not a business action name is treated defensively as Handoff (dispatcher already filters this in practice)", async () => {
  const { actions, calls } = loadBusinessActionToolCall();
  const result = await actions.executeBusinessActionToolCall(
    AGENT_ID, "019b0000-0000-7000-8000-0000000000c1", "presentation", "next_slide", "tavus-call-1", "{}",
  );
  assert.equal(result.status, "error");
  assert.equal(calls.admit.length, 0);
});

// ---------------------------------------------------------------------------
// Idempotência: mesmo tool_call_id replaya, tool_call_id novo deriva outro commandId
// ---------------------------------------------------------------------------

test("the same tool_call_id always derives the same admission commandId (a Daily data channel retry replays, never duplicates)", async () => {
  const { actions, calls } = loadBusinessActionToolCall({
    admit(input, callNumber) {
      return { outcome: callNumber === 1 ? "issued" : "replayed", code: callNumber === 1 ? "issued" : "replayed", grant: defaultGrant(input) };
    },
  });
  const first = await actions.executeBusinessActionToolCall(
    AGENT_ID, "019b0000-0000-7000-8000-0000000000c1", "presentation", "register_lead", "same-tool-call-id",
    JSON.stringify({ contactName: "Ana Prospect", contactEmail: "ana@example.test" }),
  );
  const second = await actions.executeBusinessActionToolCall(
    AGENT_ID, "019b0000-0000-7000-8000-0000000000c1", "presentation", "register_lead", "same-tool-call-id",
    JSON.stringify({ contactName: "Ana Prospect", contactEmail: "ana@example.test" }),
  );
  assert.equal(first.status, "success");
  assert.equal(second.status, "success");
  assert.equal(calls.admit.length, 2);
  assert.equal(calls.admit[0].commandId, calls.admit[1].commandId, "same tool_call_id must derive the same admission commandId");
});

test("a genuinely new tool_call_id derives a genuinely different admission commandId", async () => {
  const { actions, calls } = loadBusinessActionToolCall();
  await actions.executeBusinessActionToolCall(
    AGENT_ID, "019b0000-0000-7000-8000-0000000000c1", "presentation", "register_lead", "tool-call-a",
    JSON.stringify({ contactName: "Ana Prospect", contactEmail: "ana@example.test" }),
  );
  await actions.executeBusinessActionToolCall(
    AGENT_ID, "019b0000-0000-7000-8000-0000000000c1", "presentation", "register_lead", "tool-call-b",
    JSON.stringify({ contactName: "Ana Prospect", contactEmail: "ana@example.test" }),
  );
  assert.notEqual(calls.admit[0].commandId, calls.admit[1].commandId);
});

test("achado de revisão de segurança: uma segunda tool call CONCORRENTE pro mesmo (tenant, sessão, ação), com um tool_call_id NOVO, nunca admite um segundo grant/lead enquanto a primeira ainda está em voo", async () => {
  // Simula exatamente o cenário do achado: o timeout interno de 8s dispara
  // "Handoff" pro modelo enquanto admitBusinessAction/registerBusinessLead da
  // tentativa original ainda não terminaram no servidor -- o modelo, seguindo
  // a doutrina de handoff, emite um tool_call_id NOVO pra tentar de novo. Sem
  // o lock em voo, isso admitiria um segundo grant com um commandFingerprint
  // diferente (toolCallId entra na derivação) e gravaria um segundo lead.
  let releaseFirstAdmit;
  const firstAdmitGate = new Promise((resolve) => { releaseFirstAdmit = resolve; });
  const { actions, calls } = loadBusinessActionToolCall({
    async admit(input, callNumber) {
      if (callNumber === 1) await firstAdmitGate; // trava a primeira tentativa em voo até o teste liberar
      return { outcome: "issued", code: "issued", grant: defaultGrant(input) };
    },
  });

  const firstCall = actions.executeBusinessActionToolCall(
    AGENT_ID, "019b0000-0000-7000-8000-0000000000c1", "presentation", "register_lead", "tool-call-original",
    JSON.stringify({ contactName: "Ana Prospect", contactEmail: "ana@example.test" }),
  );
  // Espera até a primeira tentativa realmente ter entrado em admitBusinessAction
  // (não só ter sido despachada) antes de disparar a "retentativa" concorrente,
  // pra reproduzir com precisão a janela de corrida real.
  while (calls.admit.length < 1) await new Promise((resolve) => setTimeout(resolve, 0));

  const retryCall = actions.executeBusinessActionToolCall(
    AGENT_ID, "019b0000-0000-7000-8000-0000000000c1", "presentation", "register_lead", "tool-call-retry",
    JSON.stringify({ contactName: "Ana Prospect", contactEmail: "ana@example.test" }),
  );

  // Enquanto a primeira tentativa segue travada, a segunda (mesmo tenant/
  // sessão/ação, tool_call_id diferente) NUNCA deve ter iniciado sua própria
  // admissão -- ela está esperando o resultado da primeira, não abrindo uma
  // segunda janela de escrita concorrente.
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(calls.admit.length, 1, "a segunda tentativa não pode ter chamado admitBusinessAction enquanto a primeira ainda está em voo");
  assert.equal(calls.registerLead.length, 0, "nenhum lead pode ter sido registrado ainda -- a primeira tentativa continua bloqueada");

  releaseFirstAdmit();
  const [firstResult, retryResult] = await Promise.all([firstCall, retryCall]);

  assertResult(firstResult, { status: "success", output: "Lead registrado." });
  assertResult(retryResult, { status: "success", output: "Lead registrado." });
  assert.equal(calls.admit.length, 1, "só UMA admissão para o (tenant,sessão,ação) inteiro, mesmo com dois tool_call_id distintos concorrentes");
  assert.equal(calls.registerLead.length, 1, "só UM lead registrado -- o achado da revisão de segurança descrevia exatamente uma duplicação aqui");
});

// ---------------------------------------------------------------------------
// Timeout interno
// ---------------------------------------------------------------------------

test("an internal timeout always resolves to the Handoff category, never leaves the tool call unanswered", async () => {
  const { actions } = loadBusinessActionToolCall({
    liveContext: () => new Promise(() => {}), // never resolves
  });
  const result = await actions.executeBusinessActionToolCall(
    AGENT_ID, "019b0000-0000-7000-8000-0000000000c1", "presentation", "register_lead", "tavus-call-1",
    JSON.stringify({ contactName: "Ana Prospect", contactEmail: "ana@example.test" }),
    { timeoutMs: 15 },
  );
  assertResult(result, { status: "error", output: "Ação indisponível agora. Ofereça transferir para o time humano, com a doutrina de handoff já definida." });
});

test("a rejected/thrown dependency never crashes the caller -- it still resolves to a declared tool_result", async () => {
  const { actions } = loadBusinessActionToolCall({
    liveContext: () => { throw new Error("boom"); },
  });
  const result = await actions.executeBusinessActionToolCall(
    AGENT_ID, "019b0000-0000-7000-8000-0000000000c1", "presentation", "register_lead", "tavus-call-1",
    JSON.stringify({ contactName: "Ana Prospect", contactEmail: "ana@example.test" }),
  );
  assert.equal(result.status, "error");
  assert.equal(typeof result.output, "string");
});
