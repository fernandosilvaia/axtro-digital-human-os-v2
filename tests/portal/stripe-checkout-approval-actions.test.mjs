import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { test } from "node:test";

import ts from "typescript";

/**
 * Server Actions de aprovação/rejeição de checkout (ADR-040), mesmo
 * mecanismo de `stripe-checkout-catalog-actions.test.mjs`. Depois desta
 * revisão, `approveBusinessCheckoutReservation` não é mais DB-only: em
 * sucesso ela despacha, roda o preflight de preço vivo, cria a Checkout
 * Session (real ou fake conforme `PORTAL_FAKE_PROVIDERS`), comita e manda
 * o e-mail -- este harness mocka toda essa cadeia.
 */
const actionsSource = await readFile(
  new URL("../../apps/portal/src/lib/actions/stripe-checkout-approval.ts", import.meta.url),
  "utf8",
);

const RESERVATION_ID = "0198a8b2-3c4d-7e5f-8a90-1234567890ab";

class MockStripeBillingError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "StripeBillingError";
    this.code = code;
  }
}

function defaultDispatchSnapshot() {
  return {
    acquired: true,
    state: "provider_in_flight",
    reservationId: RESERVATION_ID,
    productId: "onboarding_kit",
    displayName: "Kit de onboarding",
    quantity: 1,
    unitAmountCents: 9900,
    currency: "usd",
    stripePriceId: "price_HarnessKit001",
    stripeAccountId: "acct_1NConnectedTest123",
    applicationFeeAmountCents: null,
    contactEmail: "ana@example.test",
    stripeIdempotencyKey: `checkout:${RESERVATION_ID}`,
  };
}

function loadApprovalActions(options = {}) {
  const calls = {
    fetchOverview: 0, serviceRole: 0, rpc: [], telemetry: [], telemetryEvents: [],
    createPort: [], fakePortFactory: [], verifyPrice: [], createSession: [], email: [],
  };
  const user = Object.hasOwn(options, "user") ? options.user : { id: "user-authenticated", app_metadata: { actor_id: "0198a000-0000-7000-8000-0000000000a1" } };
  const overview = options.overview ?? { provisioned: true, role: "tenant_admin", tenant: { id: "tenant-resolved" } };
  const supabase = { auth: { async getUser() { return { data: { user } }; } } };
  const approveResult = options.approveResult ?? { data: { outcome: "approved", reservationId: RESERVATION_ID, state: "reserved" }, error: null };
  const rejectResult = options.rejectResult ?? { data: { outcome: "rejected", reservationId: RESERVATION_ID, state: "rejected" }, error: null };
  const dispatchResult = options.dispatchResult ?? { data: defaultDispatchSnapshot(), error: null };
  const releaseResult = options.releaseResult ?? { data: { outcome: "released", reservationId: RESERVATION_ID, state: "released" }, error: null };
  const commitResult = options.commitResult ?? { data: { outcome: "succeeded", reservationId: RESERVATION_ID, state: "committed", checkoutUrl: "https://checkout.stripe.com/harness" }, error: null };
  const markUnknownResult = options.markUnknownResult ?? { data: true, error: null };
  const verifyPriceThrows = options.verifyPriceThrows;
  const createSessionThrows = options.createSessionThrows;
  const emailResult = options.emailResult ?? { sent: true, reason: "sent" };
  const emailThrows = options.emailThrows;

  function portMock() {
    return {
      async verifyConnectedAccountPrice(request) {
        calls.verifyPrice.push(request);
        if (verifyPriceThrows !== undefined) throw verifyPriceThrows;
        return { verified: true, priceId: request.priceId, unitAmountCents: request.expectedUnitAmountCents, currency: request.expectedCurrency };
      },
      async createConnectedAccountCheckoutSession(request) {
        calls.createSession.push(request);
        if (createSessionThrows !== undefined) throw createSessionThrows;
        return { sessionId: "cs_test_mockSession123", checkoutUrl: "https://checkout.stripe.com/mock/cs_test_mockSession123", expiresAtIso: request.expiresAtIso };
      },
    };
  }

  const mocks = new Map([
    ["@axtro/provider-stripe", {
      StripeBillingError: MockStripeBillingError,
      createStripeBillingPort(factoryOptions) {
        calls.createPort.push(factoryOptions);
        return portMock();
      },
    }],
    ["@/lib/billing/checkout-preflight", {
      createDeterministicFakeConnectedAccountCheckoutPort(notConfiguredUrl) {
        calls.fakePortFactory.push(notConfiguredUrl);
        return portMock();
      },
    }],
    ["@/lib/email", {
      async sendCheckoutLinkEmail(input) {
        calls.email.push(input);
        if (emailThrows !== undefined) throw emailThrows;
        return emailResult;
      },
    }],
    ["@/lib/public-origin", {
      portalPublicOrigin() {
        if (options.originThrows) throw new Error("PORTAL_PUBLIC_URL must be an exact approved HTTPS origin");
        return options.origin ?? "https://portal.test";
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
            if (name === "portal_approve_business_checkout_service") return approveResult;
            if (name === "portal_reject_business_checkout_service") return rejectResult;
            if (name === "portal_dispatch_business_checkout_reservation_service") return dispatchResult;
            if (name === "portal_release_business_checkout_reservation_service") return releaseResult;
            if (name === "portal_commit_business_checkout_reservation_service") return commitResult;
            if (name === "portal_mark_business_checkout_reservation_unknown_service") return markUnknownResult;
            throw new Error(`unexpected rpc: ${name}`);
          },
        };
      },
    }],
    ["@/lib/telemetry", {
      logError(...args) {
        calls.telemetry.push(args);
      },
      logEvent(...args) {
        calls.telemetryEvents.push(args);
      },
    }],
  ]);

  const compiled = ts.transpileModule(actionsSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: "stripe-checkout-approval.ts",
  }).outputText;
  const module = { exports: {} };
  const requireMock = (specifier) => {
    const resolved = mocks.get(specifier);
    if (resolved === undefined) throw new Error(`Unexpected stripe-checkout-approval action import: ${specifier}`);
    return resolved;
  };
  const wrapper = new vm.Script(`(function (require, module, exports) { ${compiled}\n})`, {
    filename: "stripe-checkout-approval.runtime.cjs",
  });
  wrapper.runInNewContext({ process })(requireMock, module, module.exports);
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

