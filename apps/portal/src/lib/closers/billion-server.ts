/**
 * Pontos do servidor que as três rotas da closer da Billion compartilham (ADR-051): a chave de
 * liga/desliga, o agente fixado por env e a leitura do agente no banco. Nada vindo do painel do
 * CRM escolhe agente, tenant ou doutrina.
 */
import { createServiceRoleClient } from "@/lib/supabase/service";
import type { BillionAgentRecord } from "./billion-chat.ts";

/** O canal nasce desligado. Ligar antes do recibo durável do aviso (migração 0079) é decisão do dono. */
export function billionCloserEnabled(env: Readonly<Record<string, string | undefined>>): boolean {
  return env.BILLION_CLOSER_ENABLED === "true";
}

export interface ResolvedBillionAgent extends BillionAgentRecord {
  readonly personaId: string | null;
}

export async function resolveBillionAgent(env: Readonly<Record<string, string | undefined>>): Promise<ResolvedBillionAgent | null> {
  const agentId = (env.BILLION_CLOSER_AGENT_ID ?? "").trim();
  if (agentId.length === 0) return null;
  const supabase = createServiceRoleClient();
  const { data: agent } = await supabase.from("agents").select("name, tenant_id, status").eq("id", agentId).maybeSingle();
  if (agent === null || agent.status !== "active" || typeof agent.name !== "string" || typeof agent.tenant_id !== "string") return null;
  const { data: tenant } = await supabase.from("tenants").select("legal_name").eq("id", agent.tenant_id).maybeSingle();
  const { data: video } = await supabase
    .from("agent_video_config")
    .select("tavus_persona_id")
    .eq("tenant_id", agent.tenant_id)
    .eq("agent_id", agentId)
    .maybeSingle();
  return {
    tenantId: agent.tenant_id,
    agentId,
    agentName: agent.name,
    tenantName: typeof tenant?.legal_name === "string" ? tenant.legal_name : "Billion Leads Pro",
    personaId: typeof video?.tavus_persona_id === "string" ? video.tavus_persona_id : null,
  };
}
