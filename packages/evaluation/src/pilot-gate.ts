/**
 * M3-10: aggregates reviewed internal calls into the Sales Closer Alpha
 * pilot gate report. This module only aggregates evidence a caller already
 * has (M3-08 evaluation results, M2-11 cost data): it never generates,
 * simulates or approves a real internal pilot. `requiresHumanApprovalForCustomerBeta`
 * is always `true`: no decision this module produces is itself a beta
 * approval (per HANDOFF_TO_CODEX.md: "customer beta requires a separate
 * approval").
 */
import { UUID_V7_PATTERN as TENANT_ID_PATTERN } from "@axtro/domain";

import type { ScenarioEvaluationResult } from "./index.js";
import { parseEvaluationResult } from "./result-validation.js";

export const MINIMUM_REVIEWED_CALLS = 20;

export type PilotChannel = "voice" | "video" | "text";

export interface PilotCallRecord {
  readonly callId: string;
  readonly channel: PilotChannel;
  readonly tenantId: string;
  readonly evaluation: ScenarioEvaluationResult;
  readonly estimatedCostUsdMicros: number;
  readonly providerReportedCostUsdMicros: number;
  readonly tenancyViolationDetected: boolean;
  readonly resolved: boolean;
}

export interface ChannelCostQualitySummary {
  readonly channel: PilotChannel;
  readonly callCount: number;
  readonly averageOverallScore: number;
  readonly totalEstimatedCostUsdMicros: number;
  readonly totalProviderReportedCostUsdMicros: number;
}

export type PilotGateDecision = "ready_for_human_review" | "blocked_open_critical_violation" | "blocked_insufficient_sample";

export interface OpenViolationReference {
  readonly callId: string;
  readonly scenarioId: string;
}

export interface PilotGateReport {
  readonly totalCallsReviewed: number;
  readonly meetsMinimumSample: boolean;
  readonly openCriticalViolations: readonly OpenViolationReference[];
  readonly openTenancyViolations: readonly string[];
  readonly channelSummaries: readonly ChannelCostQualitySummary[];
  readonly decision: PilotGateDecision;
  readonly requiresHumanApprovalForCustomerBeta: true;
}

export class PilotGateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PilotGateError";
  }
}

const CHANNELS: readonly PilotChannel[] = ["voice", "video", "text"];

export function generatePilotGateReport(rawCalls: unknown): PilotGateReport {
  const calls = parseCalls(rawCalls);

  const openCriticalViolations: OpenViolationReference[] = [];
  const openTenancyViolations: string[] = [];
  for (const call of calls) {
    if (call.resolved) continue;
    if (call.evaluation.status === "failed_critical_violation") {
      openCriticalViolations.push(Object.freeze({ callId: call.callId, scenarioId: call.evaluation.scenarioId }));
    }
    if (call.tenancyViolationDetected) openTenancyViolations.push(call.callId);
  }

  const channelSummaries = CHANNELS.map((channel) => summarizeChannel(channel, calls.filter((call) => call.channel === channel))).filter(
    (summary) => summary.callCount > 0,
  );

  const meetsMinimumSample = calls.length >= MINIMUM_REVIEWED_CALLS;
  const decision: PilotGateDecision = !meetsMinimumSample
    ? "blocked_insufficient_sample"
    : openCriticalViolations.length > 0 || openTenancyViolations.length > 0
      ? "blocked_open_critical_violation"
      : "ready_for_human_review";

  return Object.freeze({
    totalCallsReviewed: calls.length,
    meetsMinimumSample,
    openCriticalViolations: Object.freeze(openCriticalViolations),
    openTenancyViolations: Object.freeze(openTenancyViolations),
    channelSummaries: Object.freeze(channelSummaries),
    decision,
    requiresHumanApprovalForCustomerBeta: true,
  });
}

