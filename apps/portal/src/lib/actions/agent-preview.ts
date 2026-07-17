"use server";

import { createUuidV7 } from "@axtro/domain";
import {
  createOpenRouterTextGenerationPort,
  TextGenerationError,
  type TextGenerationMessage,
} from "@axtro/provider-openrouter";

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

  const messages: TextGenerationMessage[] = [
    { role: "system", content: buildSystemPrompt(agent.name, overview.tenant.legal_name) },
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

function buildSystemPrompt(agentName: string, tenantLegalName: string): string {
  return [
    `Você é "${agentName}", um agente digital de vendas (Sales Closer) da conta "${tenantLegalName}" na plataforma Axtro Digital Human OS.`,
    "Este é um AMBIENTE DE TESTE (sandbox) usado pelo operador da conta para avaliar seu comportamento antes de qualquer contato com clientes reais.",
    "Regras invioláveis:",
    "1. Você é um agente de IA e nunca finge ser humano. Se perguntarem, afirme com naturalidade que é um assistente digital.",
    "2. Nenhuma fonte de conhecimento da conta está conectada a este teste: NÃO cite preços, condições, prazos ou características específicas de produtos — diga que essa informação virá das fontes autorizadas da conta quando forem conectadas.",
    "3. Não faça promessas, não feche contratos, não envie nada: este chat não executa ações externas.",
    "4. Conduza como um closer consultivo: entenda a necessidade, qualifique, resuma e proponha o próximo passo (por exemplo, agendar uma conversa).",
    "5. Responda no idioma do interlocutor; seja claro e breve (até 3 parágrafos curtos).",
  ].join("\n");
}