function withStripeSecretKey(run) {
  const before = process.env.STRIPE_SECRET_KEY;
  process.env.STRIPE_SECRET_KEY = "sk_test_real_key_00000000000000";
  return Promise.resolve()
    .then(run)
    .finally(() => {
      if (before === undefined) delete process.env.STRIPE_SECRET_KEY;
      else process.env.STRIPE_SECRET_KEY = before;
    });
}

// ---------------------------------------------------------------------------
// approveBusinessCheckoutReservation: validação e o próprio approve()
// ---------------------------------------------------------------------------

test("approveBusinessCheckoutReservation valida o formato da reserva antes de qualquer auth/RPC", async () => {
  const { actions, calls } = loadApprovalActions();
  const result = await actions.approveBusinessCheckoutReservation("not-a-uuid");
  assert.notEqual(result.error, null);
  assert.equal(calls.fetchOverview, 0);
  assert.equal(calls.serviceRole, 0);
});

test("approveBusinessCheckoutReservation recusa um chamador não autenticado sem tocar a RPC", async () => {
  const { actions, calls } = loadApprovalActions({ user: null });
  const result = await actions.approveBusinessCheckoutReservation(RESERVATION_ID);
  assert.match(result.error, /Sessão expirada/);
  assert.equal(calls.serviceRole, 0);
});

test("approveBusinessCheckoutReservation recusa quem não é tenant_admin", async () => {
  const { actions, calls } = loadApprovalActions({ overview: { provisioned: true, role: "tenant_operator", tenant: { id: "tenant-resolved" } } });
  const result = await actions.approveBusinessCheckoutReservation(RESERVATION_ID);
  assert.match(result.error, /administradores/);
  assert.equal(calls.serviceRole, 0);
});

