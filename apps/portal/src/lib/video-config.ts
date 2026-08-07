// Módulo exclusivo de servidor: leitura padronizada de portal_agent_video_config.
//
// Existe porque o MESMO bug ("erro de leitura da RPC virou silenciosamente
// 'agente sem persona configurada'") foi corrigido em 4 call sites
// diferentes (video-conversation.ts x2, meeting-bot.ts, agent-video.ts) ao
// longo de duas rodadas de auditoria (2026-08-02 e 2026-08-06) — a correção
// não se propagava porque a lógica estava copiada, não compartilhada. Um
// quinto call site futuro reintroduziria a mesma classe de bug sem este
// helper único.
import type { createClient } from "./supabase/server.ts";
import { logError as trackError } from "./telemetry.ts";

export interface AgentVideoConfigRow {
  readonly configured: boolean;
  readonly persona_id?: string | null;
  readonly replica_id?: string | null;
  readonly language?: string | null;
  /** "platform" = apresenta a própria Axtro; "sales" (padrão) = vende o negócio do tenant (0020). */
  readonly presentation_kind?: "sales" | "platform" | null;
}

export type AgentVideoConfigResult =
  | { readonly ok: true; readonly config: AgentVideoConfigRow }
  | { readonly ok: false; readonly error: string };

/**
 * Falha de LEITURA nunca vira "não configurado" — isso abriria a call com
 * réplica/contexto genérico (degradação não declarada, Art. 14/16) ou, na
 * auto-provisão, criaria uma persona duplicada por cima de uma curada à mão.
 */
export async function resolveAgentVideoConfig(
  supabase: Awaited<ReturnType<typeof createClient>>,
  agentId: string,
  mode: string,
): Promise<AgentVideoConfigResult> {
  const { data, error } = await supabase.rpc("portal_agent_video_config", { p_agent_id: agentId });
  if (error) {
    trackError("portal_agent_video_config_failed", error, { agent_id: agentId, mode });
    return { ok: false, error: "Não foi possível ler a configuração de vídeo do agente. Tente novamente." };
  }
  return { ok: true, config: (data ?? { configured: false }) as AgentVideoConfigRow };
}

/**
 * Digest de conhecimento pro contexto da call. Falha aqui SEMPRE degrada
 * pra chamada sem digest — nunca bloqueia o vídeo (diferente da config,
 * que é sobre QUEM a agente é; o digest é só o que ela sabe agora).
 */
export async function fetchKnowledgeDigest(
  supabase: Awaited<ReturnType<typeof createClient>>,
  agentId: string,
  mode: string,
  maxChars: number,
): Promise<string | null> {
  try {
    const { data, error } = await supabase.rpc("portal_knowledge_digest", { p_max_chars: maxChars });
    if (error) {
      trackError("portal_knowledge_digest_failed", error, { agent_id: agentId, mode });
      return null;
    }
    const digest = (data ?? {}) as { content?: string | null };
    return typeof digest.content === "string" && digest.content.length > 0 ? digest.content : null;
  } catch (unexpected) {
    trackError("portal_knowledge_digest_failed", unexpected, { agent_id: agentId, mode });
    return null;
  }
}
