import assert from "node:assert/strict";
import { test } from "node:test";

const sentinel = await import("../../apps/portal/src/lib/brain/compliance-sentinel.ts");

function check(reply, language = "english") {
  return sentinel.enforceLifeInsuranceCompliance(reply, language);
}

test("affirmative regulatory claims are removed sentence by sentence, in the three languages", () => {
  const cases = [
    ["We're with Medicare, so this is a federal benefit. What state do you live in?", "li_government_affiliation", "english"],
    ["Somos del gobierno y este es un programa del estado. ¿En qué estado vive usted?", "li_government_affiliation", "spanish"],
    ["Somos do programa do governo pra quem tem mais de 50. Em que estado você mora?", "li_government_affiliation", "portuguese"],
    ["Our agents are federally licensed, so you're in good hands. Who depends on you?", "li_federal_license", "english"],
    ["Tenemos licencia federal para todo el país. ¿Quién depende de usted?", "li_federal_license", "spanish"],
    ["I'm the underwriter on your file today. How old are you?", "li_self_underwriter", "english"],
    ["Good news, you're approved for the coverage. When can we start?", "li_approval_claim", "english"],
    ["Pronto, você foi aprovada! Qual o melhor horário pra você?", "li_approval_claim", "portuguese"],
    ["With an IUL you can't lose money in a down market. Does that sound good?", "li_loss_guarantee", "english"],
    ["Es un rendimiento garantizado del siete por ciento. ¿Le interesa?", "li_loss_guarantee", "spanish"],
    ["É um retorno garantido, você nunca perde dinheiro. Faz sentido?", "li_loss_guarantee", "portuguese"],
    ["Your premium will be $42 per month for 15,000 of coverage. Shall we move forward?", "li_definitive_quote", "english"],
    ["No problem, you're approved! Want to pick a time?", "li_approval_claim", "english"],
    ["Sure, we're with Medicare on this one. What state are you in?", "li_government_affiliation", "english"],
  ];
  for (const [reply, violation, language] of cases) {
    const result = check(reply, language);
    assert.ok(result.violations.includes(violation), `${violation} not detected in: ${reply}`);
    assert.notEqual(result.reply, reply, `reply was not changed: ${reply}`);
    assert.doesNotMatch(result.reply, /medicare|federal|underwriter|approved|aprobad|aprovad|can't lose|garantizado|garantido|\$42/i, result.reply);
  }
});

test("the closer correcting the record, legitimate product names and hedged examples pass untouched", () => {
  const clean = [
    "We're not with Medicare or any government program. We're an independent agency. What made you look into this now?",
    "There is no federal license for insurance agents, only state licenses, and you can check the agent on your state's Department of Insurance website.",
    "I'm not the underwriter, the carrier decides. I just make sure the agent has your full picture.",
    "You're not approved for anything yet, that comes after the application with the licensed agent.",
    "Guaranteed issue final expense has a graded benefit in the first two years. Does that make sense?",
    "For example, a healthy 60 year old might see something around $40 a month, but the real number depends on the carrier quote.",
    "No somos de Medicare ni del gobierno. ¿Qué lo llevó a buscar esto ahora?",
    "Não existe licença federal, só estadual. Quer que eu te mostre como conferir a licença do agente?",
    "The death benefit goes to your beneficiaries. Who would you want to protect first?",
    "There's no guaranteed return with an IUL, the cap and the fees matter. That is why the agent runs the illustration with you.",
  ];
  for (const reply of clean) {
    const result = check(reply, "english");
    assert.deepEqual(result.violations, [], `false positive on: ${reply}`);
    assert.equal(result.reply, reply);
  }
});

test("when nothing usable is left, the fallback speaks the language of the reply", () => {
  assert.match(check("You're approved!", "portuguese").reply, /licensed agent/);
  assert.match(check("¡Usted está aprobado! Es un rendimiento garantizado.", "english").reply, /agente con licencia/);
  assert.match(check("Você está aprovada, é retorno garantido.", "english").reply, /agente licenciado/);
});

test("clean sentences around a violation are preserved", () => {
  const result = check("I hear you, losing your husband changed everything. You're approved today. Who else depends on your income right now?");
  assert.deepEqual(result.violations, ["li_approval_claim"]);
  assert.equal(result.reply, "I hear you, losing your husband changed everything. Who else depends on your income right now?");
});

test("language detection follows the reply, not the agent default", () => {
  assert.equal(sentinel.detectReplyLanguage("¿Usted tiene hijos que dependen de su ingreso?", "english"), "spanish");
  assert.equal(sentinel.detectReplyLanguage("Você tem filhos que dependem da sua renda? Isso é importante.", "english"), "portuguese");
  assert.equal(sentinel.detectReplyLanguage("Do you have kids who depend on your income?", "portuguese"), "english");
});

test("future-tense approval promises are caught in the three languages, with the person as the subject", () => {
  const cases = [
    ["Don't worry, you'll be approved. Who depends on your income?", "english"],
    ["You will definitely get approved with that history. Shall we keep going?", "english"],
    ["At your age you're guaranteed acceptance. What would you like to protect?", "english"],
    ["Your approval is guaranteed. What matters most to you?", "english"],
    ["It's 100% approved on our side. Who is the beneficiary?", "english"],
    ["Tranquilo, usted será aprobado. ¿Quién depende de usted?", "spanish"],
    ["Con ese historial lo van a aprobar seguro. ¿Le parece bien?", "spanish"],
    ["Su solicitud está garantizada. ¿Qué quiere proteger?", "spanish"],
    ["Fica tranquila, você vai ser aprovada. Quem depende da sua renda?", "portuguese"],
    ["Com esse histórico eles vão te aprovar, é certeza. Faz sentido?", "portuguese"],
    // Uma condição em outra oração não absolve a promessa.
    ["Once again, you're approved. Who is the beneficiary?", "english"],
    ["When you think about it, you'll be approved. Shall we continue?", "english"],
    ["Pode se tranquilizar, você vai ser aprovada. Quem depende de você?", "portuguese"],
  ];
  for (const [reply, language] of cases) {
    const result = check(reply, language);
    assert.ok(result.violations.includes("li_approval_claim"), `not detected: ${reply}`);
    assert.doesNotMatch(result.reply, /approved|aprobad|aprobar|aprovad|aprovar|guaranteed acceptance|garantizada/i, result.reply);
  }
});

test("hedged, negated or educational approval talk is never a violation", () => {
  const clean = [
    "I can't promise you'll be approved; the carrier decides after the application.",
    "Nobody can say you will be approved before underwriting. What matters is answering honestly.",
    "Guaranteed acceptance policies skip health questions, but they have a two year limited benefit.",
    "No le puedo prometer que usted será aprobado; eso lo decide la aseguradora.",
    "Não dá pra garantir que você vai ser aprovada, quem decide é a seguradora.",
    "If you're approved, the policy starts on the date the agent confirms with you.",
  ];
  for (const reply of clean) {
    const result = check(reply, "english");
    assert.deepEqual(result.violations, [], `false positive on: ${reply}`);
  }
});

test("the Spanish fallback uses usted, like the Spanish persona directive", () => {
  const result = check("Federal license.", "spanish");
  assert.match(result.reply, /^Permítame ser precisa: eso lo confirma con usted/);
  assert.doesNotMatch(result.reply, /\b(contigo|tu situación|te puedo)\b/i);
});
