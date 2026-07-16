import assert from "node:assert/strict";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../..", import.meta.url));
const evaluation = await import(pathToFileURL(join(root, "packages/evaluation/dist/index.js")).href);

const TENANT_ALPHA = "018bcfe5-0000-7abc-8f01-020304050607";

function passedEvaluation(scenarioId = "scenario-1") {
  return { scenarioId, evaluatorVersion: "1.0.0", locale: "en-US", dimensionScores: [], overallScore: 0.9, status: "passed" };
}

function criticalEvaluation(scenarioId = "scenario-critical") {
  return { scenarioId, evaluatorVersion: "1.0.0", locale: "en-US", dimensionScores: [], overallScore: 0.5, status: "failed_critical_violation" };
}

let callRecordSequence = 0;

function callRecord(overrides = {}) {
  callRecordSequence += 1;
  return {
    callId: `call-auto-${callRecordSequence}`,
    channel: "voice",
    tenantId: TENANT_ALPHA,
    evaluation: passedEvaluation(),
    estimatedCostUsdMicros: 100_000,
    providerReportedCostUsdMicros: 105_000,
    tenancyViolationDetected: false,
    resolved: false,
    ...overrides,
  };
}

function twentyCleanCalls() {
  return Array.from({ length: 20 }, (_, index) => callRecord({ callId: `call-${index}`, channel: index % 2 === 0 ? "voice" : "video" }));
}

test("insufficient sample: fewer than 20 reviewed calls always blocks the gate", () => {
  const calls = Array.from({ length: 5 }, (_, index) => callRecord({ callId: `call-${index}` }));
  const report = evaluation.generatePilotGateReport(calls);
  assert.equal(report.meetsMinimumSample, false);
  assert.equal(report.decision, "blocked_insufficient_sample");
  assert.equal(report.totalCallsReviewed, 5);
});

test("a clean sample of exactly the minimum size is ready for human review, never auto-approved for beta", () => {
  const report = evaluation.generatePilotGateReport(twentyCleanCalls());
  assert.equal(report.meetsMinimumSample, true);
  assert.equal(report.decision, "ready_for_human_review");
  assert.equal(report.requiresHumanApprovalForCustomerBeta, true);
  assert.deepEqual(report.openCriticalViolations, []);
  assert.deepEqual(report.openTenancyViolations, []);
});

test("an open critical policy violation blocks the gate regardless of sample size", () => {
  const calls = twentyCleanCalls();
  calls[0] = callRecord({ callId: "call-critical", evaluation: criticalEvaluation(), resolved: false });
  const report = evaluation.generatePilotGateReport(calls);
  assert.equal(report.decision, "blocked_open_critical_violation");
  assert.equal(report.openCriticalViolations.length, 1);
  assert.equal(report.openCriticalViolations[0].callId, "call-critical");
});

test("a resolved critical violation no longer blocks the gate", () => {
  const calls = twentyCleanCalls();
  calls[0] = callRecord({ callId: "call-critical-resolved", evaluation: criticalEvaluation(), resolved: true });
  const report = evaluation.generatePilotGateReport(calls);
  assert.equal(report.decision, "ready_for_human_review");
  assert.deepEqual(report.openCriticalViolations, []);
});

test("an open tenancy violation blocks the gate even when every evaluation passed", () => {
  const calls = twentyCleanCalls();
  calls[3] = callRecord({ callId: "call-tenancy", tenancyViolationDetected: true, resolved: false });
  const report = evaluation.generatePilotGateReport(calls);
  assert.equal(report.decision, "blocked_open_critical_violation");
  assert.deepEqual(report.openTenancyViolations, ["call-tenancy"]);
});

test("cost and quality are measured and summarized independently per channel", () => {
  const calls = [
    ...Array.from({ length: 12 }, (_, index) => callRecord({ callId: `voice-${index}`, channel: "voice", estimatedCostUsdMicros: 100_000 })),
    ...Array.from({ length: 8 }, (_, index) => callRecord({ callId: `text-${index}`, channel: "text", estimatedCostUsdMicros: 20_000 })),
  ];
  const report = evaluation.generatePilotGateReport(calls);
  const voice = report.channelSummaries.find((summary) => summary.channel === "voice");
  const text = report.channelSummaries.find((summary) => summary.channel === "text");
  assert.equal(voice.callCount, 12);
  assert.equal(voice.totalEstimatedCostUsdMicros, 1_200_000);
  assert.equal(text.callCount, 8);
  assert.equal(text.totalEstimatedCostUsdMicros, 160_000);
  assert.equal(report.channelSummaries.some((summary) => summary.channel === "video"), false, "channels with zero calls are omitted, not padded with zeros");
});

test("a duplicate callId is rejected — every reviewed call must be distinct", () => {
  const calls = twentyCleanCalls();
  calls[1] = { ...calls[0] };
  assert.throws(() => evaluation.generatePilotGateReport(calls), evaluation.PilotGateError);
});

test("this report never contains a beta-approval decision — only ready_for_human_review or a block", () => {
  const report = evaluation.generatePilotGateReport(twentyCleanCalls());
  assert.ok(["ready_for_human_review", "blocked_open_critical_violation", "blocked_insufficient_sample"].includes(report.decision));
  assert.notEqual(report.decision, "approved");
});
