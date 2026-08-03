/**
 * M4-04: núcleo puro (ports-injected) do endpoint HTTP que o Tavus chama
 * como LLM da persona de vídeo (`layers.llm.base_url`). Isola a lógica de
 * auth, parsing e composição do transporte HTTP/SSE (route.ts) para ficar
 * testável sem servidor, Supabase ou rede — mesma disciplina do resto do
 * projeto (ports injetadas, sem I/O direto).
 *
 * Classes de falha, deliberadamente diferentes (Constituição Art. 14 —
 * degradação declarada):
 * - Falha de AUTENTICAÇÃO (bearer ausente/inválido/desabilitado/agente
 *   errado): rejeição dura antes de tocar qualquer dado de tenant — é
 *   fronteira de segurança, não qualidade de resposta.
 * - TETO DE ORÇAMENTO atingido (ou impossível de verificar): falha-fechada
 *   com fala de encerramento educada — dinheiro não vaza por indisponível.
 * - Falha DEPOIS de autenticar (RAG indisponível, provider fora do ar,
 *   requisição malformada do Tavus): nunca derruba a call — degrada para
 *   uma fala explícita que mantém o presenter vivo, nunca um 500 cru.
 *   Toda degradação carrega um `degradedReason` que a rota DEVE telemetrar
 *   (auditoria 2026-08-02: antes o catch era vazio e uma indisponibilidade
 *   total do provider parecia 100% saudável na operação).
 */
import type { BrainLanguage } from "./metodo-silva.ts";
import { runBrainChatCompletion, type BrainKnowledgeMatch } from "./chat-completion-core.ts";
import { hashBrainSecret } from "./secret.ts";
import { parseTavusChatRequest, TavusRequestParseError } from "./tavus-request.ts";

export interface ResolvedBrainAgent {
  readonly tenantId: string;
  readonly agentId: string;
  readonly agentName: string;
  readonly tenantName: string;
  readonly enabled: boolean;
  readonly language?: BrainLanguage;
}

export type BudgetVerdict = "allowed" | "exhausted" | "unavailable";

export interface BrainRequestDeps {
  readonly resolveConfig: (secretHash: string) => Promise<ResolvedBrainAgent | null>;
  /** Teto diário de tokens do tenant — falha-fechada: "unavailable" também degrada sem gerar. */
  readonly checkBudget: (tenantId: string) => Promise<BudgetVerdict>;
  readonly retrieveKnowledge: (tenantId: string, queryText: string) => Promise<readonly BrainKnowledgeMatch[]>;
  readonly generate: Parameters<typeof runBrainChatCompletion>[1]["generate"];
  readonly logGenerationUsage: (tenantId: string, agentId: string, inputTokens: number, outputTokens: number) => Promise<void>;
}

export type BrainHttpErrorCode = "missing_bearer" | "invalid_secret" | "agent_mismatch" | "malformed_request";

export class BrainHttpError extends Error {
  readonly code: BrainHttpErrorCode;
  readonly status: number;
  constructor(code: BrainHttpErrorCode, status: number, message: string) {
    super(message);
    this.name = "BrainHttpError";
    this.code = code;
    this.status = status;
  }
}

export interface BrainChatHttpRequest {
  readonly authorizationHeader: string | null;
  readonly agentIdFromPath: string;
  readonly rawMessages: unknown;
}

export type BrainDegradedReason = "malformed_request" | "budget_exhausted" | "budget_unavailable" | "generation_failed";

export interface BrainChatHttpResult {
  readonly reply: string;
  /** true quando a resposta é um fallback degradado (Art. 14) em vez do texto gerado pelo provider. */
  readonly degraded: boolean;
  readonly degradedReason?: BrainDegradedReason;
  /** O erro original quando degradedReason = generation_failed — a rota telemetra. */
  readonly cause?: unknown;
}

const FALLBACK_REPLY_PT = "Peço desculpa, deixa eu reorganizar isso rapidinho — pode repetir a última parte pra mim?";
const FALLBACK_REPLY_EN = "My apologies, let me collect that for a second — could you repeat the last part for me?";
const BUDGET_REPLY_PT = "Nosso tempo de hoje chegou ao limite da sessão — vou pedir pro time humano continuar com você daqui, com todo o nosso contexto. Obrigada pela conversa até aqui!";
const BUDGET_REPLY_EN = "We've reached today's session limit — I'll have our human team continue from here with full context. Thank you for the conversation so far!";
const BEARER_PATTERN = /^Bearer\s+([a-f0-9]{64})$/;

