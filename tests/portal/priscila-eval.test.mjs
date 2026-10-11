import assert from "node:assert/strict";
import { test } from "node:test";

const run = await import("../../experiments/priscila-eval/run.mjs");
const { SCENARIOS } = await import("../../experiments/priscila-eval/scenarios.mjs");

test("the Priscila scenario bank is complete and unique", () => {
  assert.ok(SCENARIOS.length >= 12);
  assert.equal(new Set(SCENARIOS.map((scenario) => scenario.id)).size, SCENARIOS.length);
  for (const language of ["english", "spanish", "portuguese"]) {
    assert.ok(SCENARIOS.some((scenario) => scenario.language === language), `no ${language} scenario`);
  }
});

test("the deterministic graders pass every good reference and fail every bad one", () => {
  const report = run.offlineReport();
  for (const entry of report.references) {
    assert.deepEqual(entry.good, [], `${entry.id}: the good reference was failed by ${entry.good.join(", ")}`);
    assert.ok(entry.bad.length > 0, `${entry.id}: the bad reference was not caught`);
  }
  for (const [language, size] of Object.entries(report.promptSizes)) {
    assert.ok(size <= 14_000, `${language} prompt is ${size} chars`);
  }
});
