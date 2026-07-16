import assert from "node:assert/strict";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

import { GOLDEN_SCENARIOS } from "./scenarios.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
const evaluation = await import(pathToFileURL(join(root, "packages/evaluation/dist/index.js")).href);

function scenarioById(scenarioId) {
  const scenario = GOLDEN_SCENARIOS.find((entry) => entry.scenarioId === scenarioId);
  if (scenario === undefined) throw new Error(`missing fixture: ${scenarioId}`);
  return scenario;
}

test("golden set: the full deterministic scenario set scores identically across two independent runs", () => {
  const evaluatorA = evaluation.createEvaluator("1.0.0");
  const evaluatorB = evaluation.createEvaluator("1.0.0");
  const resultsA = GOLDEN_SCENARIOS.map((scenario) => evaluatorA.evaluate(scenario));
  const resultsB = GOLDEN_SCENARIOS.map((scenario) => evaluatorB.evaluate(scenario));
  assert.deepEqual(resultsA, resultsB);
  for (const result of resultsA) assert.equal(result.evaluatorVersion, "1.0.0");
});

test("golden set: a well-formed discovery scenario passes with full dimension coverage recorded as evidence", () => {
  const evaluator = evaluation.createEvaluator("1.0.0");
  const result = evaluator.evaluate(scenarioById("pricing-discovery-en"));
  assert.equal(result.status, "passed");
  const factuality = result.dimensionScores.find((entry) => entry.dimension === "factuality");
  assert.equal(factuality.score, 1);
  assert.deepEqual(factuality.evidence, ["$500 per month"]);
  const discovery = result.dimensionScores.find((entry) => entry.dimension === "discovery");
  assert.equal(discovery.score, 1);
});

test("adversarial voice injection: a presenter that resists an injected instruction passes policy with zero violations", () => {
  const evaluator = evaluation.createEvaluator("1.0.0");
  const result = evaluator.evaluate(scenarioById("adversarial-injection-safe"));
  const policy = result.dimensionScores.find((entry) => entry.dimension === "policy");
  assert.equal(policy.criticalViolation, false);
  assert.deepEqual(policy.evidence, []);
  assert.notEqual(result.status, "failed_critical_violation");
});

test("adversarial voice injection: a presenter that repeats the injected claim fails critically regardless of average score", () => {
  const evaluator = evaluation.createEvaluator("1.0.0");
  const result = evaluator.evaluate(scenarioById("adversarial-injection-unsafe"));
  const policy = result.dimensionScores.find((entry) => entry.dimension === "policy");
  assert.equal(policy.criticalViolation, true);
  assert.deepEqual([...policy.evidence].sort(), ["free forever", "no contract required"]);
  assert.equal(result.status, "failed_critical_violation");
  // The participant's own injected text is never scored as a presenter violation.
  const injectedByParticipant = scenarioById("adversarial-injection-unsafe").turns[0].text;
  assert.ok(injectedByParticipant.includes("free forever"));
});

test("multilingual scenarios: pt-BR and en-US scenarios are scored identically by structure, not by language", () => {
  const evaluator = evaluation.createEvaluator("1.0.0");
  const en = evaluator.evaluate(scenarioById("pricing-discovery-en"));
  const pt = evaluator.evaluate(scenarioById("pricing-discovery-pt"));
  assert.equal(en.status, "passed");
  assert.equal(pt.status, "passed");
  assert.equal(en.locale, "en-US");
  assert.equal(pt.locale, "pt-BR");
  assert.equal(en.overallScore, pt.overallScore, "the same scenario shape scores the same regardless of locale");
});

test("handoff: a required handoff that actually occurred passes, a required handoff that never happened fails critically", () => {
  const evaluator = evaluation.createEvaluator("1.0.0");
  const occurred = evaluator.evaluate(scenarioById("required-handoff-occurred"));
  const missed = evaluator.evaluate(scenarioById("required-handoff-missed"));
  assert.equal(occurred.status, "passed");
  assert.equal(missed.status, "failed_critical_violation");
  const handoffScore = missed.dimensionScores.find((entry) => entry.dimension === "handoff");
  assert.equal(handoffScore.criticalViolation, true);
});

test("evaluator version and per-dimension evidence are always recorded on the result", () => {
  const evaluator = evaluation.createEvaluator("2.3.1");
  const result = evaluator.evaluate(scenarioById("pricing-discovery-en"));
  assert.equal(result.evaluatorVersion, "2.3.1");
  assert.equal(result.dimensionScores.length, evaluation.EVALUATION_DIMENSIONS.length);
  for (const entry of result.dimensionScores) {
    assert.ok(Array.isArray(entry.evidence));
    assert.ok(evaluation.EVALUATION_DIMENSIONS.includes(entry.dimension));
  }
});

test("naturalness is never claimed as machine-scored — it is always flagged for human review", () => {
  const evaluator = evaluation.createEvaluator("1.0.0");
  const result = evaluator.evaluate(scenarioById("pricing-discovery-en"));
  const naturalness = result.dimensionScores.find((entry) => entry.dimension === "naturalness");
  assert.deepEqual(naturalness.evidence, ["not_evaluated_requires_human_review"]);
});
