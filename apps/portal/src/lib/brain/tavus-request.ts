/**
 * M4-02: traduz o array `messages` OpenAI-style que o Tavus envia via
 * `layers.llm.base_url` para o formato que `runBrainChatCompletion` espera.
 *
 * Duas decisões deliberadas (Constituição Art. 15 — dado externo nunca é
 * instrução):
 * 1. Toda mensagem role="system" enviada pelo Tavus é DESCARTADA da
 *    conversa — identidade, método e regras são nossas (buildCloserChatSystemMessages /
 *    buildCloserVideoSystemPrompt), nunca as do provider. Ainda assim, ela é
 *    varrida em busca de tags de percepção antes de ser descartada, porque o
 *    raven-1 pode anexar a leitura ambiente em qualquer papel de mensagem.
 * 2. Tags de percepção (`<user_appearance>`, `<user_emotions>`,
 *    `<user_screenshare>` — buildPerceptionQueries) são extraídas de
 *    QUALQUER mensagem, concatenadas e devolvidas como texto livre; o
 *    chamador (chat-completion-core) as trata como dado rotulado e não
 *    confiável, nunca como identidade.
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
}

const PERCEPTION_TAG_PATTERN = /<(user_appearance|user_emotions|user_screenshare)>[\s\S]*?<\/\1>/g;
const MAX_MESSAGES = 200;
const MAX_MESSAGE_CONTENT_CHARS = 20_000;

export function parseTavusChatRequest(rawMessages: unknown): ParsedTavusChatRequest {
  if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
    throw new TavusRequestParseError("messages must be a non-empty array");
  }
  if (rawMessages.length > MAX_MESSAGES) {
    throw new TavusRequestParseError(`messages must contain at most ${MAX_MESSAGES} entries`);
  }

  const perceptionPieces: string[] = [];
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

    const perceptionMatches = content.match(PERCEPTION_TAG_PATTERN);
    if (perceptionMatches) perceptionPieces.push(...perceptionMatches);

    if (role === "system") continue; // identidade e método são nossos, nunca os do Tavus.

    const withoutPerception = content.replace(PERCEPTION_TAG_PATTERN, "").trim();
    if (withoutPerception.length > 0) {
      turns.push({ role, content: withoutPerception });
    }
  }

  const last = turns.at(-1);
  if (last === undefined || last.role !== "user") {
    throw new TavusRequestParseError("messages must end in a non-empty user turn");
  }

  return {
    history: Object.freeze(turns.slice(0, -1)),
    userMessage: last.content,
    perceptionContext: perceptionPieces.length > 0 ? perceptionPieces.join("\n") : null,
  };
}
