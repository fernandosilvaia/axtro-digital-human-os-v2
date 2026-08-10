import { NextRequest, NextResponse } from "next/server";

import { parseTavusTranscriptEvent } from "@/lib/transcripts/tavus-webhook";
import { constantTimeEquals } from "@/lib/security";
import { createServiceRoleClient, ServiceRoleUnavailableError } from "@/lib/supabase/service";
import { logError as trackError, logEvent } from "@/lib/telemetry";

/**
 * Recebe o callback de transcrição da Tavus (D-V2-106) — servidor-a-
 * servidor, sem sessão de usuário. A Tavus NÃO assina callbacks (confirmado
 * na doc oficial), então a única camada de autenticação é o token na URL
 * (?token=...), comparado em tempo constante — mesmo padrão usado pro
 * webhook do Recall.ai antes do HMAC existir.
 *
 * Só o evento `application.transcription_ready` é tratado; outros tipos
 * (system.replica_joined, recording.ready, ...) respondem 200 sem ação
 * (Art. 14: escopo declarado). A linha em conversation_transcripts PRECISA
 * já existir (criada na hora em que a conversa nasceu, contexto
 * autenticado) — este webhook nunca inventa o tenant dono da conversa.
 */
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<Response> {
  const expectedToken = (process.env.TAVUS_WEBHOOK_TOKEN ?? "").trim();
  if (expectedToken.length < 16) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  const providedToken = request.nextUrl.searchParams.get("token") ?? "";
  if (!constantTimeEquals(providedToken, expectedToken)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json_body" }, { status: 400 });
  }

  const parsed = parseTavusTranscriptEvent(body);
  if (parsed === null) {
    return NextResponse.json({ ok: true, handled: false });
  }

  try {
    const supabase = createServiceRoleClient();
    const { data, error } = await supabase.rpc("portal_append_transcript_turns_service", {
      p_surface: "video",
      p_external_ref: parsed.conversationId,
      p_turns: parsed.turns,
      p_ended_at: new Date().toISOString(),
    });
    if (error) {
      trackError("tavus_webhook_transcript_append_failed", error, { conversation_id: parsed.conversationId });
      return NextResponse.json({ error: "internal_error" }, { status: 500 });
    }
    const found = (data as { found?: boolean } | null)?.found === true;
    if (!found) {
      // Conversa sem linha prévia registrada (ex.: criada antes desta
      // feature existir) — não é erro nosso, mas fica visível.
      logEvent("tavus_webhook_transcript_no_matching_transcript", { conversation_id: parsed.conversationId });
    }
    return NextResponse.json({ ok: true, handled: found });
  } catch (error) {
    if (error instanceof ServiceRoleUnavailableError) {
      trackError("tavus_webhook_service_role_unavailable", error, {});
      return NextResponse.json({ error: "not_configured" }, { status: 503 });
    }
    trackError("tavus_webhook_unexpected_error", error, { conversation_id: parsed.conversationId });
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
