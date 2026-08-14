"use server";

import { createUuidV7 } from "@axtro/domain";
import { createOpenRouterTextGenerationPort, TextGenerationError } from "@axtro/provider-openrouter";

import { BrainChatValidationError, runBrainChatCompletion } from "@/lib/brain/chat-completion-core";
import {
  beginAiUsage,
  commitAiUsage,
  configuredOpenRouterGenerationModel,
  markAiUsageInFlight,
  markAiUsageUnknown,
  recordAiUsageProviderFailure,
  releaseAiUsageNotDispatched,
  stableAiUsageIdempotencyKey,
} from "@/lib/ai-budget/reservations";
import { embedQuery, fakeProvidersEnabled, type KnowledgeMatch } from "@/lib/knowledge";
import { fetchAgents, fetchTenantOverview } from "@/lib/portal-data";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { createClient } from "@/lib/supabase/server";
import { logError as trackError, logEvent } from "@/lib/telemetry";

export interface PreviewTurn {
  readonly role: "user" | "assistant";
  readonly content: string;
}

export interface AgentPreviewResult {
  readonly reply: string | null;
  readonly error: string | null;
}

const MAX_HISTORY_TURNS = 10;
const MAX_TURN_CHARS = 2000;
/** UUID formato solto — o client gera com crypto.randomUUID(), aceitamos qualquer id de tamanho razoável (é só a chave de idempotência do upsert, nunca é interpolado em SQL fora de bind param). */
const TRANSCRIPT_ID_PATTERN = /^[a-zA-Z0-9_-]{8,128}$/;

/**
 * Registra o histórico de conversa (D-V2-106 — antes NENHUMA conversa
 * ficava guardada pro dono revisar). Best-effort: nunca bloqueia nem atrasa
 * a resposta ao usuário — falha vira telemetria, a call em si já terminou.
 */
async function recordChatTranscript(
  supabase: Awaited<ReturnType<typeof createClient>>,
  agentId: string,
  transcriptId: string | undefined,
  turns: readonly PreviewTurn[],
): Promise<void> {
  if (typeof transcriptId !== "string" || !TRANSCRIPT_ID_PATTERN.test(transcriptId)) return;
  try {
    const { error } = await supabase.rpc("portal_upsert_conversation_transcript", {
      p_id: createUuidV7(),
      p_agent_id: agentId,
      p_surface: "chat",
      p_external_ref: transcriptId,
      p_turns: turns,
    });
    if (error) trackError("chat_transcript_record_failed", error, { agent_id: agentId });
  } catch (error) {
    trackError("chat_transcript_record_failed", error, { agent_id: agentId });
  }
}

