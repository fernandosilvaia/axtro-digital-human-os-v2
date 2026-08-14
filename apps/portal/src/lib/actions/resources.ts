"use server";

import { revalidatePath } from "next/cache";

import { createUuidV7, isUuidV7 } from "@axtro/domain";

import { provisionAgentVideoIfMissing } from "@/lib/agent-video";
import {
  AI_USAGE_LIMITS,
  executeReservedAiUsage,
  stableAiUsageIdempotencyKey,
} from "@/lib/ai-budget/reservations";
import { sendAgentActivatedEmail } from "@/lib/email";
import { chunkContent, contentSha256, embedChunks, fakeProvidersEnabled, MAX_CONTENT_CHARS } from "@/lib/knowledge";
import { fetchAgents, fetchTenantOverview } from "@/lib/portal-data";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { createClient } from "@/lib/supabase/server";
import { logError as trackError } from "@/lib/telemetry";

export interface ResourceActionState {
  readonly error: string | null;
  readonly done: boolean;
  /** Aviso não-bloqueante: a ação principal teve sucesso, mas um efeito colateral best-effort falhou. */
  readonly warning?: string;
}

const CREATE_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  "an agent with this name already exists": "Já existe um agente com esse nome.",
  "a knowledge source with this name already exists": "Já existe uma fonte de conhecimento com esse nome.",
  "only a tenant_admin can create agents": "Somente administradores podem criar agentes.",
  "only a tenant_admin can register knowledge sources": "Somente administradores podem cadastrar fontes.",
  "agent limit reached for this account": "Limite de agentes da conta atingido.",
  "knowledge source limit reached for this account": "Limite de fontes de conhecimento da conta atingido.",
};

