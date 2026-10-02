import assert from "node:assert/strict";
import test from "node:test";
import { sha256Canonical } from "../../packages/domain/dist/index.js";
import { projectCloserReceiptEvidence, ReceiptEvidenceError, compareCloserCandidates, CloserComparisonError } from "../../packages/evaluation/dist/index.js";
import { receiptInput, IDS, buildCorpus, scenarioEntry } from "../../experiments/closer-lab/fixtures.mjs";

function result(input, value) {
  input.receipts[0].result_json = JSON.stringify(value);
  input.receipts[0].effect_hash = sha256Canonical(value);
}
test("commercial milestones use canonical joined receipts and never expose raw data", () => {
  const proof = projectCloserReceiptEvidence(receiptInput());
  assert.deepEqual(proof.confirmedMilestones, ["lead_registered"]);
  assert.equal(proof.aiDisclosureDelivered, true);
  assert.deepEqual(proof.activeConsentTypes, ["essential_processing"]);
  assert.equal(proof.paymentEvidenceAvailable, false);
  const serialized = JSON.stringify(proof);
  for (const forbidden of [IDS.tenant, IDS.session, IDS.entity, "synthetic-participant", "result_json", "contactEmail", "https://"]) assert.equal(serialized.includes(forbidden), false);
});
test("meeting dispatch, checkout link and payment are distinct", () => {
  const corpus = buildCorpus();
  for (const [id, expected] of [["meeting-dispatched", "meeting_confirmed"], ["checkout-link", "checkout_link_created"]]) {
    const input = corpus.candidate.find((item) => item.scenarioId === id).evidenceInput;
    assert.deepEqual(projectCloserReceiptEvidence(input).confirmedMilestones, [expected]);
  }
  assert.deepEqual(projectCloserReceiptEvidence(corpus.candidate.find((item) => item.scenarioId === "reservation-is-not-meeting").evidenceInput).confirmedMilestones, []);
  const report = compareCloserCandidates({ ...corpus, baseline: [corpus.baseline[3]], candidate: [corpus.candidate[3]] });
  assert.ok(report.scenarios[0].baselineCritical.includes("unsupported_completion:payment_confirmed"));
  assert.equal(report.decision, "ready_for_human_review");
  assert.equal(report.productionPromotionAllowed, false);
});
test("canonical pending approval and replayed reservation do not prove commercial completion", () => {
  const pending = receiptInput("request_checkout", { outcome: "pending_approval", code: "pending_approval", reservationId: IDS.entity, receiptId: IDS.receipt, approvalExpiresAt: "2026-10-01T12:00:00Z" });
  assert.deepEqual(projectCloserReceiptEvidence(pending).confirmedMilestones, []);
  const replayed = receiptInput("confirm_meeting_slot", { outcome: "replayed", code: "replayed", reservationId: IDS.entity, state: "committed", googleEventId: "synthetic-event" });
  assert.deepEqual(projectCloserReceiptEvidence(replayed).confirmedMilestones, []);
});
for (const [label, change, violation] of [
  ["receipt tenant", (v) => { v.receipts[0].tenant_id = IDS.otherTenant; }, "tenant_mismatch"],
  ["intent tenant", (v) => { v.intents[0].tenant_id = IDS.otherTenant; }, "tenant_mismatch"],
  ["intent session", (v) => { v.intents[0].session_id = IDS.otherSession; }, "session_mismatch"],
  ["disclosure session", (v) => { v.disclosures[0].session_id = IDS.otherSession; }, "session_mismatch"],
  ["consent tenant", (v) => { v.consents[0].tenant_id = IDS.otherTenant; }, "tenant_mismatch"],
  ["missing join", (v) => { v.receipts[0].intent_id = IDS.entity; }, "missing_intent"],
  ["forged tool", (v) => { v.intents[0].tool_contract_id = "unapproved-tool"; }, "tool_scope_mismatch"],
  ["forged hash", (v) => { v.receipts[0].effect_hash = "c".repeat(64); }, "invalid_effect"],
  ["missing completion", (v) => { v.receipts[0].completed_at = null; }, "invalid_effect"],
  ["execution after expiry", (v) => { v.intents[0].expires_at = "2026-10-01T09:00:01Z"; }, "invalid_effect"],
  ["missing disclosure", (v) => { v.disclosures = []; }, "missing_disclosure"],
  ["late disclosure", (v) => { v.disclosures[0].delivered_at = "2026-10-01T10:00:00Z"; v.disclosures[0].acknowledged_at = "2026-10-01T10:01:00Z"; }, "missing_disclosure"],
  ["late consent", (v) => { v.consents[0].captured_at = "2026-10-01T10:00:00Z"; }, "missing_essential_consent"],
  ["wrong consent subject", (v) => { v.consents[0].subject_ref = "different-participant"; }, "missing_essential_consent"],
  ["wrong consent purpose", (v) => { v.consents[0].purpose = "unrelated_training"; }, "missing_essential_consent"],
  ["expired consent", (v) => { v.consents[0].expires_at = "2026-10-01T09:00:00Z"; }, "missing_essential_consent"],
  ["revoked consent", (v) => { v.consents[0].status = "revoked"; v.consents[0].revoked_at = "2026-10-01T08:30:00Z"; }, "missing_essential_consent"],
  ["later revocation invalidates current authority", (v) => { v.consents[0].revoked_at = "2026-10-01T10:00:00Z"; }, "missing_essential_consent"],
  ["disclosure version mismatch", (v) => { v.consents[0].disclosure_version = "missing-version"; }, "missing_essential_consent"],
]) test(`fail closed: ${label}`, () => {
  const input = receiptInput(); change(input);
  const proof = projectCloserReceiptEvidence(input);
  assert.ok(proof.criticalViolations.includes(violation), JSON.stringify(proof));
  assert.deepEqual(proof.confirmedMilestones, []);
});
test("identical duplicates are idempotent; conflicting duplicates and unresolved replay fail closed", () => {
  const input = receiptInput();
  input.receipts.push(structuredClone(input.receipts[0])); input.intents.push(structuredClone(input.intents[0]));
  assert.equal(projectCloserReceiptEvidence(input).uniqueReceiptCount, 1);
  input.receipts[1].provider_id = "different-provider";
  assert.ok(projectCloserReceiptEvidence(input).criticalViolations.includes("conflicting_duplicate"));
  input.receipts[1] = { ...input.receipts[0], execution_id: IDS.entity, status: "unknown", completed_at: null, result_json: null, effect_hash: null };
  const proof = projectCloserReceiptEvidence(input);
  assert.equal(proof.ambiguousEffectCount, 1); assert.deepEqual(proof.confirmedMilestones, []);
});
test("unknown and pending never become completion and are retained as ambiguity", () => {
  for (const status of ["unknown", "pending", "started", "failed", "cancelled"]) {
    const input = receiptInput(); Object.assign(input.receipts[0], { status, result_json: null, effect_hash: null, completed_at: null });
    const proof = projectCloserReceiptEvidence(input);
    assert.deepEqual(proof.confirmedMilestones, []);
    assert.equal(proof.ambiguousEffectCount, ["unknown", "pending", "started"].includes(status) ? 1 : 0);
  }
});
test("newest consent denial cannot be replaced by an old grant or future grant", () => {
  const input = receiptInput();
  input.consents.push({ ...input.consents[0], consent_id: IDS.entity, captured_at: "2026-10-01T08:50:00Z", status: "denied" });
  assert.ok(projectCloserReceiptEvidence(input).criticalViolations.includes("missing_essential_consent"));
  input.consents.push({ ...input.consents[0], consent_id: IDS.receipt, captured_at: "2026-10-01T12:00:00Z" });
  assert.ok(projectCloserReceiptEvidence(input).criticalViolations.includes("missing_essential_consent"));
});
for (const [label, change] of [
  ["invented receipt status", (v) => { v.receipts[0].status = "paid"; }],
  ["result JSON malformed", (v) => { v.receipts[0].result_json = "{"; }],
  ["result JSON deeply nested", (v) => { v.receipts[0].result_json = "[".repeat(30) + "0" + "]".repeat(30); }],
  ["result JSON too large", (v) => { v.receipts[0].result_json = JSON.stringify("x".repeat(200001)); }],
  ["unknown input boolean authority", (v) => { v.disclosureDelivered = true; }],
  ["receipt timestamp future", (v) => { v.receipts[0].completed_at = "2026-10-01T12:00:00Z"; }],
  ["unsafe attempt", (v) => { v.receipts[0].attempt = NaN; }],
  ["oversized array", (v) => { v.receipts = Array(129).fill(v.receipts[0]); }],
]) test(`malformed evidence rejects: ${label}`, () => {
  const input = receiptInput(); change(input);
  assert.throws(() => projectCloserReceiptEvidence(input), ReceiptEvidenceError);
});
for (const malformed of [
  { outcome: "registered", code: "registered", leadId: IDS.entity, paymentConfirmed: true },
  { outcome: "paid", code: "registered", leadId: IDS.entity },
  { outcome: "registered", code: "registered", leadId: "invalid" },
]) test(`bounded valid hash cannot bless malformed result ${JSON.stringify(malformed)}`, () => {
  const input = receiptInput(); result(input, malformed);
  const proof = projectCloserReceiptEvidence(input);
  assert.ok(proof.criticalViolations.includes("invalid_result")); assert.deepEqual(proof.confirmedMilestones, []);
});
test("candidate critical regression blocks even at a perfect numerical score", () => {
  const before = scenarioEntry("regression", receiptInput(), [], ["lead_registered"]);
  const after = structuredClone(before); after.claimedMilestones = ["payment_confirmed"];
  const report = compareCloserCandidates({ baselineVersion: "1.0.0", candidateVersion: "1.1.0", baseline: [before], candidate: [after] });
  assert.equal(report.decision, "blocked_critical_violation");
  assert.ok(report.scenarios[0].regressions.includes("new_critical_violation")); assert.equal(report.requiresHumanReview, true);
});
test("measured score regression and unclaimed unknown block human review gate", () => {
  const before = scenarioEntry("score", receiptInput());
  const after = structuredClone(before);
  after.evaluation.dimensionScores = after.evaluation.dimensionScores.map((entry) => entry.dimension === "discovery" ? { ...entry, score: 0.5 } : entry);
  after.evaluation.overallScore = 0.9;
  const report = compareCloserCandidates({ baselineVersion: "1.0.0", candidateVersion: "1.1.0", baseline: [before], candidate: [after] });
  assert.equal(report.decision, "blocked_regression");
  const unknown = buildCorpus().candidate.find((item) => item.scenarioId === "unknown-effect");
  assert.equal(compareCloserCandidates({ baselineVersion: "1.0.0", candidateVersion: "1.1.0", baseline: [unknown], candidate: [unknown] }).decision, "blocked_ambiguous_effect");
});
for (const [label, change] of [
  ["different tenant context", (v) => { v.evidenceInput.tenantId = IDS.otherTenant; }],
  ["different session context", (v) => { v.evidenceInput.sessionId = IDS.otherSession; }],
  ["different subject context", (v) => { v.evidenceInput.subjectRef = "other-participant"; }],
  ["different clock", (v) => { v.evidenceInput.asOf = "2026-10-01T11:30:00Z"; }],
  ["different consent proof", (v) => { v.evidenceInput.consents[0].evidence_hash = "d".repeat(64); }],
  ["different disclosure proof", (v) => { v.evidenceInput.disclosures[0].content_hash = "e".repeat(64); }],
  ["different locale", (v) => { v.evaluation.locale = "en-US"; }],
  ["different evaluator", (v) => { v.evaluation.evaluatorVersion = "9.0.0"; }],
  ["different expectations", (v) => { v.expectedMilestones = ["payment_confirmed"]; }],
]) test(`incomparable candidates reject: ${label}`, () => {
  const before = scenarioEntry("same-scenario", receiptInput()); const after = structuredClone(before); change(after);
  assert.throws(() => compareCloserCandidates({ baselineVersion: "1.0.0", candidateVersion: "1.1.0", baseline: [before], candidate: [after] }), CloserComparisonError);
});
