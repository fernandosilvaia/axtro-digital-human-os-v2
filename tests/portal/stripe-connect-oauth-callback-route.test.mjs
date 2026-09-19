import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

/**
 * Rota de callback OAuth da Stripe Connect (ADR-040), mesmo estilo de teste
 * de `google-calendar-oauth-callback-route.test.mjs`: `registerHooks`
 * intercepta cada import da rota por um módulo fake em memória (nunca toca
 * rede/banco real).
 */
const mockSources = new Map([
  ["next/server", `
    export class NextRequest {}
    export class NextResponse extends Response {
      static json(body, init) { return new Response(JSON.stringify(body), { ...init, headers: { "content-type": "application/json" } }); }
      static redirect(url) { return new Response(null, { status: 307, headers: { location: String(url) } }); }
    }
  `],
  ["next/headers", `
    export async function cookies() {
      const state = globalThis.__stripeConnectCallbackState;
      return {
        get(name) {
          state.calls.cookieGet.push(name);
          return state.cookieToken === undefined ? undefined : { value: state.cookieToken };
        },
        set(name, value, attrs) {
          state.calls.cookieSet.push({ name, value, attrs });
        },
      };
    }
  `],
  ["@axtro/domain", `export function createUuidV7() { return "0198a000-0000-7000-8000-000000000099"; }`],
  ["@axtro/provider-stripe", `
    export class StripeBillingError extends Error {
      constructor(code, message) { super(message); this.name = "StripeBillingError"; this.code = code; }
    }
    export function stripeConnectFakeProvidersEnabled() { return globalThis.__stripeConnectCallbackState.fakeMode; }
    function maybeThrowExchangeError() {
      const state = globalThis.__stripeConnectCallbackState;
      if (state.exchangeErrorCode) throw new StripeBillingError(state.exchangeErrorCode, state.exchangeErrorMessage ?? "exchange failed");
      if (state.exchangeGenericErrorMessage) throw new Error(state.exchangeGenericErrorMessage);
    }
    export async function exchangeStripeConnectAuthorizationCode(options) {
      const state = globalThis.__stripeConnectCallbackState;
      state.calls.exchangeReal.push(options);
      maybeThrowExchangeError();
      return state.exchangeResult;
    }
    export function createFakeStripeConnectAuthorizationCodeExchange() {
      const state = globalThis.__stripeConnectCallbackState;
      state.calls.exchangeFakeFactory += 1;
      return async (options) => {
        state.calls.exchangeFakeCalls.push(options);
        maybeThrowExchangeError();
        return state.exchangeResult;
      };
    }
  `],
  ["@/lib/billing/stripe-connect-oauth-state", `
    export const STRIPE_CONNECT_OAUTH_STATE_COOKIE_NAME = "axtro_stripe_connect_oauth_state";
    export const STRIPE_CONNECT_OAUTH_STATE_SECRET_ENV = "STRIPE_CONNECT_OAUTH_STATE_SECRET";
    export class StripeConnectOAuthStateError extends Error {
      constructor(code) { super(code); this.name = "StripeConnectOAuthStateError"; this.code = code; }
    }
    export function verifyStripeConnectOAuthStateToken(token) {
      const state = globalThis.__stripeConnectCallbackState;
      state.calls.verifyState.push(token);
      if (state.verifyStateThrowsCode) throw new StripeConnectOAuthStateError(state.verifyStateThrowsCode);
      return state.verifiedState;
    }
  `],
  ["@/lib/public-origin", `
    export function portalPublicOrigin() {
      const state = globalThis.__stripeConnectCallbackState;
      if (state.originThrows) throw new TypeError("PORTAL_PUBLIC_URL must be an exact approved HTTPS origin");
      return state.portalOrigin;
    }
  `],
  ["@/lib/supabase/server", `
    export async function createClient() {
      const state = globalThis.__stripeConnectCallbackState;
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
      const state = globalThis.__stripeConnectCallbackState;
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
    export function logError(...args) { globalThis.__stripeConnectCallbackState.calls.telemetry.push(args); }
    export function logEvent() {}
  `],
]);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (mockSources.has(specifier)) return { url: `stripe-connect-callback-mock:${encodeURIComponent(specifier)}`, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith("stripe-connect-callback-mock:")) {
      const specifier = decodeURIComponent(url.slice("stripe-connect-callback-mock:".length));
      return { format: "module", source: mockSources.get(specifier), shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

const STATE_TOKEN = "scsv1.mock-payload.mock-signature";

function freshState(overrides = {}) {
  const state = {
    fakeMode: true,
    portalOrigin: "https://portal.test",
    originThrows: false,
    cookieToken: STATE_TOKEN,
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
      cookieGet: [], cookieSet: [], verifyState: [], overviewRpc: [], createClientFactories: 0, serviceRoleFactories: 0,
      exchangeReal: [], exchangeFakeFactory: 0, exchangeFakeCalls: [], connectRpc: [], telemetry: [],
    },
    ...overrides,
  };
  globalThis.__stripeConnectCallbackState = state;
  return state;
}

function request(query) {
  const params = new URLSearchParams(query);
  return { url: `https://portal.test/api/stripe/connect-oauth/callback?${params.toString()}` };
}

const { GET } = await import("../../apps/portal/src/app/api/stripe/connect-oauth/callback/route.ts");

function locationOf(response) {
  return response.headers.get("location");
}

test("PORTAL_PUBLIC_URL não configurada devolve 503 not_configured antes de tocar cookie/sessão", async () => {
  const state = freshState({ originThrows: true });
  const response = await GET(request({ code: "c", state: STATE_TOKEN }));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "not_configured" });
  assert.equal(state.calls.cookieGet.length, 0);
  assert.equal(state.calls.createClientFactories, 0);
});

