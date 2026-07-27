/**
 * M4-04: núcleo puro (ports-injected) do endpoint HTTP que o Tavus chama
 * como LLM da persona de vídeo (`layers.llm.base_url`). Isola a lógica de
 * auth, parsing e composição do transporte HTTP/SSE (route.ts) para ficar
 * testável sem servidor, Supabase ou rede — mesma disciplina do resto do
 * projeto (ports injetadas, sem I/O direto).
 *
 * Duas classes de falha, deliberadamente diferentes (Constituição Art. 14 —
 * degradação declarada):
 * - Falha de AUTENTICAÇÃO (bearer ausente/inválido/desabilitado/agente
 *   errado): rejeição dura antes de tocar qualquer dado de tenant — é
 *   fronteira de segurança, não qualidade de resposta.
 * - Falha DEPOIS de autenticar (RAG indisponível, provider fora do ar,
 *   requisição malformada do Tavus): nunca derruba a call — degrada para
 *   uma fala explícita que mantém o presenter vivo, nunca um 500 cru.
 */
import { runBrainChatCompletion, type BrainKnowledgeMatch } from "./chat-completion-core.ts";
import { hashBrainSecret } from "./secret.ts";
import { parseTavusChatRequest, TavusRequestParseError } from "./tavus-request.ts";

export interface ResolvedBrainAgent {
  readonly tenantId: string;
  readonly agentId: string;
  readonly agentName: string;
  readonly tenantName: string;
  readonly enabled: boolean;
}

export interface BrainRequestDeps {
  readonly resolveConfig: (secretHash: string) => Promise<ResolvedBrainAgent | null>;
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

export interface BrainChatHttpResult {
  readonly reply: string;
  /** true quando a resposta é um fallback degradado (Art. 14) em vez do texto gerado pelo provider. */
  readonly degraded: boolean;
}

const FALLBACK_REPLY = "Peço desculpa, deixa eu reorganizar isso rapidinho — pode repetir a última parte pra mim?";
const BEARER_PATTERN = /^Bearer\s+([a-f0-9]{64})$/;

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

  let parsed;
  try {
    parsed = parseTavusChatRequest(request.rawMessages);
  } catch (error) {
    if (error instanceof TavusRequestParseError) {
      // Requisição chegou autenticada mas malformada: degrada, não derruba a call.
      return { reply: FALLBACK_REPLY, degraded: true };
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
        knowledgeMatches,
        perceptionContext: parsed.perceptionContext,
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
  } catch {
    return { reply: FALLBACK_REPLY, degraded: true };
  }
}
