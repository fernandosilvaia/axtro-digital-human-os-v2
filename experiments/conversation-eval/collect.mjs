#!/usr/bin/env node
// Coletor da avaliação de conversa (DeepEval) e de busca (Ragas).
//
//   node experiments/conversation-eval/collect.mjs conversations
//   node experiments/conversation-eval/collect.mjs rag
//
// Sem confirmação, nada é pago:
// - `conversations` roda em ensaio (dry-run). Um gerador determinístico exercita
//   o caminho inteiro, inclusive o laço de tool (chamada, execução no processo,
//   resultado rotulado, nova geração). As linhas saem marcadas
//   `source: "dry-run"`, e evaluate.py se recusa a pontuar ensaio.
// - `rag` monta as referências a partir da base. Com EVAL_SUPABASE_URL de
//   loopback, também busca de verdade numa stack LOCAL com a base ingerida.
//   Sem chave, a busca é só lexical, o mesmo caminho degradado da produção.
//
// Ao vivo (GASTA crédito do OpenRouter) só com
//   CONVERSATION_EVAL_LIVE_CONFIRM=spend-openrouter-credit
//   OPENROUTER_API_KEY=... OPENROUTER_MODEL=...
// Aí as respostas da Priscila vêm do modelo real, pelo mesmo runBrainChatCompletion
// da produção, com a sentinela e o encaixe no teto de entrada.
//
// Saída em experiments/conversation-eval/out/ (ignorado pelo git): JSONL no
// formato que evaluate.py lê.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { runBrainChatCompletion } from "../../apps/portal/src/lib/brain/chat-completion-core.ts";
import { retrieveBrainKnowledge } from "../../apps/portal/src/lib/brain/knowledge-retrieval.ts";
import { TOOL_RESULT_PREFIX } from "../../apps/portal/src/lib/brain/tavus-request.ts";
import { coverageNeedToolOutput, estimateCoverageNeed } from "../../apps/portal/src/lib/insurance/coverage-need.ts";
import { CHATBOT_ROLE, CONVERSATIONS } from "./conversations.mjs";
import { RAG_QUESTIONS } from "./rag-questions.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const KNOWLEDGE_DIR = join(ROOT, "knowledge", "life-insurance", "priscila");
const OUT_DIR = join(HERE, "out");
export const LIVE_CONFIRM = "spend-openrouter-credit";
const MAX_TOOL_HOPS = 3;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** Mesmo mapeamento da rota: espanhol usa as instruções em inglês e fala espanhol. */
function brainLanguages(language) {
  if (language === "spanish") return { language: "english", spokenLanguage: "spanish" };
  return { language: language === "english" ? "english" : "portuguese" };
}

/**
 * Tools executadas no processo. A calculadora é a mesma do navegador. As de
 * agenda devolvem o texto no formato da produção (business-action-tool-call),
 * com horários fictícios: nada sai daqui para agenda ou CRM.
 */
export function runToolInProcess(call) {
  let args = {};
  try {
    args = JSON.parse(call.argumentsJson);
  } catch {
    return { status: "error", output: "Argumentos inválidos." };
  }
  if (call.name === "estimate_coverage_need") {
    const estimate = estimateCoverageNeed(args);
    return { status: estimate.outcome === "estimated" ? "success" : "error", output: coverageNeedToolOutput(estimate), estimate };
  }
  if (call.name === "register_lead") return { status: "success", output: "Lead registrado." };
  if (call.name === "propose_meeting_slots") {
    return { status: "success", output: "Horários disponíveis:\nOpção 1: terça-feira, 10:00 (horário central)\nOpção 2: terça-feira, 14:00 (horário central)\nOpção 3: quarta-feira, 11:00 (horário central)" };
  }
  if (call.name === "confirm_meeting_slot") return { status: "success", output: "Reunião confirmada." };
  return { status: "error", output: "Ferramenta desconhecida." };
}

