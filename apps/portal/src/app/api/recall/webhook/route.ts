import { NextRequest, NextResponse } from "next/server";

import { createHash } from "node:crypto";
import { createUuidV7 } from "@axtro/domain";
import { createRecallMeetingBotPort, parseRecallTranscriptDownloadHosts, type RecallRegion } from "@axtro/provider-recall";
import { createTavusVideoConversationPort } from "@axtro/provider-tavus";

import { prepareAgentFaceStage } from "@/lib/meetings/stage";
import { isRecallWebhookSecretConfigured, parseRecallTranscriptDonePayload, parseRecallWebhookPayload, statusForRecallEvent, verifyRecallWebhookSignature } from "@/lib/meetings/webhook";
import { readBoundedTextBody } from "@/lib/http/read-bounded-body";
import { createServiceRoleClient, ServiceRoleUnavailableError } from "@/lib/supabase/service";
import { logError as trackError, logEvent } from "@/lib/telemetry";
import { sendMeetingEndedEmail } from "@/lib/email";
import { activateProviderEffectBilling, beginProviderEffect, commitProviderEffect, fenceProviderFailure, markCleanupPending, reconcileProviderEffect, releaseProviderEffect, retryReleasedProviderEffect, stableEffectKey, stableProviderReconciliationReceiptId, voidUnleasedBillingUsage } from "@/lib/paid-effects";
import { assertPortalChannelActive, assertPortalProviderDispatchActive, bindPortalProviderChannel, type PortalChannelGrant } from "@/lib/runtime/portal-channel-runtime-bridge";
import { prepareTavusWebhookCallback, registerTranscriptPlaceholder } from "@/lib/transcripts/register";

/**
 * Recebe eventos de status de bot do Recall.ai. Exige autenticação por
 * assinatura HMAC nos cabeçalhos webhook-* (Standard
 * Webhooks). O antigo token em query string não concede mais autoridade:
 * query strings aparecem com frequência em access logs e não são lugar
 * seguro para um bearer de longa duração.
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
const MAX_RECALL_WEBHOOK_BYTES = 64 * 1024;

interface SentinelAttachContext {
  readonly outcome?: string;
  readonly tenantId?: string;
  readonly agentId?: string;
  readonly state?: string;
  readonly reservationId?: string;
  readonly conversationId?: string;
  readonly conversationUrl?: string;
  readonly customerDeliveryState?: string;
  readonly recallReservationId?: string;
  readonly recallCustomerDeliveryState?: string;
  readonly runtimeGrantId?: string;
  readonly runtimeSessionId?: string;
  readonly runtimePresenterId?: string;
  readonly runtimeGeneration?: number;
  readonly runtimeCommandFingerprint?: string;
  readonly runtimeCapabilities?: readonly string[];
  readonly runtimeChannel?: string;
}

interface MeetingStatusReceipt {
  readonly found?: boolean;
  readonly applied?: boolean;
  readonly terminalRetained?: boolean;
  readonly tavusReservationId?: string | null;
  readonly tavusConversationId?: string | null;
  readonly tavusCleanupRequired?: boolean;
}

/**
 * Bot sentinela entrou na reunião e ainda não tem sala: primeiro reivindica
 * um claim durável e tenant-scoped no banco, que também serializa e revalida
 * o teto diário. Só o vencedor pode tocar a API paga da Tavus.
 */
type SentinelAttachOutcome = "attached" | "noop" | "capped" | "transient_failure";

function runtimeGrantFromSentinelContext(context: SentinelAttachContext): PortalChannelGrant | null {
  if (
    typeof context.tenantId !== "string"
    || typeof context.agentId !== "string"
    || typeof context.runtimeGrantId !== "string"
    || typeof context.runtimeSessionId !== "string"
    || typeof context.runtimePresenterId !== "string"
    || typeof context.runtimeGeneration !== "number"
    || typeof context.runtimeCommandFingerprint !== "string"
    || typeof context.runtimeChannel !== "string"
    || !Array.isArray(context.runtimeCapabilities)
    || context.runtimeCapabilities.some((capability) => typeof capability !== "string")
  ) return null;
  return {
    tenantId: context.tenantId,
    agentId: context.agentId,
    channel: context.runtimeChannel,
    sessionId: context.runtimeSessionId,
    grantId: context.runtimeGrantId,
    presenterId: context.runtimePresenterId,
    generationId: context.runtimeGeneration,
    commandFingerprint: context.runtimeCommandFingerprint,
    capabilitySet: context.runtimeCapabilities,
  };
}

