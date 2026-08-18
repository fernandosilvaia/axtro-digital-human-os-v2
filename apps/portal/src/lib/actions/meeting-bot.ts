"use server";

import { createHash } from "node:crypto";

import { createRecallMeetingBotPort, MeetingBotError } from "@axtro/provider-recall";
import { createTavusVideoConversationPort, VideoProviderError } from "@axtro/provider-tavus";

import { FloridaTimeError, wallClockToUtcIso } from "@/lib/time/florida";
import { fakeProvidersEnabled } from "@/lib/knowledge";
import { parseMeetingSessionReceipt, type MeetingSessionReceipt } from "@/lib/meetings/session-receipt";
import { deriveMeetingSessionId } from "@/lib/meetings/identity";
import { prepareAgentFaceStage } from "@/lib/meetings/stage";
import { handleJoinMeeting, JoinMeetingError, type AgentPersonaForMeeting } from "@/lib/meetings/join-meeting";
import { fetchAgents, fetchTenantOverview } from "@/lib/portal-data";
import { isRateLimited } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { logError as trackError } from "@/lib/telemetry";
import { prepareTavusWebhookCallback, registerTranscriptPlaceholder } from "@/lib/transcripts/register";
import { VIDEO_CAP_MESSAGE } from "@/lib/video-cap";
import { resolveAgentVideoConfig } from "@/lib/video-config";
import { acquireProviderDispatch, beginProviderEffect, commitProviderEffectOrCompensate, compensateCommittedProviderEffect, fenceProviderFailure, isPaidEffectCommandId, paidEffectIntentKey, providerCorrelationLabel, releaseProviderEffect, retryReleasedProviderEffect } from "@/lib/paid-effects";
import { createServiceRoleClient } from "@/lib/supabase/service";

/**
 * Coloca um agente numa reunião externa de verdade (Zoom/Meet/Teams) —
 * capacidade central do produto (D-V2-089), disponível pra qualquer cliente
 * com um agente configurado, não só pro fluxo interno da Axtro.
 */

export interface JoinExternalMeetingResult {
  readonly conversationUrl: string | null;
  readonly scheduled: boolean;
  readonly error: string | null;
}

export async function enforceMeetingSessionReceipt(
  value: unknown,
  tavusPort: Pick<ReturnType<typeof createTavusVideoConversationPort>, "endConversation">,
): Promise<MeetingSessionReceipt> {
  const receipt = parseMeetingSessionReceipt(value);
  if (receipt.terminal && receipt.tavusCleanupRequired) {
    if (receipt.tavusConversationId === null || receipt.tavusReservationId === null) {
      throw new Error("terminal meeting cleanup receipt is incomplete");
    }
    await compensateCommittedProviderEffect({
      reservationId: receipt.tavusReservationId,
      provider: "tavus",
      providerRef: receipt.tavusConversationId,
      failureCode: "meeting_terminal_before_persistence",
      terminate: () => tavusPort.endConversation(receipt.tavusConversationId!),
    });
  }
  return receipt;
}

function requiredEnv(name: string): string {
  return (process.env[name] ?? "").trim();
}

/**
 * Defesa em profundidade local contra execução simultânea do MESMO commandId.
 * A reserva durável é a autoridade entre réplicas e não expira; este guard só
 * reduz trabalho repetido dentro do processo enquanto o primeiro request roda.
 *
 * Checado logo ANTES da chamada aos providers pagos (não no topo da função —
 * achado da auto-revisão): checagens gratuitas que falham por razão
 * não-relacionada (config ausente, teto excedido, horário inválido, agente
 * não encontrado) não devem consumir o slot de dedup, senão uma retentativa
 * legítima segundos depois de um erro genuíno recebia a mensagem enganosa
 * de "tentativa já em andamento". A chave inclui tenant e commandId; uma nova
 * submissão humana do mesmo link recebe outro ID e não é confundida com retry.
 */
