"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { isRateLimited } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

export interface AuthActionState {
  readonly error: string | null;
}

const RATE_LIMIT_MESSAGE = "Muitas tentativas em sequência. Aguarde um pouco e tente de novo.";

/**
 * Teto de app pra criação de contas por IP (achado P1 confirmado, auditoria
 * 2026-08-12): sem isto, um script com um domínio catch-all cria contas fake
 * ilimitadas, cada uma ativando um agente que provisiona uma persona de
 * vídeo REAL na Tavus automaticamente e gera custo real sem exigir cartão.
 * 5/hora é folga generosa pra qualquer usuário legítimo (mesmo reentrando
 * com typo) e ainda corta um loop de script na mesma origem. Não impede um
 * atacante trocando de IP — é defesa em profundidade, não a barreira única;
 * o teto duro de gasto é BILLING_TRIAL_LIMIT_ENABLED (billing/plans.ts).
 */
const SIGNUP_RATE_LIMIT_WINDOW_MS = 60 * 60_000;
const SIGNUP_RATE_LIMIT_MAX = 5;

/** Credential stuffing em /login: 10 tentativas/min por IP é folga generosa pra erro de digitação humano. */
const SIGNIN_RATE_LIMIT_WINDOW_MS = 60_000;
const SIGNIN_RATE_LIMIT_MAX = 10;

async function clientIp(): Promise<string> {
  const requestHeaders = await headers();
  const forwardedFor = requestHeaders.get("x-forwarded-for");
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) return first;
  }
  return requestHeaders.get("x-real-ip") ?? "unknown";
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
  if (code === "validation_failed" || message.includes("invalid format") || message.includes("is invalid")) {
    return "E-mail em formato inválido.";
  }
  return surface === "signin"
    ? "Não foi possível entrar agora. Confira os dados e tente novamente."
    : "Não foi possível criar a conta agora. Tente novamente em instantes.";
}

/**
 * user_already_exists precisa de tratamento à parte de authErrorMessage()
 * (nunca vira texto exibido): revelar "já existe conta com esse e-mail" pro
 * visitante do /signup é um oracle de enumeração — o mesmo princípio que
 * requestPasswordReset já aplica (resposta idêntica pra e-mail existente ou
 * não). Achado P2, auditoria 2026-08-12.
 */
function isAccountExistsError(error: { code?: string | undefined; message: string }): boolean {
  return error.code === "user_already_exists" || error.message.toLowerCase().includes("already registered");
}

export async function signIn(_prevState: AuthActionState, formData: FormData): Promise<AuthActionState> {
  if (isRateLimited(`signin:${await clientIp()}`, SIGNIN_RATE_LIMIT_WINDOW_MS, SIGNIN_RATE_LIMIT_MAX)) {
    return { error: RATE_LIMIT_MESSAGE };
  }

  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: authErrorMessage(error, "signin") };

  redirect("/dashboard");
}

export async function signUp(_prevState: AuthActionState, formData: FormData): Promise<AuthActionState> {
  if (isRateLimited(`signup:${await clientIp()}`, SIGNUP_RATE_LIMIT_WINDOW_MS, SIGNUP_RATE_LIMIT_MAX)) {
    return { error: RATE_LIMIT_MESSAGE };
  }

  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({ email, password });
  if (error) {
    // Nunca revelar que o e-mail já tem conta: mesma resposta de sucesso,
    // sem reenviar nada — fecha o oracle de enumeração via /signup.
    if (isAccountExistsError(error)) redirect("/login?confirm=1");
    return { error: authErrorMessage(error, "signup") };
  }

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
