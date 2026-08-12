// Rate limit em memória, sliding window — mesmo padrão já usado no endpoint
// de chat do brain (api/brain/[agentId]/chat/completions/route.ts), agora
// extraído pra ser reaproveitado em superfícies pré-autenticação (signup,
// login) onde não existe tenant_id pra escopar um teto no banco (0015).
// Processo único no Railway; se um dia houver réplicas, isto vira
// melhor-esforço por instância — o teto diário de custo (video-cap.ts) e o
// BILLING_TRIAL_LIMIT continuam sendo a proteção dura de gasto real.
const timestampsByKey = new Map<string, number[]>();

export function isRateLimited(key: string, windowMs: number, maxRequests: number): boolean {
  const now = Date.now();
  const cutoff = now - windowMs;
  const timestamps = (timestampsByKey.get(key) ?? []).filter((t) => t > cutoff);
  if (timestamps.length >= maxRequests) {
    timestampsByKey.set(key, timestamps);
    return true;
  }
  timestamps.push(now);
  timestampsByKey.set(key, timestamps);
  return false;
}
