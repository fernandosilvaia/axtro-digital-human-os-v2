"use server";

import { createUuidV7 } from "@axtro/domain";
import { createTavusVideoConversationPort, VideoProviderError } from "@axtro/provider-tavus";

import { fakeProvidersEnabled } from "@/lib/knowledge";
import { checkVideoCap, reportConversationOverageIfNeeded, VIDEO_CAP_CHECK_FAILED_MESSAGE, VIDEO_CAP_MESSAGE } from "@/lib/video-cap";
import { fetchAgents, fetchTenantOverview } from "@/lib/portal-data";
import { buildDeckContext, buildPlatformDeck, buildSalesDeck, type Deck } from "@/lib/presentation/deck";
import { createClient } from "@/lib/supabase/server";
import { logError as trackError } from "@/lib/telemetry";
import { registerTranscriptPlaceholder, tavusWebhookCallbackUrl } from "@/lib/transcripts/register";
import { fetchKnowledgeDigest, resolveAgentVideoConfig } from "@/lib/video-config";

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

  // Teto diário de segurança (sempre) + teto mensal do plano (overage cobrado, nunca bloqueia) — falha fechada só no diário.
  const capVerdict = await checkVideoCap(supabase);
  if (capVerdict === "capped" || capVerdict === "check_failed") {
    return { url: null, error: capVerdict === "capped" ? VIDEO_CAP_MESSAGE : VIDEO_CAP_CHECK_FAILED_MESSAGE };
  }

  const configResult = await resolveAgentVideoConfig(supabase, agentId, "video");
  if (!configResult.ok) {
    return { url: null, error: configResult.error };
  }
  const config = configResult.config;

  // Conhecimento ativo da conta vira contexto da chamada (RAG de vídeo).
  const knowledgeDigest = await fetchKnowledgeDigest(supabase, agentId, "video", 3500);

  const personaId = config.configured && config.persona_id ? config.persona_id : undefined;
  const replicaId = config.configured && config.replica_id ? config.replica_id : defaultReplicaId;
  if (!personaId && replicaId.trim().length === 0) {
    return { url: null, error: "Este agente ainda não tem avatar de vídeo configurado." };
  }
  const language = config.language ?? "portuguese";

  const port = createTavusVideoConversationPort({ apiKey });
  const callbackUrl = tavusWebhookCallbackUrl();
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
            ...(callbackUrl ? { callbackUrl } : {}),
          }
        : {
            replicaId,
            conversationName: `preview-${agent.id.slice(0, 8)}`,
            conversationalContext: buildVideoSalesContext(agent.name, overview.tenant.legal_name, knowledgeDigest, language),
            // Saudação e contexto no MESMO idioma passado ao provider — um
            // agente configurado em inglês abria a call ouvindo pt-BR
            // (achado da auditoria 2026-08-02, fechado nesta onda).
            greeting: language === "english"
              ? `Hi! I'm ${firstName(agent.name)}, digital consultant at ${overview.tenant.legal_name}. Great to see you! Tell me — what brought you here today?`
              : `Oi! Eu sou ${firstName(agent.name)}, consultora digital da ${overview.tenant.legal_name}. Que bom te ver! Me conta — o que te trouxe até aqui hoje?`,
            language,
            maxCallDurationSeconds: 600,
            ...(callbackUrl ? { callbackUrl } : {}),
          },
    );
    // Cada conversa criada vira uma linha no ledger de custos (unit
    // 'conversation'; preço entra na reconciliação). Falha de log não pode
    // derrubar a chamada já criada — mas fica visível no servidor.
    const videoUsageEventId = createUuidV7();
    const { error: logError } = await supabase.rpc("portal_log_video_usage", { p_id: videoUsageEventId });
    if (logError) {
      trackError("portal_log_video_usage_failed", logError, { agent_id: agentId, mode: "video" });
    } else {
      await reportConversationOverageIfNeeded(supabase, capVerdict, videoUsageEventId);
    }
    // Placeholder do histórico (D-V2-106) — o webhook da Tavus preenche
    // `turns` quando a call terminar (application.transcription_ready).
    await registerTranscriptPlaceholder(supabase, agentId, "video", conversation.conversationId);
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
  const configResult = await resolveAgentVideoConfig(supabase, agentId, "presentation");
  if (!configResult.ok) {
    return { url: null, conversationId: null, deck: null, error: configResult.error };
  }
  const config = configResult.config;
  const language: "portuguese" | "english" = config.language === "english" ? "english" : "portuguese";

  const deck = config.presentation_kind === "platform"
    ? buildPlatformDeck(firstName(agent.name))
    : buildSalesDeck({ agentName: firstName(agent.name), tenantName: overview.tenant.legal_name, language });

  // Modo demonstração (T3): sem sala de vídeo real — o deck volta navegável
  // manualmente, sem tocar o provider nem o ledger.
  if (fakeMode) {
    return { url: null, conversationId: "simulated", deck, error: null, simulated: true };
  }

  // Teto diário de segurança (sempre) + teto mensal do plano (overage cobrado, nunca bloqueia) — falha fechada só no diário.
  const capVerdict = await checkVideoCap(supabase);
  if (capVerdict === "capped" || capVerdict === "check_failed") {
    return {
      url: null,
      conversationId: null,
      deck: null,
      error: capVerdict === "capped" ? VIDEO_CAP_MESSAGE : VIDEO_CAP_CHECK_FAILED_MESSAGE,
    };
  }
  const personaId = config.configured ? config.persona_id ?? null : null;
  if (!personaId) {
    return { url: null, conversationId: null, deck: null, error: "Este agente ainda não tem persona de vídeo configurada — o modo apresentação exige uma." };
  }

  // Digest menor que no modo livre: o roteiro do deck divide o mesmo teto de
  // 6000 chars do conversational_context do adapter.
  const knowledgeDigest = await fetchKnowledgeDigest(supabase, agentId, "presentation", 2400);

  const contextParts = [buildDeckContext(deck, language)];
  if (knowledgeDigest) contextParts.push("", buildKnowledgeContext(knowledgeDigest));
  const conversationalContext = contextParts.join("\n").slice(0, 5900);

  const port = createTavusVideoConversationPort({ apiKey });
  const callbackUrl = tavusWebhookCallbackUrl();
  try {
    const conversation = await port.createConversation({
      personaId,
      conversationName: `apresentacao-${agent.id.slice(0, 8)}`,
      conversationalContext,
      language,
      maxCallDurationSeconds: 900,
      ...(callbackUrl ? { callbackUrl } : {}),
    });
    const presentationUsageEventId = createUuidV7();
    const { error: logError } = await supabase.rpc("portal_log_video_usage", { p_id: presentationUsageEventId });
    if (logError) {
      trackError("portal_log_video_usage_failed", logError, { agent_id: agentId, mode: "presentation" });
    } else {
      await reportConversationOverageIfNeeded(supabase, capVerdict, presentationUsageEventId);
    }
    await registerTranscriptPlaceholder(supabase, agentId, "video", conversation.conversationId);
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

function buildVideoSalesContext(agentName: string, tenantLegalName: string, knowledgeDigest: string | null, language: string = "portuguese"): string {
  // Mesma doutrina nos dois idiomas — um agente configurado em inglês
  // recebia contexto mandando falar pt-BR (auditoria 2026-08-02).
  const context = language === "english"
    ? [
        `You are "${agentName}", a digital sales closer for the account "${tenantLegalName}" on the Axtro Digital Human OS platform. You are on a LIVE sales VIDEO CALL with a potential customer.`,
        "Your mission is to drive the COMPLETE SALE in this conversation: build rapport, uncover the real need, present the solution connected to that need, handle objections with empathy and confidence, and CLOSE.",
        "PERSONALITY: warm and consultative. You genuinely care about the customer's problem — listen, validate what you heard, and only then move forward. Calm confidence, never arrogance.",
        "VIDEO PACING (critical): speak in VERY SHORT turns — at most 1 to 2 sentences at a time, and ONE question per turn. Never dump lists or spoken paragraphs. Let the customer talk more than you.",
        "FIRM CLOSING: whenever there is a buying signal or a resolved objection, ask for the commitment clearly — for example: \"Can I schedule your technical visit this week?\" or \"I'll send you the formal proposal today, deal?\". Don't wait for the customer to ask; lead. If they decline, understand why and try an alternative close before backing off.",
        "Inviolable rules:",
        "1. You are an AI agent and never pretend to be human — if asked, confirm naturally in one sentence and get back to the sale.",
        knowledgeDigest
          ? "2. The AUTHORIZED KNOWLEDGE at the end of this context is your only source of facts about products, prices and terms. Quote only what is in it; anything else, say naturally that you'll confirm with the team and move to the next step. Never invent numbers."
          : "2. This account has not connected its official pricing sources yet: do NOT quote prices or ranges. When asked about price, turn it into progress: \"the price depends on sizing — I'll get you the exact number in the proposal; can I schedule the technical visit?\".",
        "3. Never promise what has not been configured on the account. No invented discounts, invented deadlines or invented guarantees.",
        "4. Speak natural, warm English, like on a real video call.",
        "5. Every one of your turns ends by leading: a discovery question, an objection treatment or a closing ask.",
      ]
    : [
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
