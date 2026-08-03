"use server";

import { createUuidV7 } from "@axtro/domain";
import { createRecallMeetingBotPort, MeetingBotError } from "@axtro/provider-recall";
import { createTavusVideoConversationPort, VideoProviderError } from "@axtro/provider-tavus";

import { floridaWallClockToUtcIso, FloridaTimeError } from "@/lib/time/florida";
import { agentFaceStageUrl } from "@/lib/meetings/stage";
import { handleJoinMeeting, JoinMeetingError, type AgentPersonaForMeeting } from "@/lib/meetings/join-meeting";
import { fetchAgents } from "@/lib/portal-data";
import { createClient } from "@/lib/supabase/server";
import { logError as trackError } from "@/lib/telemetry";
import { checkVideoCap, reportConversationOverageIfNeeded, VIDEO_CAP_CHECK_FAILED_MESSAGE, VIDEO_CAP_MESSAGE } from "@/lib/video-cap";

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

interface AgentVideoConfigRow {
  readonly configured: boolean;
  readonly persona_id?: string | null;
}

function requiredEnv(name: string): string {
  return (process.env[name] ?? "").trim();
}

export async function joinExternalMeeting(
  agentId: string,
  meetingUrl: string,
  /** Horário local da Flórida ("YYYY-MM-DDTHH:mm"), ausente = agora. */
  floridaJoinAt?: string | null,
): Promise<JoinExternalMeetingResult> {
  const tavusApiKey = requiredEnv("TAVUS_API_KEY");
  const recallApiKey = requiredEnv("RECALL_API_KEY");
  const recallRegion = requiredEnv("RECALL_API_REGION");
  if (tavusApiKey.length === 0 || recallApiKey.length === 0) {
    return { conversationUrl: null, scheduled: false, error: "O provider de vídeo ou de reuniões externas ainda não está configurado neste ambiente." };
  }
  if (recallRegion !== "us-east-1" && recallRegion !== "us-west-2" && recallRegion !== "eu-central-1" && recallRegion !== "ap-northeast-1") {
    trackError("meeting_bot_invalid_region", new Error(`RECALL_API_REGION inválida: ${recallRegion || "(vazia)"}`), { agent_id: agentId });
    return { conversationUrl: null, scheduled: false, error: "A região do provider de reuniões externas não está configurada corretamente." };
  }

  let joinAtIso: string | undefined;
  if (typeof floridaJoinAt === "string" && floridaJoinAt.trim().length > 0) {
    try {
      joinAtIso = floridaWallClockToUtcIso(floridaJoinAt.trim());
    } catch (error) {
      if (error instanceof FloridaTimeError) {
        return { conversationUrl: null, scheduled: false, error: "Horário inválido — use o formato AAAA-MM-DDTHH:mm no horário da Flórida." };
      }
      throw error;
    }
    if (new Date(joinAtIso).getTime() <= Date.now()) {
      return { conversationUrl: null, scheduled: false, error: "O horário agendado já passou — escolha um horário futuro (horário da Flórida)." };
    }
  }

  const agents = await fetchAgents();
  const agent = agents.find((candidate) => candidate.id === agentId);
  if (!agent) {
    return { conversationUrl: null, scheduled: false, error: "Agente não encontrado nesta conta." };
  }

  const supabase = await createClient();

  // Teto diário de segurança (sempre) — reunião externa também cria conversa
  // Tavus (e ainda soma a hora do bot), então conta no mesmo teto. Passar do
  // incluído mensal do plano não bloqueia (overage cobrado depois do sucesso).
  const capVerdict = await checkVideoCap(supabase);
  if (capVerdict === "capped" || capVerdict === "check_failed") {
    return {
      conversationUrl: null,
      scheduled: false,
      error: capVerdict === "capped" ? VIDEO_CAP_MESSAGE : VIDEO_CAP_CHECK_FAILED_MESSAGE,
    };
  }

  const { data: configData } = await supabase.rpc("portal_agent_video_config", { p_agent_id: agentId });
  const config = (configData ?? { configured: false }) as AgentVideoConfigRow;

  const tavusPort = createTavusVideoConversationPort({ apiKey: tavusApiKey });
  const recallPort = createRecallMeetingBotPort({ apiKey: recallApiKey, region: recallRegion });

  try {
    const result = await handleJoinMeeting(
      { agentId, meetingUrl, ...(joinAtIso ? { joinAtIso } : {}) },
      {
        resolveAgentPersona: async (): Promise<AgentPersonaForMeeting | null> => {
          if (!config.configured || !config.persona_id) return null;
          return { personaId: config.persona_id, agentName: agent.name };
        },
        createVideoConversation: async (persona) => {
          const conversation = await tavusPort.createConversation({
            personaId: persona.personaId,
            conversationName: `meeting-${agent.id.slice(0, 8)}`,
            maxCallDurationSeconds: 1800,
          });
          return {
            // O bot do Recall.ai renderiza a página que passamos como câmera
            // dele. A URL CRUA do Tavus abre uma tela de "digite seu nome" —
            // o bot transmitiria o formulário, não a agente. Por isso o bot
            // recebe /rosto-agente, que entra na sala sozinha e mostra só o
            // rosto dela sangrando na tela.
            url: agentFaceStageUrl(conversation.conversationUrl),
            conversationId: conversation.conversationId,
            // O humano que quiser acompanhar entra pela sala de verdade.
            humanUrl: conversation.conversationUrl,
          };
        },
        createMeetingBot: (params) => recallPort.createBot({
          meetingUrl: params.meetingUrl,
          botName: params.botName,
          ...(params.joinAtIso ? { joinAtIso: params.joinAtIso } : {}),
          ...(params.outputMediaWebpageUrl ? { outputMediaWebpageUrl: params.outputMediaWebpageUrl } : {}),
          ...(params.variant ? { variant: params.variant } : {}),
        }),
        recordSession: async (params) => {
          const { error } = await supabase.rpc("portal_record_meeting_bot_session", {
            p_id: createUuidV7(),
            p_agent_id: params.agentId,
            p_recall_bot_id: params.botId,
            p_meeting_url: params.meetingUrl,
            p_tavus_conversation_id: params.conversationId,
          });
          if (error) trackError("meeting_bot_record_session_failed", error, { agent_id: agentId });
          // A reunião externa criou uma conversa Tavus real — ela PRECISA
          // contar no mesmo teto/ledger de vídeo (auditoria 2026-08-02: o
          // comentário do cap prometia isso e o código não fazia; o teto
          // nunca incrementava e o gasto ficava invisível no painel).
          if (params.conversationId !== null) {
            const meetingUsageEventId = createUuidV7();
            const { error: usageError } = await supabase.rpc("portal_log_video_usage", { p_id: meetingUsageEventId });
            if (usageError) {
              trackError("meeting_bot_log_video_usage_failed", usageError, { agent_id: agentId });
            } else {
              await reportConversationOverageIfNeeded(supabase, capVerdict, meetingUsageEventId);
            }
          }
        },
        endVideoConversation: (conversationId) => tavusPort.endConversation(conversationId),
      },
    );
    return { conversationUrl: result.conversationUrl, scheduled: result.scheduled, error: null };
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
