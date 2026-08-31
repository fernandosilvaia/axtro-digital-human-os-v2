import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { registerHooks } from "node:module";
import test from "node:test";

const domainModuleUrl = new URL("../../packages/domain/dist/index.js", import.meta.url).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@axtro/domain") return { url: domainModuleUrl, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
const {
  issueTextPreviewStateToken,
  isTextPreviewStateSecretConfigured,
  textPreviewStateBindingFingerprint,
  TextPreviewStateTokenError,
  verifyTextPreviewStateToken,
} = await import("../../apps/portal/src/lib/agent-preview/state-token.ts");

const SECRET = "a".repeat(64);
const OTHER_SECRET = "b".repeat(64);
const NOW = new Date("2026-08-25T18:00:00.000Z");
const IDS = Object.freeze({
  tenant: "019f0000-0000-7000-8000-000000000001",
  user: "019f0000-0000-7000-8000-000000000002",
  actor: "019f0000-0000-7000-8000-000000000003",
  agent: "019f0000-0000-7000-8000-000000000004",
  session: "019f0000-0000-7000-8000-000000000005",
  admission: "019f0000-0000-7000-8000-000000000006",
  privacyPolicy: "019f0000-0000-7000-8000-000000000007",
});
const PROFILE_FINGERPRINT = `sha256:${"1".repeat(64)}`;

function binding(overrides = {}) {
  return {
    tenantId: IDS.tenant,
    userId: IDS.user,
    actorId: IDS.actor,
    agentId: IDS.agent,
    sessionId: IDS.session,
    admissionId: IDS.admission,
    clientSessionRefHash: "2".repeat(64),
    profileId: "openrouter_portal_text_essential_v1",
    profileVersion: "1.0.0",
    profileFingerprint: PROFILE_FINGERPRINT,
    providerConfigurationFingerprint: `sha256:${"3".repeat(64)}`,
    privacyPolicyId: IDS.privacyPolicy,
    jurisdiction: "US-FL",
    privacyPolicyVersion: "1.0.0",
    privacyPolicyFingerprint: `sha256:${"7".repeat(64)}`,
    persistentTranscript: false,
    ...overrides,
  };
}

function payload(overrides = {}) {
  return {
    schema_version: "2.0.0",
    admission_id: IDS.admission,
    binding_fingerprint: textPreviewStateBindingFingerprint(binding()),
    profile_id: "openrouter_portal_text_essential_v1",
    profile_version: "1.0.0",
    profile_fingerprint: PROFILE_FINGERPRINT,
    generation: 1,
    turns: [
      { role: "user", content: "Quero entender o produto." },
      { role: "assistant", content: "Posso explicar os pontos principais." },
    ],
    issued_at: NOW.toISOString(),
    expires_at: new Date(NOW.getTime() + 60 * 60 * 1000).toISOString(),
    ...overrides,
  };
}