test("approveBusinessCheckoutReservation chama approve com tenant/reserva/actor/contactEmail corretos", async () => {
  await withFakeProviders(async () => {
    const { actions, calls } = loadApprovalActions();
    const result = await actions.approveBusinessCheckoutReservation(RESERVATION_ID, " ana@example.test ");
    assert.equal(result.error, null);
    const approveCall = calls.rpc.find((c) => c.name === "portal_approve_business_checkout_service");
    assert.equal(approveCall.args.p_tenant_id, "tenant-resolved");
    assert.equal(approveCall.args.p_reservation_id, RESERVATION_ID);
    assert.equal(approveCall.args.p_actor_id, "0198a000-0000-7000-8000-0000000000a1");
    assert.equal(approveCall.args.p_contact_email, "ana@example.test");
  }, true);
});

test("approveBusinessCheckoutReservation omite contactEmail como null quando não informado", async () => {
  await withFakeProviders(async () => {
    const { actions, calls } = loadApprovalActions();
    await actions.approveBusinessCheckoutReservation(RESERVATION_ID);
    assert.equal(calls.rpc[0].args.p_contact_email, null);
  }, true);
});

test("approveBusinessCheckoutReservation devolve mensagens específicas para contact_email_required/already_rejected/approval_expired, sem tentar despachar", async () => {
  const cases = [
    ["contact_email_required", /e-mail/],
    ["already_rejected", /rejeitada/],
    ["approval_expired", /expirou/],
  ];
  for (const [outcome, pattern] of cases) {
    const { actions, calls } = loadApprovalActions({ approveResult: { data: { outcome }, error: null } });
    const result = await actions.approveBusinessCheckoutReservation(RESERVATION_ID);
    assert.match(result.error, pattern);
    assert.equal(calls.rpc.some((c) => c.name === "portal_dispatch_business_checkout_reservation_service"), false);
  }
});

test("approveBusinessCheckoutReservation devolve erro quando a RPC de aprovação falha ou devolve outcome totalmente inesperado, sem despachar", async () => {
  const failed = loadApprovalActions({ approveResult: { data: null, error: { message: "db down" } } });
  const failedResult = await failed.actions.approveBusinessCheckoutReservation(RESERVATION_ID);
  assert.notEqual(failedResult.error, null);
  assert.equal(failed.calls.telemetry[0][0], "checkout_approve_failed");
  assert.equal(failed.calls.rpc.some((c) => c.name === "portal_dispatch_business_checkout_reservation_service"), false);

  const unexpected = loadApprovalActions({ approveResult: { data: { outcome: "weird" }, error: null } });
  const unexpectedResult = await unexpected.actions.approveBusinessCheckoutReservation(RESERVATION_ID);
  assert.notEqual(unexpectedResult.error, null);
  assert.equal(unexpected.calls.telemetry[0][0], "checkout_approve_unexpected_outcome");
});

test("approveBusinessCheckoutReservation devolve erro legível quando o service role está indisponível", async () => {
  const { actions, calls } = loadApprovalActions({ serviceRoleThrows: new Error("SUPABASE_SERVICE_ROLE_KEY is not configured") });
  const result = await actions.approveBusinessCheckoutReservation(RESERVATION_ID);
  assert.notEqual(result.error, null);
  assert.equal(calls.telemetry[0][0], "checkout_approve_failed");
});

// ---------------------------------------------------------------------------
// dispatchAndCommitCheckout (via approveBusinessCheckoutReservation em sucesso)
// ---------------------------------------------------------------------------

