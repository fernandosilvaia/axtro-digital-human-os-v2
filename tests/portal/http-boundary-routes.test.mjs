import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { test } from "node:test";

const realModules = new Map([
  ["@/lib/http/read-bounded-body", new URL("../../apps/portal/src/lib/http/read-bounded-body.ts", import.meta.url).href],
  ["@/lib/leads/video-session", new URL("../../apps/portal/src/lib/leads/video-session.ts", import.meta.url).href],
]);

const mockSources = new Map([
  ["next/server", `
    export class NextRequest {}
    export class NextResponse extends Response {
      static json(body, init) { return new Response(JSON.stringify(body), { ...init, headers: { "content-type": "application/json" } }); }
    }
  `],
  ["@axtro/domain", `export function createUuidV7() { return "0198a000-0000-7000-8000-000000000099"; }`],
  ["@axtro/provider-tavus", `
    export class VideoProviderError extends Error {}
    export function isTrustedTavusConversationUrl(value) { return typeof value === "string" && value.startsWith("https://tavus.daily.co/"); }
    export function createTavusVideoConversationPort() {
      globalThis.__httpBoundaryState.providerFactories += 1;
      return { createConversation() { throw new Error("unexpected provider call"); }, endConversation() {} };
    }
  `],
  ["@/lib/rate-limit", `
    export function isRateLimited(key) {
      globalThis.__httpBoundaryState.rateLimitKeys.push(key);
      return false;
    }
  `],
  ["@/lib/supabase/service", `
    export class ServiceRoleUnavailableError extends Error {}
    export function createServiceRoleClient() {
      globalThis.__httpBoundaryState.serviceRoleFactories += 1;
      return {
        rpc(name, args) {
          globalThis.__httpBoundaryState.rpcCalls.push({ name, args });
          return Promise.resolve(globalThis.__httpBoundaryState.rpcResponses[name] ?? { data: null, error: { message: "unexpected database call" } });
        },
        from() { throw new Error("unexpected database call"); },
      };
    }
  `],
  ["@/lib/telemetry", `export function logError() {} export function logEvent() {}`],
  ["@/lib/transcripts/register", `
    export async function prepareTavusWebhookCallback() { throw new Error("unexpected callback bind"); }
    export async function registerTranscriptPlaceholder() { throw new Error("unexpected transcript write"); }
  `],
  ["@/lib/paid-effects", `
    export async function activateProviderEffectBilling() { throw new Error("unexpected billing call"); }
    export async function beginProviderEffect() { throw new Error("unexpected reservation call"); }
    export async function commitProviderEffectOrCompensate() { throw new Error("unexpected commit call"); }
    export async function compensateCommittedProviderEffect() { throw new Error("unexpected compensation call"); }
    export async function fenceProviderFailure() {}
    export function isPaidEffectCommandId() { return true; }
    export async function markCleanupPending() {}
    export function paidEffectIntentKey() { return "key"; }
    export function providerCorrelationLabel(value) { return value; }
    export async function retryReleasedProviderEffect(_input, reservation) { return reservation; }
  `],
  ["@/lib/billing/plans", `
    export const PLAN_ORDER = ["solo"];
    export const PLAN_CATALOG = { solo: { basePriceEnvVar: "STRIPE_PRICE_SOLO_BASE", overagePriceEnvVar: "STRIPE_PRICE_SOLO_OVERAGE" } };
  `],
  ["@/lib/billing/webhook", `
    export function verifyStripeWebhookSignature() { globalThis.__httpBoundaryState.stripeSignatureChecks += 1; return true; }
    export function parseStripeSubscriptionEvent() { return globalThis.__httpBoundaryState.subscriptionEvent ?? null; }
    export function parseStripeCheckoutEvent() { return globalThis.__httpBoundaryState.checkoutEvent ?? null; }
    export function isHandledStripeSubscriptionEventType() { return globalThis.__httpBoundaryState.handledSubscriptionEventType; }
    export function isHandledStripeCheckoutEventType() { return globalThis.__httpBoundaryState.handledCheckoutEventType; }
  `],
  ["@/lib/email-webhook", `
    export function verifyResendWebhookSignature() { globalThis.__httpBoundaryState.resendSignatureChecks += 1; return true; }
    export function parseResendWebhookEvent() { return null; }
    export function isHandledResendEventType() { return false; }
  `],
]);

