import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import test from "node:test";

const root = fileURLToPath(new URL("../..", import.meta.url));
const domain = await import(pathToFileURL(join(root, "packages/domain/dist/index.js")).href);
const ui = await import(pathToFileURL(join(root, "packages/ui/dist/index.js")).href);

function id(offset) {
  return domain.uuidV7FromParts(
    1_721_000_000_000 + offset,
    Uint8Array.from(Array.from({ length: 10 }, (_, index) => (offset + index + 47) & 0xff)),
  );
}

function model() {
  return {
    session: {
      session_id: id(1),
      status: "active",
      channel_type: "api",
      region: "local",
      state_version: 2,
      state_hash: "a".repeat(64),
      consent_status: "granted",
      disclosure_status: "delivered",
      degradation_level: "none",
      active_presenter_id: id(2),
      updated_at: "2026-07-15T12:00:02.000Z",
    },
    timeline: {
      items: [
        {
          event_id: id(10),
          event_type: "session.created",
          aggregate_version: 1,
          occurred_at: "2026-07-15T12:00:00.000Z",
          data_classification: "internal",
          payload_omitted: true,
        },
        {
          event_id: id(11),
          event_type: "session.activated",
          aggregate_version: 2,
          occurred_at: "2026-07-15T12:00:02.000Z",
          data_classification: "restricted",
          payload_omitted: true,
        },
      ],
      after_version: 0,
      total_event_count: 2,
      next_after_version: null,
    },
    action_receipts: [{
      execution_id: id(20),
      intent_id: id(21),
      tool_contract_id: "catalog.lookup",
      action: "get_plan",
      status: "succeeded",
      policy_outcome: "allow",
      confirmed_effect: true,
      effect_hash: "b".repeat(64),
      attempt: 1,
      started_at: "2026-07-15T12:00:03.000Z",
      completed_at: "2026-07-15T12:00:04.000Z",
    }],
    hypotheses: [{
      hypothesis_id: id(30),
      label: "Interesse em plano anual",
      status: "active",
      confidence_basis_points: 7250,
      expires_at: "2026-07-15T12:10:00.000Z",
      expired: false,
    }],
    cost_buckets: [{
      source: "estimated",
      provider_id: "local-model-fake",
      service: "catalog",
      unit_type: "request",
      event_count: 1,
      quantity_decimal: "1.00000000",
      amount_usd_decimal: "0.02000000",
    }],
    cost_totals: [
      { source: "estimated", amount_usd_decimal: "0.02000000" },
      { source: "measured", amount_usd_decimal: "0.00000000" },
      { source: "provider_reported", amount_usd_decimal: "0.00000000" },
    ],
  };
}

test("populated console renders canonical metadata, distinct evidence labels and exact source totals", () => {
  const html = ui.renderOperationsConsoleDocument(model());
  assert.match(html, /Operações da sessão/);
  assert.match(html, /Timeline canônica/);
  assert.match(html, /Receipt confirmado/);
  assert.match(html, /data-evidence-kind="receipt"/);
  assert.match(html, /Hipótese, não verificada/);
  assert.match(html, /data-evidence-kind="hypothesis"/);
  assert.match(html, /USD 0\.02000000/);
  assert.match(html, /Reportado pelo provider/);
  assert.match(html, /Payload omitido por segurança/);
  assert.doesNotMatch(html, /payload_json|result_json|arguments_json|external_session_ref|provider_code/);
});

test("empty, loading and error documents remain explicit and script free", () => {
  const empty = model();
  empty.action_receipts = [];
  empty.hypotheses = [];
  empty.cost_buckets = [];
  empty.cost_totals = [
    { source: "estimated", amount_usd_decimal: "0.00000000" },
    { source: "measured", amount_usd_decimal: "0.00000000" },
    { source: "provider_reported", amount_usd_decimal: "0.00000000" },
  ];
  const emptyHtml = ui.renderOperationsConsoleDocument(empty);
  assert.match(emptyHtml, /Nenhum receipt de ação/);
  assert.match(emptyHtml, /Nenhum custo atribuído/);

  const loading = ui.renderOperationsConsoleLoadingDocument(empty.session.session_id);
  assert.match(loading, /role="status"/);
  assert.match(loading, /aria-busy="true"/);

  const error = ui.renderOperationsConsoleErrorDocument("unavailable", id(40));
  assert.match(error, /role="alert"/);
  assert.match(error, /Dados indisponíveis/);
  assert.match(error, new RegExp(id(40)));
  for (const html of [emptyHtml, loading, error]) assert.doesNotMatch(html, /<script\b/i);
});

