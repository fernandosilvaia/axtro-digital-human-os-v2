import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import test from "node:test";

const root = fileURLToPath(new URL("../..", import.meta.url));
const provider = await import(
  pathToFileURL(join(root, "packages/provider-openrouter/dist/processing-profile.js")).href
);

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

function fingerprint(value) {
  return `sha256:${createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")}`;
}

test("v1 profile fingerprints remain byte-compatible with migration 0049", () => {
  assert.equal(
    provider.OPENROUTER_PORTAL_TEXT_ESSENTIAL_PROFILE_FINGERPRINT,
    "sha256:5f07f0bb93393c7fcd4412516db48f30fb3095fb31e9352cd2cf849b260a5173",
  );
  assert.equal(
    provider.OPENROUTER_PORTAL_TEXT_PERSISTED_PROFILE_FINGERPRINT,
    "sha256:5062dd979ac79778052389f27069a16dfa8f33fb175d38181774415b1ff585b8",
  );
  assert.equal(
    provider.OPENROUTER_PRIVACY_ROUTING_CONFIGURATION_V1_FINGERPRINT,
    "sha256:70e60ec32d8a29d0f6264a0545e2ea1d215d02fe164d90dadaa63e99e59472de",
  );
});

test("current routing denies collection, requires ZDR and disables ambiguous routing", () => {
  const configuration = provider.OPENROUTER_PRIVACY_ROUTING_CONFIGURATION;
  assert.deepEqual(configuration, {
    provider: {
      data_collection: "deny",
      zdr: true,
      allow_fallbacks: false,
      require_parameters: true,
    },
  });
  assert.equal(Object.isFrozen(configuration), true);
  assert.equal(Object.isFrozen(configuration.provider), true);
  assert.equal(
    provider.OPENROUTER_PRIVACY_ROUTING_CONFIGURATION_FINGERPRINT,
    "sha256:787880392b188fe90bf3d2c33465387191f4baef445d72d1825f40890f71f4f0",
  );
  assert.equal(
    provider.openRouterPrivacyRoutingConfigurationFingerprint(configuration),
    fingerprint(configuration),
  );
});

test("the historical request fingerprint cannot attest the current policy", () => {
  assert.notEqual(
    provider.OPENROUTER_PRIVACY_ROUTING_CONFIGURATION_FINGERPRINT,
    provider.OPENROUTER_PRIVACY_ROUTING_CONFIGURATION_V1_FINGERPRINT,
  );
  assert.throws(
    () => provider.openRouterPrivacyRoutingConfigurationFingerprint(
      provider.OPENROUTER_PRIVACY_ROUTING_CONFIGURATION_V1,
    ),
    TypeError,
  );
});

test("current routing rejects omitted, relaxed, extra and inherited fields", () => {
  const inherited = Object.create({
    provider: {
      data_collection: "deny",
      zdr: true,
      allow_fallbacks: false,
      require_parameters: true,
    },
  });
  const validProvider = {
    data_collection: "deny",
    zdr: true,
    allow_fallbacks: false,
    require_parameters: true,
  };
  for (const mutation of [
    null,
    {},
    inherited,
    { provider: { ...validProvider, data_collection: "allow" } },
    { provider: { ...validProvider, zdr: false } },
    { provider: { ...validProvider, allow_fallbacks: true } },
    { provider: { ...validProvider, require_parameters: false } },
    { provider: { data_collection: "deny", zdr: true } },
    { provider: { ...validProvider, sort: "price" } },
    { provider: validProvider, extra: true },
  ]) {
    assert.throws(
      () => provider.openRouterPrivacyRoutingConfigurationFingerprint(mutation),
      TypeError,
    );
  }
});

test("processing profiles implement the generated contract and are deeply immutable", () => {
  const essential = provider.OPENROUTER_PORTAL_TEXT_ESSENTIAL_PROFILE;
  assert.deepEqual(
    {
      schema_version: essential.schema_version,
      profile_id: essential.profile_id,
      profile_version: essential.profile_version,
      provider_id: essential.provider_id,
      channel_kind: essential.channel_kind,
      mode: essential.mode,
      recording_mode: essential.recording_mode,
      persistent_transcript_mode: essential.persistent_transcript_mode,
      perception_mode: essential.perception_mode,
      required_consent_purposes: essential.required_consent_purposes,
      performed_processing_purposes: essential.performed_processing_purposes,
      essential_only_eligible: essential.essential_only_eligible,
      verification_mode: essential.verification_mode,
    },
    {
      schema_version: "2.0.0",
      profile_id: "openrouter_portal_text_essential_v1",
      profile_version: "1.0.0",
      provider_id: "openrouter",
      channel_kind: "portal_text",
      mode: "text",
      recording_mode: "off",
      persistent_transcript_mode: "off",
      perception_mode: "off",
      required_consent_purposes: [],
      performed_processing_purposes: [],
      essential_only_eligible: true,
      verification_mode: "code_owned",
    },
  );
  assert.equal(Object.isFrozen(essential), true);
  assert.equal(Object.isFrozen(essential.sources), true);
  assert.throws(() => essential.sources.push("https://example.com"), TypeError);

  const persisted = provider.OPENROUTER_PORTAL_TEXT_PERSISTED_PROFILE;
  assert.equal(persisted.persistent_transcript_mode, "application_opt_in");
  assert.deepEqual(persisted.required_consent_purposes, ["persistent_transcription"]);
  assert.deepEqual(persisted.performed_processing_purposes, ["persistent_transcription"]);
  assert.equal(persisted.essential_only_eligible, false);
});
