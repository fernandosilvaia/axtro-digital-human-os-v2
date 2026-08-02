/**
 * Núcleo puro do webhook de status do Recall.ai (docs.recall.ai/docs/bot-status-change-events).
 * Autenticação por token na própria URL do webhook (mecanismo oficial
 * documentado) MAIS assinatura HMAC opcional (docs.recall.ai/docs/
 * authenticating-requests-from-recallai — formato Standard Webhooks/Svix,
 * confirmado 2026-08-01 depois que o Fernando gerou o segredo do
 * workspace no dashboard deles; antes disso o formato não estava
 * confirmado na doc e só o token era usado). Mapeia os eventos de status
 * do bot pro enum fechado de `meeting_bot_sessions.status`; eventos de
 * outro tipo (breakout room, participant_events) são ignorados nesta
 * versão — não é mentira nem erro, é escopo declarado (Art. 14: sem
 * cobertura, não inventa).
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const WEBHOOK_SECRET_PREFIX = "whsec_";
const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

export interface RecallWebhookSignatureHeaders {
  readonly id: string | null;
  readonly timestamp: string | null;
  readonly signature: string | null;
}

/**
 * Verifica a assinatura HMAC-SHA256 no formato Standard Webhooks: secreto
 * `whsec_<base64>`, string assinada `{id}.{timestamp}.{raw-body}`,
 * cabeçalho `webhook-signature` podendo trazer múltiplas assinaturas
 * espaço-separadas (`v1,<sig> v1,<sig> ...`, rotação de segredo) — basta
 * UMA bater. Comparação em tempo constante; timestamp fora de ±5min é
 * rejeitado (proteção contra replay).
 */
export function verifyRecallWebhookSignature(
  secret: string,
  headers: RecallWebhookSignatureHeaders,
  rawBody: string,
  nowSeconds: number,
): boolean {
  if (!secret.startsWith(WEBHOOK_SECRET_PREFIX)) return false;
  const { id, timestamp, signature } = headers;
  if (id === null || timestamp === null || signature === null) return false;
  if (id.length === 0 || timestamp.length === 0 || signature.length === 0) return false;

  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds)) return false;
  if (Math.abs(nowSeconds - timestampSeconds) > SIGNATURE_TOLERANCE_SECONDS) return false;

  let keyBytes: Buffer;
  try {
    keyBytes = Buffer.from(secret.slice(WEBHOOK_SECRET_PREFIX.length), "base64");
  } catch {
    return false;
  }
  if (keyBytes.length === 0) return false;

  const expected = createHmac("sha256", keyBytes).update(`${id}.${timestamp}.${rawBody}`).digest();

  for (const candidate of signature.split(" ")) {
    const separatorIndex = candidate.indexOf(",");
    if (separatorIndex === -1) continue;
    if (candidate.slice(0, separatorIndex) !== "v1") continue;
    let candidateBytes: Buffer;
    try {
      candidateBytes = Buffer.from(candidate.slice(separatorIndex + 1), "base64");
    } catch {
      continue;
    }
    if (candidateBytes.length !== expected.length) continue;
    if (timingSafeEqual(candidateBytes, expected)) return true;
  }
  return false;
}

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