test("caminho feliz completo: dispatch -> preflight -> createConnectedAccountCheckoutSession -> commit -> e-mail, em modo fake", async () => {
  await withFakeProviders(async () => {
    const { actions, calls } = loadApprovalActions();
    const result = await actions.approveBusinessCheckoutReservation(RESERVATION_ID);
    assert.equal(result.error, null);

    assert.equal(calls.fakePortFactory.length, 1, "modo fake usa a fábrica de porta fake");
    assert.equal(calls.createPort.length, 0, "modo fake nunca cria a porta real");

    assert.equal(calls.verifyPrice.length, 1);
    assert.equal(calls.verifyPrice[0].stripeAccountId, "acct_1NConnectedTest123");
    assert.equal(calls.verifyPrice[0].priceId, "price_HarnessKit001");
    assert.equal(calls.verifyPrice[0].expectedUnitAmountCents, 9900);
    assert.equal(calls.verifyPrice[0].expectedCurrency, "usd");

    assert.equal(calls.createSession.length, 1);
    assert.equal(calls.createSession[0].reservationId, RESERVATION_ID);
    assert.equal(calls.createSession[0].tenantId, "tenant-resolved");
    assert.equal(calls.createSession[0].stripeAccountId, "acct_1NConnectedTest123");
    assert.equal(calls.createSession[0].priceId, "price_HarnessKit001");
    assert.equal(calls.createSession[0].quantity, 1);
    assert.equal(calls.createSession[0].contactEmail, "ana@example.test");
    assert.equal(calls.createSession[0].idempotencyKey, `checkout:${RESERVATION_ID}`, "a mesma chave gravada na reserva, nunca gerada de novo");

    const commitCall = calls.rpc.find((c) => c.name === "portal_commit_business_checkout_reservation_service");
    assert.equal(commitCall.args.p_tenant_id, "tenant-resolved");
    assert.equal(commitCall.args.p_reservation_id, RESERVATION_ID);
    assert.equal(commitCall.args.p_stripe_checkout_session_id, "cs_test_mockSession123");
    assert.equal(commitCall.args.p_checkout_url, "https://checkout.stripe.com/mock/cs_test_mockSession123");

    assert.equal(calls.email.length, 1);
    assert.equal(calls.email[0].to, "ana@example.test");
    assert.equal(calls.email[0].productDisplayName, "Kit de onboarding");
    assert.equal(calls.email[0].unitAmountCents, 9900);
    assert.equal(calls.email[0].quantity, 1);
    assert.equal(calls.email[0].checkoutUrl, "https://checkout.stripe.com/mock/cs_test_mockSession123");
  }, true);
});

test("caminho feliz completo em modo real: usa createStripeBillingPort com a chave real, nunca a fábrica fake", async () => {
  await withStripeSecretKey(() => withFakeProviders(async () => {
    const { actions, calls } = loadApprovalActions();
    const result = await actions.approveBusinessCheckoutReservation(RESERVATION_ID);
    assert.equal(result.error, null);
    assert.equal(calls.createPort.length, 1);
    assert.equal(calls.createPort[0].apiKey, "sk_test_real_key_00000000000000");
    assert.equal(calls.fakePortFactory.length, 0);
  }, false));
});

test("modo real sem STRIPE_SECRET_KEY falha fechado antes de qualquer chamada de preço/sessão", async () => {
  await withFakeProviders(async () => {
    const { actions, calls } = loadApprovalActions();
    const result = await actions.approveBusinessCheckoutReservation(RESERVATION_ID);
    assert.notEqual(result.error, null);
    assert.equal(calls.verifyPrice.length, 0);
    assert.equal(calls.createSession.length, 0);
    assert.equal(calls.telemetry.some((t) => t[0] === "checkout_dispatch_not_configured"), true);
  }, false);
});

test("origem pública não configurada falha fechado antes de qualquer chamada de preço/sessão", async () => {
  await withFakeProviders(async () => {
    const { actions, calls } = loadApprovalActions({ originThrows: true });
    const result = await actions.approveBusinessCheckoutReservation(RESERVATION_ID);
    assert.notEqual(result.error, null);
    assert.equal(calls.verifyPrice.length, 0);
    assert.equal(calls.telemetry.some((t) => t[0] === "checkout_dispatch_origin_not_configured"), true);
  }, true);
});

test("acquired:false com state seguro (concorrência ou já resolvido) é tratado como sucesso idempotente", async () => {
  await withFakeProviders(async () => {
    for (const state of ["provider_in_flight", "committed", "payment_completed", "payment_failed", "expired"]) {
      const { actions, calls } = loadApprovalActions({ dispatchResult: { data: { acquired: false, state }, error: null } });
      const result = await actions.approveBusinessCheckoutReservation(RESERVATION_ID);
      assert.equal(result.error, null, `state=${state}`);
      assert.equal(calls.verifyPrice.length, 0, `state=${state}: nunca roda o preflight sem ter adquirido a fence`);
    }
  }, true);
});

test("acquired:false com state inesperado (released/unknown) devolve erro declarado", async () => {
  await withFakeProviders(async () => {
    for (const state of ["released", "unknown"]) {
      const { actions, calls } = loadApprovalActions({ dispatchResult: { data: { acquired: false, state }, error: null } });
      const result = await actions.approveBusinessCheckoutReservation(RESERVATION_ID);
      assert.notEqual(result.error, null, `state=${state}`);
      assert.equal(calls.telemetry.some((t) => t[0] === "checkout_dispatch_not_acquired"), true);
    }
  }, true);
});

