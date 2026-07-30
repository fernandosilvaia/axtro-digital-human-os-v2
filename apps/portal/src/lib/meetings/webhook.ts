/**
 * Núcleo puro do webhook de status do Recall.ai (docs.recall.ai/docs/bot-status-change-events).
 * Autenticação por token na própria URL do webhook (mecanismo oficial
 * documentado — mais simples e verificável do que adivinhar formato de
 * HMAC não confirmado na doc). Mapeia os eventos de status do bot pro
 * enum fechado de `meeting_bot_sessions.status`; eventos de outro tipo
 * (breakout room, participant_events) são ignorados nesta versão — não é
 * mentira nem erro, é escopo declarado (Art. 14: sem cobertura, não inventa).
 */

const STATUS_BY_EVENT: Readonly<Record<string, "joining" | "in_call" | "ended" | "failed">> = Object.freeze({
  "bot.joining_call": "joining",
  "bot.in_waiting_room": "joining",
  "bot.in_call_not_recording": "in_call",
  "bot.recording_permission_allowed": "in_call",
  "bot.in_call_recording": "in_call",
  "bot.call_ended": "ended",
  "bot.done": "ended",
  "bot.fatal": "failed",
});

export interface RecallBotStatusPayload {
  readonly event: string;
  readonly botId: string;
}

export function parseRecallWebhookPayload(rawBody: unknown): RecallBotStatusPayload | null {
  if (rawBody === null || typeof rawBody !== "object") return null;
  const record = rawBody as Record<string, unknown>;
  const event = record.event;
  if (typeof event !== "string" || !(event in STATUS_BY_EVENT)) return null;
  const data = record.data;
  if (data === null || typeof data !== "object") return null;
  const bot = (data as Record<string, unknown>).bot;
  if (bot === null || typeof bot !== "object") return null;
  const botId = (bot as Record<string, unknown>).id;
  if (typeof botId !== "string" || botId.length === 0) return null;
  return { event, botId };
}

export function statusForRecallEvent(event: string): "joining" | "in_call" | "ended" | "failed" | null {
  return STATUS_BY_EVENT[event] ?? null;
}
