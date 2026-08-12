import { NextRequest, NextResponse } from "next/server";

import { createRecallMeetingBotPort, type RecallRegion } from "@axtro/provider-recall";
import { createTavusVideoConversationPort } from "@axtro/provider-tavus";

import { agentFaceStageUrl } from "@/lib/meetings/stage";
import { parseRecallTranscriptDonePayload, parseRecallWebhookPayload, statusForRecallEvent, verifyRecallWebhookSignature } from "@/lib/meetings/webhook";
import { constantTimeEquals } from "@/lib/security";
import { createServiceRoleClient, ServiceRoleUnavailableError } from "@/lib/supabase/service";
import { logError as trackError, logEvent } from "@/lib/telemetry";
import { sendMeetingEndedEmail } from "@/lib/email";

/**
 * Recebe eventos de status de bot do Recall.ai. Duas camadas de
 * autenticação, ambas exigidas quando configuradas: (1) token na URL
 * (?token=...) — mecanismo oficial original, comparado em tempo constante e
 * com resposta 401 idêntica à da assinatura (a auditoria 2026-08-02 achou
 * `!==` cru e corpos 401 distintos funcionando como oráculo do token);
 * (2) assinatura HMAC nos cabeçalhos webhook-* (Standard Webhooks), exigida
 * só se RECALL_WEBHOOK_SECRET estiver configurado.
 *
 * Além de atualizar o status da sessão, este webhook fecha o ciclo do bot
 * SENTINELA agendado: quando um bot entra na call (in_call) e a sessão dele
 * ainda não tem sala Tavus (agendado não cria sala na hora — ela expiraria
 * antes do horário), é AQUI que a sala nasce e a câmera é ligada.
 */
export const dynamic = "force-dynamic";

const IN_CALL_EVENTS = new Set(["bot.in_call_not_recording", "bot.in_call_recording", "bot.recording_permission_allowed"]);

// Mesmo teto do caminho Tavus (lib/transcripts/tavus-webhook.ts) — achado P1
// da auto-revisão 2026-08-11: sem isso, um bloco de fala contínua >8000
// chars OU uma reunião com >1000 blocos de diarização (uma call de até 40min,
// automatic_leave.in_call_not_recording_timeout=2400s) faz o validador SQL
// (app.validate_transcript_turns, 0029) rejeitar o array INTEIRO — a
// transcrição inteira era perdida em silêncio, sem nem um salvamento
// parcial. Trunca por turno E corta o array ANTES do teto do banco, com
// folga — parcial é sempre melhor que nada.
const MAX_TURN_CHARS = 4000;
const MAX_TURNS = 500;

interface SentinelSessionRow {
  readonly tenant_id: string;
  readonly agent_id: string;
  readonly tavus_conversation_id: string | null;
}

/**
 * Bot sentinela entrou na reunião e ainda não tem sala: cria a conversa
 * Tavus da persona do agente e liga a câmera do bot no palco. Idempotente
 * por construção — só roda quando tavus_conversation_id é null, e grava o
 * id antes de qualquer retorno feliz.
 */