test("erro na RPC de dispatch devolve erro legível sem lançar", async () => {
  await withFakeProviders(async () => {
    const { actions, calls } = loadApprovalActions({ dispatchResult: { data: null, error: { message: "db down" } } });
    const result = await actions.approveBusinessCheckoutReservation(RESERVATION_ID);
    assert.notEqual(result.error, null);
    assert.equal(calls.telemetry[calls.telemetry.length - 1][0], "checkout_dispatch_failed");
  }, true);
});

test("snapshot de dispatch malformado (campo obrigatório ausente) falha fechado", async () => {
  await withFakeProviders(async () => {
    const incomplete = defaultDispatchSnapshot();
    delete incomplete.stripePriceId;
    const { actions, calls } = loadApprovalActions({ dispatchResult: { data: incomplete, error: null } });
    const result = await actions.approveBusinessCheckoutReservation(RESERVATION_ID);
    assert.notEqual(result.error, null);
    assert.equal(calls.telemetry.some((t) => t[0] === "checkout_dispatch_malformed_snapshot"), true);
    assert.equal(calls.verifyPrice.length, 0);
  }, true);
});

test("snapshot sem contactEmail falha fechado em vez de mandar o link pra lugar nenhum", async () => {
  await withFakeProviders(async () => {
    const noEmail = { ...defaultDispatchSnapshot(), contactEmail: null };
    const { actions, calls } = loadApprovalActions({ dispatchResult: { data: noEmail, error: null } });
    const result = await actions.approveBusinessCheckoutReservation(RESERVATION_ID);
    assert.notEqual(result.error, null);
    assert.equal(calls.telemetry.some((t) => t[0] === "checkout_dispatch_missing_contact_email"), true);
    assert.equal(calls.verifyPrice.length, 0);
  }, true);
});

test("preflight de preço falhando libera a reserva com evidência price_preflight_failed e nunca cria a sessão", async () => {
  await withFakeProviders(async () => {
    const { actions, calls } = loadApprovalActions({ verifyPriceThrows: new MockStripeBillingError("invalid_request", "price mismatch") });
    const result = await actions.approveBusinessCheckoutReservation(RESERVATION_ID);
    assert.notEqual(result.error, null);
    assert.match(result.error, /preço/);
    assert.equal(calls.createSession.length, 0, "nunca cria a sessão depois de um preflight rejeitado");
    const releaseCall = calls.rpc.find((c) => c.name === "portal_release_business_checkout_reservation_service");
    assert.ok(releaseCall, "chama release");
    assert.equal(releaseCall.args.p_tenant_id, "tenant-resolved");
    assert.equal(releaseCall.args.p_reservation_id, RESERVATION_ID);
    assert.equal(releaseCall.args.p_evidence, "price_preflight_failed");
    assert.equal(calls.telemetry.some((t) => t[0] === "checkout_price_preflight_failed"), true);
  }, true);
});

test("preflight falhando E o próprio release falhando ainda devolve o erro do preflight, com telemetria extra", async () => {
  await withFakeProviders(async () => {
    const { actions, calls } = loadApprovalActions({
      verifyPriceThrows: new MockStripeBillingError("invalid_request", "price mismatch"),
      releaseResult: { data: null, error: { message: "db down" } },
    });
    const result = await actions.approveBusinessCheckoutReservation(RESERVATION_ID);
    assert.notEqual(result.error, null);
    assert.equal(calls.telemetry.some((t) => t[0] === "checkout_price_preflight_release_failed"), true);
  }, true);
});

