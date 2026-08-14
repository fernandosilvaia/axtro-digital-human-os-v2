import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { test } from "node:test";

import ts from "typescript";

const billingSource = await readFile(
  new URL("../../apps/portal/src/lib/actions/billing.ts", import.meta.url),
  "utf8",
);

class RedirectSignal extends Error {
  constructor(location) {
    super(`redirect:${location}`);
    this.location = location;
  }
}

const VALID_ENV = Object.freeze({
  PORTAL_FAKE_PROVIDERS: "0",
  STRIPE_SECRET_KEY: "sk_test_runtime",
  STRIPE_STARTER_BASE_PRICE_ID: "price_starter_base",
  STRIPE_STARTER_OVERAGE_PRICE_ID: "price_starter_overage",
  STRIPE_CONVERSATION_OVERAGE_EVENT_NAME: "axtro_conversation_overage",
});

function checkoutForm() {
  const form = new FormData();
  form.set("plan_id", "starter");
  return form;
}

function assertRedirect(location) {
  return (error) => error instanceof RedirectSignal && error.location === location;
}

function loadBillingActions(options = {}) {
  const calls = {
    coordinator: [],
    createClient: 0,
    fetchOverview: 0,
    limiter: [],
    portalSession: [],
    provider: 0,
    rpc: [],
    serviceRole: 0,
    telemetry: [],
  };
  const user = Object.hasOwn(options, "user") ? options.user : { id: "user-authenticated" };
  const overview = options.overview ?? {
    provisioned: true,
    role: "tenant_admin",
    tenant: { id: "tenant-resolved" },
  };
  const billingStatus = options.billingStatus ?? {
    plan_id: null,
    status: null,
    stripe_customer_id: null,
  };
  const supabase = {
    auth: {
      async getUser() {
        return { data: { user } };
      },
    },
    async rpc(name) {
      calls.rpc.push(name);
      if (options.rpcError !== undefined) {
        return { data: null, error: options.rpcError };
      }
      return { data: billingStatus, error: null };
    },
  };
  const port = {
    async createPortalSession(input) {
      calls.portalSession.push(input);
      if (options.portalFailure !== undefined) throw options.portalFailure;
      return { portalUrl: "https://billing.stripe.com/p/session/runtime" };
    },
  };

  const mocks = new Map([
    ["next/navigation", {
      redirect(location) {
        throw new RedirectSignal(location);
      },
    }],
    ["@axtro/provider-stripe", {
      createStripeBillingPort() {
        calls.provider += 1;
        if (options.providerFailure !== undefined) throw options.providerFailure;
        return port;
      },
    }],
    ["@/lib/billing/checkout-preflight", {
      checkoutCatalogExpectation() {
        return { verified: true };
      },
      createDeterministicFakeCheckoutPort() {
        calls.provider += 1;
        return port;
      },
    }],
    ["@/lib/billing/checkout-intents", {
      async createDurableCheckout(input, dependencies) {
        calls.coordinator.push({ input, dependencies });
        if (options.coordinatorFailure !== undefined) throw options.coordinatorFailure;
        return options.checkoutResult ?? {
          status: "ready",
          checkoutUrl: "https://checkout.stripe.com/c/pay/runtime",
        };
      },
    }],
    ["@/lib/billing/plans", {
      BILLING_TERMINAL_STATUSES: new Set(["canceled", "incomplete_expired"]),
      hasNonTerminalSubscription(status) {
        return typeof status === "string" && !new Set(["canceled", "incomplete_expired"]).has(status);
      },
      isPlanId(value) {
        return value === "starter";
      },
      PLAN_CATALOG: {
        starter: {
          id: "starter",
          basePriceEnvVar: "STRIPE_STARTER_BASE_PRICE_ID",
          overagePriceEnvVar: "STRIPE_STARTER_OVERAGE_PRICE_ID",
        },
      },
    }],
    ["@/lib/portal-data", {
      async fetchTenantOverview() {
        calls.fetchOverview += 1;
        return overview;
      },
    }],
    ["@/lib/public-origin", {
      portalPublicOrigin() {
        return "https://app.axtro.test";
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
        return { serviceRole: true };
      },
    }],
    ["@/lib/telemetry", {
      logError(...args) {
        calls.telemetry.push(args);
      },
    }],
  ]);

  const compiled = ts.transpileModule(billingSource, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: "billing.ts",
  }).outputText;
  const module = { exports: {} };
  const requireMock = (specifier) => {
    const resolved = mocks.get(specifier);
    if (resolved === undefined) throw new Error(`Unexpected billing action import: ${specifier}`);
    return resolved;
  };
  const wrapper = new vm.Script(`(function (require, module, exports) { ${compiled}\n})`, {
    filename: "billing.runtime.cjs",
  });
  wrapper.runInNewContext({ Date, Error, Object, Set, String, process })(
    requireMock,
    module,
    module.exports,
  );
  return { actions: module.exports, calls };
}