export async function sendAgentPreviewMessage(
  agentId: string,
  history: readonly PreviewTurn[],
  userMessage: string,
  /** Id estável gerado pelo client (crypto.randomUUID()) — o mesmo em toda mensagem da sessão de teste, pra agrupar os turnos numa única conversa registrada. Ausente = não registra (compat com chamadores antigos). */
  transcriptId?: string,
): Promise<AgentPreviewResult> {
  const message = userMessage.trim();
  if (message.length === 0 || message.length > MAX_TURN_CHARS) {
    return { reply: null, error: `A mensagem precisa ter entre 1 e ${MAX_TURN_CHARS} caracteres.` };
  }
  if (!Array.isArray(history) || history.length > MAX_HISTORY_TURNS * 2) {
    return { reply: null, error: "Histórico da conversa longo demais — recarregue a página para reiniciar o teste." };
  }
  for (const turn of history) {
    if ((turn.role !== "user" && turn.role !== "assistant")
      || typeof turn.content !== "string"
      || turn.content.length === 0
      || turn.content.length > MAX_TURN_CHARS * 2) {
      return { reply: null, error: "Histórico da conversa inválido — recarregue a página." };
    }
  }

  const apiKey = process.env.OPENROUTER_API_KEY ?? "";
  if (apiKey.trim().length === 0 && !fakeProvidersEnabled()) {
    // Achado onda 8 (D-V2-117): OPENROUTER_API_KEY é a chave do caminho
    // MAIS usado do produto (chat de teste) — se sumir/typo'd, sem isto
    // toda mensagem falhava em silêncio, sem log nenhum.
    trackError("agent_preview_openrouter_key_missing", new Error("OPENROUTER_API_KEY not configured"), { agent_id: agentId });
    return { reply: null, error: "O provider de linguagem ainda não está configurado neste ambiente." };
  }

  // Tenant + agente do chamador (as duas buscas já são tenant-scoped por auth.uid()).
  const [overview, agents] = await Promise.all([fetchTenantOverview(), fetchAgents()]);
  if (!overview.provisioned || !overview.tenant) {
    return { reply: null, error: "Conta ainda não provisionada." };
  }
  const agent = agents.find((candidate) => candidate.id === agentId);
  if (!agent) {
    return { reply: null, error: "Agente não encontrado nesta conta." };
  }

  // Modo demonstração (T3): resposta determinística no formato da Reunião
  // Silva, sem provider e sem tocar o ledger — todos os fluxos de UI ficam
  // testáveis sem chave. O histórico de conversa (D-V2-106) AINDA é
  // registrado aqui (achado D-V2-107, pego só ao RODAR o e2e novo, não por
  // leitura estática de código): sem isso, a tela /conversas nunca tinha
  // nada pra mostrar em modo demonstração — nem pro visitante testando o
  // produto, nem pro e2e do CI, que roda com PORTAL_FAKE_PROVIDERS=1 e
  // nunca passa pelo caminho real abaixo. Best-effort, mesma disciplina de
  // recordChatTranscript: nunca atrasa nem derruba a resposta.
  if (fakeProvidersEnabled()) {
    const topic = message.slice(0, 80).replace(/\s+/g, " ").trim();
    const reply = [
      `Entendo o que você trouxe sobre "${topic}" — faz sentido olharmos isso com calma.`,
      "Pra eu te ajudar do jeito certo: hoje, como vocês lidam com isso — e o que te fez buscar uma solução agora?",
      "(resposta simulada — modo demonstração sem provider)",
    ].join(" ");
    const fakeSupabase = await createClient();
    await recordChatTranscript(fakeSupabase, agentId, transcriptId, [
      ...history,
      { role: "user", content: message },
      { role: "assistant", content: reply },
    ]);
    return { reply, error: null };
  }

  const supabase = await createClient();
  const budgetClient = createServiceRoleClient();
  let providerModel: string;
  try {
    providerModel = configuredOpenRouterGenerationModel(process.env);
  } catch (error) {
    trackError("chat_ai_rate_card_configuration_invalid", error, { agent_id: agentId });
    return { reply: null, error: "O modelo configurado não possui um envelope de custo aprovado." };
  }

  // O client atual sempre envia um transcriptId por conversa. Chamadores
  // antigos sem essa identidade ganham um escopo unico por Server Action;
  // mensagens identicas de conversas diferentes nunca colidem para sempre.
  const turnScope = typeof transcriptId === "string" && TRANSCRIPT_ID_PATTERN.test(transcriptId)
    ? transcriptId
    : createUuidV7();
  const idempotencyMaterial = `${overview.tenant.id}:${agentId}:${turnScope}:${JSON.stringify(history)}:${message}`;

  // RAG: busca vetorial nas fontes ativas da conta. Falha de recuperação
  // degrada para o prompt sem fontes (o chat não pode morrer por isso),
  // mas fica visível no log do servidor.
  let knowledgeMatches: readonly KnowledgeMatch[] = [];
  const retrievalReservationResult = await beginAiUsage({
    client: budgetClient,
    tenantId: overview.tenant.id,
    operation: "knowledge_query_embedding",
    idempotencyKey: stableAiUsageIdempotencyKey("knowledge_query_embedding", idempotencyMaterial),
    agentId,
  });
  if (!retrievalReservationResult.allowed) {
    return { reply: null, error: "Limite diário de IA da conta atingido ou temporariamente indisponível. Tente novamente mais tarde." };
  }
  if (retrievalReservationResult.reservation.state !== "reserved") {
    return { reply: null, error: "Esta solicitação de IA já foi processada. Inicie um novo turno para continuar." };
  }
  const retrievalReservation = retrievalReservationResult.reservation;
  let retrievalDispatched = false;
  let retrievalTerminalRecorded = false;
  try {
    retrievalDispatched = await markAiUsageInFlight(budgetClient, retrievalReservation);
    if (!retrievalDispatched) {
      return { reply: null, error: "Esta solicitação de IA já está em processamento. Aguarde antes de tentar novamente." };
    }
    const { embedding, inputTokens, reportedCostUsd } = await embedQuery(apiKey, message);
    const retrievalCommitted = await commitAiUsage(budgetClient, retrievalReservation, {
      inputTokens,
      outputTokens: 0,
      ...(reportedCostUsd === undefined ? {} : { reportedCostUsd }),
    });
    if (!retrievalCommitted) {
      await markAiUsageUnknown(budgetClient, retrievalReservation, "usage_commit_failed");
      retrievalTerminalRecorded = true;
      trackError("ai_usage_commit_failed", new Error("knowledge query reservation did not commit"), { agent_id: agentId, operation: "knowledge_query_embedding" });
      return { reply: null, error: "Não foi possível confirmar o uso de IA da conta. Tente novamente." };
    }
    const { data: searchData, error: searchError } = await supabase.rpc("portal_search_knowledge", {
      p_embedding: embedding,
      p_limit: 5,
    });
    if (searchError) {
      trackError("portal_search_knowledge_failed", searchError, { agent_id: agentId });
    } else if (Array.isArray(searchData)) {
      // Piso de similaridade: a RPC devolve sempre os top-N vizinhos, mesmo
      // pra "oi" — sem piso, ~1k tokens de chunks irrelevantes entravam em
      // TODO turno rotulados como "mais relevantes" (auditoria 2026-08-02).
      // 0.25 em cosine do text-embedding-3-small separa bem ruído de match
      // real; entrada sem similarity numérica passa (defensivo).
      knowledgeMatches = (searchData as (KnowledgeMatch & { similarity?: number })[]).filter(
        (match) => typeof match.similarity !== "number" || match.similarity >= 0.25,
      );
    }
  } catch (retrievalError) {
    if (retrievalDispatched && !retrievalTerminalRecorded) {
      await recordAiUsageProviderFailure(budgetClient, retrievalReservation, retrievalError);
      retrievalTerminalRecorded = true;
    } else if (!retrievalDispatched) {
      await releaseAiUsageNotDispatched(budgetClient, retrievalReservation);
    }
    trackError("knowledge_retrieval_failed", retrievalError, { agent_id: agentId });
    return { reply: null, error: "O orçamento da busca de conhecimento ficou pendente de reconciliação. Tente novamente mais tarde." };
  }

  const port = createOpenRouterTextGenerationPort({
    apiKey,
    appUrl: "https://portal-production-b43e.up.railway.app",
    appTitle: "Axtro Digital Human OS",
  });

  const generationReservationResult = await beginAiUsage({
    client: budgetClient,
    tenantId: overview.tenant.id,
    operation: "chat_generation",
    idempotencyKey: stableAiUsageIdempotencyKey("chat_generation", idempotencyMaterial),
    agentId,
  });
  if (!generationReservationResult.allowed) {
    return { reply: null, error: "Limite diário de tokens de teste da conta atingido. Volte amanhã ou fale com o suporte." };
  }
  if (generationReservationResult.reservation.state !== "reserved") {
    return { reply: null, error: "Esta solicitação de IA já foi processada. Inicie um novo turno para continuar." };
  }
  const generationReservation = generationReservationResult.reservation;
  let generationDispatched = false;
  let generationTerminalRecorded = false;

  try {
    const result = await runBrainChatCompletion(
      {
        agentName: agent.name,
        tenantName: overview.tenant.legal_name,
        surface: "chat",
        knowledgeMatches,
        history,
        userMessage: message,
      },
      {
        generate: async (messages, maxOutputTokens) => {
          generationDispatched = await markAiUsageInFlight(budgetClient, generationReservation);
          if (!generationDispatched) throw new Error("AI usage reservation is not executable");
          return port.generate({ model: providerModel, messages, maxOutputTokens });
        },
        logGenerationUsage: async (inputTokens, outputTokens, reportedCostUsd) => {
          const committed = await commitAiUsage(budgetClient, generationReservation, {
            inputTokens,
            outputTokens,
            ...(reportedCostUsd === undefined ? {} : { reportedCostUsd }),
          });
          if (!committed) {
            await markAiUsageUnknown(budgetClient, generationReservation, "usage_commit_failed");
            generationTerminalRecorded = true;
            trackError("ai_usage_commit_failed", new Error("chat generation reservation did not commit"), { agent_id: agentId, operation: "chat_generation" });
            throw new Error("AI usage commit failed after provider success");
          }
        },
      },
    );

    if (result.guardrailFlags.length > 0) {
      // Detecção não-bloqueante (achado P1, auditoria 2026-08-12) — mesmo
      // sinal do caminho de vídeo, sem logar o conteúdo da fala em si.
      logEvent("brain_guardrail_risk_detected", { agent_id: agentId, flags: result.guardrailFlags.join(","), surface: "chat" });
    }

    await recordChatTranscript(supabase, agentId, transcriptId, [
      ...history,
      { role: "user", content: message },
      { role: "assistant", content: result.reply },
    ]);

    return { reply: result.reply, error: null };
  } catch (error) {
    if (generationDispatched && !generationTerminalRecorded) {
      await recordAiUsageProviderFailure(budgetClient, generationReservation, error);
      generationTerminalRecorded = true;
    } else if (!generationDispatched) {
      await releaseAiUsageNotDispatched(budgetClient, generationReservation);
    }
    if (error instanceof BrainChatValidationError) {
      return { reply: null, error: "Não foi possível gerar a resposta agora." };
    }
    if (error instanceof TextGenerationError) {
      if (error.code === "provider_timeout") {
        return { reply: null, error: "O provider demorou demais para responder. Tente novamente." };
      }
      if (error.code === "provider_unavailable") {
        return { reply: null, error: "O provider de linguagem está indisponível no momento." };
      }
      return { reply: null, error: "Não foi possível gerar a resposta agora." };
    }
    return { reply: null, error: "Erro inesperado ao falar com o agente." };
  }
}