registerHooks({
  resolve(specifier, context, nextResolve) {
    const realUrl = realModules.get(specifier);
    if (realUrl) return { url: realUrl, shortCircuit: true };
    if (mockSources.has(specifier)) return { url: `http-boundary-mock:${encodeURIComponent(specifier)}`, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith("http-boundary-mock:")) {
      const specifier = decodeURIComponent(url.slice("http-boundary-mock:".length));
      return { format: "module", source: mockSources.get(specifier), shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

function freshState() {
  const state = {
    providerFactories: 0,
    serviceRoleFactories: 0,
    rateLimitKeys: [],
    stripeSignatureChecks: 0,
    resendSignatureChecks: 0,
    rpcCalls: [],
    rpcResponses: {},
    checkoutEvent: null,
    subscriptionEvent: null,
    handledSubscriptionEventType: false,
    handledCheckoutEventType: false,
  };
  globalThis.__httpBoundaryState = state;
  return state;
}

function chunkedBody(...sizes) {
  return new ReadableStream({
    start(controller) {
      for (const size of sizes) controller.enqueue(new Uint8Array(size));
      controller.close();
    },
  });
}

function requestWithBody(body, headers = {}) {
  return { headers: new Headers(headers), body };
}

const RAISSA_SECRET = "raissa-tools-route-test-secret-32";
process.env.RAISSA_TOOLS_SECRET = RAISSA_SECRET;
process.env.TAVUS_API_KEY = "tavus-route-test-key";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_stripe_route_test";
process.env.RESEND_WEBHOOK_SECRET = "whsec_resend_route_test";
process.env.STRIPE_PRICE_SOLO_BASE = "price_solo_base";
process.env.STRIPE_PRICE_SOLO_OVERAGE = "price_solo_overage";

const { POST: postLeadVideoSession } = await import("../../apps/portal/src/app/api/leads/video-session/route.ts");
const { POST: postStripeWebhook } = await import("../../apps/portal/src/app/api/stripe/webhook/route.ts");
const { POST: postResendWebhook } = await import("../../apps/portal/src/app/api/resend/webhook/route.ts");

test("lead route rejects invalid bearer before body, limiter, database or Tavus", { concurrency: false }, async () => {
  const state = freshState();
  let bodyTouched = false;
  const request = {
    headers: new Headers({ authorization: "Bearer invalid-secret" }),
    get body() { bodyTouched = true; throw new Error("unauthenticated body must not be acquired"); },
  };

  const response = await postLeadVideoSession(request);
  assert.equal(response.status, 401);
  assert.equal(bodyTouched, false);
  assert.deepEqual(state.rateLimitKeys, []);
  assert.equal(state.serviceRoleFactories, 0);
  assert.equal(state.providerFactories, 0);
});

test("lead route stays closed before body, limiter, database or Tavus until a participant runtime admission exists", { concurrency: false }, async () => {
  const state = freshState();
  let bodyTouched = false;
  const request = {
    headers: new Headers({ authorization: `Bearer ${RAISSA_SECRET}` }),
    get body() { bodyTouched = true; throw new Error("runtime admission must block before lead context is acquired"); },
  };
  const response = await postLeadVideoSession(request);

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "runtime_admission_required" });
  assert.equal(bodyTouched, false);
  assert.deepEqual(state.rateLimitKeys, []);
  assert.equal(state.serviceRoleFactories, 0);
  assert.equal(state.providerFactories, 0);
});

test("lead route does not parse malformed or non-object lead payloads while the paid channel is closed", { concurrency: false }, async (t) => {
  for (const body of ["{", "null", "[]"]) {
    await t.test(body, async () => {
      const state = freshState();
      const response = await postLeadVideoSession(requestWithBody(
        new Response(body).body,
        { authorization: `Bearer ${RAISSA_SECRET}` },
      ));
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { error: "runtime_admission_required" });
      assert.equal(state.serviceRoleFactories, 0);
      assert.equal(state.providerFactories, 0);
    });
  }
});

test("Stripe webhook returns 413 for declared and chunked overflow before signature or database", { concurrency: false }, async (t) => {
  await t.test("declared", async () => {
    const state = freshState();
    let bodyTouched = false;
    const request = {
      headers: new Headers({ "content-length": String(1024 * 1024 + 1) }),
      get body() { bodyTouched = true; throw new Error("oversized body must not be acquired"); },
    };
    const response = await postStripeWebhook(request);
    assert.equal(response.status, 413);
    assert.equal(bodyTouched, false);
    assert.equal(state.stripeSignatureChecks, 0);
    assert.equal(state.serviceRoleFactories, 0);
  });

  await t.test("chunked", async () => {
    const state = freshState();
    const response = await postStripeWebhook(requestWithBody(chunkedBody(700 * 1024, 400 * 1024)));
    assert.equal(response.status, 413);
    assert.equal(state.stripeSignatureChecks, 0);
    assert.equal(state.serviceRoleFactories, 0);
  });
});

test("Stripe checkout webhook forwards exact signed fields to the durable intent RPC", { concurrency: false }, async () => {
  const state = freshState();
  state.checkoutEvent = {
    eventId: "evt_checkout123",
    eventType: "checkout.session.completed",
    eventCreatedIso: "2026-08-13T12:00:00.000Z",
    checkoutIntentId: "0198a8b2-3c4d-7e5f-8a90-1234567890ab",
    stripeSessionId: "cs_test_checkout123",
    tenantId: "0198a8b2-3c4d-7e5f-8a90-1234567890aa",
    planId: "solo",
    stripeCustomerId: "cus_test123",
    stripeSubscriptionId: "sub_test123",
    paymentStatus: "paid",
  };
  state.rpcResponses.portal_apply_billing_checkout_event_service = {
    data: { applied: true, replayed: false, state: "completed" }, error: null,
  };
  const response = await postStripeWebhook(requestWithBody(new Response("{}").body, { "stripe-signature": "mock" }));
  assert.equal(response.status, 200);
  assert.deepEqual(state.rpcCalls, [{
    name: "portal_apply_billing_checkout_event_service",
    args: {
      p_event_id: "evt_checkout123",
      p_event_type: "checkout.session.completed",
      p_event_created_at: "2026-08-13T12:00:00.000Z",
      p_checkout_intent_id: "0198a8b2-3c4d-7e5f-8a90-1234567890ab",
      p_stripe_session_id: "cs_test_checkout123",
      p_tenant_id: "0198a8b2-3c4d-7e5f-8a90-1234567890aa",
      p_plan_id: "solo",
      p_stripe_customer_id: "cus_test123",
      p_stripe_subscription_id: "sub_test123",
      p_payment_status: "paid",
    },
  }]);
});

test("Stripe checkout webhook returns retryable 500 for a non-exact persistence receipt", { concurrency: false }, async () => {
  const state = freshState();
  state.checkoutEvent = {
    eventId: "evt_checkout123", eventType: "checkout.session.expired", eventCreatedIso: "2026-08-13T12:00:00.000Z",
    checkoutIntentId: "0198a8b2-3c4d-7e5f-8a90-1234567890ab", stripeSessionId: "cs_test_checkout123",
    tenantId: "0198a8b2-3c4d-7e5f-8a90-1234567890aa", planId: "solo", stripeCustomerId: null,
    stripeSubscriptionId: null, paymentStatus: null,
  };
  state.rpcResponses.portal_apply_billing_checkout_event_service = {
    data: { applied: true, replayed: false, state: "expired", unexpected: true }, error: null,
  };
  const response = await postStripeWebhook(requestWithBody(new Response("{}").body, { "stripe-signature": "mock" }));
  assert.equal(response.status, 500);
  assert.equal(state.serviceRoleFactories, 1);
  assert.equal(state.rpcCalls.length, 1);
});

test("Stripe checkout webhook accepts only the state implied by signed event and payment status", { concurrency: false }, async (t) => {
  const cases = [
    ["checkout.session.completed", "paid", "completed"],
    ["checkout.session.completed", "no_payment_required", "completed"],
    ["checkout.session.completed", "unpaid", "unknown"],
    ["checkout.session.async_payment_succeeded", "paid", "completed"],
    ["checkout.session.async_payment_succeeded", "no_payment_required", "completed"],
    ["checkout.session.expired", null, "expired"],
    ["checkout.session.async_payment_failed", "unpaid", "expired"],
  ];
  for (const [eventType, paymentStatus, receiptState] of cases) {
    await t.test(`${eventType}:${paymentStatus}`, async () => {
      const state = freshState();
      state.checkoutEvent = {
        eventId: "evt_checkout_matrix", eventType, eventCreatedIso: "2026-08-13T12:00:00.000Z",
        checkoutIntentId: "0198a8b2-3c4d-7e5f-8a90-1234567890ab", stripeSessionId: "cs_test_checkout123",
        tenantId: "0198a8b2-3c4d-7e5f-8a90-1234567890aa", planId: "solo", stripeCustomerId: "cus_test123",
        stripeSubscriptionId: "sub_test123", paymentStatus,
      };
      state.rpcResponses.portal_apply_billing_checkout_event_service = {
        data: { applied: true, replayed: false, state: receiptState }, error: null,
      };
      const response = await postStripeWebhook(requestWithBody(new Response("{}").body, { "stripe-signature": "mock" }));
      assert.equal(response.status, 200);
      assert.equal(state.serviceRoleFactories, 1);
      assert.equal(state.rpcCalls.length, 1);
    });
  }
});

test("Stripe checkout webhook accepts an exact replay receipt only when it was not applied again", { concurrency: false }, async () => {
  const state = freshState();
  state.checkoutEvent = {
    eventId: "evt_checkout_replay", eventType: "checkout.session.completed", eventCreatedIso: "2026-08-13T12:00:00.000Z",
    checkoutIntentId: "0198a8b2-3c4d-7e5f-8a90-1234567890ab", stripeSessionId: "cs_test_checkout123",
    tenantId: "0198a8b2-3c4d-7e5f-8a90-1234567890aa", planId: "solo", stripeCustomerId: "cus_test123",
    stripeSubscriptionId: "sub_test123", paymentStatus: "paid",
  };
  state.rpcResponses.portal_apply_billing_checkout_event_service = {
    data: { applied: false, replayed: true, state: "completed" }, error: null,
  };
  const response = await postStripeWebhook(requestWithBody(new Response("{}").body, { "stripe-signature": "mock" }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, handled: true, replayed: true });
  assert.equal(state.rpcCalls.length, 1);
});

test("Stripe checkout webhook accepts a fresh stale event receipt without falsely claiming application", { concurrency: false }, async () => {
  const state = freshState();
  state.checkoutEvent = {
    eventId: "evt_checkout_stale", eventType: "checkout.session.expired", eventCreatedIso: "2026-08-13T12:00:00.000Z",
    checkoutIntentId: "0198a8b2-3c4d-7e5f-8a90-1234567890ab", stripeSessionId: "cs_test_checkout123",
    tenantId: "0198a8b2-3c4d-7e5f-8a90-1234567890aa", planId: "solo", stripeCustomerId: null,
    stripeSubscriptionId: null, paymentStatus: null,
  };
  state.rpcResponses.portal_apply_billing_checkout_event_service = {
    data: { applied: false, replayed: false, state: "expired" }, error: null,
  };
  const response = await postStripeWebhook(requestWithBody(new Response("{}").body, { "stripe-signature": "mock" }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, handled: true, replayed: false });
  assert.equal(state.rpcCalls.length, 1);
});

test("Stripe checkout webhook rejects an impossible signed event/payment pair before the financial writer", { concurrency: false }, async () => {
  const state = freshState();
  state.checkoutEvent = {
    eventId: "evt_checkout_bad_payment", eventType: "checkout.session.async_payment_succeeded", eventCreatedIso: "2026-08-13T12:00:00.000Z",
    checkoutIntentId: "0198a8b2-3c4d-7e5f-8a90-1234567890ab", stripeSessionId: "cs_test_checkout123",
    tenantId: "0198a8b2-3c4d-7e5f-8a90-1234567890aa", planId: "solo", stripeCustomerId: "cus_test123",
    stripeSubscriptionId: "sub_test123", paymentStatus: "unpaid",
  };
  const response = await postStripeWebhook(requestWithBody(new Response("{}").body, { "stripe-signature": "mock" }));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "malformed_in_scope_event" });
  assert.equal(state.serviceRoleFactories, 0);
  assert.deepEqual(state.rpcCalls, []);
});

