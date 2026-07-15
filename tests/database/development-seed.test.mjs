import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../..", import.meta.url));
const domain = await import(pathToFileURL(join(root, "packages/domain/dist/index.js")).href);
const seedPath = join(root, "database/seeds/tenant_zero_development.sql");
const fixturePath = join(root, "tests/fixtures/development-tenant-zero.json");
const seedScriptPath = join(root, "scripts/development-seed.mjs");

test("development tenant-zero fixture is deterministic, fake-only, and free of customer data", () => {
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
  assert.equal(fixture.fixture_version, "1.0.0");
  assert.deepEqual(fixture.tenants.map((tenant) => tenant.slug), ["tenant-zero-alpha", "tenant-zero-beta"]);
  assert.equal(new Set(fixture.tenants.map((tenant) => tenant.id)).size, 2);
  for (const tenant of fixture.tenants) assert.equal(domain.parseTenantId(tenant.id), tenant.id);
  assert.deepEqual(fixture.provider_ids, ["fake-realtime", "fake-catalog"]);
  assert.deepEqual(fixture.constraints, {
    uses_only_fake_providers: true,
    contains_customer_pii: false,
    contains_real_credentials: false,
  });
});

test("development seed is transactionally idempotent and contains only the fixed fake composition", () => {
  const source = readFileSync(seedPath, "utf8");
  assert.match(source, /^-- Development-only deterministic seed/m);
  assert.match(source, /BEGIN;/);
  assert.match(source, /COMMIT;/);
  assert.equal((source.match(/ON CONFLICT \(tenant_id, id\) DO NOTHING;/g) ?? []).length, 6);
  assert.match(source, /DO \$\$/);
  assert.match(source, /tenant-zero seed composition diverged/);
  assert.match(source, /'fake-realtime'/);
  assert.match(source, /'fake-catalog'/);
  assert.doesNotMatch(source, /'fake-(?:avatar|meeting)'/);
  assert.doesNotMatch(source, /INSERT INTO (?:contact_profiles|sessions|conversation_turns|knowledge_sources)/);
  assert.deepEqual(
    [...new Set([...source.matchAll(/'(ref_fake_[a-z0-9_]+)'/g)].map((match) => match[1]))].sort(),
    [
      "ref_fake_tenant_zero_alpha_catalog",
      "ref_fake_tenant_zero_alpha_realtime",
      "ref_fake_tenant_zero_beta_catalog",
      "ref_fake_tenant_zero_beta_realtime",
    ],
  );
  assert.doesNotMatch(source, /https?:\/\//i);
  assert.doesNotMatch(source, /(?:openai|tavus|liveavatar|recall|livekit|telnyx|stripe|supabase|vercel|railway|doppler)/i);
  assert.doesNotMatch(source, /@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
});

test("development seed command fails closed before invoking psql without explicit local authorization", () => {
  const result = runSeedCommand({});
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /DEVELOPMENT SEED FAILED: AXTRO_LOCAL_DATABASE_URL requires/);
  assert.doesNotMatch(result.stderr, /postgresql:\/\//i);
});

test("development seed command rejects remote, credentialed, and query-bearing URLs before psql", () => {
  for (const databaseUrl of [
    "postgresql://postgres@database.example.test/axtro_seed",
    "postgresql://postgres:password@127.0.0.1:54329/axtro_seed",
    "postgresql://postgres@127.0.0.1:54329/axtro_seed?sslmode=require",
  ]) {
    const result = runSeedCommand({
      AXTRO_ALLOW_LOCAL_DATABASE_URL: "1",
      AXTRO_LOCAL_DATABASE_URL: databaseUrl,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /DEVELOPMENT SEED FAILED: Database URL must be a password-free local PostgreSQL endpoint/);
    assert.doesNotMatch(result.stdout, /DEVELOPMENT SEED APPLIED/);
  }
});

function runSeedCommand(environment) {
  return spawnSync(process.execPath, [seedScriptPath], {
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", ...environment },
  });
}