function fallbackReply(language: BrainLanguage | undefined): string {
  return language === "english" ? FALLBACK_REPLY_EN : FALLBACK_REPLY_PT;
}

function budgetReply(language: BrainLanguage | undefined): string {
  return language === "english" ? BUDGET_REPLY_EN : BUDGET_REPLY_PT;
}

function extractBearer(authorizationHeader: string | null): string | null {
  if (typeof authorizationHeader !== "string") return null;
  const match = authorizationHeader.match(BEARER_PATTERN);
  return match ? (match[1] ?? null) : null;
}

/**
 * Autentica e resolve o agente. Lança BrainHttpError (rejeição dura, sem
 * tocar dado de tenant) para toda falha de credencial — nunca degrada aqui.
 */
export async function authenticateBrainRequest(
  request: Pick<BrainChatHttpRequest, "authorizationHeader" | "agentIdFromPath">,
  resolveConfig: BrainRequestDeps["resolveConfig"],
): Promise<ResolvedBrainAgent> {
  const bearer = extractBearer(request.authorizationHeader);
  if (bearer === null) {
    throw new BrainHttpError("missing_bearer", 401, "missing or malformed Authorization bearer");
  }
  const secretHash = hashBrainSecret(bearer);
  const config = await resolveConfig(secretHash);
  if (config === null || !config.enabled) {
    throw new BrainHttpError("invalid_secret", 401, "no active brain config for this secret");
  }
  if (config.agentId !== request.agentIdFromPath) {
    // Mesma mensagem genérica do segredo inválido: não revela qual metade acertou.
    throw new BrainHttpError("agent_mismatch", 401, "no active brain config for this secret");
  }
  return config;
}

export async function handleBrainChatRequest(
  request: BrainChatHttpRequest,
  deps: BrainRequestDeps,
): Promise<BrainChatHttpResult> {
  const agent = await authenticateBrainRequest(request, deps.resolveConfig);

  // Teto de gasto ANTES de qualquer geração paga (auditoria 2026-08-02: o
  // endpoint não tinha teto nenhum — gasto ilimitado na chave da plataforma).
  // Falha-fechada: sem conseguir LER o orçamento, também não gera.
  let budget: BudgetVerdict;
  try {
    budget = await deps.checkBudget(agent.tenantId);
  } catch {
    budget = "unavailable";
  }
  if (budget !== "allowed") {
    return {
      reply: budget === "exhausted" ? budgetReply(agent.language) : fallbackReply(agent.language),
      degraded: true,
      degradedReason: budget === "exhausted" ? "budget_exhausted" : "budget_unavailable",
    };
  }

  let parsed;
  try {
    parsed = parseTavusChatRequest(request.rawMessages);
  } catch (error) {
    if (error instanceof TavusRequestParseError) {
      // Requisição chegou autenticada mas malformada: degrada, não derruba a call.
      return { reply: fallbackReply(agent.language), degraded: true, degradedReason: "malformed_request", cause: error };
    }
    throw error;
  }

  let knowledgeMatches: readonly BrainKnowledgeMatch[] = [];
  try {
    knowledgeMatches = await deps.retrieveKnowledge(agent.tenantId, parsed.userMessage);
  } catch {
    // RAG indisponível: segue sem fontes, nunca inventa (Art. 14) — não é motivo pra degradar a fala inteira.
    knowledgeMatches = [];
  }

  try {
    const result = await runBrainChatCompletion(
      {
        agentName: agent.agentName,
        tenantName: agent.tenantName,
        surface: "video",
        ...(agent.language === undefined ? {} : { language: agent.language }),
        knowledgeMatches,
        perceptionContext: parsed.perceptionContext,
        providerContext: parsed.providerContext,
        history: parsed.history,
        userMessage: parsed.userMessage,
      },
      {
        generate: deps.generate,
        logGenerationUsage: (inputTokens, outputTokens) =>
          deps.logGenerationUsage(agent.tenantId, agent.agentId, inputTokens, outputTokens),
      },
    );
    return { reply: result.reply, degraded: false };
  } catch (error) {
    return { reply: fallbackReply(agent.language), degraded: true, degradedReason: "generation_failed", cause: error };
  }
}
