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
  // Teto de trial explicitamente desligado aqui: o que este teste isola é a
  // ROTA (status não-ativo cai pro branch "sem assinatura", não no branch de
  // plano ativo/overage) — o valor do teto de trial em si é coberto à parte
  // (ver testes acima, D-V2-112).
  process.env.BILLING_TRIAL_LIMIT_ENABLED = "false";
  try {
    for (const status of ["canceled", "unpaid", "incomplete", "incomplete_expired", "paused"]) {
      const supabase = fakeSupabase({
        plan_id: "escala", status, stripe_customer_id: "cus_1",
        conversations_today: 1, conversations_this_period: 200,
      });
      assert.equal(await videoCap.checkVideoCap(supabase), "allowed", `status ${status} deveria cair pro trial`);
    }
  } finally {
    delete process.env.BILLING_TRIAL_LIMIT_ENABLED;
  }
});

test("sem assinatura (plan_id null): teto de trial (5/mês) ATIVO por padrão (D-V2-112) — sem env var, já aplica", async () => {
  delete process.env.BILLING_TRIAL_LIMIT_ENABLED;
  try {
    const underLimit = fakeSupabase({ plan_id: null, status: null, conversations_today: 1, conversations_this_period: 4 });
    assert.equal(await videoCap.checkVideoCap(underLimit), "allowed");

    const overLimit = fakeSupabase({ plan_id: null, status: null, conversations_today: 1, conversations_this_period: 5 });
    assert.equal(await videoCap.checkVideoCap(overLimit), "capped");
  } finally {
    delete process.env.BILLING_TRIAL_LIMIT_ENABLED;
  }
});

test("sem assinatura: BILLING_TRIAL_LIMIT_ENABLED=true é equivalente ao default (redundante, mas mantém compat)", async () => {
  process.env.BILLING_TRIAL_LIMIT_ENABLED = "true";
  try {
    const overLimit = fakeSupabase({ plan_id: null, status: null, conversations_today: 1, conversations_this_period: 5 });
    assert.equal(await videoCap.checkVideoCap(overLimit), "capped");
  } finally {
    delete process.env.BILLING_TRIAL_LIMIT_ENABLED;
  }
});

test("sem assinatura: BILLING_TRIAL_LIMIT_ENABLED=false desliga o teto mensal explicitamente (opt-out reversível)", async () => {
  process.env.BILLING_TRIAL_LIMIT_ENABLED = "false";
  try {
    const supabase = fakeSupabase({
      plan_id: null, status: null, stripe_customer_id: null,
      conversations_today: 3, conversations_this_period: 500,
    });
    assert.equal(await videoCap.checkVideoCap(supabase), "allowed");
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

test("reportConversationOverageIfNeeded nunca lança em erro TRANSITÓRIO (5xx) — é best-effort, mas tenta 2 vezes antes de desistir (achado onda 7, D-V2-116)", async () => {
  const original = process.env.STRIPE_SECRET_KEY;
  process.env.STRIPE_SECRET_KEY = "sk_test_0000000000000000000000000000";
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return new Response("boom", { status: 503 });
  };
  try {
    const supabase = fakeSupabase({ plan_id: "crescimento", status: "active", stripe_customer_id: "cus_abc123" });
    await assert.doesNotReject(() => videoCap.reportConversationOverageIfNeeded(supabase, "allowed_overage", "cost-event-xyz"));
    assert.equal(calls.length, 2, "deveria ter tentado a chamada paga 2 vezes antes de desistir");
    assert.equal(calls[0].init.headers["Idempotency-Key"], calls[1].init.headers["Idempotency-Key"], "a retentativa reusa a MESMA idempotencyKey — nunca cobra duas vezes a mesma conversa");
  } finally {
    globalThis.fetch = originalFetch;
    if (original !== undefined) process.env.STRIPE_SECRET_KEY = original; else delete process.env.STRIPE_SECRET_KEY;
  }
});

test("reportConversationOverageIfNeeded NÃO retenta em erro PERMANENTE (4xx que não seja timeout/unavailable) — achado da própria auto-revisão: retry incondicional dobrava a latência bloqueante mesmo quando a 2ª tentativa não tinha chance nenhuma de suceder", async () => {
  const original = process.env.STRIPE_SECRET_KEY;
  process.env.STRIPE_SECRET_KEY = "sk_test_0000000000000000000000000000";
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return new Response("customer not found", { status: 404 });
  };
  try {
    const supabase = fakeSupabase({ plan_id: "crescimento", status: "active", stripe_customer_id: "cus_abc123" });
    await assert.doesNotReject(() => videoCap.reportConversationOverageIfNeeded(supabase, "allowed_overage", "cost-event-permanent"));
    assert.equal(calls.length, 1, "erro permanente (404 -> provider_rejected) não deveria disparar retentativa — falha rápido");
  } finally {
    globalThis.fetch = originalFetch;
    if (original !== undefined) process.env.STRIPE_SECRET_KEY = original; else delete process.env.STRIPE_SECRET_KEY;
  }
});

test("reportConversationOverageIfNeeded: uma falha transitória seguida de sucesso na retentativa AINDA reporta a unidade — o achado original era perdê-la em silêncio", async () => {
  const original = process.env.STRIPE_SECRET_KEY;
  process.env.STRIPE_SECRET_KEY = "sk_test_0000000000000000000000000000";
  const originalFetch = globalThis.fetch;
  let attempt = 0;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    attempt += 1;
    calls.push({ url, init });
    if (attempt === 1) return new Response("boom", { status: 503 });
    return new Response(JSON.stringify({ id: "me_2" }), { status: 200 });
  };
  try {
    const supabase = fakeSupabase({ plan_id: "crescimento", status: "active", stripe_customer_id: "cus_abc123" });
    await videoCap.reportConversationOverageIfNeeded(supabase, "allowed_overage", "cost-event-retry");
    assert.equal(calls.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
    if (original !== undefined) process.env.STRIPE_SECRET_KEY = original; else delete process.env.STRIPE_SECRET_KEY;
  }
});
