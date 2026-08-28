/**
 * Monta a URL de autorização do Google (tela de consentimento) e o
 * `redirect_uri` que a Server Action de connect e a rota de callback usam —
 * o MESMO valor byte-idêntico nos dois lados, porque o Google exige isso na
 * troca de token (`exchangeGoogleAuthorizationCode`), e porque só um
 * `redirect_uri` fica cadastrado no Google Cloud Console (ver
 * `.env.example`). Centralizado aqui para as duas pontas nunca poderem
 * divergir por engano.
 */
import { portalPublicOrigin } from "../public-origin.ts";

const AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_CALENDAR_OAUTH_CALLBACK_PATH = "/api/google-calendar/oauth/callback";
/**
 * `https://www.googleapis.com/auth/calendar` é o escopo que
 * `packages/provider-google-calendar` já assume (FreeBusy + Events).
 * `openid email` é pedido só para decodificar a claim `email` do `id_token`
 * na troca de token (ver `id-token.ts`) — nenhum escopo adicional além do
 * estritamente necessário.
 */
const GOOGLE_CALENDAR_OAUTH_SCOPES = "https://www.googleapis.com/auth/calendar openid email";

export function googleCalendarOAuthRedirectUri(env: NodeJS.ProcessEnv = process.env): string {
  return `${portalPublicOrigin(env)}${GOOGLE_CALENDAR_OAUTH_CALLBACK_PATH}`;
}

export interface GoogleCalendarAuthorizationUrlInput {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly state: string;
}

/**
 * `access_type=offline` + `prompt=consent` são os dois parâmetros que o
 * Google documenta como necessários para receber um `refresh_token` — mesmo
 * assim, um usuário que já autorizou antes sem revogar pode não recebê-lo
 * de novo (comportamento do próprio Google, tratado como erro tipado em
 * `exchangeGoogleAuthorizationCode`, nunca assumido silenciosamente aqui).
 */
export function buildGoogleCalendarAuthorizationUrl(input: GoogleCalendarAuthorizationUrlInput): string {
  const url = new URL(AUTHORIZATION_ENDPOINT);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_CALENDAR_OAUTH_SCOPES);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", input.state);
  return url.toString();
}
