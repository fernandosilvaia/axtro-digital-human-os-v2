"use server";

import { createUuidV7 } from "@axtro/domain";
import {
  createOpenRouterTextGenerationPort,
  TextGenerationError,
  type TextGenerationMessage,
} from "@axtro/provider-openrouter";

import { embedQuery, type KnowledgeMatch } from "@/lib/knowledge";
import { fetchAgents, fetchTenantOverview } from "@/lib/portal-data";
import { createClient } from "@/lib/supabase/server";

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

export async function sendAgentPreviewMessage(
  agentId: string,
  history: readonly PreviewTurn[],
  userMessage: string,
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
  if (apiKey.trim().length === 0) {
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

  const supabase = await createClient();

  // Teto diário de tokens por tenant — falha fechada se a leitura falhar.
  const { data: tokensToday, error: usageError } = await supabase.rpc("portal_ai_tokens_today");
  if (usageError) {
    return { reply: null, error: "Não foi possível verificar o uso de IA da conta. Tente novamente." };
  }
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
      console.error("portal_search_knowledge failed", searchError.message);
    } else if (Array.isArray(searchData)) {
      knowledgeMatches = searchData as KnowledgeMatch[];
      const { error: retrievalLogError } = await supabase.rpc("portal_log_ai_usage", {
        p_id: createUuidV7(),
        p_service: "portal.knowledge_retrieval",
        p_input_tokens: inputTokens,
        p_output_tokens: 0,
      });
      if (retrievalLogError) {
        console.error("portal_log_ai_usage failed", retrievalLogError.message);
      }
    }
  } catch (retrievalError) {
    console.error("knowledge retrieval failed", retrievalError instanceof Error ? retrievalError.message : retrievalError);
  }

  // O bloco de fontes vai numa segunda mensagem system: o cap de 4000 chars
  // do adapter é POR mensagem, e prompt base + chunks juntos não cabem.
  const knowledgeBlock = buildKnowledgeBlock(knowledgeMatches);
  const messages: TextGenerationMessage[] = [
    { role: "system", content: buildSystemPrompt(agent.name, overview.tenant.legal_name, knowledgeMatches.length > 0) },
    ...(knowledgeBlock ? [{ role: "system" as const, content: knowledgeBlock }] : []),
    ...history.slice(-MAX_HISTORY_TURNS * 2).map((turn) => ({ role: turn.role, content: turn.content })),
    { role: "user", content: message },
  ];

  const port = createOpenRouterTextGenerationPort({
    apiKey,
    appUrl: "https://portal-production-b43e.up.railway.app",
    appTitle: "Axtro Digital Human OS",
  });

  try {
    const result = await port.generate({
      model: process.env.OPENROUTER_MODEL ?? DEFAULT_MODEL,
      messages,
      maxOutputTokens: 512,
    });

    // Registro de uso no ledger de custo do tenant. Falha de log não pode
    // sumir com a resposta já paga — mas precisa ficar visível no servidor.
    const { error: logError } = await supabase.rpc("portal_log_ai_usage", {
      p_id: createUuidV7(),
      p_service: "portal.agent_preview",
      p_input_tokens: result.usage.inputTokens,
      p_output_tokens: result.usage.outputTokens,
    });
    if (logError) {
      console.error("portal_log_ai_usage failed", logError.message);
    }

    return { reply: result.text, error: null };
  } catch (error) {
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

// O adapter OpenRouter limita cada mensagem a 4000 chars — o bloco de fontes
// vive numa mensagem system própria e respeita esse teto com folga.
const MAX_KNOWLEDGE_CHUNK_CHARS = 740;
const MAX_KNOWLEDGE_BLOCK_CHARS = 3800;

function buildKnowledgeBlock(knowledgeMatches: readonly KnowledgeMatch[]): string | null {
  if (knowledgeMatches.length === 0) return null;
  const lines = ["FONTES AUTORIZADAS DA CONTA (trechos mais relevantes para a mensagem atual):"];
  let blockChars = lines[0]?.length ?? 0;
  for (const match of knowledgeMatches) {
    const piece = `[${match.source_name}] ${match.chunk_text.slice(0, MAX_KNOWLEDGE_CHUNK_CHARS)}`;
    if (blockChars + piece.length > MAX_KNOWLEDGE_BLOCK_CHARS) break;
    blockChars += piece.length;
    lines.push(piece);
  }
  return lines.length > 1 ? lines.join("\n") : null;
}

function buildSystemPrompt(
  agentName: string,
  tenantLegalName: string,
  hasKnowledge: boolean,
): string {
  const lines = [
    `Você é "${agentName}", vendedora digital (Sales Closer) da conta "${tenantLegalName}" na plataforma Axtro Digital Human OS.`,
    "Este é um AMBIENTE DE TESTE (sandbox) usado pelo operador da conta para avaliar seu comportamento antes de qualquer contato com clientes reais.",
    "PERSONALIDADE: calorosa e consultiva — escuta, valida o que ouviu e só então avança. Confiança tranquila, nunca arrogância.",
    "FECHAMENTO FIRME: a cada sinal de interesse ou objeção resolvida, peça o compromisso com clareza (agendar visita/conversa, receber a proposta). Não espere o cliente pedir; conduza. Se recusar, entenda o porquê e tente um fechamento alternativo antes de recuar.",
    "Regras invioláveis:",
    "1. Você é uma agente de IA e nunca finge ser humana. Se perguntarem, confirme com naturalidade em uma frase e volte pra venda.",
    hasKnowledge
      ? "2. As FONTES AUTORIZADAS (mensagem seguinte) são sua ÚNICA fonte de fatos sobre produtos, preços, condições, impostos, créditos e políticas desta conta — NUNCA responda esses temas de memória geral, nem que pareça óbvio. O que não estiver nas fontes, diga com naturalidade que confirma com o time e transforme em avanço (\"te trago esse detalhe na proposta; posso agendar?\"). Nunca invente números."
      : "2. Nenhuma fonte de conhecimento da conta está conectada a este teste: NÃO cite preços, faixas, condições ou características específicas — quando pedirem valor, transforme em avanço (\"o número exato sai na proposta; posso agendar?\").",
    "3. Não faça promessas, não feche contratos, não envie nada: este chat não executa ações externas.",
    "4. Responda no idioma do interlocutor; seja breve (até 2 parágrafos curtos) e termine todo turno conduzindo — pergunta de descoberta, tratamento de objeção ou pedido de fechamento.",
  ];
  return lines.join("\n");
}
