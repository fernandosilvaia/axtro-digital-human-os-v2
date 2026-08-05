"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export interface AuthActionState {
  readonly error: string | null;
}

// O Supabase Auth responde em inglês ("Invalid login credentials") — as telas
// de maior tráfego do produto não podem destoar do resto da UI em pt-BR.
// Mapeamento por código quando existir, com fallback por trecho da mensagem
// (mesmo padrão de dicionário de resources.ts/team.ts).
function authErrorMessage(error: { code?: string | undefined; message: string }, surface: "signin" | "signup"): string {
  const code = error.code ?? "";
  const message = error.message.toLowerCase();
  if (code === "invalid_credentials" || message.includes("invalid login credentials")) {
    return "E-mail ou senha incorretos.";
  }
  if (code === "email_not_confirmed" || message.includes("not confirmed")) {
    return "Confirme seu e-mail antes de entrar — enviamos um link na criação da conta.";
  }
  if (code === "over_email_send_rate_limit" || code === "over_request_rate_limit" || message.includes("rate limit")) {
    return "Muitas tentativas em sequência. Aguarde um minuto e tente de novo.";
  }
  if (code === "weak_password" || message.includes("password should be")) {
    return "A senha precisa ter pelo menos 8 caracteres.";
  }
  if (code === "user_already_exists" || message.includes("already registered")) {
    return "Já existe uma conta com esse e-mail — entre por /login ou recupere a senha.";
  }
  if (code === "validation_failed" || message.includes("invalid format") || message.includes("is invalid")) {
    return "E-mail em formato inválido.";
  }
  return surface === "signin"
    ? "Não foi possível entrar agora. Confira os dados e tente novamente."
    : "Não foi possível criar a conta agora. Tente novamente em instantes.";
}

export async function signIn(_prevState: AuthActionState, formData: FormData): Promise<AuthActionState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: authErrorMessage(error, "signin") };

  redirect("/dashboard");
}

export async function signUp(_prevState: AuthActionState, formData: FormData): Promise<AuthActionState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({ email, password });
  if (error) return { error: authErrorMessage(error, "signup") };

  redirect("/login?confirm=1");
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export interface PasswordResetRequestState {
  readonly error: string | null;
  readonly sent: boolean;
}

export async function requestPasswordReset(
  _prevState: PasswordResetRequestState,
  formData: FormData,
): Promise<PasswordResetRequestState> {
  const email = String(formData.get("email") ?? "").trim();
  if (email.length === 0) return { error: "Informe seu e-mail.", sent: false };

  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "http";
  if (!host) return { error: "Não foi possível montar o link de recuperação.", sent: false };

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${protocol}://${host}/auth/callback?next=/nova-senha`,
  });
  // Resposta idêntica para e-mail existente ou não: nunca revelar se a conta existe.
  if (error && error.status !== 429) {
    return { error: "Não foi possível enviar o e-mail agora. Tente novamente em instantes.", sent: false };
  }
  return { error: null, sent: true };
}

export interface UpdatePasswordState {
  readonly error: string | null;
}

export async function updatePassword(
  _prevState: UpdatePasswordState,
  formData: FormData,
): Promise<UpdatePasswordState> {
  const password = String(formData.get("password") ?? "");
  const confirmation = String(formData.get("password_confirmation") ?? "");

  if (password.length < 8) return { error: "A senha precisa ter pelo menos 8 caracteres." };
  if (password !== confirmation) return { error: "As senhas não coincidem." };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: "Não foi possível atualizar a senha agora. Tente novamente; se persistir, peça um novo link de recuperação." };

  redirect("/dashboard");
}