async function compensateSentinelConversation(
  tavusPort: ReturnType<typeof createTavusVideoConversationPort>,
  reservationId: string,
  conversationId: string,
  failureCode: string,
): Promise<boolean> {
  let billingVoided = false;
  try {
    // A committed conversation can already have an overage outbox row.
    await voidUnleasedBillingUsage(reservationId, failureCode);
    billingVoided = true;
  } catch {
    // Still terminate the known provider resource to stop additional spend,
    // but keep cleanup_pending until billing can be reconciled safely.
  }

  let cleanupPersisted = false;
  try {
    await markCleanupPending(reservationId, conversationId, failureCode);
    cleanupPersisted = true;
  } catch {
    // Continue to the provider termination even if persistence is degraded;
    // the HTTP delivery stays retryable and no known paid resource is leaked.
  }

  try {
    await tavusPort.endConversation(conversationId);
  } catch {
    return false;
  }
  if (!cleanupPersisted || !billingVoided) return false;

  try {
    const providerReceiptRef = `tavus:end:${conversationId}`;
    await reconcileProviderEffect(
      stableProviderReconciliationReceiptId(reservationId, "compensation_confirmed", providerReceiptRef),
      reservationId,
      "compensation_confirmed",
      providerReceiptRef,
    );
    return true;
  } catch {
    return false;
  }
}

async function cleanupTerminalTavusConversation(
  reservationId: string,
  conversationId: string,
): Promise<boolean> {
  const tavusApiKey = (process.env.TAVUS_API_KEY ?? "").trim();
  if (tavusApiKey.length === 0) return false;
  try {
    await createTavusVideoConversationPort({ apiKey: tavusApiKey }).endConversation(conversationId);
    const providerReceiptRef = `tavus:end:${conversationId}`;
    await reconcileProviderEffect(
      stableProviderReconciliationReceiptId(reservationId, "compensation_confirmed", providerReceiptRef),
      reservationId,
      "compensation_confirmed",
      providerReceiptRef,
    );
    return true;
  } catch {
    return false;
  }
}

