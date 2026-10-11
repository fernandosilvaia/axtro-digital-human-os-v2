import assert from "node:assert/strict";
import { test } from "node:test";

const { estimateCoverageNeed, coverageNeedToolOutput, roundGapForSpeech } = await import("../../apps/portal/src/lib/insurance/coverage-need.ts");

test("DIME adds debts, income times years, mortgage, education and final expenses, minus what already exists", () => {
  const result = estimateCoverageNeed({
    annualIncome: 50_000, yearsOfIncome: 10, debts: 20_000, mortgageBalance: 200_000,
    educationFund: 0, finalExpenses: 0, existingCoverage: 100_000, liquidSavings: 0,
  });
  assert.equal(result.outcome, "estimated");
  assert.deepEqual({ ...result.components }, { debts: 20_000, income: 500_000, mortgage: 200_000, education: 0, finalExpenses: 0 });
  assert.equal(result.totalNeed, 720_000);
  assert.equal(result.gap, 620_000);
  assert.equal(result.roundedGap, 620_000);
});

test("a small real gap is never spoken as zero", () => {
  const small = estimateCoverageNeed({ debts: 100_000, existingCoverage: 98_500 });
  assert.equal(small.gap, 1_500);
  assert.equal(small.roundedGap, 1_500);
  assert.match(coverageNeedToolOutput(small), /gap of about \$1,500\./);
  assert.equal(roundGapForSpeech(0), 0);
  assert.equal(roundGapForSpeech(640), 640);
  assert.equal(roundGapForSpeech(7_449), 7_400);
  assert.equal(roundGapForSpeech(10_001), 10_000);
  assert.equal(roundGapForSpeech(12_600), 13_000);
  assert.equal(roundGapForSpeech(347_400), 345_000);
  for (let gap = 1; gap < 200_000; gap += 997) assert.ok(roundGapForSpeech(gap) > 0, `gap ${gap}`);
});

test("existing coverage above the need is no gap, not a negative one", () => {
  const covered = estimateCoverageNeed({ finalExpenses: 15_000, existingCoverage: 25_000 });
  assert.equal(covered.gap, 0);
  assert.equal(covered.roundedGap, 0);
});

test("income without years, or nothing to add up, asks instead of guessing", () => {
  assert.equal(estimateCoverageNeed({ annualIncome: 80_000 }).outcome, "insufficient_data");
  assert.equal(estimateCoverageNeed({ existingCoverage: 50_000 }).outcome, "insufficient_data");
  assert.match(coverageNeedToolOutput(estimateCoverageNeed({})), /not calculated \(insufficient_data\)/);
});

test("arguments from the model are untrusted and validated field by field", () => {
  for (const input of [null, "50000", [1], { debts: -1 }, { debts: "1000" }, { debts: Number.NaN }, { debts: 1e12 }, { annualIncome: 1, yearsOfIncome: 2.5 }, { annualIncome: 1, yearsOfIncome: 41 }]) {
    assert.equal(estimateCoverageNeed(input).outcome, "invalid_input", JSON.stringify(input));
  }
  assert.equal(estimateCoverageNeed({ debts: 1000.6 }).components.debts, 1001);
});

test("the text returned to the persona is always framed as an educational estimate", () => {
  const output = coverageNeedToolOutput(estimateCoverageNeed({ annualIncome: 60_000, yearsOfIncome: 5, finalExpenses: 12_000 }));
  assert.match(output, /^Educational estimate \(DIME method\), not a quote or a recommendation:/);
  assert.match(output, /licensed agent/);
  assert.ok(!output.includes("\u2014"));
});
