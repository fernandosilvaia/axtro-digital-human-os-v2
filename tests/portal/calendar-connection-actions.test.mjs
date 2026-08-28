import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { test } from "node:test";

import ts from "typescript";

/**
 * Server Actions de conexão/desconexão do Google Calendar (ADR-039, onda
 * 1b-ii) — mesmo mecanismo de `billing-action-runtime.test.mjs`:
 * `ts.transpileModule` + `vm.Script` com um `require` fake, porque estas
 * actions têm `"use server"` no topo (não dá pra `import()` direto como os
 * módulos de `lib/google-calendar/*` sem esse diretivo).
 */
const actionsSource = await readFile(
  new URL("../../apps/portal/src/lib/actions/calendar-connection.ts", import.meta.url),
  "utf8",
);

class RedirectSignal extends Error {
  constructor(location) {
    super(`redirect:${location}`);
    this.location = location;
  }
}

function assertRedirect(location) {
  return (error) => error instanceof RedirectSignal && error.location === location;
}

function loadCalendarActions(options = {}) {
  const calls = {
    createClient: 0,
    fetchOverview: 0,
    limiter: [],
    createState: [],
    authUrl: [],
    redirectUri: 0,
    serviceRole: 0,
    disconnectRpc: [],
    revalidatePath: [],
    telemetry: [],
  };
  const user = Object.hasOwn(options, "user") ? options.user : { id: "user-authenticated", app_metadata: { actor_id: "0198a000-0000-7000-8000-0000000000a1" } };
  const overview = options.overview ?? {
    provisioned: true,
    role: "tenant_admin",
    tenant: { id: "tenant-resolved" },
  };
  const supabase = {
    auth: {
      async getUser() {
        return { data: { user } };
      },
    },
  };
  const disconnectResult = options.disconnectResult ?? { data: { outcome: "revoked" }, error: null };

  const mocks = new Map([
    ["next/navigation", {
      redirect(location) {
        throw new RedirectSignal(location);
      },
    }],
    ["next/cache", {
      revalidatePath(path) {
        calls.revalidatePath.push(path);
      },
    }],
    ["@/lib/google-calendar/oauth-url", {
      buildGoogleCalendarAuthorizationUrl(input) {
        calls.authUrl.push(input);
        return "https://accounts.google.com/o/oauth2/v2/auth?mock=1";
      },
      googleCalendarOAuthRedirectUri() {
        calls.redirectUri += 1;
        return "https://app.axtro.test/api/google-calendar/oauth/callback";
      },
    }],
    ["@/lib/google-calendar/oauth-state", {
      createGoogleCalendarOAuthState(tenantId, actorId) {
        calls.createState.push({ tenantId, actorId });
        return options.generatedState ?? "mock-state-token";
      },
    }],
    ["@/lib/portal-data", {
      async fetchTenantOverview() {
        calls.fetchOverview += 1;
        return overview;
      },
    }],
    ["@/lib/rate-limit", {
      isRateLimited(...args) {
        calls.limiter.push(args);
        return options.rateLimited === true;
      },
    }],
    ["@/lib/supabase/server", {
      async createClient() {
        calls.createClient += 1;
        return supabase;
      },
    }],
    ["@/lib/supabase/service", {
      createServiceRoleClient() {
        calls.serviceRole += 1;
        if (options.serviceRoleThrows !== undefined) throw options.serviceRoleThrows;
        return {
          async rpc(name, args) {
            calls.disconnectRpc.push({ name, args });
            return disconnectResult;
          },
        };
      },
    }],
    ["@/lib/telemetry", {
      logError(...args) {
        calls.telemetry.push(args);
      },
    }],
  ]);

  const compiled = ts.transpileModule(actionsSource, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: "calendar-connection.ts",
  }).outputText;
  const module = { exports: {} };
  const requireMock = (specifier) => {
    const resolved = mocks.get(specifier);
    if (resolved === undefined) throw new Error(`Unexpected calendar-connection action import: ${specifier}`);
    return resolved;
  };
  const wrapper = new vm.Script(`(function (require, module, exports) { ${compiled}\n})`, {
    filename: "calendar-connection.runtime.cjs",
  });
  wrapper.runInNewContext({ Date, Error, Object, String, process })(
    requireMock,
    module,
    module.exports,
  );
  return { actions: module.exports, calls };
}

function withFakeProviders(run, fakeProviders) {
  const before = process.env.PORTAL_FAKE_PROVIDERS;
  process.env.PORTAL_FAKE_PROVIDERS = fakeProviders ? "1" : "0";
  return Promise.resolve()
    .then(run)
    .finally(() => {
      if (before === undefined) delete process.env.PORTAL_FAKE_PROVIDERS;
      else process.env.PORTAL_FAKE_PROVIDERS = before;
    });
}

