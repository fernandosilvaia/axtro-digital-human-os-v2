import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  // `next` só pode ser caminho interno: "/x" sim, "//host" e "/\host" não
  // (hardening contra open redirect — o PKCE já impede o cenário de link
  // forjado, mas a validação custa uma linha; auditoria 2026-08-02).
  const rawNext = searchParams.get("next") ?? "";
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") && !rawNext.startsWith("/\\") ? rawNext : "/dashboard";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next}`);
  }

  return NextResponse.redirect(`${origin}/login`);
}
