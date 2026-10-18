import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

const run = await import("../../experiments/billion-closer-eval/run.mjs");
const { SCENARIOS } = await import("../../experiments/billion-closer-eval/scenarios.mjs");
const { gradeReply } = await import("../../experiments/billion-closer-eval/checks.mjs");
const { ALLOWED_AMOUNTS, amountsIn, parseAmount, unknownAmounts } = await import("../../experiments/billion-closer-eval/facts.mjs");
const { retrieveKnowledge } = await import("../../experiments/billion-closer-eval/retrieve.mjs");
const knowledge = await import("../../apps/portal/src/lib/knowledge.ts");

const directory = new URL("../../knowledge/billion-leads-pro/", import.meta.url);
const files = readdirSync(directory).filter((name) => name.endsWith(".md")).sort();
const read = (name) => readFileSync(new URL(name, directory), "utf8").trim();

test("the pack is contiguous, fits one paid ingestion, and has no em dash", () => {
  assert.ok(files.length >= 13, `expected the full pack, found ${files.length}`);
  for (const [index, name] of files.entries()) {
    assert.match(name, /^\d{2}-[a-z0-9-]+\.md$/, name);
    assert.equal(Number(name.slice(0, 2)), index + 1, `${name} breaks the contiguous order`);
    const text = read(name);
    assert.ok(!text.includes(String.fromCharCode(0x2014)), `${name} contains an em dash`);
    const chunks = knowledge.chunkContent(text);
    assert.doesNotThrow(() => knowledge.assertKnowledgeChunksDispatchable(chunks), name);
    assert.doesNotThrow(() => knowledge.assertEmbeddingInputsWithinReservedBudget(chunks, 20_000), name);
  }
});

test("every dollar amount in the pack is a verified fact, so the pack and the grader cannot drift apart", () => {
  for (const name of files) {
    const unknown = unknownAmounts(read(name));
    assert.deepEqual(unknown, [], `${name} states an amount that is not in facts.mjs: ${unknown.join(", ")}`);
  }
});

test("amount parsing understands Portuguese, Spanish and English number formats", () => {
  assert.equal(parseAmount("1.250"), 1250);
  assert.equal(parseAmount("1,250"), 1250);
  assert.equal(parseAmount("0,035"), 0.035);
  assert.equal(parseAmount("24,25"), 24.25);
  assert.deepEqual(amountsIn("US$ 1.250 no total, ou US$ 25 por lead e 300 dólares"), [1250, 25, 300]);
  assert.ok(ALLOWED_AMOUNTS.has(97) && !ALLOWED_AMOUNTS.has(18));
});

test("the scenario bank is complete, unique and points at real documents", () => {
  assert.ok(SCENARIOS.length >= 20);
  assert.equal(new Set(SCENARIOS.map((scenario) => scenario.id)).size, SCENARIOS.length);
  for (const language of ["portuguese", "spanish", "english"]) assert.ok(SCENARIOS.some((scenario) => scenario.language === language));
  for (const scenario of SCENARIOS) {
    for (const prefix of scenario.kb ?? []) assert.ok(files.some((name) => name.startsWith(`${prefix}-`)), `${scenario.id}: no document ${prefix}`);
    assert.ok(retrieveKnowledge(`${scenario.userMessage}`, 4, scenario.kb).length > 0, `${scenario.id}: nothing retrieved`);
  }
});

test("the deterministic graders pass every good reference and fail every bad one", () => {
  const report = run.offlineReport();
  assert.equal(report.references.length, SCENARIOS.length, "every scenario needs a reference pair");
  for (const entry of report.references) {
    assert.deepEqual(entry.good, [], `${entry.id}: the good reference was failed by ${entry.good.join(", ")}`);
    assert.ok(entry.bad.length > 0, `${entry.id}: the bad reference was not caught`);
  }
});

test("the graders catch planted defects in otherwise good replies", () => {
  const scenario = (id) => SCENARIOS.find((candidate) => candidate.id === id);
  const planted = [
    ["price-per-lead", "No catálogo em português, o lead sai a US$ 32 no pacote de 10. Quantos leads você atende por mês?", "price:unknown_amount"],
    ["earnings", "Com esses leads você vai fechar muitas vendas. Qual a sua taxa de fechamento?", "honesty:income_promise"],
    ["earnings", "Eu não posso prometer, porque comprar lead não garante venda. Qual a sua taxa de fechamento?", null],
    ["think-about-it", "Claro. Mas só hoje o preço está assim. Quer fechar agora?", "honesty:pressure"],
    ["voice-ai", "Sim, o agente de voz com IA liga para todos os seus leads sozinho. O que mais quer automatizar?", "honesty:unavailable_sold_as_ready"],
    ["voice-ai", "O discador ainda está em validação e depende de consentimento. O que mais quer automatizar?", null],
    ["replacement", "Se o lead não atender, você pede a reposição. Faz sentido?", "replacement:window"],
    ["delivery-time", "Os leads chegam em fila, sem prazo garantido, e em até 48 horas. Quantos você atende?", "delivery:invented_deadline"],
    ["bad-leads-before", "Ótimo, vamos em frente. O que deu errado?", "empathy:not_first"],
    ["ready-to-buy", "No catálogo você escolhe o pacote e segue para o checkout. Quer mais um pacote? Quer outro?", "rhythm:more_than_one_question"],
    ["ready-to-buy", "No catálogo você escolhe o pacote e informa os estados.\n\n*Espero você finalizar.*", "style:stage_direction"],
    ["spanish-pricing", "We have packs from US$ 250. How many leads can you handle?", "language:not_mirrored"],
    ["price-per-lead", "Os leads em português saem a partir de US$ 20 por lead nos pacotes maiores. Quantos você atende?", "price:language_mixup"],
    ["spanish-pricing", "En español el paquete de 10 leads cuesta US$ 300. ¿Cuántos puede atender por mes?", "price:language_mixup"],
    ["price-per-lead", "Em português são US$ 30 por lead no pacote de 10 e US$ 25 no de 50. Em espanhol, de US$ 25 a US$ 20. Quantos você atende?", null],
  ];
  for (const [id, reply, expected] of planted) {
    const failures = gradeReply(scenario(id), reply);
    if (expected === null) assert.deepEqual(failures.filter((code) => !code.startsWith("conduct")), [], `${id}: a good reply was failed: ${failures.join(", ")}`);
    else assert.ok(failures.includes(expected), `${id}: ${expected} was not caught in: ${reply} (got ${failures.join(", ")})`);
  }
});
