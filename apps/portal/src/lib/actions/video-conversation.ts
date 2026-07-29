"use server";

import { createUuidV7 } from "@axtro/domain";
import { createTavusVideoConversationPort, VideoProviderError } from "@axtro/provider-tavus";

import { fakeProvidersEnabled } from "@/lib/knowledge";
import { fetchAgents, fetchTenantOverview } from "@/lib/portal-data";
import { buildDeckContext, buildPlatformDeck, buildSalesDeck, type Deck } from "@/lib/presentation/deck";
import { createClient } from "@/lib/supabase/server";
import { logError as trackError } from "@/lib/telemetry";

export interface VideoConversationResult {
  readonly url: string | null;
  readonly error: string | null;
}

export interface PresentationConversationResult {
  readonly url: string | null;
  readonly conversationId: string | null;
  readonly deck: Deck | null;
  readonly error: string | null;
  /** Modo demonstração sem provider de vídeo: deck navegável manualmente. */
  readonly simulated?: boolean;
}

interface AgentVideoConfig {
  readonly configured: boolean;
  readonly persona_id?: string | null;
  readonly replica_id?: string | null;
  readonly language?: string | null;
  /** "platform" = apresenta a própria Axtro; "sales" (padrão) = vende o negócio do tenant. Campo explícito (0020) — nunca inferir do nome do agente. */
  readonly presentation_kind?: "sales" | "platform" | null;
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

  // Conhecimento ativo da conta vira contexto da chamada (RAG de vídeo).
  // Falha aqui degrada para a chamada sem digest — nunca bloqueia o vídeo.
  let knowledgeDigest: string | null = null;
  try {
    const { data: digestData, error: digestError } = await supabase.rpc("portal_knowledge_digest", { p_max_chars: 3500 });
    if (digestError) {
      trackError("portal_knowledge_digest_failed", digestError, { agent_id: agentId, mode: "video" });
    } else {
      const digest = (digestData ?? {}) as { content?: string | null };
      knowledgeDigest = typeof digest.content === "string" && digest.content.length > 0 ? digest.content : null;
    }
  } catch (digestUnexpected) {
    trackError("portal_knowledge_digest_failed", digestUnexpected, { agent_id: agentId, mode: "video" });
  }

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
            // A persona já carrega prompt, voz, percepção e interrupção — reforçamos
            // idioma, duração e (quando houver) o conhecimento autorizado da conta.
            personaId,
            conversationName: `preview-${agent.id.slice(0, 8)}`,
            ...(knowledgeDigest ? { conversationalContext: buildKnowledgeContext(knowledgeDigest) } : {}),
            language,
            maxCallDurationSeconds: 600,
          }
        : {
            replicaId,
            conversationName: `preview-${agent.id.slice(0, 8)}`,
            conversationalContext: buildVideoSalesContext(agent.name, overview.tenant.legal_name, knowledgeDigest),
            greeting: `Oi! Eu sou ${firstName(agent.name)}, consultora digital da ${overview.tenant.legal_name}. Que bom te ver! Me conta — o que te trouxe até aqui hoje?`,
            language,
            maxCallDurationSeconds: 600,
          },
    );
    // Cada conversa criada vira uma linha no ledger de custos (unit
    // 'conversation'; preço entra na reconciliação). Falha de log não pode
    // derrubar a chamada já criada — mas fica visível no servidor.
    const { error: logError } = await supabase.rpc("portal_log_video_usage", { p_id: createUuidV7() });
    if (logError) {
      trackError("portal_log_video_usage_failed", logError, { agent_id: agentId, mode: "video" });
    }
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

/**
 * Sala de APRESENTAÇÃO: a agente conduz um deck de slides ao vivo (tools
 * next_slide/previous_slide/go_to_slide anexadas à persona) enquanto vende
 * pela Reunião Silva. Exige persona configurada — o modo réplica não tem
 * tools. O digest de conhecimento divide o teto de 6000 chars do contexto
 * com o roteiro do deck.
 */