function summarizeChannel(channel: PilotChannel, calls: readonly PilotCallRecord[]): ChannelCostQualitySummary {
  if (calls.length === 0) {
    return Object.freeze({ channel, callCount: 0, averageOverallScore: 0, totalEstimatedCostUsdMicros: 0, totalProviderReportedCostUsdMicros: 0 });
  }
  const estimated = calls.reduce((sum, call) => sum + call.estimatedCostUsdMicros, 0);
  const reported = calls.reduce((sum, call) => sum + call.providerReportedCostUsdMicros, 0);
  if (!Number.isSafeInteger(estimated) || !Number.isSafeInteger(reported)) throw new PilotGateError("cost aggregate exceeds safe precision");
  return Object.freeze({
    channel,
    callCount: calls.length,
    averageOverallScore: calls.reduce((sum, call) => sum + call.evaluation.overallScore, 0) / calls.length,
    totalEstimatedCostUsdMicros: estimated,
    totalProviderReportedCostUsdMicros: reported,
  });
}

function parseCalls(value: unknown): readonly PilotCallRecord[] {
  if (!Array.isArray(value) || value.length > 10_000) throw new PilotGateError("invalid calls array");
  let totalEvidenceChars = 0;
  const parsed = value.map((item, index) => {
    const call = parseCall(item, index);
    totalEvidenceChars += call.evaluation.dimensionScores.reduce((sum, entry) => sum + entry.evidence.reduce((subtotal, item) => subtotal + item.length, 0), 0);
    if (totalEvidenceChars > 2_000_000) throw new PilotGateError("evaluation evidence exceeds aggregate bound");
    return call;
  });
  const seen = new Set<string>();
  for (const call of parsed) {
    if (seen.has(call.callId)) throw new PilotGateError("duplicate callId");
    seen.add(call.callId);
  }
  return Object.freeze(parsed);
}

function parseCall(value: unknown, index: number): PilotCallRecord {
  if (value === null || typeof value !== "object") throw new PilotGateError(`invalid calls[${index}]`);
  const record = value as Record<string, unknown>;
  if (typeof record.callId !== "string" || record.callId.length === 0 || record.callId.length > 200) throw new PilotGateError(`invalid calls[${index}].callId`);
  if (!CHANNELS.includes(record.channel as PilotChannel)) throw new PilotGateError(`invalid calls[${index}].channel`);
  if (typeof record.tenantId !== "string" || !TENANT_ID_PATTERN.test(record.tenantId)) throw new PilotGateError(`invalid calls[${index}].tenantId`);
  let evaluation: ScenarioEvaluationResult;
  try { evaluation = parseEvaluationResult(record.evaluation); }
  catch { throw new PilotGateError(`invalid calls[${index}].evaluation`); }
  if (typeof record.estimatedCostUsdMicros !== "number" || !Number.isSafeInteger(record.estimatedCostUsdMicros) || record.estimatedCostUsdMicros < 0) {
    throw new PilotGateError(`invalid calls[${index}].estimatedCostUsdMicros`);
  }
  if (typeof record.providerReportedCostUsdMicros !== "number" || !Number.isSafeInteger(record.providerReportedCostUsdMicros) || record.providerReportedCostUsdMicros < 0) {
    throw new PilotGateError(`invalid calls[${index}].providerReportedCostUsdMicros`);
  }
  if (typeof record.tenancyViolationDetected !== "boolean") throw new PilotGateError(`invalid calls[${index}].tenancyViolationDetected`);
  if (typeof record.resolved !== "boolean") throw new PilotGateError(`invalid calls[${index}].resolved`);
  return Object.freeze({
    callId: record.callId,
    channel: record.channel as PilotChannel,
    tenantId: record.tenantId,
    evaluation,
    estimatedCostUsdMicros: record.estimatedCostUsdMicros,
    providerReportedCostUsdMicros: record.providerReportedCostUsdMicros,
    tenancyViolationDetected: record.tenancyViolationDetected,
    resolved: record.resolved,
  });
}
