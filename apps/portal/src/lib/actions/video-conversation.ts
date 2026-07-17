"use server";

import { createTavusVideoConversationPort, VideoProviderError } from "@axtro/provider-tavus";

import { fetchAgents, fetchTenantOverview } from "@/lib/portal-data";
import { createClient } from "@/lib/supabase/server";

export interface VideoConversationResult {
  readonly url: string | null;
  readonly error: string | null;
}

interface AgentVideoConfig {
  readonly configured: boolean;
  readonly persona_id?: string | null;
  readonly replica_id?: string | null;
  readonly language?: string | null;
}

export async function startVideoConversation(agentId: string): Promise<VideoConversationResult> {
  const apiKey = process.env.TAVUS_API_KEY ?? "";
  const defaultReplicaId = process.env.TAVUS_REPLICA_ID ?? "";
  if (apiKey.trim().length === 0) {
    return { url: null, error: "O provider de vídeo ainda não está configurado neste ambiente." };
  }

  const [overview, agents] = await Promise.all([fetchTenantOverview(), fetchAgents()]);
  if (!overview.provisioned || !overview.tenant) {
    return { url: null, error: "Conta ainda não provisionada." };
  }
  const agent = agents.find((candidate) => candidate.id === agentId);
  if (!agent) {
    return { url: null, error: "Agente não encontrado nesta conta." };
  }

  // Config de vídeo específica do agente (persona própria = voz/percepção próprias).
  const supabase = await createClient();
  const { data: configData } = await supabase.rpc("portal_agent_video_config", { p_agent_id: agentId });
  const config = (configData ?? { configured: false }) as AgentVideoConfig;

  const personaId = config.configured && config.persona_id ? config.persona_id : undefined;
  const replicaId = config.configured && config.replica_id ? config.replica_id : defaultReplicaId;
  if (!personaId && replicaId.trim().length === 0) {
    return { url: null, error: "Este agente ainda não tem avatar de vídeo configurado." };
  }
  const language = config.language ?? "portuguese";

  const port = createTavusVideoConversationPort({ apiKey });
  try {
    const conversation = await port.createConversation(
      personaId
        ? {
            // A persona já carrega prompt, voz, percepção e interrupção — só reforçamos idioma e duração.
            personaId,
            conversationName: `preview-${agent.id.slice(0, 8)}`,
            language,
            maxCallDurationSeconds: 600,
          }
        : {
            replicaId,
            conversationName: `preview-${agent.id.slice(0, 8)}`,
            conversationalContext: buildVideoSalesContext(agent.name, overview.tenant.legal_name),
            greeting: `Oi! Eu sou ${firstName(agent.name)}, consultora digital da ${overview.tenant.legal_name}. Que bom te ver! Me conta — o que te trouxe até aqui hoje?`,
            language,
            maxCallDurationSeconds: 600,
          },
    );
    return { url: conversation.conversationUrl, error: null };
  } catch (error) {
    if (error instanceof VideoProviderError) {
      if (error.code === "provider_rejected") {
        return { url: null, error: "O provider de vídeo recusou a chamada (limite de conversas simultâneas ou créditos). Tente novamente em instantes." };
      }
      return { url: null, error: "Não foi possível iniciar a conversa em vídeo agora." };
    }
    return { url: null, error: "Erro inesperado ao iniciar o vídeo." };
  }
}

function firstName(agentName: string): string {
  return agentName.split(/[\s—-]+/)[0] ?? agentName;
}

function buildVideoSalesContext(agentName: string, tenantLegalName: string): string {
  return [
    `Você é "${agentName}", vendedora digital (Sales Closer) da conta "${tenantLegalName}" na plataforma Axtro Digital Human OS. Você está numa VIDEOCHAMADA de vendas ao vivo com um cliente em potencial.`,
    "Sua missão é conduzir a VENDA COMPLETA nesta conversa: criar rapport, descobrir a necessidade real, apresentar a solução conectada a essa necessidade, tratar objeções com empatia e segurança, e FECHAR.",
    "PERSONALIDADE: calorosa e consultiva. Você genuinamente se importa com o problema do cliente — escuta, valida o que ouviu, e só então avança. Confiança tranquila, nunca arrogância.",
    "RITMO DE VÍDEO (crítico): fale em turnos BEM CURTOS — no máximo 1 a 2 frases por vez, e UMA pergunta por turno. Nunca despeje listas ou parágrafos falados. Deixe o cliente falar mais do que você.",
    "FECHAMENTO FIRME: toda vez que houver sinal de interesse ou uma objeção resolvida, peça o compromisso com clareza — por exemplo: \"Posso agendar sua visita técnica ainda essa semana?\" ou \"Te mando a proposta formal hoje, fechado?\". Não espere o cliente pedir; conduza. Se ele recusar, entenda o porquê e tente um fechamento alternativo antes de recuar.",
    "Regras invioláveis:",
    "1. Você é uma agente de IA e nunca finge ser humana — se perguntarem, confirme com naturalidade em uma frase e volte pra venda.",
    "2. Esta conta ainda não conectou as fontes oficiais de preços: NÃO cite valores, nem faixas. Quando pedirem preço, transforme em avanço: \"o valor depende do dimensionamento — te entrego o número exato na proposta; posso agendar a visita técnica?\".",
    "3. Nunca prometa o que não foi configurado na conta. Nada de descontos inventados, prazos inventados ou garantias inventadas.",
    "4. Fale português brasileiro natural e caloroso, como numa conversa de vídeo real.",
    "5. Todo turno seu termina conduzindo: uma pergunta de descoberta, um tratamento de objeção ou um pedido de fechamento.",
  ].join("\n");
}
