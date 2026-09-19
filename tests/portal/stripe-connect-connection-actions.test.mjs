import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { test } from "node:test";

import ts from "typescript";

/**
 * Server Actions de conexão/desconexão da Stripe conectada (ADR-040), mesmo
 * mecanismo de `calendar-connection-actions.test.mjs`: `ts.transpileModule`
 * + `vm.Script` com um `require` fake, porque estas actions têm
 * `"use server"` no topo.
 */
const actionsSource = await readFile(
  new URL("../../apps/portal/src/lib/actions/stripe-connect-connection.ts", import.meta.url),
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

class MockStripeBillingError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "StripeBillingError";
    this.code = code;
  }
}

function loadStripeConnectActions(options = {}) {
  const calls = {
    createClient: 0,
    fetchOverview: 0,
    limiter: [],
    issueState: [],
    setCookie: [],
    authUrl: [],
    redirectUri: 0,
    serviceRole: 0,
    rpc: [],
    deauthorize: [],
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
  const statusResult = options.statusResult ?? { data: { outcome: "found", stripeAccountId: "acct_1NConnectedTest123" }, error: null };
  const disconnectRpcResult = options.disconnectRpcResult ?? { data: { outcome: "disconnected" }, error: null };
  const deauthorizeThrows = options.deauthorizeThrows;

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
    ["next/headers", {
      async cookies() {
        return {
          set(name, value, attrs) {
            calls.setCookie.push({ name, value, attrs });
          },
        };
      },
    }],
    ["@/lib/billing/stripe-connect-oauth-state", {
      issueStripeConnectOAuthStateToken(tenantId, actorId) {
        calls.issueState.push({ tenantId, actorId });
        return options.generatedToken ?? "mock-state-token";
      },
      STRIPE_CONNECT_OAUTH_STATE_COOKIE_NAME: "axtro_stripe_connect_oauth_state",
      STRIPE_CONNECT_OAUTH_STATE_SECRET_ENV: "STRIPE_CONNECT_OAUTH_STATE_SECRET",
    }],
    ["@/lib/billing/stripe-connect-oauth-url", {
      buildStripeConnectAuthorizationUrl(input) {
        calls.authUrl.push(input);
        return "https://connect.stripe.com/oauth/authorize?mock=1";
      },
      stripeConnectOAuthRedirectUri() {
        calls.redirectUri += 1;
        return "https://app.axtro.test/api/stripe/connect-oauth/callback";
      },
    }],
    ["@axtro/provider-stripe", {
      StripeBillingError: MockStripeBillingError,
      async deauthorizeStripeConnectAccount(input) {
        calls.deauthorize.push(input);
        if (deauthorizeThrows !== undefined) throw deauthorizeThrows;
      },
      createFakeDeauthorizeStripeConnectAccount() {
        return async (input) => {
          calls.deauthorize.push({ ...input, fake: true });
        };
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
            calls.rpc.push({ name, args });
            if (name === "portal_stripe_connect_status_service") return statusResult;
            if (name === "portal_disconnect_stripe_service") return disconnectRpcResult;
            throw new Error(`unexpected rpc: ${name}`);
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
    fileName: "stripe-connect-connection.ts",
  }).outputText;
  const module = { exports: {} };
  const requireMock = (specifier) => {
    const resolved = mocks.get(specifier);
    if (resolved === undefined) throw new Error(`Unexpected stripe-connect-connection action import: ${specifier}`);
    return resolved;
  };
  const wrapper = new vm.Script(`(function (require, module, exports) { ${compiled}\n})`, {
    filename: "stripe-connect-connection.runtime.cjs",
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

function withStateSecret(run) {
  const before = process.env.STRIPE_CONNECT_OAUTH_STATE_SECRET;
  process.env.STRIPE_CONNECT_OAUTH_STATE_SECRET = "0".repeat(64);
  return Promise.resolve()
    .then(run)
    .finally(() => {
      if (before === undefined) delete process.env.STRIPE_CONNECT_OAUTH_STATE_SECRET;
      else process.env.STRIPE_CONNECT_OAUTH_STATE_SECRET = before;
    });
}

// ---------------------------------------------------------------------------
// startStripeConnectConnection
// ---------------------------------------------------------------------------

test("startStripeConnectConnection rejeita um chamador não autenticado antes de qualquer state/RPC", async () => {
  await withStateSecret(() => withFakeProviders(async () => {
    const { actions, calls } = loadStripeConnectActions({ user: null });
    await assert.rejects(() => actions.startStripeConnectConnection(), assertRedirect("/login"));
    assert.equal(calls.fetchOverview, 0);
    assert.equal(calls.issueState.length, 0);
  }, true));
});

test("startStripeConnectConnection rejeita conta não provisionada", async () => {
  await withStateSecret(() => withFakeProviders(async () => {
    const { actions, calls } = loadStripeConnectActions({ overview: { provisioned: false, role: null } });
    await assert.rejects(() => actions.startStripeConnectConnection(), assertRedirect("/configuracoes?stripe_connect_error=conta_nao_provisionada"));
    assert.equal(calls.issueState.length, 0);
  }, true));
});

test("startStripeConnectConnection rejeita quem não é tenant_admin", async () => {
  await withStateSecret(() => withFakeProviders(async () => {
    const { actions, calls } = loadStripeConnectActions({ overview: { provisioned: true, role: "tenant_operator", tenant: { id: "tenant-resolved" } } });
    await assert.rejects(() => actions.startStripeConnectConnection(), assertRedirect("/configuracoes?stripe_connect_error=apenas_admin"));
    assert.equal(calls.issueState.length, 0);
  }, true));
});

test("startStripeConnectConnection rejeita uma sessão sem actor_id", async () => {
  await withStateSecret(() => withFakeProviders(async () => {
    const { actions, calls } = loadStripeConnectActions({ user: { id: "user-authenticated", app_metadata: {} } });
    await assert.rejects(() => actions.startStripeConnectConnection(), assertRedirect("/configuracoes?stripe_connect_error=sessao_invalida"));
    assert.equal(calls.telemetry[0][0], "stripe_connect_start_missing_actor");
  }, true));
});

test("startStripeConnectConnection é limitado por tenant depois de resolver a conta", async () => {
  await withStateSecret(() => withFakeProviders(async () => {
    const { actions, calls } = loadStripeConnectActions({ rateLimited: true });
    await assert.rejects(() => actions.startStripeConnectConnection(), assertRedirect("/configuracoes?stripe_connect_error=tentativas_excedidas"));
    assert.deepEqual(calls.limiter, [["stripe-connect-connect:tenant-resolved", 60_000, 6]]);
    assert.equal(calls.issueState.length, 0);
  }, true));
});

test("startStripeConnectConnection em modo real sem STRIPE_CONNECT_CLIENT_ID falha fechado com nao_configurado", async () => {
  await withStateSecret(() => withFakeProviders(async () => {
    const { actions, calls } = loadStripeConnectActions();
    await assert.rejects(() => actions.startStripeConnectConnection(), assertRedirect("/configuracoes?stripe_connect_error=nao_configurado"));
    assert.equal(calls.issueState.length, 0);
  }, false));
});

test("startStripeConnectConnection sem STRIPE_CONNECT_OAUTH_STATE_SECRET falha fechado, mesmo em modo fake", async () => {
  const before = process.env.STRIPE_CONNECT_OAUTH_STATE_SECRET;
  delete process.env.STRIPE_CONNECT_OAUTH_STATE_SECRET;
  try {
    await withFakeProviders(async () => {
      const { actions, calls } = loadStripeConnectActions();
      await assert.rejects(() => actions.startStripeConnectConnection(), assertRedirect("/configuracoes?stripe_connect_error=nao_configurado"));
      assert.equal(calls.issueState.length, 0);
    }, true);
  } finally {
    if (before === undefined) delete process.env.STRIPE_CONNECT_OAUTH_STATE_SECRET; else process.env.STRIPE_CONNECT_OAUTH_STATE_SECRET = before;
  }
});

test("startStripeConnectConnection em modo fake nunca manda o navegador pra Stripe real: grava o cookie e redireciona pra própria rota de callback", async () => {
  await withStateSecret(() => withFakeProviders(async () => {
    const { actions, calls } = loadStripeConnectActions({ generatedToken: "generated-state-xyz" });
    await assert.rejects(
      () => actions.startStripeConnectConnection(),
      assertRedirect("/api/stripe/connect-oauth/callback?code=ac_fake_stripe_connect_authorization_code&state=generated-state-xyz"),
    );
    assert.deepEqual(calls.issueState, [{ tenantId: "tenant-resolved", actorId: "0198a000-0000-7000-8000-0000000000a1" }]);
    assert.equal(calls.setCookie.length, 1);
    assert.equal(calls.setCookie[0].name, "axtro_stripe_connect_oauth_state");
    assert.equal(calls.setCookie[0].value, "generated-state-xyz");
    assert.equal(calls.setCookie[0].attrs.httpOnly, true);
    assert.equal(calls.authUrl.length, 0, "modo fake não deveria montar a URL real de autorização da Stripe");
  }, true));
});

test("startStripeConnectConnection em modo real configurado monta a URL de autorização com client_id/redirect_uri/state reais", async () => {
  const before = process.env.STRIPE_CONNECT_CLIENT_ID;
  process.env.STRIPE_CONNECT_CLIENT_ID = "ca_RealConnectClientId123";
  try {
    await withStateSecret(() => withFakeProviders(async () => {
      const { actions, calls } = loadStripeConnectActions({ generatedToken: "generated-state-xyz" });
      await assert.rejects(() => actions.startStripeConnectConnection(), assertRedirect("https://connect.stripe.com/oauth/authorize?mock=1"));
      assert.equal(calls.authUrl.length, 1);
      assert.equal(calls.authUrl[0].connectClientId, "ca_RealConnectClientId123");
      assert.equal(calls.authUrl[0].redirectUri, "https://app.axtro.test/api/stripe/connect-oauth/callback");
      assert.equal(calls.authUrl[0].state, "generated-state-xyz");
      assert.equal(calls.redirectUri, 1);
      assert.equal(calls.setCookie.length, 1);
    }, false));
  } finally {
    if (before === undefined) delete process.env.STRIPE_CONNECT_CLIENT_ID; else process.env.STRIPE_CONNECT_CLIENT_ID = before;
  }
});

// ---------------------------------------------------------------------------
// disconnectStripeConnect
// ---------------------------------------------------------------------------

test("disconnectStripeConnect recusa um chamador não autenticado sem tocar a RPC", async () => {
  const { actions, calls } = loadStripeConnectActions({ user: null });
  const result = await actions.disconnectStripeConnect();
  assert.match(result.error, /Sessão expirada/);
  assert.equal(calls.serviceRole, 0);
});

test("disconnectStripeConnect recusa conta não provisionada", async () => {
  const { actions } = loadStripeConnectActions({ overview: { provisioned: false, role: null } });
  const result = await actions.disconnectStripeConnect();
  assert.match(result.error, /não provisionada/);
});

test("disconnectStripeConnect recusa quem não é tenant_admin", async () => {
  const { actions, calls } = loadStripeConnectActions({ overview: { provisioned: true, role: "tenant_operator", tenant: { id: "tenant-resolved" } } });
  const result = await actions.disconnectStripeConnect();
  assert.match(result.error, /administradores/);
  assert.equal(calls.serviceRole, 0);
});

test("disconnectStripeConnect recusa uma sessão sem actor_id", async () => {
  const { actions, calls } = loadStripeConnectActions({ user: { id: "user-authenticated", app_metadata: {} } });
  const result = await actions.disconnectStripeConnect();
  assert.match(result.error, /Sessão inválida/);
  assert.equal(calls.telemetry[0][0], "stripe_connect_disconnect_missing_actor");
});

test("disconnectStripeConnect: sem conta Stripe conectada, pula a desautorização e só marca desconectado", async () => {
  const { actions, calls } = loadStripeConnectActions({ statusResult: { data: { outcome: "not_connected" }, error: null } });
  const result = await actions.disconnectStripeConnect();
  assert.equal(result.error, null);
  assert.equal(calls.deauthorize.length, 0);
  assert.equal(calls.rpc.some((c) => c.name === "portal_disconnect_stripe_service"), true);
});

test("disconnectStripeConnect: com conta conectada, desautoriza na Stripe antes de marcar desconectado, na ordem certa", async () => {
  const before = { key: process.env.STRIPE_SECRET_KEY, client: process.env.STRIPE_CONNECT_CLIENT_ID };
  process.env.STRIPE_SECRET_KEY = "sk_test_real_key_00000000000000";
  process.env.STRIPE_CONNECT_CLIENT_ID = "ca_RealConnectClientId123";
  try {
    await withFakeProviders(async () => {
      const { actions, calls } = loadStripeConnectActions();
      const result = await actions.disconnectStripeConnect();
      assert.equal(result.error, null);
      assert.equal(calls.deauthorize.length, 1);
      assert.equal(calls.deauthorize[0].stripeAccountId, "acct_1NConnectedTest123");
      assert.equal(calls.deauthorize[0].platformSecretKey, "sk_test_real_key_00000000000000");
      const rpcNames = calls.rpc.map((c) => c.name);
      assert.deepEqual(rpcNames, ["portal_stripe_connect_status_service", "portal_disconnect_stripe_service"]);
      assert.deepEqual(calls.revalidatePath, ["/configuracoes"]);
    }, false);
  } finally {
    if (before.key === undefined) delete process.env.STRIPE_SECRET_KEY; else process.env.STRIPE_SECRET_KEY = before.key;
    if (before.client === undefined) delete process.env.STRIPE_CONNECT_CLIENT_ID; else process.env.STRIPE_CONNECT_CLIENT_ID = before.client;
  }
});

test("disconnectStripeConnect em modo fake usa o deauthorize fake, nunca a rede real", async () => {
  await withFakeProviders(async () => {
    const { actions, calls } = loadStripeConnectActions();
    const result = await actions.disconnectStripeConnect();
    assert.equal(result.error, null);
    assert.equal(calls.deauthorize.length, 1);
    assert.equal(calls.deauthorize[0].fake, true);
  }, true);
});

test("disconnectStripeConnect em modo real sem STRIPE_SECRET_KEY/STRIPE_CONNECT_CLIENT_ID falha fechado antes de tentar desautorizar", async () => {
  await withFakeProviders(async () => {
    const { actions, calls } = loadStripeConnectActions();
    const result = await actions.disconnectStripeConnect();
    assert.notEqual(result.error, null);
    assert.equal(calls.deauthorize.length, 0);
    assert.equal(calls.telemetry[0][0], "stripe_connect_disconnect_not_configured");
  }, false);
});

test("disconnectStripeConnect propaga falha de desautorização sem nunca logar a chave, e nunca marca desconectado", async () => {
  const before = { key: process.env.STRIPE_SECRET_KEY, client: process.env.STRIPE_CONNECT_CLIENT_ID };
  process.env.STRIPE_SECRET_KEY = "sk_test_real_key_00000000000000";
  process.env.STRIPE_CONNECT_CLIENT_ID = "ca_RealConnectClientId123";
  try {
    await withFakeProviders(async () => {
      const { actions, calls } = loadStripeConnectActions({ deauthorizeThrows: new MockStripeBillingError("provider_rejected", "boom sk_test_real_key_00000000000000") });
      const result = await actions.disconnectStripeConnect();
      assert.notEqual(result.error, null);
      assert.equal(calls.rpc.some((c) => c.name === "portal_disconnect_stripe_service"), false);
      assert.equal(calls.telemetry[0][0], "stripe_connect_deauthorize_failed");
      assert.equal(JSON.stringify(calls.telemetry).includes("sk_test_real_key_00000000000000"), false, "a chave nunca pode aparecer em telemetria");
    }, false);
  } finally {
    if (before.key === undefined) delete process.env.STRIPE_SECRET_KEY; else process.env.STRIPE_SECRET_KEY = before.key;
    if (before.client === undefined) delete process.env.STRIPE_CONNECT_CLIENT_ID; else process.env.STRIPE_CONNECT_CLIENT_ID = before.client;
  }
});

test("disconnectStripeConnect trata not_connected como sucesso idempotente", async () => {
  const { actions } = loadStripeConnectActions({ statusResult: { data: { outcome: "not_connected" }, error: null }, disconnectRpcResult: { data: { outcome: "not_connected" }, error: null } });
  const result = await actions.disconnectStripeConnect();
  assert.equal(result.error, null);
});

test("disconnectStripeConnect devolve erro legível quando a RPC de desconexão devolve um outcome inesperado", async () => {
  const { actions, calls } = loadStripeConnectActions({ statusResult: { data: { outcome: "not_connected" }, error: null }, disconnectRpcResult: { data: { outcome: "revoked_maybe" }, error: null } });
  const result = await actions.disconnectStripeConnect();
  assert.notEqual(result.error, null);
  assert.equal(calls.telemetry[0][0], "stripe_connect_disconnect_unexpected_outcome");
});

test("disconnectStripeConnect devolve erro legível quando o service role está indisponível, nunca lança pro chamador", async () => {
  const { actions, calls } = loadStripeConnectActions({ serviceRoleThrows: new Error("SUPABASE_SERVICE_ROLE_KEY is not configured") });
  const result = await actions.disconnectStripeConnect();
  assert.notEqual(result.error, null);
  assert.equal(calls.telemetry[0][0], "stripe_connect_disconnect_failed");
});
