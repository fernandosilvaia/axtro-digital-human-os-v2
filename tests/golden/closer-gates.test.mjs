import assert from "node:assert/strict";
import test from "node:test";
import { createEvaluator, EvaluationError, generatePilotGateReport, PilotGateError } from "../../packages/evaluation/dist/index.js";
import { scenarioEntry, receiptInput } from "../../experiments/closer-lab/fixtures.mjs";

function pilotCall() { return { callId: "synthetic-call", tenantId: receiptInput().tenantId, channel: "text", evaluation: scenarioEntry("fixture", receiptInput()).evaluation, estimatedCostUsdMicros: 10, providerReportedCostUsdMicros: 12, tenancyViolationDetected: false, resolved: false }; }
for (const passThreshold of [NaN, Infinity, -Infinity, -0.01, 1.01, "0.7", null]) test(`invalid pass threshold rejects ${String(passThreshold)}`, () => {
  assert.throws(() => createEvaluator("2.0.0", { passThreshold }), EvaluationError);
});
test("naturalness does not inflate a score or claim automated quality", () => {
  const result = createEvaluator("2.0.0", { passThreshold: 0.45 }).evaluate({ scenarioId: "low-measured", locale: "en", turns: [{ role: "presenter", text: "oversized turn" }], expectedFacts: ["missing"], prohibitedClaims: [], maxPresenterTurnChars: 1, requiresHandoff: false, handoffOccurred: false, expectedQualificationDimensions: ["budget"], qualificationDimensionsCovered: [] });
  assert.equal(result.overallScore, 0.4); assert.equal(result.status, "failed_low_score");
  assert.deepEqual(result.dimensionScores.find((item) => item.dimension === "naturalness").evidence, ["not_evaluated_requires_human_review"]);
});
test("versioned legacy average remains reproducible and cannot mix with version 2", () => {
  const scenario = { scenarioId: "legacy", locale: "en", turns: [{ role: "presenter", text: "oversized turn" }], expectedFacts: ["missing"], prohibitedClaims: [], maxPresenterTurnChars: 1, requiresHandoff: false, handoffOccurred: false, expectedQualificationDimensions: ["budget"], qualificationDimensionsCovered: [] };
  const legacy = createEvaluator("1.0.0").evaluate(scenario);
  const measured = createEvaluator("2.0.0").evaluate(scenario);
  assert.equal(legacy.overallScore, 0.5); assert.equal(measured.overallScore, 0.4);
  assert.equal(generatePilotGateReport([{ ...pilotCall(), evaluation: legacy }]).requiresHumanApprovalForCustomerBeta, true);
});
for (const [label, change] of [
  ["invented status", (v) => { v.evaluation.status = "approved"; }],
  ["NaN score", (v) => { v.evaluation.overallScore = NaN; }],
  ["infinite score", (v) => { v.evaluation.overallScore = Infinity; }],
  ["out of range score", (v) => { v.evaluation.overallScore = 1.1; }],
  ["empty scorecard", (v) => { v.evaluation.dimensionScores = []; }],
  ["NaN dimension", (v) => { v.evaluation.dimensionScores[0].score = NaN; }],
  ["invented dimension", (v) => { v.evaluation.dimensionScores[0].dimension = "payment"; }],
  ["duplicate dimension", (v) => { v.evaluation.dimensionScores[0].dimension = v.evaluation.dimensionScores[1].dimension; }],
  ["concealed critical flag", (v) => { v.evaluation.dimensionScores[0].criticalViolation = true; }],
  ["fabricated critical status", (v) => { v.evaluation.status = "failed_critical_violation"; }],
  ["fake average", (v) => { v.evaluation.overallScore = 0.8; }],
  ["fake human quality", (v) => { v.evaluation.dimensionScores.find((item) => item.dimension === "naturalness").evidence = ["human_quality_measured"]; }],
  ["invalid locale", (v) => { v.evaluation.locale = "invalid"; }],
  ["invalid version", (v) => { v.evaluation.evaluatorVersion = "latest"; }],
  ["unbounded evidence", (v) => { v.evaluation.dimensionScores[0].evidence = ["x".repeat(2001)]; }],
  ["NaN cost", (v) => { v.estimatedCostUsdMicros = NaN; }],
  ["infinite cost", (v) => { v.providerReportedCostUsdMicros = Infinity; }],
  ["negative cost", (v) => { v.providerReportedCostUsdMicros = -1; }],
  ["fractional micros", (v) => { v.estimatedCostUsdMicros = 0.5; }],
]) test(`pilot gate rejects ${label}`, () => {
  const value = structuredClone(pilotCall()); change(value);
  assert.throws(() => generatePilotGateReport([value]), PilotGateError);
});
test("cost aggregate cannot overflow safe integer precision", () => {
  const one = pilotCall(); one.estimatedCostUsdMicros = Number.MAX_SAFE_INTEGER;
  const two = { ...pilotCall(), callId: "another-call" };
  assert.throws(() => generatePilotGateReport([one, two]), PilotGateError);
});