test("o cookie de state é sempre consumido (apagado) no início, sucesso ou falha", async () => {
  const state = freshState();
  await GET(request({ code: "c", state: STATE_TOKEN }));
  assert.equal(state.calls.cookieSet.length, 1);
  assert.equal(state.calls.cookieSet[0].name, "axtro_stripe_connect_oauth_state");
  assert.equal(state.calls.cookieSet[0].value, "");
  assert.equal(state.calls.cookieSet[0].attrs.maxAge, 0);
});

test("error= da Stripe (consentimento negado) recusa sem tocar sessão/RPC, nunca repassa o texto bruto", async () => {
  const state = freshState();
  const response = await GET(request({ error: "access_denied", error_description: "The user denied your request" }));
  assert.equal(locationOf(response), "https://portal.test/configuracoes?stripe_connect_error=consentimento_negado");
  assert.equal(state.calls.createClientFactories, 0);
});

test("code, state da query, ou cookie ausentes recusam com callback_invalido antes de qualquer verificação", async (t) => {
  const cases = [
    ["sem code", { state: STATE_TOKEN }, STATE_TOKEN],
    ["sem state na query", { code: "c" }, STATE_TOKEN],
    ["sem cookie nenhum", { code: "c", state: STATE_TOKEN }, undefined],
  ];
  for (const [label, query, cookieToken] of cases) {
    await t.test(label, async () => {
      const state = freshState({ cookieToken });
      const response = await GET(request(query));
      assert.equal(locationOf(response), "https://portal.test/configuracoes?stripe_connect_error=callback_invalido");
      assert.equal(state.calls.verifyState.length, 0);
    });
  }
});

test("double-submit: o state da query precisa bater byte a byte com o cookie, ou recusa state_invalido sem verificar assinatura", async () => {
  const state = freshState({ cookieToken: STATE_TOKEN });
  const response = await GET(request({ code: "c", state: "scsv1.different-payload.different-signature" }));
  assert.equal(locationOf(response), "https://portal.test/configuracoes?stripe_connect_error=state_invalido");
  assert.equal(state.calls.verifyState.length, 0, "double-submit falha antes de gastar a verificação de assinatura");
});

test("state expirado devolve state_expirado, distinto de qualquer outro state inválido", async () => {
  const state = freshState({ verifyStateThrowsCode: "state_token_expired" });
  const response = await GET(request({ code: "c", state: STATE_TOKEN }));
  assert.equal(locationOf(response), "https://portal.test/configuracoes?stripe_connect_error=state_expirado");
});

test("state malformado/assinatura inválida devolve state_invalido", async () => {
  const state = freshState({ verifyStateThrowsCode: "state_token_invalid" });
  const response = await GET(request({ code: "c", state: STATE_TOKEN }));
  assert.equal(locationOf(response), "https://portal.test/configuracoes?stripe_connect_error=state_invalido");
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
      const response = await GET(request({ code: "c", state: STATE_TOKEN }));
      assert.equal(locationOf(response), "https://portal.test/configuracoes?stripe_connect_error=sessao_divergente");
      assert.equal(state.calls.exchangeReal.length + state.calls.exchangeFakeCalls.length, 0);
      assert.equal(state.calls.connectRpc.length, 0);
    });
  }
});

