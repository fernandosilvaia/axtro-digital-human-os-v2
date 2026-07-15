import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../..", import.meta.url));
const salesCloser = await import(pathToFileURL(join(root, "packages/role-packs/sales-closer/dist/index.js")).href);
const domain = await import(pathToFileURL(join(root, "packages/domain/dist/index.js")).href);
const events = JSON.parse(readFileSync(join(root, "tests/fixtures/reducers/walking-sequence.json"), "utf8"));

const TENANT_ALPHA = "018bcfe5-0000-7abc-8f01-020304050607";
const TENANT_BETA = "018bcfe5-0001-7abc-8f01-020304050608";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function salesInstalledEvent(state, aggregateVersion, eventId) {
  return {
    ...clone(events[3]),
    event_id: eventId,
    event_type: "sales.installed",
    aggregate_version: aggregateVersion,
    occurred_at: "2026-07-15T12:00:00.000Z",
    payload: { state },
  };
}

function salesUninstalledEvent(aggregateVersion, eventId) {
  return {
    ...clone(events[3]),
    event_id: eventId,
    event_type: "sales.uninstalled",
    aggregate_version: aggregateVersion,
    occurred_at: "2026-07-15T12:00:01.000Z",
    payload: {},
  };
}

test("manifest: the Sales Closer manifest is schema-valid and matches the frozen contract example", () => {
  const manifest = salesCloser.parseRolePackManifest(salesCloser.SALES_CLOSER_MANIFEST);
  assert.equal(manifest.role_pack_id, "sales-closer");
  assert.equal(manifest.status, "active");
  assert.ok(manifest.required_disclosures.includes("ai_identity"));

  const fixture = JSON.parse(readFileSync(join(root, "contracts/examples/valid/role_pack_manifest.json"), "utf8"));
  const parsedFixture = salesCloser.parseRolePackManifest(fixture);
  assert.equal(parsedFixture.role_pack_id, "sales-closer");
});

test("manifest: an unknown field or invalid status is rejected", () => {
  assert.throws(
    () => salesCloser.parseRolePackManifest({ ...salesCloser.SALES_CLOSER_MANIFEST, extra_field: "x" }),
    salesCloser.RolePackManifestError,
  );
  assert.throws(
    () => salesCloser.parseRolePackManifest({ ...salesCloser.SALES_CLOSER_MANIFEST, status: "not_a_status" }),
    salesCloser.RolePackManifestError,
  );
});

test("state extension: initial state seeds every qualification dimension as unknown", () => {
  const state = salesCloser.createInitialSalesState("consultative");
  assert.equal(state.funnel_stage, "opening");
  assert.equal(state.qualification.length, salesCloser.QUALIFICATION_DIMENSIONS.length);
  assert.ok(state.qualification.every((dimension) => dimension.status === "unknown"));
  assert.equal(state.proposal_status, "not_started");
});

test("state extension: applySalesUpdate merges a partial change and rejects updates past a closed deal", () => {
  const initial = salesCloser.createInitialSalesState("consultative");
  const advanced = salesCloser.applySalesUpdate(initial, { funnel_stage: "discovery", next_step: "Send a follow-up email" });
  assert.equal(advanced.funnel_stage, "discovery");
  assert.equal(advanced.next_step, "Send a follow-up email");
  assert.equal(advanced.methodology, "consultative", "unrelated fields are preserved");

  const closed = salesCloser.applySalesUpdate(advanced, { funnel_stage: "closed_won" });
  assert.throws(() => salesCloser.applySalesUpdate(closed, { funnel_stage: "discovery" }), salesCloser.SalesStateError);
});

test("install/uninstall: the pack's state helpers wire through the real domain reducer end to end", () => {
  const prelude = clone(events.slice(0, 5));
  const initial = salesCloser.createInitialSalesState("consultative");
  const install = salesInstalledEvent(initial, 6, "018bcfe5-6910-7abc-bf01-020304050607");
  const afterInstall = domain.replayInteraction([...prelude, install]);
  assert.equal(afterInstall.extensions.sales?.funnel_stage, "opening");

  const uninstall = salesUninstalledEvent(7, "018bcfe5-6911-7abc-bf01-020304050607");
  const afterUninstall = domain.replayInteraction([...prelude, install, uninstall]);
  assert.equal("sales" in afterUninstall.extensions, false);
});

test("install/uninstall: generic session tests pass without the pack installed at all", () => {
  const withoutPack = domain.replayInteraction(clone(events));
  assert.equal("sales" in withoutPack.extensions, false);
  assert.equal(withoutPack.session.status, "active");
});

test("tenant registry: a pack must be installed globally before any tenant can enable it", () => {
  const registry = salesCloser.createTenantRolePackRegistry();
  assert.throws(() => registry.enableForTenant(TENANT_ALPHA, "sales-closer"), salesCloser.RolePackRegistryError);
  registry.installPack(salesCloser.SALES_CLOSER_MANIFEST);
  assert.equal(registry.isInstalled("sales-closer"), true);
  registry.enableForTenant(TENANT_ALPHA, "sales-closer");
  assert.equal(registry.isEnabledForTenant(TENANT_ALPHA, "sales-closer"), true);
});

test("tenant registry: enablement is per tenant and disabling one tenant never affects another", () => {
  const registry = salesCloser.createTenantRolePackRegistry();
  registry.installPack(salesCloser.SALES_CLOSER_MANIFEST);
  registry.enableForTenant(TENANT_ALPHA, "sales-closer");
  registry.enableForTenant(TENANT_BETA, "sales-closer");

  registry.disableForTenant(TENANT_ALPHA, "sales-closer");
  assert.equal(registry.isEnabledForTenant(TENANT_ALPHA, "sales-closer"), false);
  assert.equal(registry.isEnabledForTenant(TENANT_BETA, "sales-closer"), true, "tenant isolation: beta is unaffected by alpha's removal");
  assert.deepEqual(registry.listEnabledForTenant(TENANT_ALPHA), []);
  assert.deepEqual(registry.listEnabledForTenant(TENANT_BETA), ["sales-closer"]);
});

test("tenant registry: disabling a pack that was never enabled for that tenant is rejected, not a silent no-op", () => {
  const registry = salesCloser.createTenantRolePackRegistry();
  registry.installPack(salesCloser.SALES_CLOSER_MANIFEST);
  assert.throws(() => registry.disableForTenant(TENANT_ALPHA, "sales-closer"), salesCloser.RolePackRegistryError);
});

test("tenant registry: a pack can be re-enabled for a tenant after being removed", () => {
  const registry = salesCloser.createTenantRolePackRegistry();
  registry.installPack(salesCloser.SALES_CLOSER_MANIFEST);
  registry.enableForTenant(TENANT_ALPHA, "sales-closer");
  registry.disableForTenant(TENANT_ALPHA, "sales-closer");
  registry.enableForTenant(TENANT_ALPHA, "sales-closer");
  assert.equal(registry.isEnabledForTenant(TENANT_ALPHA, "sales-closer"), true);
});
