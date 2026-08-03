/**
 * M4-02: traduz o array `messages` OpenAI-style que o Tavus envia via
 * `layers.llm.base_url` para o formato que `runBrainChatCompletion` espera.
 *
 * Decisões deliberadas (Constituição Art. 15 — dado externo nunca é
 * instrução), endurecidas pela auditoria de 2026-08-02:
 * 1. Toda mensagem role="system" enviada pelo Tavus é DESCARTADA como
 *    instrução — identidade, método e regras são nossas. O conteúdo útil
 *    dela é resgatado como DADO: tags de percepção viram perceptionContext,
 *    e o restante (o conversational_context que NÓS mesmos passamos ao criar
 *    a conversa — digest de conhecimento, roteiro de deck, resumo da ligação
 *    de voz) vira providerContext rotulado, senão o RAG de vídeo se perdia.
 * 2. Tags de percepção só são COLETADAS de mensagens system — o raven-1
 *    anexa a leitura ambiente via system. Tag aparecendo num turno user/
 *    assistant é texto controlável pelo interlocutor tentando se passar por
 *    sensor: é REMOVIDA do turno visível e NUNCA promovida a contexto
 *    (antes era coletada de qualquer papel — vetor de injeção real).
 */
import type { BrainTurn } from "./chat-completion-core.ts";

export class TavusRequestParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TavusRequestParseError";
  }
}

export interface ParsedTavusChatRequest {
  readonly history: readonly BrainTurn[];
  readonly userMessage: string;
  readonly perceptionContext: string | null;
  /** Conteúdo não-instrucional do system do Tavus (conversational_context que nós mesmos criamos) — dado rotulado, nunca identidade. */
  readonly providerContext: string | null;
}

const PERCEPTION_TAG_PATTERN = /<(user_appearance|user_emotions|user_screenshare)>[\s\S]*?<\/\1>/g;
const MAX_MESSAGES = 200;
const MAX_MESSAGE_CONTENT_CHARS = 20_000;
const MAX_PROVIDER_CONTEXT_CHARS = 6000;

export function parseTavusChatRequest(rawMessages: unknown): ParsedTavusChatRequest {
  if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
    throw new TavusRequestParseError("messages must be a non-empty array");
  }
  if (rawMessages.length > MAX_MESSAGES) {
    throw new TavusRequestParseError(`messages must contain at most ${MAX_MESSAGES} entries`);
  }

  const perceptionPieces: string[] = [];
  const providerContextPieces: string[] = [];
  const turns: { role: "user" | "assistant"; content: string }[] = [];

  for (const raw of rawMessages) {
    if (raw === null || typeof raw !== "object") {
      throw new TavusRequestParseError("each message must be an object");
    }
    const record = raw as Record<string, unknown>;
    const role = record.role;
    const content = record.content;
    if (typeof content !== "string") {
      throw new TavusRequestParseError("message content must be a plain string");
    }
    if (content.length > MAX_MESSAGE_CONTENT_CHARS) {
      throw new TavusRequestParseError(`message content must be at most ${MAX_MESSAGE_CONTENT_CHARS} chars`);
    }
    if (role !== "system" && role !== "user" && role !== "assistant") {
      throw new TavusRequestParseError("message role must be system, user or assistant");
    }

    if (role === "system") {
      // Percepção do raven-1 chega via system — único papel confiável pra isso.
      const perceptionMatches = content.match(PERCEPTION_TAG_PATTERN);
      if (perceptionMatches) perceptionPieces.push(...perceptionMatches);
      const remainder = content.replace(PERCEPTION_TAG_PATTERN, "").trim();
      if (remainder.length > 0) providerContextPieces.push(remainder);
      continue;
    }

    // Tag de percepção em turno user/assistant é conteúdo do interlocutor
    // imitando o sensor: some do turno visível e NÃO vira contexto.
    const withoutPerception = content.replace(PERCEPTION_TAG_PATTERN, "").trim();
    if (withoutPerception.length > 0) {
      turns.push({ role, content: withoutPerception });
    }
  }

  const last = turns.at(-1);
  if (last === undefined || last.role !== "user") {
    throw new TavusRequestParseError("messages must end in a non-empty user turn");
  }

  const providerContext = providerContextPieces.join("\n").trim();

  return {
    history: Object.freeze(turns.slice(0, -1)),
    userMessage: last.content,
    perceptionContext: perceptionPieces.length > 0 ? perceptionPieces.join("\n") : null,
    // Corta pelo início (slice negativo): num contexto acumulado, o final é o
    // mais recente/relevante — mesmo racional do bloco de percepção.
    providerContext: providerContext.length > 0 ? providerContext.slice(-MAX_PROVIDER_CONTEXT_CHARS) : null,
  };
}
