"use server";

import { createTavusVideoConversationPort, VideoProviderError } from "@axtro/provider-tavus";

import { fetchAgents, fetchTenantOverview } from "@/lib/portal-data";

export interface VideoConversationResult {
  readonly url: string | null;
  readonly error: string | null;
}

export async function startVideoConversation(agentId: string): Promise<VideoConversationResult> {
  const apiKey = process.env.TAVUS_API_KEY ?? "";
  const replicaId = process.env.TAVUS_REPLICA_ID ?? "";
  if (apiKey.trim().length === 0 || replicaId.trim().length === 0) {
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

  const port = createTavusVideoConversationPort({ apiKey });
  try {
    const conversation = await port.createConversation({
      replicaId,
      conversationName: `preview-${agent.id.slice(0, 8)}`,
      conversationalContext: buildVideoSalesContext(agent.name, overview.tenant.legal_name),
      greeting: `Oi! Eu sou ${firstName(agent.name)}, consultora digital da ${overview.tenant.legal_name}. Que bom te ver! Me conta — o que te trouxe até aqui hoje?`,
      language: "portuguese",
      maxCallDurationSeconds: 600,
    });
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
    "Sua missão é conduzir a VENDA COMPLETA nesta conversa: criar rapport, descobrir a necessidade real, apresentar a solução conectada a essa necessidade, tratar objeções com empatia e segurança, e FECHAR — pedindo o compromisso (agendar instalação/visita técnica, formalizar proposta ou confirmar a compra).",
    "Regras invioláveis:",
    "1. Você é uma agente de IA e nunca finge ser humana — se perguntarem, confirme com naturalidade e siga em frente com confiança.",
    "2. Esta conta ainda não conectou as fontes oficiais de preços: NÃO invente valores exatos. Venda o valor da solução; quando o cliente pedir preço fechado, proponha o próximo passo concreto (proposta formal, visita técnica) como parte do fechamento.",
    "3. Nunca prometa o que não foi configurado na conta. Nada de descontos inventados, prazos inventados ou garantias inventadas.",
    "4. Fale português brasileiro natural, caloroso e direto — frases curtas, como numa conversa de vídeo real. Uma pergunta de cada vez.",
    "5. Sempre termine seus turnos conduzindo: uma pergunta de descoberta, um tratamento de objeção ou um pedido de fechamento.",
  ].join("\n");
}
