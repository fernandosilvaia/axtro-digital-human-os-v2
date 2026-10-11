"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { logError as trackError } from "@/lib/telemetry";

export interface TenantProfileActionState {
  readonly error: string | null;
  readonly saved: boolean;
}

// Mesmo padrão de INVITE_ERROR_MESSAGES (team.ts): sem isso, erro de RPC
// aparecia cru em inglês ("only a tenant_admin can edit the tenant profile")
// na única tela de perfil da conta (achado da auditoria 2026-08-06).
const PROFILE_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  "authentication required": "Sessão expirada. Recarregue a página e entre novamente.",
  "no tenant provisioned": "Sua conta ainda não terminou de ser provisionada.",
  "only a tenant_admin can edit the tenant profile": "Somente administradores podem editar o perfil da conta.",
};

// Erro de banco sem tradução conhecida nunca vai cru pro cliente.
const UNEXPECTED_ERROR_MESSAGE = "Não foi possível concluir agora. Tente de novo em instantes; se continuar, fale com o suporte.";

export async function updateTenantProfile(
  _prevState: TenantProfileActionState,
  formData: FormData,
): Promise<TenantProfileActionState> {
  const legalName = String(formData.get("legal_name") ?? "").trim();
  const defaultLanguage = String(formData.get("default_language") ?? "").trim();
  const defaultTimezone = String(formData.get("default_timezone") ?? "").trim();

  if (legalName.length === 0 || legalName.length > 200) {
    return { error: "O nome da conta precisa ter entre 1 e 200 caracteres.", saved: false };
  }
  if (!/^[a-z]{2}-[A-Z]{2}$/.test(defaultLanguage)) {
    return { error: "Idioma inválido. Use o formato pt-BR.", saved: false };
  }
  if (defaultTimezone.length === 0 || defaultTimezone.length > 64) {
    return { error: "Fuso horário inválido.", saved: false };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("portal_update_tenant_profile", {
    p_legal_name: legalName,
    p_default_language: defaultLanguage,
    p_default_timezone: defaultTimezone,
  });
  if (error) {
    const known = PROFILE_ERROR_MESSAGES[error.message];
    // Recusa esperada já tem tradução; só o erro desconhecido vira telemetria.
    if (!known) trackError("update_tenant_profile_failed", new Error(error.message), {});
    return { error: known ?? UNEXPECTED_ERROR_MESSAGE, saved: false };
  }

  revalidatePath("/configuracoes");
  revalidatePath("/dashboard");
  return { error: null, saved: true };
}
