#!/usr/bin/env node
// Avaliação do Closer da Billion Leads Pro.
//
// Modo padrão (offline, sem custo): valida os cenários, mede o prompt composto, prova que os critérios
// aprovam as respostas de referência boas e reprovam as ruins, e confere que a recuperação simulada traz o
// trecho certo da base para cada cenário.
//
// Modo ao vivo (GASTA crédito do OpenRouter, uma geração por cenário e repetição):
//   BILLION_EVAL_LIVE_CONFIRM=spend-openrouter-credit REPS=3 \
//   railway run --service portal -- node experiments/billion-closer-eval/run.mjs
// Usa o mesmo caminho de produção (runBrainChatCompletion, vídeo, vertical metodo_silva) com os trechos da
// base injetados pela recuperação simulada, e avalia o texto cru do modelo e o que iria para a voz.

import process from "node:process";

import { runBrainChatCompletion } from "../../apps/portal/src/lib/brain/chat-completion-core.ts";
import { buildBillionLeadsCore } from "../../apps/portal/src/lib/brain/billion-leads.ts";
import { buildCloserVideoSystemPrompt } from "../../apps/portal/src/lib/brain/metodo-silva.ts";
import { gradeReply, REFERENCE_REPLIES } from "./checks.mjs";
import { knowledgeChunkCount, retrieveKnowledge } from "./retrieve.mjs";
import { SCENARIOS } from "./scenarios.mjs";

const LIVE_CONFIRM = "spend-openrouter-credit";
const AGENT_NAME = "Bia";
const TENANT_NAME = "Billion Leads Pro";

function queryFor(scenario) {
  const lastAssistant = [...scenario.history].reverse().find((turn) => turn.role === "assistant");
  return `${scenario.userMessage} ${lastAssistant?.content ?? ""}`;
}

export function offlineReport() {
  const promptSizes = {};
  for (const language of ["english", "portuguese"]) {
    promptSizes[language] = buildCloserVideoSystemPrompt({ agentName: AGENT_NAME, tenantName: TENANT_NAME, language, toolCalling: false, domainCore: buildBillionLeadsCore(language), regulatedVertical: false }).length;
  }
  const references = [];
  for (const [id, replies] of Object.entries(REFERENCE_REPLIES)) {
    const scenario = SCENARIOS.find((candidate) => candidate.id === id);
    if (scenario === undefined) throw new Error(`reference without scenario: ${id}`);
    references.push({ id, good: gradeReply(scenario, replies.good), bad: gradeReply(scenario, replies.bad) });
  }
  const retrieval = SCENARIOS.map((scenario) => ({ id: scenario.id, sources: [...new Set(retrieveKnowledge(queryFor(scenario), 4, scenario.kb).map((match) => match.source_name))] }));
  return { scenarios: SCENARIOS.length, chunks: knowledgeChunkCount(), promptSizes, references, retrieval };
}

async function liveReport() {
  const { createOpenRouterTextGenerationPort } = await import("../../packages/provider-openrouter/dist/index.js");
  const port = createOpenRouterTextGenerationPort({ apiKey: process.env.OPENROUTER_API_KEY ?? "", appUrl: "https://closer.axtroai.com", appTitle: "Axtro Billion closer eval" });
  const model = (process.env.OPENROUTER_MODEL ?? "").trim();
  if (model.length === 0) throw new Error("OPENROUTER_MODEL is required for the live run");
  const reps = Number(process.env.REPS ?? 1);
  const only = (process.env.IDS ?? "").split(",").filter(Boolean);
  const results = [];
  for (let rep = 0; rep < reps; rep++) {
    for (const scenario of SCENARIOS.filter((candidate) => only.length === 0 || only.includes(candidate.id))) {
      let raw = "";
      try {
        const result = await runBrainChatCompletion({
          agentName: AGENT_NAME,
          tenantName: TENANT_NAME,
          surface: "video",
          closerVertical: "billion_leads_sales",
          language: scenario.language === "portuguese" ? "portuguese" : "english",
          ...(scenario.language === "spanish" ? { spokenLanguage: "spanish" } : {}),
          knowledgeMatches: retrieveKnowledge(queryFor(scenario), 4, scenario.kb),
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
        results.push({ id: scenario.id, rep, failures: gradeReply(scenario, raw), spokenFailures: gradeReply(scenario, result.reply), raw, spoken: result.reply });
      } catch (error) {
        results.push({ id: scenario.id, rep, failures: [`run_error:${String(error.message).slice(0, 80)}`], spokenFailures: [`run_error`], raw: "", spoken: "" });
      }
    }
  }
  const valid = results.filter((entry) => !entry.failures[0]?.startsWith("run_error"));
  return {
    model, reps, replies: results.length, valid: valid.length,
    cleanRaw: valid.filter((entry) => entry.failures.length === 0).length,
    cleanSpoken: valid.filter((entry) => entry.spokenFailures.length === 0).length,
    results,
  };
}

async function main() {
  if ((process.env.BILLION_EVAL_LIVE_CONFIRM ?? "").trim() === LIVE_CONFIRM) {
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
