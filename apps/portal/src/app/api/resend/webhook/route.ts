import { NextRequest, NextResponse } from "next/server";

import { isHandledResendEventType, parseResendWebhookEvent, verifyResendWebhookSignature } from "@/lib/email-webhook";
import { logError as trackError, logEvent } from "@/lib/telemetry";

/**
 * Recebe eventos de entrega da Resend (achado onda 8, D-V2-117) —
 * servidor-a-servidor, sem sessão de usuário, mesmo padrão dos webhooks de
 * Stripe/Recall: assinatura obrigatória (RESEND_WEBHOOK_SECRET via Svix),
 * corpo cru lido ANTES do parse JSON.
 *
 * Requer configuração manual pendente (fora deste código): registrar este
 * endpoint no dashboard da Resend (Webhooks → Add Endpoint) selecionando
 * pelo menos email.bounced/email.complained/email.delivery_delayed, e
 * colar o "Signing Secret" gerado como RESEND_WEBHOOK_SECRET no Railway —
 * ver docs/NEEDS_CONNECTION.md.
 *
 * Só os 3 eventos de falha de entrega são tratados (ver lib/email-webhook.ts)
 * — email.sent/email.delivered respondem 200 sem ação (Art. 14: escopo
 * declarado). Escopo desta rota é só telemetria/visibilidade — não persiste
 * status de entrega por convite individual (feature maior, fora de escopo).
 */
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<Response> {
  const webhookSecret = (process.env.RESEND_WEBHOOK_SECRET ?? "").trim();
  if (webhookSecret.length === 0) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  const rawBody = await request.text();
  const signatureValid = verifyResendWebhookSignature(
    webhookSecret,
    request.headers.get("svix-id"),
    request.headers.get("svix-timestamp"),
    request.headers.get("svix-signature"),
    rawBody,
    Math.floor(Date.now() / 1000),
  );
  if (!signatureValid) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid_json_body" }, { status: 400 });
  }

  const parsed = parseResendWebhookEvent(body);
  if (parsed === null) {
    // Fora de escopo (email.sent/email.delivered/...) é silêncio esperado
    // (Art. 14) — mas se o TIPO é um dos 3 tratados e o parse ainda assim
    // falhou (payload sem data.email_id), isso é malformado, não "fora de
    // escopo", e não pode ficar invisível.
    const record = body as Record<string, unknown>;
    if (isHandledResendEventType(record.type)) {
      trackError("resend_webhook_malformed_event", new Error("event type in scope but payload is missing data.email_id"), { event_type: String(record.type) });
    }
    return NextResponse.json({ ok: true, handled: false });
  }

  // Nunca inclui o endereço do destinatário — email_id (não-PII) é
  // suficiente pra um operador correlacionar com o dashboard da Resend.
  trackError(`resend_${parsed.eventType.replace("email.", "")}`, new Error(`Resend reported ${parsed.eventType} for a transactional email`), { email_id: parsed.emailId });
  logEvent("resend_webhook_received", { event_type: parsed.eventType, email_id: parsed.emailId });
  return NextResponse.json({ ok: true, handled: true });
}
