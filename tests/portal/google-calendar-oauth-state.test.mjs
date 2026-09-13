import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
import { test } from "node:test";

/**
 * `state` do OAuth do Google Calendar depois de D-V2-174.
 *
 * A versão anterior deste arquivo testava um `Map` de processo e passava
 * inteira, enquanto o fluxo real nunca funcionou uma única vez em produção. A
 * lição não é "o teste era fraco", é que ele testava a estrutura de dados
 * errada: quem grava o `state` é uma Server Action e quem lê é um route
 * handler, e o Next.js empacota os dois separadamente, então cada lado tinha
 * o próprio Map. Nenhum teste que carregue o módulo UMA vez pode expor isso.
 *
 * Por isso a fronteira agora é o banco, e o que este arquivo trava é o
 * contrato do módulo com essa fronteira: o que ele manda, o que ele aceita de
 * volta, e como ele falha. As regras que passaram a viver em SQL (uso único,
 * TTL, teto por tenant) são provadas contra Postgres de verdade na fase
 * `assertGoogleCalendarOAuthStatePhase` do harness, não aqui: exercitá-las
 * contra um fake só provaria que o fake as implementa.
 */
const mockSources = new Map([
  ["@/lib/supabase/service", `
    export function createServiceRoleClient() {
      const state = globalThis.__oauthStateTest;
      if (state.serviceRoleThrows) throw new Error("service role unavailable");
      return {
        rpc: async (name, args) => {
          state.calls.push({ name, args });
          return state.responses[name] ?? { data: null, error: null };
        },
      };
    }
  `],
]);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (mockSources.has(specifier)) return { url: `oauth-state-mock:${encodeURIComponent(specifier)}`, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith("oauth-state-mock:")) {
      const specifier = decodeURIComponent(url.slice("oauth-state-mock:".length));
      return { format: "module", source: mockSources.get(specifier), shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

const oauthState = await import("../../apps/portal/src/lib/google-calendar/oauth-state.ts");

function resetState(overrides = {}) {
  globalThis.__oauthStateTest = { calls: [], responses: {}, serviceRoleThrows: false, ...overrides };
  return globalThis.__oauthStateTest;
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

test("o token nunca chega ao banco, só o sha256 dele", async () => {
  const harness = resetState();
  const state = await oauthState.createGoogleCalendarOAuthState("tenant-a", "actor-a");

  assert.equal(harness.calls.length, 1);
  const { name, args } = harness.calls[0];
  assert.equal(name, "portal_begin_google_calendar_oauth_state_service");
  assert.match(args.p_state_hash, SHA256_HEX);
  assert.equal(args.p_state_hash, createHash("sha256").update(state, "utf8").digest("hex"));
  // A garantia que importa: quem lê a tabela não consegue completar o fluxo
  // pendente de ninguém, porque o valor guardado não é utilizável como state.
  assert.notEqual(args.p_state_hash, state);
  assert.ok(!JSON.stringify(args).includes(state), "o state em claro não pode aparecer em nenhum argumento");
  assert.equal(args.p_tenant_id, "tenant-a");
  assert.equal(args.p_actor_id, "actor-a");
});

test("cada chamada gera um state independente e não adivinhável", async () => {
  resetState();
  const first = await oauthState.createGoogleCalendarOAuthState("tenant-a", "actor-a");
  const second = await oauthState.createGoogleCalendarOAuthState("tenant-a", "actor-a");
  assert.notEqual(first, second);
  // 32 bytes em base64url: 43 chars sem padding.
  assert.ok(first.length >= 43, `state curto demais: ${first.length}`);
});

test("falha ao persistir LANÇA, para o navegador nunca ir ao Google com um state órfão", async () => {
  // Este é o coração de D-V2-174: antes, um state que o callback jamais
  // reconheceria seguia adiante, e o erro só aparecia DEPOIS do
  // consentimento, fazendo um defeito nosso parecer recusa do Google.
  resetState({
    responses: { portal_begin_google_calendar_oauth_state_service: { data: null, error: { message: "db down" } } },
  });
  await assert.rejects(
    () => oauthState.createGoogleCalendarOAuthState("tenant-a", "actor-a"),
    /could not be stored/,
  );
});

test("consumir devolve o par tenant/ator que o callback usa como cross-check", async () => {
  const harness = resetState({
    responses: {
      portal_consume_google_calendar_oauth_state_service: {
        data: { outcome: "found", tenantId: "tenant-a", actorId: "actor-a" },
        error: null,
      },
    },
  });
  const consumed = await oauthState.consumeGoogleCalendarOAuthState("um-state-qualquer");
  assert.deepEqual(consumed, { tenantId: "tenant-a", actorId: "actor-a" });
  assert.match(harness.calls[0].args.p_state_hash, SHA256_HEX);
});

test("not_found, resposta malformada e erro de RPC colapsam todos em null", async () => {
  // Anti-oráculo: nunca existiu, já usado e expirado são indistinguíveis, e
  // falha de infraestrutura também recusa. Fechar é o comportamento seguro
  // quando não dá para provar que o state era legítimo.
  for (const response of [
    { data: { outcome: "not_found" }, error: null },
    { data: null, error: null },
    { data: { outcome: "found", tenantId: "tenant-a" }, error: null },
    { data: null, error: { message: "db down" } },
  ]) {
    resetState({ responses: { portal_consume_google_calendar_oauth_state_service: response } });
    assert.equal(await oauthState.consumeGoogleCalendarOAuthState("qualquer"), null);
  }
});

test("service role indisponível recusa em vez de explodir na rota de callback", async () => {
  resetState({ serviceRoleThrows: true });
  assert.equal(await oauthState.consumeGoogleCalendarOAuthState("qualquer"), null);
});
