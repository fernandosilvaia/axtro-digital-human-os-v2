import assert from "node:assert/strict";
import { test } from "node:test";

const webhook = await import("../../apps/portal/src/lib/billing/connect-webhook.ts");

const TENANT_ID = "0198a8b2-3c4d-7e5f-8a90-1234567890aa";
const RESERVATION_ID = "0198a8b2-3c4d-7e5f-8a90-1234567890ab";
const ACCOUNT_ID = "acct_1NTestConnected123";

function checkoutEvent(type = "checkout.session.completed", overrides = {}) {
  return {
    id: "evt_checkout_connect123",
    type,
    created: 1700000000,
    account: ACCOUNT_ID,
    data: {
      object: {
        id: "cs_test_connectcheckout123",
        payment_intent: "pi_1NTestConnect123",
        amount_total: 15000,
        metadata: {
          tenant_id: TENANT_ID,
          reservation_id: RESERVATION_ID,
        },
        ...overrides,
      },
    },
  };
}

test("parseStripeConnectCheckoutEvent aceita os três eventos fechados e preserva a conta conectada", () => {
  for (const type of [
    "checkout.session.completed",
    "checkout.session.expired",
    "checkout.session.async_payment_failed",
  ]) {
    const parsed = webhook.parseStripeConnectCheckoutEvent(checkoutEvent(type));
    assert.deepEqual(parsed, {
      eventId: "evt_checkout_connect123",
      eventType: type,
      eventCreatedIso: new Date(1700000000 * 1000).toISOString(),
      tenantId: TENANT_ID,
      reservationId: RESERVATION_ID,
      connectedAccountId: ACCOUNT_ID,
      stripeSessionId: "cs_test_connectcheckout123",
      paymentIntentId: "pi_1NTestConnect123",
      amountTotalCents: 15000,
    });
    assert.equal(webhook.isHandledStripeConnectCheckoutEventType(type), true);
  }
});

test("parser de checkout ignora eventos de outros domínios (assinatura, conta) sem lançar", () => {
  for (const type of ["customer.subscription.created", "account.updated", "invoice.paid"]) {
    assert.equal(webhook.parseStripeConnectCheckoutEvent({ id: "evt_x", type, account: ACCOUNT_ID, data: { object: {} } }), null);
  }
});

test("checkout de conta conectada falha fechado sem event.account, ou com tenant_id/reservation_id/session id malformados", () => {
  const cases = [];

  const noAccount = checkoutEvent();
  delete noAccount.account;
  cases.push(noAccount);

  const badAccount = checkoutEvent();
  badAccount.account = "not-an-account-id";
  cases.push(badAccount);

  cases.push(checkoutEvent("checkout.session.completed", { id: "session_wrong_prefix" }));
  cases.push(checkoutEvent("checkout.session.completed", { metadata: { tenant_id: "tenant_wrong", reservation_id: RESERVATION_ID } }));
  cases.push(checkoutEvent("checkout.session.completed", { metadata: { tenant_id: TENANT_ID, reservation_id: "not-a-uuidv7" } }));
  cases.push(checkoutEvent("checkout.session.completed", { metadata: { tenant_id: TENANT_ID } }));

  for (const event of cases) assert.equal(webhook.parseStripeConnectCheckoutEvent(event), null);
});

test("checkout de conta conectada rejeita payment_intent ou amount_total mal formados quando presentes", () => {
  assert.equal(webhook.parseStripeConnectCheckoutEvent(checkoutEvent("checkout.session.completed", { payment_intent: "not-a-pi-id" })), null);
  assert.equal(webhook.parseStripeConnectCheckoutEvent(checkoutEvent("checkout.session.completed", { amount_total: -1 })), null);
  assert.equal(webhook.parseStripeConnectCheckoutEvent(checkoutEvent("checkout.session.completed", { amount_total: 1.5 })), null);
});

test("checkout permite payment_intent/amount_total nulos no evento expired", () => {
  const parsed = webhook.parseStripeConnectCheckoutEvent(checkoutEvent("checkout.session.expired", {
    payment_intent: null,
    amount_total: null,
  }));
  assert.equal(parsed.paymentIntentId, null);
  assert.equal(parsed.amountTotalCents, null);
});

