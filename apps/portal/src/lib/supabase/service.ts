import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Client de service role — ÚNICO lugar do portal com acesso que ignora RLS.
 * Uso restrito a caminhos servidor-a-servidor sem sessão de usuário (M4-04:
 * o Tavus chamando nosso endpoint de LLM), onde não existe `auth.uid()` para
 * as RPCs `portal_*` resolverem. Todo chamador deve filtrar por tenant_id
 * explicitamente — este client não tem a rede de segurança da RLS por trás
 * (Constituição Art. 9: isolamento de tenant é controle de segurança, não
 * conveniência).
 *
 * Falha fechada: sem `SUPABASE_SERVICE_ROLE_KEY` configurada, lança em vez
 * de silenciosamente cair para a chave publicável (que não teria permissão
 * nenhuma de qualquer forma, mas o erro claro aqui poupa um debug confuso).
 */
export class ServiceRoleUnavailableError extends Error {
  constructor() {
    super("SUPABASE_SERVICE_ROLE_KEY is not configured in this environment");
    this.name = "ServiceRoleUnavailableError";
  }
}

let cached: SupabaseClient | null = null;

export function createServiceRoleClient(): SupabaseClient {
  if (cached !== null) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (url.trim().length === 0 || serviceRoleKey.trim().length === 0) {
    throw new ServiceRoleUnavailableError();
  }
  cached = createSupabaseClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return cached;
}
