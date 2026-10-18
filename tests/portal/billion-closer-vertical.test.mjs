import assert from "node:assert/strict";
import { test } from "node:test";

const billion = await import("../../apps/portal/src/lib/brain/billion-leads.ts");
const silva = await import("../../apps/portal/src/lib/brain/metodo-silva.ts");
const core = await import("../../apps/portal/src/lib/brain/chat-completion-core.ts");
const override = await import("../../apps/portal/src/lib/brain/vertical-override.ts");
const life = await import("../../apps/portal/src/lib/brain/life-insurance.ts");

const PERSONA_PROMPT_COMFORT_CAP = 14_000;

test("the doctrine answers first, closes without requalifying, and keeps the honesty rules always on", () => {
  const pt = billion.buildBillionLeadsCore("portuguese");
  for (const needle of ["RESPONDA PRIMEIRO", "QUEM JÁ QUER COMPRAR", "SÓ O VERDADEIRO", "Nunca prometa venda, renda", "dados de cartão", "em breve", "consultoria estratégica"]) {
    assert.ok(pt.includes(needle), `pt is missing: ${needle}`);
  }
  const en = billion.buildBillionLeadsCore("english");
  for (const needle of ["ANSWER FIRST", "WHO ALREADY WANTS TO BUY", "ONLY THE TRUTH", "Never promise sales, income", "card details", "coming soon", "strategy consultation"]) {
    assert.ok(en.includes(needle), `en is missing: ${needle}`);
  }
  for (const text of [pt, en]) {
    assert.ok(!text.includes(String.fromCharCode(0x2014)), "no em dash");
    assert.ok(text.length < 3000, `doctrine is ${text.length} chars`);
  }
});

function promptFor(language, extra) {
  return silva.buildCloserVideoSystemPrompt({ agentName: "Bia", tenantName: "Billion Leads Pro", language, toolCalling: false, ...extra });
}

test("a selling vertical keeps the price and closing phases that a regulated vertical removes", () => {
  for (const language of ["portuguese", "english"]) {
    const selling = promptFor(language, { domainCore: billion.buildBillionLeadsCore(language), regulatedVertical: false });
    const regulated = promptFor(language, { domainCore: billion.buildBillionLeadsCore(language) });
    const phase = (text, tag) => text.includes(tag);
    for (const tag of language === "english" ? ["PHASE 4", "PHASE 5", "OBJECTIONS:"] : ["FASE 4", "FASE 5", "OBJEÇÕES:"]) {
      assert.ok(phase(selling, tag), `${language}: the selling prompt lost ${tag}`);
      assert.ok(!phase(regulated, tag), `${language}: the regulated prompt kept ${tag}`);
    }
    assert.ok(selling.includes(language === "english" ? "ANSWER FIRST" : "RESPONDA PRIMEIRO"));
    assert.ok(selling.length <= PERSONA_PROMPT_COMFORT_CAP, `${language}: ${selling.length} chars`);
  }
});

test("without the flag the generic prompt is unchanged, and a domain core still means regulated", () => {
  const generic = promptFor("portuguese", {});
  assert.ok(generic.includes("FASE 4"));
  assert.ok(!generic.includes("RESPONDA PRIMEIRO"));
  const withCore = promptFor("portuguese", { domainCore: "NUCLEO" });
  assert.ok(!withCore.includes("FASE 4"), "the old default for a domain core is kept");
});

function fakeDeps(text) {
  const calls = [];
  return {
    calls,
    deps: {
      generate: async (messages) => { calls.push(messages); return { text, model: "fake/model", usage: { inputTokens: 100, outputTokens: 20 } }; },
      logGenerationUsage: async () => {},
    },
  };
}
const REQUEST = { agentName: "Bia", tenantName: "Billion Leads Pro", surface: "video", language: "portuguese", knowledgeMatches: [], history: [], userMessage: "Quanto custa cada lead?" };

test("the brain composes the Billion doctrine only for its own vertical", async () => {
  const joined = (messages) => messages.filter((message) => message.role === "system").map((message) => message.content).join("\n");
  const own = fakeDeps("Custa US$ 30 no pacote de 10.");
  await core.runBrainChatCompletion({ ...REQUEST, closerVertical: "billion_leads_sales" }, own.deps);
  assert.ok(joined(own.calls[0]).includes("RESPONDA PRIMEIRO"));
  assert.ok(joined(own.calls[0]).includes("FASE 4"), "the selling phases stay");

  for (const vertical of ["metodo_silva", "life_insurance_qualification"]) {
    const other = fakeDeps("Ok.");
    await core.runBrainChatCompletion({ ...REQUEST, closerVertical: vertical }, other.deps);
    assert.ok(!joined(other.calls[0]).includes("RESPONDA PRIMEIRO"), `${vertical} must not get the Billion doctrine`);
  }
});

test("the Billion vertical shortens a long spoken reply and does not run the insurance sentinel", async () => {
  const long = "Entendi. Faz sentido. Muita gente começa assim. Vale olhar com calma. Posso explicar cada pacote. Depois você decide. Qual produto você vende? Ou prefere ver o CRM?";
  const { deps } = fakeDeps(long);
  const result = await core.runBrainChatCompletion({ ...REQUEST, closerVertical: "billion_leads_sales" }, deps);
  assert.ok(result.reply.split(/(?<=[.!?])\s+/).length <= 4, result.reply);
  assert.ok(result.guardrailFlags.includes("reply_shortened"));
  const sentinel = fakeDeps("Eu sou uma agente licenciada e posso fechar a apólice com você.");
  const spoken = await core.runBrainChatCompletion({ ...REQUEST, closerVertical: "billion_leads_sales" }, sentinel.deps);
  assert.equal(spoken.reply, "Eu sou uma agente licenciada e posso fechar a apólice com você.", "the insurance sentinel is not part of this vertical");
});

test("the stored vertical value is parsed, and anything unknown falls back to the generic closer", () => {
  assert.equal(core.parseCloserVertical("billion_leads_sales"), "billion_leads_sales");
  assert.equal(core.parseCloserVertical("hacker_vertical"), "metodo_silva");
  assert.equal(core.parseCloserVertical(undefined), "metodo_silva");
  assert.equal(life.buildLifeInsuranceCore("qualification", "english").includes("ANSWER FIRST"), false);
});

test("the override only lifts a generic agent to the Billion vertical", () => {
  const raw = JSON.stringify({ "agent-1": "billion_leads_sales", "agent-2": "life_insurance_qualification", "agent-3": "hacker" });
  assert.equal(override.applyVerticalOverride("metodo_silva", "agent-1", raw), "billion_leads_sales");
  assert.equal(override.applyVerticalOverride("metodo_silva", "agent-2", raw), "metodo_silva", "never lifts into an insurance vertical");
  assert.equal(override.applyVerticalOverride("metodo_silva", "agent-3", raw), "metodo_silva");
  assert.equal(override.applyVerticalOverride("metodo_silva", "agent-9", raw), "metodo_silva");
  assert.equal(override.applyVerticalOverride("life_insurance_qualification", "agent-1", raw), "life_insurance_qualification", "never touches a regulated agent");
  assert.equal(override.applyVerticalOverride("life_insurance_recruitment", "agent-1", raw), "life_insurance_recruitment");
  for (const bad of [undefined, "", "   ", "not json", "[1,2]", "null", "42", '{"agent-1": 7}']) {
    assert.equal(override.applyVerticalOverride("metodo_silva", "agent-1", bad), "metodo_silva", `bad input: ${bad}`);
  }
});