test("Stripe checkout webhook rejects semantically impossible receipts without a subsequent writer call", { concurrency: false }, async (t) => {
  const cases = [
    ["checkout.session.completed", "paid", { applied: true, replayed: false, state: "unknown" }],
    ["checkout.session.completed", "unpaid", { applied: true, replayed: false, state: "completed" }],
    ["checkout.session.async_payment_succeeded", "paid", { applied: true, replayed: false, state: "expired" }],
    ["checkout.session.expired", null, { applied: true, replayed: false, state: "completed" }],
    ["checkout.session.async_payment_failed", "unpaid", { applied: true, replayed: false, state: "unknown" }],
    ["checkout.session.completed", "paid", { applied: true, replayed: true, state: "completed" }],
  ];
  for (const [eventType, paymentStatus, receipt] of cases) {
    await t.test(`${eventType}:${paymentStatus}:${JSON.stringify(receipt)}`, async () => {
      const state = freshState();
      state.checkoutEvent = {
        eventId: "evt_checkout_impossible", eventType, eventCreatedIso: "2026-08-13T12:00:00.000Z",
        checkoutIntentId: "0198a8b2-3c4d-7e5f-8a90-1234567890ab", stripeSessionId: "cs_test_checkout123",
        tenantId: "0198a8b2-3c4d-7e5f-8a90-1234567890aa", planId: "solo", stripeCustomerId: "cus_test123",
        stripeSubscriptionId: "sub_test123", paymentStatus,
      };
      state.subscriptionEvent = { eventId: "must_not_fall_through" };
      state.rpcResponses.portal_apply_billing_checkout_event_service = { data: receipt, error: null };
      const response = await postStripeWebhook(requestWithBody(new Response("{}").body, { "stripe-signature": "mock" }));
      assert.equal(response.status, 500);
      assert.deepEqual(await response.json(), { error: "internal_error" });
      assert.equal(state.serviceRoleFactories, 1);
      assert.equal(state.rpcCalls.length, 1);
      assert.equal(state.rpcCalls[0].name, "portal_apply_billing_checkout_event_service");
    });
  }
});

