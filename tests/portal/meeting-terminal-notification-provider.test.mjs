import assert from "node:assert/strict";
import test from "node:test";

const { sendMeetingTerminalNotificationProvider } = await import(
  "../../apps/portal/src/lib/meeting-terminal-notification-provider.ts"
);

const INPUT = Object.freeze({
  to: ["admin@example.test"],
  subject: "Reunião encerrada",
  html: "<p>Concluída</p>",
  idempotencyKey: "meeting-terminal:v1:018f1e2d-3c4b-7a01-8c9d-001122334455",
});

test("fake determinístico nunca toca a rede e preserva o mesmo receipt", async () => {
  let calls = 0;
  const dependencies = {
    env: { PORTAL_FAKE_PROVIDERS: "1" },
    fetchImplementation: async () => { calls += 1; throw new Error("network forbidden"); },
  };
  const first = await sendMeetingTerminalNotificationProvider(INPUT, dependencies);
  const replay = await sendMeetingTerminalNotificationProvider(INPUT, dependencies);
  assert.deepEqual(first, replay);
  assert.equal(first.outcome, "simulated");
  assert.match(first.providerReceiptRef, /^simulated_[0-9a-f]{64}$/);
  assert.equal(calls, 0);
});

test("batch envia uma mensagem isolada por destinatário e exige todos os IDs", async () => {
  const calls = [];
  const input = { ...INPUT, to: ["admin-a@example.test", "admin-b@example.test"] };
  const result = await sendMeetingTerminalNotificationProvider(input, {
    env: { RESEND_API_KEY: "re_test_provider_key", PORTAL_FAKE_PROVIDERS: "0" },
    fetchImplementation: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({
        data: [{ id: "email_accepted_123" }, { id: "email_accepted_456" }],
      }), { status: 200 });
    },
  });
  assert.equal(result.outcome, "provider_accepted");
  assert.match(result.providerReceiptRef, /^batch_[0-9a-f]{64}$/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.resend.com/emails/batch");
  assert.equal(calls[0].init.headers["Idempotency-Key"], input.idempotencyKey);
  const payload = JSON.parse(calls[0].init.body);
  assert.equal(payload.length, 2);
  assert.deepEqual(payload.map(({ to }) => to), [[input.to[0]], [input.to[1]]]);
  assert.ok(payload.every(({ to }) => to.length === 1));
  assert.equal(JSON.stringify(payload[0]).includes(input.to[1]), false);
  assert.equal(JSON.stringify(payload[1]).includes(input.to[0]), false);
});

test("HTTP 2xx sem receipt batch exato é ambíguo, nunca sucesso", async () => {
  for (const body of [
    "{}",
    "not-json",
    JSON.stringify({ data: [{ id: "receipt with spaces" }] }),
    JSON.stringify({ data: [] }),
    JSON.stringify({ data: [{ id: "duplicate" }, { id: "duplicate" }] }),
  ]) {
    const result = await sendMeetingTerminalNotificationProvider(INPUT, {
      env: { RESEND_API_KEY: "re_test_provider_key" },
      fetchImplementation: async () => new Response(body, { status: 200 }),
    });
    assert.deepEqual(result, { outcome: "provider_ambiguous", failureCode: "provider_receipt_invalid" });
  }
});

test("resposta acima de 16 KiB é truncada sem conteúdo cru e permanece ambígua", async () => {
  const result = await sendMeetingTerminalNotificationProvider(INPUT, {
    env: { RESEND_API_KEY: "re_test_provider_key" },
    fetchImplementation: async () => new Response("x".repeat(16 * 1024 + 1), { status: 200 }),
  });
  assert.deepEqual(result, { outcome: "provider_ambiguous", failureCode: "provider_receipt_invalid" });
  assert.equal(JSON.stringify(result).includes("x".repeat(100)), false);
});

test("rate limit, indisponibilidade e conflitos de idempotência têm classificação fechada", async () => {
  const scenarios = [
    [429, JSON.stringify({ name: "rate_limit_exceeded" }), { "retry-after": "12" }, {
      outcome: "retryable_failure", failureCode: "provider_rate_limited", retryAfterSeconds: 12,
    }],
    [500, "provider down", {}, {
      outcome: "retryable_failure", failureCode: "provider_unavailable", retryAfterSeconds: null,
    }],
    [409, JSON.stringify({ name: "concurrent_idempotent_requests" }), {}, {
      outcome: "retryable_failure", failureCode: "provider_unavailable", retryAfterSeconds: 5,
    }],
    [409, JSON.stringify({ name: "invalid_idempotent_request" }), {}, {
      outcome: "permanent_failure", failureCode: "idempotency_conflict",
    }],
    [422, "invalid", {}, { outcome: "permanent_failure", failureCode: "payload_invalid" }],
    [401, "unauthorized", {}, {
      outcome: "retryable_failure", failureCode: "provider_not_configured", retryAfterSeconds: 60,
    }],
    [403, "forbidden", {}, {
      outcome: "retryable_failure", failureCode: "provider_not_configured", retryAfterSeconds: 60,
    }],
  ];
  for (const [status, body, headers, expected] of scenarios) {
    const result = await sendMeetingTerminalNotificationProvider(INPUT, {
      env: { RESEND_API_KEY: "re_test_provider_key" },
      fetchImplementation: async () => new Response(body, { status, headers }),
    });
    assert.deepEqual(result, expected);
  }
});

test("timeout e falha de transporte nunca viram rejeição qualificada ou aceite", async () => {
  const timeout = new Error("timeout");
  timeout.name = "AbortError";
  assert.deepEqual(await sendMeetingTerminalNotificationProvider(INPUT, {
    env: { RESEND_API_KEY: "re_test_provider_key" },
    fetchImplementation: async () => { throw timeout; },
  }), { outcome: "provider_ambiguous", failureCode: "provider_timeout" });
  assert.deepEqual(await sendMeetingTerminalNotificationProvider(INPUT, {
    env: { RESEND_API_KEY: "re_test_provider_key" },
    fetchImplementation: async () => { throw new Error("socket closed"); },
  }), { outcome: "provider_ambiguous", failureCode: "transport_unknown" });
});

test("configuração ausente e payload inválido falham antes da rede", async () => {
  let calls = 0;
  const fetchImplementation = async () => { calls += 1; return new Response("{}", { status: 200 }); };
  assert.deepEqual(await sendMeetingTerminalNotificationProvider(INPUT, {
    env: {}, fetchImplementation,
  }), {
    outcome: "retryable_failure", failureCode: "provider_not_configured", retryAfterSeconds: 60,
  });
  assert.deepEqual(await sendMeetingTerminalNotificationProvider({ ...INPUT, to: [] }, {
    env: { RESEND_API_KEY: "re_test_provider_key" }, fetchImplementation,
  }), { outcome: "permanent_failure", failureCode: "payload_invalid" });
  assert.equal(calls, 0);
});
