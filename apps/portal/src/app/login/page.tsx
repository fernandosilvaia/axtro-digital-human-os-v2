import type { Metadata } from "next";

import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Entrar — Axtro Digital Human OS" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ confirm?: string }>;
}) {
  const { confirm } = await searchParams;

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="brand-mark" aria-hidden="true">A</span>
          <span className="brand-word">Digital Human OS</span>
        </div>
        <h1>Entrar</h1>
        <p className="subtitle">Acesse o painel da sua conta.</p>
        {confirm === "1" && (
          <p className="notice" role="status">
            Conta criada. Confirme seu e-mail antes de entrar — enviamos um link de verificação.
          </p>
        )}
        <LoginForm />
        <p className="auth-switch">
          Ainda não tem conta? <a href="/signup">Criar conta</a>
        </p>
      </div>
    </div>
  );
}
