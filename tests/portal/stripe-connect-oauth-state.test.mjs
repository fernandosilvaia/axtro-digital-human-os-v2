import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

const {
  issueStripeConnectOAuthStateToken,
  isStripeConnectOAuthStateSecretConfigured,
  STRIPE_CONNECT_OAUTH_STATE_COOKIE_NAME,
  STRIPE_CONNECT_OAUTH_STATE_SECRET_ENV,
  STRIPE_CONNECT_OAUTH_STATE_TOKEN_VERSION,
  STRIPE_CONNECT_OAUTH_STATE_TTL_SECONDS,
  StripeConnectOAuthStateError,
  verifyStripeConnectOAuthStateToken,
} = await import("../../apps/portal/src/lib/billing/stripe-connect-oauth-state.ts");

const SECRET = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
const OTHER_SECRET = "202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f";
const NOW = new Date("2026-09-18T16:00:00.000Z");
const TENANT_A = "0198a8b2-3c4d-7e5f-8a90-1234567890aa";
const ACTOR_A = "0198a8b2-3c4d-7e5f-8a90-1234567890ab";
const TENANT_B = "0198a8b2-3c4d-7e5f-8a90-1234567890ac";
const ACTOR_B = "0198a8b2-3c4d-7e5f-8a90-1234567890ad";
const DOMAIN = "axtro:portal-stripe-connect-oauth-state:v1\0";

function signJson(json, secret = SECRET, domain = DOMAIN) {
  const payload = Buffer.from(json, "utf8").toString("base64url");
  const signature = createHmac("sha256", Buffer.from(secret, "hex")).update(`${domain}${payload}`, "utf8").digest("base64url");
  return `${STRIPE_CONNECT_OAUTH_STATE_TOKEN_VERSION}.${payload}.${signature}`;
}

