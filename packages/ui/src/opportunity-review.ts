import { UUID_V7_PATTERN } from "@axtro/domain";

import {
  escapeHtml,
  renderEvidenceLabel,
  OperationsConsoleRenderError,
  type OperationsActionReceiptView,
  type OperationsCostTotalView,
  type OperationsHypothesisView,
} from "./operations-console.js";

/**
 * M3-09: console expansion for opportunity and call review. This is a new,
 * additive module — it reuses `renderEvidenceLabel`/`escapeHtml` from the
 * M1-09 operations console (the same tested fact-vs-hypothesis distinction
 * and HTML escaping) rather than duplicating or rewriting that file.
 * Sensitive fields never reach the rendered HTML at all when the viewer
 * lacks PII access — omission, not client-side hiding.
 */
export interface OpportunityCitationView {
  readonly citationLocator: string;
  readonly sourceId: string;
  readonly excerptText: string;
}

export interface OpportunityHandoffView {
  readonly handoffId: string;
  readonly status: "pending" | "accepted" | "declined" | "timed_out" | "rolled_back" | "conflict_simultaneous_request";
  readonly targetHumanId: string;
}

export interface OpportunityEvaluatorFindingView {
  readonly scenarioId: string;
  readonly evaluatorVersion: string;
  readonly status: "passed" | "failed_critical_violation" | "failed_low_score";
  readonly overallScoreBasisPoints: number;
}

export interface OpportunityReviewViewModel {
  readonly tenantId: string;
  readonly sessionId: string;
  readonly citations: readonly OpportunityCitationView[];
  readonly hypotheses: readonly OperationsHypothesisView[];
  readonly receipts: readonly OperationsActionReceiptView[];
  readonly handoffs: readonly OpportunityHandoffView[];
  readonly costTotals: readonly OperationsCostTotalView[];
  readonly evaluatorFindings: readonly OpportunityEvaluatorFindingView[];
  readonly viewerHasPiiAccess: boolean;
  readonly sensitiveFields: Readonly<Record<string, string>>;
}

export class OpportunityReviewPermissionError extends Error {
  constructor() {
    super("the requesting operator is not authorized to view this tenant's opportunity review");
    this.name = "OpportunityReviewPermissionError";
  }
}

const MAX_RENDERED_ITEMS = 100;
const HANDOFF_STATUS_LABELS: Readonly<Record<OpportunityHandoffView["status"], string>> = Object.freeze({
  pending: "Aguardando aceite",
  accepted: "Transferido para humano",
  declined: "Recusado",
  timed_out: "Expirou sem resposta",
  rolled_back: "Revertido",
  conflict_simultaneous_request: "Conflito: pedido simultâneo",
});
const EVALUATOR_STATUS_LABELS: Readonly<Record<OpportunityEvaluatorFindingView["status"], string>> = Object.freeze({
  passed: "Aprovado",
  failed_critical_violation: "Falha crítica",
  failed_low_score: "Nota abaixo do limiar",
});

/**
 * `authorizedTenantId` is the caller's own authenticated tenant scope,
 * established outside this module. Rendering a model whose `tenantId`
 * differs from it is a permission error, never a cross-tenant render.
 */
