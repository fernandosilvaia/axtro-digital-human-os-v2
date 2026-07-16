import assert from "node:assert/strict";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../..", import.meta.url));
const ui = await import(pathToFileURL(join(root, "packages/ui/dist/index.js")).href);

const TENANT_ALPHA = "018bcfe5-0000-7abc-8f01-020304050607";
const TENANT_BETA = "018bcfe5-0001-7abc-8f01-020304050608";

function baseModel(overrides = {}) {
  return {
    tenantId: TENANT_ALPHA,
    sessionId: "session-1",
    citations: [{ citationLocator: "Pricing Guide#0", sourceId: "pricing-guide", excerptText: "Enterprise starts at $500/mo." }],
    hypotheses: [{ hypothesis_id: "hyp-1", label: "Customer seems price sensitive", status: "candidate", confidence_basis_points: 6000, expires_at: "2026-07-15T13:00:00.000Z", expired: false }],
    receipts: [{
      execution_id: "exec-1", intent_id: "intent-1", tool_contract_id: "catalog-read@1.0.0", action: "catalog.lookup",
      status: "succeeded", policy_outcome: "allow", confirmed_effect: true, effect_hash: "a".repeat(64), attempt: 1,
      started_at: "2026-07-15T12:00:00.000Z", completed_at: "2026-07-15T12:00:01.000Z",
    }],
    handoffs: [{ handoffId: "handoff-1", status: "accepted", targetHumanId: "human-1" }],
    costTotals: [{ source: "estimated", amount_usd_decimal: "0.02000000" }],
    evaluatorFindings: [{ scenarioId: "pricing-discovery-en", evaluatorVersion: "1.0.0", status: "passed", overallScoreBasisPoints: 9500 }],
    viewerHasPiiAccess: false,
    sensitiveFields: { contact_email: "buyer@acme.test" },
    ...overrides,
  };
}

test("permissions: rendering a model whose tenant differs from the authorized scope is rejected before any output", () => {
  const model = baseModel();
  assert.throws(() => ui.renderOpportunityReviewDocument(model, TENANT_BETA), ui.OpportunityReviewPermissionError);
});

test("permissions: the same tenant scope renders successfully", () => {
  const model = baseModel();
  const html = ui.renderOpportunityReviewDocument(model, TENANT_ALPHA);
  assert.ok(html.includes("session-1"));
});

test("redaction: sensitive fields never reach the HTML when the viewer lacks PII access", () => {
  const model = baseModel({ viewerHasPiiAccess: false });
  const html = ui.renderOpportunityReviewDocument(model, TENANT_ALPHA);
  assert.equal(html.includes("buyer@acme.test"), false);
  assert.equal(html.includes('data-pii-visible="false"'), true);
  assert.ok(html.includes("Sem permissão para exibir dados sensíveis"));
});

test("redaction: sensitive fields are rendered, escaped, only when the viewer has PII access", () => {
  const model = baseModel({ viewerHasPiiAccess: true });
  const html = ui.renderOpportunityReviewDocument(model, TENANT_ALPHA);
  assert.equal(html.includes("buyer@acme.test"), true);
  assert.equal(html.includes('data-pii-visible="true"'), true);
});

test("redaction: an attempted script injection inside any field is escaped, never executed as markup", () => {
  const model = baseModel({
    viewerHasPiiAccess: true,
    sensitiveFields: { notes: "<script>alert(1)</script>" },
    citations: [{ citationLocator: "src", sourceId: "s", excerptText: "<img src=x onerror=alert(1)>" }],
  });
  const html = ui.renderOpportunityReviewDocument(model, TENANT_ALPHA);
  assert.equal(html.includes("<script>"), false);
  assert.equal(html.includes("<img src=x"), false, "the injected tag is never live HTML, only escaped text");
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt;"));
});

test("accessibility: the document has a lang attribute, aria-labeled sections, and no inline script", () => {
  const model = baseModel();
  const html = ui.renderOpportunityReviewDocument(model, TENANT_ALPHA);
  assert.ok(html.includes('<html lang="pt-BR">'));
  assert.ok(html.includes('aria-label="Revisão de oportunidade"'));
  assert.ok(html.includes('aria-label="Citações"'));
  assert.ok(html.includes('aria-label="Dados sensíveis"'));
  assert.equal(html.includes("<script"), false);
  assert.equal(html.includes("onclick="), false);
});

test("facts vs hypotheses vs suggestions: citations are always marked untrusted, hypotheses and receipts reuse the console's evidence labels", () => {
  const model = baseModel();
  const html = ui.renderOpportunityReviewDocument(model, TENANT_ALPHA);
  assert.ok(html.includes('data-trusted="false"'));
  assert.ok(html.includes("Conteúdo recuperado, não confiável"));
  assert.ok(html.includes("evidence-label--hypothesis"));
  assert.ok(html.includes("evidence-label--receipt"));
});

test("evaluator findings mark critical violations distinctly from passed or low-score results", () => {
  const model = baseModel({
    evaluatorFindings: [
      { scenarioId: "safe-scenario", evaluatorVersion: "1.0.0", status: "passed", overallScoreBasisPoints: 9000 },
      { scenarioId: "unsafe-scenario", evaluatorVersion: "1.0.0", status: "failed_critical_violation", overallScoreBasisPoints: 5000 },
    ],
  });
  const html = ui.renderOpportunityReviewDocument(model, TENANT_ALPHA);
  assert.ok(html.includes('data-critical="true"'));
  assert.ok(html.includes('data-critical="false"'));
});

test("a malformed view model (unknown field, wrong types) fails closed instead of rendering partial data", () => {
  assert.throws(() => ui.renderOpportunityReviewDocument({ ...baseModel(), extra: "field" }, TENANT_ALPHA), ui.OperationsConsoleRenderError);
  assert.throws(() => ui.renderOpportunityReviewDocument(baseModel({ viewerHasPiiAccess: "yes" }), TENANT_ALPHA), ui.OperationsConsoleRenderError);
});
