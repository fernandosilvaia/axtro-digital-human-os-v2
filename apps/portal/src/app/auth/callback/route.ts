import { NextResponse, type NextRequest } from "next/server";

import { portalPublicOrigin } from "@/lib/public-origin";
import { createClient } from "@/lib/supabase/server";

/**
 * Atrás do proxy do Railway, `request.url` traz o host interno
 * (https://localhost:8080) e o link do e-mail levava a pessoa para lá. A
 * origem pública revisada vence; a da requisição só vale em dev local.
 */
function redirectOrigin(request: NextRequest): string {
  try {
    return portalPublicOrigin();
  } catch {
    return new URL(request.url).origin;
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const origin = redirectOrigin(request);
  const code = searchParams.get("code");
  // `next` só pode ser caminho interno: "/x" sim, "//host" e "/\host" não
  // (hardening contra open redirect: o PKCE já impede o cenário de link
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
