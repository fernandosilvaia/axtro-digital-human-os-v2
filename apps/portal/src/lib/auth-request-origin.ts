// Módulo comum (não "use server"): um arquivo de Server Actions só pode
// exportar funções assíncronas, e estes helpers puros precisam de teste direto.
import { parsePortalPublicOrigin } from "./public-origin.ts";

/**
 * IP do cliente para a chave de rate limit. O PRIMEIRO valor de
 * X-Forwarded-For é o que o próprio cliente mandou e pode ser trocado a cada
 * tentativa, o que tornava o limite de login, cadastro e reset ilimitado. O
 * proxy confiável da borda acrescenta o IP da conexão no FIM da lista, então o
 * último valor é o que o cliente não controla.
 */
export function rateLimitClientIp(forwardedFor: string | null, realIp: string | null): string {
  if (forwardedFor) {
    const last = forwardedFor.split(",").map((value) => value.trim()).filter((value) => value.length > 0).at(-1);
    if (last) return last;
  }
  return realIp?.trim() || "unknown";
}


const LOCAL_DEVELOPMENT_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/;

/**
 * Origem do link de recuperação de senha. Montá-la com X-Forwarded-Host ou Host
 * deixava quem chama a action escolher para onde o código do link vai (e a
 * checagem CSRF do Next compara justamente esses cabeçalhos), abrindo tomada de
 * conta se a allowlist do Supabase aceitasse o host. Com PORTAL_PUBLIC_URL
 * configurado (produção), a origem é sempre a dele; sem ele, só um host local
 * de desenvolvimento é aceito.
 */
export function passwordResetOrigin(configuredPublicUrl: string | undefined, host: string | null): string | null {
  const configured = configuredPublicUrl?.trim() ?? "";
  if (configured.length > 0) {
    try {
      return parsePortalPublicOrigin(configured);
    } catch {
      return null;
    }
  }
  if (host && LOCAL_DEVELOPMENT_HOST.test(host)) return `http://${host}`;
  return null;
}
