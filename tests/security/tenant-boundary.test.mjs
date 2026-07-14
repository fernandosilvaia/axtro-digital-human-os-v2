import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import test from "node:test";

const root = fileURLToPath(new URL("../..", import.meta.url));
const database = await import(pathToFileURL(join(root, "packages/database/dist/index.js")).href);
const domain = await import(pathToFileURL(join(root, "packages/domain/dist/index.js")).href);

const tenantAlpha = domain.uuidV7FromParts(1_700_000_000_001, Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
const tenantBeta = domain.uuidV7FromParts(1_700_000_000_002, Uint8Array.from([11, 12, 13, 14, 15, 16, 17, 18, 19, 20]));

test("tenant cache and object namespaces cannot collide across tenants", () => {
  const alphaCache = database.createTenantCacheKey(tenantAlpha, "test", "sessions", ["session-1", "state"]);
  const betaCache = database.createTenantCacheKey(tenantBeta, "test", "sessions", ["session-1", "state"]);
  const alphaObject = database.createTenantObjectKey(tenantAlpha, "test", "recordings", ["session-1", "part-001.webm"]);
  const betaObject = database.createTenantObjectKey(tenantBeta, "test", "recordings", ["session-1", "part-001.webm"]);

  assert.notEqual(alphaCache, betaCache);
  assert.notEqual(alphaObject, betaObject);
  assert.match(alphaCache, new RegExp(`^test:tenant:${tenantAlpha}:cache:sessions:`));
  assert.equal(alphaObject.startsWith(`${tenantAlpha}/test/recordings/`), true);
  assert.equal(betaObject.startsWith(`${tenantBeta}/test/recordings/`), true);
});

test("tenant cache and object keys reject traversal, implicit tenant values, and hostile coercion", () => {
  for (const invalid of [
    ["not-a-tenant", "test", "sessions", ["state"]],
    [tenantAlpha, "Test", "sessions", ["state"]],
    [tenantAlpha, "test", "../sessions", ["state"]],
    [tenantAlpha, "test", "sessions", [".."]],
    [tenantAlpha, "test", "sessions", ["a/b"]],
    [tenantAlpha, "test", "sessions", []],
    [{ toString: () => tenantAlpha }, "test", "sessions", ["state"]],
  ]) {
    assert.throws(
      () => database.createTenantCacheKey(invalid[0], invalid[1], invalid[2], invalid[3]),
    );
    assert.throws(
      () => database.createTenantObjectKey(invalid[0], invalid[1], invalid[2], invalid[3]),
    );
  }
});