test("Stripe subscription webhook uses strict event writer and forwards checkout intent correlation", { concurrency: false }, async () => {
  const state = freshState();
  state.subscriptionEvent = {
    eventId: "evt_subscription123",
    eventType: "customer.subscription.updated",
    eventCreatedIso: "2026-08-13T12:00:00.000Z",
    tenantId: "0198a8b2-3c4d-7e5f-8a90-1234567890aa",
    checkoutIntentId: "0198a8b2-3c4d-7e5f-8a90-1234567890ab",
    metadataPlanId: "solo",
    licensedPriceId: "price_solo_base",
    meteredPriceId: "price_solo_overage",
    stripeCustomerId: "cus_test123",
    stripeSubscriptionId: "sub_test123",
    status: "active",
    periodStartIso: "2026-08-01T00:00:00.000Z",
    periodEndIso: "2026-09-01T00:00:00.000Z",
  };
  state.rpcResponses.portal_apply_tenant_subscription_event_service = {
    data: { outcome: "applied", applied: true, replayed: false }, error: null,
  };
  const response = await postStripeWebhook(requestWithBody(new Response("{}").body, { "stripe-signature": "mock" }));
  assert.equal(response.status, 200);
  assert.equal(state.rpcCalls[0].name, "portal_apply_tenant_subscription_event_service");
  assert.equal(state.rpcCalls[0].args.p_checkout_intent_id, "0198a8b2-3c4d-7e5f-8a90-1234567890ab");
  assert.equal(state.rpcCalls[0].args.p_plan_id, "solo");
});

