import { createHmac } from "node:crypto";

import type { PortalTextPreviewSignedStatePayload as PortalTextPreviewSignedStateContract } from "@axtro/contracts-ts";
import { canonicalJson, sha256Canonical, UUID_V7_PATTERN } from "@axtro/domain";

import { constantTimeEquals } from "../security.ts";

export const TEXT_PREVIEW_STATE_TOKEN_VERSION = "ptsv1";
export const TEXT_PREVIEW_STATE_TTL_MS = 60 * 60 * 1000;
export const MAX_TEXT_PREVIEW_EXCHANGES = 10;

const MAX_USER_TURN_CHARS = 2000;
const MAX_ASSISTANT_TURN_CHARS = 4000;
const MAX_STATE_PAYLOAD_BYTES = 68 * 1024;
const MAX_STATE_TOKEN_CHARS = 96 * 1024;
const SHA256_FINGERPRINT_PATTERN = /^sha256:[0-9a-f]{64}$/;
// The deployment secret is exactly 32 bytes encoded as lowercase hexadecimal.
const SECRET_PATTERN = /^[0-9a-f]{64}$/;
const PROFILE_IDS = new Set([
  "openrouter_portal_text_essential_v1",
  "openrouter_portal_text_persisted_v1",
]);
const PAYLOAD_KEYS = Object.freeze([
  "schema_version",
  "admission_id",
  "binding_fingerprint",
  "profile_id",
  "profile_version",
  "profile_fingerprint",
  "generation",
  "turns",
  "issued_at",
  "expires_at",
] as const);
const TURN_KEYS = Object.freeze(["role", "content"] as const);
const SIGNING_DOMAIN = "axtro:portal-text-preview-state:v1\0";

export type TextPreviewStateTurn = Readonly<PortalTextPreviewSignedStateContract["turns"][number]>;

export type TextPreviewStatePayload = Readonly<
  Omit<PortalTextPreviewSignedStateContract, "turns"> & {
    readonly turns: readonly TextPreviewStateTurn[];
  }
>;

/**
 * Every server-owned authority that makes a browser-carried state valid.
 * The token stores only the resulting fingerprint, never these identifiers.
 */
export interface TextPreviewStateBinding {
  readonly tenantId: string;
  readonly userId: string;
  readonly actorId: string;
  readonly agentId: string;
  readonly sessionId: string;
  readonly admissionId: string;
  readonly clientSessionRefHash: string;
  readonly profileId: string;
  readonly profileVersion: string;
  readonly profileFingerprint: string;
  readonly providerConfigurationFingerprint: string;
  readonly privacyPolicyId: string;
  readonly jurisdiction: string;
  readonly privacyPolicyVersion: string;
  readonly privacyPolicyFingerprint: string;
  readonly persistentTranscript: boolean;
}

export type TextPreviewStateTokenErrorCode =
  | "state_secret_invalid"
  | "state_token_invalid"
  | "state_token_expired";

export class TextPreviewStateTokenError extends Error {
  readonly code: TextPreviewStateTokenErrorCode;

  constructor(code: TextPreviewStateTokenErrorCode) {
    super(code);
    this.name = "TextPreviewStateTokenError";
    this.code = code;
  }
}

function ownRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null
      ? value as Readonly<Record<string, unknown>>
      : null;
  } catch {
    return null;
  }
}

function hasExactKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value);
  return actual.length === expected.length
    && expected.every((key) => Object.hasOwn(value, key));
}

function parseCanonicalTimestamp(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) return null;
  return parsed;
}

function parseSecret(secret: unknown): Buffer {
  if (typeof secret !== "string" || !SECRET_PATTERN.test(secret)) {
    throw new TextPreviewStateTokenError("state_secret_invalid");
  }
  return Buffer.from(secret, "hex");
}

function parseCanonicalBase64Url(value: string): Buffer | null {
  if (value.length === 0 || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const decoded = Buffer.from(value, "base64url");
    return decoded.toString("base64url") === value ? decoded : null;
  } catch {
    return null;
  }
}

function parseTurns(value: unknown): readonly TextPreviewStateTurn[] | null {
  if (!Array.isArray(value)
    || value.length % 2 !== 0
    || value.length > MAX_TEXT_PREVIEW_EXCHANGES * 2) return null;
  const turns: TextPreviewStateTurn[] = [];
  for (const [index, item] of value.entries()) {
    const turn = ownRecord(item);
    const expectedRole = index % 2 === 0 ? "user" : "assistant";
    const maxChars = expectedRole === "user" ? MAX_USER_TURN_CHARS : MAX_ASSISTANT_TURN_CHARS;
    if (!turn
      || !hasExactKeys(turn, TURN_KEYS)
      || turn.role !== expectedRole
      || typeof turn.content !== "string"
      || turn.content.length < 1
      || turn.content.length > maxChars) return null;
    turns.push(Object.freeze({ role: expectedRole, content: turn.content }));
  }
  return Object.freeze(turns);
}

