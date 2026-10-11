import assert from "node:assert/strict";
import { test } from "node:test";

const collect = await import("../../experiments/conversation-eval/collect.mjs");
const { CONVERSATIONS, CHATBOT_ROLE } = await import("../../experiments/conversation-eval/conversations.mjs");
const { RAG_QUESTIONS } = await import("../../experiments/conversation-eval/rag-questions.mjs");
const tools = await import("../../apps/portal/src/lib/brain/brain-tools.ts");
const { TOOL_RESULT_PREFIX } = await import("../../apps/portal/src/lib/brain/tavus-request.ts");

const KNOWN_TOOLS = new Set([...tools.BRAIN_BUSINESS_TOOL_NAMES, ...tools.BRAIN_CALCULATION_TOOL_NAMES]);

test("conversation scripts are well formed and only use tools the brain can offer", () => {
  const ids = new Set();
  for (const conversation of CONVERSATIONS) {
    assert.ok(!ids.has(conversation.id), conversation.id);
    ids.add(conversation.id);
    assert.ok(["english", "spanish", "portuguese"].includes(conversation.language));
    assert.ok(conversation.userTurns.length >= 3, `${conversation.id} is a multi-turn conversation`);
    assert.ok(conversation.retain.length > 0 && conversation.expectedOutcome.length > 0);
    for (const name of conversation.tools) assert.ok(KNOWN_TOOLS.has(name), `${conversation.id}: ${name}`);
  }
  for (const text of [CHATBOT_ROLE, ...CONVERSATIONS.flatMap((c) => [c.scenario, c.expectedOutcome, ...c.userTurns])]) {
    assert.ok(!text.includes("\u2014"), "no em dash in eval material");
  }
});

test("every RAG question points at a section that exists in the Priscila pack", () => {
  const rows = collect.ragReferenceRows();
  assert.equal(rows.length, RAG_QUESTIONS.length);
  for (const row of rows) {
    assert.match(row.reference_contexts[0], /^## /);
    assert.ok(row.reference.length > 40 && !row.reference.includes("\u2014"));
  }
});

test("the dry run plays the real brain path, including the calculator tool loop", async () => {
  const conversation = CONVERSATIONS.find((c) => c.id === "coverage-math-young-family-en");
  const row = await collect.playConversation(conversation, collect.dryRunGenerate);
  const toolTurn = row.turns.find((turn) => turn.tools_called !== undefined);
  assert.ok(toolTurn, "the calculator was called");
  assert.equal(toolTurn.tools_called[0].name, "estimate_coverage_need");
  assert.match(toolTurn.tools_called[0].output, /^Educational estimate \(DIME method\)/);
  const after = row.turns[row.turns.indexOf(toolTurn) + 1];
  assert.equal(after.role, "assistant", "the persona speaks again after reading the result");
  assert.equal(after.content, "Dry run: I read the tool result.");
  assert.equal(row.turns.filter((turn) => turn.role === "user").length, conversation.userTurns.length, "tool results never pose as the person");
});

test("in-process scheduling tools answer in the production text format, with fictitious slots", () => {
  assert.equal(collect.runToolInProcess({ name: "register_lead", argumentsJson: "{}" }).output, "Lead registrado.");
  assert.match(collect.runToolInProcess({ name: "propose_meeting_slots", argumentsJson: "{\"durationMinutes\":30}" }).output, /^Horários disponíveis:\nOpção 1: /);
  assert.equal(collect.runToolInProcess({ name: "confirm_meeting_slot", argumentsJson: "{}" }).output, "Reunião confirmada.");
  assert.equal(collect.runToolInProcess({ name: "issue_refund", argumentsJson: "{}" }).status, "error");
  assert.ok(!collect.dryRunGenerate([{ role: "user", content: `${TOOL_RESULT_PREFIX} x` }], 1, {}).text.includes("\u2014"));
});

test("retrieval only ever runs against a local stack", () => {
  assert.equal(collect.localSupabaseClient({}), null);
  assert.throws(() => collect.localSupabaseClient({ EVAL_SUPABASE_URL: "https://ovctadcrvnfpgxzplupp.supabase.co" }), /loopback/);
  assert.throws(() => collect.localSupabaseClient({ EVAL_SUPABASE_URL: "http://127.0.0.1:58421" }), /EVAL_SUPABASE_SERVICE_ROLE_KEY is required/);
});
