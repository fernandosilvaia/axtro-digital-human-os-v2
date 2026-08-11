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
