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

  const overview = await fetchTenantOverview();
  const role = overview.role ?? "tenant_admin";

  return (
    <AppShell email={user.email ?? "conta"} roleLabel={ROLE_LABELS[role] ?? role}>
      {children}
    </AppShell>
  );
}