// ---------------------------------------------------------------------------
// startGoogleCalendarConnection
// ---------------------------------------------------------------------------

test("startGoogleCalendarConnection rejeita um chamador não autenticado antes de qualquer state/RPC", async () => {
  await withFakeProviders(async () => {
    const { actions, calls } = loadCalendarActions({ user: null });
    await assert.rejects(() => actions.startGoogleCalendarConnection(), assertRedirect("/login"));
    assert.equal(calls.fetchOverview, 0);
    assert.equal(calls.createState.length, 0);
  }, true);
});

test("startGoogleCalendarConnection rejeita conta não provisionada", async () => {
  await withFakeProviders(async () => {
    const { actions, calls } = loadCalendarActions({ overview: { provisioned: false, role: null } });
    await assert.rejects(() => actions.startGoogleCalendarConnection(), assertRedirect("/configuracoes?calendar_error=conta_nao_provisionada"));
    assert.equal(calls.createState.length, 0);
  }, true);
});

test("startGoogleCalendarConnection rejeita quem não é tenant_admin (a RPC também recusaria, mas a UX já barra aqui)", async () => {
  await withFakeProviders(async () => {
    const { actions, calls } = loadCalendarActions({ overview: { provisioned: true, role: "tenant_operator", tenant: { id: "tenant-resolved" } } });
    await assert.rejects(() => actions.startGoogleCalendarConnection(), assertRedirect("/configuracoes?calendar_error=apenas_admin"));
    assert.equal(calls.createState.length, 0);
  }, true);
});

test("startGoogleCalendarConnection rejeita uma sessão sem actor_id (claim ausente/malformada)", async () => {
  await withFakeProviders(async () => {
    const { actions, calls } = loadCalendarActions({ user: { id: "user-authenticated", app_metadata: {} } });
    await assert.rejects(() => actions.startGoogleCalendarConnection(), assertRedirect("/configuracoes?calendar_error=sessao_invalida"));
    assert.equal(calls.createState.length, 0);
    assert.equal(calls.telemetry[0][0], "calendar_connect_missing_actor");
  }, true);
});

test("startGoogleCalendarConnection é limitado por tenant depois de resolver a conta", async () => {
  await withFakeProviders(async () => {
    const { actions, calls } = loadCalendarActions({ rateLimited: true });
    await assert.rejects(() => actions.startGoogleCalendarConnection(), assertRedirect("/configuracoes?calendar_error=tentativas_excedidas"));
    assert.deepEqual(calls.limiter, [["google-calendar-connect:tenant-resolved", 60_000, 6]]);
    assert.equal(calls.createState.length, 0);
  }, true);
});

test("startGoogleCalendarConnection em modo real sem credenciais configuradas falha fechado com nao_configurado", async () => {
  await withFakeProviders(async () => {
    const { actions, calls } = loadCalendarActions();
    await assert.rejects(() => actions.startGoogleCalendarConnection(), assertRedirect("/configuracoes?calendar_error=nao_configurado"));
    assert.equal(calls.createState.length, 0);
  }, false);
});

test("startGoogleCalendarConnection em modo fake nunca manda o navegador pro Google real — redireciona pra própria rota de callback com o state gerado", async () => {
  await withFakeProviders(async () => {
    const { actions, calls } = loadCalendarActions({ generatedState: "generated-state-xyz" });
    await assert.rejects(
      () => actions.startGoogleCalendarConnection(),
      assertRedirect("/api/google-calendar/oauth/callback?code=fake-google-authorization-code&state=generated-state-xyz"),
    );
    assert.deepEqual(calls.createState, [{ tenantId: "tenant-resolved", actorId: "0198a000-0000-7000-8000-0000000000a1" }]);
    assert.equal(calls.authUrl.length, 0, "modo fake não deveria montar a URL real de autorização do Google");
  }, true);
});

test("startGoogleCalendarConnection em modo real configurado monta a URL de autorização com client_id/redirect_uri/state reais", async () => {
  const before = { id: process.env.GOOGLE_OAUTH_CLIENT_ID, secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET };
  process.env.GOOGLE_OAUTH_CLIENT_ID = "real-client-id.apps.googleusercontent.com";
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = "real-client-secret";
  try {
    await withFakeProviders(async () => {
      const { actions, calls } = loadCalendarActions({ generatedState: "generated-state-xyz" });
      await assert.rejects(() => actions.startGoogleCalendarConnection(), assertRedirect("https://accounts.google.com/o/oauth2/v2/auth?mock=1"));
      // Objetos passados pelo código compilado dentro do vm.runInNewContext
      // vêm de outro realm V8 (outro Object.prototype) — deepEqual falharia
      // por identidade de protótipo mesmo com o shape idêntico; comparação
      // por propriedade é o padrão já usado em billing-action-runtime.test.mjs.
      assert.equal(calls.authUrl.length, 1);
      assert.equal(calls.authUrl[0].clientId, "real-client-id.apps.googleusercontent.com");
      assert.equal(calls.authUrl[0].redirectUri, "https://app.axtro.test/api/google-calendar/oauth/callback");
      assert.equal(calls.authUrl[0].state, "generated-state-xyz");
      assert.equal(calls.redirectUri, 1);
    }, false);
  } finally {
    if (before.id === undefined) delete process.env.GOOGLE_OAUTH_CLIENT_ID; else process.env.GOOGLE_OAUTH_CLIENT_ID = before.id;
    if (before.secret === undefined) delete process.env.GOOGLE_OAUTH_CLIENT_SECRET; else process.env.GOOGLE_OAUTH_CLIENT_SECRET = before.secret;
  }
});