test("payload malformado (não-objeto, sem data.object, sem metadata) nunca lança e falha fechado", () => {
  assert.equal(webhook.parseStripeConnectCheckoutEvent(null), null);
  assert.equal(webhook.parseStripeConnectCheckoutEvent("string"), null);
  assert.equal(webhook.parseStripeConnectCheckoutEvent({ id: "evt_1", type: "checkout.session.completed", account: ACCOUNT_ID }), null);

  const noMetadata = checkoutEvent();
  delete noMetadata.data.object.metadata;
  assert.equal(webhook.parseStripeConnectCheckoutEvent(noMetadata), null);

  const missingCreated = checkoutEvent();
  delete missingCreated.created;
  assert.equal(webhook.parseStripeConnectCheckoutEvent(missingCreated), null);
});

test("isHandledStripeConnectEventType reconhece os 3 eventos de checkout mais account.updated", () => {
  assert.equal(webhook.isHandledStripeConnectEventType("checkout.session.completed"), true);
  assert.equal(webhook.isHandledStripeConnectEventType("checkout.session.expired"), true);
  assert.equal(webhook.isHandledStripeConnectEventType("checkout.session.async_payment_failed"), true);
  assert.equal(webhook.isHandledStripeConnectEventType("account.updated"), true);
  assert.equal(webhook.isHandledStripeConnectEventType("checkout.session.async_payment_succeeded"), false);
  assert.equal(webhook.isHandledStripeConnectEventType("invoice.paid"), false);
  assert.equal(webhook.isHandledStripeConnectEventType(undefined), false);
});

function accountEvent(overrides = {}) {
  return {
    id: "evt_account_update123",
    type: "account.updated",
    created: 1700000000,
    account: ACCOUNT_ID,
    data: {
      object: {
        id: ACCOUNT_ID,
        charges_enabled: true,
        payouts_enabled: true,
        details_submitted: true,
        ...overrides,
      },
    },
  };
}

test("parseStripeConnectAccountEvent extrai o estado de onboarding da conta conectada", () => {
  const parsed = webhook.parseStripeConnectAccountEvent(accountEvent());
  assert.deepEqual(parsed, {
    eventId: "evt_account_update123",
    eventType: "account.updated",
    eventCreatedIso: new Date(1700000000 * 1000).toISOString(),
    connectedAccountId: ACCOUNT_ID,
    chargesEnabled: true,
    payoutsEnabled: true,
    detailsSubmitted: true,
  });
});

test("account.updated aceita qualquer combinação de flags booleanas (onboarding parcial)", () => {
  const parsed = webhook.parseStripeConnectAccountEvent(accountEvent({ charges_enabled: false, payouts_enabled: false, details_submitted: false }));
  assert.equal(parsed.chargesEnabled, false);
  assert.equal(parsed.payoutsEnabled, false);
  assert.equal(parsed.detailsSubmitted, false);
});

test("account.updated falha fechado quando event.account e data.object.id divergem", () => {
  const mismatched = accountEvent();
  mismatched.account = "acct_test_different999";
  assert.equal(webhook.parseStripeConnectAccountEvent(mismatched), null);
});

test("account.updated aceita quando event.account está ausente, desde que data.object.id seja válido", () => {
  const noTopLevelAccount = accountEvent();
  delete noTopLevelAccount.account;
  const parsed = webhook.parseStripeConnectAccountEvent(noTopLevelAccount);
  assert.equal(parsed.connectedAccountId, ACCOUNT_ID);
});

test("account.updated falha fechado sem id de conta válido ou flags não booleanas", () => {
  const badId = accountEvent();
  badId.data.object.id = "not-an-account-id";
  assert.equal(webhook.parseStripeConnectAccountEvent(badId), null);

  const badFlag = accountEvent({ charges_enabled: "true" });
  assert.equal(webhook.parseStripeConnectAccountEvent(badFlag), null);

  assert.equal(webhook.parseStripeConnectAccountEvent({ id: "evt_1", type: "account.updated" }), null);
});

test("parser de conta ignora eventos que não são account.updated sem lançar", () => {
  for (const type of ["checkout.session.completed", "customer.subscription.created"]) {
    assert.equal(webhook.parseStripeConnectAccountEvent({ id: "evt_x", type, account: ACCOUNT_ID, data: { object: {} } }), null);
  }
});

test("verifyStripeWebhookSignature é reexportado do módulo de billing (mesma verificação HMAC, endpoint/segredo diferentes)", () => {
  assert.equal(typeof webhook.verifyStripeWebhookSignature, "function");
});
