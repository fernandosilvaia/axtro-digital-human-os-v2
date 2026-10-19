import assert from "node:assert/strict";
import { test } from "node:test";

const guard = await import("../../apps/portal/src/lib/brain/billion-guard.ts");
const core = await import("../../apps/portal/src/lib/brain/chat-completion-core.ts");

const check = (reply, language = "portuguese") => guard.enforceBillionLeadsGuard(reply, language);

test("verified prices pass untouched, in the three languages", () => {
  for (const reply of [
    "No catálogo em português, o lead sai a US$ 30 no pacote de 10, US$ 28 no de 25 e US$ 25 no de 50.",
    "O Solo custa US$ 97 por mês, ou US$ 588 por 12 meses pagos de uma vez.",
    "En español, 10 leads por 250 dólares y 100 por 2.000 dólares.",
    "Recargas de US$ 25, US$ 50 ou US$ 100, e tarifas previstas de US$ 0,035 por minuto.",
  ]) assert.deepEqual(check(reply).violations, [], reply);
});

test("an invented price table is removed, which is the failure the simulation found", () => {
  const invented = check("Justo. Os pacotes começam em 10 leads por 99 dólares, 25 por 199, 50 por 349 e 100 por 599. Em que estado você trabalha?");
  assert.ok(invented.violations.includes("bl_unknown_amount"));
  assert.equal(invented.reply, "Justo. Em que estado você trabalha?");
  const wrongPlans = check("O CRM tem três planos: Solo sai por 29 dólares por mês, Pro é 79, e Team é 199. Qual encaixa melhor?");
  assert.ok(wrongPlans.violations.includes("bl_unknown_amount"));
  assert.ok(!/29 dólares/.test(wrongPlans.reply));
});

test("a reply that was only an invented number falls back to the catalog, in the reply language", () => {
  const pt = check("Cada lead custa US$ 18.");
  assert.match(pt.reply, /tela do catálogo/);
  const en = check("Each lead costs $18, a great deal for you.", "english");
  assert.match(en.reply, /catalog screen/);
  const es = check("Cada lead cuesta 18 dólares.", "spanish");
  assert.match(es.reply, /pantalla del catálogo/);
});

test("Brazilian reais are never quoted: the catalog is in dollars", () => {
  const result = check("Um lead sai de R$ 18 a R$ 22 em Miami. Qual produto você vende?");
  assert.ok(result.violations.includes("bl_foreign_currency"));
  assert.ok(!/R\$/.test(result.reply));
});

test("promises of profit are removed, honest denials stay", () => {
  assert.ok(check("Se você fechar 3 vendas, o pacote se paga e o resto é lucro seu. Qual é a sua comissão?").violations.includes("bl_income_promise"));
  assert.ok(check("Você vai fechar muitas vendas com esses leads. Quer começar?").violations.includes("bl_income_promise"));
  assert.deepEqual(check("Comprar lead não garante venda, e eu não posso prometer resultado. Qual é a sua comissão?").violations, []);
});

test("an invented delivery deadline is removed, but the replacement windows are real", () => {
  assert.ok(check("Os leads chegam em 24 a 48 horas depois do pagamento. Qual estado você atende?").violations.includes("bl_invented_delivery"));
  assert.deepEqual(check("Número ou WhatsApp inválido você sinaliza em até 10 dias a partir da chegada do lead. Faz sentido?").violations, []);
  assert.deepEqual(check("Os leads chegam em fila, sem prazo garantido. Quantos você atende por semana?").violations, []);
});

test("sentences around a violation survive, and the guard is idempotent", () => {
  const once = check("Entendi o seu momento. Cada venda sai por uns US$ 90, é barato. Qual é a sua comissão média por venda?");
  assert.ok(once.violations.includes("bl_unknown_amount"));
  assert.equal(once.reply, "Entendi o seu momento. Qual é a sua comissão média por venda?");
  assert.deepEqual(check(once.reply).violations, []);
});

test("the Billion vertical removes an invented price from the spoken reply and flags it", async () => {
  const deps = {
    generate: async () => ({ text: "Justo. Os pacotes começam em 10 leads por 99 dólares e 25 por 199. Em que estado você atende?", model: "fake/model", usage: { inputTokens: 100, outputTokens: 30 } }),
    logGenerationUsage: async () => {},
  };
  const base = { agentName: "Bia", tenantName: "Billion Leads Pro", surface: "video", language: "portuguese", knowledgeMatches: [], history: [], userMessage: "Quanto é?" };
  const guarded = await core.runBrainChatCompletion({ ...base, closerVertical: "billion_leads_sales" }, deps);
  assert.ok(!/99 dólares/.test(guarded.reply), guarded.reply);
  assert.ok(guarded.guardrailFlags.includes("bl_unknown_amount"));
  const generic = await core.runBrainChatCompletion({ ...base, closerVertical: "metodo_silva" }, deps);
  assert.match(generic.reply, /99 dólares/, "other personas are not affected by this guard");
});

test("prices written without a currency symbol after \"por\" are read too", () => {
  const table = check("Os preços são: 25 leads por 600, 50 por 1.100, 100 por 2.000 e 200 por 3.800. Qual estado você atende?");
  assert.ok(table.violations.includes("bl_unknown_amount"), "3.800 is not in the verified table");
  assert.ok(!/3\.800/.test(table.reply));
  // prazos e unidades não são preço
  assert.deepEqual(check("Você tem 7 dias grátis, e a renovação é por 12 meses. Por mês, o Solo custa US$ 97.").violations, []);
  assert.deepEqual(check("A franquia é de 500 ações por mês e o pacote tem no mínimo 10 leads por pedido.").violations, []);
});

test("a price from the other language's table is removed", () => {
  const mix = check("Em português, os preços são: 25 leads por 600 dólares e 50 por 1.100. Qual estado você atende?");
  assert.ok(mix.violations.includes("bl_language_mixup"));
  assert.ok(!/600 dólares/.test(mix.reply));
  assert.ok(check("Em português, o lead sai a partir de 20 dólares. Quantos você atende?").violations.includes("bl_language_mixup"));
  assert.deepEqual(check("Em português, o pacote de 10 sai por US$ 300. Em espanhol, o de 10 sai por US$ 250. Qual você quer?").violations, []);
});

test("an invented commission and a break-even built on it are removed, the honest question is not", () => {
  const invented = check("Depende da seguradora, mas a comissão costuma estar entre 40 a 100 dólares por venda. Então com 3 a 8 vendas você já cobre os 300. Qual é o seu estado?");
  assert.ok(invented.violations.includes("bl_income_promise") || invented.violations.includes("bl_unknown_amount"));
  assert.ok(!/40 a 100/.test(invented.reply) && !/3 a 8 vendas/.test(invented.reply), invented.reply);
  assert.ok(guard.unknownAmounts("a comissão fica entre 40 a 100 dólares").includes(40), "both ends of a range count");
  for (const honest of [
    "Quanto você costuma receber de comissão por venda?",
    "Qual é a sua comissão média por venda? Com ela eu faço a conta do ponto de equilíbrio com você.",
    "Dividindo o custo do pacote pela sua comissão por venda, você vê quantas vendas pagam o pacote.",
  ]) assert.deepEqual(check(honest).violations, [], honest);
});
