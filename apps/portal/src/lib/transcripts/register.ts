/**
 * Glue compartilhada de histórico de conversa (D-V2-106) entre os 3 pontos
 * de integração (chat sandbox, vídeo/apresentação, reunião externa):
 * placeholder criado no momento em que a conversa nasce (contexto
 * autenticado, tenant conhecido de verdade) — os webhooks do Tavus/Recall
 * só PREENCHEM `turns` depois, nunca criam a linha (Art. 9: um webhook
 * externo não é fonte confiável de qual tenant é dono da conversa).
 */
import { createUuidV7 } from "@axtro/domain";

import type { createClient } from "../supabase/server.ts";
import { logError as trackError } from "../telemetry.ts";

export type TranscriptSurface = "chat" | "video" | "meeting";

/**
 * URL do callback de transcrição da Tavus — undefined quando
 * TAVUS_WEBHOOK_TOKEN não está configurada (nunca expõe o endpoint sem um
 * token pra proteger; a conversa acontece normalmente sem histórico
 * registrado, degradação declarada — Art. 14).
 */
export function tavusWebhookCallbackUrl(): string | undefined {
  const token = (process.env.TAVUS_WEBHOOK_TOKEN ?? "").trim();
  if (token.length === 0) return undefined;
  const base = (process.env.PORTAL_PUBLIC_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? "https://portal-production-b43e.up.railway.app").replace(/\/$/, "");
  return `${base}/api/tavus/webhook?token=${encodeURIComponent(token)}`;
}

/**
 * Registra o placeholder (turns=[]) assim que a conversa/bot nasce.
 * Best-effort: nunca bloqueia nem atrasa a conversa em si — falha vira
 * telemetria; sem o placeholder, o webhook mais tarde só não vai achar a
 * linha (found=false, também telemetrado lá) e a conversa simplesmente
 * fica sem histórico registrado, nunca um erro visível pro usuário.
 */
export async function registerTranscriptPlaceholder(
  supabase: Awaited<ReturnType<typeof createClient>>,
  agentId: string,
  surface: TranscriptSurface,
  externalRef: string,
): Promise<void> {
  try {
    const { error } = await supabase.rpc("portal_upsert_conversation_transcript", {
      p_id: createUuidV7(),
      p_agent_id: agentId,
      p_surface: surface,
      p_external_ref: externalRef,
      p_turns: [],
    });
    if (error) {
      trackError("transcript_placeholder_register_failed", error, { agent_id: agentId, surface, external_ref: externalRef });
    }
  } catch (error) {
    trackError("transcript_placeholder_register_failed", error, { agent_id: agentId, surface, external_ref: externalRef });
  }
}
