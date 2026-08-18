// Módulo exclusivo de servidor (importado apenas por server actions).
// A criação de persona Tavus é um efeito externo potencialmente pago e não
// pode ser disparada pelo fluxo best-effort de ativação de agente. Até existir
// uma intent/reserva específica, a plataforma provisiona personas reais pelo
// fluxo governado de onboarding, não por retry de Server Action.
import type { createClient } from "@/lib/supabase/server";
import { logError as trackError, logEvent } from "@/lib/telemetry";
import { resolveAgentVideoConfig } from "@/lib/video-config";

export interface ProvisionResult {
  readonly provisioned: boolean;
  readonly personaId?: string;
  /**
   * true quando o agente ainda exige atenção de vídeo. Distingue uma config
   * existente de uma configuração ausente ou de uma auto-provisão bloqueada.
   */
  readonly attempted?: boolean;
  /** A persona real exige o fluxo durável de onboarding, não esta action. */
  readonly blockedByGovernance?: boolean;
}

/**
 * Confere se o agente já possui persona e falha fechada para auto-provisão
 * real. A ativação continua disponível para o chat; apenas o gasto externo
 * fica retido até haver uma reserva durável própria para personas.
 */
export async function provisionAgentVideoIfMissing(
  supabase: Awaited<ReturnType<typeof createClient>>,
  agent: { readonly id: string; readonly name: string },
  _tenantName: string,
  _tenantDefaultLanguage: string,
): Promise<ProvisionResult> {
  if (process.env.PORTAL_FAKE_PROVIDERS === "1") return { provisioned: false };

  // Falha de leitura não é "não configurado": prosseguir poderia sobrescrever
  // uma persona curada manualmente. Não há efeito de provider neste caminho.
  const configResult = await resolveAgentVideoConfig(supabase, agent.id, "auto-provision");
  if (!configResult.ok) return { provisioned: false, attempted: true };
  if (configResult.config.configured) return { provisioned: false };

  const tavusApiKey = (process.env.TAVUS_API_KEY ?? "").trim();
  const replicaId = (process.env.TAVUS_REPLICA_ID ?? "").trim();
  if (tavusApiKey.length === 0 || replicaId.length === 0) {
    trackError("agent_video_autoprovision_config_missing", new Error("TAVUS_API_KEY or TAVUS_REPLICA_ID not configured"), { agent_id: agent.id });
    return { provisioned: false, attempted: true };
  }

  logEvent("agent_video_autoprovision_blocked", { agent_id: agent.id, reason: "durable_persona_intent_required" });
  return { provisioned: false, attempted: true, blockedByGovernance: true };
}
