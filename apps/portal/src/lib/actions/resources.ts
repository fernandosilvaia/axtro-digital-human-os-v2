"use server";

import { revalidatePath } from "next/cache";

import { createUuidV7 } from "@axtro/domain";

import { sendAgentActivatedEmail } from "@/lib/email";
import { chunkContent, contentSha256, embedChunks, MAX_CONTENT_CHARS } from "@/lib/knowledge";
import { fetchAgents, fetchTenantOverview } from "@/lib/portal-data";
import { createClient } from "@/lib/supabase/server";

export interface ResourceActionState {
  readonly error: string | null;
  readonly done: boolean;
}

const CREATE_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  "an agent with this name already exists": "Já existe um agente com esse nome.",
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
  if (content.length > 0 && (process.env.OPENROUTER_API_KEY ?? "").trim().length === 0) {
    return { error: "O provider de embeddings ainda não está configurado neste ambiente.", done: false };
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
    const ingestError = await ingestContentForSource(supabase, sourceId, content);
    if (ingestError) {
      return { error: `A fonte foi registrada, mas ${ingestError} Ela segue pendente — tente novamente.`, done: false };
    }
  }

  revalidatePath("/conhecimento");
  revalidatePath("/dashboard");
  return { error: null, done: true };
}

/** Chunking + embeddings + RPC de ingestão. Retorna mensagem de erro ou null. */
async function ingestContentForSource(
  supabase: Awaited<ReturnType<typeof createClient>>,
  sourceId: string,
  content: string,
): Promise<string | null> {
  try {
    const texts = chunkContent(content);
    const { chunks, inputTokens } = await embedChunks(process.env.OPENROUTER_API_KEY ?? "", texts);
    const { error: ingestError } = await supabase.rpc("portal_ingest_knowledge", {
      p_source_id: sourceId,
      p_version_id: createUuidV7(),
      p_version: `v${Math.floor(Date.now() / 1000)}`,
      p_content_hash: contentSha256(content),
      p_chunks: chunks,
    });
    if (ingestError) {
      if (ingestError.message === "daily knowledge ingestion limit reached for this account") {
        return "o limite diário de ingestões da conta foi atingido — tente novamente amanhã.";
      }
      return `a ingestão falhou (${ingestError.message}).`;
    }
    const { error: logError } = await supabase.rpc("portal_log_ai_usage", {
      p_id: createUuidV7(),
      p_service: "portal.knowledge_embedding",
      p_input_tokens: inputTokens,
      p_output_tokens: 0,
    });
    if (logError) {
      console.error("portal_log_ai_usage failed", logError.message);
    }
    return null;
  } catch (embedError) {
    console.error("knowledge ingestion failed", embedError instanceof Error ? embedError.message : embedError);
    return "o provider de embeddings falhou.";
  }
}

/** Atualiza o conteúdo de uma fonte existente: re-ingestão substitui a versão anterior. */
export async function updateKnowledgeSourceContent(
  _prevState: ResourceActionState,
  formData: FormData,
): Promise<ResourceActionState> {
  const sourceId = String(formData.get("source_id") ?? "").trim();
  const content = String(formData.get("content") ?? "").trim();

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sourceId)) {
    return { error: "Fonte inválida — recarregue a página.", done: false };
  }
  if (content.length === 0 || content.length > MAX_CONTENT_CHARS) {
    return { error: `O conteúdo precisa ter entre 1 e ${MAX_CONTENT_CHARS.toLocaleString("pt-BR")} caracteres.`, done: false };
  }
  if ((process.env.OPENROUTER_API_KEY ?? "").trim().length === 0) {
    return { error: "O provider de embeddings ainda não está configurado neste ambiente.", done: false };
  }

  const supabase = await createClient();
  const ingestError = await ingestContentForSource(supabase, sourceId, content);
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
  const { error } = await supabase.rpc("portal_set_agent_status", {
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

  // Notificação por e-mail (T9): melhor esforço, nunca desfaz a ativação já
  // aplicada. Só na ativação (não na pausa) — é a mudança que afeta clientes.
  if (status === "active") {
    try {
      const [overview, agents, adminEmailsResult] = await Promise.all([
        fetchTenantOverview(),
        fetchAgents(),
        supabase.rpc("portal_list_admin_emails"),
      ]);
      const agent = agents.find((candidate) => candidate.id === agentId);
      const admins = (adminEmailsResult.data ?? []) as string[];
      if (agent && overview.tenant && admins.length > 0) {
        await sendAgentActivatedEmail({
          to: admins,
          workspaceName: overview.tenant.legal_name,
          agentName: agent.name,
        });
      }
    } catch (notifyError) {
      console.error(JSON.stringify({
        event: "agent_activated_email_failed",
        error: notifyError instanceof Error ? notifyError.name : "unknown",
      }));
    }
  }

  revalidatePath("/agentes");
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
