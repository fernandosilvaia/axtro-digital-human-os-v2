import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

/**
 * Rota de callback OAuth do Google Calendar (ADR-039, onda 1b-ii) — mesmo
 * estilo de teste de `recall-webhook-route.test.mjs`/`http-boundary-routes.test.mjs`:
 * `registerHooks` intercepta cada import da rota por um módulo fake em
 * memória (nunca toca rede/banco real), e um objeto de estado global
 * controla o comportamento de cada mock por teste.
 */
const mockSources = new Map([
  ["next/server", `
    export class NextRequest {}
    export class NextResponse extends Response {
      static json(body, init) { return new Response(JSON.stringify(body), { ...init, headers: { "content-type": "application/json" } }); }
      static redirect(url) { return new Response(null, { status: 307, headers: { location: String(url) } }); }
    }
  `],
  ["@axtro/domain", `export function createUuidV7() { return "0198a000-0000-7000-8000-000000000099"; }`],
  ["@axtro/provider-google-calendar", `
    export class GoogleCalendarProviderError extends Error {
      constructor(code, message) { super(message); this.name = "GoogleCalendarProviderError"; this.code = code; }
    }
    export function googleCalendarFakeProvidersEnabled() { return globalThis.__calendarCallbackState.fakeMode; }
    function maybeThrowExchangeError() {
      const state = globalThis.__calendarCallbackState;
      if (state.exchangeErrorCode) throw new GoogleCalendarProviderError(state.exchangeErrorCode, state.exchangeErrorMessage ?? "exchange failed");
      if (state.exchangeGenericErrorMessage) throw new Error(state.exchangeGenericErrorMessage);
    }
    export async function exchangeGoogleAuthorizationCode(options) {
      const state = globalThis.__calendarCallbackState;
      state.calls.exchangeReal.push(options);
      maybeThrowExchangeError();
      return state.exchangeResult;
    }
    export function createFakeGoogleAuthorizationCodeExchange() {
      const state = globalThis.__calendarCallbackState;
      state.calls.exchangeFakeFactory += 1;
      return async (options) => {
        state.calls.exchangeFakeCalls.push(options);
        maybeThrowExchangeError();
        return state.exchangeResult;
      };
    }
  `],
  ["@/lib/google-calendar/id-token", `
    export function decodeGoogleIdTokenEmail(idTokenValue) {
      const state = globalThis.__calendarCallbackState;
      state.calls.decodeEmail.push(idTokenValue);
      return state.decodedEmail;
    }
  `],
  ["@/lib/google-calendar/oauth-state", `
    export function consumeGoogleCalendarOAuthState(stateValue) {
      const state = globalThis.__calendarCallbackState;
      state.calls.consumeState.push(stateValue);
      return state.consumedState;
    }
  `],
  ["@/lib/google-calendar/oauth-url", `
    export function googleCalendarOAuthRedirectUri() { return "https://portal.test/api/google-calendar/oauth/callback"; }
  `],
  ["@/lib/public-origin", `
    export function portalPublicOrigin() {
      const state = globalThis.__calendarCallbackState;
      if (state.originThrows) throw new TypeError("PORTAL_PUBLIC_URL must be an exact approved HTTPS origin");
      return state.portalOrigin;
    }
  `],
  ["@/lib/supabase/server", `
    export async function createClient() {
      const state = globalThis.__calendarCallbackState;
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
      const state = globalThis.__calendarCallbackState;
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
    export function logError(...args) { globalThis.__calendarCallbackState.calls.telemetry.push(args); }
    export function logEvent() {}
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
    fakeMode: true,
    portalOrigin: "https://portal.test",
    originThrows: false,
    user: { id: "user-1", app_metadata: { actor_id: "actor-1", tenant_id: "tenant-1" } },
    overview: { provisioned: true, role: "tenant_admin", tenant: { id: "tenant-1", default_timezone: "America/Sao_Paulo" } },
    overviewError: null,
    consumedState: { tenantId: "tenant-1", actorId: "actor-1" },
    exchangeResult: {
      accessToken: "fake-access-token",
      expiresInSeconds: 3600,
      scope: "https://www.googleapis.com/auth/calendar openid email",
      tokenType: "Bearer",
      refreshToken: "fake-refresh-token-xyz",
      idToken: "fake-id-token-value",
    },
    exchangeErrorCode: null,
    exchangeErrorMessage: null,
    exchangeGenericErrorMessage: null,
    decodedEmail: "owner@example.com",
    connectResult: { data: { outcome: "connected" }, error: null },
    serviceRoleThrows: false,
    calls: {
      consumeState: [], overviewRpc: [], createClientFactories: 0, serviceRoleFactories: 0,
      exchangeReal: [], exchangeFakeFactory: 0, exchangeFakeCalls: [], decodeEmail: [], connectRpc: [], telemetry: [],
    },
    ...overrides,
  };
  globalThis.__calendarCallbackState = state;
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

test("PORTAL_PUBLIC_URL não configurada (fora de modo fake) devolve 503 not_configured antes de tocar qualquer outro estado", async () => {
  const state = freshState({ originThrows: true });
  const response = await GET(request({ code: "c", state: "s" }));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "not_configured" });
  assert.equal(state.calls.consumeState.length, 0);
  assert.equal(state.calls.createClientFactories, 0);
});

test("error= do Google (consentimento negado) recusa sem tocar state/sessão/RPC, nunca repassa o texto bruto do Google", async () => {
  const state = freshState();
  const response = await GET(request({ error: "access_denied" }));
  assert.equal(locationOf(response), "https://portal.test/configuracoes?calendar_error=consentimento_negado");
  assert.equal(state.calls.consumeState.length, 0);
  assert.equal(state.calls.createClientFactories, 0);
});

test("code ou state ausentes recusam com callback_invalido antes de qualquer consumo de state", async (t) => {
  for (const query of [{ state: "s" }, { code: "c" }, {}]) {
    await t.test(JSON.stringify(query), async () => {
      const state = freshState();
      const response = await GET(request(query));
      assert.equal(locationOf(response), "https://portal.test/configuracoes?calendar_error=callback_invalido");
      assert.equal(state.calls.consumeState.length, 0);
    });
  }
});

test("state inválido/expirado/replay (consumeGoogleCalendarOAuthState devolve null) recusa antes de qualquer chamada de sessão", async () => {
  const state = freshState({ consumedState: null });
  const response = await GET(request({ code: "c", state: "s" }));
  assert.equal(locationOf(response), "https://portal.test/configuracoes?calendar_error=state_invalido");
  assert.deepEqual(state.calls.consumeState, ["s"]);
  assert.equal(state.calls.createClientFactories, 0);
  assert.equal(state.calls.exchangeReal.length + state.calls.exchangeFakeCalls.length, 0);
});

test("sessão divergente do state (CSRF): usuário nulo, actor diferente, tenant diferente ou não-admin recusam antes da troca de token", async (t) => {
  const cases = [
    ["usuário deslogado", { user: null }],
    ["actor diferente do que iniciou o fluxo", { user: { id: "user-2", app_metadata: { actor_id: "actor-ATACANTE" } } }],
    ["tenant da sessão atual diverge do state", { overview: { provisioned: true, role: "tenant_admin", tenant: { id: "tenant-OUTRO", default_timezone: "America/Sao_Paulo" } } }],
    ["sessão atual não é mais tenant_admin", { overview: { provisioned: true, role: "tenant_operator", tenant: { id: "tenant-1", default_timezone: "America/Sao_Paulo" } } }],
    ["conta não provisionada", { overview: { provisioned: false, role: null, tenant: undefined } }],
  ];
  for (const [label, overrides] of cases) {
    await t.test(label, async () => {
      const state = freshState(overrides);
      const response = await GET(request({ code: "c", state: "s" }));
      assert.equal(locationOf(response), "https://portal.test/configuracoes?calendar_error=sessao_divergente");
      assert.equal(state.calls.exchangeReal.length + state.calls.exchangeFakeCalls.length, 0);
      assert.equal(state.calls.connectRpc.length, 0);
    });
  }
});

test("falha ao ler a sessão/tenant atual (RPC de overview indisponível) recusa com sessao_invalida, distinto de uma sessão divergente", async () => {
  const state = freshState({ overviewError: { message: "db down" } });
  const response = await GET(request({ code: "c", state: "s" }));
  assert.equal(locationOf(response), "https://portal.test/configuracoes?calendar_error=sessao_invalida");
  assert.equal(state.calls.exchangeReal.length + state.calls.exchangeFakeCalls.length, 0);
});

test("modo fake: troca via createFakeGoogleAuthorizationCodeExchange, calendarId primary, timezone do tenant, e-mail decodificado do id_token, conecta e redireciona pro sucesso", async () => {
  const state = freshState();
  const response = await GET(request({ code: "super-secret-code-value", state: "s" }));
  assert.equal(locationOf(response), "https://portal.test/configuracoes?calendar_status=connected");
  assert.equal(state.calls.exchangeFakeFactory, 1);
  assert.equal(state.calls.exchangeReal.length, 0);
  assert.deepEqual(state.calls.exchangeFakeCalls[0], {
    clientId: "fake-google-oauth-client-id.apps.googleusercontent.com",
    clientSecret: "fake-google-oauth-client-secret",
    code: "super-secret-code-value",
    redirectUri: "https://portal.test/api/google-calendar/oauth/callback",
  });
  assert.deepEqual(state.calls.decodeEmail, ["fake-id-token-value"]);
  assert.equal(state.calls.connectRpc.length, 1);
  assert.equal(state.calls.connectRpc[0].name, "portal_connect_google_calendar_service");
  assert.deepEqual(state.calls.connectRpc[0].args, {
    p_id: "0198a000-0000-7000-8000-000000000099",
    p_tenant_id: "tenant-1",
    p_actor_id: "actor-1",
    p_google_account_email: "owner@example.com",
    p_calendar_id: "primary",
    p_default_timezone: "America/Sao_Paulo",
    p_refresh_token: "fake-refresh-token-xyz",
  });
});

test("nunca loga code/refresh_token/access_token/id_token bruto em nenhum caminho (sucesso ou erro)", async () => {
  const state = freshState();
  await GET(request({ code: "super-secret-code-value", state: "s" }));
  const serialized = JSON.stringify(state.calls.telemetry);
  assert.equal(serialized.includes("super-secret-code-value"), false);
  assert.equal(serialized.includes("fake-refresh-token-xyz"), false);
  assert.equal(serialized.includes("fake-access-token"), false);
  assert.equal(serialized.includes("fake-id-token-value"), false);
});

test("Google não devolve refresh_token (missing_refresh_token) vira calendar_error=sem_refresh_token, nunca conecta", async () => {
  const state = freshState({ exchangeErrorCode: "missing_refresh_token", exchangeErrorMessage: "missing refresh token" });
  const response = await GET(request({ code: "c", state: "s" }));
  assert.equal(locationOf(response), "https://portal.test/configuracoes?calendar_error=sem_refresh_token");
  assert.equal(state.calls.connectRpc.length, 0);
});

test("qualquer outra falha tipada da troca de token vira calendar_error=falha_na_troca", async () => {
  const state = freshState({ exchangeErrorCode: "provider_rejected", exchangeErrorMessage: "provider rejected" });
  const response = await GET(request({ code: "c", state: "s" }));
  assert.equal(locationOf(response), "https://portal.test/configuracoes?calendar_error=falha_na_troca");
});

test("uma falha não tipada (não é GoogleCalendarProviderError) também vira falha_na_troca, com providerCode=unknown no log", async () => {
  const state = freshState({ exchangeGenericErrorMessage: "boom" });
  const response = await GET(request({ code: "c", state: "s" }));
  assert.equal(locationOf(response), "https://portal.test/configuracoes?calendar_error=falha_na_troca");
  assert.equal(state.calls.telemetry.length, 1);
  const [event, errorArg] = state.calls.telemetry[0];
  assert.equal(event, "calendar_oauth_exchange_failed");
  assert.equal(errorArg.message.includes("unknown"), true);
});

test("id_token sem claim email utilizável (decodeGoogleIdTokenEmail devolve null) recusa antes de conectar", async () => {
  const state = freshState({ decodedEmail: null });
  const response = await GET(request({ code: "c", state: "s" }));
  assert.equal(locationOf(response), "https://portal.test/configuracoes?calendar_error=sem_email_google");
  assert.equal(state.calls.connectRpc.length, 0);
});

test("erro da RPC de conexão vira falha_ao_conectar", async () => {
  const state = freshState({ connectResult: { data: null, error: { message: "db down" } } });
  const response = await GET(request({ code: "c", state: "s" }));
  assert.equal(locationOf(response), "https://portal.test/configuracoes?calendar_error=falha_ao_conectar");
});

test("outcome inesperado da RPC de conexão (nem 'connected') também vira falha_ao_conectar", async () => {
  const state = freshState({ connectResult: { data: { outcome: "rejected" }, error: null } });
  const response = await GET(request({ code: "c", state: "s" }));
  assert.equal(locationOf(response), "https://portal.test/configuracoes?calendar_error=falha_ao_conectar");
});

test("indisponibilidade do service role (ex.: SUPABASE_SERVICE_ROLE_KEY ausente) vira falha_ao_conectar, nunca um 500 não tratado", async () => {
  const state = freshState({ serviceRoleThrows: true });
  const response = await GET(request({ code: "c", state: "s" }));
  assert.equal(locationOf(response), "https://portal.test/configuracoes?calendar_error=falha_ao_conectar");
});

test("modo real: sem GOOGLE_OAUTH_CLIENT_ID/SECRET configuradas recusa com nao_configurado antes de qualquer troca", async () => {
  const before = { id: process.env.GOOGLE_OAUTH_CLIENT_ID, secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET };
  delete process.env.GOOGLE_OAUTH_CLIENT_ID;
  delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  try {
    const state = freshState({ fakeMode: false });
    const response = await GET(request({ code: "c", state: "s" }));
    assert.equal(locationOf(response), "https://portal.test/configuracoes?calendar_error=nao_configurado");
    assert.equal(state.calls.exchangeReal.length, 0);
    assert.equal(state.calls.exchangeFakeFactory, 0);
  } finally {
    if (before.id === undefined) delete process.env.GOOGLE_OAUTH_CLIENT_ID; else process.env.GOOGLE_OAUTH_CLIENT_ID = before.id;
    if (before.secret === undefined) delete process.env.GOOGLE_OAUTH_CLIENT_SECRET; else process.env.GOOGLE_OAUTH_CLIENT_SECRET = before.secret;
  }
});

test("modo real: com credenciais configuradas, usa exchangeGoogleAuthorizationCode real (não a fábrica fake) com client_id/secret reais", async () => {
  const before = { id: process.env.GOOGLE_OAUTH_CLIENT_ID, secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET };
  process.env.GOOGLE_OAUTH_CLIENT_ID = "real-client-id.apps.googleusercontent.com";
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = "real-client-secret";
  try {
    const state = freshState({ fakeMode: false });
    const response = await GET(request({ code: "c", state: "s" }));
    assert.equal(locationOf(response), "https://portal.test/configuracoes?calendar_status=connected");
    assert.equal(state.calls.exchangeFakeFactory, 0);
    assert.equal(state.calls.exchangeReal.length, 1);
    assert.equal(state.calls.exchangeReal[0].clientId, "real-client-id.apps.googleusercontent.com");
    assert.equal(state.calls.exchangeReal[0].clientSecret, "real-client-secret");
  } finally {
    if (before.id === undefined) delete process.env.GOOGLE_OAUTH_CLIENT_ID; else process.env.GOOGLE_OAUTH_CLIENT_ID = before.id;
    if (before.secret === undefined) delete process.env.GOOGLE_OAUTH_CLIENT_SECRET; else process.env.GOOGLE_OAUTH_CLIENT_SECRET = before.secret;
  }
});
