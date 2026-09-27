import { NextRequest, NextResponse } from "next/server";

import { fulfillGoogleCalendarOAuthCallback } from "@/lib/google-calendar/fulfill-oauth-callback";
import { portalPublicOrigin } from "@/lib/public-origin";

/**
 * Callback OAuth do Google Calendar (ADR-039, onda 1b-ii): a primeira rota
 * de callback OAuth por redirect de navegador deste repositório; toda outra
 * rota em `api/*` é webhook push (provider → servidor via POST), sem sessão
 * de usuário. Esta é diferente: o Google redireciona o NAVEGADOR do
 * `tenant_admin` de volta pra cá com `?code=...&state=...` (ou
 * `?error=...` se o usuário negar consentimento).
 *
 * Responsabilidades, em ordem, cada uma fechando a rota antes da próxima se
 * falhar:
 * 1. `error=` do Google → recusa com um código curto, nunca repassa o texto
 *    bruto do Google pra URL de retorno.
 * 2. `code`/`state` ausentes → recusa.
 * 3 em diante (`state` inválido, reautenticação, troca de token, decodificar
 * e-mail, chamar `portal_connect_google_calendar_service`) vive em
 * `fulfillGoogleCalendarOAuthCallback` (`lib/google-calendar/
 * fulfill-oauth-callback.ts`), sem casca HTTP, pra poder ser chamada
 * diretamente por `startGoogleCalendarConnection` em modo fake também, sem
 * precisar de um segundo hop HTTP nesta rota (ver o comentário daquele
 * arquivo pro porquê: um `redirect()` de Server Action pra esta MESMA rota
 * causava duas execuções reais pro mesmo clique).
 *
 * Nunca loga `code`, `state`, `refresh_token`, `access_token` ou `id_token`
 * bruto em nenhum caminho (sucesso ou erro), só metadados não sensíveis
 * (`tenant_id`, código de erro tipado do provider).
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  let origin: string;
  try {
    origin = portalPublicOrigin();
  } catch {
    // Ambiente sem PORTAL_PUBLIC_URL configurada (e fora de modo fake) --
    // mesmo padrão 503 "not_configured" já usado em
    // api/resend/webhook/route.ts pra "faltou configuração"; nunca constrói
    // um redirect a partir de uma origem não aprovada.
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  const errorRedirect = (code: string): NextResponse => NextResponse.redirect(`${origin}/configuracoes?calendar_error=${code}`);

  const url = new URL(request.url);
  const googleError = url.searchParams.get("error");
  if (googleError !== null) {
    return errorRedirect("consentimento_negado");
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (code === null || code.length === 0 || state === null || state.length === 0) {
    return errorRedirect("callback_invalido");
  }

  const result = await fulfillGoogleCalendarOAuthCallback(code, state);
  if (result.outcome === "error") {
    return errorRedirect(result.code);
  }
  return NextResponse.redirect(`${origin}/configuracoes?calendar_status=connected`);
}