export async function startPresentationConversation(agentId: string): Promise<PresentationConversationResult> {
  const apiKey = process.env.TAVUS_API_KEY ?? "";
  const fakeMode = fakeProvidersEnabled();
  if (apiKey.trim().length === 0 && !fakeMode) {
    return { url: null, conversationId: null, deck: null, error: "O provider de vídeo ainda não está configurado neste ambiente." };
  }

  const [overview, agents] = await Promise.all([fetchTenantOverview(), fetchAgents()]);
  if (!overview.provisioned || !overview.tenant) {
    return { url: null, conversationId: null, deck: null, error: "Conta ainda não provisionada." };
  }
  const agent = agents.find((candidate) => candidate.id === agentId);
  if (!agent) {
    return { url: null, conversationId: null, deck: null, error: "Agente não encontrado nesta conta." };
  }

  const supabase = await createClient();
  const { data: configData } = await supabase.rpc("portal_agent_video_config", { p_agent_id: agentId });
  const config = (configData ?? { configured: false }) as AgentVideoConfig;
  const language: "portuguese" | "english" = config.language === "english" ? "english" : "portuguese";

  const deck = config.presentation_kind === "platform"
    ? buildPlatformDeck(firstName(agent.name))
    : buildSalesDeck({ agentName: firstName(agent.name), tenantName: overview.tenant.legal_name, language });

  // Modo demonstração (T3): sem sala de vídeo real — o deck volta navegável
  // manualmente, sem tocar o provider nem o ledger.
  if (fakeMode) {
    return { url: null, conversationId: "simulated", deck, error: null, simulated: true };
  }
  const personaId = config.configured ? config.persona_id ?? null : null;
  if (!personaId) {
    return { url: null, conversationId: null, deck: null, error: "Este agente ainda não tem persona de vídeo configurada — o modo apresentação exige uma." };
  }

  // Digest menor que no modo livre: o roteiro do deck divide o mesmo teto de
  // 6000 chars do conversational_context do adapter.
  let knowledgeDigest: string | null = null;
  try {
    const { data: digestData, error: digestError } = await supabase.rpc("portal_knowledge_digest", { p_max_chars: 2400 });
    if (digestError) {
      trackError("portal_knowledge_digest_failed", digestError, { agent_id: agentId, mode: "presentation" });
    } else {
      const digest = (digestData ?? {}) as { content?: string | null };
      knowledgeDigest = typeof digest.content === "string" && digest.content.length > 0 ? digest.content : null;
    }
  } catch (digestUnexpected) {
    trackError("portal_knowledge_digest_failed", digestUnexpected, { agent_id: agentId, mode: "presentation" });
  }

  const contextParts = [buildDeckContext(deck, language)];
  if (knowledgeDigest) contextParts.push("", buildKnowledgeContext(knowledgeDigest));
  const conversationalContext = contextParts.join("\n").slice(0, 5900);

  const port = createTavusVideoConversationPort({ apiKey });
  try {
    const conversation = await port.createConversation({
      personaId,
      conversationName: `apresentacao-${agent.id.slice(0, 8)}`,
      conversationalContext,
      language,
      maxCallDurationSeconds: 900,
    });
    const { error: logError } = await supabase.rpc("portal_log_video_usage", { p_id: createUuidV7() });
    if (logError) {
      trackError("portal_log_video_usage_failed", logError, { agent_id: agentId, mode: "presentation" });
    }
    return { url: conversation.conversationUrl, conversationId: conversation.conversationId, deck, error: null };
  } catch (error) {
    if (error instanceof VideoProviderError && error.code === "provider_rejected") {
      return { url: null, conversationId: null, deck: null, error: "O provider de vídeo recusou a chamada (limite de conversas simultâneas ou créditos). Tente novamente em instantes." };
    }
    return { url: null, conversationId: null, deck: null, error: "Não foi possível iniciar a apresentação agora." };
  }
}

function firstName(agentName: string): string {
  return agentName.split(/[\s—-]+/)[0] ?? agentName;
}

function buildKnowledgeContext(digest: string): string {
  return [
    "CONHECIMENTO AUTORIZADO DA CONTA — sua única fonte de fatos sobre produtos, preços, condições e políticas nesta chamada.",
    "Cite apenas o que está aqui; o que não estiver, diga com naturalidade que confirma com o time e conduza para o próximo passo. Nunca invente números.",
    "",
    digest,
  ].join("\n");
}

function buildVideoSalesContext(agentName: string, tenantLegalName: string, knowledgeDigest: string | null): string {
  const context = [
    `Você é "${agentName}", vendedora digital (Sales Closer) da conta "${tenantLegalName}" na plataforma Axtro Digital Human OS. Você está numa VIDEOCHAMADA de vendas ao vivo com um cliente em potencial.`,
    "Sua missão é conduzir a VENDA COMPLETA nesta conversa: criar rapport, descobrir a necessidade real, apresentar a solução conectada a essa necessidade, tratar objeções com empatia e segurança, e FECHAR.",
    "PERSONALIDADE: calorosa e consultiva. Você genuinamente se importa com o problema do cliente — escuta, valida o que ouviu, e só então avança. Confiança tranquila, nunca arrogância.",
    "RITMO DE VÍDEO (crítico): fale em turnos BEM CURTOS — no máximo 1 a 2 frases por vez, e UMA pergunta por turno. Nunca despeje listas ou parágrafos falados. Deixe o cliente falar mais do que você.",
    "FECHAMENTO FIRME: toda vez que houver sinal de interesse ou uma objeção resolvida, peça o compromisso com clareza — por exemplo: \"Posso agendar sua visita técnica ainda essa semana?\" ou \"Te mando a proposta formal hoje, fechado?\". Não espere o cliente pedir; conduza. Se ele recusar, entenda o porquê e tente um fechamento alternativo antes de recuar.",
    "Regras invioláveis:",
    "1. Você é uma agente de IA e nunca finge ser humana — se perguntarem, confirme com naturalidade em uma frase e volte pra venda.",
    knowledgeDigest
      ? "2. O CONHECIMENTO AUTORIZADO ao final deste contexto é sua única fonte de fatos sobre produtos, preços e condições. Cite apenas o que está nele; o que não estiver, diga com naturalidade que confirma com o time e conduza para o próximo passo. Nunca invente números."
      : "2. Esta conta ainda não conectou as fontes oficiais de preços: NÃO cite valores, nem faixas. Quando pedirem preço, transforme em avanço: \"o valor depende do dimensionamento — te entrego o número exato na proposta; posso agendar a visita técnica?\".",
    "3. Nunca prometa o que não foi configurado na conta. Nada de descontos inventados, prazos inventados ou garantias inventadas.",
    "4. Fale português brasileiro natural e caloroso, como numa conversa de vídeo real.",
    "5. Todo turno seu termina conduzindo: uma pergunta de descoberta, um tratamento de objeção ou um pedido de fechamento.",
  ];
  if (knowledgeDigest) {
    context.push("", buildKnowledgeContext(knowledgeDigest));
  }
  return context.join("\n");
}
