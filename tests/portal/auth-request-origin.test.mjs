import assert from "node:assert/strict";
import { test } from "node:test";

const origin = await import("../../apps/portal/src/lib/auth-request-origin.ts");

test("the rate limit key uses the IP appended by the trusted edge, not the one the client sent", () => {
  assert.equal(origin.rateLimitClientIp("6.6.6.6, 203.0.113.9", null), "203.0.113.9");
  assert.equal(origin.rateLimitClientIp("203.0.113.9", null), "203.0.113.9");
  // Rotating the client-supplied prefix no longer changes the bucket.
  assert.equal(origin.rateLimitClientIp("1.1.1.1, 203.0.113.9", null), origin.rateLimitClientIp("9.9.9.9, 203.0.113.9", null));
  assert.equal(origin.rateLimitClientIp(" , ", "198.51.100.4"), "198.51.100.4");
  assert.equal(origin.rateLimitClientIp(null, null), "unknown");
});

test("password reset links always point to the configured public origin in production", () => {
  assert.equal(origin.passwordResetOrigin("https://closer.axtroai.com", "attacker.example"), "https://closer.axtroai.com");
  assert.equal(origin.passwordResetOrigin("https://closer.axtroai.com/", "localhost:3101"), "https://closer.axtroai.com");
  assert.equal(origin.passwordResetOrigin("not a url", "localhost:3101"), null);
});

test("without a configured origin only a local development host is accepted", () => {
  assert.equal(origin.passwordResetOrigin(undefined, "localhost:3101"), "http://localhost:3101");
  assert.equal(origin.passwordResetOrigin("", "127.0.0.1:3000"), "http://127.0.0.1:3000");
  assert.equal(origin.passwordResetOrigin(undefined, "attacker.example"), null);
  assert.equal(origin.passwordResetOrigin(undefined, "localhost.attacker.example"), null);
  assert.equal(origin.passwordResetOrigin(undefined, null), null);
});
