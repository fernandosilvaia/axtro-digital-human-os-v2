import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

/**
 * Rota de callback OAuth da Stripe Connect (ADR-040): só a casca HTTP
 * (resolver a origem, consumir o cookie de state, o double-submit contra a
 * query, e traduzir o resultado de `fulfillStripeConnectOAuthCallback` num
 * redirect). O corpo real (verificar assinatura/expiração, sessão, troca de
 * token, RPC de conexão) tem cobertura própria em
 * `stripe-connect-oauth-fulfill-callback.test.mjs` -- separado daqui
 * porque `startStripeConnectConnection` (modo fake) chama aquela função
 * direto, sem passar por esta rota (mesmo motivo do Google Calendar, ver o
 * comentário de `fulfill-stripe-connect-oauth-callback.ts`).
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
      const state = globalThis.__stripeConnectRouteState;
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
  ["@/lib/billing/fulfill-stripe-connect-oauth-callback", `
    export async function fulfillStripeConnectOAuthCallback(code, state) {
      const s = globalThis.__stripeConnectRouteState;
      s.calls.fulfill.push({ code, state });
      return s.fulfillResult;
    }
  `],
  ["@/lib/billing/stripe-connect-oauth-state", `
    export const STRIPE_CONNECT_OAUTH_STATE_COOKIE_NAME = "axtro_stripe_connect_oauth_state";
  `],
  ["@/lib/public-origin", `
    export function portalPublicOrigin() {
      const state = globalThis.__stripeConnectRouteState;
      if (state.originThrows) throw new TypeError("PORTAL_PUBLIC_URL must be an exact approved HTTPS origin");
      return state.portalOrigin;
    }
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
    portalOrigin: "https://portal.test",
    originThrows: false,
    cookieToken: STATE_TOKEN,
    fulfillResult: { outcome: "connected" },
    calls: { cookieGet: [], cookieSet: [], fulfill: [] },
    ...overrides,
  };
  globalThis.__stripeConnectRouteState = state;
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

test("PORTAL_PUBLIC_URL não configurada devolve 503 not_configured antes de tocar cookie/callback", async () => {
  const state = freshState({ originThrows: true });
  const response = await GET(request({ code: "c", state: STATE_TOKEN }));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "not_configured" });
  assert.equal(state.calls.cookieGet.length, 0);
  assert.equal(state.calls.fulfill.length, 0);
});

test("o cookie de state é sempre consumido (apagado) no início, sucesso ou falha", async () => {
  const state = freshState();
  await GET(request({ code: "c", state: STATE_TOKEN }));
  assert.equal(state.calls.cookieSet.length, 1);
  assert.equal(state.calls.cookieSet[0].name, "axtro_stripe_connect_oauth_state");
  assert.equal(state.calls.cookieSet[0].value, "");
  assert.equal(state.calls.cookieSet[0].attrs.maxAge, 0);
});

test("error= da Stripe (consentimento negado) recusa sem chamar o corpo do callback, nunca repassa o texto bruto", async () => {
  const state = freshState();
  const response = await GET(request({ error: "access_denied", error_description: "The user denied your request" }));
  assert.equal(locationOf(response), "https://portal.test/configuracoes?stripe_connect_error=consentimento_negado");
  assert.equal(state.calls.fulfill.length, 0);
});

test("code, state da query, ou cookie ausentes recusam com callback_invalido antes de chamar o corpo do callback", async (t) => {
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
      assert.equal(state.calls.fulfill.length, 0);
    });
  }
});

test("double-submit: o state da query precisa bater byte a byte com o cookie, ou recusa state_invalido antes de chamar o corpo do callback", async () => {
  const state = freshState({ cookieToken: STATE_TOKEN });
  const response = await GET(request({ code: "c", state: "scsv1.different-payload.different-signature" }));
  assert.equal(locationOf(response), "https://portal.test/configuracoes?stripe_connect_error=state_invalido");
  assert.equal(state.calls.fulfill.length, 0);
});

test("code/state/cookie presentes e batendo: chama o corpo do callback com os valores exatos", async () => {
  const state = freshState();
  await GET(request({ code: "ac_super_secret_code_value", state: STATE_TOKEN }));
  assert.deepEqual(state.calls.fulfill, [{ code: "ac_super_secret_code_value", state: STATE_TOKEN }]);
});

test("resultado connected redireciona pra stripe_connect_status=connected", async () => {
  const state = freshState({ fulfillResult: { outcome: "connected" } });
  const response = await GET(request({ code: "c", state: STATE_TOKEN }));
  assert.equal(locationOf(response), "https://portal.test/configuracoes?stripe_connect_status=connected");
});

test("resultado error repassa o código exato pra stripe_connect_error, nunca um detalhe sensível", async () => {
  const state = freshState({ fulfillResult: { outcome: "error", code: "conta_ja_conectada_a_outro_tenant" } });
  const response = await GET(request({ code: "c", state: STATE_TOKEN }));
  assert.equal(locationOf(response), "https://portal.test/configuracoes?stripe_connect_error=conta_ja_conectada_a_outro_tenant");
});