export function renderOpportunityReviewDocument(modelInput: unknown, authorizedTenantId: unknown): string {
  const model = parseViewModel(modelInput);
  const tenantScope = parseTenantId(authorizedTenantId);
  if (model.tenantId !== tenantScope) throw new OpportunityReviewPermissionError();

  const citationsHtml = model.citations.slice(0, MAX_RENDERED_ITEMS).map(renderCitation).join("\n");
  const hypothesesHtml = model.hypotheses.slice(0, MAX_RENDERED_ITEMS).map(renderHypothesis).join("\n");
  const receiptsHtml = model.receipts.slice(0, MAX_RENDERED_ITEMS).map(renderReceipt).join("\n");
  const handoffsHtml = model.handoffs.slice(0, MAX_RENDERED_ITEMS).map(renderHandoff).join("\n");
  const costsHtml = model.costTotals.slice(0, MAX_RENDERED_ITEMS).map(renderCostTotal).join("\n");
  const evaluatorHtml = model.evaluatorFindings.slice(0, MAX_RENDERED_ITEMS).map(renderEvaluatorFinding).join("\n");
  const sensitiveHtml = model.viewerHasPiiAccess ? renderSensitiveFields(model.sensitiveFields) : "";

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>Revisão de oportunidade — ${escapeHtml(model.sessionId)}</title>
</head>
<body>
<main aria-label="Revisão de oportunidade">
<h1>Sessão ${escapeHtml(model.sessionId)}</h1>
<section aria-label="Citações">
<h2>Citações</h2>
<ul>${citationsHtml}</ul>
</section>
<section aria-label="Hipóteses e fatos">
<h2>Hipóteses e fatos</h2>
<ul>${hypothesesHtml}</ul>
</section>
<section aria-label="Receipts de ação">
<h2>Receipts de ação</h2>
<ul>${receiptsHtml}</ul>
</section>
<section aria-label="Handoffs">
<h2>Handoffs</h2>
<ul>${handoffsHtml}</ul>
</section>
<section aria-label="Custos">
<h2>Custos</h2>
<ul>${costsHtml}</ul>
</section>
<section aria-label="Avaliação">
<h2>Achados do avaliador</h2>
<ul>${evaluatorHtml}</ul>
</section>
<section aria-label="Dados sensíveis" data-pii-visible="${model.viewerHasPiiAccess ? "true" : "false"}">
<h2>Dados sensíveis</h2>
${model.viewerHasPiiAccess ? `<ul>${sensitiveHtml}</ul>` : "<p>Sem permissão para exibir dados sensíveis desta sessão.</p>"}
</section>
</main>
</body>
</html>`;
}

function renderCitation(citation: OpportunityCitationView): string {
  return `<li data-trusted="false"><span aria-hidden="true">❝</span> <em>Conteúdo recuperado, não confiável</em> — ${escapeHtml(citation.excerptText)} <cite>${escapeHtml(citation.citationLocator)}</cite></li>`;
}

function renderHypothesis(hypothesis: OperationsHypothesisView): string {
  const label = renderEvidenceLabel({ kind: "hypothesis", expired: hypothesis.expired });
  return `<li>${escapeHtml(hypothesis.label)} — ${label}</li>`;
}

function renderReceipt(receipt: OperationsActionReceiptView): string {
  const label = renderEvidenceLabel({ kind: "receipt", confirmed: receipt.confirmed_effect, status: receipt.status });
  return `<li>${escapeHtml(receipt.action)} — ${label}</li>`;
}

function renderHandoff(handoff: OpportunityHandoffView): string {
  return `<li>${escapeHtml(HANDOFF_STATUS_LABELS[handoff.status])} — humano: ${escapeHtml(handoff.targetHumanId)}</li>`;
}

function renderCostTotal(cost: OperationsCostTotalView): string {
  return `<li>${escapeHtml(cost.source)}: US$ ${escapeHtml(cost.amount_usd_decimal)}</li>`;
}

function renderEvaluatorFinding(finding: OpportunityEvaluatorFindingView): string {
  const isCritical = finding.status === "failed_critical_violation";
  return `<li data-critical="${isCritical ? "true" : "false"}">${escapeHtml(finding.scenarioId)} (v${escapeHtml(finding.evaluatorVersion)}): ${escapeHtml(EVALUATOR_STATUS_LABELS[finding.status])}</li>`;
}

function renderSensitiveFields(fields: Readonly<Record<string, string>>): string {
  return Object.entries(fields)
    .map(([key, value]) => `<li>${escapeHtml(key)}: ${escapeHtml(value)}</li>`)
    .join("\n");
}

function parseTenantId(value: unknown): string {
  if (typeof value !== "string" || !UUID_V7_PATTERN.test(value)) throw new OperationsConsoleRenderError();
  return value;
}

function parseViewModel(value: unknown): OpportunityReviewViewModel {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new OperationsConsoleRenderError();
  const record = value as Record<string, unknown>;
  const expected = ["tenantId", "sessionId", "citations", "hypotheses", "receipts", "handoffs", "costTotals", "evaluatorFindings", "viewerHasPiiAccess", "sensitiveFields"];
  const actual = Object.keys(record);
  if (actual.length !== expected.length || !expected.every((key) => actual.includes(key))) throw new OperationsConsoleRenderError();
  if (typeof record.viewerHasPiiAccess !== "boolean") throw new OperationsConsoleRenderError();
  if (record.sensitiveFields === null || typeof record.sensitiveFields !== "object" || Array.isArray(record.sensitiveFields)) {
    throw new OperationsConsoleRenderError();
  }
  for (const fieldValue of Object.values(record.sensitiveFields as Record<string, unknown>)) {
    if (typeof fieldValue !== "string") throw new OperationsConsoleRenderError();
  }
  return Object.freeze({
    tenantId: parseTenantId(record.tenantId),
    sessionId: nonEmptyString(record.sessionId),
    citations: parseArray(record.citations),
    hypotheses: parseArray(record.hypotheses),
    receipts: parseArray(record.receipts),
    handoffs: parseArray(record.handoffs),
    costTotals: parseArray(record.costTotals),
    evaluatorFindings: parseArray(record.evaluatorFindings),
    viewerHasPiiAccess: record.viewerHasPiiAccess,
    sensitiveFields: Object.freeze({ ...(record.sensitiveFields as Record<string, string>) }),
  }) as OpportunityReviewViewModel;
}

function parseArray<T>(value: unknown): readonly T[] {
  if (!Array.isArray(value) || value.length > 10_000) throw new OperationsConsoleRenderError();
  return Object.freeze([...value]) as readonly T[];
}

function nonEmptyString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 300) throw new OperationsConsoleRenderError();
  return value;
}
