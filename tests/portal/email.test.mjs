import assert from "node:assert/strict";
import { test } from "node:test";

const email = await import("../../apps/portal/src/lib/email.ts");

// Sem RESEND_API_KEY no ambiente de teste, todo envio cai no caminho mockado
// (sendHtmlEmail) — o que já dá cobertura real de contrato (parâmetros
// aceitos, sem lançar) sem precisar mockar HTTP.

test("sendCostCapAlertEmail: sem destinatários, não tenta enviar (mocked_no_key)", async () => {
  const result = await email.sendCostCapAlertEmail({
    to: [],
    workspaceName: "Tenant Teste",
    capLabel: "tokens de IA",
    currentValue: 400_000,
    capValue: 500_000,
    percentUsed: 80,
  });
  assert.equal(result.sent, false);
  assert.equal(result.reason, "mocked_no_key");
});

test("sendCostCapAlertEmail: com destinatários e sem RESEND_API_KEY configurada, cai no mock (nunca lança)", async () => {
  const original = process.env.RESEND_API_KEY;
  delete process.env.RESEND_API_KEY;
  try {
    const result = await email.sendCostCapAlertEmail({
      to: ["admin@example.com"],
      workspaceName: "Tenant Teste",
      capLabel: "conversas de vídeo",
      currentValue: 20,
      capValue: 20,
      percentUsed: 100,
    });
    assert.equal(result.sent, false);
    assert.equal(result.reason, "mocked_no_key");
  } finally {
    if (original !== undefined) process.env.RESEND_API_KEY = original;
  }
});

test("achado onda 8 (D-V2-117): 429/5xx da Resend é retentado UMA vez (respeitando retry-after: 0) antes de reportar sucesso", async () => {
  const original = process.env.RESEND_API_KEY;
  process.env.RESEND_API_KEY = "re_test_0000000000000000000000000";
  const originalFetch = globalThis.fetch;
  let attempt = 0;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    attempt += 1;
    calls.push({ url, init });
    if (attempt === 1) return new Response("rate limited", { status: 429, headers: { "retry-after": "0" } });
    return new Response(JSON.stringify({ id: "email_1" }), { status: 200 });
  };
  try {
    const result = await email.sendInviteEmail({ to: "novo@example.com", workspaceName: "Tenant Teste", role: "tenant_operator" });
    assert.equal(result.sent, true);
    assert.equal(calls.length, 2, "deveria ter tentado de novo depois do 429");
  } finally {
    globalThis.fetch = originalFetch;
    if (original !== undefined) process.env.RESEND_API_KEY = original; else delete process.env.RESEND_API_KEY;
  }
});

test("achado onda 8 (D-V2-117): erro PERMANENTE (401) da Resend NÃO é retentado — falha rápido", async () => {
  const original = process.env.RESEND_API_KEY;
  process.env.RESEND_API_KEY = "re_test_0000000000000000000000000";
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return new Response("unauthorized", { status: 401 });
  };
  try {
    const result = await email.sendInviteEmail({ to: "novo@example.com", workspaceName: "Tenant Teste", role: "tenant_operator" });
    assert.equal(result.sent, false);
    assert.equal(result.reason, "provider_error");
    assert.equal(calls.length, 1, "erro permanente não deveria disparar retentativa");
  } finally {
    globalThis.fetch = originalFetch;
    if (original !== undefined) process.env.RESEND_API_KEY = original; else delete process.env.RESEND_API_KEY;
  }
});
