"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

export interface TeamActionState {
  readonly error: string | null;
  readonly done: boolean;
}

const INVITE_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  "there is already a pending invite for this email": "Já existe um convite pendente para esse e-mail.",
  "this email already belongs to an account with a workspace": "Esse e-mail já pertence a uma conta com espaço próprio.",
  "you cannot invite yourself": "Você não pode convidar a si mesmo.",
  "only a tenant_admin can invite members": "Somente administradores podem convidar membros.",
  "invalid email": "E-mail inválido.",
  "invalid role": "Papel inválido.",
};

export async function inviteMember(_prevState: TeamActionState, formData: FormData): Promise<TeamActionState> {
  const email = String(formData.get("email") ?? "").trim();
  const role = String(formData.get("role") ?? "");

  if (email.length === 0) return { error: "Informe o e-mail do convidado.", done: false };
  if (role !== "tenant_admin" && role !== "tenant_operator") {
    return { error: "Papel inválido.", done: false };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("portal_invite_member", { p_email: email, p_role: role });
  if (error) {
    return { error: INVITE_ERROR_MESSAGES[error.message] ?? `Não foi possível convidar: ${error.message}`, done: false };
  }

  revalidatePath("/configuracoes");
  return { error: null, done: true };
}

export async function revokeInvite(formData: FormData): Promise<void> {
  const inviteId = String(formData.get("invite_id") ?? "");
  if (inviteId.length === 0) return;

  const supabase = await createClient();
  // Erro aqui (convite já aceito/revogado em outra aba) não é fatal: o
  // revalidate abaixo re-renderiza a lista com o estado real.
  await supabase.rpc("portal_revoke_invite", { p_invite_id: inviteId });
  revalidatePath("/configuracoes");
}
