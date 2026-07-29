import { type NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Todo /api/* fica fora do middleware de auth por sessão de cookie: cada
  // rota ali (health, brain/chat-completions, leads/video-session, ...) já
  // implementa a própria autenticação servidor-a-servidor (bearer/segredo) —
  // nenhuma depende de sessão de usuário no navegador. Excluir só api/health
  // deixava as outras caindo no 307 pro /login antes de tocar a lógica da
  // rota (achado real 2026-07-29: /api/brain e /api/leads/video-session
  // redirecionavam pro login em vez de responder). Mesma classe de bug do
  // llms.txt (SEO-AEO-01, 2026-07-24) — a lição é excluir por padrão
  // estrutural (api/*), não listar rota por rota.
  // llms.txt/llms-full.txt (AEO) também precisam ser públicos.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|manifest.json|opengraph-image|llms.txt|llms-full.txt|api/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