// ---------------------------------------------------------------------------
// disconnectGoogleCalendar
// ---------------------------------------------------------------------------

test("disconnectGoogleCalendar recusa um chamador não autenticado sem tocar a RPC", async () => {
  const { actions, calls } = loadCalendarActions({ user: null });
  const result = await actions.disconnectGoogleCalendar();
  assert.match(result.error, /Sessão expirada/);
  assert.equal(calls.serviceRole, 0);
});

test("disconnectGoogleCalendar recusa conta não provisionada", async () => {
  const { actions } = loadCalendarActions({ overview: { provisioned: false, role: null } });
  const result = await actions.disconnectGoogleCalendar();
  assert.match(result.error, /não provisionada/);
});

test("disconnectGoogleCalendar recusa quem não é tenant_admin", async () => {
  const { actions, calls } = loadCalendarActions({ overview: { provisioned: true, role: "tenant_operator", tenant: { id: "tenant-resolved" } } });
  const result = await actions.disconnectGoogleCalendar();
  assert.match(result.error, /administradores/);
  assert.equal(calls.serviceRole, 0);
});

test("disconnectGoogleCalendar recusa uma sessão sem actor_id", async () => {
  const { actions, calls } = loadCalendarActions({ user: { id: "user-authenticated", app_metadata: {} } });
  const result = await actions.disconnectGoogleCalendar();
  assert.match(result.error, /Sessão inválida/);
  assert.equal(calls.telemetry[0][0], "calendar_disconnect_missing_actor");
});

test("disconnectGoogleCalendar chama a RPC com tenant/actor corretos e revalida Configurações em sucesso", async () => {
  const { actions, calls } = loadCalendarActions();
  const result = await actions.disconnectGoogleCalendar();
  assert.equal(result.error, null);
  assert.equal(calls.disconnectRpc.length, 1);
  assert.equal(calls.disconnectRpc[0].name, "portal_disconnect_google_calendar_service");
  assert.equal(calls.disconnectRpc[0].args.p_tenant_id, "tenant-resolved");
  assert.equal(calls.disconnectRpc[0].args.p_actor_id, "0198a000-0000-7000-8000-0000000000a1");
  assert.deepEqual(calls.revalidatePath, ["/configuracoes"]);
});

test("disconnectGoogleCalendar trata not_connected como sucesso idempotente", async () => {
  const { actions } = loadCalendarActions({ disconnectResult: { data: { outcome: "not_connected" }, error: null } });
  const result = await actions.disconnectGoogleCalendar();
  assert.equal(result.error, null);
});

test("disconnectGoogleCalendar devolve erro legível quando a RPC falha, sem revalidar a página", async () => {
  const { actions, calls } = loadCalendarActions({ disconnectResult: { data: null, error: { message: "db down" } } });
  const result = await actions.disconnectGoogleCalendar();
  assert.notEqual(result.error, null);
  assert.equal(calls.revalidatePath.length, 0);
  assert.equal(calls.telemetry[0][0], "calendar_disconnect_failed");
});

test("disconnectGoogleCalendar devolve erro legível quando a RPC devolve um outcome inesperado", async () => {
  const { actions, calls } = loadCalendarActions({ disconnectResult: { data: { outcome: "revoked_maybe" }, error: null } });
  const result = await actions.disconnectGoogleCalendar();
  assert.notEqual(result.error, null);
  assert.equal(calls.telemetry[0][0], "calendar_disconnect_unexpected_outcome");
});

test("disconnectGoogleCalendar devolve erro legível quando o service role está indisponível, nunca lança pro chamador", async () => {
  const { actions, calls } = loadCalendarActions({ serviceRoleThrows: new Error("SUPABASE_SERVICE_ROLE_KEY is not configured") });
  const result = await actions.disconnectGoogleCalendar();
  assert.notEqual(result.error, null);
  assert.equal(calls.telemetry[0][0], "calendar_disconnect_failed");
});
