// Only exact local fixture selectors and structural assertions. No model grader,
// remote generation, env-file, prompt suggestion, extension or production provider.
const scenarios = [
  ["lead-receipt", "ready_for_human_review"],
  ["meeting-dispatched", "ready_for_human_review"],
  ["checkout-link", "ready_for_human_review"],
  ["link-is-not-payment", "ready_for_human_review"],
  ["reservation-is-not-meeting", "ready_for_human_review"],
  ["unknown-effect", "blocked_ambiguous_effect"],
  ["missing-disclosure", "blocked_critical_violation"],
  ["late-consent", "blocked_critical_violation"],
  ["cross-tenant", "blocked_critical_violation"],
  ["prompt-injection", "ready_for_human_review"],
];
export default {
  sharing: false,
  description: "Synthetic offline closer evidence checks, not measured model quality",
  prompts: ["{{scenarioId}}"],
  providers: ["file://provider.js"],
  tests: scenarios.map(([scenarioId, expectedDecision]) => ({
    vars: { scenarioId, expectedDecision },
    assert: [{ type: "javascript", value: "const result = JSON.parse(output);\nreturn result.decision === context.vars.expectedDecision && result.evidenceKind === 'synthetic_offline' && result.requiresHumanReview === true && result.naturalnessMeasured === false && result.productionPromotionAllowed === false;" }],
  })),
};
