/**
 * Núcleo puro do webhook de eventos de e-mail da Resend (achado onda 8,
 * D-V2-117): sem isto, um bounce/complaint pós-aceite (endereço inválido,
 * caixa cheia, marcado como spam) nunca chegava ao produto — o e-mail de
 * convite de membro ou de alerta de bloqueio de conta podia falhar depois
 * do "sent: true" sem NENHUM sinal, nem pro admin do tenant nem pra Axtro.
 *
 * A Resend assina webhooks via Svix (docs.resend.com/dashboard/webhooks/
 * verify-webhooks-requests): cabeçalhos `svix-id`/`svix-timestamp`/
 * `svix-signature`, segredo no formato `whsec_<base64>`, conteúdo assinado
 * `{svix-id}.{svix-timestamp}.{raw-body}`, HMAC-SHA256 em base64, tolerância
 * de replay de 5min — mesmo desenho de janela/comparação em tempo constante
 * já usado nos webhooks da Stripe (billing/webhook.ts) e do Recall
 * (meetings/webhook.ts), adaptado pro formato específico da Svix.
 *
 * Escopo deliberado: só sinaliza QUE um bounce/complaint aconteceu (pra
 * telemetria/alerta de taxa de erro, D-V2-114) — não persiste status de
 * entrega por convite/e-mail individual em tabela nova (feature maior,
 * fora do escopo desta correção).
 */
import { createHmac, timingSafeEqual } from "node:crypto";

const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

const HANDLED_EVENT_TYPES = new Set(["email.bounced", "email.complained", "email.delivery_delayed"]);

export function isHandledResendEventType(eventType: unknown): boolean {
  return typeof eventType === "string" && HANDLED_EVENT_TYPES.has(eventType);
}

export function verifyResendWebhookSignature(
  secret: string,
  svixId: string | null,
  svixTimestamp: string | null,
  svixSignatureHeader: string | null,
  rawBody: string,
  nowSeconds: number,
): boolean {
  if (typeof secret !== "string" || !secret.startsWith("whsec_")) return false;
  if (typeof svixId !== "string" || svixId.length === 0) return false;
  if (typeof svixTimestamp !== "string" || svixTimestamp.length === 0) return false;
  if (typeof svixSignatureHeader !== "string" || svixSignatureHeader.length === 0) return false;

  const timestampSeconds = Number(svixTimestamp);
  if (!Number.isFinite(timestampSeconds)) return false;
  if (Math.abs(nowSeconds - timestampSeconds) > SIGNATURE_TOLERANCE_SECONDS) return false;

  let secretBytes: Buffer;
  try {
    secretBytes = Buffer.from(secret.slice("whsec_".length), "base64");
  } catch {
    return false;
  }
  if (secretBytes.length === 0) return false;

  const expected = createHmac("sha256", secretBytes).update(`${svixId}.${svixTimestamp}.${rawBody}`).digest();

  // svix-signature: lista separada por espaço de "v1,<base64>" (rotação de segredo pode trazer mais de um) — basta uma bater.
  for (const part of svixSignatureHeader.split(" ")) {
    const separatorIndex = part.indexOf(",");
    if (separatorIndex === -1) continue;
    const version = part.slice(0, separatorIndex);
    const candidate = part.slice(separatorIndex + 1);
    if (version !== "v1" || candidate.length === 0) continue;
    let candidateBytes: Buffer;
    try {
      candidateBytes = Buffer.from(candidate, "base64");
    } catch {
      continue;
    }
    if (candidateBytes.length !== expected.length) continue;
    if (timingSafeEqual(candidateBytes, expected)) return true;
  }
  return false;
}

export interface ParsedResendEvent {
  readonly eventType: string;
  /** Id do e-mail na Resend — não é PII, serve pra correlacionar com o dashboard da Resend. */
  readonly emailId: string;
}

/** Nunca extrai o endereço do destinatário: a disciplina de redação de telemetria (telemetry.ts) já trata e-mail como PII em todo o produto. */
export function parseResendWebhookEvent(body: unknown): ParsedResendEvent | null {
  if (body === null || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  if (!isHandledResendEventType(record.type)) return null;
  const data = record.data;
  if (data === null || typeof data !== "object") return null;
  const emailId = (data as Record<string, unknown>).email_id;
  if (typeof emailId !== "string" || emailId.length === 0) return null;
  return { eventType: record.type as string, emailId };
}
