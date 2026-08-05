import type { Metadata } from "next";

import { LoginForm } from "./login-form";
import { createPageMetadata } from "@/lib/site";

export const metadata: Metadata = createPageMetadata({
  title: "Entrar | Axtro Digital Human OS",
  description: "Entre no workspace do Axtro Digital Human OS.",
  path: "/login",
  noIndex: true,
});

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ confirm?: string; demo?: string }>;
}) {
  const { confirm, demo } = await searchParams;

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
        {demo === "unavailable" && (
          <p className="notice" role="status">
            A demonstração ao vivo está temporariamente indisponível. Você pode criar sua própria conta abaixo ou tentar de novo em instantes.
          </p>
        )}
        <LoginForm />
        <p className="auth-switch">
          <a href="/recuperar-senha">Esqueceu a senha?</a>
        </p>
        <p className="auth-switch">
          Ainda não tem conta? <a href="/signup">Criar conta</a>
        </p>
      </div>
    </div>
  );
}