test("untrusted text is escaped and bidi controls, getters and invalid evidence fail closed", () => {
  const xss = model();
  xss.action_receipts[0].tool_contract_id = '<img src=x onerror="globalThis.pwned=1">';
  xss.action_receipts[0].action = "</style><script>pwned()</script>";
  xss.hypotheses[0].label = "javascript:alert(1) & annual";
  const html = ui.renderOperationsConsoleDocument(xss);
  assert.doesNotMatch(html, /<img src=x|<script>pwned/);
  assert.match(html, /&lt;img src=x onerror=&quot;globalThis\.pwned=1&quot;&gt;/);
  assert.match(html, /&lt;\/style&gt;&lt;script&gt;pwned\(\)&lt;\/script&gt;/);
  assert.match(html, /javascript:alert\(1\) &amp; annual/);

  const bidi = model();
  bidi.hypotheses[0].label = "safe\u202eevil";
  assert.throws(() => ui.renderOperationsConsoleDocument(bidi), ui.OperationsConsoleRenderError);

  const accessor = model();
  Object.defineProperty(accessor.timeline.items[0], "aggregate_version", { enumerable: true, get: () => 1 });
  assert.throws(() => ui.renderOperationsConsoleDocument(accessor), ui.OperationsConsoleRenderError);

  assert.throws(
    () => ui.renderEvidenceLabel({ kind: "receipt", status: "failed", confirmed: true }),
    ui.OperationsConsoleRenderError,
  );
  assert.throws(
    () => ui.renderEvidenceLabel({ kind: "invented", expired: false }),
    ui.OperationsConsoleRenderError,
  );
});

test("timeline, receipt and financial contradictions are rejected before rendering", () => {
  const gap = model();
  gap.timeline.items[1].aggregate_version = 1;
  assert.throws(() => ui.renderOperationsConsoleDocument(gap), ui.OperationsConsoleRenderError);

  const ungoverned = model();
  ungoverned.action_receipts[0].policy_outcome = "deny";
  ungoverned.action_receipts[0].confirmed_effect = false;
  assert.throws(() => ui.renderOperationsConsoleDocument(ungoverned), ui.OperationsConsoleRenderError);

  const earlyCompletion = model();
  earlyCompletion.action_receipts[0].completed_at = "2026-07-15T12:00:01.000Z";
  assert.throws(() => ui.renderOperationsConsoleDocument(earlyCompletion), ui.OperationsConsoleRenderError);

  const falseTotal = model();
  falseTotal.cost_totals[0].amount_usd_decimal = "999.00000000";
  assert.throws(() => ui.renderOperationsConsoleDocument(falseTotal), ui.OperationsConsoleRenderError);

  const incompleteTotals = model();
  incompleteTotals.cost_totals.pop();
  assert.throws(() => ui.renderOperationsConsoleDocument(incompleteTotals), ui.OperationsConsoleRenderError);

  const hiddenRemainder = model();
  hiddenRemainder.timeline.items = [];
  assert.throws(() => ui.renderOperationsConsoleDocument(hiddenRemainder), ui.OperationsConsoleRenderError);
});

test("renderer accepts the documented simultaneous 100-row caps without weakening validation", () => {
  const maximum = model();
  maximum.session.state_version = 100;
  maximum.timeline.items = Array.from({ length: 100 }, (_, index) => ({
    event_id: id(1_000 + index),
    event_type: "session.degraded",
    aggregate_version: index + 1,
    occurred_at: new Date(Date.parse("2026-07-15T12:00:00.000Z") + index).toISOString(),
    data_classification: "internal",
    payload_omitted: true,
  }));
  maximum.timeline.total_event_count = 100;
  maximum.action_receipts = Array.from({ length: 100 }, (_, index) => ({
    execution_id: id(2_000 + (index * 2)),
    intent_id: id(2_001 + (index * 2)),
    tool_contract_id: "catalog.lookup",
    action: "get_plan",
    status: "succeeded",
    policy_outcome: "allow",
    confirmed_effect: true,
    effect_hash: "b".repeat(64),
    attempt: 1,
    started_at: "2026-07-15T12:00:03.000Z",
    completed_at: "2026-07-15T12:00:04.000Z",
  }));
  maximum.hypotheses = Array.from({ length: 100 }, (_, index) => ({
    hypothesis_id: id(3_000 + index),
    label: `Hipótese ${index}`,
    status: "active",
    confidence_basis_points: 5000,
    expires_at: "2026-07-15T12:10:00.000Z",
    expired: false,
  }));
  maximum.cost_buckets = Array.from({ length: 100 }, () => ({
    source: "estimated",
    provider_id: "local-model-fake",
    service: "catalog",
    unit_type: "request",
    event_count: 1,
    quantity_decimal: "1.00000000",
    amount_usd_decimal: "0.01000000",
  }));
  maximum.cost_totals = [
    { source: "estimated", amount_usd_decimal: "1.00000000" },
    { source: "measured", amount_usd_decimal: "0.00000000" },
    { source: "provider_reported", amount_usd_decimal: "0.00000000" },
  ];
  const html = ui.renderOperationsConsoleDocument(maximum);
  assert.match(html, /100 eventos autorizados/);
  assert.equal((html.match(/data-evidence-kind="receipt"/g) ?? []).length, 100);
  assert.equal((html.match(/data-evidence-kind="hypothesis"/g) ?? []).length, 100);
});
