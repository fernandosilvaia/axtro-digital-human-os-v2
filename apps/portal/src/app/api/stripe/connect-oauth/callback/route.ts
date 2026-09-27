import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

import { fulfillStripeConnectOAuthCallback } from "@/lib/billing/fulfill-stripe-connect-oauth-callback";
import { STRIPE_CONNECT_OAUTH_STATE_COOKIE_NAME } from "@/lib/billing/stripe-connect-oauth-state";
import { portalPublicOrigin } from "@/lib/public-origin";

/**
 * Callback OAuth da Stripe Connect (ADR-040), a segunda rota de callback
 * OAuth por redirect de navegador deste repositório (a primeira é
 * `api/google-calendar/oauth/callback`, mesmo padrão espelhado aqui).
 *
 * Responsabilidades, em ordem, cada uma fechando a rota antes da próxima se
 * falhar:
 * 1. `error=` da Stripe (usuário negou consentimento) -> recusa com um
 *    código curto, nunca repassa o texto bruto da Stripe pra URL de
 *    retorno.
 * 2. `code`/`state` ausentes -> recusa.
 * 3. Cookie de `state` ausente -> recusa. Consome (apaga) o cookie sempre,
 *    tenha ou não sucesso: uso único do FLUXO como um todo, mesmo quando a
 *    verificação de assinatura em si (`verifyStripeConnectOAuthStateToken`)
 *    é stateless por design.
 * 4. `state` do cookie confere double-submit contra o `state` da query
 *    string (os dois precisam ser BYTE-IDÊNTICOS, defesa em profundidade
 *    além da assinatura sozinha) -- isto é transporte HTTP, fica só aqui.
 * 5 em diante (verificar assinatura/expiração, reautenticar sessão, trocar
 *   `code`, chamar `portal_complete_stripe_connect_service`) vive em
 *   `fulfillStripeConnectOAuthCallback` (`lib/billing/
 *   fulfill-stripe-connect-oauth-callback.ts`), sem casca HTTP nem cookie,
 *   pelo mesmo motivo do callback do Google Calendar: uma Server Action
 *   fake-mode chama essa função direto, sem precisar de um segundo hop
 *   HTTP nesta rota.
 *
 * Nunca loga `code`, `state` bruto, nem qualquer credencial em nenhum
 * caminho (sucesso ou erro), só metadados não sensíveis.
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  let origin: string;
  try {
    origin = portalPublicOrigin();
  } catch {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  const errorRedirect = (code: string): NextResponse => NextResponse.redirect(`${origin}/configuracoes?stripe_connect_error=${code}`);

  const cookieStore = await cookies();
  const cookieToken = cookieStore.get(STRIPE_CONNECT_OAUTH_STATE_COOKIE_NAME)?.value;
  // Uso único: consome o cookie ANTES de qualquer verificação, sucesso ou falha.
  cookieStore.set(STRIPE_CONNECT_OAUTH_STATE_COOKIE_NAME, "", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 0 });

  const url = new URL(request.url);
  const stripeError = url.searchParams.get("error");
  if (stripeError !== null) {
    return errorRedirect("consentimento_negado");
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (code === null || code.length === 0 || state === null || state.length === 0 || cookieToken === undefined) {
    return errorRedirect("callback_invalido");
  }
  // Double-submit: o valor da query string precisa bater byte a byte com o
  // que o cookie guardava, não só passar a própria verificação de
  // assinatura -- um atacante que conseguisse fixar (mas nunca ler) um
  // cookie de vítima não teria como produzir um `state` de query
  // correspondente.
  if (state !== cookieToken) {
    return errorRedirect("state_invalido");
  }

  const result = await fulfillStripeConnectOAuthCallback(code, state);
  if (result.outcome === "error") {
    return errorRedirect(result.code);
  }
  return NextResponse.redirect(`${origin}/configuracoes?stripe_connect_status=connected`);
}
