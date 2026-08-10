/**
 * Núcleo puro do callback de transcrição da Tavus (D-V2-106,
 * docs.tavus.io/sections/webhooks-and-callbacks). Só o evento
 * `application.transcription_ready` carrega o que precisamos —
 * `properties.transcript`, array de `{role, content, timestamp, ...}`.
 * Normalizado pro mesmo shape `{role, content}` usado pelas outras 2
 * superfícies (chat, reunião externa), pra UI de revisão não precisar
 * saber de onde a conversa veio.
 *
 * SEM assinatura/HMAC (confirmado na doc — a Tavus não assina callbacks):
 * autenticação é só token na URL (?token=...), mesmo padrão do webhook do
 * Recall.ai antes do HMAC existir — comparação em tempo constante via
 * lib/security.ts, não repetida aqui.
 */

const MAX_TURN_CHARS = 4000;
const MAX_TURNS = 500;

export interface ParsedTavusTranscript {
  readonly conversationId: string;
  readonly turns: readonly { readonly role: "user" | "assistant"; readonly content: string }[];
}

/** Devolve null pra evento fora do escopo (outros event_type) ou payload malformado — nunca lança. */
export function parseTavusTranscriptEvent(body: unknown): ParsedTavusTranscript | null {
  if (body === null || typeof body !== "object") return null;
  const event = body as Record<string, unknown>;
  if (event.event_type !== "application.transcription_ready") return null;

  const conversationId = event.conversation_id;
  if (typeof conversationId !== "string" || conversationId.length === 0 || conversationId.length > 128) return null;

  const properties = event.properties as Record<string, unknown> | undefined;
  const rawTranscript = properties?.transcript;
  if (!Array.isArray(rawTranscript) || rawTranscript.length === 0 || rawTranscript.length > MAX_TURNS) return null;

  const turns: { role: "user" | "assistant"; content: string }[] = [];
  for (const item of rawTranscript) {
    if (item === null || typeof item !== "object") return null;
    const record = item as Record<string, unknown>;
    const role = record.role;
    const content = record.content;
    if (role !== "user" && role !== "assistant") return null;
    if (typeof content !== "string" || content.length === 0) continue; // turno vazio (silêncio) — pula, não é malformado.
    turns.push({ role, content: content.slice(0, MAX_TURN_CHARS) });
  }
  if (turns.length === 0) return null;

  return { conversationId, turns };
}
