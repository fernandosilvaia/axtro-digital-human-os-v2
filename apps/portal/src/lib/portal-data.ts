import { cache } from "react";

import { ensureTenantProvisioned } from "@/lib/actions/provisioning";
import { createClient } from "@/lib/supabase/server";

export interface TenantSummary {
  readonly id: string;
  readonly slug: string;
  readonly legal_name: string;
  readonly status: string;
  readonly home_region: string;
  readonly default_language: string;
  readonly default_timezone: string;
  readonly created_at: string;
}

export interface TenantOverview {
  readonly provisioned: boolean;
  readonly tenant?: TenantSummary;
  readonly role?: string;
  readonly counts?: {
    readonly agents: number;
    readonly sessions: number;
    readonly knowledge_sources: number;
    readonly contacts: number;
  };
}

export interface AgentRow {
  readonly id: string;
  readonly name: string;
  readonly role_type: string;
  readonly status: string;
  readonly created_at: string;
}

export interface KnowledgeSourceRow {
  readonly id: string;
  readonly display_name: string;
  readonly source_type: string;
  readonly data_classification: string;
  readonly status: string;
  readonly created_at: string;
}

/**
 * Deduped per request: the shell layout and every page share one call. The
 * App Router renders layout and page concurrently, so provisioning lives
 * here (not in the layout) — the first caller provisions, everyone else
 * awaits the same promise and sees the provisioned tenant.
 */
export const fetchTenantOverview = cache(async (): Promise<TenantOverview> => {
  const supabase = await createClient();

  let overview = await rpcOverview(supabase);
  if (!overview.provisioned) {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await ensureTenantProvisioned(supabase, user);
      overview = await rpcOverview(supabase);
    }
  }
  return overview;
});

async function rpcOverview(supabase: Awaited<ReturnType<typeof createClient>>): Promise<TenantOverview> {
  const { data, error } = await supabase.rpc("portal_tenant_overview");
  if (error) throw new Error(`overview fetch failed: ${error.message}`);
  return data as TenantOverview;
}

export async function fetchAgents(): Promise<readonly AgentRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("portal_list_agents");
  if (error) throw new Error(`agents fetch failed: ${error.message}`);
  return (data ?? []) as AgentRow[];
}

export async function fetchKnowledgeSources(): Promise<readonly KnowledgeSourceRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("portal_list_knowledge_sources");
  if (error) throw new Error(`knowledge fetch failed: ${error.message}`);
  return (data ?? []) as KnowledgeSourceRow[];
}

export interface UsageServiceRow {
  readonly service: string;
  readonly unit_type: string;
  readonly quantity: number;
  readonly amount_usd: number;
}

export interface UsageSummary {
  readonly tokens_today: number;
  readonly conversations_today: number;
  /** Custo real de IA (tokens), calculado com preço público de tabela — ver T8/D-V2-077. */
  readonly ai_cost_usd_today: number;
  /** Piso mínimo de vídeo (duração real não é capturada; nunca é o custo exato). */
  readonly video_cost_floor_usd_today: number;
  readonly ai_cost_usd_7d: number;
  readonly video_cost_floor_usd_7d: number;
  readonly cost_estimate_note: string;
  readonly services_7d: readonly UsageServiceRow[];
}

export async function fetchUsageSummary(): Promise<UsageSummary> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("portal_usage_summary");
  if (error) throw new Error(`usage fetch failed: ${error.message}`);
  return data as UsageSummary;
}

export interface TeamMemberRow {
  readonly email: string;
  readonly role: string;
  readonly joined_at: string;
  readonly is_you: boolean;
}

export interface TeamInviteRow {
  readonly id: string;
  readonly email: string;
  readonly role: string;
  readonly created_at: string;
}

export interface TeamOverview {
  readonly members: readonly TeamMemberRow[];
  readonly invites: readonly TeamInviteRow[];
}

export async function fetchTeam(): Promise<TeamOverview> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("portal_list_team");
  if (error) throw new Error(`team fetch failed: ${error.message}`);
  return data as TeamOverview;
}
