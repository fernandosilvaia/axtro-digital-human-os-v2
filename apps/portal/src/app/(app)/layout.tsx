import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { fetchTenantOverview } from "@/lib/portal-data";
import { createClient } from "@/lib/supabase/server";

export const metadata = {
  robots: { index: false, follow: false },
};

const ROLE_LABELS: Record<string, string> = {
  tenant_admin: "Administrador",
  tenant_operator: "Operador",
};

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // O shell não deve impedir que a pessoa autenticada veja a mensagem de
  // recuperação do dashboard quando a RPC de overview estiver indisponível.
  // Papel aqui é somente rótulo visual; nenhuma autorização é derivada dele.
  const overview = await fetchTenantOverview().catch(() => null);
  const role = overview?.role;

  return (
    <AppShell
      email={user.email ?? "conta"}
      roleLabel={role ? (ROLE_LABELS[role] ?? role) : "Acesso não verificado"}
    >
      {children}
    </AppShell>
  );
}