test("falha ao criar a Checkout Session marca a reserva como unknown (ambígua), nunca released", async () => {
  await withFakeProviders(async () => {
    const { actions, calls } = loadApprovalActions({ createSessionThrows: new MockStripeBillingError("provider_timeout", "timed out") });
    const result = await actions.approveBusinessCheckoutReservation(RESERVATION_ID);
    assert.notEqual(result.error, null);
    assert.match(result.error, /reconcilia/);
    assert.equal(calls.rpc.some((c) => c.name === "portal_release_business_checkout_reservation_service"), false);
    const markUnknownCall = calls.rpc.find((c) => c.name === "portal_mark_business_checkout_reservation_unknown_service");
    assert.ok(markUnknownCall, "chama mark_unknown");
    assert.equal(markUnknownCall.args.p_tenant_id, "tenant-resolved");
    assert.equal(markUnknownCall.args.p_reservation_id, RESERVATION_ID);
    assert.match(markUnknownCall.args.p_failure_code, /provider_timeout/);
    assert.equal(calls.rpc.some((c) => c.name === "portal_commit_business_checkout_reservation_service"), false);
  }, true);
});

test("mark_unknown falhando depois de uma criação de sessão malsucedida ainda devolve o erro original, com telemetria extra", async () => {
  await withFakeProviders(async () => {
    const { actions, calls } = loadApprovalActions({
      createSessionThrows: new MockStripeBillingError("provider_unavailable", "down"),
      markUnknownResult: { data: null, error: { message: "db down" } },
    });
    const result = await actions.approveBusinessCheckoutReservation(RESERVATION_ID);
    assert.notEqual(result.error, null);
    assert.equal(calls.telemetry.some((t) => t[0] === "checkout_mark_unknown_failed"), true);
  }, true);
});

test("commit falhando depois de uma sessão criada com sucesso marca unknown (a sessão já existe na Stripe, só a gravação local falhou)", async () => {
  await withFakeProviders(async () => {
    const { actions, calls } = loadApprovalActions({ commitResult: { data: null, error: { message: "db down" } } });
    const result = await actions.approveBusinessCheckoutReservation(RESERVATION_ID);
    assert.notEqual(result.error, null);
    assert.match(result.error, /reconcilia/);
    const markUnknownCall = calls.rpc.find((c) => c.name === "portal_mark_business_checkout_reservation_unknown_service");
    assert.ok(markUnknownCall);
    assert.equal(markUnknownCall.args.p_failure_code, "checkout_commit_write_failed");
    assert.equal(calls.email.length, 0, "nunca manda o e-mail sem confirmar o commit");
  }, true);
});

test("commit devolvendo um outcome inesperado (não 'succeeded') é tratado como falha, marca unknown", async () => {
  await withFakeProviders(async () => {
    const { actions, calls } = loadApprovalActions({ commitResult: { data: { outcome: "weird" }, error: null } });
    const result = await actions.approveBusinessCheckoutReservation(RESERVATION_ID);
    assert.notEqual(result.error, null);
    assert.equal(calls.rpc.some((c) => c.name === "portal_mark_business_checkout_reservation_unknown_service"), true);
  }, true);
});

test("e-mail não enviado (reason !== sent) nunca falha a aprovação: o commit já é durável, é best-effort", async () => {
  await withFakeProviders(async () => {
    const { actions, calls } = loadApprovalActions({ emailResult: { sent: false, reason: "provider_error" } });
    const result = await actions.approveBusinessCheckoutReservation(RESERVATION_ID);
    assert.equal(result.error, null);
    assert.equal(calls.telemetry.some((t) => t[0] === "checkout_link_email_not_sent"), true);
  }, true);
});

test("e-mail lançando uma exceção também nunca falha a aprovação", async () => {
  await withFakeProviders(async () => {
    const { actions, calls } = loadApprovalActions({ emailThrows: new Error("resend down") });
    const result = await actions.approveBusinessCheckoutReservation(RESERVATION_ID);
    assert.equal(result.error, null);
    assert.equal(calls.telemetry.some((t) => t[0] === "checkout_link_email_not_sent"), true);
  }, true);
});

// ---------------------------------------------------------------------------
// rejectBusinessCheckoutReservation
// ---------------------------------------------------------------------------

test("rejectBusinessCheckoutReservation valida o formato da reserva antes de qualquer auth/RPC", async () => {
  const { actions, calls } = loadApprovalActions();
  const result = await actions.rejectBusinessCheckoutReservation("not-a-uuid");
  assert.notEqual(result.error, null);
  assert.equal(calls.serviceRole, 0);
});