async function attachSentinelCamera(botId: string): Promise<void> {
  const tavusApiKey = (process.env.TAVUS_API_KEY ?? "").trim();
  const recallApiKey = (process.env.RECALL_API_KEY ?? "").trim();
  const recallRegion = (process.env.RECALL_API_REGION ?? "").trim() as RecallRegion;
  if (tavusApiKey.length === 0 || recallApiKey.length === 0 || recallRegion.length === 0) return;

  const supabase = createServiceRoleClient();
  const { data: session, error: sessionError } = await supabase
    .from("meeting_bot_sessions")
    .select("tenant_id, agent_id, tavus_conversation_id")
    .eq("recall_bot_id", botId)
    .maybeSingle();
  if (sessionError || session === null) {
    if (sessionError) trackError("recall_webhook_sentinel_lookup_failed", sessionError, { bot_id: botId });
    return;
  }
  const row = session as SentinelSessionRow;
  if (row.tavus_conversation_id !== null) return; // entrada imediata ou já ligada — nada a fazer.

  const { data: config, error: configError } = await supabase
    .from("agent_video_config")
    .select("tavus_persona_id, language")
    .eq("tenant_id", row.tenant_id)
    .eq("agent_id", row.agent_id)
    .maybeSingle();
  if (configError || config === null || typeof config.tavus_persona_id !== "string") {
    trackError("recall_webhook_sentinel_no_persona", configError ?? new Error("persona ausente"), { bot_id: botId });
    return;
  }
  const { data: agent } = await supabase
    .from("agents")
    .select("name")
    .eq("tenant_id", row.tenant_id)
    .eq("id", row.agent_id)
    .maybeSingle();

  const tavusPort = createTavusVideoConversationPort({ apiKey: tavusApiKey });
  const conversation = await tavusPort.createConversation({
    personaId: config.tavus_persona_id,
    conversationName: `meeting-sentinel-${botId.slice(0, 8)}`,
    ...(typeof config.language === "string" ? { language: config.language } : {}),
    maxCallDurationSeconds: 1800,
  });

  // Grava o id ANTES de ligar a câmera (claim): dois webhooks concorrentes
  // não criam duas salas pagas — o filtro .is(null) só deixa UM vencer. Se a
  // câmera falhar depois, o catch abaixo desfaz a claim e encerra a sala.
  const { error: updateError } = await supabase
    .from("meeting_bot_sessions")
    .update({ tavus_conversation_id: conversation.conversationId, updated_at: new Date().toISOString() })
    .eq("recall_bot_id", botId)
    .is("tavus_conversation_id", null);
  if (updateError) {
    trackError("recall_webhook_sentinel_update_failed", updateError, { bot_id: botId });
    // Sala criada mas não registrada — encerra pra não vazar dinheiro.
    try { await tavusPort.endConversation(conversation.conversationId); } catch { /* best-effort */ }
    return;
  }

  const recallPort = createRecallMeetingBotPort({ apiKey: recallApiKey, region: recallRegion });
  try {
    await recallPort.startCameraWebpage(botId, agentFaceStageUrl(conversation.conversationUrl));
  } catch (startError) {
    // Câmera não ligou: desfaz a claim e encerra a sala pra (a) não vazar
    // dinheiro e (b) deixar o PRÓXIMO evento in_call re-tentar do zero.
    try { await tavusPort.endConversation(conversation.conversationId); } catch { /* best-effort */ }
    await supabase
      .from("meeting_bot_sessions")
      .update({ tavus_conversation_id: null, updated_at: new Date().toISOString() })
      .eq("recall_bot_id", botId)
      .eq("tavus_conversation_id", conversation.conversationId);
    throw startError;
  }

  // Conta no ledger/teto de vídeo do tenant — melhor esforço (RPC _service
  // da 0024; sem ela aplicada, fica telemetrado, nunca quebra o attach).
  const { error: usageError } = await supabase.rpc("portal_log_video_usage_service", {
    p_tenant_id: row.tenant_id,
    p_id: crypto.randomUUID(),
  });
  if (usageError) trackError("recall_webhook_sentinel_usage_log_failed", usageError, { bot_id: botId });

  logEvent("recall_sentinel_camera_attached", { bot_id: botId, agent_name: typeof agent?.name === "string" ? agent.name : "?" });
}

/**
 * Notifica os admins do tenant quando a reunião externa termina (achado da
 * auditoria 2026-08-06) — best-effort, nunca falha o webhook. Só dispara em
 * transição REAL (applied=true na RPC de status): um retry do Recall.ai
 * reentregando o mesmo evento 'ended' não deve mandar um segundo e-mail.
 */