async function attachSentinelCamera(botId: string): Promise<SentinelAttachOutcome> {
  const tavusApiKey = (process.env.TAVUS_API_KEY ?? "").trim();
  const recallApiKey = (process.env.RECALL_API_KEY ?? "").trim();
  const recallRegion = (process.env.RECALL_API_REGION ?? "").trim() as RecallRegion;
  if (tavusApiKey.length === 0 || recallApiKey.length === 0 || recallRegion.length === 0) return "transient_failure";

  const supabase = createServiceRoleClient();
  const { data: contextData, error: contextError } = await supabase.rpc("portal_get_sentinel_attach_service", { p_recall_bot_id: botId });
  if (contextError) throw contextError;
  const context = (contextData ?? {}) as SentinelAttachContext;
  if (context.outcome === "terminal" || context.outcome === "not_found") return "noop";
  if (context.outcome !== "ready" || typeof context.tenantId !== "string" || typeof context.agentId !== "string") return "transient_failure";
  const runtimeGrant = runtimeGrantFromSentinelContext(context);
  if (!runtimeGrant) {
    // Meetings created before ADR-038 have no durable participant/session
    // binding. A signed provider delivery alone must never upgrade them into
    // a new paid Tavus camera resource.
    logEvent("recall_sentinel_runtime_admission_required", { bot_id: botId, agent_id: context.agentId });
    return "transient_failure";
  }
  const runtimeStatus = await assertPortalChannelActive({
    tenantId: context.tenantId,
    agentId: context.agentId,
    channel: runtimeGrant.channel,
    capability: "provider_dispatch",
  });
  if (runtimeStatus.outcome === "rejected") return "transient_failure";

  if (context.state === "camera_started") {
    if (!context.reservationId || !context.recallReservationId) return "transient_failure";
    if (context.recallCustomerDeliveryState !== "activated") {
      try {
        await activateProviderEffectBilling(context.recallReservationId);
      } catch {
        return "transient_failure";
      }
    }
    if (context.customerDeliveryState !== "activated") {
      try {
        await activateProviderEffectBilling(context.reservationId);
      } catch {
        return "transient_failure";
      }
    }
    return "noop";
  }

  const recallPort = createRecallMeetingBotPort({ apiKey: recallApiKey, region: recallRegion, transcriptDownloadHosts: parseRecallTranscriptDownloadHosts(process.env.RECALL_TRANSCRIPT_DOWNLOAD_HOSTS) ?? [] });
  let reservationId = context.reservationId;
  let conversationId = context.conversationId;
  let conversationUrl = context.conversationUrl;
  let transcriptPlaceholderReady = false;
  if (context.state !== "conversation_created") {
    if (context.state === "cleanup_pending") return "transient_failure";
    if (context.state !== "not_requested") return "transient_failure";
    const { data: config, error: configError } = await supabase
      .from("agent_video_config")
      .select("tavus_persona_id, language")
      .eq("tenant_id", context.tenantId)
      .eq("agent_id", context.agentId)
      .maybeSingle();
    if (configError || config === null || typeof config.tavus_persona_id !== "string") {
      trackError("recall_webhook_sentinel_no_persona", configError ?? new Error("persona ausente"), { bot_id: botId });
      return "transient_failure";
    }
    const tavusPort = createTavusVideoConversationPort({ apiKey: tavusApiKey });
    const effectInput = {
      tenantId: context.tenantId,
      agentId: context.agentId,
      provider: "tavus" as const,
      idempotencyKey: stableEffectKey([context.tenantId, botId, "sentinel-camera"]),
      relatedRef: botId,
      maxDurationSeconds: 1800,
    };
    let reservation = await beginProviderEffect(effectInput);
    reservation = await retryReleasedProviderEffect(effectInput, reservation);
    if (reservation.outcome === "capped") return "capped";
    if (reservation.outcome === "blocked_unknown" || reservation.reservationId === null) return "transient_failure";
    reservationId = reservation.reservationId;
    if (reservation.state === "committed") {
      conversationId = reservation.providerRef ?? undefined;
      conversationUrl = reservation.providerUrl ?? undefined;
      if (!conversationId || !conversationUrl) return "transient_failure";
      const dispatch = await assertPortalProviderDispatchActive({ grant: runtimeGrant, consumerKind: "tavus" });
      if (dispatch.outcome === "rejected") return "transient_failure";
      const binding = await bindPortalProviderChannel({
        grant: runtimeGrant,
        reservationId,
        provider: "tavus",
        providerRef: conversationId,
        providerUrl: conversationUrl,
      });
      if (binding.outcome === "rejected") {
        await compensateSentinelConversation(tavusPort, reservationId, conversationId, "runtime_binding_failed");
        return "transient_failure";
      }
    } else {
      const dispatch = await assertPortalProviderDispatchActive({ grant: runtimeGrant, consumerKind: "tavus" });
      if (dispatch.outcome === "rejected") {
        await releaseProviderEffect(reservationId, "not_dispatched").catch(() => undefined);
        return "transient_failure";
      }
      let callbackUrl: string;
      try {
        callbackUrl = (await prepareTavusWebhookCallback(reservationId, supabase)).callbackUrl;
      } catch {
        return "transient_failure";
      }
      let conversation;
      try {
        conversation = await tavusPort.createConversation({
          personaId: config.tavus_persona_id,
          conversationName: `meeting-sentinel-${botId.slice(0, 8)}-${reservationId.slice(-8)}`,
          ...(typeof config.language === "string" ? { language: config.language } : {}),
          maxCallDurationSeconds: 1800,
          callbackUrl,
        });
      } catch (error) {
        await fenceProviderFailure(reservationId, error).catch(() => undefined);
        throw error;
      }
      try {
        await commitProviderEffect(reservationId, conversation.conversationId, conversation.conversationUrl, botId);
      } catch {
        await compensateSentinelConversation(tavusPort, reservationId, conversation.conversationId, "commit_receipt_unknown");
        return "transient_failure";
      }
      const binding = await bindPortalProviderChannel({
        grant: runtimeGrant,
        reservationId,
        provider: "tavus",
        providerRef: conversation.conversationId,
        providerUrl: conversation.conversationUrl,
      });
      if (binding.outcome === "rejected") {
        await compensateSentinelConversation(tavusPort, reservationId, conversation.conversationId, "runtime_binding_failed");
        return "transient_failure";
      }
      conversationId = conversation.conversationId;
      conversationUrl = conversation.conversationUrl;
    }
    if (!conversationId || !conversationUrl) return "transient_failure";
    if (!(await registerTranscriptPlaceholder(context.tenantId, context.agentId, "video", conversationId, supabase))) {
      return await compensateSentinelConversation(
        createTavusVideoConversationPort({ apiKey: tavusApiKey }),
        reservationId,
        conversationId,
        "transcript_persistence_failed",
      )
        ? "noop"
        : "transient_failure";
    }
    transcriptPlaceholderReady = true;
    const { data: persisted, error: persistError } = await supabase.rpc("portal_mark_sentinel_conversation_created_service", { p_recall_bot_id: botId, p_reservation_id: reservationId, p_conversation_id: conversationId });
    if (persistError) return "transient_failure";
    const persistOutcome = (persisted as { outcome?: string } | null)?.outcome;
    if (persistOutcome === "terminal") {
      return await compensateSentinelConversation(tavusPort, reservationId, conversationId, "terminal_before_camera")
        ? "noop"
        : "transient_failure";
    }
    if (persistOutcome !== "persisted" && persistOutcome !== "replayed") return "transient_failure";
  }

  if (!reservationId || !conversationId || !conversationUrl) return "transient_failure";
  if (!transcriptPlaceholderReady && !(await registerTranscriptPlaceholder(context.tenantId, context.agentId, "video", conversationId, supabase))) {
    return "transient_failure";
  }
  try {
    const stage = await prepareAgentFaceStage({
      tenantId: context.tenantId,
      agentId: context.agentId,
      reservationId,
      roomUrl: conversationUrl,
    }, supabase);
    await recallPort.startCameraWebpage(botId, stage.stageUrl);
    const { data: started, error: startedError } = await supabase.rpc("portal_mark_sentinel_camera_started_service", { p_recall_bot_id: botId, p_reservation_id: reservationId });
    if (startedError) throw startedError;
    if (started !== true) {
      const { data: refreshed, error: refreshError } = await supabase.rpc("portal_get_sentinel_attach_service", { p_recall_bot_id: botId });
      if (!refreshError && (refreshed as SentinelAttachContext | null)?.outcome === "terminal") {
        const tavusPort = createTavusVideoConversationPort({ apiKey: tavusApiKey });
        return await compensateSentinelConversation(tavusPort, reservationId, conversationId, "terminal_during_camera_start")
          ? "noop"
          : "transient_failure";
      }
      return "transient_failure";
    }
    try {
      if (!context.recallReservationId) return "transient_failure";
      await activateProviderEffectBilling(context.recallReservationId);
      await activateProviderEffectBilling(reservationId);
    } catch {
      return "transient_failure";
    }
  } catch {
    // conversation_created is intentionally resumable. A delivery retry may
    // repeat the idempotent camera command, but never creates a second Tavus
    // conversation.
    return "transient_failure";
  }

  logEvent("recall_sentinel_camera_attached", { bot_id: botId, agent_id: context.agentId });
  return "attached";
}

