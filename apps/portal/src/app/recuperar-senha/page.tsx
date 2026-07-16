import type { Metadata } from "next";

import { RecoveryForm } from "./recovery-form";

export const metadata: Metadata = { title: "Recuperar senha — Axtro Digital Human OS" };

export default function RecoverPasswordPage() {
  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="brand-mark" aria-hidden="true">A</span>
          <span className="brand-word">Digital Human OS</span>
        </div>
        <h1>Recuperar senha</h1>
        <p className="subtitle">
          Informe o e-mail da sua conta. Se ele estiver cadastrado, enviaremos um link para você definir uma nova senha.
        </p>
        <RecoveryForm />
        <p className="auth-switch">
          Lembrou a senha? <a href="/login">Entrar</a>
        </p>
      </div>
    </div>
  );
}