async function notifyMeetingEnded(botId: string, status: "ended" | "failed"): Promise<void> {
  const supabase = createServiceRoleClient();
  const { data: session, error: sessionError } = await supabase
    .from("meeting_bot_sessions")
    .select("tenant_id, agent_id, meeting_url")
    .eq("recall_bot_id", botId)
    .maybeSingle();
  if (sessionError || session === null) {
    if (sessionError) trackError("recall_webhook_notify_lookup_failed", sessionError, { bot_id: botId });
    return;
  }
  const row = session as { tenant_id: string; agent_id: string; meeting_url: string };

  const [agentResult, tenantResult, adminsResult] = await Promise.all([
    supabase.from("agents").select("name").eq("tenant_id", row.tenant_id).eq("id", row.agent_id).maybeSingle(),
    supabase.from("tenants").select("legal_name").eq("id", row.tenant_id).maybeSingle(),
    supabase.rpc("portal_list_admin_emails_service", { p_tenant_id: row.tenant_id }),
  ]);
  const agentName = typeof agentResult.data?.name === "string" ? agentResult.data.name : "Agente";
  const workspaceName = typeof tenantResult.data?.legal_name === "string" ? tenantResult.data.legal_name : "sua conta";
  const admins = Array.isArray(adminsResult.data) ? (adminsResult.data as string[]) : [];
  if (adminsResult.error) {
    trackError("recall_webhook_notify_admins_lookup_failed", adminsResult.error, { bot_id: botId });
    return;
  }
  if (admins.length === 0) return;

  await sendMeetingEndedEmail({
    to: admins,
    workspaceName,
    agentName,
    meetingUrl: row.meeting_url,
    status,
  });
}

/**
 * Reunião terminou e a transcrição ficou pronta (D-V2-106) — busca o
 * conteúdo em 2 hops (metadata → download_url → conteúdo, docs.recall.ai/
 * docs/async-transcription) e grava como histórico. A Recall não dá um
 * `role` explícito por bloco (diferente do Tavus) — só o nome do
 * participante; o bloco cujo nome bate com o nome do agente vira
 * 'assistant', o resto (o lead e qualquer outro participante real) vira
 * 'user'. Best-effort: nunca derruba o webhook.
 *
 * LIMITAÇÃO CONHECIDA (achado P2 da revisão adversarial 2026-08-10,
 * confirmado 3x): esse match é por NOME, então um participante que renomeia
 * a si mesmo pra bater exatamente com o nome do agente sai marcado como
 * 'assistant' na transcrição. `isHost` não serve de sinal melhor (o bot
 * normalmente entra como convidado, não host — quem agendou a reunião é
 * que costuma ser host). Corrigir de verdade exigiria capturar o
 * participant_id do PRÓPRIO bot via evento de participante em tempo real
 * durante a call (não capturado hoje) — fora do escopo desta rodada.
 * Impacto aceito: pior caso é um rótulo trocado numa tela de leitura
 * (não vaza dado entre tenants, não abre acesso indevido).
 */
