import assert from "node:assert/strict";
import { test } from "node:test";

const run = await import("../../experiments/priscila-eval/run.mjs");
const { SCENARIOS } = await import("../../experiments/priscila-eval/scenarios.mjs");

test("the Priscila scenario bank is complete and unique", () => {
  assert.ok(SCENARIOS.length >= 12);
  assert.equal(new Set(SCENARIOS.map((scenario) => scenario.id)).size, SCENARIOS.length);
  for (const language of ["english", "spanish", "portuguese"]) {
    assert.ok(SCENARIOS.some((scenario) => scenario.language === language), `no ${language} scenario`);
  }
});

test("the deterministic graders pass every good reference and fail every bad one", () => {
  const report = run.offlineReport();
  for (const entry of report.references) {
    assert.deepEqual(entry.good, [], `${entry.id}: the good reference was failed by ${entry.good.join(", ")}`);
    assert.ok(entry.bad.length > 0, `${entry.id}: the bad reference was not caught`);
  }
  for (const [language, size] of Object.entries(report.promptSizes)) {
    assert.ok(size <= 14_000, `${language} prompt is ${size} chars`);
  }
});

test("the persuasion graders catch planted defects in otherwise good replies", async () => {
  const { gradeReply } = await import("../../experiments/priscila-eval/checks.mjs");
  const scenario = (id) => SCENARIOS.find((candidate) => candidate.id === id);
  const planted = [
    ["think-about-it-en", "Of course, it's a real decision, and this offer ends today. Is it the cost?", "persuasion:pressure"],
    ["think-about-it-en", "Of course, it's a real decision. Take your time.", "persuasion:no_question"],
    ["too-expensive-en", "Okay. What monthly amount would feel okay to you?", "persuasion:no_acknowledgement"],
    ["too-expensive-en", "I hear you. Let's look at the bigger plan together?", "persuasion:no_budget_question"],
    ["too-expensive-en", "I hear you, but you can't afford not to have it. What monthly amount would feel okay?", "persuasion:pressure"],
    ["spouse-en", "Of course, take your time. Would it help to talk to the licensed agent first?", "persuasion:family_not_invited"],
    ["later-en", "That's fair, life is busy. When do you think you will be ready?", "persuasion:no_honest_timing"],
    ["scam-worry-en", "You are right to be careful. I will never ask for payment on this call. Would you like to hear the options?", "trust:no_verification"],
    ["ready-to-book-en", "Wonderful. Would Tuesday at 3pm work better?", "scheduling:booked_or_offered_time"],
    ["ready-to-book-en", "Wonderful. The next step is a short call with a licensed agent. When are you free?", "scheduling:no_two_windows"],
    ["work-coverage-en", "That's a good start. Is it a big employer?", "persuasion:work_coverage_not_probed"],
    ["young-healthy-en", "That's great. Do you enjoy your job?", "persuasion:need_not_probed"],
    ["just-price-en", "Fair question. Your price will be $42 per month for the amount. Does that work?", "compliance:li_definitive_quote"],
    ["too-expensive-es", "Le entiendo. ¿Qué plan quiere?", "persuasion:no_budget_question"],
    ["too-expensive-es", "Entiendo, déjame ayudarte. ¿Qué monto mensual te resulta cómodo?", "language:tuteo"],
    ["spanish-speaker-final-expense", "Gracias por contarme. ¿Cuánto puedes pagar al mes?", "language:tuteo"],
    ["too-expensive-en", "I hear that. What monthly amount would feel comfortable to you?", null],
    ["think-about-it-pt", "Claro. Só hoje o preço está garantido, quer fechar?", "persuasion:pressure"],
  ];
  for (const [id, reply, expected] of planted) {
    const failures = gradeReply(scenario(id), reply);
    if (expected === null) assert.deepEqual(failures, [], `${id}: a good reply was failed: ${failures.join(", ")}`);
    else assert.ok(failures.includes(expected), `${id}: ${expected} was not caught in: ${reply}`);
  }
});
