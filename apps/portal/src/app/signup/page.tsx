import type { Metadata } from "next";

import { SignupForm } from "./signup-form";

export const metadata: Metadata = { title: "Criar conta — Axtro Digital Human OS" };

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
