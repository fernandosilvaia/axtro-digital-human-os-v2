import { createHmac, timingSafeEqual } from "node:crypto";

import type { PortalPublicDemoSignedStatePayload } from "@axtro/contracts-ts";

import {
  isPublicDemoCommandName,
  isPublicDemoStep,
  isPublicDemoSurface,
  PUBLIC_DEMO_FIXTURE_VERSION,
} from "./fixture.ts";

export const PUBLIC_DEMO_STATE_SECRET_ENV = "PORTAL_PUBLIC_DEMO_STATE_SECRET" as const;
export const PUBLIC_DEMO_STATE_TOKEN_VERSION = "pdsv1" as const;
export const PUBLIC_DEMO_STATE_TTL_SECONDS = 15 * 60;
export const PUBLIC_DEMO_MAX_REVISION = 12;
export const PUBLIC_DEMO_MAX_COMMANDS = 12;

const PUBLIC_DEMO_STATE_TTL_MS = PUBLIC_DEMO_STATE_TTL_SECONDS * 1000;
const MAX_FUTURE_SKEW_MS = 5_000;
const MAX_STATE_PAYLOAD_BYTES = 2 * 1024;
const MAX_STATE_TOKEN_CHARS = 4 * 1024;
const SECRET_PATTERN = /^[0-9a-f]{64}$/;
const MIN_UNIQUE_SECRET_BYTES = 16;
const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SIGNING_DOMAIN = "axtro:portal-public-demo-state:v1\0";
const PAYLOAD_KEYS = Object.freeze([
  "schema_version",
  "demo_session_id",
  "fixture_version",
  "revision",
  "seen_commands",
  "surface",
  "step",
  "issued_at",
  "expires_at",
] as const);
const SEEN_COMMAND_KEYS = Object.freeze([
  "command_id",
  "expected_revision",
  "command",
] as const);

type PublicDemoSeenCommand = Readonly<PortalPublicDemoSignedStatePayload["seen_commands"][number]>;
export type PublicDemoSignedStatePayload = Readonly<
  Omit<PortalPublicDemoSignedStatePayload, "seen_commands"> & {
    seen_commands: readonly PublicDemoSeenCommand[];
  }
>;

export type PublicDemoStateTokenErrorCode =
  | "state_secret_invalid"
  | "state_token_invalid"
  | "state_token_expired";

export class PublicDemoStateTokenError extends Error {
  readonly code: PublicDemoStateTokenErrorCode;

  constructor(code: PublicDemoStateTokenErrorCode) {
    super(code);
    this.name = "PublicDemoStateTokenError";
    this.code = code;
  }
}

function ownDataRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== "string")) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of keys) {
      const descriptor = descriptors[String(key)];
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return null;
    }
    return value as Readonly<Record<string, unknown>>;
  } catch {
    return null;
  }
}

function hasExactKeys(value: Readonly<Record<string, unknown>>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}

function parseCanonicalTimestamp(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value
    ? milliseconds
    : null;
}

function parseNow(now: Date): number {
  const milliseconds = now.getTime();
  if (!Number.isFinite(milliseconds)) throw new PublicDemoStateTokenError("state_token_invalid");
  return milliseconds;
}