/** Gerador de ensaio: sem modelo, só prova a fiação. Nunca serve como nota. */
export function dryRunGenerate(messages, _maxOutputTokens, options) {
  const last = messages.at(-1)?.content ?? "";
  const offered = new Set((options?.tools ?? []).map((tool) => tool.name));
  const usage = { inputTokens: 0, outputTokens: 0 };
  if (last.startsWith(TOOL_RESULT_PREFIX)) return { text: "Dry run: I read the tool result.", model: "dry-run", usage };
  if (offered.has("estimate_coverage_need") && /140,000/.test(last)) {
    return {
      text: "", model: "dry-run", usage,
      toolCalls: [{ id: "call_dry_coverage", name: "estimate_coverage_need", argumentsJson: JSON.stringify({ annualIncome: 70_000, yearsOfIncome: 15, mortgageBalance: 280_000, debts: 15_000, existingCoverage: 140_000, liquidSavings: 20_000 }) }],
    };
  }
  if (offered.has("propose_meeting_slots") && /@example\.com/.test(last)) {
    return { text: "", model: "dry-run", usage, toolCalls: [{ id: "call_dry_slots", name: "propose_meeting_slots", argumentsJson: JSON.stringify({ durationMinutes: 30 }) }] };
  }
  return { text: "Dry run reply.", model: "dry-run", usage };
}

/** Uma conversa inteira, turno a turno, com o laço de tool igual ao da Tavus. */
export async function playConversation(conversation, generate) {
  const turns = [];
  const history = [];
  for (const userTurn of conversation.userTurns) {
    turns.push({ role: "user", content: userTurn });
    let userMessage = userTurn;
    for (let hop = 0; hop < MAX_TOOL_HOPS; hop += 1) {
      const result = await runBrainChatCompletion({
        agentName: "Priscila",
        tenantName: "Billion Club",
        surface: "video",
        ...brainLanguages(conversation.language),
        closerVertical: "life_insurance_qualification",
        knowledgeMatches: [],
        history,
        userMessage,
        availableTools: conversation.tools,
      }, { generate, logGenerationUsage: async () => {} });
      history.push({ role: "user", content: userMessage });
      const executed = result.toolCalls.map((call) => ({ call, ...runToolInProcess(call) }));
      if (result.reply.length > 0 || executed.length > 0) {
        turns.push({
          role: "assistant",
          content: result.reply,
          ...(executed.length === 0 ? {} : {
            tools_called: executed.map(({ call, output }) => ({ name: call.name, input_parameters: JSON.parse(call.argumentsJson), output })),
          }),
          ...(result.guardrailFlags.length === 0 ? {} : { guardrail_flags: result.guardrailFlags }),
        });
      }
      if (result.reply.length > 0) history.push({ role: "assistant", content: result.reply });
      if (executed.length === 0) break;
      userMessage = `${TOOL_RESULT_PREFIX} ${executed.map((entry) => entry.output).join(" | ")}`;
    }
  }
  return {
    id: conversation.id,
    language: conversation.language,
    chatbot_role: CHATBOT_ROLE,
    scenario: conversation.scenario,
    user_description: conversation.userDescription,
    expected_outcome: conversation.expectedOutcome,
    retain: conversation.retain,
    turns,
  };
}

