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
