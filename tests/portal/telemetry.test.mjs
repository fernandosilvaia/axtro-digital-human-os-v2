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

test("logError handles non-Error thrown values", () => {
  const line = captureConsole("error", () => {
    telemetry.logError("weird_throw", "just a string");
  });
  const parsed = JSON.parse(line);
  assert.equal(parsed.error_name, "unknown");
});