const MEETING_JOIN_DEDUP_WINDOW_MS = 30_000;

function meetingJoinDedupKey(tenantId: string, commandId: string): string {
  return `meeting-join:${tenantId}:${commandId}`;
}

function opaqueMeetingReference(commandId: string): string {
  return `meeting:${createHash("sha256").update(`${commandId.toLowerCase()}\u001fmeeting:correlation`).digest("hex")}`;
}

/**
 * ADR-038 intentionally keeps this false until the portal has a participant
 * admission flow: an authenticated tenant operator cannot consent on behalf
 * of every person in a Zoom/Meet/Teams call. Keeping the legacy provider
 * branch below unreachable is safer than treating an operator click as
 * recording/transcription consent for unknown attendees.
 */
function participantScopedMeetingAdmissionReady(): boolean {
  return false;
}

export async function joinExternalMeeting(
  agentId: string,
  meetingUrl: string,
  /** Horário local no fuso da conta ("YYYY-MM-DDTHH:mm"), ausente = agora. */
  joinAtWallClock: string | null,
  /** Fuso IANA do wall-clock (default_timezone do tenant). Default: Flórida (compat). */
  joinTimeZone: string | null,
  /** UUID gerado uma vez pelo gesto humano e preservado em retries automáticos. */
  commandId: string,
): Promise<JoinExternalMeetingResult> {
  if (!isPaidEffectCommandId(commandId)) return { conversationUrl: null, scheduled: false, error: "A intenção da reunião é inválida. Tente novamente." };
  if (!participantScopedMeetingAdmissionReady()) {
    return {
      conversationUrl: null,
      scheduled: false,
      error: "Reuniões externas estão temporariamente indisponíveis enquanto concluímos o fluxo de disclosure e consentimento individual dos participantes.",
    };
  }
  const tavusApiKey = requiredEnv("TAVUS_API_KEY");
  const recallApiKey = requiredEnv("RECALL_API_KEY");
  const recallRegion = requiredEnv("RECALL_API_REGION");
  if (tavusApiKey.length === 0 || recallApiKey.length === 0) {
    // Achado onda 8 (D-V2-117): a checagem de região logo abaixo já chama
    // trackError — chave ausente aqui não chamava, mesma função com
    // comportamento inconsistente pra duas configs igualmente quebradas.
    // Guard de fake mode (achado da própria auto-revisão): mesmo esta
    // função não tendo um caminho simulado de verdade pra reunião externa,
    // um tenant demo (PORTAL_FAKE_PROVIDERS=1) não deveria gerar um alerta
    // de config quebrada só por não ter chaves reais de propósito.
    if (!fakeProvidersEnabled()) {
      trackError("meeting_bot_provider_key_missing", new Error("TAVUS_API_KEY or RECALL_API_KEY not configured"), { agent_id: agentId });
    }
    return { conversationUrl: null, scheduled: false, error: "O provider de vídeo ou de reuniões externas ainda não está configurado neste ambiente." };
  }
  if (recallRegion !== "us-east-1" && recallRegion !== "us-west-2" && recallRegion !== "eu-central-1" && recallRegion !== "ap-northeast-1") {
    trackError("meeting_bot_invalid_region", new Error(`RECALL_API_REGION inválida: ${recallRegion || "(vazia)"}`), { agent_id: agentId });
    return { conversationUrl: null, scheduled: false, error: "A região do provider de reuniões externas não está configurada corretamente." };
  }

  // Fuso do agendamento: o default_timezone do tenant (multi-tenant de
  // verdade — "15:00" tem que ser 15:00 no relógio do DONO da conta, não da
  // Flórida; auditoria 2026-08-02). Flórida segue como default por compat.
  const timeZone = typeof joinTimeZone === "string" && joinTimeZone.trim().length > 0 ? joinTimeZone.trim() : "America/New_York";
  let joinAtIso: string | undefined;
  if (typeof joinAtWallClock === "string" && joinAtWallClock.trim().length > 0) {
    try {
      joinAtIso = wallClockToUtcIso(joinAtWallClock.trim(), timeZone);
    } catch (error) {
      if (error instanceof FloridaTimeError) {
        return { conversationUrl: null, scheduled: false, error: `Horário inválido — use o formato AAAA-MM-DDTHH:mm no fuso ${timeZone}.` };
      }
      throw error;
    }
    if (new Date(joinAtIso).getTime() <= Date.now()) {
      // Achado ao vivo W7 (2026-08-14, auto-revisão de D-V2-121): uma folga
      // aqui já foi tentada e removida — ela convertia silenciosamente um
      // agendamento deliberado (câmera desligada até confirmação) em entrada
      // imediata (câmera ligada na hora), quebrando a promessa explícita da
      // UI pra quem chegou até aqui de propósito marcando "agendar para mais
      // tarde". O caminho de entrada IMEDIATA (external-meeting.tsx, D-V2-121)
      // já nunca passa por aqui — ele não envia scheduleAt — então este erro
      // só alcança quem escolheu agendar e digitou um horário que já passou.
      return { conversationUrl: null, scheduled: false, error: `O horário agendado já passou — escolha um horário futuro (fuso ${timeZone}).` };
    }
  }

  const [overview, agents] = await Promise.all([fetchTenantOverview(), fetchAgents()]);
  if (!overview.provisioned || !overview.tenant) {
    return { conversationUrl: null, scheduled: false, error: "Conta ainda não provisionada." };
  }
  const tenantId = overview.tenant.id;
  const agent = agents.find((candidate) => candidate.id === agentId);
  if (!agent) {
    return { conversationUrl: null, scheduled: false, error: "Agente não encontrado nesta conta." };
  }

  const supabase = await createClient();

  const configResult = await resolveAgentVideoConfig(supabase, agentId, "meeting");
  if (!configResult.ok) {
    return { conversationUrl: null, scheduled: false, error: configResult.error };
  }
  const config = configResult.config;
  if (!config.configured || !config.persona_id) return { conversationUrl: null, scheduled: false, error: "Este agente ainda não tem uma persona de vídeo configurada." };

  const tavusPort = createTavusVideoConversationPort({ apiKey: tavusApiKey });
  const recallPort = createRecallMeetingBotPort({ apiKey: recallApiKey, region: recallRegion });

  // Provider-effect rows are long-lived operational/audit data. Never copy a
  // Zoom/Meet/Teams join URL into them: those URLs can carry bearer-like join
  // credentials. The tenant-scoped meeting session stores only the same
  // opaque digest; neither table persists the join URL or its passcode.
  const meetingRelatedRef = opaqueMeetingReference(commandId);
  const meetingSessionId = deriveMeetingSessionId(tenantId, agentId, commandId);
  const recallInput = { tenantId, agentId, provider: "recall" as const, idempotencyKey: paidEffectIntentKey(commandId, "recall:meeting"), relatedRef: meetingRelatedRef, maxDurationSeconds: null };
  const recallReservation = await retryReleasedProviderEffect(recallInput, await beginProviderEffect(recallInput));
  if (recallReservation.outcome === "capped") return { conversationUrl: null, scheduled: Boolean(joinAtIso), error: "A conta atingiu o limite de reuniões externas ativas." };
  if (recallReservation.outcome === "blocked_unknown" || recallReservation.reservationId === null) return { conversationUrl: null, scheduled: Boolean(joinAtIso), error: "Uma tentativa anterior ainda está em reconciliação." };
  const tavusInput = { tenantId, agentId, provider: "tavus" as const, idempotencyKey: paidEffectIntentKey(commandId, "tavus:meeting"), relatedRef: meetingRelatedRef, maxDurationSeconds: 1800 };
  const tavusReservation = joinAtIso ? null : await retryReleasedProviderEffect(tavusInput, await beginProviderEffect(tavusInput));
  if (tavusReservation?.outcome === "capped") {
    if (recallReservation.state === "reserved" && recallReservation.reservationId) await releaseProviderEffect(recallReservation.reservationId, "not_dispatched");
    return { conversationUrl: null, scheduled: false, error: VIDEO_CAP_MESSAGE };
  }
  if (tavusReservation && (tavusReservation.outcome === "blocked_unknown" || tavusReservation.reservationId === null)) {
    if (recallReservation.state === "reserved" && recallReservation.reservationId) await releaseProviderEffect(recallReservation.reservationId, "not_dispatched");
    return { conversationUrl: null, scheduled: false, error: "Uma tentativa anterior ainda está em reconciliação." };
  }
  const recallFinished = recallReservation.state === "committed" || recallReservation.state === "completed";
  const tavusFinished = tavusReservation === null || tavusReservation.state === "committed" || tavusReservation.state === "completed";
  const serviceClient = createServiceRoleClient();
  if (recallFinished && tavusFinished) {
    if (recallReservation.state === "completed" || tavusReservation?.state === "completed") {
      return { conversationUrl: null, scheduled: Boolean(joinAtIso), error: "Esta reunião já foi encerrada." };
    }
    if (!recallReservation.providerRef) return { conversationUrl: null, scheduled: Boolean(joinAtIso), error: "A reunião ainda está em reconciliação." };
    const recallReservationId = recallReservation.reservationId;
    const recallProviderRef = recallReservation.providerRef;
    const alreadyActivated = recallReservation.customerDeliveryState === "activated"
      && (tavusReservation === null || tavusReservation.customerDeliveryState === "activated");
    if (alreadyActivated) return { conversationUrl: tavusReservation?.providerUrl ?? null, scheduled: Boolean(joinAtIso), error: null };
    try {
      const { data, error } = await serviceClient.rpc("portal_record_meeting_bot_session_service", {
        p_id: meetingSessionId, p_tenant_id: tenantId, p_agent_id: agentId,
        p_recall_bot_id: recallProviderRef, p_meeting_ref: meetingRelatedRef,
        p_tavus_conversation_id: tavusReservation?.providerRef ?? null,
        p_recall_reservation_id: recallReservation.reservationId,
        p_tavus_reservation_id: tavusReservation?.reservationId ?? null,
      });
      if (error) throw error;
      const receipt = await enforceMeetingSessionReceipt(data, tavusPort);
      if (receipt.terminal) {
        return {
          conversationUrl: null,
          scheduled: Boolean(joinAtIso),
          error: "A reunião foi encerrada antes de o agente conseguir entrar e ligar a câmera.",
        };
      }
      if (!(await registerTranscriptPlaceholder(tenantId, agentId, "meeting", recallProviderRef))) {
        throw new Error("meeting transcript persistence failed");
      }
      // Billing stays held. Only a signed Recall in_call delivery may prove
      // that the external meeting was reached and the camera was started.
      // A sala existe no provider, mas ainda não é uma entrega confirmada.
      // Ela só pode ser exposta em replay depois do webhook Recall assinado
      // persistir in_call + camera_started e ativar as duas reservas.
      return { conversationUrl: null, scheduled: Boolean(joinAtIso), error: null };
    } catch (replayError) {
      await Promise.allSettled([
        compensateCommittedProviderEffect({
          reservationId: recallReservationId,
          provider: "recall",
          providerRef: recallProviderRef,
          failureCode: "replay_persistence_failed",
          terminate: () => recallPort.leaveCall(recallProviderRef),
        }),
        tavusReservation?.reservationId && tavusReservation.providerRef
          ? compensateCommittedProviderEffect({
              reservationId: tavusReservation.reservationId,
              provider: "tavus",
              providerRef: tavusReservation.providerRef,
              failureCode: "replay_persistence_failed",
              terminate: () => tavusPort.endConversation(tavusReservation.providerRef!),
            })
          : Promise.resolve(),
      ]);
      trackError("meeting_replay_persistence_failed", replayError, { agent_id: agentId });
      return { conversationUrl: null, scheduled: Boolean(joinAtIso), error: "A reunião não pôde ser registrada com segurança." };
    }
  }

  if (isRateLimited(meetingJoinDedupKey(tenantId, commandId), MEETING_JOIN_DEDUP_WINDOW_MS, 1)) {
    return {
      conversationUrl: null,
      scheduled: Boolean(joinAtIso),
      error: "Uma tentativa de entrar nesta reunião já está em andamento — aguarde alguns segundos antes de tentar de novo.",
    };
  }

  let tavusCompensationConfirmed = false;
  let recallCompensationConfirmed = false;
  let terminalBeforeDelivery = false;

  try {
    const result = await handleJoinMeeting(
      { agentId, meetingUrl, ...(joinAtIso ? { joinAtIso } : {}) },
      {
        resolveAgentPersona: async (): Promise<AgentPersonaForMeeting | null> => {
          if (!config.configured || !config.persona_id) return null;
          return {
            personaId: config.persona_id,
            agentName: providerCorrelationLabel(`${agent.name} — assistente de IA`, recallReservation.reservationId!, 100),
          };
        },
        createVideoConversation: async (persona) => {
          if (!tavusReservation?.reservationId) throw new JoinMeetingError("provider_unavailable", "Tavus reservation missing");
          const callbackUrl = (await prepareTavusWebhookCallback(tavusReservation.reservationId, serviceClient)).callbackUrl;
          let conversation: Awaited<ReturnType<typeof tavusPort.createConversation>>;
          try {
            conversation = await tavusPort.createConversation({
              personaId: persona.personaId,
              conversationName: providerCorrelationLabel(`meeting-${agent.id.slice(0, 8)}`, tavusReservation.reservationId, 120),
              maxCallDurationSeconds: 1800,
              callbackUrl,
            });
            await commitProviderEffectOrCompensate(
              tavusReservation.reservationId, "tavus", conversation.conversationId,
              () => tavusPort.endConversation(conversation.conversationId), conversation.conversationUrl, meetingRelatedRef,
            );
          } catch (error) {
            await fenceProviderFailure(tavusReservation.reservationId, error).catch(() => undefined);
            throw error;
          }
          const stage = await prepareAgentFaceStage({
            tenantId,
            agentId,
            reservationId: tavusReservation.reservationId,
            roomUrl: conversation.conversationUrl,
          }, serviceClient);
          return {
            // O bot do Recall.ai renderiza a página que passamos como câmera
            // dele. A URL CRUA do Tavus abre uma tela de "digite seu nome" —
            // o bot transmitiria o formulário, não a agente. Por isso o bot
            // recebe /rosto-agente, que entra na sala sozinha e mostra só o
            // rosto dela sangrando na tela.
            url: stage.stageUrl,
            conversationId: conversation.conversationId,
            // O humano que quiser acompanhar entra pela sala de verdade.
            humanUrl: conversation.conversationUrl,
          };
        },
        createMeetingBot: async (params) => {
          if (!recallReservation.reservationId || !(await acquireProviderDispatch(recallReservation.reservationId))) throw new JoinMeetingError("provider_unavailable", "Recall dispatch already fenced");
          try {
            const bot = await recallPort.createBot({ meetingUrl: params.meetingUrl, botName: params.botName, ...(params.joinAtIso ? { joinAtIso: params.joinAtIso } : {}), ...(params.outputMediaWebpageUrl ? { outputMediaWebpageUrl: params.outputMediaWebpageUrl } : {}), ...(params.variant ? { variant: params.variant } : {}), enableTranscription: true });
            await commitProviderEffectOrCompensate(
              recallReservation.reservationId, "recall", bot.botId,
              () => recallPort.leaveCall(bot.botId), null, meetingRelatedRef,
            );
            return bot;
          } catch (error) {
            await fenceProviderFailure(recallReservation.reservationId, error).catch(() => undefined);
            throw error;
          }
        },
        recordSession: async (params) => {
          const { data, error } = await serviceClient.rpc("portal_record_meeting_bot_session_service", {
            p_id: meetingSessionId,
            p_tenant_id: tenantId,
            p_agent_id: params.agentId,
            p_recall_bot_id: params.botId,
            p_meeting_ref: meetingRelatedRef,
            p_tavus_conversation_id: params.conversationId,
            p_recall_reservation_id: recallReservation.reservationId,
            p_tavus_reservation_id: tavusReservation?.reservationId ?? null,
          });
          if (error) throw new Error(`meeting bot session persistence failed: ${error.message}`);
          const receipt = await enforceMeetingSessionReceipt(data, tavusPort);
          if (receipt.terminal) {
            if (receipt.tavusCleanupRequired) tavusCompensationConfirmed = true;
            terminalBeforeDelivery = true;
            return;
          }
          // Placeholder do histórico (D-V2-106) — o webhook do Recall
          // (transcript.done) preenche `turns` quando a reunião termina.
          if (!(await registerTranscriptPlaceholder(tenantId, agentId, "meeting", params.botId))) {
            throw new Error("meeting transcript placeholder persistence failed");
          }
        },
        endVideoConversation: async (conversationId) => {
          if (!tavusReservation?.reservationId) return;
          if (tavusCompensationConfirmed) return;
          await compensateCommittedProviderEffect({
            reservationId: tavusReservation.reservationId,
            provider: "tavus",
            providerRef: conversationId,
            failureCode: "meeting_session_persistence_failed",
            terminate: () => tavusPort.endConversation(conversationId),
          });
          tavusCompensationConfirmed = true;
        },
        leaveMeetingBot: async (botId) => {
          if (!recallReservation.reservationId || recallCompensationConfirmed) return;
          await compensateCommittedProviderEffect({
            reservationId: recallReservation.reservationId,
            provider: "recall",
            providerRef: botId,
            failureCode: "meeting_session_persistence_failed",
            terminate: () => recallPort.leaveCall(botId),
          });
          recallCompensationConfirmed = true;
        },
      },
    );
    if (terminalBeforeDelivery) {
      return {
        conversationUrl: null,
        scheduled: result.scheduled,
        error: "A reunião foi encerrada antes de o agente conseguir entrar e ligar a câmera.",
      };
    }
    // Do not convert a locally persisted Tavus ID into a delivery receipt.
    // Billing remains held until the signed Recall webhook observes in_call
    // and persists camera-start evidence.
    return { conversationUrl: null, scheduled: result.scheduled, error: null };
  } catch (error) {
    if (error instanceof JoinMeetingError) {
      if (error.code === "agent_not_configured") {
        return { conversationUrl: null, scheduled: false, error: "Este agente ainda não tem uma persona de vídeo configurada." };
      }
      if (error.code === "invalid_request") {
        return { conversationUrl: null, scheduled: false, error: "URL da reunião inválida — use um link https de Zoom, Meet ou Teams." };
      }
      trackError("meeting_bot_join_failed", error, { agent_id: agentId });
      return { conversationUrl: null, scheduled: false, error: "Não foi possível colocar o agente na reunião agora. Tente de novo." };
    }
    if (error instanceof VideoProviderError || error instanceof MeetingBotError) {
      trackError("meeting_bot_provider_error", error, { agent_id: agentId });
      return { conversationUrl: null, scheduled: false, error: "Não foi possível colocar o agente na reunião agora. Tente de novo." };
    }
    trackError("meeting_bot_unexpected_error", error, { agent_id: agentId });
    return { conversationUrl: null, scheduled: false, error: "Erro inesperado ao tentar entrar na reunião." };
  }
}