function parseSecret(secret: unknown): Buffer {
  if (!isPublicDemoStateSecretConfigured(secret)) {
    throw new PublicDemoStateTokenError("state_secret_invalid");
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

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new PublicDemoStateTokenError("state_token_invalid");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const record = ownDataRecord(value);
  if (record === null) throw new PublicDemoStateTokenError("state_token_invalid");
  const entries = Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
  return `{${entries.join(",")}}`;
}

function parseSeenCommands(value: unknown): readonly PublicDemoSeenCommand[] | null {
  if (!Array.isArray(value) || value.length > PUBLIC_DEMO_MAX_COMMANDS) return null;
  try {
    const ids = new Set<string>();
    const commands = value.map((item, index) => {
      const command = ownDataRecord(item);
      if (command === null
        || !hasExactKeys(command, SEEN_COMMAND_KEYS)
        || typeof command.command_id !== "string"
        || !UUID_V7_PATTERN.test(command.command_id)
        || ids.has(command.command_id)
        || command.expected_revision !== index
        || !isPublicDemoCommandName(command.command)) return null;
      ids.add(command.command_id);
      return Object.freeze({
        command_id: command.command_id,
        expected_revision: index,
        command: command.command,
      });
    });
    return commands.some((command) => command === null)
      ? null
      : Object.freeze(commands as PublicDemoSeenCommand[]);
  } catch {
    return null;
  }
}

function parsePayload(value: unknown, nowMs: number): PublicDemoSignedStatePayload {
  const payload = ownDataRecord(value);
  if (!payload || !hasExactKeys(payload, PAYLOAD_KEYS)) {
    throw new PublicDemoStateTokenError("state_token_invalid");
  }
  const issuedAtMs = parseCanonicalTimestamp(payload.issued_at);
  const expiresAtMs = parseCanonicalTimestamp(payload.expires_at);
  const seenCommands = parseSeenCommands(payload.seen_commands);
  if (payload.schema_version !== "2.0.0"
    || typeof payload.demo_session_id !== "string"
    || !UUID_V7_PATTERN.test(payload.demo_session_id)
    || payload.fixture_version !== PUBLIC_DEMO_FIXTURE_VERSION
    || !Number.isInteger(payload.revision)
    || Number(payload.revision) < 0
    || Number(payload.revision) > PUBLIC_DEMO_MAX_REVISION
    || seenCommands === null
    || seenCommands.length !== Number(payload.revision)
    || !isPublicDemoSurface(payload.surface)
    || !isPublicDemoStep(payload.step)
    || issuedAtMs === null
    || expiresAtMs === null
    || issuedAtMs > nowMs + MAX_FUTURE_SKEW_MS
    || expiresAtMs <= issuedAtMs
    || expiresAtMs - issuedAtMs > PUBLIC_DEMO_STATE_TTL_MS) {
    throw new PublicDemoStateTokenError("state_token_invalid");
  }
  if (expiresAtMs <= nowMs) throw new PublicDemoStateTokenError("state_token_expired");
  return Object.freeze({
    schema_version: "2.0.0",
    demo_session_id: payload.demo_session_id,
    fixture_version: PUBLIC_DEMO_FIXTURE_VERSION,
    revision: Number(payload.revision),
    seen_commands: seenCommands,
    surface: payload.surface,
    step: payload.step,
    issued_at: payload.issued_at as string,
    expires_at: payload.expires_at as string,
  });
}

export function isPublicDemoUuidV7(value: unknown): value is string {
  return typeof value === "string" && UUID_V7_PATTERN.test(value);
}

export function isPublicDemoStateSecretConfigured(value: unknown): value is string {
  if (typeof value !== "string" || !SECRET_PATTERN.test(value)) return false;
  const bytes = Buffer.from(value, "hex");
  return new Set(bytes).size >= MIN_UNIQUE_SECRET_BYTES;
}

export function createInitialPublicDemoState(
  demoSessionId: string,
  now = new Date(),
): PublicDemoSignedStatePayload {
  if (!isPublicDemoUuidV7(demoSessionId)) {
    throw new PublicDemoStateTokenError("state_token_invalid");
  }
  const nowMs = parseNow(now);
  return Object.freeze({
    schema_version: "2.0.0",
    demo_session_id: demoSessionId,
    fixture_version: PUBLIC_DEMO_FIXTURE_VERSION,
    revision: 0,
    seen_commands: Object.freeze([]),
    surface: "overview",
    step: "welcome",
    issued_at: new Date(nowMs).toISOString(),
    expires_at: new Date(nowMs + PUBLIC_DEMO_STATE_TTL_MS).toISOString(),
  });
}

export function issuePublicDemoStateToken(
  payload: PublicDemoSignedStatePayload,
  secret: string,
  now = new Date(),
): string {
  const key = parseSecret(secret);
  const checked = parsePayload(payload, parseNow(now));
  const payloadJson = canonicalJson(checked);
  if (Buffer.byteLength(payloadJson, "utf8") > MAX_STATE_PAYLOAD_BYTES) {
    throw new PublicDemoStateTokenError("state_token_invalid");
  }
  const payloadSegment = Buffer.from(payloadJson, "utf8").toString("base64url");
  const signatureSegment = createHmac("sha256", key)
    .update(`${SIGNING_DOMAIN}${payloadSegment}`, "utf8")
    .digest("base64url");
  const token = `${PUBLIC_DEMO_STATE_TOKEN_VERSION}.${payloadSegment}.${signatureSegment}`;
  if (token.length > MAX_STATE_TOKEN_CHARS) {
    throw new PublicDemoStateTokenError("state_token_invalid");
  }
  return token;
}

export function verifyPublicDemoStateToken(
  token: unknown,
  secret: string,
  now = new Date(),
): PublicDemoSignedStatePayload {
  const key = parseSecret(secret);
  const nowMs = parseNow(now);
  if (typeof token !== "string" || token.length === 0 || token.length > MAX_STATE_TOKEN_CHARS) {
    throw new PublicDemoStateTokenError("state_token_invalid");
  }
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== PUBLIC_DEMO_STATE_TOKEN_VERSION) {
    throw new PublicDemoStateTokenError("state_token_invalid");
  }
  const payloadSegment = parts[1] ?? "";
  const signatureSegment = parts[2] ?? "";
  const payloadBytes = parseCanonicalBase64Url(payloadSegment);
  const signatureBytes = parseCanonicalBase64Url(signatureSegment);
  if (payloadBytes === null
    || signatureBytes === null
    || signatureBytes.length !== 32
    || payloadBytes.length > MAX_STATE_PAYLOAD_BYTES) {
    throw new PublicDemoStateTokenError("state_token_invalid");
  }
  const expectedBytes = createHmac("sha256", key)
    .update(`${SIGNING_DOMAIN}${payloadSegment}`, "utf8")
    .digest();
  if (signatureBytes.length !== expectedBytes.length || !timingSafeEqual(signatureBytes, expectedBytes)) {
    throw new PublicDemoStateTokenError("state_token_invalid");
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(payloadBytes.toString("utf8"));
  } catch {
    throw new PublicDemoStateTokenError("state_token_invalid");
  }
  const payload = parsePayload(decoded, nowMs);
  if (canonicalJson(payload) !== payloadBytes.toString("utf8")) {
    throw new PublicDemoStateTokenError("state_token_invalid");
  }
  return payload;
}
