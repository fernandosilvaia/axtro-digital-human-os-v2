import type { Metadata } from "next";

import { SignupForm } from "./signup-form";
import { createPageMetadata } from "@/lib/site";

export const metadata: Metadata = createPageMetadata({
  title: "Criar conta | Axtro Digital Human OS",
  description: "Crie seu workspace isolado para operar apresentadores digitais com governança.",
  path: "/signup",
  noIndex: true,
});

export default function SignupPage() {
  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="brand-mark" aria-hidden="true">A</span>
          <span className="brand-word">Digital Human OS</span>
        </div>
        <h1>Criar conta</h1>
        <p className="subtitle">Sua conta é criada com um espaço de dados isolado e exclusivo.</p>
        <SignupForm />
        <p className="auth-switch">
          Já tem conta? <a href="/login">Entrar</a>
        </p>
      </div>
    </div>
  );
}
