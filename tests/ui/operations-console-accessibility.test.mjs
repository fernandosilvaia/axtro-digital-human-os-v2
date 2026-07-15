import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import test from "node:test";

const root = fileURLToPath(new URL("../..", import.meta.url));
const domain = await import(pathToFileURL(join(root, "packages/domain/dist/index.js")).href);
const ui = await import(pathToFileURL(join(root, "packages/ui/dist/index.js")).href);

function id(offset) {
  return domain.uuidV7FromParts(1_721_100_000_000 + offset, Uint8Array.from({ length: 10 }, (_, index) => offset + index));
}

function accessibleModel() {
  return {
    session: {
      session_id: id(1), status: "ready", channel_type: "api", region: "local", state_version: 1,
      state_hash: "c".repeat(64), consent_status: "granted", disclosure_status: "delivered",
      degradation_level: "none", active_presenter_id: null, updated_at: "2026-07-15T13:00:00.000Z",
    },
    timeline: {
      items: [{
        event_id: id(2), event_type: "session.created", aggregate_version: 1,
        occurred_at: "2026-07-15T13:00:00.000Z", data_classification: "internal", payload_omitted: true,
      }],
      after_version: 0, total_event_count: 1, next_after_version: null,
    },
    action_receipts: [], hypotheses: [], cost_buckets: [],
    cost_totals: [
      { source: "estimated", amount_usd_decimal: "0.00000000" },
      { source: "measured", amount_usd_decimal: "0.00000000" },
      { source: "provider_reported", amount_usd_decimal: "0.00000000" },
    ],
  };
}

test("operations console passes the deterministic accessibility smoke contract", () => {
  const html = ui.renderOperationsConsoleDocument(accessibleModel());
  assert.match(html, /^<!doctype html>\s*<html lang="pt-BR">/);
  assert.equal((html.match(/<main\b/g) ?? []).length, 1);
  assert.equal((html.match(/<h1\b/g) ?? []).length, 1);
  assert.equal((html.match(/id="conteudo"/g) ?? []).length, 1);
  assert.match(html, /class="skip-link" href="#conteudo"/);
  assert.match(html, /<ol class="timeline" role="list">/);
  assert.match(html, /<time datetime="2026-07-15T13:00:00\.000Z">/);
  assert.match(html, /role="group" aria-label="Totais de custo por origem"/);
  assert.doesNotMatch(html, /tabindex="[1-9]/);
  assert.doesNotMatch(html, /<h3\b|<h4\b/);
  assert.doesNotMatch(html, /\s+on[a-z]+\s*=|javascript:/i);
});
