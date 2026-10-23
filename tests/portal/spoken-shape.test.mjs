import assert from "node:assert/strict";
import { test } from "node:test";

const { shapeSpokenReply } = await import("../../apps/portal/src/lib/brain/spoken-shape.ts");

const sentenceCount = (text) => text.split(/(?<=[.!?…])\s+/).filter(Boolean).length;
const questionCount = (text) => (text.match(/\?/g) ?? []).length;

test("a reply within four sentences and one question passes untouched", () => {
  const reply = "Of course, it's a real decision. To help you think it through, is it more about the cost or about which option fits?";
  assert.equal(shapeSpokenReply(reply), reply);
  const four = "One. Two. Three. And four?";
  assert.equal(shapeSpokenReply(four), four);
});

test("a long reply keeps three statements and the question that drives the turn", () => {
  const reply = "Hey there, thanks for reaching out. I'm Priscila, an AI consultant here at Billion Club. My job today is to listen. Then we see how we might help. After that, a licensed agent brings real numbers. Finally we decide together. How does that sound?";
  const shaped = shapeSpokenReply(reply);
  assert.ok(sentenceCount(shaped) <= 4, shaped);
  assert.ok(shaped.endsWith("How does that sound?"), shaped);
  assert.match(shaped, /AI consultant/, "the AI disclosure survives the cut");
});

test("protected sentences are chosen before the rest when the cut happens", () => {
  const reply = "First filler. Second filler. Third filler. Fourth filler. We're completely separate from Medicare and any government program. Fifth filler. What state do you live in?";
  const shaped = shapeSpokenReply(reply);
  assert.match(shaped, /separate from Medicare/);
  assert.ok(sentenceCount(shaped) <= 4);
  assert.ok(shaped.endsWith("What state do you live in?"));
});

test("several questions collapse to the one that drives the turn", () => {
  const reply = "I appreciate the directness. Here is the thing about approvals. Only the carrier decides that. Sound fair? Let me ask you this: who depends on you financially right now?";
  const shaped = shapeSpokenReply(reply);
  assert.equal(questionCount(shaped), 1);
  assert.ok(shaped.endsWith("who depends on you financially right now?"));
});

test("chained questions become one question", () => {
  const reply = "That is a real decision. Take your time with it. Nobody is rushing you. Many people feel the same way. Is it the cost? Or which option fits? Or something you still want to understand?";
  const shaped = shapeSpokenReply(reply);
  assert.equal(questionCount(shaped), 1, shaped);
  assert.match(shaped, /Is it the cost, or which option fits, or something you still want to understand\?$/);
});

test("abbreviations and decimals do not count as sentence ends", () => {
  const reply = "We are open 8 a.m. to 8 p.m. in the U.S. and the rate is 7.5 percent today. Does that help?";
  assert.equal(shapeSpokenReply(reply), reply);
});

test("Spanish questions with the inverted mark are recognised", () => {
  const reply = "Le entiendo. No hay prisa. Podemos ir con calma. Cada familia es distinta. Nadie decide por usted. ¿Qué monto mensual le resultaría cómodo?";
  const shaped = shapeSpokenReply(reply);
  assert.ok(sentenceCount(shaped) <= 4, shaped);
  assert.ok(shaped.endsWith("¿Qué monto mensual le resultaría cómodo?"));
});

test("a long reply without a question is cut to four statements", () => {
  const shaped = shapeSpokenReply("One. Two. Three. Four. Five. Six.");
  assert.equal(shaped, "One. Two. Three. Four.");
});

test("shaping is idempotent and never returns an empty reply", () => {
  const reply = "A. B. C. D. E. F. Really?";
  const once = shapeSpokenReply(reply);
  assert.equal(shapeSpokenReply(once), once);
  assert.equal(shapeSpokenReply(""), "");
  assert.ok(shapeSpokenReply("Only one sentence without punctuation").length > 0);
});