test("falha ao ler a sessão/tenant atual (RPC de overview indisponível) recusa com sessao_invalida", async () => {
  const state = freshState({ overviewError: { message: "db down" } });
  const response = await GET(request({ code: "c", state: STATE_TOKEN }));
  assert.equal(locationOf(response), "https://portal.test/configuracoes?stripe_connect_error=sessao_invalida");
  assert.equal(state.calls.exchangeReal.length + state.calls.exchangeFakeCalls.length, 0);
});

test("modo fake: troca via createFakeStripeConnectAuthorizationCodeExchange, conecta e redireciona pro sucesso", async () => {
  const state = freshState();
  const response = await GET(request({ code: "ac_super_secret_code_value", state: STATE_TOKEN }));
  assert.equal(locationOf(response), "https://portal.test/configuracoes?stripe_connect_status=connected");
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
  await GET(request({ code: "ac_super_secret_code_value", state: STATE_TOKEN }));
  const serialized = JSON.stringify(state.calls.telemetry);
  assert.equal(serialized.includes("ac_super_secret_code_value"), false);
});

test("qualquer falha tipada da troca de token vira falha_na_troca", async () => {
  const state = freshState({ exchangeErrorCode: "provider_rejected", exchangeErrorMessage: "provider rejected" });
  const response = await GET(request({ code: "c", state: STATE_TOKEN }));
  assert.equal(locationOf(response), "https://portal.test/configuracoes?stripe_connect_error=falha_na_troca");
});

test("uma falha não tipada (não é StripeBillingError) também vira falha_na_troca, com providerCode=unknown no log", async () => {
  const state = freshState({ exchangeGenericErrorMessage: "boom" });
  const response = await GET(request({ code: "c", state: STATE_TOKEN }));
  assert.equal(locationOf(response), "https://portal.test/configuracoes?stripe_connect_error=falha_na_troca");
  assert.equal(state.calls.telemetry.length, 1);
  const [event, errorArg] = state.calls.telemetry[0];
  assert.equal(event, "stripe_connect_oauth_exchange_failed");
  assert.equal(errorArg.message.includes("unknown"), true);
});

test("erro da RPC de conexão vira falha_ao_conectar", async () => {
  const state = freshState({ connectResult: { data: null, error: { message: "db down" } } });
  const response = await GET(request({ code: "c", state: STATE_TOKEN }));
  assert.equal(locationOf(response), "https://portal.test/configuracoes?stripe_connect_error=falha_ao_conectar");
});

test("account_already_connected_elsewhere vira um erro dedicado, distinto de falha_ao_conectar genérica", async () => {
  const state = freshState({ connectResult: { data: { outcome: "account_already_connected_elsewhere" }, error: null } });
  const response = await GET(request({ code: "c", state: STATE_TOKEN }));
  assert.equal(locationOf(response), "https://portal.test/configuracoes?stripe_connect_error=conta_ja_conectada_a_outro_tenant");
});

test("outcome inesperado da RPC de conexão (nem 'connected' nem o conflito conhecido) vira falha_ao_conectar", async () => {
  const state = freshState({ connectResult: { data: { outcome: "rejected" }, error: null } });
  const response = await GET(request({ code: "c", state: STATE_TOKEN }));
  assert.equal(locationOf(response), "https://portal.test/configuracoes?stripe_connect_error=falha_ao_conectar");
});

test("indisponibilidade do service role vira falha_ao_conectar, nunca um 500 não tratado", async () => {
  const state = freshState({ serviceRoleThrows: true });
  const response = await GET(request({ code: "c", state: STATE_TOKEN }));
  assert.equal(locationOf(response), "https://portal.test/configuracoes?stripe_connect_error=falha_ao_conectar");
});

test("modo real: sem STRIPE_SECRET_KEY configurada recusa com nao_configurado antes de qualquer troca", async () => {
  const before = process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_SECRET_KEY;
  try {
    const state = freshState({ fakeMode: false });
    const response = await GET(request({ code: "c", state: STATE_TOKEN }));
    assert.equal(locationOf(response), "https://portal.test/configuracoes?stripe_connect_error=nao_configurado");
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
    const response = await GET(request({ code: "c", state: STATE_TOKEN }));
    assert.equal(locationOf(response), "https://portal.test/configuracoes?stripe_connect_status=connected");
    assert.equal(state.calls.exchangeFakeFactory, 0);
    assert.equal(state.calls.exchangeReal.length, 1);
    assert.equal(state.calls.exchangeReal[0].platformSecretKey, "sk_test_real_key_00000000000000");
  } finally {
    if (before === undefined) delete process.env.STRIPE_SECRET_KEY; else process.env.STRIPE_SECRET_KEY = before;
  }
});
