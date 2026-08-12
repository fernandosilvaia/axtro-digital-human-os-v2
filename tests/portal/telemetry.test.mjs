import assert from "node:assert/strict";
import { test } from "node:test";

const telemetry = await import("../../apps/portal/src/lib/telemetry.ts");

function captureConsole(kind, fn) {
  const original = console[kind];
  let captured = null;
  console[kind] = (line) => { captured = line; };
  try {
    fn();
  } finally {
    console[kind] = original;
  }
  return captured;
}

test("logEvent redacts keys that look like credentials", () => {
  const line = captureConsole("info", () => {
    telemetry.logEvent("test_event", { agent_id: "abc", api_key: "sk-secret", user_token: "t0k3n" });
  });
  const parsed = JSON.parse(line);
  assert.equal(parsed.agent_id, "abc");
  assert.equal(parsed.api_key, "[redacted]");
  assert.equal(parsed.user_token, "[redacted]");
});

test("logEvent redacts email addresses inside string values", () => {
  const line = captureConsole("info", () => {
    telemetry.logEvent("invite_sent", { note: "sent to fernando@axtroai.com today" });
  });
  const parsed = JSON.parse(line);
  assert.ok(!parsed.note.includes("fernando@axtroai.com"));
  assert.match(parsed.note, /\[redacted-email\]/);
});

test("logError captures error name and message without leaking context PII", () => {
  const line = captureConsole("error", () => {
    telemetry.logError("rpc_failed", new Error("boom"), { email: "leak@example.com", source_id: "xyz" });
  });
  const parsed = JSON.parse(line);
  assert.equal(parsed.level, "error");
  assert.equal(parsed.error_name, "Error");
  assert.equal(parsed.error_message, "boom");
  assert.equal(parsed.email, "[redacted]");
  assert.equal(parsed.source_id, "xyz");
});

test("logError redacts Stripe-shaped secret/restricted keys embedded in error.message (achado D-V2-107)", () => {
  for (const key of ["sk_test_51ABCdefGhijKLM", "sk_live_51ABCdefGhijKLM", "rk_test_51ABCdefGhijKLM", "rk_live_51ABCdefGhijKLM"]) {
    const line = captureConsole("error", () => {
      telemetry.logError("stripe_call_failed", new Error(`Stripe call failed with key ${key}`));
    });
    const parsed = JSON.parse(line);
    assert.ok(!parsed.error_message.includes(key), `esperava ${key} redigida, mensagem foi: ${parsed.error_message}`);
    assert.match(parsed.error_message, /\[redacted-secret\]/);
  }
});

test("logError handles non-Error thrown values", () => {
  const line = captureConsole("error", () => {
    telemetry.logError("weird_throw", "just a string");
  });
  const parsed = JSON.parse(line);
  assert.equal(parsed.error_name, "unknown");
});

function withFakeFetch(fakeFetch, fn) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fakeFetch;
  try {
    return fn();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function withResendEnabled(fn) {
  const originalKey = process.env.RESEND_API_KEY;
  const originalFake = process.env.PORTAL_FAKE_PROVIDERS;
  process.env.RESEND_API_KEY = "test-resend-key";
  delete process.env.PORTAL_FAKE_PROVIDERS;
  try {
    return fn();
  } finally {
    if (originalKey !== undefined) process.env.RESEND_API_KEY = originalKey; else delete process.env.RESEND_API_KEY;
    if (originalFake !== undefined) process.env.PORTAL_FAKE_PROVIDERS = originalFake; else delete process.env.PORTAL_FAKE_PROVIDERS;
  }
}

test("logError dispara alerta operacional por e-mail ao cruzar o teto de falhas na janela (achado D-V2-114)", async () => {
  const calls = [];
  await withResendEnabled(async () => {
    await withFakeFetch(async (url, init) => {
      calls.push({ url, init });
      return { ok: true, json: async () => ({}) };
    }, async () => {
      const event = `test_alert_threshold_${Math.random()}`;
      for (let i = 0; i < 9; i++) {
        captureConsole("error", () => telemetry.logError(event, new Error("boom")));
      }
      assert.equal(calls.length, 0, "não deveria alertar antes do teto de 10 falhas");
      captureConsole("error", () => telemetry.logError(event, new Error("boom")));
      await Promise.resolve();
      assert.equal(calls.length, 1, "deveria alertar exatamente ao cruzar o teto (10ª falha)");
      const body = JSON.parse(calls[0].init.body);
      assert.equal(body.to[0], "fernando@axtroai.com");
      assert.match(body.subject, /10 falhas/);
      assert.match(body.subject, new RegExp(event));
    });
  });
});

test("logError não alerta de novo pro mesmo evento dentro do cooldown (evita spam durante outage prolongado)", async () => {
  const calls = [];
  await withResendEnabled(async () => {
    await withFakeFetch(async (url, init) => {
      calls.push({ url, init });
      return { ok: true, json: async () => ({}) };
    }, async () => {
      const event = `test_alert_cooldown_${Math.random()}`;
      for (let i = 0; i < 15; i++) {
        captureConsole("error", () => telemetry.logError(event, new Error("boom")));
      }
      await Promise.resolve();
      assert.equal(calls.length, 1, "15 falhas seguidas do mesmo evento deveriam gerar só 1 alerta (cooldown)");
    });
  });
});

test("logError nunca chama fetch de alerta quando RESEND_API_KEY não está configurada (modo mock)", async () => {
  const calls = [];
  const originalKey = process.env.RESEND_API_KEY;
  delete process.env.RESEND_API_KEY;
  try {
    await withFakeFetch(async (url, init) => {
      calls.push({ url, init });
      return { ok: true, json: async () => ({}) };
    }, async () => {
      const event = `test_alert_no_key_${Math.random()}`;
      for (let i = 0; i < 15; i++) {
        captureConsole("error", () => telemetry.logError(event, new Error("boom")));
      }
      await Promise.resolve();
      assert.equal(calls.length, 0);
    });
  } finally {
    if (originalKey !== undefined) process.env.RESEND_API_KEY = originalKey;
  }
});

test("logError abaixo do teto nunca chama fetch de alerta", async () => {
  const calls = [];
  await withResendEnabled(async () => {
    await withFakeFetch(async (url, init) => {
      calls.push({ url, init });
      return { ok: true, json: async () => ({}) };
    }, async () => {
      const event = `test_alert_under_threshold_${Math.random()}`;
      for (let i = 0; i < 5; i++) {
        captureConsole("error", () => telemetry.logError(event, new Error("boom")));
      }
      await Promise.resolve();
      assert.equal(calls.length, 0);
    });
  });
});
