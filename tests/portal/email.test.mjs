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

/* ------------------------------------------------------------------ */
/* Casco compartilhado: HTML e texto puro saem do MESMO conteudo        */
/* ------------------------------------------------------------------ */

/** Captura o corpo enviado a Resend sem tocar a rede. */
async function captureSend(send) {
  const originalKey = process.env.RESEND_API_KEY;
  const originalFetch = globalThis.fetch;
  process.env.RESEND_API_KEY = "re_test_0000000000000000000000000";
  let captured = null;
  globalThis.fetch = async (_url, init) => {
    captured = JSON.parse(init.body);
    return new Response("{}", { status: 200 });
  };
  try {
    await send();
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalKey;
  }
  return captured;
}

test("todo e-mail sai com alternativa em texto puro, nunca só HTML", async () => {
  // HTML sozinho e um dos sinais negativos mais comuns de entregabilidade, e
  // cliente que prefere texto recebia um multipart incompleto.
  const payload = await captureSend(() => email.sendInviteEmail({
    to: "convidado@example.com", workspaceName: "Billion Club", role: "tenant_admin",
  }));
  assert.ok(typeof payload.text === "string" && payload.text.length > 0, "a parte de texto precisa existir");
  assert.ok(payload.html.includes("<!doctype html>"), "o HTML precisa ser documento completo, não fragmento");
});

test("HTML e texto carregam a mesma substância, porque saem da mesma fonte", async () => {
  // O risco que este teste fecha e divergencia: quando as duas partes sao
  // escritas separado, o lado que ninguem olha (o texto) apodrece.
  const payload = await captureSend(() => email.sendInviteEmail({
    to: "convidado@example.com", workspaceName: "Billion Club", role: "tenant_operator",
  }));
  for (const parte of [payload.html, payload.text]) {
    assert.ok(parte.includes("Billion Club"), "o nome do workspace precisa estar nas duas partes");
    assert.ok(parte.includes("Operador"), "o papel precisa estar nas duas partes");
    assert.ok(parte.includes("/signup"), "o destino da ação precisa estar nas duas partes");
  }
});

test("o preheader existe, fica escondido no corpo e não repete o assunto", async () => {
  const payload = await captureSend(() => email.sendAgentActivatedEmail({
    to: ["admin@example.com"], workspaceName: "Billion Club", agentName: "Sofia",
  }));
  assert.match(payload.html, /display:none[^"]*"[^>]*>Sofia já pode conversar/);
  assert.ok(!payload.text.includes("display:none"), "o texto puro nunca carrega o truque de CSS do preheader");
});

test("valor vindo do tenant é escapado no HTML e nunca vira marcação executável", async () => {
  const payload = await captureSend(() => email.sendAgentActivatedEmail({
    to: ["admin@example.com"],
    workspaceName: '<script>alert(1)</script>',
    agentName: 'Sofia " onload="x',
  }));
  assert.ok(!payload.html.includes("<script>"), "script do nome do workspace nunca pode sair cru");
  assert.ok(payload.html.includes("&lt;script&gt;"), "precisa sair escapado");
  assert.ok(!payload.html.includes('onload="x'), "aspas no nome do agente não podem escapar do atributo");
});

test("a marcação mínima vira negrito no HTML e some no texto, sem vazar asterisco", async () => {
  const payload = await captureSend(() => email.sendAgentActivatedEmail({
    to: ["admin@example.com"], workspaceName: "Billion Club", agentName: "Sofia",
  }));
  assert.ok(payload.html.includes("<strong>Sofia</strong>"), "negrito precisa virar <strong>");
  assert.ok(payload.text.includes("Sofia"), "o texto mantém o conteúdo");
  assert.ok(!payload.text.includes("*Sofia*"), "o texto nunca mostra a marcação crua");
});

test("o rodapé diz de onde veio e por que a pessoa recebeu, nas duas partes", async () => {
  // E o que separa transacional legitimo de e-mail suspeito na caixa de entrada.
  const payload = await captureSend(() => email.sendProposalEmail({
    to: "prospect@example.com", prospectCompanyName: "Acme",
    closerName: "Sofia", planLabel: "Piloto", checkoutUrl: "https://checkout.example/abc",
  }));
  for (const parte of [payload.html, payload.text]) {
    assert.ok(parte.includes("Axtro Digital Human OS"), "o remetente precisa se identificar");
    assert.ok(parte.includes("porque tem acesso a esta conta"), "precisa dizer por que a pessoa recebeu");
    assert.ok(parte.includes("https://checkout.example/abc"), "o destino da ação precisa estar nas duas partes");
  }
});
