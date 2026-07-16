"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

/**
 * Entra na conta de demonstração compartilhada (dados fictícios). As
 * credenciais vivem só em variáveis de ambiente do servidor — nunca no
 * repositório (que é público) nem no client.
 */
export async function signInDemo(): Promise<void> {
  const email = process.env.DEMO_EMAIL ?? "";
  const password = process.env.DEMO_PASSWORD ?? "";
  if (email.length === 0 || password.length === 0) {
    redirect("/login?demo=unavailable");
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    redirect("/login?demo=unavailable");
  }
  redirect("/dashboard");
}
