import { createHash } from "node:crypto";

export class CanonicalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanonicalizationError";
  }
}

/**
 * Serializes the JSON-shaped authoritative state deterministically. Objects are
 * sorted recursively and arrays retain their semantic order, which makes the
 * result suitable for replay hashes without making a hash part of the state.
 */
export function canonicalJson(value: unknown): string {
  const serialized = JSON.stringify(canonicalize(value));
  if (serialized === undefined) throw new CanonicalizationError("value cannot be represented as canonical JSON");
  return serialized;
}

export function sha256Canonical(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

/** Freeze JSON-shaped values so reducer callers cannot mutate a returned snapshot. */
export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function canonicalize(value: unknown): null | boolean | number | string | Array<unknown> | Record<string, unknown> {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new CanonicalizationError("non-finite numbers are not permitted in authoritative state");
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => canonicalize(item));
  if (typeof value !== "object") {
    throw new CanonicalizationError(`unsupported canonical value type: ${typeof value}`);
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new CanonicalizationError("authoritative state must contain only plain objects");
  }

  const normalized: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    normalized[key] = canonicalize((value as Record<string, unknown>)[key]);
  }
  return normalized;
}