export async function createAgent(_prevState: ResourceActionState, formData: FormData): Promise<ResourceActionState> {
  const name = String(formData.get("name") ?? "").trim();
  if (name.length < 2 || name.length > 120) {
    return { error: "O nome do agente precisa ter entre 2 e 120 caracteres.", done: false };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("portal_create_agent", {
    p_id: createUuidV7(),
    p_name: name,
    p_role_type: "sales",
  });
  if (error) {
    return { error: CREATE_ERROR_MESSAGES[error.message] ?? `Não foi possível criar: ${error.message}`, done: false };
  }

  revalidatePath("/agentes");
  revalidatePath("/dashboard");
  return { error: null, done: true };
}

const SOURCE_TYPES = ["document", "faq", "url"] as const;
const CLASSIFICATIONS = ["internal", "confidential", "restricted"] as const;

export async function createKnowledgeSource(
  _prevState: ResourceActionState,
  formData: FormData,
): Promise<ResourceActionState> {
  const displayName = String(formData.get("display_name") ?? "").trim();
  const sourceType = String(formData.get("source_type") ?? "");
  const classification = String(formData.get("data_classification") ?? "");
  const content = String(formData.get("content") ?? "").trim();

  if (displayName.length < 2 || displayName.length > 160) {
    return { error: "O nome da fonte precisa ter entre 2 e 160 caracteres.", done: false };
  }
  if (!(SOURCE_TYPES as readonly string[]).includes(sourceType)) {
    return { error: "Tipo de fonte inválido.", done: false };
  }
  if (!(CLASSIFICATIONS as readonly string[]).includes(classification)) {
    return { error: "Classificação de dados inválida.", done: false };
  }
  if (content.length > MAX_CONTENT_CHARS) {
    return { error: `O conteúdo pode ter no máximo ${MAX_CONTENT_CHARS.toLocaleString("pt-BR")} caracteres.`, done: false };
  }
  // Modo demonstração tem embeddings determinísticos (embedChunks resolve
  // sozinho) — a guarda de chave só vale fora dele (contrato T3: todos os
  // fluxos de UI testáveis sem chave; auditoria 2026-08-02).
  if (content.length > 0 && !fakeProvidersEnabled() && (process.env.OPENROUTER_API_KEY ?? "").trim().length === 0) {
    return { error: "O provider de embeddings ainda não está configurado neste ambiente.", done: false };
  }

  const overview = await fetchTenantOverview();
  if (!overview.provisioned || !overview.tenant) {
    return { error: "Conta ainda não provisionada.", done: false };
  }
  const supabase = await createClient();
  const sourceId = createUuidV7();
  const { error } = await supabase.rpc("portal_create_knowledge_source", {
    p_id: sourceId,
    p_display_name: displayName,
    p_source_type: sourceType,
    p_data_classification: classification,
  });
  if (error) {
    return { error: CREATE_ERROR_MESSAGES[error.message] ?? `Não foi possível cadastrar: ${error.message}`, done: false };
  }

  // Ingestão real: chunking + embeddings via OpenRouter + RPC de ingestão.
  // Sem conteúdo a fonte fica pendente, como antes.
  if (content.length > 0) {
    const ingestError = await ingestContentForSource(supabase, overview.tenant.id, sourceId, content);
    if (ingestError) {
      // NUNCA sugerir reenviar este form: a fonte JÁ foi criada — reenvio
      // criaria uma duplicata pendente e queimaria mais uma vaga do limite.
      return { error: `A fonte foi registrada, mas ${ingestError} Ela aparece como pendente na lista abaixo — adicione o conteúdo por lá quando quiser tentar de novo.`, done: false };
    }
  }

  revalidatePath("/conhecimento");
  revalidatePath("/dashboard");
  return { error: null, done: true };
}

/** Chunking + embeddings + RPC de ingestão. Retorna mensagem de erro ou null. */
async function ingestContentForSource(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tenantId: string,
  sourceId: string,
  content: string,
): Promise<string | null> {
  const fakeMode = fakeProvidersEnabled();
  const contentHash = contentSha256(content);
  try {
    const texts = chunkContent(content);
    const embedded = fakeMode
      ? { outcome: "committed" as const, value: await embedChunks(process.env.OPENROUTER_API_KEY ?? "", texts) }
      : await (async () => {
        // Antes de usar service role, confirme ownership com a RPC RLS do
        // caller. A reserva revalida o mesmo par tenant/source no banco.
        const { data: sources, error: sourceError } = await supabase.rpc("portal_list_knowledge_sources");
        if (sourceError || !Array.isArray(sources) || !sources.some((source) => (
          source !== null && typeof source === "object" && (source as { id?: unknown }).id === sourceId
        ))) {
          throw new Error("knowledge source is not owned by the authenticated tenant");
        }
        return executeReservedAiUsage({
          // Service role so the browser-authenticated caller never controls a
          // token/cost envelope or ledger transition. tenantId came from the
          // authenticated overview; the service RPC revalidates source+tenant.
          client: createServiceRoleClient(),
          tenantId,
          operation: "knowledge_ingestion_embedding",
          idempotencyKey: stableAiUsageIdempotencyKey("knowledge_ingestion_embedding", `${sourceId}:${contentHash}`),
          sourceId,
          execute: () => embedChunks(
            process.env.OPENROUTER_API_KEY ?? "",
            texts,
            AI_USAGE_LIMITS.knowledge_ingestion_embedding.maxInputTokens,
          ),
          usage: ({ inputTokens, reportedCostUsd }) => ({
            inputTokens,
            outputTokens: 0,
            ...(reportedCostUsd === undefined ? {} : { reportedCostUsd }),
          }),
        });
      })();
    if (embedded.outcome === "denied") {
      if (embedded.reason === "capped") {
        return "o limite diário de ingestões da conta foi atingido — tente novamente amanhã.";
      }
      return "o orçamento da ingestão está indisponível ou aguarda reconciliação — tente novamente mais tarde.";
    }
    if (embedded.outcome === "not_acquired") {
      return "esta ingestão já está em processamento — aguarde antes de tentar novamente.";
    }
    if (embedded.outcome === "commit_pending") {
      trackError("ai_usage_commit_failed", new Error("knowledge ingestion reservation did not commit"), { source_id: sourceId, operation: "knowledge_ingestion_embedding" });
      return "o custo do provider ficou pendente de reconciliação; nenhum novo envio será feito agora.";
    }
    const { chunks } = embedded.value;
    const { error: ingestError } = await supabase.rpc("portal_ingest_knowledge", {
      p_source_id: sourceId,
      p_version_id: createUuidV7(),
      p_version: `v${Math.floor(Date.now() / 1000)}`,
      p_content_hash: contentHash,
      p_chunks: chunks,
    });
    if (ingestError) {
      if (ingestError.message === "daily knowledge ingestion limit reached for this account") {
        return "o limite diário de ingestões da conta foi atingido — tente novamente amanhã.";
      }
      return `a ingestão falhou (${ingestError.message}).`;
    }
    return null;
  } catch (embedError) {
    trackError("knowledge_ingestion_failed", embedError, { source_id: sourceId });
    return "o provider de embeddings falhou e a tentativa aguarda reconciliação.";
  }
}

/** Atualiza o conteúdo de uma fonte existente: re-ingestão substitui a versão anterior. */
export async function updateKnowledgeSourceContent(
  _prevState: ResourceActionState,
  formData: FormData,
): Promise<ResourceActionState> {
  const sourceId = String(formData.get("source_id") ?? "").trim();
  const content = String(formData.get("content") ?? "").trim();

  if (!isUuidV7(sourceId)) {
    return { error: "Fonte inválida — recarregue a página.", done: false };
  }
  if (content.length === 0 || content.length > MAX_CONTENT_CHARS) {
    return { error: `O conteúdo precisa ter entre 1 e ${MAX_CONTENT_CHARS.toLocaleString("pt-BR")} caracteres.`, done: false };
  }
  if (!fakeProvidersEnabled() && (process.env.OPENROUTER_API_KEY ?? "").trim().length === 0) {
    return { error: "O provider de embeddings ainda não está configurado neste ambiente.", done: false };
  }

  const overview = await fetchTenantOverview();
  if (!overview.provisioned || !overview.tenant) {
    return { error: "Conta ainda não provisionada.", done: false };
  }
  const supabase = await createClient();
  const ingestError = await ingestContentForSource(supabase, overview.tenant.id, sourceId, content);
  if (ingestError) {
    return { error: `Não foi possível atualizar: ${ingestError}`, done: false };
  }

  revalidatePath("/conhecimento");
  revalidatePath("/dashboard");
  return { error: null, done: true };
}

/**
 * Ativação/pausa de agente (T1). A guarda de PROVIDER vive aqui — é
 * conhecimento do ambiente: ativar exige ao menos o provider de texto
 * configurado (o chat é a capacidade mínima de um agente ativo). As guardas
 * de dado (admin, transições, disclosure) vivem na RPC 0014.
 */
export async function setAgentStatus(
  agentId: string,
  status: "active" | "draft",
): Promise<ResourceActionState> {
  if (status !== "active" && status !== "draft") {
    return { error: "Status inválido.", done: false };
  }
  if (status === "active" && (process.env.OPENROUTER_API_KEY ?? "").trim().length === 0
    && process.env.PORTAL_FAKE_PROVIDERS !== "1") {
    return { error: "Ative um provider de linguagem antes de ativar agentes neste ambiente.", done: false };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("portal_set_agent_status", {
    p_agent_id: agentId,
    p_status: status,
  });
  if (error) {
    if (error.message === "only a tenant_admin can change agent status") {
      return { error: "Somente administradores podem ativar ou pausar agentes.", done: false };
    }
    if (error.message === "agent status cannot be changed from its current state") {
      return { error: "Este agente está num estado que não permite alteração pelo portal.", done: false };
    }
    return { error: `Não foi possível alterar o status: ${error.message}`, done: false };
  }

  // Ativação dispara dois efeitos best-effort que nunca desfazem a mudança
  // já aplicada: (1) auto-provisão da persona de vídeo se o agente ainda não
  // tem (P1 — é o que dá videochamada/apresentação/reunião externa a agentes
  // de clientes novos, não só aos demo configurados à mão); (2) e-mail aos
  // admins do tenant (T9). `changed` (0014) distingue uma transição real de
  // um no-op idempotente — achado P2 confirmado (auditoria 2026-08-12): sem
  // checar isso, chamar a action duas vezes com status='active' (duas abas,
  // ou clique duplo que escapa do disabled={pending}) reprovisionava vídeo
  // e reenviava o e-mail "Agente ativado" mesmo sem nenhuma mudança real.
  const changed = (data as { changed?: boolean } | null)?.changed !== false;
  // Sinal não-bloqueante pro chamador: ativação nunca falha por causa disto
  // (best-effort por contrato, ver agent-video.ts), mas o usuário merece
  // saber que o vídeo não ficou pronto em vez de descobrir minutos depois
  // numa tela sem relação nenhuma com a ativação (achado ao vivo W7).
  let videoProvisioningWarning: string | undefined;
  if (status === "active" && changed) {
    try {
      const [overview, agents, adminEmailsResult] = await Promise.all([
        fetchTenantOverview(),
        fetchAgents(),
        supabase.rpc("portal_list_admin_emails"),
      ]);
      const agent = agents.find((candidate) => candidate.id === agentId);
      if (agent && overview.tenant) {
        const video = await provisionAgentVideoIfMissing(supabase, agent, overview.tenant.legal_name, overview.tenant.default_language);
        if (video.attempted && !video.provisioned) {
          videoProvisioningWarning = "Agente ativado, mas o vídeo ainda não foi configurado — tente pausar e ativar de novo em alguns minutos.";
        }
      }
      const admins = (adminEmailsResult.data ?? []) as string[];
      if (agent && overview.tenant && admins.length > 0) {
        await sendAgentActivatedEmail({
          to: admins,
          workspaceName: overview.tenant.legal_name,
          agentName: agent.name,
        });
      }
    } catch (notifyError) {
      trackError("agent_activation_side_effects_failed", notifyError, { agent_id: agentId });
      videoProvisioningWarning = "Agente ativado, mas o vídeo ainda não foi configurado — tente pausar e ativar de novo em alguns minutos.";
    }
  }

  revalidatePath("/agentes");
  revalidatePath("/dashboard");
  return { error: null, done: true, ...(videoProvisioningWarning ? { warning: videoProvisioningWarning } : {}) };
}

/** Exclui um agente ainda em rascunho (sem histórico de sessões) — libera o limite da conta. */
export async function deleteDraftAgent(agentId: string): Promise<ResourceActionState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("portal_delete_draft_agent", { p_agent_id: agentId });
  if (error) {
    if (error.message === "only draft agents can be deleted") {
      return { error: "Só agentes em rascunho podem ser excluídos — pause o agente primeiro.", done: false };
    }
    if (error.message === "agent has session history and cannot be deleted") {
      return { error: "Este agente tem histórico de conversas e não pode ser excluído.", done: false };
    }
    return { error: `Não foi possível excluir: ${error.message}`, done: false };
  }
  revalidatePath("/agentes");
  revalidatePath("/dashboard");
  return { error: null, done: true };
}

/** Exclui uma fonte já revogada (ou nunca ingerida) — libera o limite e apaga o conteúdo. */
export async function deleteKnowledgeSource(sourceId: string): Promise<ResourceActionState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("portal_delete_knowledge_source", { p_source_id: sourceId });
  if (error) {
    if (error.message === "revoke the source before deleting it") {
      return { error: "Revogue a fonte antes de excluí-la.", done: false };
    }
    return { error: `Não foi possível excluir: ${error.message}`, done: false };
  }
  revalidatePath("/conhecimento");
  revalidatePath("/dashboard");
  return { error: null, done: true };
}

/** Revogação/reativação imediata: fontes 'disabled' somem da busca e do digest na hora. */
export async function setKnowledgeSourceStatus(
  sourceId: string,
  status: "active" | "disabled",
): Promise<ResourceActionState> {
  if (status !== "active" && status !== "disabled") {
    return { error: "Status inválido.", done: false };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("portal_set_knowledge_source_status", {
    p_source_id: sourceId,
    p_status: status,
  });
  if (error) {
    if (error.message === "source has no ingested content to activate") {
      return { error: "Esta fonte ainda não tem conteúdo ingerido — adicione conteúdo antes de ativar.", done: false };
    }
    if (error.message === "only a tenant_admin can change knowledge sources") {
      return { error: "Somente administradores podem alterar fontes.", done: false };
    }
    return { error: `Não foi possível alterar o status: ${error.message}`, done: false };
  }
  revalidatePath("/conhecimento");
  revalidatePath("/dashboard");
  return { error: null, done: true };
}
