import { createHash, timingSafeEqual } from "node:crypto";

import {
  OPENROUTER_PORTAL_TEXT_ESSENTIAL_PROFILE,
  OPENROUTER_PRIVACY_ROUTING_CONFIGURATION_FINGERPRINT,
} from "@axtro/provider-openrouter";

const API_KEY_FINGERPRINT_DOMAIN = "axtro/openrouter-api-key-attestation/v1\0";
const FINGERPRINT_PATTERN = /^sha256:[a-f0-9]{64}$/;
const MAX_ATTESTATION_TTL_MS = 168 * 60 * 60 * 1000;

type PrivacyAttestationEnvironment = Readonly<Record<string, string | undefined>>;

export class OpenRouterPrivacyAttestationError extends Error {
  constructor() {
    super("openrouter_privacy_attestation_invalid");
    this.name = "OpenRouterPrivacyAttestationError";
  }
}

function rejectAttestation(): never {
  throw new OpenRouterPrivacyAttestationError();
}

function parseCanonicalIso(value: string | undefined): number | null {
  if (typeof value !== "string" || value.length === 0) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return new Date(timestamp).toISOString() === value ? timestamp : null;
}

function apiKeyDigest(apiKey: string): Buffer {
  return createHash("sha256")
    .update(API_KEY_FINGERPRINT_DOMAIN, "utf8")
    .update(apiKey, "utf8")
    .digest();
}

function fingerprintDigest(value: string | undefined): Buffer | null {
  if (typeof value !== "string" || !FINGERPRINT_PATTERN.test(value)) return null;
  return Buffer.from(value.slice("sha256:".length), "hex");
}

function digestMatches(expected: Buffer, configuredFingerprint: string | undefined): boolean {
  const configured = fingerprintDigest(configuredFingerprint);
  return configured !== null && timingSafeEqual(expected, configured);
}

function fingerprintMatches(expectedFingerprint: string, configuredFingerprint: string | undefined): boolean {
  const expected = fingerprintDigest(expectedFingerprint);
  return expected !== null && digestMatches(expected, configuredFingerprint);
}

function profileReviewWindow(): Readonly<{ reviewedAt: number; expiresAt: number }> {
  const reviewedAt = Date.parse(OPENROUTER_PORTAL_TEXT_ESSENTIAL_PROFILE.reviewed_at);
  const ttlHours = OPENROUTER_PORTAL_TEXT_ESSENTIAL_PROFILE.review_ttl_hours;
  if (
    !Number.isFinite(reviewedAt)
    || !Number.isSafeInteger(ttlHours)
    || ttlHours < 1
    || ttlHours > 720
  ) rejectAttestation();
  return Object.freeze({
    reviewedAt,
    expiresAt: reviewedAt + ttlHours * 60 * 60 * 1000,
  });
}

export function assertOpenRouterPrivacyAttestation(
  env: PrivacyAttestationEnvironment,
  now: Date = new Date(),
): void {
  if (
    env.OPENROUTER_ACCOUNT_CONTENT_LOGGING_DISABLED !== "true"
    || env.OPENROUTER_ACCOUNT_INPUT_OUTPUT_USE_DISABLED !== "true"
  ) rejectAttestation();

  const apiKey = env.OPENROUTER_API_KEY;
  if (
    typeof apiKey !== "string"
    || apiKey.length < 8
    || apiKey.trim() !== apiKey
    || !digestMatches(
      apiKeyDigest(apiKey),
      env.OPENROUTER_ACCOUNT_PRIVACY_ATTESTED_KEY_FINGERPRINT,
    )
  ) rejectAttestation();

  if (!fingerprintMatches(
    OPENROUTER_PRIVACY_ROUTING_CONFIGURATION_FINGERPRINT,
    env.OPENROUTER_ACCOUNT_PRIVACY_ATTESTED_CONFIGURATION_FINGERPRINT,
  )) rejectAttestation();

  const nowTimestamp = now.getTime();
  const issuedAt = parseCanonicalIso(env.OPENROUTER_ACCOUNT_PRIVACY_ATTESTATION_ISSUED_AT);
  const verifiedAt = parseCanonicalIso(env.OPENROUTER_ACCOUNT_PRIVACY_ATTESTATION_VERIFIED_AT);
  const expiresAt = parseCanonicalIso(env.OPENROUTER_ACCOUNT_PRIVACY_ATTESTATION_EXPIRES_AT);
  const review = profileReviewWindow();
  if (
    !Number.isFinite(nowTimestamp)
    || issuedAt === null
    || verifiedAt === null
    || expiresAt === null
    || nowTimestamp < review.reviewedAt
    || nowTimestamp >= review.expiresAt
    || issuedAt < review.reviewedAt
    || issuedAt > verifiedAt
    || verifiedAt > nowTimestamp
    || expiresAt <= nowTimestamp
    || expiresAt <= verifiedAt
    || expiresAt - issuedAt > MAX_ATTESTATION_TTL_MS
    || expiresAt > review.expiresAt
  ) rejectAttestation();
}

export function hasValidOpenRouterPrivacyAttestation(
  env: PrivacyAttestationEnvironment,
  now: Date = new Date(),
): boolean {
  try {
    assertOpenRouterPrivacyAttestation(env, now);
    return true;
  } catch {
    return false;
  }
}

export function createOpenRouterPrivacyAttemptRevalidator(input: Readonly<{
  env: PrivacyAttestationEnvironment;
  fakeProviders: boolean;
  clock?: () => Date;
}>): () => void {
  if (input.fakeProviders) return () => {};
  return () => {
    assertOpenRouterPrivacyAttestation(input.env, input.clock?.() ?? new Date());
  };
}

export async function executeAfterOpenRouterPrivacyPreflight<T>(input: Readonly<{
  env: PrivacyAttestationEnvironment;
  fakeProviders: boolean;
  execute: (revalidateAttempt: () => void) => Promise<T>;
  clock?: () => Date;
}>): Promise<T> {
  const revalidateAttempt = createOpenRouterPrivacyAttemptRevalidator(input);
  revalidateAttempt();
  return input.execute(revalidateAttempt);
}
