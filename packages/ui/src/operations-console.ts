import { UUID_V7_PATTERN } from "@axtro/domain";

import { OPERATIONS_CONSOLE_STYLES } from "./operations-console-styles.js";

export type OperationsSessionStatus = "preparing" | "ready" | "active" | "handoff_pending" | "completed" | "failed";
export type OperationsReceiptStatus = "started" | "succeeded" | "failed" | "pending" | "unknown" | "cancelled";
export type OperationsHypothesisStatus = "candidate" | "active" | "confirmed" | "rejected" | "expired";
export type OperationsCostSource = "estimated" | "measured" | "provider_reported";

export interface OperationsSessionView {
  readonly session_id: string;
  readonly status: OperationsSessionStatus;
  readonly channel_type: string;
  readonly region: string;
  readonly state_version: number;
  readonly state_hash: string;
  readonly consent_status: string;
  readonly disclosure_status: string;
  readonly degradation_level: string;
  readonly active_presenter_id: string | null;
  readonly updated_at: string;
}

export interface OperationsTimelineItemView {
  readonly event_id: string;
  readonly event_type: string;
  readonly aggregate_version: number;
  readonly occurred_at: string;
  readonly data_classification: "public" | "internal" | "confidential" | "restricted";
  readonly payload_omitted: true;
}

export interface OperationsActionReceiptView {
  readonly execution_id: string;
  readonly intent_id: string;
  readonly tool_contract_id: string;
  readonly action: string;
  readonly status: OperationsReceiptStatus;
  readonly policy_outcome: "allow" | "deny" | "require_approval";
  readonly confirmed_effect: boolean;
  readonly effect_hash: string | null;
  readonly attempt: number;
  readonly started_at: string;
  readonly completed_at: string | null;
}

export interface OperationsHypothesisView {
  readonly hypothesis_id: string;
  readonly label: string;
  readonly status: OperationsHypothesisStatus;
  readonly confidence_basis_points: number;
  readonly expires_at: string;
  readonly expired: boolean;
}

export interface OperationsCostBucketView {
  readonly source: OperationsCostSource;
  readonly provider_id: string;
  readonly service: string;
  readonly unit_type: string;
  readonly event_count: number;
  readonly quantity_decimal: string;
  readonly amount_usd_decimal: string;
}

export interface OperationsCostTotalView {
  readonly source: OperationsCostSource;
  readonly amount_usd_decimal: string;
}

export interface OperationsConsoleViewModel {
  readonly session: OperationsSessionView;
  readonly timeline: Readonly<{
    items: readonly OperationsTimelineItemView[];
    after_version: number;
    total_event_count: number;
    next_after_version: number | null;
  }>;
  readonly action_receipts: readonly OperationsActionReceiptView[];
  readonly hypotheses: readonly OperationsHypothesisView[];
  readonly cost_buckets: readonly OperationsCostBucketView[];
  readonly cost_totals: readonly OperationsCostTotalView[];
}

export type OperationsConsoleErrorKind = "unauthenticated" | "forbidden" | "not_found" | "invalid_request" | "unavailable";