/**
 * Notifica os admins do tenant quando a reunião externa termina (achado da
 * auditoria 2026-08-06), best-effort depois de um claim durável. A claim
 * atômica no banco, e não `applied`, impede duplicata e permite que uma
 * reentrega terminal notifique depois que a limpeza pendente for concluída.
 */
async function notifyMeetingEnded(botId: string, status: "ended" | "failed"): Promise<void> {
  const supabase = createServiceRoleClient();
  const { data: session, error: sessionError } = await supabase
    .from("meeting_bot_sessions")
    .select("tenant_id, agent_id")
    .eq("recall_bot_id", botId)
    .maybeSingle();
  if (sessionError || session === null) {
    if (sessionError) trackError("recall_webhook_notify_lookup_failed", sessionError, { bot_id: botId });
    return;
  }
  const row = session as { tenant_id: string; agent_id: string };

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
    meetingUrl: "Link protegido (não armazenado)",
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
type MeetingTranscriptOutcome = "persisted" | "not_found" | "not_ready" | "empty";

async function processMeetingTranscript(botId: string, transcriptId: string): Promise<MeetingTranscriptOutcome> {
  const recallApiKey = (process.env.RECALL_API_KEY ?? "").trim();
  const recallRegion = (process.env.RECALL_API_REGION ?? "").trim() as RecallRegion;
  if (recallApiKey.length === 0 || recallRegion.length === 0) throw new Error("Recall transcript provider is not configured");

  const supabase = createServiceRoleClient();
  const { data: agentContext, error: agentError } = await supabase.rpc("portal_get_meeting_bot_agent_service", {
    p_recall_bot_id: botId,
  });
  if (agentError) {
    trackError("recall_webhook_transcript_agent_lookup_failed", agentError, { bot_id: botId });
    throw agentError;
  }
  if (agentContext === null) {
    logEvent("recall_webhook_transcript_unknown_bot", { bot_id: botId, transcript_id: transcriptId });
    return "not_found";
  }
  const agentName = (agentContext as { agentName?: unknown }).agentName;
  if (typeof agentName !== "string") return "not_found";

  const recallPort = createRecallMeetingBotPort({ apiKey: recallApiKey, region: recallRegion, transcriptDownloadHosts: parseRecallTranscriptDownloadHosts(process.env.RECALL_TRANSCRIPT_DOWNLOAD_HOSTS) ?? [] });
  const metadata = await recallPort.fetchTranscriptMetadata(transcriptId, botId);
  if (metadata.downloadUrl === null) {
    // Transcrição ainda processando — a Recall reenvia transcript.done quando estiver pronta de verdade.
    logEvent("recall_webhook_transcript_not_ready", { bot_id: botId, transcript_id: transcriptId });
    return "not_ready";
  }

  const blocks = await recallPort.downloadTranscript(metadata.downloadUrl);
  const rawTurns = blocks
    .filter((block) => block.text.trim().length > 0)
    .map((block) => ({
      role: block.participantName === agentName ? ("assistant" as const) : ("user" as const),
      content: block.text.slice(0, MAX_TURN_CHARS),
    }));
  if (rawTurns.length === 0) return "empty";
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
    throw error;
  }
  const found = (data as { found?: boolean } | null)?.found === true;
  if (!found) logEvent("recall_webhook_transcript_no_matching_transcript", { bot_id: botId });
  return found ? "persisted" : "not_found";
}

