import assert from "node:assert/strict";
import { test } from "node:test";

const secret = await import("../../apps/portal/src/lib/brain/secret.ts");

test("generateBrainSecret returns a 64-char lowercase hex string (32 random bytes)", () => {
  const raw = secret.generateBrainSecret();
  assert.equal(raw.length, 64);
  assert.match(raw, /^[a-f0-9]{64}$/);
});

test("generateBrainSecret never repeats across calls", () => {
  const values = new Set(Array.from({ length: 20 }, () => secret.generateBrainSecret()));
  assert.equal(values.size, 20);
});

test("hashBrainSecret is deterministic for the same input", () => {
  const raw = secret.generateBrainSecret();
  assert.equal(secret.hashBrainSecret(raw), secret.hashBrainSecret(raw));
});

test("hashBrainSecret produces different hashes for different inputs", () => {
  const a = secret.hashBrainSecret("secret-a");
  const b = secret.hashBrainSecret("secret-b");
  assert.notEqual(a, b);
});

test("hashBrainSecret output matches the sha256 hex format the migration's CHECK constraint expects", () => {
  const hash = secret.hashBrainSecret(secret.generateBrainSecret());
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.ok(secret.isValidBrainSecretHash(hash));
});

test("hashBrainSecret rejects an empty or non-string input", () => {
  for (const bad of ["", null, undefined, 123]) {
    assert.throws(() => secret.hashBrainSecret(bad));
  }
});

test("isValidBrainSecretHash rejects malformed hashes", () => {
  for (const bad of ["", "not-hex", "a".repeat(63), "a".repeat(65), "A".repeat(64), null, 42]) {
    assert.equal(secret.isValidBrainSecretHash(bad), false);
  }
});
