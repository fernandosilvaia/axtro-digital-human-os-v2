import type { Metadata } from "next";

import { SignupForm } from "./signup-form";
import { AuthBrand } from "../auth-brand";
import { createPageMetadata, SITE_NAME } from "@/lib/site";

export const metadata: Metadata = createPageMetadata({
  title: `Criar conta | ${SITE_NAME}`,
  description: "Crie seu workspace isolado para operar apresentadores digitais com governança.",
  path: "/signup",
  noIndex: true,
});

export default function SignupPage() {
  return (
    <div className="auth-shell">
      <div className="auth-card">
        <AuthBrand />
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
