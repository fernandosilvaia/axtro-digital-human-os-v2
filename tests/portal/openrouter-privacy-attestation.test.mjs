import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
import test from "node:test";

const providerModuleUrl = new URL(
  "../../packages/provider-openrouter/dist/index.js",
  import.meta.url,
).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@axtro/provider-openrouter") {
      return { url: providerModuleUrl, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const {
  OPENROUTER_PRIVACY_ROUTING_CONFIGURATION_FINGERPRINT,
  OPENROUTER_PRIVACY_ROUTING_CONFIGURATION_V1_FINGERPRINT,
} = await import("@axtro/provider-openrouter");

const {
  assertOpenRouterPrivacyAttestation,
  createOpenRouterPrivacyAttemptRevalidator,
  executeAfterOpenRouterPrivacyPreflight,
  hasValidOpenRouterPrivacyAttestation,
  OpenRouterPrivacyAttestationError,
} = await import("../../apps/portal/src/lib/agent-preview/openrouter-privacy-attestation.ts");

const API_KEY = "openrouter-key-attestation-test";
const NOW = new Date("2026-08-31T12:00:00.000Z");

function keyFingerprint(value) {
  return `sha256:${createHash("sha256")
    .update("axtro/openrouter-api-key-attestation/v1\0", "utf8")
    .update(value, "utf8")
    .digest("hex")}`;
}

function validEnvironment() {
  return {
    OPENROUTER_API_KEY: API_KEY,
    OPENROUTER_ACCOUNT_CONTENT_LOGGING_DISABLED: "true",
    OPENROUTER_ACCOUNT_INPUT_OUTPUT_USE_DISABLED: "true",
    OPENROUTER_ACCOUNT_PRIVACY_ATTESTED_KEY_FINGERPRINT: keyFingerprint(API_KEY),
    OPENROUTER_ACCOUNT_PRIVACY_ATTESTED_CONFIGURATION_FINGERPRINT:
      OPENROUTER_PRIVACY_ROUTING_CONFIGURATION_FINGERPRINT,
    OPENROUTER_ACCOUNT_PRIVACY_ATTESTATION_ISSUED_AT: "2026-08-25T12:00:00.000Z",
    OPENROUTER_ACCOUNT_PRIVACY_ATTESTATION_VERIFIED_AT: "2026-08-31T11:00:00.000Z",
    OPENROUTER_ACCOUNT_PRIVACY_ATTESTATION_EXPIRES_AT: "2026-09-01T12:00:00.000Z",
  };
}

test("attestation binds account switches, domain-separated key, current routing and time window", () => {
  const env = validEnvironment();
  assert.doesNotThrow(() => assertOpenRouterPrivacyAttestation(env, NOW));
  assert.equal(hasValidOpenRouterPrivacyAttestation(env, NOW), true);
  assert.notEqual(keyFingerprint(API_KEY), `sha256:${createHash("sha256").update(API_KEY).digest("hex")}`);
});

test("historical 0049 request fingerprint cannot attest current OpenRouter egress", () => {
  const env = validEnvironment();
  env.OPENROUTER_ACCOUNT_PRIVACY_ATTESTED_CONFIGURATION_FINGERPRINT =
    OPENROUTER_PRIVACY_ROUTING_CONFIGURATION_V1_FINGERPRINT;
  assert.throws(
    () => assertOpenRouterPrivacyAttestation(env, NOW),
    OpenRouterPrivacyAttestationError,
  );
});

test("attestation fails closed for missing, rotated and mismatched bindings", () => {
  const invalid = [
    { OPENROUTER_ACCOUNT_CONTENT_LOGGING_DISABLED: undefined },
    { OPENROUTER_ACCOUNT_CONTENT_LOGGING_DISABLED: "false" },
    { OPENROUTER_ACCOUNT_INPUT_OUTPUT_USE_DISABLED: undefined },
    { OPENROUTER_ACCOUNT_INPUT_OUTPUT_USE_DISABLED: "false" },
    { OPENROUTER_API_KEY: "rotated-openrouter-key" },
    { OPENROUTER_API_KEY: ` ${API_KEY}` },
    { OPENROUTER_ACCOUNT_PRIVACY_ATTESTED_KEY_FINGERPRINT: `sha256:${"0".repeat(64)}` },
    { OPENROUTER_ACCOUNT_PRIVACY_ATTESTED_KEY_FINGERPRINT: "not-a-fingerprint" },
    { OPENROUTER_ACCOUNT_PRIVACY_ATTESTED_CONFIGURATION_FINGERPRINT: `sha256:${"0".repeat(64)}` },
  ];
  for (const broken of invalid) {
    const env = { ...validEnvironment(), ...broken };
    assert.throws(
      () => assertOpenRouterPrivacyAttestation(env, NOW),
      OpenRouterPrivacyAttestationError,
      JSON.stringify(broken),
    );
    assert.equal(hasValidOpenRouterPrivacyAttestation(env, NOW), false, JSON.stringify(broken));
  }
});

test("issued, verified and expires timestamps are canonical, ordered and bounded to 168 hours", () => {
  const invalid = [
    { OPENROUTER_ACCOUNT_PRIVACY_ATTESTATION_ISSUED_AT: undefined },
    { OPENROUTER_ACCOUNT_PRIVACY_ATTESTATION_VERIFIED_AT: undefined },
    { OPENROUTER_ACCOUNT_PRIVACY_ATTESTATION_EXPIRES_AT: undefined },
    { OPENROUTER_ACCOUNT_PRIVACY_ATTESTATION_ISSUED_AT: "2026-08-25T12:00:00Z" },
    { OPENROUTER_ACCOUNT_PRIVACY_ATTESTATION_VERIFIED_AT: "2026-08-31T11:00:00Z" },
    { OPENROUTER_ACCOUNT_PRIVACY_ATTESTATION_EXPIRES_AT: "2026-09-01T12:00:00Z" },
    {
      OPENROUTER_ACCOUNT_PRIVACY_ATTESTATION_ISSUED_AT: "2026-08-31T11:30:00.000Z",
      OPENROUTER_ACCOUNT_PRIVACY_ATTESTATION_VERIFIED_AT: "2026-08-31T11:00:00.000Z",
    },
    { OPENROUTER_ACCOUNT_PRIVACY_ATTESTATION_VERIFIED_AT: "2026-08-31T12:00:00.001Z" },
    { OPENROUTER_ACCOUNT_PRIVACY_ATTESTATION_EXPIRES_AT: "2026-08-31T12:00:00.000Z" },
    { OPENROUTER_ACCOUNT_PRIVACY_ATTESTATION_EXPIRES_AT: "2026-09-01T12:00:00.001Z" },
  ];
  for (const broken of invalid) {
    assert.throws(
      () => assertOpenRouterPrivacyAttestation({ ...validEnvironment(), ...broken }, NOW),
      OpenRouterPrivacyAttestationError,
      JSON.stringify(broken),
    );
  }
  assert.throws(
    () => assertOpenRouterPrivacyAttestation(validEnvironment(), new Date(Number.NaN)),
    OpenRouterPrivacyAttestationError,
  );
  assert.throws(
    () => assertOpenRouterPrivacyAttestation(
      validEnvironment(),
      new Date("2026-09-01T12:00:00.000Z"),
    ),
    OpenRouterPrivacyAttestationError,
  );
});

test("real-mode preflight causes zero downstream effects when invalid", async () => {
  const effects = { admission: 0, budget: 0, fetch: 0 };
  await assert.rejects(
    executeAfterOpenRouterPrivacyPreflight({
      env: {
        ...validEnvironment(),
        OPENROUTER_ACCOUNT_INPUT_OUTPUT_USE_DISABLED: "false",
      },
      fakeProviders: false,
      clock: () => NOW,
      execute: async () => {
        effects.admission += 1;
        effects.budget += 1;
        effects.fetch += 1;
        return "unreachable";
      },
    }),
    OpenRouterPrivacyAttestationError,
  );
  assert.deepEqual(effects, { admission: 0, budget: 0, fetch: 0 });
});

test("attestation is revalidated before every provider attempt", async () => {
  const env = validEnvironment();
  let attempts = 0;
  await assert.rejects(
    executeAfterOpenRouterPrivacyPreflight({
      env,
      fakeProviders: false,
      clock: () => NOW,
      execute: async (revalidateAttempt) => {
        revalidateAttempt();
        attempts += 1;
        env.OPENROUTER_API_KEY = "rotated-openrouter-key";
        revalidateAttempt();
        attempts += 1;
        return "unreachable";
      },
    }),
    OpenRouterPrivacyAttestationError,
  );
  assert.equal(attempts, 1);

  const directEnv = validEnvironment();
  const revalidate = createOpenRouterPrivacyAttemptRevalidator({
    env: directEnv,
    fakeProviders: false,
    clock: () => NOW,
  });
  assert.doesNotThrow(revalidate);
  directEnv.OPENROUTER_ACCOUNT_PRIVACY_ATTESTED_CONFIGURATION_FINGERPRINT =
    OPENROUTER_PRIVACY_ROUTING_CONFIGURATION_V1_FINGERPRINT;
  assert.throws(revalidate, OpenRouterPrivacyAttestationError);
});

test("fake mode remains deterministic without weakening real mode", async () => {
  let executions = 0;
  const result = await executeAfterOpenRouterPrivacyPreflight({
    env: {},
    fakeProviders: true,
    clock: () => new Date(Number.NaN),
    execute: async (revalidateAttempt) => {
      revalidateAttempt();
      executions += 1;
      return "fake-ok";
    },
  });
  assert.equal(result, "fake-ok");
  assert.equal(executions, 1);

  const realRevalidator = createOpenRouterPrivacyAttemptRevalidator({
    env: {},
    fakeProviders: false,
    clock: () => NOW,
  });
  assert.throws(realRevalidator, OpenRouterPrivacyAttestationError);
});

test("attestation failures expose neither API key nor fingerprints", () => {
  const env = validEnvironment();
  env.OPENROUTER_ACCOUNT_PRIVACY_ATTESTED_KEY_FINGERPRINT = `sha256:${"0".repeat(64)}`;
  let failure;
  try {
    assertOpenRouterPrivacyAttestation(env, NOW);
  } catch (error) {
    failure = error;
  }
  assert.ok(failure instanceof OpenRouterPrivacyAttestationError);
  const rendered = `${failure.name}:${failure.message}:${failure.stack ?? ""}`;
  assert.equal(rendered.includes(API_KEY), false);
  assert.equal(rendered.includes(env.OPENROUTER_ACCOUNT_PRIVACY_ATTESTED_KEY_FINGERPRINT), false);
  assert.equal(rendered.includes(OPENROUTER_PRIVACY_ROUTING_CONFIGURATION_FINGERPRINT), false);
});