test("scsv1 round-trips tenant/actor deterministically and freezes the result", () => {
  const first = issueStripeConnectOAuthStateToken(TENANT_A, ACTOR_A, SECRET, NOW);
  const second = issueStripeConnectOAuthStateToken(TENANT_A, ACTOR_A, SECRET, NOW);
  assert.equal(first, second);
  assert.match(first, /^scsv1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

  const verified = verifyStripeConnectOAuthStateToken(first, SECRET, new Date(NOW.getTime() + 1));
  assert.equal(verified.schema_version, "1.0.0");
  assert.equal(verified.tenant_id, TENANT_A);
  assert.equal(verified.actor_id, ACTOR_A);
  assert.equal(Object.isFrozen(verified), true);
  assert.equal(Date.parse(verified.expires_at) - Date.parse(verified.issued_at), STRIPE_CONNECT_OAUTH_STATE_TTL_SECONDS * 1000);
});

test("two different tenants/actors produce unlinkable tokens", () => {
  const tokenA = issueStripeConnectOAuthStateToken(TENANT_A, ACTOR_A, SECRET, NOW);
  const tokenB = issueStripeConnectOAuthStateToken(TENANT_B, ACTOR_B, SECRET, NOW);
  assert.notEqual(tokenA, tokenB);
  assert.equal(verifyStripeConnectOAuthStateToken(tokenA, SECRET, NOW).tenant_id, TENANT_A);
  assert.equal(verifyStripeConnectOAuthStateToken(tokenB, SECRET, NOW).tenant_id, TENANT_B);
});

test("domain separation, payload tampering and signature tampering fail closed", () => {
  const token = issueStripeConnectOAuthStateToken(TENANT_A, ACTOR_A, SECRET, NOW);
  const [version, encoded, signature] = token.split(".");
  assert.ok(version && encoded && signature);
  const tamperedPayload = Buffer.from(JSON.stringify({
    schema_version: "1.0.0", tenant_id: TENANT_B, actor_id: ACTOR_A,
    issued_at: NOW.toISOString(), expires_at: new Date(NOW.getTime() + 600_000).toISOString(),
  }), "utf8").toString("base64url");
  const noDomain = createHmac("sha256", Buffer.from(SECRET, "hex")).update(encoded, "utf8").digest("base64url");
  const wrongDomain = signJson(JSON.stringify({
    schema_version: "1.0.0", tenant_id: TENANT_A, actor_id: ACTOR_A,
    issued_at: NOW.toISOString(), expires_at: new Date(NOW.getTime() + 600_000).toISOString(),
  }), SECRET, "axtro:other:v1\0");

  for (const candidate of [
    `${version}.${tamperedPayload}.${signature}`,
    `${version}.${encoded}.${signature.slice(0, -1)}a`,
    `${version}.${encoded}.${noDomain}`,
    wrongDomain,
    token.replace("scsv1", "scsv2"),
    "",
    "scsv1.payload",
    "scsv1.***.signature",
    `scsv1.${encoded}.***`,
    `scsv1.${encoded}.${signature}=`,
    `scsv1.${"a".repeat(4097)}.${signature}`,
  ]) {
    assert.throws(
      () => verifyStripeConnectOAuthStateToken(candidate, SECRET, NOW),
      (error) => error instanceof StripeConnectOAuthStateError && error.code === "state_token_invalid",
    );
  }
  assert.throws(
    () => verifyStripeConnectOAuthStateToken(token, OTHER_SECRET, NOW),
    (error) => error instanceof StripeConnectOAuthStateError && error.code === "state_token_invalid",
  );
});

test("validly signed non-canonical or structurally forged payloads are rejected", () => {
  const fields = {
    schema_version: "1.0.0", tenant_id: TENANT_A, actor_id: ACTOR_A,
    issued_at: NOW.toISOString(), expires_at: new Date(NOW.getTime() + 600_000).toISOString(),
  };
  // Same fields, extra whitespace: still valid JSON, but not the canonical
  // (sorted keys, no whitespace) form the codec itself produces.
  const withWhitespace = signJson(JSON.stringify(fields, null, 2));
  // Same fields, different key order: also not canonical.
  const reordered = signJson(JSON.stringify({
    actor_id: fields.actor_id, tenant_id: fields.tenant_id, schema_version: fields.schema_version,
    expires_at: fields.expires_at, issued_at: fields.issued_at,
  }));
  for (const candidate of [withWhitespace, reordered]) {
    assert.throws(
      () => verifyStripeConnectOAuthStateToken(candidate, SECRET, NOW),
      (error) => error instanceof StripeConnectOAuthStateError && error.code === "state_token_invalid",
    );
  }

  const invalidPayloads = [
    { schema_version: "2.0.0", tenant_id: TENANT_A, actor_id: ACTOR_A, issued_at: NOW.toISOString(), expires_at: new Date(NOW.getTime() + 600_000).toISOString() },
    { schema_version: "1.0.0", tenant_id: "not-a-uuidv7", actor_id: ACTOR_A, issued_at: NOW.toISOString(), expires_at: new Date(NOW.getTime() + 600_000).toISOString() },
    { schema_version: "1.0.0", tenant_id: TENANT_A, actor_id: "not-a-uuidv7", issued_at: NOW.toISOString(), expires_at: new Date(NOW.getTime() + 600_000).toISOString() },
    { schema_version: "1.0.0", tenant_id: TENANT_A, actor_id: ACTOR_A, issued_at: "2026-09-18T16:00:00Z", expires_at: new Date(NOW.getTime() + 600_000).toISOString() },
    { schema_version: "1.0.0", tenant_id: TENANT_A, actor_id: ACTOR_A, issued_at: NOW.toISOString(), expires_at: new Date(NOW.getTime() + 600_001).toISOString() },
    { schema_version: "1.0.0", tenant_id: TENANT_A, actor_id: ACTOR_A, issued_at: NOW.toISOString(), expires_at: NOW.toISOString() },
    { schema_version: "1.0.0", tenant_id: TENANT_A, actor_id: ACTOR_A, issued_at: NOW.toISOString(), expires_at: new Date(NOW.getTime() + 600_000).toISOString(), extra: true },
  ];
  for (const invalid of invalidPayloads) {
    assert.throws(() => verifyStripeConnectOAuthStateToken(signJson(JSON.stringify(invalid)), SECRET, NOW), StripeConnectOAuthStateError);
  }
});

test("expiry and future issuance fail closed", () => {
  const token = issueStripeConnectOAuthStateToken(TENANT_A, ACTOR_A, SECRET, NOW);
  assert.throws(
    () => verifyStripeConnectOAuthStateToken(token, SECRET, new Date(NOW.getTime() + STRIPE_CONNECT_OAUTH_STATE_TTL_SECONDS * 1000)),
    (error) => error instanceof StripeConnectOAuthStateError && error.code === "state_token_expired",
  );
  assert.equal(
    verifyStripeConnectOAuthStateToken(token, SECRET, new Date(NOW.getTime() + STRIPE_CONNECT_OAUTH_STATE_TTL_SECONDS * 1000 - 1)).tenant_id,
    TENANT_A,
  );
});

test("secret validation is exact and dedicated (never shared with another module's secret)", () => {
  assert.equal(STRIPE_CONNECT_OAUTH_STATE_SECRET_ENV, "STRIPE_CONNECT_OAUTH_STATE_SECRET");
  assert.equal(STRIPE_CONNECT_OAUTH_STATE_COOKIE_NAME, "axtro_stripe_connect_oauth_state");
  assert.equal(isStripeConnectOAuthStateSecretConfigured(SECRET), true);
  for (const value of [undefined, null, "", "a".repeat(63), "a".repeat(65), "00".repeat(32), "A".repeat(64), "g".repeat(64)]) {
    assert.equal(isStripeConnectOAuthStateSecretConfigured(value), false);
  }
  assert.throws(() => issueStripeConnectOAuthStateToken(TENANT_A, ACTOR_A, "not-a-secret", NOW), StripeConnectOAuthStateError);
  assert.throws(() => verifyStripeConnectOAuthStateToken(issueStripeConnectOAuthStateToken(TENANT_A, ACTOR_A, SECRET, NOW), "not-a-secret", NOW), StripeConnectOAuthStateError);
});
