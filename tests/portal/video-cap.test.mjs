import assert from "node:assert/strict";
import { test } from "node:test";

const videoCap = await import("../../apps/portal/src/lib/video-cap.ts");

function fakeSupabase(billingStatus, { rpcError = null } = {}) {
  const calls = [];
  return {
    calls,
    rpc: async (name, args) => {
      calls.push({ name, args });
      if (name !== "portal_billing_status") throw new Error(`unexpected rpc: ${name}`);
      if (rpcError) return { data: null, error: rpcError };
      return { data: billingStatus, error: null };
    },
  };
}

test("check_failed quando a leitura do status de cobrança falha (falha fechada)", async () => {
  const supabase = fakeSupabase(null, { rpcError: { message: "db down" } });
  assert.equal(await videoCap.checkVideoCap(supabase), "check_failed");
});

test("capped no teto diário de segurança, mesmo com plano ativo e período com folga", async () => {
  const supabase = fakeSupabase({
    plan_id: "escala", status: "active", stripe_customer_id: "cus_1",
    conversations_today: 20, conversations_this_period: 3,
  });
  assert.equal(await videoCap.checkVideoCap(supabase), "capped");
});

test("allowed quando plano ativo e ainda dentro do incluído mensal", async () => {
  const supabase = fakeSupabase({
    plan_id: "piloto", status: "active", stripe_customer_id: "cus_1",
    conversations_today: 2, conversations_this_period: 6, // piloto inclui 7
  });
  assert.equal(await videoCap.checkVideoCap(supabase), "allowed");
});

test("allowed_overage quando plano ativo já passou do incluído mensal — nunca bloqueia", async () => {
  const supabase = fakeSupabase({
    plan_id: "piloto", status: "active", stripe_customer_id: "cus_1",
    conversations_today: 2, conversations_this_period: 7, // piloto inclui 7 — a 8ª é overage
  });
  assert.equal(await videoCap.checkVideoCap(supabase), "allowed_overage");
});

test("status past_due ainda conta como plano ativo (graça antes de cancelar)", async () => {
  const supabase = fakeSupabase({
    plan_id: "crescimento", status: "past_due", stripe_customer_id: "cus_1",
    conversations_today: 1, conversations_this_period: 31, // crescimento inclui 30
  });
  assert.equal(await videoCap.checkVideoCap(supabase), "allowed_overage");
});

test("status canceled/unpaid/incomplete NÃO conta como plano ativo — cai pro comportamento sem assinatura", async () => {
  for (const status of ["canceled", "unpaid", "incomplete", "incomplete_expired", "paused"]) {
    const supabase = fakeSupabase({
      plan_id: "escala", status, stripe_customer_id: "cus_1",
      conversations_today: 1, conversations_this_period: 200,
    });
    assert.equal(await videoCap.checkVideoCap(supabase), "allowed", `status ${status} deveria cair pro trial`);
  }
});

test("sem assinatura (plan_id null): allowed mesmo com uso alto no período, teto de trial DESLIGADO por padrão", async () => {
  delete process.env.BILLING_TRIAL_LIMIT_ENABLED;
  const supabase = fakeSupabase({
    plan_id: null, status: null, stripe_customer_id: null,
    conversations_today: 3, conversations_this_period: 500,
  });
  assert.equal(await videoCap.checkVideoCap(supabase), "allowed");
});

test("sem assinatura: teto de trial (5/mês) aplica só quando BILLING_TRIAL_LIMIT_ENABLED=true", async () => {
  process.env.BILLING_TRIAL_LIMIT_ENABLED = "true";
  try {
    const underLimit = fakeSupabase({ plan_id: null, status: null, conversations_today: 1, conversations_this_period: 4 });
    assert.equal(await videoCap.checkVideoCap(underLimit), "allowed");

    const overLimit = fakeSupabase({ plan_id: null, status: null, conversations_today: 1, conversations_this_period: 5 });
    assert.equal(await videoCap.checkVideoCap(overLimit), "capped");
  } finally {
    delete process.env.BILLING_TRIAL_LIMIT_ENABLED;
  }
});

test("reportConversationOverageIfNeeded é no-op quando o verdict não é allowed_overage", async () => {
  const supabase = fakeSupabase({ plan_id: "piloto", status: "active", stripe_customer_id: "cus_1" });
  await videoCap.reportConversationOverageIfNeeded(supabase, "allowed", "cost-event-1");
  assert.equal(supabase.calls.length, 0, "não deveria nem consultar o status de novo");
});

test("reportConversationOverageIfNeeded é no-op quando STRIPE_SECRET_KEY não está configurada", async () => {
  const original = process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_SECRET_KEY;
  try {
    const supabase = fakeSupabase({ plan_id: "piloto", status: "active", stripe_customer_id: "cus_1" });
    await videoCap.reportConversationOverageIfNeeded(supabase, "allowed_overage", "cost-event-1");
    assert.equal(supabase.calls.length, 0);
  } finally {
    if (original !== undefined) process.env.STRIPE_SECRET_KEY = original;
  }
});

test("reportConversationOverageIfNeeded reporta 1 unidade à Stripe com idempotencyKey amarrada ao costEventId", async () => {
  const original = process.env.STRIPE_SECRET_KEY;
  process.env.STRIPE_SECRET_KEY = "sk_test_0000000000000000000000000000";
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ id: "me_1" }), { status: 200 });
  };
  try {
    const supabase = fakeSupabase({ plan_id: "crescimento", status: "active", stripe_customer_id: "cus_abc123" });
    await videoCap.reportConversationOverageIfNeeded(supabase, "allowed_overage", "cost-event-xyz");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://api.stripe.com/v1/billing/meter_events");
    assert.equal(calls[0].init.headers["Idempotency-Key"], "overage:cus_abc123:cost-event-xyz");
    const body = Object.fromEntries(new URLSearchParams(calls[0].init.body));
    assert.equal(body["payload[stripe_customer_id]"], "cus_abc123");
    assert.equal(body["payload[value]"], "1");
  } finally {
    globalThis.fetch = originalFetch;
    if (original !== undefined) process.env.STRIPE_SECRET_KEY = original; else delete process.env.STRIPE_SECRET_KEY;
  }
});

test("reportConversationOverageIfNeeded nunca lança quando a Stripe falha — é best-effort", async () => {
  const original = process.env.STRIPE_SECRET_KEY;
  process.env.STRIPE_SECRET_KEY = "sk_test_0000000000000000000000000000";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("boom", { status: 503 });
  try {
    const supabase = fakeSupabase({ plan_id: "crescimento", status: "active", stripe_customer_id: "cus_abc123" });
    await assert.doesNotReject(() => videoCap.reportConversationOverageIfNeeded(supabase, "allowed_overage", "cost-event-xyz"));
  } finally {
    globalThis.fetch = originalFetch;
    if (original !== undefined) process.env.STRIPE_SECRET_KEY = original; else delete process.env.STRIPE_SECRET_KEY;
  }
});
