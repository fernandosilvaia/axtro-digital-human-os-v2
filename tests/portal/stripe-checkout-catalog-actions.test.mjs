import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { test } from "node:test";

import ts from "typescript";

/**
 * Server Actions do catálogo de checkout do closer (ADR-040), mesmo
 * mecanismo de `stripe-connect-connection-actions.test.mjs`:
 * `ts.transpileModule` + `vm.Script` com um `require` fake, porque estas
 * actions têm `"use server"` no topo.
 */
const actionsSource = await readFile(
  new URL("../../apps/portal/src/lib/actions/stripe-checkout-catalog.ts", import.meta.url),
  "utf8",
);

class MockStripeBillingError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "StripeBillingError";
    this.code = code;
  }
}

function loadCatalogActions(options = {}) {
  const calls = {
    createClient: 0,
    fetchOverview: 0,
    serviceRole: 0,
    rpc: [],
    verifyPrice: [],
    createPortFactories: [],
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
  const upsertResult = options.upsertResult ?? { data: { outcome: "saved", productId: "harness_kit" }, error: null };
  const deactivateResult = options.deactivateResult ?? { data: { outcome: "deactivated", productId: "harness_kit" }, error: null };
  const verifyPriceThrows = options.verifyPriceThrows;

  const mocks = new Map([
    ["@axtro/domain", { createUuidV7: () => "0198a000-0000-7000-8000-000000000099" }],
    ["@axtro/provider-stripe", {
      StripeBillingError: MockStripeBillingError,
      createStripeBillingPort(factoryOptions) {
        calls.createPortFactories.push(factoryOptions);
        return {
          async verifyConnectedAccountPrice(request) {
            calls.verifyPrice.push(request);
            if (verifyPriceThrows !== undefined) throw verifyPriceThrows;
            return { verified: true, priceId: request.priceId, unitAmountCents: request.expectedUnitAmountCents, currency: request.expectedCurrency };
          },
        };
      },
    }],
    ["@/lib/portal-data", {
      async fetchTenantOverview() {
        calls.fetchOverview += 1;
        return overview;
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
            if (name === "portal_upsert_business_checkout_product_service") return upsertResult;
            if (name === "portal_deactivate_business_checkout_product_service") return deactivateResult;
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
    fileName: "stripe-checkout-catalog.ts",
  }).outputText;
  const module = { exports: {} };
  const requireMock = (specifier) => {
    const resolved = mocks.get(specifier);
    if (resolved === undefined) throw new Error(`Unexpected stripe-checkout-catalog action import: ${specifier}`);
    return resolved;
  };
  const wrapper = new vm.Script(`(function (require, module, exports) { ${compiled}\n})`, {
    filename: "stripe-checkout-catalog.runtime.cjs",
  });
  wrapper.runInNewContext({ Date, Error, Object, String, Number, RegExp, process })(
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

const VALID_INPUT = { productId: "harness_kit", displayName: "Kit de onboarding", stripePriceId: "price_HarnessKit001", unitAmountCents: 9900 };

// ---------------------------------------------------------------------------
// upsertBusinessCheckoutProduct
// ---------------------------------------------------------------------------

test("upsertBusinessCheckoutProduct recusa um chamador não autenticado sem tocar RPC/preflight", async () => {
  await withFakeProviders(async () => {
    const { actions, calls } = loadCatalogActions({ user: null });
    const result = await actions.upsertBusinessCheckoutProduct(VALID_INPUT);
    assert.match(result.error, /Sessão expirada/);
    assert.equal(calls.serviceRole, 0);
    assert.equal(calls.verifyPrice.length, 0);
  }, true);
});

test("upsertBusinessCheckoutProduct recusa quem não é tenant_admin", async () => {
  await withFakeProviders(async () => {
    const { actions, calls } = loadCatalogActions({ overview: { provisioned: true, role: "tenant_operator", tenant: { id: "tenant-resolved" } } });
    const result = await actions.upsertBusinessCheckoutProduct(VALID_INPUT);
    assert.match(result.error, /administradores/);
    assert.equal(calls.serviceRole, 0);
  }, true);
});

test("upsertBusinessCheckoutProduct valida productId/displayName/valor/quantidade antes de qualquer RPC", async () => {
  await withFakeProviders(async () => {
    const cases = [
      { ...VALID_INPUT, productId: "HarnessKit" },
      { ...VALID_INPUT, productId: "a" },
      { ...VALID_INPUT, displayName: "" },
      { ...VALID_INPUT, displayName: "x".repeat(201) },
      { ...VALID_INPUT, unitAmountCents: 0 },
      { ...VALID_INPUT, unitAmountCents: 1.5 },
      { ...VALID_INPUT, maxQuantity: 0 },
      { ...VALID_INPUT, maxQuantity: 101 },
    ];
    for (const input of cases) {
      const { actions, calls } = loadCatalogActions();
      const result = await actions.upsertBusinessCheckoutProduct(input);
      assert.notEqual(result.error, null, JSON.stringify(input));
      assert.equal(calls.serviceRole, 0);
    }
  }, true);
});

test("upsertBusinessCheckoutProduct recusa sem conta Stripe conectada, nunca tenta preflight", async () => {
  await withFakeProviders(async () => {
    const { actions, calls } = loadCatalogActions({ statusResult: { data: { outcome: "not_connected" }, error: null } });
    const result = await actions.upsertBusinessCheckoutProduct(VALID_INPUT);
    assert.match(result.error, /Conecte a conta Stripe/);
    assert.equal(calls.verifyPrice.length, 0);
    assert.equal(calls.rpc.some((c) => c.name === "portal_upsert_business_checkout_product_service"), false);
  }, true);
});

test("upsertBusinessCheckoutProduct em modo real roda o preflight contra a conta conectada antes de salvar", async () => {
  const before = process.env.STRIPE_SECRET_KEY;
  process.env.STRIPE_SECRET_KEY = "sk_test_real_key_00000000000000";
  try {
    await withFakeProviders(async () => {
      const { actions, calls } = loadCatalogActions();
      const result = await actions.upsertBusinessCheckoutProduct(VALID_INPUT);
      assert.equal(result.error, null);
      assert.equal(calls.verifyPrice.length, 1);
      // Objetos que atravessam o vm.runInNewContext vêm de outro realm V8
      // (outro Object.prototype): deepEqual falha por identidade de
      // protótipo mesmo com o shape idêntico. Comparação por propriedade,
      // mesmo padrão já usado em calendar-connection-actions.test.mjs.
      assert.equal(calls.verifyPrice[0].stripeAccountId, "acct_1NConnectedTest123");
      assert.equal(calls.verifyPrice[0].priceId, "price_HarnessKit001");
      assert.equal(calls.verifyPrice[0].expectedUnitAmountCents, 9900);
      assert.equal(calls.verifyPrice[0].expectedCurrency, "usd");
      const rpcNames = calls.rpc.map((c) => c.name);
      assert.deepEqual(rpcNames, ["portal_stripe_connect_status_service", "portal_upsert_business_checkout_product_service"]);
      const upsertArgs = calls.rpc[1].args;
      assert.equal(upsertArgs.p_id, "0198a000-0000-7000-8000-000000000099");
      assert.equal(upsertArgs.p_tenant_id, "tenant-resolved");
      assert.equal(upsertArgs.p_actor_id, "0198a000-0000-7000-8000-0000000000a1");
      assert.equal(upsertArgs.p_product_id, "harness_kit");
      assert.equal(upsertArgs.p_display_name, "Kit de onboarding");
      assert.equal(upsertArgs.p_stripe_price_id, "price_HarnessKit001");
      assert.equal(upsertArgs.p_unit_amount_cents, 9900);
      assert.equal(upsertArgs.p_max_quantity, 1);
    }, false);
  } finally {
    if (before === undefined) delete process.env.STRIPE_SECRET_KEY; else process.env.STRIPE_SECRET_KEY = before;
  }
});

test("upsertBusinessCheckoutProduct: preflight que rejeita nunca chega a salvar no catálogo", async () => {
  const before = process.env.STRIPE_SECRET_KEY;
  process.env.STRIPE_SECRET_KEY = "sk_test_real_key_00000000000000";
  try {
    await withFakeProviders(async () => {
      const { actions, calls } = loadCatalogActions({ verifyPriceThrows: new MockStripeBillingError("invalid_request", "price mismatch") });
      const result = await actions.upsertBusinessCheckoutProduct(VALID_INPUT);
      assert.notEqual(result.error, null);
      assert.equal(calls.rpc.some((c) => c.name === "portal_upsert_business_checkout_product_service"), false);
      assert.equal(calls.telemetry[0][0], "checkout_catalog_price_preflight_failed");
    }, false);
  } finally {
    if (before === undefined) delete process.env.STRIPE_SECRET_KEY; else process.env.STRIPE_SECRET_KEY = before;
  }
});

test("upsertBusinessCheckoutProduct em modo fake nunca chama a rede: apenas valida o formato do priceId", async () => {
  await withFakeProviders(async () => {
    const { actions, calls } = loadCatalogActions();
    const result = await actions.upsertBusinessCheckoutProduct(VALID_INPUT);
    assert.equal(result.error, null);
    assert.equal(calls.verifyPrice.length, 0, "modo fake nunca deve chamar verifyConnectedAccountPrice de verdade");
    const badPrice = await loadCatalogActions().actions.upsertBusinessCheckoutProduct({ ...VALID_INPUT, stripePriceId: "not-a-price-id" });
    assert.notEqual(badPrice.error, null);
  }, true);
});

test("upsertBusinessCheckoutProduct em modo real sem STRIPE_SECRET_KEY falha fechado antes do preflight", async () => {
  await withFakeProviders(async () => {
    const { actions, calls } = loadCatalogActions();
    const result = await actions.upsertBusinessCheckoutProduct(VALID_INPUT);
    assert.notEqual(result.error, null);
    assert.equal(calls.verifyPrice.length, 0);
    assert.equal(calls.telemetry[0][0], "checkout_catalog_upsert_not_configured");
  }, false);
});

test("upsertBusinessCheckoutProduct devolve erro quando a RPC de cadastro falha ou devolve outcome inesperado", async () => {
  await withFakeProviders(async () => {
    const failed = loadCatalogActions({ upsertResult: { data: null, error: { message: "db down" } } });
    assert.notEqual((await failed.actions.upsertBusinessCheckoutProduct(VALID_INPUT)).error, null);

    const unexpected = loadCatalogActions({ upsertResult: { data: { outcome: "weird" }, error: null } });
    assert.notEqual((await unexpected.actions.upsertBusinessCheckoutProduct(VALID_INPUT)).error, null);
  }, true);
});

// ---------------------------------------------------------------------------
// deactivateBusinessCheckoutProduct
// ---------------------------------------------------------------------------

test("deactivateBusinessCheckoutProduct recusa um chamador não autenticado sem tocar a RPC", async () => {
  const { actions, calls } = loadCatalogActions({ user: null });
  const result = await actions.deactivateBusinessCheckoutProduct("harness_kit");
  assert.match(result.error, /Sessão expirada/);
  assert.equal(calls.serviceRole, 0);
});

test("deactivateBusinessCheckoutProduct recusa quem não é tenant_admin", async () => {
  const { actions, calls } = loadCatalogActions({ overview: { provisioned: true, role: "tenant_operator", tenant: { id: "tenant-resolved" } } });
  const result = await actions.deactivateBusinessCheckoutProduct("harness_kit");
  assert.match(result.error, /administradores/);
  assert.equal(calls.serviceRole, 0);
});

test("deactivateBusinessCheckoutProduct valida o formato do productId antes da RPC", async () => {
  const { actions, calls } = loadCatalogActions();
  const result = await actions.deactivateBusinessCheckoutProduct("Not Valid!");
  assert.notEqual(result.error, null);
  assert.equal(calls.serviceRole, 0);
});

test("deactivateBusinessCheckoutProduct chama a RPC com tenant/actor/productId corretos em sucesso", async () => {
  const { actions, calls } = loadCatalogActions();
  const result = await actions.deactivateBusinessCheckoutProduct("harness_kit");
  assert.equal(result.error, null);
  assert.equal(calls.rpc.length, 1);
  assert.equal(calls.rpc[0].name, "portal_deactivate_business_checkout_product_service");
  assert.equal(calls.rpc[0].args.p_tenant_id, "tenant-resolved");
  assert.equal(calls.rpc[0].args.p_actor_id, "0198a000-0000-7000-8000-0000000000a1");
  assert.equal(calls.rpc[0].args.p_product_id, "harness_kit");
});

test("deactivateBusinessCheckoutProduct trata not_found como sucesso idempotente", async () => {
  const { actions } = loadCatalogActions({ deactivateResult: { data: { outcome: "not_found" }, error: null } });
  const result = await actions.deactivateBusinessCheckoutProduct("harness_kit");
  assert.equal(result.error, null);
});

test("deactivateBusinessCheckoutProduct devolve erro quando a RPC falha ou devolve outcome inesperado", async () => {
  const failed = loadCatalogActions({ deactivateResult: { data: null, error: { message: "db down" } } });
  assert.notEqual((await failed.actions.deactivateBusinessCheckoutProduct("harness_kit")).error, null);

  const unexpected = loadCatalogActions({ deactivateResult: { data: { outcome: "weird" }, error: null } });
  assert.notEqual((await unexpected.actions.deactivateBusinessCheckoutProduct("harness_kit")).error, null);
});

test("deactivateBusinessCheckoutProduct devolve erro legível quando o service role está indisponível", async () => {
  const { actions, calls } = loadCatalogActions({ serviceRoleThrows: new Error("SUPABASE_SERVICE_ROLE_KEY is not configured") });
  const result = await actions.deactivateBusinessCheckoutProduct("harness_kit");
  assert.notEqual(result.error, null);
  assert.equal(calls.telemetry[0][0], "checkout_catalog_deactivate_failed");
});