test("a praise-of-the-question opener is dropped and the answer stays", () => {
  assert.equal(shapeSpokenReply("Ótima pergunta. O pacote de 25 sai a US$ 28 por lead."), "O pacote de 25 sai a US$ 28 por lead.");
  assert.equal(shapeSpokenReply("Boa pergunta! Os leads chegam em fila."), "Os leads chegam em fila.");
  assert.equal(shapeSpokenReply("Ótima pergunta, e vou ser direto: não existe garantia de venda."), "Não existe garantia de venda.");
  assert.equal(shapeSpokenReply("Great question. The pack starts at 10 leads."), "The pack starts at 10 leads.");
  assert.equal(shapeSpokenReply("Excelente pregunta. El paquete mínimo es de 10 leads."), "El paquete mínimo es de 10 leads.");
});

test("praise stripping never empties a reply and never touches a normal start", () => {
  assert.equal(shapeSpokenReply("Ótima pergunta."), "Ótima pergunta.");
  assert.equal(shapeSpokenReply("Boa, isso ajuda. Vamos ao catálogo."), "Boa, isso ajuda. Vamos ao catálogo.");
  assert.equal(shapeSpokenReply("Faz sentido. Qual produto você vende?"), "Faz sentido. Qual produto você vende?");
  const once = shapeSpokenReply("Ótima pergunta. Os leads chegam em fila.");
  assert.equal(shapeSpokenReply(once), once, "idempotent");
});

test("the honest-with-you tic is dropped and the sentence after it stays", () => {
  assert.equal(shapeSpokenReply("Vou ser honesto com você: não existe garantia de venda. Quer ver como funciona a reposição?"), "Não existe garantia de venda. Quer ver como funciona a reposição?");
  assert.equal(shapeSpokenReply("Primeiro, o preço. Deixa eu ser transparente: o pacote de 25 sai a US$ 28 por lead."), "Primeiro, o preço. O pacote de 25 sai a US$ 28 por lead.");
  assert.equal(shapeSpokenReply("Let me be honest with you: there is no sales guarantee."), "There is no sales guarantee.");
  assert.equal(shapeSpokenReply("Vou ser honesto: sem tique, sobra nada."), "Sem tique, sobra nada.");
  // um uso que carrega conteúdo na própria frase não é tique
  assert.equal(shapeSpokenReply("Ser honesto custa pouco e vale muito."), "Ser honesto custa pouco e vale muito.");
});

test("the honesty tic is dropped when it stands alone, after a connector, or at the end of a sentence", () => {
  assert.equal(shapeSpokenReply("Entendi o orçamento. Deixa eu ser direto com você. O pacote de 10 sai a US$ 30 por lead."), "Entendi o orçamento. O pacote de 10 sai a US$ 30 por lead.");
  assert.equal(shapeSpokenReply("Agora, deixa eu ser direto com você: a reposição exige o CRM ativo."), "A reposição exige o CRM ativo.");
  assert.equal(shapeSpokenReply("Eu confirmo isso com o time, mas deixa eu ser direto com você. O que mais importa é a sua capacidade."), "Eu confirmo isso com o time. O que mais importa é a sua capacidade.");
});

test("a list announcement whose items the cut removes is dropped, and one that carries its items stays", () => {
  const announced = "No teste você conhece o Lead Desk. A reposição precisa de duas coisas. Primeiro, assinatura paga do CRM. Segundo, dez dias de tentativas registradas. Quando você assinaria?";
  const shaped = shapeSpokenReply(announced);
  assert.ok(!/duas coisas/.test(shaped), shaped);
  assert.match(shaped, /assinaria\?$/);
  const withItems = "No teste você conhece o Lead Desk. A reposição precisa de duas coisas: assinatura paga e dez dias de tentativas. Faz sentido? Quando assinaria? Hoje?";
  assert.match(shapeSpokenReply(withItems), /duas coisas: assinatura paga/);
  const short = "A reposição precisa de duas coisas. Qual delas você quer ver primeiro?";
  assert.equal(shapeSpokenReply(short), short, "a short reply is never touched");
  assert.equal(shapeSpokenReply(shapeSpokenReply(announced)), shapeSpokenReply(announced), "idempotent");
});