function withBillingEnvironment(run, overrides = {}) {
  const keys = new Set([...Object.keys(VALID_ENV), ...Object.keys(overrides)]);
  const before = new Map([...keys].map((key) => [key, process.env[key]]));
  Object.assign(process.env, VALID_ENV, overrides);
  return Promise.resolve()
    .then(run)
    .finally(() => {
      for (const [key, value] of before) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });
}

for (const actionName of ["startCheckout", "openBillingPortal"]) {
  test(`${actionName} rejects an unauthenticated caller before any paid boundary`, async () => {
    await withBillingEnvironment(async () => {
      const { actions, calls } = loadBillingActions({ user: null });
      const invoke = actionName === "startCheckout"
        ? () => actions.startCheckout(checkoutForm())
        : () => actions.openBillingPortal();
      await assert.rejects(invoke, assertRedirect("/login"));
      assert.equal(calls.fetchOverview, 0);
      assert.equal(calls.serviceRole, 0);
      assert.equal(calls.provider, 0);
      assert.equal(calls.coordinator.length, 0);
    }, { STRIPE_SECRET_KEY: "" });
  });

  test(`${actionName} rejects a missing tenant before any paid boundary`, async () => {
    await withBillingEnvironment(async () => {
      const { actions, calls } = loadBillingActions({
        overview: { provisioned: false, role: null },
      });
      const invoke = actionName === "startCheckout"
        ? () => actions.startCheckout(checkoutForm())
        : () => actions.openBillingPortal();
      await assert.rejects(
        invoke,
        assertRedirect("/configuracoes?billing_error=conta_nao_provisionada"),
      );
      assert.equal(calls.serviceRole, 0);
      assert.equal(calls.provider, 0);
      assert.equal(calls.coordinator.length, 0);
    }, { STRIPE_SECRET_KEY: "" });
  });

  test(`${actionName} rejects an operator before any paid boundary`, async () => {
    await withBillingEnvironment(async () => {
      const { actions, calls } = loadBillingActions({
        overview: {
          provisioned: true,
          role: "operator",
          tenant: { id: "tenant-resolved" },
        },
      });
      const invoke = actionName === "startCheckout"
        ? () => actions.startCheckout(checkoutForm())
        : () => actions.openBillingPortal();
      await assert.rejects(invoke, assertRedirect("/configuracoes?billing_error=apenas_admin"));
      assert.equal(calls.serviceRole, 0);
      assert.equal(calls.provider, 0);
      assert.equal(calls.coordinator.length, 0);
    }, { STRIPE_SECRET_KEY: "" });
  });
}

test("active subscription cannot create a second Checkout", async () => {
  await withBillingEnvironment(async () => {
    const { actions, calls } = loadBillingActions({
      billingStatus: {
        plan_id: "starter",
        status: "active",
        stripe_customer_id: "cus_active",
      },
    });
    await assert.rejects(
      () => actions.startCheckout(checkoutForm()),
      assertRedirect("/configuracoes?billing_error=ja_assinante"),
    );
    assert.equal(calls.serviceRole, 0);
    assert.equal(calls.provider, 0);
    assert.equal(calls.coordinator.length, 0);
  });
});

