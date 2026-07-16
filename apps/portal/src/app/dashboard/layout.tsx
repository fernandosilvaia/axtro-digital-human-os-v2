import { redirect } from "next/navigation";

import { signOut } from "@/lib/actions/auth";
import { ensureTenantProvisioned } from "@/lib/actions/provisioning";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { tenantId } = await ensureTenantProvisioned(supabase, user);

  return (
    <div className="dashboard-shell">
      <header className="dashboard-header">
        <span className="brand">Axtro Digital Human OS</span>
        <div className="session-info">
          <span>{user.email}</span>
          <span className="tenant-badge">tenant {tenantId.slice(0, 8)}</span>
          <form action={signOut}>
            <button type="submit" className="sign-out-button">Sair</button>
          </form>
        </div>
      </header>
      <main className="dashboard-main">{children}</main>
    </div>
  );
}