test("signed malformed in-scope Stripe events remain retryable and never touch the financial writer", { concurrency: false }, async () => {
  const state = freshState();
  state.handledCheckoutEventType = true;
  const response = await postStripeWebhook(requestWithBody(new Response("{}").body, { "stripe-signature": "mock" }));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "malformed_in_scope_event" });
  assert.equal(state.serviceRoleFactories, 0);
  assert.deepEqual(state.rpcCalls, []);
});

test("Stripe subscription webhook rejects a licensed/metered pair from different catalogs", { concurrency: false }, async () => {
  const state = freshState();
  state.subscriptionEvent = {
    eventId: "evt_subscription_mismatch",
    eventType: "customer.subscription.updated",
    eventCreatedIso: "2026-08-13T12:00:00.000Z",
    tenantId: "0198a8b2-3c4d-7e5f-8a90-1234567890aa",
    checkoutIntentId: "0198a8b2-3c4d-7e5f-8a90-1234567890ab",
    metadataPlanId: "solo",
    licensedPriceId: "price_solo_base",
    meteredPriceId: "price_another_plan_overage",
    stripeCustomerId: "cus_test123",
    stripeSubscriptionId: "sub_test123",
    status: "active",
    periodStartIso: "2026-08-01T00:00:00.000Z",
    periodEndIso: "2026-09-01T00:00:00.000Z",
  };
  const response = await postStripeWebhook(requestWithBody(new Response("{}").body, { "stripe-signature": "mock" }));
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "catalog_mismatch" });
  assert.equal(state.serviceRoleFactories, 0);
  assert.deepEqual(state.rpcCalls, []);
});

