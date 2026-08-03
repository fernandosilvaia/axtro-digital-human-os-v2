import { timingSafeEqual } from "node:crypto";

/**
 * Comparação de segredos em tempo constante — nunca `===` direto num bearer
 * ou token (o early-exit da comparação de string vira canal lateral de
 * timing). Extraído de leads/video-session.ts para ser o ÚNICO ponto dessa
 * disciplina (a auditoria 2026-08-02 achou o webhook do Recall comparando
 * token com `!==`).
 */
export function constantTimeEquals(provided: string, expected: string): boolean {
  const providedBuf = Buffer.from(provided, "utf8");
  const expectedBuf = Buffer.from(expected, "utf8");
  if (providedBuf.length !== expectedBuf.length) {
    // Ainda assim consome um compare de tamanho fixo, pra não vazar o comprimento certo por timing.
    timingSafeEqual(Buffer.alloc(32), Buffer.alloc(32));
    return false;
  }
  return timingSafeEqual(providedBuf, expectedBuf);
}
