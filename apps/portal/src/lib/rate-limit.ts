// Rate limit em memória, sliding window — mesmo padrão já usado no endpoint
// de chat do brain (api/brain/[agentId]/chat/completions/route.ts), agora
// extraído pra ser reaproveitado em superfícies pré-autenticação (signup,
// login) onde não existe tenant_id pra escopar um teto no banco (0015).
// Processo único no Railway; se um dia houver réplicas, isto vira
// melhor-esforço por instância — o teto diário de custo (video-cap.ts) e o
// BILLING_TRIAL_LIMIT continuam sendo a proteção dura de gasto real.
const timestampsByKey = new Map<string, number[]>();

/**
 * Teto de segurança contra crescimento sem limite (achado P2, auditoria
 * 2026-08-12): as chaves são alimentadas por tráfego público não-
 * autenticado (todo IP único que visita /signup, /login, etc.) e nunca
 * eram removidas do Map.
 *
 * NUNCA usar `Map.clear()` aqui — achado P1 CONFIRMADO pela auto-revisão
 * desta mesma onda (D-V2-115): a chave vem de `x-forwarded-for`, um
 * header controlado pelo cliente sem validação de proxy confiável
 * (`clientIp()` em auth.ts/video-session/route.ts). `/api/leads/video-
 * session` roda `isRateLimited` ANTES da autenticação por bearer secret —
 * um atacante consegue floodar 5000+ chaves forjadas baratas e
 * não-autenticadas só pra estourar o teto de propósito. Um `clear()`
 * total nesse ponto apagaria de uma vez o rate-limit de QUALQUER OUTRO
 * IP/usuário já bloqueado (signin/signup de terceiros), transformando uma
 * correção de vazamento de memória num botão de reset de proteção de
 * abuso pra todo mundo. Em vez disso: evict de UMA entrada por vez (a
 * mais antiga por toque — LRU real via delete+reinsert a cada uso, não só
 * por ordem de criação) — limita o mesmo jeito, mas nunca dá a um
 * atacante um gatilho único e barato que reseta o estado de terceiros.
 */
const RATE_LIMIT_MAX_TRACKED_KEYS = 5000;

export function isRateLimited(key: string, windowMs: number, maxRequests: number): boolean {
  const now = Date.now();
  const cutoff = now - windowMs;
  const existing = timestampsByKey.get(key);
  if (existing !== undefined) {
    // Remove e reinsere pra mover a chave pro fim da ordem de iteração do
    // Map (mais recentemente usada) — sem isso, a eviction seria só por
    // ordem de CRIAÇÃO, evictando uma chave ativa só porque foi vista cedo.
    timestampsByKey.delete(key);
  }
  const timestamps = (existing ?? []).filter((t) => t > cutoff);

  if (timestamps.length >= maxRequests) {
    timestampsByKey.set(key, timestamps);
    return true;
  }

  timestamps.push(now);
  if (timestampsByKey.size >= RATE_LIMIT_MAX_TRACKED_KEYS) {
    const oldestKey = timestampsByKey.keys().next().value;
    if (oldestKey !== undefined) timestampsByKey.delete(oldestKey);
  }
  timestampsByKey.set(key, timestamps);
  return false;
}
