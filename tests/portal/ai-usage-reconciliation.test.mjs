import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import test from "node:test";

import {
  AiUsageReconciliationUnavailableError,
  authorizeAiUsageReconciliation,
  manuallyReconcileAiUsage,
  parseAiUsageReconciliationInput,
  readAiUsageReconciliationBacklog,
} from "../../apps/portal/src/lib/ai-budget/reconciliation.ts";

const RECEIPT_ID = "0198f5d0-45c0-7000-8000-000000000001";
const RESERVATION_ID = "0198f5d0-45c0-7000-8000-000000000002";
const COST_EVENT_ID = "0198f5d0-45c0-7000-8000-000000000003";
const SECRET = "ai-usage-reconcile-secret-for-tests";

const BACKLOG = Object.freeze({
  reserved: 2,
  providerInFlight: 1,
  unknown: 3,
  unknownMaxTokens: 61_536,
  unknownMaxCostUsd: 0.15,
  oldestProviderInFlightAgeSeconds: 12,
  oldestUnknownAgeSeconds: 120,
  receiptCount: 4,
});

const NO_CHARGE_INPUT = Object.freeze({
  receiptId: RECEIPT_ID,
  reservationId: RESERVATION_ID,
  evidence: "provider_invoice_no_charge",
  providerReceiptRef: "openrouter:invoice:2026-08:no-charge:001",
  actualInputTokens: null,
  actualOutputTokens: null,
  reportedCostUsd: null,
});

const USAGE_INPUT = Object.freeze({
  ...NO_CHARGE_INPUT,
  evidence: "provider_invoice_usage_confirmed",
  providerReceiptRef: "openrouter:invoice:2026-08:line:002",
  actualInputTokens: 1_200,
  actualOutputTokens: 48,
  reportedCostUsd: 0.0042,
});

function ok(data) {
  return { data, error: null };
}

test("operator bearer is constant-time checked and requires a configured 24-character secret", () => {
  assert.equal(authorizeAiUsageReconciliation(`Bearer ${SECRET}`, undefined), "not_configured");
  assert.equal(authorizeAiUsageReconciliation(`Bearer ${SECRET}`, "short"), "not_configured");
  assert.equal(authorizeAiUsageReconciliation(null, SECRET), "unauthorized");
  assert.equal(authorizeAiUsageReconciliation("Basic ignored", SECRET), "unauthorized");
  assert.equal(authorizeAiUsageReconciliation(`Bearer ${"x".repeat(SECRET.length)}`, SECRET), "unauthorized");
  assert.equal(authorizeAiUsageReconciliation(`Bearer ${SECRET}`, SECRET), "authorized");
});

test("manual input accepts exact provider-invoice evidence without tenant or actor authority", () => {
  assert.deepEqual(parseAiUsageReconciliationInput(NO_CHARGE_INPUT), NO_CHARGE_INPUT);
  assert.deepEqual(parseAiUsageReconciliationInput(USAGE_INPUT), USAGE_INPUT);

  for (const invalid of [
    { ...NO_CHARGE_INPUT, tenantId: RESERVATION_ID },
    { ...NO_CHARGE_INPUT, actorId: RESERVATION_ID },
    { ...NO_CHARGE_INPUT, receiptId: "not-uuidv7" },
    { ...NO_CHARGE_INPUT, providerReceiptRef: "https://provider.example/invoice?secret=x" },
    { ...NO_CHARGE_INPUT, actualInputTokens: 0 },
    { ...USAGE_INPUT, actualInputTokens: null },
    { ...USAGE_INPUT, actualInputTokens: 0, actualOutputTokens: 0 },
    { ...USAGE_INPUT, actualOutputTokens: 1.5 },
    { ...USAGE_INPUT, reportedCostUsd: -0.01 },
    { ...USAGE_INPUT, evidence: "operator_asserted" },
  ]) {
    assert.throws(() => parseAiUsageReconciliationInput(invalid), TypeError);
  }
});

