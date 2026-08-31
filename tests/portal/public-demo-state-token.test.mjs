import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const {
  createInitialPublicDemoState,
  issuePublicDemoStateToken,
  isPublicDemoStateSecretConfigured,
  isPublicDemoUuidV7,
  PUBLIC_DEMO_STATE_SECRET_ENV,
  PUBLIC_DEMO_STATE_TOKEN_VERSION,
  PUBLIC_DEMO_STATE_TTL_SECONDS,
  PublicDemoStateTokenError,
  verifyPublicDemoStateToken,
} = await import("../../apps/portal/src/lib/public-demo/state-token.ts");
const { PUBLIC_DEMO_FIXTURE } = await import("../../apps/portal/src/lib/public-demo/fixture.ts");

const SECRET = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
const OTHER_SECRET = "202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f";
const NOW = new Date("2026-08-31T16:00:00.000Z");
const SESSION_A = "019f0000-0000-7000-8000-000000000001";
const SESSION_B = "019f0000-0000-7000-8000-000000000002";
const DOMAIN = "axtro:portal-public-demo-state:v1\0";

function signJson(json, secret = SECRET, domain = DOMAIN) {
  const payload = Buffer.from(json, "utf8").toString("base64url");
  const signature = createHmac("sha256", Buffer.from(secret, "hex"))
    .update(`${domain}${payload}`, "utf8")
    .digest("base64url");
  return `${PUBLIC_DEMO_STATE_TOKEN_VERSION}.${payload}.${signature}`;
}

test("public demo fixture is immutable, synthetic and incapable of paid effects", () => {
  assert.equal(PUBLIC_DEMO_FIXTURE.fixture_version, "1.0.0");
  assert.equal(PUBLIC_DEMO_FIXTURE.data_classification, "synthetic_non_customer");
  assert.equal(PUBLIC_DEMO_FIXTURE.retention, "none");
  assert.equal(PUBLIC_DEMO_FIXTURE.paid_effects, "disabled");
  assert.equal(PUBLIC_DEMO_FIXTURE.surfaces.overview.external_effects, 0);
  assert.equal(PUBLIC_DEMO_FIXTURE.surfaces.agent.privileged_roles, 0);
  assert.equal(PUBLIC_DEMO_FIXTURE.surfaces.agent.external_effects, 0);
  assert.equal(PUBLIC_DEMO_FIXTURE.surfaces.knowledge.customer_documents, 0);
  assert.equal(PUBLIC_DEMO_FIXTURE.surfaces.knowledge.external_queries, 0);
  assert.equal(PUBLIC_DEMO_FIXTURE.surfaces.conversation.provider_requests, 0);
  assert.equal(PUBLIC_DEMO_FIXTURE.surfaces.conversation.stored_transcripts, 0);
  assert.equal(Object.isFrozen(PUBLIC_DEMO_FIXTURE), true);
  assert.equal(Object.isFrozen(PUBLIC_DEMO_FIXTURE.surfaces), true);
  for (const surface of Object.values(PUBLIC_DEMO_FIXTURE.surfaces)) {
    assert.equal(Object.isFrozen(surface), true);
  }
  assert.throws(() => {
    PUBLIC_DEMO_FIXTURE.surfaces.overview.available_demo_surfaces = 999;
  }, TypeError);
  const serialized = JSON.stringify(PUBLIC_DEMO_FIXTURE);
  assert.doesNotMatch(serialized, /tenant_id|user_id|actor_id|provider_id|receipt_id|email|phone/i);
});

