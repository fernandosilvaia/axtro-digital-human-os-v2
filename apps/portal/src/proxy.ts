import { type NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // /api/health fica fora do middleware de auth: Railway e o smoke test
  // pós-deploy precisam de uma resposta pública, sem tocar o Supabase.
  // llms.txt/llms-full.txt (AEO) também precisam ser públicos — sem essa
  // exclusão, crawlers de IA recebiam 307 para /login em vez do conteúdo
  // (achado real no smoke test pós-deploy do SEO-AEO-01, 2026-07-24).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|manifest.json|opengraph-image|llms.txt|llms-full.txt|api/health|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