test("backlog uses only the read-only service RPC and requires an exact non-negative receipt", async () => {
  const calls = [];
  const client = {
    async rpc(name, parameters) {
      calls.push([name, parameters]);
      return ok(BACKLOG);
    },
  };
  assert.deepEqual(await readAiUsageReconciliationBacklog(client), BACKLOG);
  assert.deepEqual(calls, [["portal_ai_usage_reconciliation_backlog_service", undefined]]);

  for (const data of [
    { ...BACKLOG, unknown: -1 },
    { ...BACKLOG, unknownMaxCostUsd: Number.NaN },
    { ...BACKLOG, tenantId: RESERVATION_ID },
    null,
  ]) {
    await assert.rejects(
      () => readAiUsageReconciliationBacklog({ rpc: async () => ok(data) }),
      AiUsageReconciliationUnavailableError,
    );
  }
  await assert.rejects(
    () => readAiUsageReconciliationBacklog({ rpc: async () => ({ data: null, error: { message: "database detail" } }) }),
    AiUsageReconciliationUnavailableError,
  );
});

test("no-charge invoice releases only through the audited RPC and returns its strict receipt", async () => {
  const calls = [];
  const receipt = { reconciled: true, replayed: false, state: "released", costEventId: null };
  const client = {
    async rpc(name, parameters) {
      calls.push([name, parameters]);
      return ok(receipt);
    },
  };
  assert.deepEqual(await manuallyReconcileAiUsage(NO_CHARGE_INPUT, client), receipt);
  assert.deepEqual(calls, [["portal_reconcile_ai_usage_service", {
    p_receipt_id: RECEIPT_ID,
    p_reservation_id: RESERVATION_ID,
    p_evidence: "provider_invoice_no_charge",
    p_provider_receipt_ref: NO_CHARGE_INPUT.providerReceiptRef,
    p_actual_input_tokens: null,
    p_actual_output_tokens: null,
    p_reported_cost_usd: null,
  }]]);
  assert.equal("p_tenant_id" in calls[0][1], false);
  assert.equal("p_actor_id" in calls[0][1], false);
});

test("confirmed provider usage commits exact invoice values and replay returns the durable receipt", async () => {
  const calls = [];
  let attempt = 0;
  const client = {
    async rpc(name, parameters) {
      calls.push([name, parameters]);
      attempt += 1;
      return ok({ reconciled: true, replayed: attempt > 1, state: "committed", costEventId: COST_EVENT_ID });
    },
  };
  const first = await manuallyReconcileAiUsage(USAGE_INPUT, client);
  const replay = await manuallyReconcileAiUsage(USAGE_INPUT, client);
  assert.deepEqual(first, { reconciled: true, replayed: false, state: "committed", costEventId: COST_EVENT_ID });
  assert.deepEqual(replay, { reconciled: true, replayed: true, state: "committed", costEventId: COST_EVENT_ID });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], calls[1], "replay must submit exactly the same evidence receipt");
  assert.equal(calls[0][1].p_actual_input_tokens, 1_200);
  assert.equal(calls[0][1].p_actual_output_tokens, 48);
  assert.equal(calls[0][1].p_reported_cost_usd, 0.0042);
});

test("RPC errors and malformed or evidence-inconsistent receipts fail closed", async () => {
  await assert.rejects(
    () => manuallyReconcileAiUsage(USAGE_INPUT, { rpc: async () => ({ data: null, error: { message: "conflict" } }) }),
    AiUsageReconciliationUnavailableError,
  );
  await assert.rejects(
    () => manuallyReconcileAiUsage(USAGE_INPUT, { rpc: async () => { throw new Error("raw provider reference must not escape"); } }),
    (error) => error instanceof AiUsageReconciliationUnavailableError
      && error.message === "AI usage reconciliation RPC failed",
  );
  await assert.rejects(
    () => manuallyReconcileAiUsage(USAGE_INPUT, { rpc: async () => undefined }),
    AiUsageReconciliationUnavailableError,
  );
  for (const data of [
    { reconciled: true, replayed: false, state: "committed", costEventId: null },
    { reconciled: true, replayed: false, state: "released", costEventId: null },
    { reconciled: true, replayed: false, state: "committed", costEventId: COST_EVENT_ID, tenantId: RESERVATION_ID },
    { reconciled: false, replayed: false, state: "committed", costEventId: COST_EVENT_ID },
  ]) {
    await assert.rejects(
      () => manuallyReconcileAiUsage(USAGE_INPUT, { rpc: async () => ok(data) }),
      AiUsageReconciliationUnavailableError,
    );
  }
});

