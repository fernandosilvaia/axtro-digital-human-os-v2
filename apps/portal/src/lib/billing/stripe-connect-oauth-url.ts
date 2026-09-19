/**
 * Monta a URL de autorização da Stripe (tela de conexão de conta
 * conectada) e o `redirect_uri` que a Server Action de connect e a rota de
 * callback usam (ADR-040). Fonte: docs.stripe.com/connect/oauth-standard-accounts
 * e docs.stripe.com/connect/oauth-reference (consultado 2026-09-18, doc
 * real, não memória de treino).
 */
import { portalPublicOrigin } from "../public-origin.ts";

const AUTHORIZATION_ENDPOINT = "https://connect.stripe.com/oauth/authorize";
const STRIPE_CONNECT_OAUTH_CALLBACK_PATH = "/api/stripe/connect-oauth/callback";

export function stripeConnectOAuthRedirectUri(env: NodeJS.ProcessEnv = process.env): string {
  return `${portalPublicOrigin(env)}${STRIPE_CONNECT_OAUTH_CALLBACK_PATH}`;
}

export interface StripeConnectAuthorizationUrlInput {
  readonly connectClientId: string;
  readonly redirectUri: string;
  readonly state: string;
}

/**
 * `scope=read_write` (ADR-040 usa cobrança direta em nome do tenant, exige
 * escrita, não só leitura, `read_only` é o default da Stripe e insuficiente
 * aqui). Não prefila nenhum campo `stripe_user[...]`: este produto não tem
 * o e-mail/nome de negócio do tenant disponível neste ponto do fluxo com a
 * confiança necessária para prefilar o formulário oficial da Stripe.
 */
export function buildStripeConnectAuthorizationUrl(input: StripeConnectAuthorizationUrlInput): string {
  const url = new URL(AUTHORIZATION_ENDPOINT);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.connectClientId);
  url.searchParams.set("scope", "read_write");
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("state", input.state);
  return url.toString();
}