test("ptsv1 round-trips deterministic canonical state", () => {
  const first = issueTextPreviewStateToken(payload(), SECRET, NOW);
  const second = issueTextPreviewStateToken({ ...payload(), turns: payload().turns.map((turn) => ({ ...turn })) }, SECRET, NOW);
  assert.equal(first, second);
  assert.match(first, /^ptsv1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

  const verified = verifyTextPreviewStateToken(first, SECRET, new Date(NOW.getTime() + 1));
  assert.equal(verified.admission_id, IDS.admission);
  assert.equal(verified.generation, 1);
  assert.deepEqual(verified.turns, payload().turns);
  assert.ok(Object.isFrozen(verified));
  assert.ok(Object.isFrozen(verified.turns));
});

test("domain separation, payload tampering and signature tampering fail closed", () => {
  const token = issueTextPreviewStateToken(payload(), SECRET, NOW);
  const [version, encoded, signature] = token.split(".");
  assert.ok(version && encoded && signature);
  const changedPayload = Buffer.from(JSON.stringify(payload({ generation: 0, turns: [] }))).toString("base64url");
  const signatureWithoutDomain = createHmac("sha256", Buffer.from(SECRET, "hex"))
    .update(encoded, "utf8")
    .digest("base64url");
  for (const candidate of [
    `${version}.${changedPayload}.${signature}`,
    `${version}.${encoded}.${signature.slice(0, -1)}a`,
    `${version}.${encoded}.${signatureWithoutDomain}`,
    token.replace("ptsv1", "ptsv2"),
    "",
    "ptsv1.payload",
    "ptsv1.***.signature",
    `ptsv1.${encoded}.***`,
    `ptsv1.${encoded}.${signature}=`,
  ]) {
    assert.throws(
      () => verifyTextPreviewStateToken(candidate, SECRET, NOW),
      (error) => error instanceof TextPreviewStateTokenError && error.code === "state_token_invalid",
    );
  }
  assert.throws(
    () => verifyTextPreviewStateToken(token, OTHER_SECRET, NOW),
    (error) => error instanceof TextPreviewStateTokenError && error.code === "state_token_invalid",
  );
});

test("validly signed but non-canonical JSON is rejected", () => {
  const nonCanonicalJson = JSON.stringify(payload());
  const encoded = Buffer.from(nonCanonicalJson, "utf8").toString("base64url");
  const signature = createHmac("sha256", Buffer.from(SECRET, "hex"))
    .update(`axtro:portal-text-preview-state:v1\0${encoded}`, "utf8")
    .digest("base64url");
  assert.throws(
    () => verifyTextPreviewStateToken(`ptsv1.${encoded}.${signature}`, SECRET, NOW),
    (error) => error instanceof TextPreviewStateTokenError && error.code === "state_token_invalid",
  );
});

test("expiry, future issuance, TTL and exact two-turn generations are enforced", () => {
  const valid = payload();
  const invalidPayloads = [
    { ...valid, expires_at: NOW.toISOString() },
    { ...valid, issued_at: new Date(NOW.getTime() + 6_000).toISOString() },
    { ...valid, expires_at: new Date(NOW.getTime() + 60 * 60 * 1000 + 1).toISOString() },
    { ...valid, generation: -1, turns: [] },
    { ...valid, generation: 2 },
    { ...valid, generation: 11, turns: [] },
    { ...valid, turns: [{ role: "assistant", content: "forged" }, { role: "user", content: "forged" }] },
    { ...valid, turns: [...valid.turns, { role: "user", content: "branch" }] },
    { ...valid, profile_id: "arbitrary_profile" },
    { ...valid, schema_version: "1.0.0" },
    { ...valid, extra: true },
    { ...valid, turns: [{ role: "user", content: "x".repeat(2001) }, { role: "assistant", content: "ok" }] },
  ];
  for (const invalid of invalidPayloads) {
    assert.throws(() => issueTextPreviewStateToken(invalid, SECRET, NOW), TextPreviewStateTokenError);
  }

  const token = issueTextPreviewStateToken(valid, SECRET, NOW);
  assert.throws(
    () => verifyTextPreviewStateToken(token, SECRET, new Date(NOW.getTime() + 60 * 60 * 1000)),
    (error) => error instanceof TextPreviewStateTokenError && error.code === "state_token_expired",
  );
});

test("binding fingerprint covers every authority field independently", () => {
  const base = textPreviewStateBindingFingerprint(binding());
  for (const mutation of [
    { tenantId: "019f0000-0000-7000-8000-000000000011" },
    { userId: "019f0000-0000-7000-8000-000000000012" },
    { actorId: "019f0000-0000-7000-8000-000000000013" },
    { agentId: "019f0000-0000-7000-8000-000000000014" },
    { sessionId: "019f0000-0000-7000-8000-000000000015" },
    { admissionId: "019f0000-0000-7000-8000-000000000016" },
    { clientSessionRefHash: "4".repeat(64) },
    { profileId: "openrouter_portal_text_persisted_v1" },
    { profileVersion: "1.0.1" },
    { profileFingerprint: `sha256:${"5".repeat(64)}` },
    { providerConfigurationFingerprint: `sha256:${"6".repeat(64)}` },
    { privacyPolicyId: "019f0000-0000-7000-8000-000000000017" },
    { jurisdiction: "BR-SP" },
    { privacyPolicyVersion: "1.0.1" },
    { privacyPolicyFingerprint: `sha256:${"8".repeat(64)}` },
    { persistentTranscript: true },
  ]) {
    assert.notEqual(textPreviewStateBindingFingerprint(binding(mutation)), base);
  }
});

test("ten maximum-size exchanges fit and the HMAC secret is exactly 32 bytes", () => {
  const maxTurns = Array.from({ length: 10 }, () => [
    { role: "user", content: "u".repeat(2000) },
    { role: "assistant", content: "a".repeat(4000) },
  ]).flat();
  const token = issueTextPreviewStateToken(payload({ generation: 10, turns: maxTurns }), SECRET, NOW);
  const verified = verifyTextPreviewStateToken(token, SECRET, new Date(NOW.getTime() + 1));
  assert.equal(verified.generation, 10);
  assert.equal(verified.turns.length, 20);

  assert.equal(isTextPreviewStateSecretConfigured(SECRET), true);
  for (const candidate of [undefined, null, "", "a".repeat(62), "a".repeat(63), "A".repeat(64), "g".repeat(64)]) {
    assert.equal(isTextPreviewStateSecretConfigured(candidate), false);
  }
});