test("operator surface has no TTL, scheduler or bare release path", async () => {
  const source = await readFile(
    new URL("../../apps/portal/src/lib/ai-budget/reconciliation.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /portal_release_ai_usage_service/);
  assert.doesNotMatch(source, /setTimeout|expiresAt|expires_at|ttl/i);
  assert.match(source, /portal_ai_usage_reconciliation_backlog_service/);
  assert.match(source, /portal_reconcile_ai_usage_service/);
});

const routeState = {
  backlogCalls: 0,
  backlogError: false,
};
globalThis.__aiUsageReconciliationRouteState = routeState;

const routeMocks = new Map([
  ["next/server", `
    export class NextRequest {}
    export class NextResponse extends Response {
      static json(body, init = {}) {
        const headers = new Headers(init.headers);
        headers.set("content-type", "application/json");
        return new Response(JSON.stringify(body), { ...init, headers });
      }
    }
  `],
  ["@/lib/ai-budget/reconciliation", `
    export function authorizeAiUsageReconciliation(header, expected) {
      if (!expected || expected.trim().length < 24) return "not_configured";
      return header === "Bearer " + expected.trim() ? "authorized" : "unauthorized";
    }
    export async function readAiUsageReconciliationBacklog() {
      const state = globalThis.__aiUsageReconciliationRouteState;
      state.backlogCalls += 1;
      if (state.backlogError) throw new Error("backlog failed");
      return ${JSON.stringify(BACKLOG)};
    }
  `],
  ["@/lib/telemetry", `export function logError() {} export function logEvent() {}`],
]);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (routeMocks.has(specifier)) {
      return { url: `ai-usage-route-mock:${encodeURIComponent(specifier)}`, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith("ai-usage-route-mock:")) {
      const specifier = decodeURIComponent(url.slice("ai-usage-route-mock:".length));
      return { format: "module", source: routeMocks.get(specifier), shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

process.env.AI_USAGE_RECONCILE_SECRET = SECRET;
const { GET: getBacklog } = await import("../../apps/portal/src/app/api/internal/ai-usage/route.ts");
const { POST: postManual } = await import("../../apps/portal/src/app/api/internal/ai-usage/manual/route.ts");

function resetRouteState() {
  Object.assign(routeState, { backlogCalls: 0, backlogError: false });
}

test("backlog route authenticates before database and returns the exact no-store response", { concurrency: false }, async () => {
  resetRouteState();
  const unauthorized = await getBacklog({ headers: new Headers({ authorization: "Bearer wrong" }) });
  assert.equal(unauthorized.status, 401);
  assert.deepEqual(await unauthorized.json(), { error: "unauthorized" });
  assert.equal(routeState.backlogCalls, 0);

  const response = await getBacklog({ headers: new Headers({ authorization: `Bearer ${SECRET}` }) });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { ok: true, backlog: BACKLOG });
  assert.equal(routeState.backlogCalls, 1);
});

test("manual route is indistinguishable 404 and touches no request data or database", { concurrency: false }, async () => {
  resetRouteState();
  let requestPropertiesRead = 0;
  const opaqueRequest = new Proxy({}, {
    get() {
      requestPropertiesRead += 1;
      throw new Error("closed manual route must not inspect the request");
    },
  });
  const response = await postManual(opaqueRequest);
  assert.equal(response.status, 404);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { error: "not_found" });
  assert.equal(requestPropertiesRead, 0);
  assert.equal(routeState.backlogCalls, 0);

  const source = await readFile(
    new URL("../../apps/portal/src/app/api/internal/ai-usage/manual/route.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /authorizeAiUsageReconciliation|readBoundedTextBody|manuallyReconcileAiUsage|createServiceRoleClient/);
});

test("backlog RPC failure maps to a no-store 503 without provider or tenant details", { concurrency: false }, async () => {
  resetRouteState();
  routeState.backlogError = true;
  const response = await getBacklog({ headers: new Headers({ authorization: `Bearer ${SECRET}` }) });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { error: "reconciliation_unavailable" });
});
