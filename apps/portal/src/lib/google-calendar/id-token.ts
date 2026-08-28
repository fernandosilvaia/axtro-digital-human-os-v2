/**
 * Extrai a claim `email` do `id_token` OIDC que o Google devolve junto dos
 * tokens de acesso, na MESMA resposta do endpoint de token que a rota de
 * callback já confia incondicionalmente pra obter `refresh_token`/
 * `access_token` (`exchangeGoogleAuthorizationCode`, sobre TLS). Decisão de
 * design desta rodada (ADR-039 onda 1b-ii): decodificar o `id_token` em vez
 * de fazer uma chamada HTTP extra ao People API/userinfo — mais simples, não
 * exige nenhum escopo além do já pedido pra Calendar (`openid email` na URL
 * de autorização, ver `oauth-url.ts`), e não introduz uma segunda superfície
 * de rede pra este fluxo já ter que tratar.
 *
 * Deliberadamente NUNCA valida a assinatura criptográfica do JWT — o
 * `id_token` chegou na MESMA resposta TLS do token endpoint oficial do
 * Google que já fornece o `refresh_token`/`access_token` sem verificação
 * adicional nenhuma; verificar a assinatura aqui checaria de novo um
 * transporte que este fluxo já confia, não adicionaria uma fronteira de
 * confiança nova. Por isso: NUNCA chame esta função com um `id_token`
 * obtido de qualquer outra origem (ex.: um valor que o navegador pudesse
 * forjar em um parâmetro de request) — só o valor que
 * `exchangeGoogleAuthorizationCode`/`createFakeGoogleAuthorizationCodeExchange`
 * devolveram na troca de token que este mesmo processo acabou de fazer.
 */
const MAX_ID_TOKEN_CHARS = 8_192;
/** Mesmo padrão pragmático (não RFC 5322 completo) já usado em `provider-google-calendar` e `portal-business-action-bridge.ts`. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_CHARS = 320;

function base64UrlJsonPayload(segment: string): Record<string, unknown> | null {
  let decoded: string;
  try {
    decoded = Buffer.from(segment, "base64url").toString("utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const prototype = Object.getPrototypeOf(parsed);
  if (prototype !== Object.prototype && prototype !== null) return null;
  return parsed as Record<string, unknown>;
}

/**
 * `null` cobre uniformemente todo caso inválido/ausente/malformado — a rota
 * de callback nunca distingue o motivo pro usuário final, só recusa
 * conectar sem um e-mail utilizável.
 */
export function decodeGoogleIdTokenEmail(idToken: string): string | null {
  if (typeof idToken !== "string" || idToken.length === 0 || idToken.length > MAX_ID_TOKEN_CHARS) return null;
  const parts = idToken.split(".");
  if (parts.length !== 3) return null;
  const payloadSegment = parts[1];
  if (payloadSegment === undefined || payloadSegment.length === 0) return null;
  const claims = base64UrlJsonPayload(payloadSegment);
  if (claims === null) return null;
  const email = claims.email;
  if (typeof email !== "string" || email.length === 0 || email.length > MAX_EMAIL_CHARS || !EMAIL_PATTERN.test(email)) return null;
  return email;
}
