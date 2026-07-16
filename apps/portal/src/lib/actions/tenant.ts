"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

export interface TenantProfileActionState {
  readonly error: string | null;
  readonly saved: boolean;
}

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
    return { error: "Idioma inválido — use o formato pt-BR.", saved: false };
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
  if (error) return { error: `Não foi possível salvar: ${error.message}`, saved: false };

  revalidatePath("/configuracoes");
  revalidatePath("/dashboard");
  return { error: null, saved: true };
}
