import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { NewPasswordForm } from "./new-password-form";
import { createPageMetadata } from "@/lib/site";

export const metadata: Metadata = createPageMetadata({
  title: "Definir nova senha | Axtro Digital Human OS",
  description: "Defina uma nova senha para continuar no workspace do Axtro Digital Human OS.",
  path: "/nova-senha",
  noIndex: true,
});

export default async function NewPasswordPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="brand-mark" aria-hidden="true">A</span>
          <span className="brand-word">Digital Human OS</span>
        </div>
        <h1>Definir nova senha</h1>
        <p className="subtitle">Conta: {user.email}</p>
        <NewPasswordForm />
      </div>
    </div>
  );
}
