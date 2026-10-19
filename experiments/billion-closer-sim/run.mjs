#!/usr/bin/env node
// Simulador de conversa do Closer da Billion Leads Pro. GASTA crédito do OpenRouter (várias chamadas por
// conversa). Só roda com BILLION_SIM_LIVE_CONFIRM=spend-openrouter-credit:
//   BILLION_SIM_LIVE_CONFIRM=spend-openrouter-credit VARIANT=billion_leads_sales RUNS=2 \
//   railway run --service portal -- node experiments/billion-closer-sim/run.mjs > saida.json
// VARIANT é a vertical da closer (billion_leads_sales ou metodo_silva) para comparar A contra B.
// O cliente é simulado pelo mesmo modelo; o juiz usa JUDGE_MODEL (padrão haiku 4.5: os modelos 5.5 voltam vazios com o
// orçamento de saída atual do adaptador). O juiz tem viés a favor do próprio modelo, então a nota é direcional; as
// métricas determinísticas (preço, promessa, prazo, fórmulas) é que valem como prova.

import process from "node:process";

import { runBrainChatCompletion } from "../../apps/portal/src/lib/brain/chat-completion-core.ts";
import { gradeReply } from "../billion-closer-eval/checks.mjs";
import { retrieveKnowledge } from "../billion-closer-eval/retrieve.mjs";
import { FACTS_FOR_JUDGE, OPENING, PERSONAS } from "./personas.mjs";

const MAX_TURNS = 7;
const CONCURRENCY = 3;

async function generate(port, model, system, user, maxOutputTokens = 300) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await port.generate({ model, messages: [{ role: "system", content: system }, { role: "user", content: user }], maxOutputTokens });
      if (result.text.trim().length > 0) return result.text.trim();
    } catch (error) {
      if (attempt === 2) throw error;
    }
  }
  throw new Error("empty generation after retries");
}

function transcript(history) {
  // O adaptador limita cada mensagem a 4000 caracteres: guarda só o fim da conversa.
  const lines = history.map((turn) => `${turn.role === "user" ? "CLIENTE" : "CLOSER"}: ${turn.content}`);
  let text = lines.join("\n");
  while (text.length > 3300 && lines.length > 2) { lines.shift(); text = lines.join("\n"); }
  return text;
}

async function simulateCustomer(port, model, persona, history) {
  const system = `Você interpreta um cliente real numa conversa de vendas por vídeo. ${persona.brief} OBJETIVO ESCONDIDO: ${persona.goal} Regras: responda SÓ com a próxima fala do cliente, em português do Brasil informal, de uma a duas frases curtas, como gente de verdade (sem listas, sem markdown, sem travessão). Reaja ao que a closer disse: se ela foi útil e honesta, avance; se enrolou, mostre impaciência; se prometeu demais, desconfie. Não entregue seu objetivo de uma vez. Quando decidir de verdade, termine a fala com uma destas marcas: [COMPRAR] se decidiu comprar ou ir ao passo seguinte, [SAIR] se desistiu ou vai pensar e some, [HUMANO] se pediu para falar com uma pessoa e aceitou.`;
  const text = await generate(port, model, system, `${transcript(history)}\n\nEscreva a próxima fala do CLIENTE.`, 160);
  const tag = /\[(COMPRAR|SAIR|HUMANO)\]/.exec(text)?.[1] ?? null;
  return { text: text.replace(/\[(COMPRAR|SAIR|HUMANO)\]/g, "").trim(), end: tag };
}

async function converse(port, model, vertical, persona) {
  const history = [{ role: "assistant", content: OPENING }];
  let userMessage = persona.opener;
  const turns = [];
  let end = null;
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const lastAssistant = history.at(-1)?.content ?? "";
    let raw = "";
    const result = await runBrainChatCompletion({
      agentName: "Bia", tenantName: "Billion Leads Pro", surface: "video", language: "portuguese", closerVertical: vertical,
      knowledgeMatches: retrieveKnowledge(`${userMessage} ${lastAssistant}`, 4), history: history.slice(-8), userMessage,
    }, {
      generate: async (messages, maxOutputTokens) => { const generated = await port.generate({ model, messages, maxOutputTokens }); raw = generated.text; return generated; },
      logGenerationUsage: async () => {},
    });
    const failures = gradeReply({ language: "portuguese", history, userMessage, expect: {} }, result.reply);
    turns.push({ customer: userMessage, closer: result.reply, failures });
    history.push({ role: "user", content: userMessage }, { role: "assistant", content: result.reply });
    const simulated = await simulateCustomer(port, model, persona, history);
    if (simulated.end !== null) { turns.push({ customer: simulated.text, closer: null, failures: [] }); end = simulated.end; break; }
    userMessage = simulated.text;
  }
  return { turns, end };
}

