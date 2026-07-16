import { createClient } from "@/lib/supabase/server";

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  return (
    <div>
      <h1>Bem-vindo</h1>
      <p>Sessão autenticada para {user?.email}.</p>
    </div>
  );
}
