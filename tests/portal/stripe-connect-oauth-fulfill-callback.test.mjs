import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

/**
 * `fulfillStripeConnectOAuthCallback` (ADR-040): o corpo do callback OAuth
 * da Stripe Connect, extraído da rota HTTP pra poder ser chamado direto por
 * `startStripeConnectConnection` em modo fake também (mesmo motivo do
 * callback do Google Calendar, ver o comentário do próprio arquivo). Mesmo
 * estilo de teste de `google-calendar-oauth-fulfill-callback.test.mjs`.
 */
const mockSources = new Map([
  ["@axtro/domain", `export function createUuidV7() { return "0198a000-0000-7000-8000-000000000099"; }`],
  ["@axtro/provider-stripe", `
    export class StripeBillingError extends Error {
      constructor(code, message) { super(message); this.name = "StripeBillingError"; this.code = code; }
    }
    export function stripeConnectFakeProvidersEnabled() { return globalThis.__stripeConnectFulfillState.fakeMode; }
    function maybeThrowExchangeError() {
      const state = globalThis.__stripeConnectFulfillState;
      if (state.exchangeErrorCode) throw new StripeBillingError(state.exchangeErrorCode, state.exchangeErrorMessage ?? "exchange failed");
      if (state.exchangeGenericErrorMessage) throw new Error(state.exchangeGenericErrorMessage);
    }
    export async function exchangeStripeConnectAuthorizationCode(options) {
      const state = globalThis.__stripeConnectFulfillState;
      state.calls.exchangeReal.push(options);
      maybeThrowExchangeError();
      return state.exchangeResult;
    }
    export function createFakeStripeConnectAuthorizationCodeExchange() {
      const state = globalThis.__stripeConnectFulfillState;
      state.calls.exchangeFakeFactory += 1;
      return async (options) => {
        state.calls.exchangeFakeCalls.push(options);
        maybeThrowExchangeError();
        return state.exchangeResult;
      };
    }
  `],
  ["./stripe-connect-oauth-state", `
    export const STRIPE_CONNECT_OAUTH_STATE_SECRET_ENV = "STRIPE_CONNECT_OAUTH_STATE_SECRET";
    export class StripeConnectOAuthStateError extends Error {
      constructor(code) { super(code); this.name = "StripeConnectOAuthStateError"; this.code = code; }
    }
    export function verifyStripeConnectOAuthStateToken(token) {
      const state = globalThis.__stripeConnectFulfillState;
      state.calls.verifyState.push(token);
      if (state.verifyStateThrowsCode) throw new StripeConnectOAuthStateError(state.verifyStateThrowsCode);
      return state.verifiedState;
    }
  `],
  ["@/lib/supabase/server", `
    export async function createClient() {
      const state = globalThis.__stripeConnectFulfillState;
      state.calls.createClientFactories += 1;
      return {
        auth: { async getUser() { return { data: { user: state.user } }; } },
        async rpc(name) {
          state.calls.overviewRpc.push(name);
          if (state.overviewError) return { data: null, error: state.overviewError };
          return { data: state.overview, error: null };
        },
      };
    }
  `],
  ["@/lib/supabase/service", `
    export function createServiceRoleClient() {
      const state = globalThis.__stripeConnectFulfillState;
      state.calls.serviceRoleFactories += 1;
      if (state.serviceRoleThrows) throw new Error("service role unavailable");
      return {
        async rpc(name, args) {
          state.calls.connectRpc.push({ name, args });
          return state.connectResult;
        },
      };
    }
  `],
  ["@/lib/telemetry", `
    export function logError(...args) { globalThis.__stripeConnectFulfillState.calls.telemetry.push(args); }
    export function logEvent() {}
  `],
]);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (mockSources.has(specifier)) return { url: `stripe-connect-fulfill-mock:${encodeURIComponent(specifier)}`, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith("stripe-connect-fulfill-mock:")) {
      const specifier = decodeURIComponent(url.slice("stripe-connect-fulfill-mock:".length));
      return { format: "module", source: mockSources.get(specifier), shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

const STATE_TOKEN = "scsv1.mock-payload.mock-signature";

function freshState(overrides = {}) {
  const state = {
    fakeMode: true,
    user: { id: "user-1", app_metadata: { actor_id: "actor-1" } },
    overview: { provisioned: true, role: "tenant_admin", tenant: { id: "tenant-1" } },
    overviewError: null,
    verifiedState: { tenant_id: "tenant-1", actor_id: "actor-1" },
    verifyStateThrowsCode: null,
    exchangeResult: { stripeAccountId: "acct_1NFakeConnect123", livemode: false },
    exchangeErrorCode: null,
    exchangeErrorMessage: null,
    exchangeGenericErrorMessage: null,
    connectResult: { data: { outcome: "connected" }, error: null },
    serviceRoleThrows: false,
    calls: {
      verifyState: [], overviewRpc: [], createClientFactories: 0, serviceRoleFactories: 0,
      exchangeReal: [], exchangeFakeFactory: 0, exchangeFakeCalls: [], connectRpc: [], telemetry: [],
    },
    ...overrides,
  };
  globalThis.__stripeConnectFulfillState = state;
  return state;
}

const { fulfillStripeConnectOAuthCallback } = await import(
  "../../apps/portal/src/lib/billing/fulfill-stripe-connect-oauth-callback.ts"
);

test("state expirado devolve state_expirado, distinto de qualquer outro state inválido", async () => {
  const state = freshState({ verifyStateThrowsCode: "state_token_expired" });
  const result = await fulfillStripeConnectOAuthCallback("c", STATE_TOKEN);
  assert.deepEqual(result, { outcome: "error", code: "state_expirado" });
  assert.equal(state.calls.exchangeReal.length + state.calls.exchangeFakeCalls.length, 0);
});

test("state malformado/assinatura inválida devolve state_invalido", async () => {
  const state = freshState({ verifyStateThrowsCode: "state_token_invalid" });
  const result = await fulfillStripeConnectOAuthCallback("c", STATE_TOKEN);
  assert.deepEqual(result, { outcome: "error", code: "state_invalido" });
});

test("sessão divergente do state (CSRF): usuário nulo, actor diferente, tenant diferente ou não-admin recusam antes da troca de token", async (t) => {
  const cases = [
    ["usuário deslogado", { user: null }],
    ["actor diferente do que iniciou o fluxo", { user: { id: "user-2", app_metadata: { actor_id: "actor-ATACANTE" } } }],
    ["tenant da sessão atual diverge do state", { overview: { provisioned: true, role: "tenant_admin", tenant: { id: "tenant-OUTRO" } } }],
    ["sessão atual não é mais tenant_admin", { overview: { provisioned: true, role: "tenant_operator", tenant: { id: "tenant-1" } } }],
    ["conta não provisionada", { overview: { provisioned: false, role: null, tenant: undefined } }],
  ];
  for (const [label, overrides] of cases) {
    await t.test(label, async () => {
      const state = freshState(overrides);
      const result = await fulfillStripeConnectOAuthCallback("c", STATE_TOKEN);
      assert.deepEqual(result, { outcome: "error", code: "sessao_divergente" });
      assert.equal(state.calls.exchangeReal.length + state.calls.exchangeFakeCalls.length, 0);
      assert.equal(state.calls.connectRpc.length, 0);
    });
  }
});

test("falha ao ler a sessão/tenant atual (RPC de overview indisponível) recusa com sessao_invalida", async () => {
  const state = freshState({ overviewError: { message: "db down" } });
  const result = await fulfillStripeConnectOAuthCallback("c", STATE_TOKEN);
  assert.deepEqual(result, { outcome: "error", code: "sessao_invalida" });
  assert.equal(state.calls.exchangeReal.length + state.calls.exchangeFakeCalls.length, 0);
});

test("modo fake: troca via createFakeStripeConnectAuthorizationCodeExchange, conecta e devolve sucesso", async () => {
  const state = freshState();
  const result = await fulfillStripeConnectOAuthCallback("ac_super_secret_code_value", STATE_TOKEN);
  assert.deepEqual(result, { outcome: "connected" });
  assert.equal(state.calls.exchangeFakeFactory, 1);
  assert.equal(state.calls.exchangeReal.length, 0);
  assert.deepEqual(state.calls.exchangeFakeCalls[0], {
    platformSecretKey: "sk_test_fake_platform_key_00",
    code: "ac_super_secret_code_value",
  });
  assert.equal(state.calls.connectRpc.length, 1);
  assert.equal(state.calls.connectRpc[0].name, "portal_complete_stripe_connect_service");
  assert.deepEqual(state.calls.connectRpc[0].args, {
    p_id: "0198a000-0000-7000-8000-000000000099",
    p_tenant_id: "tenant-1",
    p_actor_id: "actor-1",
    p_stripe_account_id: "acct_1NFakeConnect123",
  });
});

test("nunca loga code/stripe_account_id bruto em nenhum caminho (sucesso ou erro)", async () => {
  const state = freshState();
  await fulfillStripeConnectOAuthCallback("ac_super_secret_code_value", STATE_TOKEN);
  const serialized = JSON.stringify(state.calls.telemetry);
  assert.equal(serialized.includes("ac_super_secret_code_value"), false);
});

test("qualquer falha tipada da troca de token vira falha_na_troca", async () => {
  const state = freshState({ exchangeErrorCode: "provider_rejected", exchangeErrorMessage: "provider rejected" });
  const result = await fulfillStripeConnectOAuthCallback("c", STATE_TOKEN);
  assert.deepEqual(result, { outcome: "error", code: "falha_na_troca" });
});

test("uma falha não tipada (não é StripeBillingError) também vira falha_na_troca, com providerCode=unknown no log", async () => {
  const state = freshState({ exchangeGenericErrorMessage: "boom" });
  const result = await fulfillStripeConnectOAuthCallback("c", STATE_TOKEN);
  assert.deepEqual(result, { outcome: "error", code: "falha_na_troca" });
  assert.equal(state.calls.telemetry.length, 1);
  const [event, errorArg] = state.calls.telemetry[0];
  assert.equal(event, "stripe_connect_oauth_exchange_failed");
  assert.equal(errorArg.message.includes("unknown"), true);
});

test("erro da RPC de conexão vira falha_ao_conectar", async () => {
  const state = freshState({ connectResult: { data: null, error: { message: "db down" } } });
  const result = await fulfillStripeConnectOAuthCallback("c", STATE_TOKEN);
  assert.deepEqual(result, { outcome: "error", code: "falha_ao_conectar" });
});

test("account_already_connected_elsewhere vira um erro dedicado, distinto de falha_ao_conectar genérica", async () => {
  const state = freshState({ connectResult: { data: { outcome: "account_already_connected_elsewhere" }, error: null } });
  const result = await fulfillStripeConnectOAuthCallback("c", STATE_TOKEN);
  assert.deepEqual(result, { outcome: "error", code: "conta_ja_conectada_a_outro_tenant" });
});

test("outcome inesperado da RPC de conexão (nem 'connected' nem o conflito conhecido) vira falha_ao_conectar", async () => {
  const state = freshState({ connectResult: { data: { outcome: "rejected" }, error: null } });
  const result = await fulfillStripeConnectOAuthCallback("c", STATE_TOKEN);
  assert.deepEqual(result, { outcome: "error", code: "falha_ao_conectar" });
});

test("indisponibilidade do service role vira falha_ao_conectar, nunca lança pro chamador", async () => {
  const state = freshState({ serviceRoleThrows: true });
  const result = await fulfillStripeConnectOAuthCallback("c", STATE_TOKEN);
  assert.deepEqual(result, { outcome: "error", code: "falha_ao_conectar" });
});

test("modo real: sem STRIPE_SECRET_KEY configurada recusa com nao_configurado antes de qualquer troca", async () => {
  const before = process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_SECRET_KEY;
  try {
    const state = freshState({ fakeMode: false });
    const result = await fulfillStripeConnectOAuthCallback("c", STATE_TOKEN);
    assert.deepEqual(result, { outcome: "error", code: "nao_configurado" });
    assert.equal(state.calls.exchangeReal.length, 0);
    assert.equal(state.calls.exchangeFakeFactory, 0);
  } finally {
    if (before === undefined) delete process.env.STRIPE_SECRET_KEY; else process.env.STRIPE_SECRET_KEY = before;
  }
});

test("modo real: com STRIPE_SECRET_KEY configurada, usa exchangeStripeConnectAuthorizationCode real (não a fábrica fake)", async () => {
  const before = process.env.STRIPE_SECRET_KEY;
  process.env.STRIPE_SECRET_KEY = "sk_test_real_key_00000000000000";
  try {
    const state = freshState({ fakeMode: false });
    const result = await fulfillStripeConnectOAuthCallback("c", STATE_TOKEN);
    assert.deepEqual(result, { outcome: "connected" });
    assert.equal(state.calls.exchangeFakeFactory, 0);
    assert.equal(state.calls.exchangeReal.length, 1);
    assert.equal(state.calls.exchangeReal[0].platformSecretKey, "sk_test_real_key_00000000000000");
  } finally {
    if (before === undefined) delete process.env.STRIPE_SECRET_KEY; else process.env.STRIPE_SECRET_KEY = before;
  }
});
