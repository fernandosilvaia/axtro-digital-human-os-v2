import assert from "node:assert/strict";
import { test } from "node:test";

const rateLimit = await import("../../apps/portal/src/lib/rate-limit.ts");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("libera as primeiras N requisições e bloqueia a N+1 dentro da janela", () => {
  const key = `test:${Math.random()}`;
  for (let i = 0; i < 3; i++) {
    assert.equal(rateLimit.isRateLimited(key, 60_000, 3), false, `tentativa ${i + 1} deveria passar`);
  }
  assert.equal(rateLimit.isRateLimited(key, 60_000, 3), true, "4ª tentativa deveria ser bloqueada");
});

test("chaves diferentes têm tetos independentes (isolamento por IP)", () => {
  const keyA = `test:a:${Math.random()}`;
  const keyB = `test:b:${Math.random()}`;
  assert.equal(rateLimit.isRateLimited(keyA, 60_000, 1), false);
  assert.equal(rateLimit.isRateLimited(keyA, 60_000, 1), true, "keyA já estourou o teto");
  assert.equal(rateLimit.isRateLimited(keyB, 60_000, 1), false, "keyB não deveria ser afetada por keyA");
});

test("libera de novo depois que a janela desliza (sliding window)", async () => {
  const key = `test:window:${Math.random()}`;
  assert.equal(rateLimit.isRateLimited(key, 50, 1), false);
  assert.equal(rateLimit.isRateLimited(key, 50, 1), true, "dentro da janela, deveria bloquear");
  await sleep(80);
  assert.equal(rateLimit.isRateLimited(key, 50, 1), false, "depois da janela expirar, deveria liberar de novo");
});

test("bloquear repetidamente não estica o teto (tentativas bloqueadas não contam como novo slot)", () => {
  const key = `test:no-leak:${Math.random()}`;
  assert.equal(rateLimit.isRateLimited(key, 60_000, 2), false);
  assert.equal(rateLimit.isRateLimited(key, 60_000, 2), false);
  for (let i = 0; i < 5; i++) {
    assert.equal(rateLimit.isRateLimited(key, 60_000, 2), true, `tentativa extra ${i} deveria continuar bloqueada`);
  }
});

test("achado D-V2-115: Map interno não cresce sem limite — evicta a chave mais antiga ao passar do teto de chaves distintas", () => {
  const prefix = `test:overflow:${Math.random()}:`;
  const earlyKey = `${prefix}0`;
  // Estoura o teto diário desta chave — bloqueada até a janela expirar (60s).
  assert.equal(rateLimit.isRateLimited(earlyKey, 60_000, 1), false);
  assert.equal(rateLimit.isRateLimited(earlyKey, 60_000, 1), true, "earlyKey deveria estar bloqueada");

  // Preenche o Map com chaves distintas o bastante pra passar do teto (5000)
  // — mais de RATE_LIMIT_MAX_TRACKED_KEYS chaves NOVAS depois de earlyKey
  // garante que ela seja evictada (é estritamente mais antiga que todas
  // as 5001 inseridas depois, e o Map só tem espaço pra 5000).
  for (let i = 1; i <= 5001; i++) {
    rateLimit.isRateLimited(`${prefix}${i}`, 60_000, 1);
  }

  // Se o Map tivesse crescido sem limite, earlyKey continuaria bloqueada
  // (mesma janela de 60s). Depois do overflow, earlyKey foi evictada por
  // ser a entrada mais antiga (LRU) — esqueceu seu estado e é liberada de novo.
  assert.equal(rateLimit.isRateLimited(earlyKey, 60_000, 1), false, "earlyKey deveria ter sido evictada após o overflow do Map");
});

test("achado da auto-revisão D-V2-115: eviction sob pressão remove só a entrada mais antiga (LRU), NUNCA um clear() total que resetaria o rate-limit de terceiros", () => {
  const prefix = `test:lru:${Math.random()}:`;
  const victimKey = `${prefix}victim`;
  // victimKey simula o rate-limit de OUTRO usuário/IP já bloqueado (ex.: um
  // signin:<ip> de alguém tentando credential stuffing).
  assert.equal(rateLimit.isRateLimited(victimKey, 60_000, 1), false);
  assert.equal(rateLimit.isRateLimited(victimKey, 60_000, 1), true, "victimKey deveria estar bloqueada");

  // Flood de chaves novas e distintas — simula um atacante forjando
  // x-forwarded-for repetidamente contra uma rota sem autenticação prévia
  // (achado real: /api/leads/video-session chama isRateLimited ANTES do
  // bearer check) só pra estourar o teto de propósito.
  const FLOOD_SIZE = 5001;
  for (let i = 0; i < FLOOD_SIZE; i++) {
    rateLimit.isRateLimited(`${prefix}flood${i}`, 60_000, 1);
  }

  // victimKey é estritamente mais antiga que as 5001 chaves do flood — LRU
  // a evicta em algum ponto do caminho.
  assert.equal(rateLimit.isRateLimited(victimKey, 60_000, 1), false, "victimKey deveria ter sido evictada (mais antiga), nunca sobreviver a um clear parcial nem sobreviver indefinidamente");

  // A ÚLTIMA chave do flood (a mais recente de todas) precisa continuar
  // rastreada e bloqueada — se um clear() total tivesse acontecido em vez
  // de eviction pontual, esta chave (inserida por último) também teria
  // sido esquecida junto com victimKey.
  const mostRecentFloodKey = `${prefix}flood${FLOOD_SIZE - 1}`;
  assert.equal(rateLimit.isRateLimited(mostRecentFloodKey, 60_000, 1), true, "a chave mais recente do flood deveria continuar bloqueada — prova que a eviction é pontual (LRU), não um reset total do Map");
});
