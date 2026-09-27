import type { Metadata } from "next";

import { RecoveryForm } from "./recovery-form";
import { AuthBrand } from "../auth-brand";
import { createPageMetadata, SITE_NAME } from "@/lib/site";

export const metadata: Metadata = createPageMetadata({
  title: `Recuperar senha | ${SITE_NAME}`,
  description: `Recupere o acesso ao workspace do ${SITE_NAME}.`,
  path: "/recuperar-senha",
  noIndex: true,
});

export default function RecoverPasswordPage() {
  return (
    <div className="auth-shell">
      <div className="auth-card">
        <AuthBrand />
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