async function processMeetingTranscript(botId: string, transcriptId: string): Promise<boolean> {
  const recallApiKey = (process.env.RECALL_API_KEY ?? "").trim();
  const recallRegion = (process.env.RECALL_API_REGION ?? "").trim() as RecallRegion;
  if (recallApiKey.length === 0 || recallRegion.length === 0) return false;

  const supabase = createServiceRoleClient();
  const { data: agentContext, error: agentError } = await supabase.rpc("portal_get_meeting_bot_agent_service", {
    p_recall_bot_id: botId,
  });
  if (agentError || agentContext === null) {
    if (agentError) trackError("recall_webhook_transcript_agent_lookup_failed", agentError, { bot_id: botId });
    return false;
  }
  const agentName = (agentContext as { agentName?: unknown }).agentName;
  if (typeof agentName !== "string") return false;

  const recallPort = createRecallMeetingBotPort({ apiKey: recallApiKey, region: recallRegion });
  const metadata = await recallPort.fetchTranscriptMetadata(transcriptId);
  if (metadata.downloadUrl === null) {
    // Transcrição ainda processando — a Recall reenvia transcript.done quando estiver pronta de verdade.
    logEvent("recall_webhook_transcript_not_ready", { bot_id: botId, transcript_id: transcriptId });
    return false;
  }

  const blocks = await recallPort.downloadTranscript(metadata.downloadUrl);
  const rawTurns = blocks
    .filter((block) => block.text.trim().length > 0)
    .map((block) => ({
      role: block.participantName === agentName ? ("assistant" as const) : ("user" as const),
      content: block.text.slice(0, MAX_TURN_CHARS),
    }));
  if (rawTurns.length === 0) return false;
  const turns = rawTurns.slice(0, MAX_TURNS);
  if (rawTurns.length > MAX_TURNS) {
    // Parcial é sempre melhor que a rejeição total do validador SQL —
    // telemetrado pra visibilidade, nunca bloqueia o salvamento do que coube.
    logEvent("recall_webhook_transcript_truncated", { bot_id: botId, raw_turns: rawTurns.length, kept_turns: turns.length });
  }

  const { data, error } = await supabase.rpc("portal_append_transcript_turns_service", {
    p_surface: "meeting",
    p_external_ref: botId,
    p_turns: turns,
    p_ended_at: new Date().toISOString(),
  });
  if (error) {
    trackError("recall_webhook_transcript_append_failed", error, { bot_id: botId });
    return false;
  }
  const found = (data as { found?: boolean } | null)?.found === true;
  if (!found) logEvent("recall_webhook_transcript_no_matching_transcript", { bot_id: botId });
  return found;
}

export async function POST(request: NextRequest): Promise<Response> {
  const expectedToken = process.env.RECALL_WEBHOOK_TOKEN ?? "";
  if (expectedToken.trim().length < 16) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  const providedToken = request.nextUrl.searchParams.get("token") ?? "";
  if (!constantTimeEquals(providedToken, expectedToken)) {
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
      // Mesmo corpo do token errado: nenhuma resposta confirma qual camada falhou.
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid_json_body" }, { status: 400 });
  }

  const transcriptDone = parseRecallTranscriptDonePayload(body);
  if (transcriptDone !== null) {
    let persisted = false;
    try {
      persisted = await processMeetingTranscript(transcriptDone.botId, transcriptDone.transcriptId);
    } catch (transcriptError) {
      // Nunca derruba o webhook — o Recall pode reentregar transcript.done em retry.
      trackError("recall_webhook_transcript_processing_failed", transcriptError, { bot_id: transcriptDone.botId });
    }
    // `handled` reflete o resultado real (achado P2 da auto-revisão
    // 2026-08-11): antes sempre respondia true mesmo quando o append falhava
    // internamente — a Recall não usa o corpo pra decidir retry, mas
    // qualquer observabilidade futura (telemetria, tooling) que confie na
    // própria resposta do webhook merece o dado certo, não um falso positivo.
    return NextResponse.json({ ok: true, handled: persisted });
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
    const result = data as { found?: boolean; applied?: boolean } | null;
    const found = result?.found === true;
    const applied = result?.applied === true;

    if (found && IN_CALL_EVENTS.has(parsed.event)) {
      try {
        await attachSentinelCamera(parsed.botId);
      } catch (attachError) {
        // O attach nunca pode derrubar o webhook (o Recall re-tenta e o
        // próximo in_call re-tenta o attach) — mas fica 100% visível.
        trackError("recall_webhook_sentinel_attach_failed", attachError, { bot_id: parsed.botId });
      }
    }

    if (applied && (status === "ended" || status === "failed")) {
      try {
        await notifyMeetingEnded(parsed.botId, status);
      } catch (notifyError) {
        trackError("recall_webhook_notify_failed", notifyError, { bot_id: parsed.botId });
      }
    }

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
