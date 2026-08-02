import { NextRequest, NextResponse } from "next/server";

import { parseRecallWebhookPayload, statusForRecallEvent, verifyRecallWebhookSignature } from "@/lib/meetings/webhook";
import { createServiceRoleClient, ServiceRoleUnavailableError } from "@/lib/supabase/service";
import { logError as trackError } from "@/lib/telemetry";

/**
 * Recebe eventos de status de bot do Recall.ai. Duas camadas de
 * autenticação, ambas exigidas quando configuradas: (1) token na URL
 * (?token=...) — mecanismo oficial original (docs.recall.ai/docs/
 * real-time-webhook-endpoints), a URL configurada no dashboard já carrega
 * o token; (2) assinatura HMAC nos cabeçalhos `webhook-id`/
 * `webhook-timestamp`/`webhook-signature` (docs.recall.ai/docs/
 * authenticating-requests-from-recallai), exigida só se
 * RECALL_WEBHOOK_SECRET estiver configurado — opcional pra não quebrar
 * ambientes sem o segredo do workspace gerado ainda. Servidor-a-servidor,
 * sem sessão de usuário — mesmo padrão de /api/brain e
 * /api/leads/video-session.
 */
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<Response> {
  const expectedToken = process.env.RECALL_WEBHOOK_TOKEN ?? "";
  if (expectedToken.trim().length < 16) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  const providedToken = request.nextUrl.searchParams.get("token") ?? "";
  if (providedToken !== expectedToken) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const rawBody = await request.text();

  const webhookSecret = process.env.RECALL_WEBHOOK_SECRET ?? "";
  if (webhookSecret.length > 0) {
    const signatureValid = verifyRecallWebhookSignature(
      webhookSecret,
      {
        id: request.headers.get("webhook-id"),
        timestamp: request.headers.get("webhook-timestamp"),
        signature: request.headers.get("webhook-signature"),
      },
      rawBody,
      Math.floor(Date.now() / 1000),
    );
    if (!signatureValid) {
      return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
    }
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid_json_body" }, { status: 400 });
  }

  const parsed = parseRecallWebhookPayload(body);
  if (parsed === null) {
    // Evento fora do escopo mapeado (ex.: participant_events, breakout room) — não é erro, só nada a fazer aqui.
    return NextResponse.json({ ok: true, handled: false });
  }
  const status = statusForRecallEvent(parsed.event);
  if (status === null) {
    return NextResponse.json({ ok: true, handled: false });
  }

  try {
    const supabase = createServiceRoleClient();
    const { data, error } = await supabase.rpc("portal_update_meeting_bot_session_status_service", {
      p_recall_bot_id: parsed.botId,
      p_status: status,
    });
    if (error) {
      trackError("recall_webhook_update_status_failed", error, { event: parsed.event });
      return NextResponse.json({ error: "internal_error" }, { status: 500 });
    }
    const found = (data as { found?: boolean } | null)?.found === true;
    return NextResponse.json({ ok: true, handled: found });
  } catch (error) {
    if (error instanceof ServiceRoleUnavailableError) {
      trackError("recall_webhook_service_role_unavailable", error, {});
      return NextResponse.json({ error: "not_configured" }, { status: 503 });
    }
    trackError("recall_webhook_unexpected_error", error, {});
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
