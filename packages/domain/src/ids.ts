import { randomBytes } from "node:crypto";

export const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_UUID_V7_TIMESTAMP = 0xffffffffffff;

declare const uuidV7Brand: unique symbol;

/** A lower-case, RFC 4122 variant UUIDv7 validated at a domain boundary. */
export type UuidV7 = string & { readonly [uuidV7Brand]: "UuidV7" };
export type TenantId = UuidV7 & { readonly tenantId: "TenantId" };
export type SessionId = UuidV7 & { readonly sessionId: "SessionId" };
export type ActorId = UuidV7 & { readonly actorId: "ActorId" };
export type CorrelationId = UuidV7 & { readonly correlationId: "CorrelationId" };

export class InvalidUuidV7Error extends Error {
  constructor(readonly field: string, readonly value: unknown) {
    super(`${field} must be a lower-case RFC UUIDv7`);
    this.name = "InvalidUuidV7Error";
  }
}

export function isUuidV7(value: unknown): value is UuidV7 {
  return typeof value === "string" && UUID_V7_PATTERN.test(value);
}

export function parseUuidV7(value: unknown, field = "id"): UuidV7 {
  if (!isUuidV7(value)) throw new InvalidUuidV7Error(field, value);
  return value;
}

export function parseTenantId(value: unknown): TenantId {
  return parseUuidV7(value, "tenant_id") as TenantId;
}

export function parseSessionId(value: unknown): SessionId {
  return parseUuidV7(value, "session_id") as SessionId;
}

export function parseActorId(value: unknown): ActorId {
  return parseUuidV7(value, "actor_id") as ActorId;
}

export function parseCorrelationId(value: unknown): CorrelationId {
  return parseUuidV7(value, "correlation_id") as CorrelationId;
}

/**
 * Build UUIDv7 deterministically from a millisecond timestamp and ten bytes of
 * entropy. Tests and provider fakes supply entropy explicitly; production code
 * uses createUuidV7, which gets entropy from the operating system.
 */
export function uuidV7FromParts(timestampMs: number, entropy: Uint8Array): UuidV7 {
  if (!Number.isSafeInteger(timestampMs) || timestampMs < 0 || timestampMs > MAX_UUID_V7_TIMESTAMP) {
    throw new RangeError("timestampMs must fit the UUIDv7 48-bit millisecond field");
  }
  if (entropy.byteLength !== 10) throw new RangeError("UUIDv7 entropy must contain exactly 10 bytes");

  const bytes = new Uint8Array(16);
  let timestamp = timestampMs;
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = timestamp & 0xff;
    timestamp = Math.floor(timestamp / 256);
  }
  bytes[6] = 0x70 | (entropy[0]! & 0x0f);
  bytes[7] = entropy[1]!;
  bytes[8] = 0x80 | (entropy[2]! & 0x3f);
  bytes.set(entropy.slice(3), 9);

  const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
  return parseUuidV7(
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`,
  );
}

export function createUuidV7(timestampMs = Date.now(), entropy = randomBytes(10)): UuidV7 {
  return uuidV7FromParts(timestampMs, entropy);
}

export function uuidV7Timestamp(value: UuidV7): number {
  const compact = value.replaceAll("-", "");
  return Number.parseInt(compact.slice(0, 12), 16);
}