function parsePayload(value: unknown, nowMs: number): TextPreviewStatePayload {
  const payload = ownRecord(value);
  if (!payload || !hasExactKeys(payload, PAYLOAD_KEYS)) {
    throw new TextPreviewStateTokenError("state_token_invalid");
  }
  const turns = parseTurns(payload.turns);
  const issuedAtMs = parseCanonicalTimestamp(payload.issued_at);
  const expiresAtMs = parseCanonicalTimestamp(payload.expires_at);
  if (payload.schema_version !== "2.0.0"
    || typeof payload.admission_id !== "string"
    || !UUID_V7_PATTERN.test(payload.admission_id)
    || typeof payload.binding_fingerprint !== "string"
    || !SHA256_FINGERPRINT_PATTERN.test(payload.binding_fingerprint)
    || typeof payload.profile_id !== "string"
    || !PROFILE_IDS.has(payload.profile_id)
    || payload.profile_version !== "1.0.0"
    || typeof payload.profile_fingerprint !== "string"
    || !SHA256_FINGERPRINT_PATTERN.test(payload.profile_fingerprint)
    || !Number.isInteger(payload.generation)
    || Number(payload.generation) < 0
    || Number(payload.generation) > MAX_TEXT_PREVIEW_EXCHANGES
    || turns === null
    || payload.generation !== turns.length / 2
    || issuedAtMs === null
    || expiresAtMs === null
    || issuedAtMs > nowMs + 5_000
    || expiresAtMs <= issuedAtMs
    || expiresAtMs - issuedAtMs > TEXT_PREVIEW_STATE_TTL_MS) {
    throw new TextPreviewStateTokenError("state_token_invalid");
  }
  if (expiresAtMs <= nowMs) throw new TextPreviewStateTokenError("state_token_expired");
  return Object.freeze({
    schema_version: "2.0.0",
    admission_id: payload.admission_id,
    binding_fingerprint: payload.binding_fingerprint,
    profile_id: payload.profile_id as TextPreviewStatePayload["profile_id"],
    profile_version: "1.0.0",
    profile_fingerprint: payload.profile_fingerprint,
    generation: Number(payload.generation),
    turns,
    issued_at: payload.issued_at as string,
    expires_at: payload.expires_at as string,
  });
}

export function isTextPreviewStateSecretConfigured(value: unknown): value is string {
  return typeof value === "string" && SECRET_PATTERN.test(value);
}

export function textPreviewStateBindingFingerprint(binding: TextPreviewStateBinding): string {
  return `sha256:${sha256Canonical({
    tenantId: binding.tenantId,
    userId: binding.userId,
    actorId: binding.actorId,
    agentId: binding.agentId,
    sessionId: binding.sessionId,
    admissionId: binding.admissionId,
    clientSessionRefHash: binding.clientSessionRefHash,
    profileId: binding.profileId,
    profileVersion: binding.profileVersion,
    profileFingerprint: binding.profileFingerprint,
    providerConfigurationFingerprint: binding.providerConfigurationFingerprint,
    privacyPolicyId: binding.privacyPolicyId,
    jurisdiction: binding.jurisdiction,
    privacyPolicyVersion: binding.privacyPolicyVersion,
    privacyPolicyFingerprint: binding.privacyPolicyFingerprint,
    persistentTranscript: binding.persistentTranscript,
  })}`;
}

export function issueTextPreviewStateToken(
  payload: TextPreviewStatePayload,
  secret: string,
  now = new Date(),
): string {
  const key = parseSecret(secret);
  const checked = parsePayload(payload, now.getTime());
  const payloadJson = canonicalJson(checked);
  if (Buffer.byteLength(payloadJson, "utf8") > MAX_STATE_PAYLOAD_BYTES) {
    throw new TextPreviewStateTokenError("state_token_invalid");
  }
  const payloadSegment = Buffer.from(payloadJson, "utf8").toString("base64url");
  const signature = createHmac("sha256", key)
    .update(`${SIGNING_DOMAIN}${payloadSegment}`, "utf8")
    .digest("base64url");
  const token = `${TEXT_PREVIEW_STATE_TOKEN_VERSION}.${payloadSegment}.${signature}`;
  if (token.length > MAX_STATE_TOKEN_CHARS) {
    throw new TextPreviewStateTokenError("state_token_invalid");
  }
  return token;
}

export function verifyTextPreviewStateToken(
  token: unknown,
  secret: string,
  now = new Date(),
): TextPreviewStatePayload {
  const key = parseSecret(secret);
  if (typeof token !== "string" || token.length === 0 || token.length > MAX_STATE_TOKEN_CHARS) {
    throw new TextPreviewStateTokenError("state_token_invalid");
  }
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== TEXT_PREVIEW_STATE_TOKEN_VERSION) {
    throw new TextPreviewStateTokenError("state_token_invalid");
  }
  const payloadSegment = parts[1] ?? "";
  const signatureSegment = parts[2] ?? "";
  const payloadBytes = parseCanonicalBase64Url(payloadSegment);
  const signatureBytes = parseCanonicalBase64Url(signatureSegment);
  if (payloadBytes === null
    || signatureBytes === null
    || signatureBytes.length !== 32
    || payloadBytes.length > MAX_STATE_PAYLOAD_BYTES) {
    throw new TextPreviewStateTokenError("state_token_invalid");
  }
  const expected = createHmac("sha256", key)
    .update(`${SIGNING_DOMAIN}${payloadSegment}`, "utf8")
    .digest("base64url");
  if (!constantTimeEquals(signatureSegment, expected)) {
    throw new TextPreviewStateTokenError("state_token_invalid");
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(payloadBytes.toString("utf8"));
  } catch {
    throw new TextPreviewStateTokenError("state_token_invalid");
  }
  const parsed = parsePayload(decoded, now.getTime());
  if (canonicalJson(parsed) !== payloadBytes.toString("utf8")) {
    throw new TextPreviewStateTokenError("state_token_invalid");
  }
  return parsed;
}