test("pdsv1 round-trips a canonical isolated session deterministically", () => {
  const state = createInitialPublicDemoState(SESSION_A, NOW);
  const first = issuePublicDemoStateToken(state, SECRET, NOW);
  const second = issuePublicDemoStateToken({ ...state }, SECRET, NOW);
  assert.equal(first, second);
  assert.match(first, /^pdsv1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

  const verified = verifyPublicDemoStateToken(first, SECRET, new Date(NOW.getTime() + 1));
  assert.deepEqual(verified, state);
  assert.equal(Object.isFrozen(verified), true);
  assert.equal(verified.schema_version, "2.0.0");
  assert.equal(verified.fixture_version, "1.0.0");
  assert.equal(verified.revision, 0);
  assert.deepEqual(verified.seen_commands, []);
  assert.equal(
    Date.parse(verified.expires_at) - Date.parse(verified.issued_at),
    PUBLIC_DEMO_STATE_TTL_SECONDS * 1000,
  );
});

test("separate anonymous sessions get unlinkable state and cannot mutate each other", () => {
  const stateA = createInitialPublicDemoState(SESSION_A, NOW);
  const stateB = createInitialPublicDemoState(SESSION_B, NOW);
  const tokenA = issuePublicDemoStateToken(stateA, SECRET, NOW);
  const tokenB = issuePublicDemoStateToken(stateB, SECRET, NOW);

  assert.notEqual(tokenA, tokenB);
  assert.equal(verifyPublicDemoStateToken(tokenA, SECRET, NOW).demo_session_id, SESSION_A);
  assert.equal(verifyPublicDemoStateToken(tokenB, SECRET, NOW).demo_session_id, SESSION_B);
  assert.notDeepEqual(stateA, stateB);
});

test("domain separation, payload tampering and signature tampering fail closed", () => {
  const state = createInitialPublicDemoState(SESSION_A, NOW);
  const token = issuePublicDemoStateToken(state, SECRET, NOW);
  const [version, encoded, signature] = token.split(".");
  assert.ok(version && encoded && signature);
  const changedState = Buffer.from(JSON.stringify({ ...state, revision: 1 }), "utf8")
    .toString("base64url");
  const noDomain = createHmac("sha256", Buffer.from(SECRET, "hex"))
    .update(encoded, "utf8")
    .digest("base64url");
  const wrongDomain = signJson(JSON.stringify(state), SECRET, "axtro:other:v1\0");

  for (const candidate of [
    `${version}.${changedState}.${signature}`,
    `${version}.${encoded}.${signature.slice(0, -1)}a`,
    `${version}.${encoded}.${noDomain}`,
    wrongDomain,
    token.replace("pdsv1", "pdsv2"),
    "",
    "pdsv1.payload",
    "pdsv1.***.signature",
    `pdsv1.${encoded}.***`,
    `pdsv1.${encoded}.${signature}=`,
    `pdsv1.${"a".repeat(4097)}.${signature}`,
  ]) {
    assert.throws(
      () => verifyPublicDemoStateToken(candidate, SECRET, NOW),
      (error) => error instanceof PublicDemoStateTokenError && error.code === "state_token_invalid",
    );
  }
  assert.throws(
    () => verifyPublicDemoStateToken(token, OTHER_SECRET, NOW),
    (error) => error instanceof PublicDemoStateTokenError && error.code === "state_token_invalid",
  );
});

test("validly signed non-canonical, overlong and structurally forged payloads are rejected", () => {
  const state = createInitialPublicDemoState(SESSION_A, NOW);
  const nonCanonical = signJson(JSON.stringify(state));
  assert.throws(
    () => verifyPublicDemoStateToken(nonCanonical, SECRET, NOW),
    (error) => error instanceof PublicDemoStateTokenError && error.code === "state_token_invalid",
  );

  const invalidStates = [
    { ...state, schema_version: "1.0.0" },
    { ...state, fixture_version: "2.0.0" },
    { ...state, demo_session_id: "550e8400-e29b-41d4-a716-446655440000" },
    { ...state, revision: 1, seen_commands: [] },
    {
      ...state,
      seen_commands: [{ command_id: SESSION_B, expected_revision: 0, command: "advance" }],
    },
    {
      ...state,
      revision: 1,
      seen_commands: [{ command_id: SESSION_B, expected_revision: 1, command: "advance" }],
    },
    {
      ...state,
      revision: 2,
      seen_commands: [
        { command_id: SESSION_B, expected_revision: 0, command: "advance" },
        { command_id: SESSION_B, expected_revision: 1, command: "reset" },
      ],
    },
    { ...state, revision: 13, seen_commands: [] },
    { ...state, surface: "billing" },
    { ...state, step: "free_text" },
    { ...state, extra: true },
    { ...state, issued_at: "2026-08-31T16:00:00Z" },
    { ...state, expires_at: new Date(NOW.getTime() + 900_001).toISOString() },
    { ...state, expires_at: NOW.toISOString() },
  ];
  for (const invalid of invalidStates) {
    assert.throws(() => issuePublicDemoStateToken(invalid, SECRET, NOW), PublicDemoStateTokenError);
  }

  const oversized = signJson(JSON.stringify({ ...state, injected: "x".repeat(3000) }));
  assert.throws(
    () => verifyPublicDemoStateToken(oversized, SECRET, NOW),
    (error) => error instanceof PublicDemoStateTokenError && error.code === "state_token_invalid",
  );
});

test("normative valid payload is accepted by both the schema contract and codec", async () => {
  const payload = JSON.parse(await readFile(
    new URL("../../contracts/examples/valid/portal_public_demo_signed_state_payload.json", import.meta.url),
    "utf8",
  ));
  const now = new Date(payload.issued_at);
  const token = issuePublicDemoStateToken(payload, SECRET, now);
  assert.deepEqual(verifyPublicDemoStateToken(token, SECRET, now), payload);
});

test("expiry, future issuance and invalid clocks fail closed", () => {
  const state = createInitialPublicDemoState(SESSION_A, NOW);
  const token = issuePublicDemoStateToken(state, SECRET, NOW);
  const shorter = {
    ...state,
    expires_at: new Date(NOW.getTime() + 60_000).toISOString(),
  };
  assert.equal(verifyPublicDemoStateToken(
    issuePublicDemoStateToken(shorter, SECRET, NOW),
    SECRET,
    NOW,
  ).expires_at, shorter.expires_at);
  assert.throws(
    () => verifyPublicDemoStateToken(
      token,
      SECRET,
      new Date(NOW.getTime() + PUBLIC_DEMO_STATE_TTL_SECONDS * 1000),
    ),
    (error) => error instanceof PublicDemoStateTokenError && error.code === "state_token_expired",
  );

  const future = createInitialPublicDemoState(SESSION_A, new Date(NOW.getTime() + 5_001));
  assert.throws(() => issuePublicDemoStateToken(future, SECRET, NOW), PublicDemoStateTokenError);
  assert.throws(() => createInitialPublicDemoState(SESSION_A, new Date(Number.NaN)), PublicDemoStateTokenError);
});

test("secret and UUIDv7 validation are exact and dedicated", () => {
  assert.equal(PUBLIC_DEMO_STATE_SECRET_ENV, "PORTAL_PUBLIC_DEMO_STATE_SECRET");
  assert.equal(isPublicDemoStateSecretConfigured(SECRET), true);
  for (const value of [
    undefined,
    null,
    "",
    "a".repeat(63),
    "a".repeat(64),
    "a".repeat(65),
    "00".repeat(32),
    "A".repeat(64),
    "g".repeat(64),
  ]) {
    assert.equal(isPublicDemoStateSecretConfigured(value), false);
  }

  assert.equal(isPublicDemoUuidV7(SESSION_A), true);
  for (const value of [
    "550e8400-e29b-41d4-a716-446655440000",
    "019f0000-0000-6000-8000-000000000001",
    "019F0000-0000-7000-8000-000000000001",
    "019f0000-0000-7000-7000-000000000001",
  ]) {
    assert.equal(isPublicDemoUuidV7(value), false);
    assert.throws(() => createInitialPublicDemoState(value, NOW), PublicDemoStateTokenError);
  }
});

test("codec owns canonical HMAC and constant-time comparison without customer dependencies", async () => {
  const source = await readFile(
    new URL("../../apps/portal/src/lib/public-demo/state-token.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /axtro:portal-public-demo-state:v1/);
  assert.match(source, /timingSafeEqual/);
  assert.match(source, /canonicalJson/);
  assert.doesNotMatch(
    source,
    /@supabase|portal-data|paid-effects|provider|billing|calendar|email|database|receipt|process\.env/i,
  );
});