export class OperationsConsoleRenderError extends Error {
  constructor() {
    super("Operations console view is invalid");
    this.name = "OperationsConsoleRenderError";
  }
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const DECIMAL_PATTERN = /^(?:0|[1-9][0-9]{0,11})\.[0-9]{8}$/;
const BIDI_CONTROL_PATTERN = /[\u202a-\u202e\u2066-\u2069]/u;
const MAX_RENDERED_ITEMS = 100;
const MAX_SNAPSHOT_NODES = 5_000;

const SESSION_STATUS_LABELS: Readonly<Record<OperationsSessionStatus, string>> = Object.freeze({
  preparing: "Preparando",
  ready: "Pronta",
  active: "Ativa",
  handoff_pending: "Handoff pendente",
  completed: "Concluída",
  failed: "Falhou",
});
const RECEIPT_STATUS_LABELS: Readonly<Record<OperationsReceiptStatus, string>> = Object.freeze({
  started: "iniciado",
  succeeded: "concluído",
  failed: "falhou",
  pending: "pendente",
  unknown: "efeito desconhecido",
  cancelled: "cancelado",
});
const COST_SOURCE_LABELS: Readonly<Record<OperationsCostSource, string>> = Object.freeze({
  estimated: "Estimado",
  measured: "Medido",
  provider_reported: "Reportado pelo provider",
});

export function renderEvidenceLabel(
  input:
    | Readonly<{ kind: "receipt"; confirmed: boolean; status: OperationsReceiptStatus }>
    | Readonly<{ kind: "hypothesis"; expired: boolean }>,
): string {
  try {
    const normalized = plainDataSnapshot(input) as typeof input;
    if (normalized.kind === "receipt") {
      exactKeys(normalized, ["kind", "confirmed", "status"]);
      if (!Object.hasOwn(RECEIPT_STATUS_LABELS, normalized.status)) throw new OperationsConsoleRenderError();
      if (normalized.confirmed && normalized.status !== "succeeded") throw new OperationsConsoleRenderError();
      if (normalized.confirmed) {
        return '<span class="evidence-label evidence-label--receipt" data-evidence-kind="receipt"><span aria-hidden="true">✓</span> Receipt confirmado</span>';
      }
      return `<span class="evidence-label evidence-label--unconfirmed" data-evidence-kind="receipt"><span aria-hidden="true">○</span> Receipt: ${escapeHtml(RECEIPT_STATUS_LABELS[normalized.status])}, sem efeito confirmado</span>`;
    }
    exactKeys(normalized, ["kind", "expired"]);
    if (normalized.kind !== "hypothesis" || typeof normalized.expired !== "boolean") throw new OperationsConsoleRenderError();
    return `<span class="evidence-label evidence-label--hypothesis" data-evidence-kind="hypothesis"><span aria-hidden="true">≈</span> Hipótese, não verificada${normalized.expired ? ": expirada" : ""}</span>`;
  } catch (error) {
    throw renderError(error);
  }
}

export function renderOperationsConsoleDocument(modelInput: OperationsConsoleViewModel): string {
  try {
    const model = normalizeModel(modelInput);
    const title = `Sessão ${model.session.session_id}`;
    return documentShell(title, `
    <a class="skip-link" href="#conteudo">Ir para o conteúdo</a>
    <main id="conteudo" class="shell">
      <header>
        <p class="eyebrow">Axtro Digital Human OS</p>
        <h1>Operações da sessão</h1>
        <p class="lede">Estado canônico, timeline ordenada, receipts governados e custos separados por fonte. Conteúdo sensível permanece omitido.</p>
        <p class="session-ref"><span class="visually-hidden">Identificador da sessão: </span>${escapeHtml(model.session.session_id)}</p>
      </header>
      <div class="grid">
        ${renderSessionSummary(model.session)}
        ${renderTimeline(model.session.session_id, model.timeline)}
        ${renderEvidence(model.action_receipts, model.hypotheses)}
        ${renderCosts(model.cost_buckets, model.cost_totals)}
      </div>
    </main>
    `);
  } catch (error) {
    throw renderError(error);
  }
}

export function renderOperationsConsoleLoadingDocument(sessionIdInput: string): string {
  try {
    const sessionId = uuid(sessionIdInput);
    return documentShell("Carregando sessão", `
    <a class="skip-link" href="#conteudo">Ir para o conteúdo</a>
    <main id="conteudo" class="state-page">
      <section class="state-card" aria-labelledby="loading-title" aria-busy="true" role="status" aria-live="polite">
        <p class="eyebrow">Axtro Digital Human OS</p>
        <h1 id="loading-title">Carregando operações</h1>
        <p>Validando o estado autorizado da sessão <span class="mono">${escapeHtml(sessionId)}</span>.</p>
      </section>
    </main>
    `);
  } catch (error) {
    throw renderError(error);
  }
}

export function renderOperationsConsoleErrorDocument(
  kind: OperationsConsoleErrorKind,
  correlationIdInput: string | null = null,
): string {
  try {
    const messages: Readonly<Record<OperationsConsoleErrorKind, Readonly<{ title: string; detail: string }>>> = Object.freeze({
    unauthenticated: { title: "Autenticação necessária", detail: "Não foi possível validar este acesso." },
    forbidden: { title: "Acesso não autorizado", detail: "Este operador não pode consultar a sessão solicitada." },
    not_found: { title: "Sessão não encontrada", detail: "A sessão não existe no contexto autorizado." },
    invalid_request: { title: "Link inválido", detail: "O endereço da sessão não é válido." },
    unavailable: { title: "Dados indisponíveis", detail: "O console não conseguiu montar uma visão íntegra agora." },
    });
    if (!Object.hasOwn(messages, kind)) throw new OperationsConsoleRenderError();
    const message = messages[kind];
    const correlation = correlationIdInput === null ? "" : `<p class="mono">Referência: ${escapeHtml(uuid(correlationIdInput))}</p>`;
    return documentShell(message.title, `
    <a class="skip-link" href="#conteudo">Ir para o conteúdo</a>
    <main id="conteudo" class="state-page">
      <section class="state-card" aria-labelledby="error-title" role="alert">
        <p class="eyebrow">Axtro Digital Human OS</p>
        <h1 id="error-title">${escapeHtml(message.title)}</h1>
        <p>${escapeHtml(message.detail)}</p>
        ${correlation}
      </section>
    </main>
    `);
  } catch (error) {
    throw renderError(error);
  }
}

function renderSessionSummary(session: OperationsSessionView): string {
  const presenter = session.active_presenter_id ?? "Nenhum presenter ativo";
  return `
    <section class="panel panel--summary" aria-labelledby="session-heading">
      <h2 id="session-heading">Estado da sessão</h2>
      <dl class="metric-grid">
        ${metric("Status", `<span class="status-pill">${escapeHtml(SESSION_STATUS_LABELS[session.status])}</span>`)}
        ${metric("Versão", escapeHtml(String(session.state_version)))}
        ${metric("Canal", escapeHtml(session.channel_type))}
        ${metric("Região", escapeHtml(session.region))}
        ${metric("Consentimento", escapeHtml(session.consent_status))}
        ${metric("Disclosure", escapeHtml(session.disclosure_status))}
        ${metric("Degradação", escapeHtml(session.degradation_level))}
        ${metric("Presenter ativo", `<span class="mono">${escapeHtml(presenter)}</span>`)}
        ${metric("State hash", `<span class="mono">${escapeHtml(session.state_hash)}</span>`)}
        ${metric("Atualizado", timeElement(session.updated_at))}
      </dl>
    </section>
  `;
}

function renderTimeline(
  sessionId: string,
  timeline: OperationsConsoleViewModel["timeline"],
): string {
  const items = timeline.items.length === 0
    ? '<p class="empty" role="status">Nenhum evento nesta página da timeline.</p>'
    : `<ol class="timeline" role="list">${timeline.items.map((item) => `
        <li class="timeline-item">
          <p class="timeline-item__title">${escapeHtml(item.event_type)}</p>
          <div class="timeline-item__meta">
            <span>Versão ${item.aggregate_version}</span>
            ${timeElement(item.occurred_at)}
            <span class="mono">${escapeHtml(item.event_id)}</span>
            <span>Classificação: ${escapeHtml(item.data_classification)}</span>
          </div>
          <p class="payload-note">Payload omitido por segurança.</p>
        </li>
      `).join("")}</ol>`;
  const pagination = timeline.next_after_version === null
    ? ""
    : `<p class="pagination"><a href="/operations/sessions/${escapeHtml(sessionId)}?after=${timeline.next_after_version}">Próximos eventos</a></p>`;
  return `
    <section class="panel panel--timeline" aria-labelledby="timeline-heading">
      <h2 id="timeline-heading">Timeline canônica</h2>
      <p class="lede">${timeline.total_event_count} eventos autorizados. Página após a versão ${timeline.after_version}.</p>
      ${items}
      ${pagination}
    </section>
  `;
}

function renderEvidence(
  receipts: readonly OperationsActionReceiptView[],
  hypotheses: readonly OperationsHypothesisView[],
): string {
  const receiptRows = receipts.length === 0
    ? '<p class="empty" role="status">Nenhum receipt de ação vinculado a esta sessão.</p>'
    : `<div class="table-wrap" role="region" tabindex="0" aria-label="Receipts governados"><table>
        <caption>Receipts governados. Resultados e erros brutos não são exibidos.</caption>
        <thead><tr><th scope="col">Evidência</th><th scope="col">Ação</th><th scope="col">Execução</th><th scope="col">Tentativa</th><th scope="col">Concluído</th></tr></thead>
        <tbody>${receipts.map((receipt) => `<tr>
          <td>${renderEvidenceLabel({ kind: "receipt", confirmed: receipt.confirmed_effect, status: receipt.status })}</td>
          <td>${escapeHtml(receipt.tool_contract_id)}<br><span class="mono">${escapeHtml(receipt.action)}</span></td>
          <td><span class="mono">${escapeHtml(receipt.execution_id)}</span><br><span class="mono">${escapeHtml(receipt.effect_hash ?? "sem effect hash")}</span></td>
          <td>${receipt.attempt}</td>
          <td>${receipt.completed_at === null ? "Pendente" : timeElement(receipt.completed_at)}</td>
        </tr>`).join("")}</tbody>
      </table></div>`;
  const hypothesisRows = hypotheses.length === 0
    ? ""
    : `<div class="table-wrap" role="region" tabindex="0" aria-label="Hipóteses não verificadas"><table>
        <caption>Hipóteses permanecem incertas e não confirmam fatos.</caption>
        <thead><tr><th scope="col">Classificação</th><th scope="col">Rótulo</th><th scope="col">Confiança</th><th scope="col">Expira</th></tr></thead>
        <tbody>${hypotheses.map((hypothesis) => `<tr>
          <td>${renderEvidenceLabel({ kind: "hypothesis", expired: hypothesis.expired })}</td>
          <td>${escapeHtml(hypothesis.label)}</td>
          <td>${formatBasisPoints(hypothesis.confidence_basis_points)}</td>
          <td>${timeElement(hypothesis.expires_at)}</td>
        </tr>`).join("")}</tbody>
      </table></div>`;
  return `
    <section class="panel panel--evidence" aria-labelledby="evidence-heading">
      <h2 id="evidence-heading">Ações e evidências</h2>
      ${receiptRows}
      ${hypothesisRows}
    </section>
  `;
}

function renderCosts(
  buckets: readonly OperationsCostBucketView[],
  totals: readonly OperationsCostTotalView[],
): string {
  const totalCards = totals.map((total) => `<div class="cost-total"><span>${escapeHtml(COST_SOURCE_LABELS[total.source])}</span><strong>USD ${escapeHtml(total.amount_usd_decimal)}</strong></div>`).join("");
  const rows = buckets.length === 0
    ? '<p class="empty" role="status">Nenhum custo atribuído a esta sessão.</p>'
    : `<div class="table-wrap" role="region" tabindex="0" aria-label="Custos atribuídos à sessão"><table>
        <caption>Custos separados por fonte. Origens não são somadas entre si.</caption>
        <thead><tr><th scope="col">Fonte</th><th scope="col">Provider</th><th scope="col">Serviço</th><th scope="col">Quantidade</th><th scope="col">USD</th></tr></thead>
        <tbody>${buckets.map((bucket) => `<tr>
          <td>${escapeHtml(COST_SOURCE_LABELS[bucket.source])}</td>
          <td>${escapeHtml(bucket.provider_id)}</td>
          <td>${escapeHtml(bucket.service)} / ${escapeHtml(bucket.unit_type)}</td>
          <td>${escapeHtml(bucket.quantity_decimal)} (${bucket.event_count} eventos)</td>
          <td class="mono">${escapeHtml(bucket.amount_usd_decimal)}</td>
        </tr>`).join("")}</tbody>
      </table></div>`;
  return `
    <section class="panel panel--costs" aria-labelledby="costs-heading">
      <h2 id="costs-heading">Custos por fonte</h2>
      <div class="cost-totals" role="group" aria-label="Totais de custo por origem">${totalCards}</div>
      ${rows}
    </section>
  `;
}

function normalizeModel(inputValue: OperationsConsoleViewModel): OperationsConsoleViewModel {
  const input = plainDataSnapshot(inputValue) as OperationsConsoleViewModel;
  exactKeys(input, ["session", "timeline", "action_receipts", "hypotheses", "cost_buckets", "cost_totals"]);
  const session = input.session;
  if (session === null || typeof session !== "object") throw new OperationsConsoleRenderError();
  exactKeys(session, ["session_id", "status", "channel_type", "region", "state_version", "state_hash", "consent_status", "disclosure_status", "degradation_level", "active_presenter_id", "updated_at"]);
  uuid(session.session_id);
  if (!Object.hasOwn(SESSION_STATUS_LABELS, session.status)) throw new OperationsConsoleRenderError();
  safeText(session.channel_type, 40);
  safeText(session.region, 80);
  safeInteger(session.state_version, 0, 10_000_000);
  sha256(session.state_hash);
  safeText(session.consent_status, 40);
  safeText(session.disclosure_status, 40);
  safeText(session.degradation_level, 40);
  if (session.active_presenter_id !== null) uuid(session.active_presenter_id);
  timestamp(session.updated_at);
  exactKeys(input.timeline, ["items", "after_version", "total_event_count", "next_after_version"]);
  assertCollection(input.timeline.items, MAX_RENDERED_ITEMS);
  safeInteger(input.timeline.after_version, 0, 10_000_000);
  safeInteger(input.timeline.total_event_count, 0, 10_000);
  if (input.timeline.total_event_count !== session.state_version || input.timeline.after_version > session.state_version) {
    throw new OperationsConsoleRenderError();
  }
  if (input.timeline.next_after_version !== null) safeInteger(input.timeline.next_after_version, 1, 10_000_000);
  const eventIds = new Set<string>();
  let expectedVersion = input.timeline.after_version + 1;
  for (const item of input.timeline.items) {
    exactKeys(item, ["event_id", "event_type", "aggregate_version", "occurred_at", "data_classification", "payload_omitted"]);
    uuid(item.event_id);
    if (eventIds.has(item.event_id)) throw new OperationsConsoleRenderError();
    eventIds.add(item.event_id);
    safeText(item.event_type, 200);
    if (safeInteger(item.aggregate_version, 1, 10_000_000) !== expectedVersion) throw new OperationsConsoleRenderError();
    expectedVersion += 1;
    timestamp(item.occurred_at);
    if (!(["public", "internal", "confidential", "restricted"] as const).includes(item.data_classification)) throw new OperationsConsoleRenderError();
    if (item.payload_omitted !== true) throw new OperationsConsoleRenderError();
  }
  const remainingEvents = input.timeline.total_event_count - input.timeline.after_version;
  if (input.timeline.items.length > remainingEvents) throw new OperationsConsoleRenderError();
  if (remainingEvents > 0 && input.timeline.items.length === 0) throw new OperationsConsoleRenderError();
  const expectedNext = input.timeline.items.length < remainingEvents && input.timeline.items.length > 0
    ? input.timeline.items.at(-1)!.aggregate_version
    : null;
  if (input.timeline.next_after_version !== expectedNext) throw new OperationsConsoleRenderError();
  assertCollection(input.action_receipts, MAX_RENDERED_ITEMS);
  for (const receipt of input.action_receipts) {
    exactKeys(receipt, ["execution_id", "intent_id", "tool_contract_id", "action", "status", "policy_outcome", "confirmed_effect", "effect_hash", "attempt", "started_at", "completed_at"]);
    uuid(receipt.execution_id);
    uuid(receipt.intent_id);
    safeText(receipt.tool_contract_id, 200);
    safeText(receipt.action, 200);
    if (!Object.hasOwn(RECEIPT_STATUS_LABELS, receipt.status)) throw new OperationsConsoleRenderError();
    if (!(readonlyIncludes(["allow", "deny", "require_approval"] as const, receipt.policy_outcome))) throw new OperationsConsoleRenderError();
    if (typeof receipt.confirmed_effect !== "boolean") throw new OperationsConsoleRenderError();
    if (receipt.effect_hash !== null) sha256(receipt.effect_hash);
    safeInteger(receipt.attempt, 1, 100);
    const startedAt = timestamp(receipt.started_at);
    const completedAt = receipt.completed_at === null ? null : timestamp(receipt.completed_at);
    if (completedAt !== null && Date.parse(completedAt) < Date.parse(startedAt)) throw new OperationsConsoleRenderError();
    if (receipt.status === "succeeded" && (receipt.effect_hash === null || completedAt === null)) throw new OperationsConsoleRenderError();
    if (receipt.status === "succeeded" && receipt.policy_outcome !== "allow") throw new OperationsConsoleRenderError();
    if (receipt.status !== "succeeded" && receipt.effect_hash !== null) throw new OperationsConsoleRenderError();
    if ((receipt.status === "started" || receipt.status === "pending") && completedAt !== null) throw new OperationsConsoleRenderError();
    if ((receipt.status === "failed" || receipt.status === "unknown" || receipt.status === "cancelled") && completedAt === null) throw new OperationsConsoleRenderError();
    const expectedConfirmation = receipt.policy_outcome === "allow"
      && receipt.status === "succeeded"
      && receipt.effect_hash !== null
      && completedAt !== null;
    if (receipt.confirmed_effect !== expectedConfirmation) throw new OperationsConsoleRenderError();
  }
  assertCollection(input.hypotheses, MAX_RENDERED_ITEMS);
  for (const hypothesis of input.hypotheses) {
    exactKeys(hypothesis, ["hypothesis_id", "label", "status", "confidence_basis_points", "expires_at", "expired"]);
    uuid(hypothesis.hypothesis_id);
    safeText(hypothesis.label, 160);
    if (!(["candidate", "active", "confirmed", "rejected", "expired"] as const).includes(hypothesis.status)) throw new OperationsConsoleRenderError();
    safeInteger(hypothesis.confidence_basis_points, 0, 10_000);
    timestamp(hypothesis.expires_at);
    if (typeof hypothesis.expired !== "boolean") throw new OperationsConsoleRenderError();
    if (hypothesis.status === "expired" && !hypothesis.expired) throw new OperationsConsoleRenderError();
  }
  assertCollection(input.cost_buckets, MAX_RENDERED_ITEMS);
  assertCollection(input.cost_totals, 3);
  for (const bucket of input.cost_buckets) {
    exactKeys(bucket, ["source", "provider_id", "service", "unit_type", "event_count", "quantity_decimal", "amount_usd_decimal"]);
    if (!Object.hasOwn(COST_SOURCE_LABELS, bucket.source)) throw new OperationsConsoleRenderError();
    safeText(bucket.provider_id, 120);
    safeText(bucket.service, 160);
    safeText(bucket.unit_type, 40);
    safeInteger(bucket.event_count, 1, 100_000);
    decimal(bucket.quantity_decimal);
    decimal(bucket.amount_usd_decimal);
  }
  const totalSources = new Set<OperationsCostSource>();
  const bucketTotals: Record<OperationsCostSource, bigint> = { estimated: 0n, measured: 0n, provider_reported: 0n };
  for (const bucket of input.cost_buckets) bucketTotals[bucket.source] += decimalScaled(bucket.amount_usd_decimal);
  for (const total of input.cost_totals) {
    exactKeys(total, ["source", "amount_usd_decimal"]);
    if (!Object.hasOwn(COST_SOURCE_LABELS, total.source) || totalSources.has(total.source)) throw new OperationsConsoleRenderError();
    totalSources.add(total.source);
    decimal(total.amount_usd_decimal);
    if (decimalScaled(total.amount_usd_decimal) !== bucketTotals[total.source]) throw new OperationsConsoleRenderError();
  }
  if (totalSources.size !== 3) throw new OperationsConsoleRenderError();
  return input;
}

function documentShell(titleInput: string, body: string): string {
  const title = safeText(titleInput, 200);
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} | Axtro</title>
  <style>${OPERATIONS_CONSOLE_STYLES}</style>
</head>
<body>${body}</body>
</html>`;
}

function metric(label: string, valueHtml: string): string {
  return `<div class="metric"><dt>${escapeHtml(label)}</dt><dd>${valueHtml}</dd></div>`;
}

function timeElement(input: string): string {
  const value = timestamp(input);
  return `<time datetime="${escapeHtml(value)}">${escapeHtml(value)}</time>`;
}

function formatBasisPoints(value: number): string {
  safeInteger(value, 0, 10_000);
  return `${Math.floor(value / 100)}.${String(value % 100).padStart(2, "0")}%`;
}

function assertCollection(value: readonly unknown[], limit: number): void {
  if (!Array.isArray(value) || value.length > limit) throw new OperationsConsoleRenderError();
}

function uuid(value: unknown): string {
  if (typeof value !== "string" || !UUID_V7_PATTERN.test(value)) throw new OperationsConsoleRenderError();
  return value;
}

function sha256(value: unknown): string {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) throw new OperationsConsoleRenderError();
  return value;
}

function decimal(value: unknown): string {
  if (typeof value !== "string" || !DECIMAL_PATTERN.test(value)) throw new OperationsConsoleRenderError();
  return value;
}

function safeInteger(value: unknown, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new OperationsConsoleRenderError();
  }
  return value;
}

function timestamp(value: unknown): string {
  if (
    typeof value !== "string"
    || value.length > 40
    || BIDI_CONTROL_PATTERN.test(value)
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
  ) throw new OperationsConsoleRenderError();
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new OperationsConsoleRenderError();
  const normalizedInput = value.includes(".")
    ? value.replace(/\.(\d{1,3})Z$/, (_, fractional: string) => `.${fractional.padEnd(3, "0")}Z`)
    : value.replace(/Z$/, ".000Z");
  const iso = parsed.toISOString();
  if (iso !== normalizedInput) throw new OperationsConsoleRenderError();
  return iso;
}

function decimalScaled(value: string): bigint {
  decimal(value);
  return BigInt(value.replace(".", ""));
}

function exactKeys(value: object, expected: readonly string[]): void {
  const keys = Object.keys(value).sort();
  const normalized = [...expected].sort();
  if (keys.length !== normalized.length || keys.some((key, index) => key !== normalized[index])) {
    throw new OperationsConsoleRenderError();
  }
}

function readonlyIncludes<const Values extends readonly string[]>(values: Values, value: unknown): value is Values[number] {
  return typeof value === "string" && values.includes(value);
}

function plainDataSnapshot(value: unknown, state: { nodes: number } = { nodes: 0 }): unknown {
  state.nodes += 1;
  if (state.nodes > MAX_SNAPSHOT_NODES) throw new OperationsConsoleRenderError();
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") {
    if (value.length > 1_000) throw new OperationsConsoleRenderError();
    return value;
  }
  if (typeof value !== "object") throw new OperationsConsoleRenderError();
  try {
    if (Object.getOwnPropertySymbols(value).length > 0) throw new OperationsConsoleRenderError();
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype || value.length > MAX_RENDERED_ITEMS) throw new OperationsConsoleRenderError();
      const names = Object.getOwnPropertyNames(value);
      if (names.length !== value.length + 1 || !names.includes("length")) throw new OperationsConsoleRenderError();
      const copy: unknown[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (descriptor === undefined || !("value" in descriptor)) throw new OperationsConsoleRenderError();
        copy.push(plainDataSnapshot(descriptor.value, state));
      }
      return Object.freeze(copy);
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new OperationsConsoleRenderError();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Object.keys(descriptors);
    if (keys.length > 20) throw new OperationsConsoleRenderError();
    const copy = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (descriptor === undefined || !("value" in descriptor)) throw new OperationsConsoleRenderError();
      Object.defineProperty(copy, key, {
        value: plainDataSnapshot(descriptor.value, state),
        enumerable: true,
        writable: false,
        configurable: false,
      });
    }
    return Object.freeze(copy);
  } catch (error) {
    throw renderError(error);
  }
}

function renderError(error: unknown): OperationsConsoleRenderError {
  return error instanceof OperationsConsoleRenderError ? error : new OperationsConsoleRenderError();
}

function safeText(value: unknown, maximumLength: number): string {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > maximumLength
    || BIDI_CONTROL_PATTERN.test(value)
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
  ) throw new OperationsConsoleRenderError();
  return value;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
