"use server";

import { revalidatePath } from "next/cache";

import { createUuidV7 } from "@axtro/domain";

import { chunkContent, contentSha256, embedChunks, MAX_CONTENT_CHARS } from "@/lib/knowledge";
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
    try {
      const texts = chunkContent(content);
      const { chunks, inputTokens } = await embedChunks(process.env.OPENROUTER_API_KEY ?? "", texts);
      const { error: ingestError } = await supabase.rpc("portal_ingest_knowledge", {
        p_source_id: sourceId,
        p_version_id: createUuidV7(),
        p_version: "v1",
        p_content_hash: contentSha256(content),
        p_chunks: chunks,
      });
      if (ingestError) {
        return {
          error: `A fonte foi registrada, mas a ingestão falhou (${ingestError.message}). Ela segue pendente — tente de novo com o mesmo nome mais tarde.`,
          done: false,
        };
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
    } catch (embedError) {
      console.error("knowledge ingestion failed", embedError instanceof Error ? embedError.message : embedError);
      return {
        error: "A fonte foi registrada, mas o provider de embeddings falhou. Ela segue pendente — tente novamente em instantes.",
        done: false,
      };
    }
  }

  revalidatePath("/conhecimento");
  revalidatePath("/dashboard");
  return { error: null, done: true };
}
