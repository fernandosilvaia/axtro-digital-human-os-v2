import assert from "node:assert/strict";
import { test } from "node:test";

const oauthState = await import("../../apps/portal/src/lib/google-calendar/oauth-state.ts");

test("gera um state não adivinhável e o consome exatamente uma vez, devolvendo tenant/actor amarrados", () => {
  const state = oauthState.createGoogleCalendarOAuthState("tenant-a", "actor-a");
  assert.equal(typeof state, "string");
  assert.equal(state.length >= 32, true, "state deveria ter entropia suficiente (256 bits em base64url)");

  const consumed = oauthState.consumeGoogleCalendarOAuthState(state);
  assert.deepEqual(consumed, { tenantId: "tenant-a", actorId: "actor-a" });
});

test("dois states gerados em sequência nunca colidem", () => {
  const seen = new Set();
  for (let i = 0; i < 200; i += 1) {
    const state = oauthState.createGoogleCalendarOAuthState(`tenant-${i}`, `actor-${i}`);
    assert.equal(seen.has(state), false, "state reaproveitado — quebra a garantia anti-CSRF");
    seen.add(state);
  }
});

test("consumir um state nunca visto devolve null (não distingue de expirado/replay pro chamador)", () => {
  assert.equal(oauthState.consumeGoogleCalendarOAuthState("nunca-existiu"), null);
});

test("uso único: o segundo consumo do mesmo state (replay) devolve null, mesmo dentro do TTL", () => {
  const state = oauthState.createGoogleCalendarOAuthState("tenant-b", "actor-b");
  const first = oauthState.consumeGoogleCalendarOAuthState(state);
  assert.notEqual(first, null);
  const replay = oauthState.consumeGoogleCalendarOAuthState(state);
  assert.equal(replay, null, "um atacante reaproveitando o state de uma vítima nunca pode ser aceito duas vezes");
});

test("state expirado (TTL vencido) é recusado mesmo sem nunca ter sido consumido", () => {
  let now = 1_000_000;
  const clock = { now: () => now };
  const state = oauthState.createGoogleCalendarOAuthState("tenant-c", "actor-c", clock);
  now += 10 * 60_000 + 1_000; // 10min de TTL + margem
  const consumed = oauthState.consumeGoogleCalendarOAuthState(state, clock);
  assert.equal(consumed, null);
});

test("state dentro do TTL continua válido até o segundo antes de expirar", () => {
  let now = 1_000_000;
  const clock = { now: () => now };
  const state = oauthState.createGoogleCalendarOAuthState("tenant-d", "actor-d", clock);
  now += 10 * 60_000 - 1;
  const consumed = oauthState.consumeGoogleCalendarOAuthState(state, clock);
  assert.deepEqual(consumed, { tenantId: "tenant-d", actorId: "actor-d" });
});

test("o Map interno não cresce sem limite — um state nunca concluído eventualmente é evictado (backstop defensivo)", () => {
  const first = oauthState.createGoogleCalendarOAuthState("tenant-bound-first", "actor-bound-first");
  for (let i = 0; i < 400; i += 1) {
    oauthState.createGoogleCalendarOAuthState(`tenant-bound-${i}`, `actor-bound-${i}`);
  }
  // O primeiro state, nunca consumido, deveria ter sido evictado depois de
  // muitos states novos sem nunca ser tocado de novo — sem isso, um bug de
  // UI clicando "Conectar" repetidamente cresceria o Map pra sempre.
  assert.equal(oauthState.consumeGoogleCalendarOAuthState(first), null);
});

test("achado da revisão de segurança: um tenant gerando volume de states nunca evicta o state pendente de OUTRO tenant", () => {
  // Um tenant_admin de outro tenant tem um fluxo legítimo em andamento.
  const victimState = oauthState.createGoogleCalendarOAuthState("tenant-victim-flood", "actor-victim-flood");

  // Um tenant diferente (potencialmente malicioso, ou vários coordenados)
  // gera volume de states sem nunca concluir o fluxo -- mais que o bound
  // por tenant, o suficiente pra também estourar o bound global sozinho.
  for (let i = 0; i < 250; i += 1) {
    oauthState.createGoogleCalendarOAuthState("tenant-flooder", `actor-flooder-${i}`);
  }

  // O state da vítima, gerado ANTES do flood e nunca consumido, ainda
  // precisa estar vivo -- o flood só pode evictar as entradas mais antigas
  // do PRÓPRIO tenant-flooder, nunca as de tenant-victim-flood.
  assert.deepEqual(
    oauthState.consumeGoogleCalendarOAuthState(victimState),
    { tenantId: "tenant-victim-flood", actorId: "actor-victim-flood" },
    "um tenant flooding states não pode empurrar pra fora o state pendente legítimo de outro tenant",
  );
});

test("bound por tenant: um único tenant não acumula states pendentes sem limite, mesmo sem nunca concluir o fluxo", () => {
  const first = oauthState.createGoogleCalendarOAuthState("tenant-self-flood", "actor-self-flood-first");
  for (let i = 0; i < 20; i += 1) {
    oauthState.createGoogleCalendarOAuthState("tenant-self-flood", `actor-self-flood-${i}`);
  }
  assert.equal(
    oauthState.consumeGoogleCalendarOAuthState(first),
    null,
    "o bound por tenant deveria ter evictado o state mais antigo do PRÓPRIO tenant muito antes de 20 states pendentes",
  );
});

test("um state amarrado a um tenant/actor nunca é confundido com o de outro (isolamento)", () => {
  const stateVictim = oauthState.createGoogleCalendarOAuthState("tenant-victim", "actor-victim");
  const stateAttacker = oauthState.createGoogleCalendarOAuthState("tenant-attacker", "actor-attacker");
  assert.notEqual(stateVictim, stateAttacker);
  assert.deepEqual(oauthState.consumeGoogleCalendarOAuthState(stateAttacker), { tenantId: "tenant-attacker", actorId: "actor-attacker" });
  assert.deepEqual(oauthState.consumeGoogleCalendarOAuthState(stateVictim), { tenantId: "tenant-victim", actorId: "actor-victim" });
});