test("terminal subscription reuses only the authenticated tenant, user and persisted customer", async () => {
  await withBillingEnvironment(async () => {
    const { actions, calls } = loadBillingActions({
      billingStatus: {
        plan_id: "starter",
        status: "canceled",
        stripe_customer_id: "cus_persisted",
      },
    });
    await assert.rejects(
      () => actions.startCheckout(checkoutForm()),
      assertRedirect("https://checkout.stripe.com/c/pay/runtime"),
    );
    assert.equal(calls.coordinator.length, 1);
    assert.equal(calls.coordinator[0].input.tenantId, "tenant-resolved");
    assert.equal(calls.coordinator[0].input.userId, "user-authenticated");
    assert.equal(calls.coordinator[0].input.existingStripeCustomerId, "cus_persisted");
    assert.equal(Object.hasOwn(calls.coordinator[0].input, "customerEmail"), false);
    assert.equal(calls.serviceRole, 1);
    assert.equal(calls.provider, 1);
  });
});

test("checkout limiter is keyed only after the authenticated tenant is resolved", async () => {
  await withBillingEnvironment(async () => {
    const { actions, calls } = loadBillingActions({ rateLimited: true });
    await assert.rejects(
      () => actions.startCheckout(checkoutForm()),
      assertRedirect("/configuracoes?billing_error=checkout_pendente"),
    );
    assert.deepEqual(calls.limiter, [["billing-checkout:tenant-resolved", 60_000, 6]]);
    assert.equal(calls.serviceRole, 0);
    assert.equal(calls.provider, 0);
    assert.equal(calls.coordinator.length, 0);
  });
});

for (const [status, errorCode] of [
  ["pending", "checkout_pendente"],
  ["conflict", "checkout_conflito"],
]) {
  test(`durable ${status} result has the exact fail-closed redirect`, async () => {
    await withBillingEnvironment(async () => {
      const { actions } = loadBillingActions({ checkoutResult: { status } });
      await assert.rejects(
        () => actions.startCheckout(checkoutForm()),
        assertRedirect(`/configuracoes?billing_error=${errorCode}`),
      );
    });
  });
}

test("provider construction failure has the exact fail-closed redirect", async () => {
  await withBillingEnvironment(async () => {
    const { actions, calls } = loadBillingActions({ providerFailure: new Error("provider secret") });
    await assert.rejects(
      () => actions.startCheckout(checkoutForm()),
      assertRedirect("/configuracoes?billing_error=falha_ao_criar_checkout"),
    );
    assert.equal(calls.serviceRole, 0);
    assert.equal(calls.coordinator.length, 0);
    assert.equal(calls.telemetry[0][0], "billing_checkout_failed");
  });
});

test("coordinator failure has the exact fail-closed redirect", async () => {
  await withBillingEnvironment(async () => {
    const { actions, calls } = loadBillingActions({ coordinatorFailure: new Error("database failure") });
    await assert.rejects(
      () => actions.startCheckout(checkoutForm()),
      assertRedirect("/configuracoes?billing_error=falha_ao_criar_checkout"),
    );
    assert.equal(calls.coordinator.length, 1);
    assert.equal(calls.telemetry[0][0], "billing_checkout_failed");
  });
});

test("billing portal uses the persisted customer only after auth and tenant authorization", async () => {
  await withBillingEnvironment(async () => {
    const { actions, calls } = loadBillingActions({
      billingStatus: {
        plan_id: "starter",
        status: "active",
        stripe_customer_id: "cus_persisted",
      },
    });
    await assert.rejects(
      () => actions.openBillingPortal(),
      assertRedirect("https://billing.stripe.com/p/session/runtime"),
    );
    assert.equal(calls.portalSession.length, 1);
    assert.equal(calls.portalSession[0].stripeCustomerId, "cus_persisted");
    assert.equal(calls.portalSession[0].returnUrl, "https://app.axtro.test/configuracoes");
    assert.equal(calls.serviceRole, 0);
    assert.equal(calls.coordinator.length, 0);
  });
});
