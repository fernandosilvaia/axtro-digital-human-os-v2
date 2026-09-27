import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { NewPasswordForm } from "./new-password-form";
import { AuthBrand } from "../auth-brand";
import { createPageMetadata, SITE_NAME } from "@/lib/site";

export const metadata: Metadata = createPageMetadata({
  title: `Definir nova senha | ${SITE_NAME}`,
  description: `Defina uma nova senha para continuar no workspace do ${SITE_NAME}.`,
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
        <AuthBrand />
        <h1>Definir nova senha</h1>
        <p className="subtitle">Conta: {user.email}</p>
        <NewPasswordForm />
      </div>
    </div>
  );
}
