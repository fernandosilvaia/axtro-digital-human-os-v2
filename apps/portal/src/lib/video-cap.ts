// Módulo exclusivo de servidor: teto diário de conversas de vídeo por tenant.
// Cada conversa Tavus custa dinheiro real por minuto — antes de abrir o
// produto a usuários, o teto fecha o buraco de custo (o de tokens já existia
// desde D-V2-064; vídeo não tinha nenhum). Falha fechada: se a leitura de
// uso falhar, a conversa NÃO abre — mesma disciplina do cap de tokens.
import type { createClient } from "@/lib/supabase/server";
import { logError as trackError } from "@/lib/telemetry";

export const DAILY_VIDEO_CONVERSATION_CAP = 20;

export const VIDEO_CAP_MESSAGE =
  "A conta atingiu o limite diário de conversas de vídeo. Volte amanhã ou fale com o suporte para ampliar o plano.";

export const VIDEO_CAP_CHECK_FAILED_MESSAGE =
  "Não foi possível verificar o uso de vídeo da conta. Tente novamente.";

export type VideoCapVerdict = "allowed" | "capped" | "check_failed";

export async function checkVideoCap(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<VideoCapVerdict> {
  const { data, error } = await supabase.rpc("portal_usage_summary");
  if (error) {
    trackError("video_cap_check_failed", error);
    return "check_failed";
  }
  const conversationsToday = Number((data as { conversations_today?: number })?.conversations_today ?? 0);
  return conversationsToday >= DAILY_VIDEO_CONVERSATION_CAP ? "capped" : "allowed";
}
