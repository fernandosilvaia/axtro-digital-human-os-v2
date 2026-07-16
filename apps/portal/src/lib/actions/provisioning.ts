import { createUuidV7 } from "@axtro/domain";
import type { SupabaseClient, User } from "@supabase/supabase-js";

export interface ProvisionedTenant {
  readonly tenantId: string;
}

export async function ensureTenantProvisioned(
  supabase: SupabaseClient,
  user: User,
): Promise<ProvisionedTenant> {
  const tenantId = createUuidV7();
  const actorId = createUuidV7();
  const slug = `tenant-${tenantId.slice(0, 8)}`;
  const legalName = user.email ? `Conta de ${user.email}` : "Nova conta";

  const { data, error } = await supabase.rpc("provision_self_serve_tenant", {
    p_tenant_id: tenantId,
    p_actor_id: actorId,
    p_slug: slug,
    p_legal_name: legalName,
    p_home_region: "us-east-1",
    p_default_language: "pt-BR",
    p_default_timezone: "America/Sao_Paulo",
  });

  if (error) throw new Error(`tenant provisioning failed: ${error.message}`);

  return { tenantId: data as string };
}
