"use server";

import { revalidatePath } from "next/cache";

import { sendInviteEmail } from "@/lib/email";
import { fetchTenantOverview } from "@/lib/portal-data";
import { createClient } from "@/lib/supabase/server";
import { logError as trackError } from "@/lib/telemetry";

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
    trackError("invite_email_failed", emailError);
  }

  revalidatePath("/configuracoes");
  return { error: null, done: true, emailSent };
}

const REVOKE_INVITE_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  "only a tenant_admin can revoke invites": "Somente administradores podem revogar convites.",
  "invite not found or not pending": "Esse convite já foi aceito ou revogado em outro lugar.",
};

export interface RevokeInviteState {
  readonly error: string | null;
}

/**
 * Achado D-V2-109 (auditoria 2026-08-11): o botão "Revogar" chamava esta
 * action via `<form action>` sem feedback nenhum — sem estado de
 * carregamento, e um erro real (RPC fora do ar, RLS) ficava mudo pro admin,
 * inconsistente com removeMember/MemberRemoveButton no mesmo arquivo.
 * Mesmo padrão dos dois agora: recebe o id direto, devolve {error}.
 */
export async function revokeInvite(inviteId: string): Promise<RevokeInviteState> {
  if (inviteId.length === 0) return { error: "Convite inválido." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("portal_revoke_invite", { p_invite_id: inviteId });
  if (error) {
    return { error: REVOKE_INVITE_ERROR_MESSAGES[error.message] ?? `Não foi possível revogar: ${error.message}` };
  }

  revalidatePath("/configuracoes");
  return { error: null };
}

const REMOVE_MEMBER_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  "only a tenant_admin can remove members": "Somente administradores podem remover membros.",
  "use sign out to remove yourself": "Você não pode remover a si mesmo — use \"Sair da conta\".",
  "member not found in this account": "Esse membro não está mais nesta conta.",
  "cannot remove the last administrator of the account": "Não é possível remover o último administrador da conta.",
};

export interface RemoveMemberState {
  readonly error: string | null;
}

/**
 * Revoga o acesso de um membro já aceito na equipe (achado da auditoria
 * 2026-08-06: só existia "Revogar" pra convite pendente — um colaborador
 * desligado ficava sem forma de perder acesso pelo portal). A RPC garante
 * tenant_admin, escopo por tenant e nunca deixa a conta sem administrador.
 */
export async function removeMember(userId: string): Promise<RemoveMemberState> {
  if (userId.length === 0) return { error: "Membro inválido." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("portal_remove_member", { p_user_id: userId });
  if (error) {
    return { error: REMOVE_MEMBER_ERROR_MESSAGES[error.message] ?? `Não foi possível remover: ${error.message}` };
  }

  revalidatePath("/configuracoes");
  return { error: null };
}
