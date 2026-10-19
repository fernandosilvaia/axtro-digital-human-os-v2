#!/usr/bin/env node
// Banco de cenários da Priscila.
//
// Modo padrão (offline, sem custo): valida os cenários, mede o prompt composto e
// prova que os critérios aprovam as respostas de referência boas e reprovam as
// ruins.
//
// Modo ao vivo (GASTA crédito do OpenRouter, uma geração por cenário): só com
//   PRISCILA_EVAL_LIVE_CONFIRM=spend-openrouter-credit e OPENROUTER_API_KEY.
// Usa o mesmo caminho de produção (runBrainChatCompletion, vertical
// life_insurance_qualification, toolCalling false) e avalia o texto CRU do
// modelo, antes da sentinela.

import process from "node:process";

import { runBrainChatCompletion } from "../../apps/portal/src/lib/brain/chat-completion-core.ts";
import { buildCloserVideoSystemPrompt } from "../../apps/portal/src/lib/brain/metodo-silva.ts";
import { buildLifeInsuranceCore, buildLifeInsuranceIdentity } from "../../apps/portal/src/lib/brain/life-insurance.ts";
import { gradeReply, REFERENCE_REPLIES } from "./checks.mjs";
import { SCENARIOS } from "./scenarios.mjs";

const LIVE_CONFIRM = "spend-openrouter-credit";

export function offlineReport() {
  const promptSizes = {};
  for (const language of ["english", "portuguese"]) {
    const base = { agentName: "Priscila", tenantName: "Billion Club", language, toolCalling: false };
    promptSizes[language] = buildCloserVideoSystemPrompt({
      ...base,
      identityOverride: buildLifeInsuranceIdentity({ ...base, mode: "qualification" }),
      domainCore: buildLifeInsuranceCore("qualification", language),
    }).length;
  }
  const references = [];
  for (const [id, replies] of Object.entries(REFERENCE_REPLIES)) {
    const scenario = SCENARIOS.find((candidate) => candidate.id === id);
    if (scenario === undefined) throw new Error(`reference without scenario: ${id}`);
    references.push({ id, good: gradeReply(scenario, replies.good), bad: gradeReply(scenario, replies.bad) });
  }
  return { scenarios: SCENARIOS.length, promptSizes, references };
}

async function liveReport() {
  const { createOpenRouterTextGenerationPort } = await import("../../packages/provider-openrouter/dist/index.js");
  const port = createOpenRouterTextGenerationPort({
    apiKey: process.env.OPENROUTER_API_KEY ?? "",
    appUrl: "https://closer.axtroai.com",
    appTitle: "Axtro Priscila eval",
  });
  const model = (process.env.OPENROUTER_MODEL ?? "").trim();
  if (model.length === 0) throw new Error("OPENROUTER_MODEL is required for the live run");
  const results = [];
  for (const scenario of SCENARIOS) {
    let raw = "";
    const result = await runBrainChatCompletion({
      agentName: "Priscila",
      tenantName: "Billion Club",
      surface: "video",
      // Espanhol: instruções em inglês e fala em espanhol, como a rota faz (D-V2-197).
      language: scenario.language === "portuguese" ? "portuguese" : "english",
      ...(scenario.language === "spanish" ? { spokenLanguage: "spanish" } : {}),
      closerVertical: "life_insurance_qualification",
      knowledgeMatches: [],
      history: scenario.history,
      userMessage: scenario.userMessage,
    }, {
      generate: async (messages, maxOutputTokens) => {
        const generated = await port.generate({ model, messages, maxOutputTokens });
        raw = generated.text;
        return generated;
      },
      logGenerationUsage: async () => {},
    });
    // `failures` mede o texto cru do modelo; `spokenFailures` mede o que de fato iria para a voz, depois do
    // sanitizador, do limitador de frases e da sentinela.
    results.push({ id: scenario.id, failures: gradeReply(scenario, raw), spokenFailures: gradeReply(scenario, result.reply), raw, spoken: result.reply });
  }
  const failed = results.filter((entry) => entry.failures.length > 0).length;
  const failedSpoken = results.filter((entry) => entry.spokenFailures.length > 0).length;
  return { model, scenarios: results.length, failed, failedSpoken, results };
}

async function main() {
  if ((process.env.PRISCILA_EVAL_LIVE_CONFIRM ?? "").trim() === LIVE_CONFIRM) {
    console.log(JSON.stringify(await liveReport(), null, 2));
    return;
  }
  const report = offlineReport();
  console.log(JSON.stringify(report, null, 2));
  const broken = report.references.filter((entry) => entry.good.length > 0 || entry.bad.length === 0);
  if (broken.length > 0) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`error: ${error.message}`);
    process.exit(1);
  });
}
