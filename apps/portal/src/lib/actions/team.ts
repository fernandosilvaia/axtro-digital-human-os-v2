"use server";

import { revalidatePath } from "next/cache";

import { sendInviteEmail } from "@/lib/email";
import { fetchTenantOverview } from "@/lib/portal-data";
import { createClient } from "@/lib/supabase/server";

export interface TeamActionState {
  readonly error: string | null;
  readonly done: boolean;
  /** true quando o e-mail de convite foi de fato enviado ao convidado. */
  readonly emailSent?: boolean;
}

const INVITE_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  "there is already a pending invite for this email": "Já existe um convite pendente para esse e-mail.",
  "this email already belongs to an account with a workspace": "Esse e-mail já pertence a uma conta com espaço próprio.",
  "you cannot invite yourself": "Você não pode convidar a si mesmo.",
  "only a tenant_admin can invite members": "Somente administradores podem convidar membros.",
  "invalid email": "E-mail inválido.",
  "invalid role": "Papel inválido.",
  "daily invite limit reached for this account": "Limite diário de convites da conta atingido. Tente novamente amanhã.",
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

  // Notificação por e-mail (T2): melhor esforço — o convite já está válido no
  // banco; falha de e-mail nunca o desfaz, só muda a mensagem de sucesso.
  let emailSent = false;
  try {
    const overview = await fetchTenantOverview();
    const result = await sendInviteEmail({
      to: email,
      workspaceName: overview.tenant?.legal_name ?? "Axtro Digital Human OS",
      role,
    });
    emailSent = result.sent;
  } catch (emailError) {
    console.error(JSON.stringify({
      event: "invite_email_failed",
      error: emailError instanceof Error ? emailError.name : "unknown",
    }));
  }

  revalidatePath("/configuracoes");
  return { error: null, done: true, emailSent };
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
