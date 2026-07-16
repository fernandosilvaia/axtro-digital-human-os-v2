import assert from "node:assert/strict";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../..", import.meta.url));
const proposal = await import(pathToFileURL(join(root, "packages/tool-adapters/proposal/dist/index.js")).href);

const TENANT_ALPHA = "018bcfe5-0000-7abc-8f01-020304050607";

function fakeCatalog({ templates = {}, catalogEntries = {}, receipts = {} } = {}) {
  return {
    getTemplate: (templateId) => templates[templateId],
    getCatalogEntry: (productId) => catalogEntries[productId],
    getReceipt: (receiptId) => receipts[receiptId],
  };
}

function activeTemplate(overrides = {}) {
  return { templateId: "standard-proposal", version: "1.0.0", requiredInputs: ["customer_name"], status: "active", ...overrides };
}

function activeCatalogEntry(overrides = {}) {
  return {
    productId: "enterprise-plan",
    displayName: "Enterprise Plan",
    unitPriceUsdMicros: 500_000_000,
    maxDiscountPercent: 10,
    validFromMs: 1_000,
    validToMs: null,
    ...overrides,
  };
}

function baseRequest(overrides = {}) {
  return {
    tenantId: TENANT_ALPHA,
    requesterActorId: "agent-1",
    templateId: "standard-proposal",
    inputs: { customer_name: "Acme Corp" },
    lineItems: [{ productId: "enterprise-plan", quantity: 1, discountPercent: 0 }],
    atMs: 5_000,
    ...overrides,
  };
}

test("preview: a valid request produces a dry-run preview priced from the catalog", () => {
  const catalog = fakeCatalog({ templates: { "standard-proposal": activeTemplate() }, catalogEntries: { "enterprise-plan": activeCatalogEntry() } });
  const port = proposal.createProposalPort(catalog);
  const result = port.generate(baseRequest());
  assert.equal(result.status, "preview_ready");
  assert.equal(result.preview.isDryRun, true);
  assert.equal(result.preview.lineItems[0].priceSource, "catalog");
  assert.equal(result.preview.totalUsdMicros, 500_000_000);
});

test("missing input: a template's required input that was never confirmed blocks preview generation", () => {
  const catalog = fakeCatalog({
    templates: { "standard-proposal": activeTemplate({ requiredInputs: ["customer_name", "decision_maker_name"] }) },
    catalogEntries: { "enterprise-plan": activeCatalogEntry() },
  });
  const port = proposal.createProposalPort(catalog);
  const result = port.generate(baseRequest());
  assert.equal(result.status, "missing_input");
  assert.deepEqual(result.missingInputs, ["decision_maker_name"]);
  assert.equal(result.preview, null);
});

test("stale catalog: a product whose catalog validity window has expired is rejected, not silently priced", () => {
  const catalog = fakeCatalog({
    templates: { "standard-proposal": activeTemplate() },
    catalogEntries: { "enterprise-plan": activeCatalogEntry({ validToMs: 2_000 }) },
  });
  const port = proposal.createProposalPort(catalog);
  const result = port.generate(baseRequest({ atMs: 5_000 }));
  assert.equal(result.status, "stale_catalog");
  assert.deepEqual(result.rejectedProductIds, ["enterprise-plan"]);
});

test("unauthorized discount: a requested discount above the catalog's ceiling is rejected", () => {
  const catalog = fakeCatalog({
    templates: { "standard-proposal": activeTemplate() },
    catalogEntries: { "enterprise-plan": activeCatalogEntry({ maxDiscountPercent: 10 }) },
  });
  const port = proposal.createProposalPort(catalog);
  const result = port.generate(baseRequest({ lineItems: [{ productId: "enterprise-plan", quantity: 1, discountPercent: 25 }] }));
  assert.equal(result.status, "unauthorized_discount");
  assert.deepEqual(result.rejectedProductIds, ["enterprise-plan"]);
});

test("an approved discount within the ceiling is applied to the line total", () => {
  const catalog = fakeCatalog({
    templates: { "standard-proposal": activeTemplate() },
    catalogEntries: { "enterprise-plan": activeCatalogEntry({ maxDiscountPercent: 10 }) },
  });
  const port = proposal.createProposalPort(catalog);
  const result = port.generate(baseRequest({ lineItems: [{ productId: "enterprise-plan", quantity: 2, discountPercent: 10 }] }));
  assert.equal(result.status, "preview_ready");
  assert.equal(result.preview.lineItems[0].unitPriceUsdMicros, 500_000_000);
  assert.equal(result.preview.lineItems[0].lineTotalUsdMicros, 900_000_000);
});

test("receipt pricing: a line item tied to a prior receipt is priced from the receipt, not the current catalog", () => {
  const catalog = fakeCatalog({
    templates: { "standard-proposal": activeTemplate() },
    catalogEntries: { "enterprise-plan": activeCatalogEntry({ unitPriceUsdMicros: 600_000_000, maxDiscountPercent: 15 }) },
    receipts: { "receipt-1": { receiptId: "receipt-1", productId: "enterprise-plan", unitPriceUsdMicros: 450_000_000 } },
  });
  const port = proposal.createProposalPort(catalog);
  const result = port.generate(baseRequest({ lineItems: [{ productId: "enterprise-plan", quantity: 1, discountPercent: 0, receiptId: "receipt-1" }] }));
  assert.equal(result.status, "preview_ready");
  assert.equal(result.preview.lineItems[0].priceSource, "receipt");
  assert.equal(result.preview.lineItems[0].unitPriceUsdMicros, 450_000_000);
});

test("a deprecated template is treated as unknown for new proposals", () => {
  const catalog = fakeCatalog({ templates: { "standard-proposal": activeTemplate({ status: "deprecated" }) }, catalogEntries: { "enterprise-plan": activeCatalogEntry() } });
  const port = proposal.createProposalPort(catalog);
  const result = port.generate(baseRequest());
  assert.equal(result.status, "unknown_template");
});

test("an unrecognized receipt id is rejected instead of silently falling back to the catalog price", () => {
  const catalog = fakeCatalog({ templates: { "standard-proposal": activeTemplate() }, catalogEntries: { "enterprise-plan": activeCatalogEntry() } });
  const port = proposal.createProposalPort(catalog);
  const result = port.generate(baseRequest({ lineItems: [{ productId: "enterprise-plan", quantity: 1, discountPercent: 0, receiptId: "does-not-exist" }] }));
  assert.equal(result.status, "unknown_receipt");
});

test("this adapter has no send capability at all", () => {
  const catalog = fakeCatalog({});
  const port = proposal.createProposalPort(catalog);
  assert.deepEqual(Object.keys(port), ["generate"]);
});
