"use server";

import { createUuidV7 } from "@axtro/domain";
import { createOpenRouterTextGenerationPort, TextGenerationError } from "@axtro/provider-openrouter";

import { BrainChatValidationError, runBrainChatCompletion } from "@/lib/brain/chat-completion-core";
import { maybeAlertCostCap } from "@/lib/cost-alerts";
import { embedQuery, fakeProvidersEnabled, type KnowledgeMatch } from "@/lib/knowledge";
import { fetchAgents, fetchTenantOverview } from "@/lib/portal-data";
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
const DAILY_TOKEN_CAP = 500_000;
const DEFAULT_MODEL = "anthropic/claude-haiku-4.5";
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

  // Teto diário de tokens por tenant — falha fechada se a leitura falhar.
  const { data: tokensToday, error: usageError } = await supabase.rpc("portal_ai_tokens_today");
  if (usageError) {
    return { reply: null, error: "Não foi possível verificar o uso de IA da conta. Tente novamente." };
  }
  // Alerta proativo (D-V2-107): fire-and-forget, mesmo ponto que já lê o uso do dia.
  void maybeAlertCostCap({ tenantId: overview.tenant.id, capKind: "daily_tokens", current: Number(tokensToday), cap: DAILY_TOKEN_CAP });
  if (Number(tokensToday) >= DAILY_TOKEN_CAP) {
    return { reply: null, error: "Limite diário de tokens de teste da conta atingido. Volte amanhã ou fale com o suporte." };
  }

  // RAG: busca vetorial nas fontes ativas da conta. Falha de recuperação
  // degrada para o prompt sem fontes (o chat não pode morrer por isso),
  // mas fica visível no log do servidor.
  let knowledgeMatches: readonly KnowledgeMatch[] = [];
  try {
    const { embedding, inputTokens } = await embedQuery(apiKey, message);
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
      const { error: retrievalLogError } = await supabase.rpc("portal_log_ai_usage", {
        p_id: createUuidV7(),
        p_service: "portal.knowledge_retrieval",
        p_input_tokens: inputTokens,
        p_output_tokens: 0,
      });
      if (retrievalLogError) {
        trackError("portal_log_ai_usage_failed", retrievalLogError, { agent_id: agentId, service: "portal.knowledge_retrieval" });
      }
    }
  } catch (retrievalError) {
    trackError("knowledge_retrieval_failed", retrievalError, { agent_id: agentId });
  }

  const port = createOpenRouterTextGenerationPort({
    apiKey,
    appUrl: "https://portal-production-b43e.up.railway.app",
    appTitle: "Axtro Digital Human OS",
  });

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
        generate: (messages, maxOutputTokens) =>
          port.generate({ model: process.env.OPENROUTER_MODEL ?? DEFAULT_MODEL, messages, maxOutputTokens }),
        logGenerationUsage: async (inputTokens, outputTokens, reportedCostUsd) => {
          // Registro de uso no ledger de custo do tenant. Falha de log não pode
          // sumir com a resposta já paga — mas precisa ficar visível no servidor.
          // Com o custo faturado reportado pelo OpenRouter, o evento entra como
          // 'provider_reported' (valor exato, qualquer modelo) em vez de
          // estimativa por tabela do Haiku (0027).
          const { error: logError } = await supabase.rpc("portal_log_ai_usage", {
            p_id: createUuidV7(),
            p_service: "portal.agent_preview",
            p_input_tokens: inputTokens,
            p_output_tokens: outputTokens,
            ...(reportedCostUsd !== undefined ? { p_reported_cost_usd: reportedCostUsd } : {}),
          });
          if (logError) {
            trackError("portal_log_ai_usage_failed", logError, { agent_id: agentId, service: "portal.agent_preview" });
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