async function judge(port, judgeModel, persona, turns) {
  const lines = turns.flatMap((turn) => [`CLIENTE: ${turn.customer}`, ...(turn.closer === null ? [] : [`CLOSER: ${turn.closer}`])]).join("\n");
  const system = "Você é um diretor de vendas rigoroso que avalia uma closer de IA da Billion Leads Pro numa conversa com um cliente simulado. Responda SÓ com JSON, sem texto fora dele: {\"rapport\":n,\"escuta\":n,\"descoberta\":n,\"honestidade\":n,\"objecoes\":n,\"avanco\":n,\"voz\":n,\"naturalidade\":n,\"comentario\":\"uma frase\"}. Notas de 1 a 5 (5 = excelente). rapport: calor e conexão humana. escuta: reaproveita as palavras do cliente e responde ao que ele disse. descoberta: perguntas certas na hora certa, sem enrolar. honestidade: números e regras exatos conforme os FATOS, sem promessa de renda, sem inventar. objecoes: trata dúvidas com respeito e fatos. avanco: conduz ao próximo passo concreto sem pressão. voz: curta e falável em vídeo (1 a 2 frases, 1 pergunta). naturalidade: soa como gente, sem fórmulas de robô como elogiar a pergunta. Seja exigente: 5 é raro. Sem aspas dentro dos textos.\n\nFATOS VERDADEIROS:\n" + FACTS_FOR_JUDGE;
  // O adaptador limita cada mensagem a 4000 caracteres: fatos no system, conversa limitada no user.
  const user = `CLIENTE (${persona.id}): ${persona.brief}\nObjetivo escondido do cliente: ${persona.goal}\n\nCONVERSA:\n${lines.slice(-2900)}`;
  const text = await generate(port, judgeModel, system, user, 600);
  const match = /\{[\s\S]*\}/.exec(text);
  if (match === null) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}

async function main() {
  if ((process.env.BILLION_SIM_LIVE_CONFIRM ?? "").trim() !== "spend-openrouter-credit") {
    console.log(JSON.stringify({ personas: PERSONAS.map((persona) => persona.id), note: "dry run: set BILLION_SIM_LIVE_CONFIRM=spend-openrouter-credit to spend credit" }));
    return;
  }
  const { createOpenRouterTextGenerationPort } = await import("../../packages/provider-openrouter/dist/index.js");
  const port = createOpenRouterTextGenerationPort({ apiKey: process.env.OPENROUTER_API_KEY ?? "", appUrl: "https://closer.axtroai.com", appTitle: "Axtro Billion closer sim" });
  const model = (process.env.OPENROUTER_MODEL ?? "").trim();
  const judgeModel = (process.env.JUDGE_MODEL ?? "anthropic/claude-haiku-4.5").trim();
  const vertical = (process.env.VARIANT ?? "billion_leads_sales").trim();
  const runs = Number(process.env.RUNS ?? 2);
  const jobs = PERSONAS.flatMap((persona) => Array.from({ length: runs }, (_, run) => ({ persona, run })));
  const results = [];
  let cursor = 0;
  async function worker() {
    while (cursor < jobs.length) {
      const job = jobs[cursor++];
      try {
        const { turns, end } = await converse(port, model, vertical, job.persona);
        const scores = await judge(port, judgeModel, job.persona, turns).catch(() => null);
        results.push({ persona: job.persona.id, run: job.run, end, turns, scores });
      } catch (error) {
        results.push({ persona: job.persona.id, run: job.run, error: String(error.message).slice(0, 120) });
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(JSON.stringify({ model, judgeModel, vertical, runs, results }));
}

main().catch((error) => { console.error(`error: ${error.message}`); process.exit(1); });
