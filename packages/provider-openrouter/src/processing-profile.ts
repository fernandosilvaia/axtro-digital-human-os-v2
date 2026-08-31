import { createHash } from "node:crypto";

import type { ProviderProcessingProfile } from "@axtro/contracts-ts";

type ProviderProcessingConsentPurpose = ProviderProcessingProfile["required_consent_purposes"][number];
type ProviderProcessingPurpose = ProviderProcessingProfile["performed_processing_purposes"][number];
type ProviderChannelFeature = ProviderProcessingProfile["channel_features"][number];

export type OpenRouterProcessingProfile = Readonly<
  Omit<
    ProviderProcessingProfile,
    "required_consent_purposes" | "performed_processing_purposes" | "channel_features" | "sources"
  > & {
    readonly required_consent_purposes: readonly ProviderProcessingConsentPurpose[];
    readonly performed_processing_purposes: readonly ProviderProcessingPurpose[];
    readonly channel_features: readonly ProviderChannelFeature[];
    readonly sources: readonly string[];
  }
>;

/**
 * Historical request policy accepted by migration 0049.
 *
 * It remains exported only to validate or migrate existing admission records.
 * New egress must use {@link OpenRouterPrivacyRoutingConfiguration}.
 */
export interface OpenRouterPrivacyRoutingConfigurationV1 {
  readonly provider: Readonly<{
    readonly data_collection: "deny";
    readonly zdr: true;
  }>;
}

/** Current, fail-closed request policy for every new OpenRouter attempt. */
export interface OpenRouterPrivacyRoutingConfiguration {
  readonly provider: Readonly<{
    readonly data_collection: "deny";
    readonly zdr: true;
    readonly allow_fallbacks: false;
    readonly require_parameters: true;
  }>;
}

const PROFILE_REVIEWED_AT = "2026-08-25T12:00:00Z";
const PROFILE_REVIEW_TTL_HOURS = 720;
const VERIFICATION_TTL_HOURS = 720;

const OPENROUTER_PROFILE_SOURCES = Object.freeze([
  "https://openrouter.ai/docs/guides/privacy/data-collection",
  "https://openrouter.ai/docs/guides/privacy/provider-logging/",
  "https://openrouter.ai/docs/guides/routing/provider-selection",
  "https://openrouter.ai/docs/guides/features/zdr",
] as const);

export const OPENROUTER_PRIVACY_ROUTING_CONFIGURATION_V1: OpenRouterPrivacyRoutingConfigurationV1 =
  Object.freeze({
    provider: Object.freeze({
      data_collection: "deny",
      zdr: true,
    }),
  });

export const OPENROUTER_PRIVACY_ROUTING_CONFIGURATION: OpenRouterPrivacyRoutingConfiguration =
  Object.freeze({
    provider: Object.freeze({
      data_collection: "deny",
      zdr: true,
      allow_fallbacks: false,
      require_parameters: true,
    }),
  });

function isPlainRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: unknown, keys: readonly string[]): value is Readonly<Record<string, unknown>> {
  if (!isPlainRecord(value)) return false;
  const actualKeys = Object.keys(value);
  return actualKeys.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

function sha256Fingerprint(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")}`;
}

export function openRouterPrivacyRoutingConfigurationV1Fingerprint(configuration: unknown): string {
  if (!hasExactKeys(configuration, ["provider"])) {
    throw new TypeError("OpenRouter v1 privacy routing configuration must contain only provider");
  }
  const provider = configuration.provider;
  if (
    !hasExactKeys(provider, ["data_collection", "zdr"])
    || provider.data_collection !== "deny"
    || provider.zdr !== true
  ) {
    throw new TypeError("OpenRouter v1 provider routing is invalid");
  }
  return sha256Fingerprint(configuration);
}

export function openRouterPrivacyRoutingConfigurationFingerprint(configuration: unknown): string {
  if (!hasExactKeys(configuration, ["provider"])) {
    throw new TypeError("OpenRouter privacy routing configuration must contain only provider");
  }
  const provider = configuration.provider;
  if (
    !hasExactKeys(provider, ["allow_fallbacks", "data_collection", "require_parameters", "zdr"])
    || provider.data_collection !== "deny"
    || provider.zdr !== true
    || provider.allow_fallbacks !== false
    || provider.require_parameters !== true
  ) {
    throw new TypeError("OpenRouter provider routing does not satisfy the current privacy policy");
  }
  return sha256Fingerprint(configuration);
}

/** Exact lineage value hard-coded by migration 0049. Never use for new egress. */
export const OPENROUTER_PRIVACY_ROUTING_CONFIGURATION_V1_FINGERPRINT =
  openRouterPrivacyRoutingConfigurationV1Fingerprint(OPENROUTER_PRIVACY_ROUTING_CONFIGURATION_V1);

/** Current request-policy fingerprint. It intentionally differs from migration 0049. */
export const OPENROUTER_PRIVACY_ROUTING_CONFIGURATION_FINGERPRINT =
  openRouterPrivacyRoutingConfigurationFingerprint(OPENROUTER_PRIVACY_ROUTING_CONFIGURATION);

function freezeProfile(profile: OpenRouterProcessingProfile): OpenRouterProcessingProfile {
  return Object.freeze({
    ...profile,
    required_consent_purposes: Object.freeze([...profile.required_consent_purposes]),
    performed_processing_purposes: Object.freeze([...profile.performed_processing_purposes]),
    channel_features: Object.freeze([...profile.channel_features]),
    sources: Object.freeze([...profile.sources]),
  });
}

export const OPENROUTER_PORTAL_TEXT_ESSENTIAL_PROFILE = freezeProfile({
  schema_version: "2.0.0",
  profile_id: "openrouter_portal_text_essential_v1",
  profile_version: "1.0.0",
  provider_id: "openrouter",
  channel_kind: "portal_text",
  mode: "text",
  recording_mode: "off",
  persistent_transcript_mode: "off",
  perception_mode: "off",
  regional_policy: "unset",
  required_consent_purposes: [],
  performed_processing_purposes: [],
  channel_features: [],
  essential_only_eligible: true,
  reviewed_at: PROFILE_REVIEWED_AT,
  review_ttl_hours: PROFILE_REVIEW_TTL_HOURS,
  verification_mode: "code_owned",
  verification_ttl_hours: VERIFICATION_TTL_HOURS,
  sources: [...OPENROUTER_PROFILE_SOURCES],
});

export const OPENROUTER_PORTAL_TEXT_PERSISTED_PROFILE = freezeProfile({
  ...OPENROUTER_PORTAL_TEXT_ESSENTIAL_PROFILE,
  profile_id: "openrouter_portal_text_persisted_v1",
  persistent_transcript_mode: "application_opt_in",
  required_consent_purposes: ["persistent_transcription"],
  performed_processing_purposes: ["persistent_transcription"],
  essential_only_eligible: false,
  sources: [...OPENROUTER_PORTAL_TEXT_ESSENTIAL_PROFILE.sources],
});

export function openRouterProcessingProfileFingerprint(profile: OpenRouterProcessingProfile): string {
  return sha256Fingerprint(profile);
}

export const OPENROUTER_PORTAL_TEXT_ESSENTIAL_PROFILE_FINGERPRINT =
  openRouterProcessingProfileFingerprint(OPENROUTER_PORTAL_TEXT_ESSENTIAL_PROFILE);

export const OPENROUTER_PORTAL_TEXT_PERSISTED_PROFILE_FINGERPRINT =
  openRouterProcessingProfileFingerprint(OPENROUTER_PORTAL_TEXT_PERSISTED_PROFILE);
