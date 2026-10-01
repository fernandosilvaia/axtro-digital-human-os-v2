"use server";

import { createClient } from "@/lib/supabase/server";

/** Edits preferences of an existing binding. Asset assignment is platform-governed. */

export interface VideoConfigActionState {
  readonly error: string | null;
}

export interface VideoConfigStatus {
  readonly configured: boolean;
  readonly personaId: string | null;
  readonly replicaId: string | null;
  readonly language: string | null;
  readonly spokenLanguages: readonly string[] | null;
  readonly closerVertical: string | null;
}

function mapRpcError(message: string): string {
  if (message.includes("video asset assignment requires governed provisioning")) {
    return "A vinculação de persona e réplica exige provisionamento aprovado pela plataforma.";
  }
  if (message.includes("authentication required")) {
    return "Sua sessão expirou. Recarregue a página e entre de novo.";
  }
  if (message.includes("only a tenant_admin")) {
    return "Somente administradores podem configurar o vídeo deste agente.";
  }
  if (message.includes("agent not found")) {
    return "Agente não encontrado nesta conta.";
  }
  if (message.includes("persona_id must be")) {
    return "O ID da persona Tavus é inválido (esperado um id simples, sem prefixo).";
  }
  if (message.includes("replica_id must be")) {
    return "O ID da réplica Tavus é inválido (esperado um id simples, sem prefixo).";
  }
  if (message.includes("language must be")) {
    return "Idioma de abertura inválido.";
  }
  if (message.includes("closer_vertical not recognized")) {
    return "Vertical não reconhecida.";
  }
  if (message.includes("spoken_languages must have")) {
    return "Os idiomas reconhecidos precisam incluir o idioma de abertura, sem repetição, entre 1 e 3.";
  }
  return `Não foi possível salvar a configuração de vídeo: ${message}`;
}

export async function setAgentVideoConfig(
  agentId: string,
  input: {
    readonly language: string;
    readonly spokenLanguages: readonly string[] | null;
    readonly closerVertical: string;
  },
): Promise<VideoConfigActionState> {
  const supabase = await createClient();
  const { data, error: readError } = await supabase.rpc("portal_agent_video_config", { p_agent_id: agentId });
  if (readError) return { error: "Não foi possível ler a configuração de vídeo. Tente novamente." };
  if (data === null || typeof data !== "object" || data.configured !== true) {
    return { error: "Vídeo não configurado. Solicite o onboarding governado da persona e réplica." };
  }
  // Asset identities come from authenticated same-tenant state, never browser input.
  const personaId = typeof data.persona_id === "string" ? data.persona_id : null;
  const replicaId = typeof data.replica_id === "string" ? data.replica_id : null;
  if (personaId === null && replicaId === null) {
    return { error: "Vídeo não configurado. Solicite o onboarding governado da persona e réplica." };
  }
  const { error } = await supabase.rpc("portal_set_agent_video_config", {
    p_agent_id: agentId,
    p_persona_id: personaId,
    p_replica_id: replicaId,
    p_language: input.language,
    p_spoken_languages: input.spokenLanguages,
    p_closer_vertical: input.closerVertical,
  });
  if (error) {
    return { error: mapRpcError(error.message) };
  }
  return { error: null };
}

export async function fetchAgentVideoConfigStatus(agentId: string): Promise<VideoConfigStatus> {
  const empty: VideoConfigStatus = {
    configured: false,
    personaId: null,
    replicaId: null,
    language: null,
    spokenLanguages: null,
    closerVertical: null,
  };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("portal_agent_video_config", { p_agent_id: agentId });
  if (error || data === null || typeof data !== "object") return empty;
  const record = data as {
    configured?: boolean;
    persona_id?: string | null;
    replica_id?: string | null;
    language?: string | null;
    spoken_languages?: readonly string[] | null;
    closer_vertical?: string | null;
  };
  if (record.configured !== true) return empty;
  return {
    configured: true,
    personaId: typeof record.persona_id === "string" ? record.persona_id : null,
    replicaId: typeof record.replica_id === "string" ? record.replica_id : null,
    language: typeof record.language === "string" ? record.language : null,
    spokenLanguages: Array.isArray(record.spoken_languages) ? record.spoken_languages : null,
    closerVertical: typeof record.closer_vertical === "string" ? record.closer_vertical : null,
  };
}