export async function POST(request: NextRequest): Promise<Response> {
  const webhookSecret = process.env.RECALL_WEBHOOK_SECRET ?? "";
  if (!isRecallWebhookSecretConfigured(webhookSecret)) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  const bounded = await readBoundedTextBody(request, MAX_RECALL_WEBHOOK_BYTES);
  if (!bounded.ok) {
    if (bounded.reason === "too_large") return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
    return NextResponse.json({ error: "invalid_request_body" }, { status: 400 });
  }
  const rawBody = bounded.text;
  {
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

  const deliveryId = request.headers.get("webhook-id") ?? "";
  const deliveryDigest = createHash("sha256").update(rawBody).digest("hex");
  const deliveryClaimToken = createUuidV7();
  try {
    const supabase = createServiceRoleClient();
    const { data, error } = await supabase.rpc("portal_claim_recall_webhook_service", { p_delivery_id: deliveryId, p_payload_digest: deliveryDigest, p_claim_token: deliveryClaimToken });
    if (error) return NextResponse.json({ error: "dedupe_unavailable" }, { status: 503 });
    const outcome = (data as { outcome?: string } | null)?.outcome;
    if (outcome === "replayed") return NextResponse.json({ ok: true, handled: true, replayed: true });
    if (outcome === "busy") return NextResponse.json({ error: "delivery_in_progress" }, { status: 503 });
    if (outcome !== "claimed") return NextResponse.json({ error: "delivery_conflict" }, { status: 409 });
  } catch {
    return NextResponse.json({ error: "dedupe_unavailable" }, { status: 503 });
  }
  const completeDelivery = async (): Promise<void> => {
    const { data, error } = await createServiceRoleClient().rpc("portal_complete_recall_webhook_service", { p_delivery_id: deliveryId, p_claim_token: deliveryClaimToken });
    if (error || data !== true) throw error ?? new Error("delivery completion receipt missing");
  };
  const releaseDelivery = async (): Promise<void> => {
    const { data, error } = await createServiceRoleClient().rpc("portal_release_recall_webhook_service", { p_delivery_id: deliveryId, p_payload_digest: deliveryDigest, p_claim_token: deliveryClaimToken });
    if (error || data !== true) throw error ?? new Error("delivery release receipt missing");
  };

  const releaseForRetry = async (error: string): Promise<Response> => {
    try {
      await releaseDelivery();
    } catch (releaseError) {
      trackError("recall_webhook_release_failed", releaseError, { delivery_id: deliveryId });
    }
    return NextResponse.json({ error }, { status: 503 });
  };

  const completeOrRetry = async (body: Record<string, unknown>): Promise<Response> => {
    try {
      await completeDelivery();
      return NextResponse.json(body);
    } catch (completeError) {
      trackError("recall_webhook_complete_failed", completeError, { delivery_id: deliveryId });
      return releaseForRetry("delivery_completion_pending");
    }
  };

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    try {
      await releaseDelivery();
    } catch {
      return NextResponse.json({ error: "dedupe_unavailable" }, { status: 503 });
    }
    return NextResponse.json({ error: "invalid_json_body" }, { status: 400 });
  }

  const transcriptDone = parseRecallTranscriptDonePayload(body);
  if (transcriptDone !== null) {
    try {
      const transcriptOutcome = await processMeetingTranscript(transcriptDone.botId, transcriptDone.transcriptId);
      if (transcriptOutcome === "not_ready" || transcriptOutcome === "not_found") {
        return releaseForRetry("transcript_persistence_pending");
      }
      return completeOrRetry({ ok: true, handled: transcriptOutcome === "persisted" });
    } catch (transcriptError) {
      trackError("recall_webhook_transcript_processing_failed", transcriptError, { bot_id: transcriptDone.botId });
      return releaseForRetry("transcript_persistence_failed");
    }
  }

  const parsed = parseRecallWebhookPayload(body);
  if (parsed === null) {
    // Evento fora do escopo mapeado (ex.: participant_events, breakout room) — não é erro, só nada a fazer aqui.
    return completeOrRetry({ ok: true, handled: false });
  }
  const status = statusForRecallEvent(parsed.event);
  if (status === null) {
    return completeOrRetry({ ok: true, handled: false });
  }

  try {
    const supabase = createServiceRoleClient();
    const { data, error } = await supabase.rpc("portal_update_meeting_bot_session_status_service", {
      p_recall_bot_id: parsed.botId,
      p_status: status,
      // The database accepts claim evidence only for irreversible terminal
      // transitions. Sending it on in_call/created would make every ordinary
      // status webhook fail before the resumable SENTINELA attach.
      ...(status === "ended" || status === "failed"
        ? { p_delivery_id: deliveryId, p_claim_token: deliveryClaimToken }
        : {}),
    });
    if (error) {
      trackError("recall_webhook_update_status_failed", error, { event: parsed.event });
      return releaseForRetry("internal_error");
    }
    const result = data as MeetingStatusReceipt | null;
    const found = result?.found === true;

    if (found && status === "in_call" && IN_CALL_EVENTS.has(parsed.event)) {
      try {
        const attachOutcome = await attachSentinelCamera(parsed.botId);
        if (attachOutcome === "transient_failure") {
          return releaseForRetry("sentinel_attach_pending");
        }
      } catch (attachError) {
        trackError("recall_webhook_sentinel_attach_failed", attachError, { bot_id: parsed.botId });
        return releaseForRetry("sentinel_attach_pending");
      }
    }

    if ((status === "ended" || status === "failed") && result?.tavusCleanupRequired === true
      && typeof result.tavusReservationId === "string" && typeof result.tavusConversationId === "string") {
      if (!(await cleanupTerminalTavusConversation(result.tavusReservationId, result.tavusConversationId))) {
        return releaseForRetry("terminal_cleanup_pending");
      }
    }

    if (status === "ended" || status === "failed") {
      const { data: notificationClaimed, error: notificationClaimError } = await supabase.rpc(
        "portal_claim_meeting_terminal_notification_service",
        { p_recall_bot_id: parsed.botId },
      );
      if (notificationClaimError || typeof notificationClaimed !== "boolean") {
        trackError(
          "recall_webhook_terminal_notification_claim_failed",
          notificationClaimError ?? new Error("terminal notification claim receipt invalid"),
          { bot_id: parsed.botId },
        );
        return releaseForRetry("terminal_notification_claim_pending");
      }
      if (!notificationClaimed && !found) {
        return releaseForRetry("terminal_notification_not_ready");
      }
      if (notificationClaimed) {
        try {
          await notifyMeetingEnded(parsed.botId, status);
        } catch (notifyError) {
          trackError("recall_webhook_notify_failed", notifyError, { bot_id: parsed.botId });
        }
      }
    }

    return completeOrRetry({ ok: true, handled: found });
  } catch (error) {
    if (error instanceof ServiceRoleUnavailableError) {
      trackError("recall_webhook_service_role_unavailable", error, {});
      return releaseForRetry("not_configured");
    }
    trackError("recall_webhook_unexpected_error", error, {});
    return releaseForRetry("internal_error");
  }
}