test("rejectBusinessCheckoutReservation rejeita um motivo maior que 500 caracteres antes de qualquer RPC", async () => {
  const { actions, calls } = loadApprovalActions();
  const result = await actions.rejectBusinessCheckoutReservation(RESERVATION_ID, "x".repeat(501));
  assert.notEqual(result.error, null);
  assert.equal(calls.serviceRole, 0);
});

test("rejectBusinessCheckoutReservation recusa um chamador não autenticado sem tocar a RPC", async () => {
  const { actions, calls } = loadApprovalActions({ user: null });
  const result = await actions.rejectBusinessCheckoutReservation(RESERVATION_ID);
  assert.match(result.error, /Sessão expirada/);
  assert.equal(calls.serviceRole, 0);
});

test("rejectBusinessCheckoutReservation recusa quem não é tenant_admin", async () => {
  const { actions, calls } = loadApprovalActions({ overview: { provisioned: true, role: "tenant_operator", tenant: { id: "tenant-resolved" } } });
  const result = await actions.rejectBusinessCheckoutReservation(RESERVATION_ID);
  assert.match(result.error, /administradores/);
  assert.equal(calls.serviceRole, 0);
});

test("rejectBusinessCheckoutReservation chama a RPC com tenant/reserva/actor/motivo corretos em sucesso, nunca toca a Stripe", async () => {
  const { actions, calls } = loadApprovalActions();
  const result = await actions.rejectBusinessCheckoutReservation(RESERVATION_ID, " prospect desistiu ");
  assert.equal(result.error, null);
  assert.equal(calls.rpc.length, 1);
  assert.equal(calls.rpc[0].name, "portal_reject_business_checkout_service");
  assert.equal(calls.rpc[0].args.p_tenant_id, "tenant-resolved");
  assert.equal(calls.rpc[0].args.p_reservation_id, RESERVATION_ID);
  assert.equal(calls.rpc[0].args.p_actor_id, "0198a000-0000-7000-8000-0000000000a1");
  assert.equal(calls.rpc[0].args.p_rejection_reason, "prospect desistiu");
  assert.equal(calls.createPort.length, 0);
  assert.equal(calls.fakePortFactory.length, 0);
});

test("rejectBusinessCheckoutReservation trata already_rejected como sucesso idempotente", async () => {
  const { actions } = loadApprovalActions({ rejectResult: { data: { outcome: "already_rejected" }, error: null } });
  const result = await actions.rejectBusinessCheckoutReservation(RESERVATION_ID);
  assert.equal(result.error, null);
});

test("rejectBusinessCheckoutReservation devolve mensagens específicas para already_approved/approval_expired", async () => {
  const cases = [
    ["already_approved", /aprovada/],
    ["approval_expired", /expirou/],
  ];
  for (const [outcome, pattern] of cases) {
    const { actions } = loadApprovalActions({ rejectResult: { data: { outcome }, error: null } });
    const result = await actions.rejectBusinessCheckoutReservation(RESERVATION_ID);
    assert.match(result.error, pattern);
  }
});

test("rejectBusinessCheckoutReservation devolve erro quando a RPC falha ou devolve outcome totalmente inesperado", async () => {
  const failed = loadApprovalActions({ rejectResult: { data: null, error: { message: "db down" } } });
  const failedResult = await failed.actions.rejectBusinessCheckoutReservation(RESERVATION_ID);
  assert.notEqual(failedResult.error, null);
  assert.equal(failed.calls.telemetry[0][0], "checkout_reject_failed");

  const unexpected = loadApprovalActions({ rejectResult: { data: { outcome: "weird" }, error: null } });
  const unexpectedResult = await unexpected.actions.rejectBusinessCheckoutReservation(RESERVATION_ID);
  assert.notEqual(unexpectedResult.error, null);
  assert.equal(unexpected.calls.telemetry[0][0], "checkout_reject_unexpected_outcome");
});

test("rejectBusinessCheckoutReservation devolve erro legível quando o service role está indisponível", async () => {
  const { actions, calls } = loadApprovalActions({ serviceRoleThrows: new Error("SUPABASE_SERVICE_ROLE_KEY is not configured") });
  const result = await actions.rejectBusinessCheckoutReservation(RESERVATION_ID);
  assert.notEqual(result.error, null);
  assert.equal(calls.telemetry[0][0], "checkout_reject_failed");
});