/** Seções `## ` da base, por arquivo. */
export function knowledgeSection(doc, section) {
  const text = readFileSync(join(KNOWLEDGE_DIR, doc), "utf8");
  const parts = text.split(/\n(?=## )/);
  const found = parts.find((part) => part.startsWith(`## ${section}\n`));
  if (found === undefined) throw new Error(`section "${section}" not found in ${doc}`);
  return found.trim();
}

export function ragReferenceRows() {
  return RAG_QUESTIONS.map((question) => ({
    id: question.id,
    user_input: question.question,
    reference: question.reference,
    reference_contexts: [knowledgeSection(question.doc, question.section)],
  }));
}

/** Cliente da stack LOCAL. URL fora de loopback é recusada: nunca toca produção. */
export function localSupabaseClient(env) {
  const url = (env.EVAL_SUPABASE_URL ?? "").trim();
  if (url.length === 0) return null;
  const parsed = new URL(url);
  if (!LOOPBACK_HOSTS.has(parsed.hostname)) throw new Error("EVAL_SUPABASE_URL must be a loopback address (local stack only)");
  for (const name of ["EVAL_SUPABASE_SERVICE_ROLE_KEY", "EVAL_TENANT_ID", "EVAL_AGENT_ID"]) {
    if ((env[name] ?? "").trim().length === 0) throw new Error(`${name} is required with EVAL_SUPABASE_URL`);
  }
  const require = createRequire(join(ROOT, "apps", "portal", "package.json"));
  const { createClient } = require("@supabase/supabase-js");
  return createClient(url, env.EVAL_SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}

async function openRouterPorts(env) {
  const provider = await import("../../packages/provider-openrouter/dist/index.js");
  const apiKey = env.OPENROUTER_API_KEY ?? "";
  const generationPort = provider.createOpenRouterTextGenerationPort({ apiKey, appUrl: "https://closer.axtroai.com", appTitle: "Axtro conversation eval" });
  const embeddingPort = provider.createOpenRouterEmbeddingPort({ apiKey, appUrl: "https://closer.axtroai.com", appTitle: "Axtro conversation eval" });
  const model = (env.OPENROUTER_MODEL ?? "").trim();
  if (model.length === 0) throw new Error("OPENROUTER_MODEL is required for the live run");
  return {
    generate: (messages, maxOutputTokens, options) => generationPort.generate({
      model, messages, maxOutputTokens,
      ...(options?.tools === undefined ? {} : { tools: options.tools }),
      ...(options?.cacheSystemPrompt === true ? { cacheSystemPrompt: true } : {}),
    }),
    embed: async (key, text) => {
      const result = await embeddingPort.embed({ model: "openai/text-embedding-3-small", inputs: [text] });
      return { embedding: result.embeddings[0], inputTokens: result.usage.inputTokens, ...(result.usage.reportedCostUsd === undefined ? {} : { reportedCostUsd: result.usage.reportedCostUsd }) };
    },
  };
}

function writeJsonl(name, rows) {
  mkdirSync(OUT_DIR, { recursive: true });
  const path = join(OUT_DIR, name);
  writeFileSync(path, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
  return path;
}

async function collectConversations(env, live) {
  const generate = live ? (await openRouterPorts(env)).generate : dryRunGenerate;
  const rows = [];
  for (const conversation of CONVERSATIONS) {
    rows.push({ ...(await playConversation(conversation, generate)), source: live ? "live" : "dry-run" });
  }
  return writeJsonl("conversations.jsonl", rows);
}

async function collectRag(env, live) {
  const rows = ragReferenceRows();
  const client = localSupabaseClient(env);
  const ports = live ? await openRouterPorts(env) : null;
  for (const row of rows) {
    if (client !== null) {
      const matches = await retrieveBrainKnowledge(
        { tenantId: env.EVAL_TENANT_ID, agentId: env.EVAL_AGENT_ID, queryText: row.user_input, idempotencyMaterial: `conversation-eval:${row.id}:${Date.now()}` },
        { client, apiKey: live ? env.OPENROUTER_API_KEY ?? "" : "", prepare: (text) => text.slice(0, 4_000), embed: ports?.embed ?? (async () => { throw new Error("embedding disabled"); }) },
      );
      row.retrieved_contexts = matches.map((match) => match.chunk_text);
      row.retrieval_mode = live ? "hybrid" : "lexical";
      if (live) {
        const result = await runBrainChatCompletion({
          agentName: "Priscila", tenantName: "Billion Club", surface: "video", language: "english",
          closerVertical: "life_insurance_qualification", knowledgeMatches: matches, history: [], userMessage: row.user_input,
        }, { generate: ports.generate, logGenerationUsage: async () => {} });
        row.response = result.reply;
      }
    }
    row.source = client === null ? "reference-only" : live ? "live" : "local-lexical";
  }
  return writeJsonl("rag.jsonl", rows);
}

async function main() {
  const mode = process.argv[2];
  const live = (process.env.CONVERSATION_EVAL_LIVE_CONFIRM ?? "").trim() === LIVE_CONFIRM;
  if (live && (process.env.OPENROUTER_API_KEY ?? "").trim().length === 0) throw new Error("OPENROUTER_API_KEY is required for the live run");
  if (mode === "conversations") console.log(`wrote ${await collectConversations(process.env, live)} (${live ? "live" : "dry-run"})`);
  else if (mode === "rag") console.log(`wrote ${await collectRag(process.env, live)}`);
  else throw new Error("usage: collect.mjs conversations|rag");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`error: ${error.message}`);
    process.exit(1);
  });
}