test("Resend webhook returns 413 for declared and chunked overflow before signature", { concurrency: false }, async (t) => {
  await t.test("declared", async () => {
    const state = freshState();
    let bodyTouched = false;
    const request = {
      headers: new Headers({ "content-length": String(256 * 1024 + 1) }),
      get body() { bodyTouched = true; throw new Error("oversized body must not be acquired"); },
    };
    const response = await postResendWebhook(request);
    assert.equal(response.status, 413);
    assert.equal(bodyTouched, false);
    assert.equal(state.resendSignatureChecks, 0);
  });

  await t.test("chunked", async () => {
    const state = freshState();
    const response = await postResendWebhook(requestWithBody(chunkedBody(200 * 1024, 100 * 1024)));
    assert.equal(response.status, 413);
    assert.equal(state.resendSignatureChecks, 0);
  });
});

test("every browser video consumer revalidates the provider URL, and video-call.tsx no longer embeds the provider by raw iframe", async () => {
  const [videoCall, presentationRoom, externalMeeting] = await Promise.all([
    readFile(new URL("../../apps/portal/src/app/(app)/agentes/[id]/testar/video-call.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../apps/portal/src/app/(app)/agentes/[id]/testar/presentation-room.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../apps/portal/src/app/(app)/agentes/[id]/testar/external-meeting.tsx", import.meta.url), "utf8"),
  ]);

  for (const source of [videoCall, presentationRoom, externalMeeting]) {
    assert.match(source, /isTrustedTavusConversationUrl/);
  }
  // ADR-041: video-call.tsx (modo vídeo livre) migrou do <iframe> puro pro
  // mesmo transporte de "call object" do Daily que presentation-room.tsx já
  // usa -- o <iframe> não expunha o data channel necessário pra tool calls
  // de negócio chegarem ao servidor. Trava a migração: nenhum dos dois
  // volta a embutir o provider por iframe.
  assert.doesNotMatch(videoCall, /<iframe/);
  assert.doesNotMatch(presentationRoom, /<iframe/);
  assert.match(videoCall, /createCallObject/);
  assert.match(videoCall, /@daily-co\/daily-js/);
});
