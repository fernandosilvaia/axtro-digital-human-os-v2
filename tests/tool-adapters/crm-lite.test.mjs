import assert from "node:assert/strict";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../..", import.meta.url));
const crmLite = await import(pathToFileURL(join(root, "packages/tool-adapters/crm-lite/dist/index.js")).href);

const TENANT_ALPHA = "018bcfe5-0000-7abc-8f01-020304050607";

function fakeDataSource(records) {
  return {
    async fetch(recordType, recordRef) {
      const key = `${recordType}:${recordRef}`;
      return records[key] ?? null;
    },
  };
}

function leadRecord() {
  return {
    recordType: "lead",
    recordRef: "lead-1",
    fields: {
      company_name: "Acme Corp",
      stage: "qualification",
      owner_name: "Fernando",
      source: "inbound",
      contact_email: "buyer@acme.test",
      contact_phone: "+1-555-0100",
      notes: "Very interested, budget confirmed.",
    },
  };
}

function baseRequest(overrides = {}) {
  return {
    tenantId: TENANT_ALPHA,
    requesterActorId: "agent-1",
    purpose: "sales_qualification",
    recordType: "lead",
    recordRef: "lead-1",
    requestedFields: ["company_name", "stage"],
    deadlineMs: 200,
    ...overrides,
  };
}

test("read scope: non-PII fields are granted and audited for an ordinary purpose", async () => {
  const port = crmLite.createCrmLiteReadPort(fakeDataSource({ "lead:lead-1": leadRecord() }));
  const result = await port.read(baseRequest());
  assert.equal(result.status, "completed");
  assert.deepEqual(result.fields, { company_name: "Acme Corp", stage: "qualification" });
  assert.deepEqual(result.deniedFields, []);

  const audit = port.auditLog(TENANT_ALPHA);
  assert.equal(audit.length, 1);
  assert.equal(audit[0].status, "completed");
  assert.deepEqual(audit[0].grantedFields, ["company_name", "stage"]);
});

test("PII denial: a purpose without PII clearance never receives contact fields", async () => {
  const port = crmLite.createCrmLiteReadPort(fakeDataSource({ "lead:lead-1": leadRecord() }));
  const result = await port.read(baseRequest({ requestedFields: ["contact_email", "contact_phone"] }));
  assert.equal(result.status, "denied_pii_purpose");
  assert.equal(result.fields, null);
  assert.deepEqual([...result.deniedFields].sort(), ["contact_email", "contact_phone"]);
});

test("PII allowed: proposal_preparation and handoff_context purposes can see PII fields", async () => {
  const port = crmLite.createCrmLiteReadPort(fakeDataSource({ "lead:lead-1": leadRecord() }));
  const result = await port.read(baseRequest({ purpose: "proposal_preparation", requestedFields: ["contact_email"] }));
  assert.equal(result.status, "completed");
  assert.equal(result.fields.contact_email, "buyer@acme.test");
});

test("mixed request: non-PII fields are still granted even when PII fields in the same request are denied", async () => {
  const port = crmLite.createCrmLiteReadPort(fakeDataSource({ "lead:lead-1": leadRecord() }));
  const result = await port.read(baseRequest({ requestedFields: ["company_name", "contact_email"] }));
  assert.equal(result.status, "completed");
  assert.deepEqual(result.fields, { company_name: "Acme Corp" });
  assert.deepEqual(result.deniedFields, ["contact_email"]);
});

test("provider timeout: a slow data source is released at the adapter's own deadline, never blocking the caller", async () => {
  const neverResolves = { fetch: () => new Promise(() => {}) };
  const port = crmLite.createCrmLiteReadPort(neverResolves);
  const startedAtMs = Date.now();
  const result = await port.read(baseRequest({ deadlineMs: 30 }));
  assert.equal(result.status, "timeout");
  assert.equal(result.fields, null);
  assert.ok(Date.now() - startedAtMs < 500);

  const audit = port.auditLog(TENANT_ALPHA);
  assert.equal(audit[0].status, "timeout");
});

test("not found: an unknown record is reported distinctly from a denied one", async () => {
  const port = crmLite.createCrmLiteReadPort(fakeDataSource({}));
  const result = await port.read(baseRequest({ recordRef: "does-not-exist" }));
  assert.equal(result.status, "not_found");
});

test("unknown field: a requested field outside the known schema is denied, never silently invented", async () => {
  const port = crmLite.createCrmLiteReadPort(fakeDataSource({ "lead:lead-1": leadRecord() }));
  const result = await port.read(baseRequest({ requestedFields: ["favorite_color"] }));
  assert.equal(result.status, "denied_unknown_field");
  assert.deepEqual(result.deniedFields, ["favorite_color"]);
});

test("opportunity records use their own field schema, independent of lead fields", async () => {
  const opportunity = {
    recordType: "opportunity",
    recordRef: "opp-1",
    fields: { account_name: "Acme Corp", stage: "proposal", amount_usd: 50_000, decision_maker_email: "cfo@acme.test" },
  };
  const port = crmLite.createCrmLiteReadPort(fakeDataSource({ "opportunity:opp-1": opportunity }));
  const result = await port.read(baseRequest({
    recordType: "opportunity",
    recordRef: "opp-1",
    requestedFields: ["account_name", "amount_usd"],
  }));
  assert.equal(result.status, "completed");
  assert.deepEqual(result.fields, { account_name: "Acme Corp", amount_usd: 50_000 });
});

test("write capability does not exist on this adapter's surface at all", () => {
  const port = crmLite.createCrmLiteReadPort(fakeDataSource({}));
  const methods = Object.keys(port);
  assert.deepEqual(methods.sort(), ["auditLog", "read"]);
  for (const method of methods) assert.ok(!/write|update|delete|create/i.test(method));
});

test("audit log is tenant-scoped and never leaks another tenant's reads", async () => {
  const TENANT_BETA = "018bcfe5-0001-7abc-8f01-020304050608";
  const port = crmLite.createCrmLiteReadPort(fakeDataSource({ "lead:lead-1": leadRecord() }));
  await port.read(baseRequest());
  assert.equal(port.auditLog(TENANT_ALPHA).length, 1);
  assert.equal(port.auditLog(TENANT_BETA).length, 0);
});
