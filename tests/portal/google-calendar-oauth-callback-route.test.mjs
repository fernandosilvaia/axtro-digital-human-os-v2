import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

/**
 * Rota de callback OAuth do Google Calendar (ADR-039, onda 1b-ii): só a
 * casca HTTP (resolver a origem, ler `error`/`code`/`state` da query,
 * traduzir o resultado de `fulfillGoogleCalendarOAuthCallback` num
 * redirect). O corpo real (state, sessão, troca de token, RPC de conexão)
 * tem cobertura própria em `google-calendar-oauth-fulfill-callback.test.mjs`
 * -- separado daqui porque `startGoogleCalendarConnection` (modo fake) chama
 * aquela função direto, sem passar por esta rota (ver o comentário de
 * `fulfill-oauth-callback.ts` pro porquê).
 */
const mockSources = new Map([
  ["next/server", `
    export class NextRequest {}
    export class NextResponse extends Response {
      static json(body, init) { return new Response(JSON.stringify(body), { ...init, headers: { "content-type": "application/json" } }); }
      static redirect(url) { return new Response(null, { status: 307, headers: { location: String(url) } }); }
    }
  `],
  ["@/lib/google-calendar/fulfill-oauth-callback", `
    export async function fulfillGoogleCalendarOAuthCallback(code, state) {
      const s = globalThis.__calendarRouteState;
      s.calls.fulfill.push({ code, state });
      return s.fulfillResult;
    }
  `],
  ["@/lib/public-origin", `
    export function portalPublicOrigin() {
      const state = globalThis.__calendarRouteState;
      if (state.originThrows) throw new TypeError("PORTAL_PUBLIC_URL must be an exact approved HTTPS origin");
      return state.portalOrigin;
    }
  `],
]);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (mockSources.has(specifier)) return { url: `calendar-callback-mock:${encodeURIComponent(specifier)}`, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith("calendar-callback-mock:")) {
      const specifier = decodeURIComponent(url.slice("calendar-callback-mock:".length));
      return { format: "module", source: mockSources.get(specifier), shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

function freshState(overrides = {}) {
  const state = {
    portalOrigin: "https://portal.test",
    originThrows: false,
    fulfillResult: { outcome: "connected" },
    calls: { fulfill: [] },
    ...overrides,
  };
  globalThis.__calendarRouteState = state;
  return state;
}

function request(query) {
  const params = new URLSearchParams(query);
  return { url: `https://portal.test/api/google-calendar/oauth/callback?${params.toString()}` };
}

const { GET } = await import("../../apps/portal/src/app/api/google-calendar/oauth/callback/route.ts");

function locationOf(response) {
  return response.headers.get("location");
}

test("PORTAL_PUBLIC_URL não configurada (fora de modo fake) devolve 503 not_configured antes de tocar o corpo do callback", async () => {
  const state = freshState({ originThrows: true });
  const response = await GET(request({ code: "c", state: "s" }));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "not_configured" });
  assert.equal(state.calls.fulfill.length, 0);
});

test("error= do Google (consentimento negado) recusa sem chamar o corpo do callback, nunca repassa o texto bruto do Google", async () => {
  const state = freshState();
  const response = await GET(request({ error: "access_denied" }));
  assert.equal(locationOf(response), "https://portal.test/configuracoes?calendar_error=consentimento_negado");
  assert.equal(state.calls.fulfill.length, 0);
});

test("code ou state ausentes recusam com callback_invalido antes de chamar o corpo do callback", async (t) => {
  for (const query of [{ state: "s" }, { code: "c" }, {}]) {
    await t.test(JSON.stringify(query), async () => {
      const state = freshState();
      const response = await GET(request(query));
      assert.equal(locationOf(response), "https://portal.test/configuracoes?calendar_error=callback_invalido");
      assert.equal(state.calls.fulfill.length, 0);
    });
  }
});

test("code/state presentes: chama o corpo do callback com os valores exatos da query", async () => {
  const state = freshState();
  await GET(request({ code: "super-secret-code-value", state: "state-xyz" }));
  assert.deepEqual(state.calls.fulfill, [{ code: "super-secret-code-value", state: "state-xyz" }]);
});

test("resultado connected redireciona pra calendar_status=connected", async () => {
  const state = freshState({ fulfillResult: { outcome: "connected" } });
  const response = await GET(request({ code: "c", state: "s" }));
  assert.equal(locationOf(response), "https://portal.test/configuracoes?calendar_status=connected");
});

test("resultado error repassa o código exato pra calendar_error, nunca um detalhe sensível", async () => {
  const state = freshState({ fulfillResult: { outcome: "error", code: "falha_ao_conectar" } });
  const response = await GET(request({ code: "c", state: "s" }));
  assert.equal(locationOf(response), "https://portal.test/configuracoes?calendar_error=falha_ao_conectar");
});
