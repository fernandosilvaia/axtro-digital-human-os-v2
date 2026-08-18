import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  PRODUCTION_BOOTSTRAP_VERSION,
  ProductionReadinessBootstrapError,
  financialWorkerIdentity,
  runProductionReadinessBootstrap,
} from "../../scripts/production-readiness-bootstrap.mjs";
import { portalFinancialWorkerIdentity } from "../../apps/portal/src/lib/workers/heartbeat.ts";

const BILLING_RUN_ID = "0198f5d0-45c0-7000-8000-000000000201";
const PROVIDER_RUN_ID = "0198f5d0-45c0-7000-8000-000000000202";

const ENV = Object.freeze({
  NEXT_PUBLIC_SUPABASE_URL: "https://production-bootstrap.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "sb_secret_production_bootstrap_tests_20260813",
  PORTAL_FAKE_PROVIDERS: "0",
  RAILWAY_GIT_COMMIT_SHA: "0123456789abcdef0123456789abcdef01234567",
  BILLING_USAGE_OUTBOX_ENABLED: "true",
  PROVIDER_EFFECT_RECONCILER_ENABLED: "true",
  RECALL_API_REGION: "us-west-2",
  STRIPE_SECRET_KEY: "sk_test_production_bootstrap_20260813",
  STRIPE_CONVERSATION_OVERAGE_EVENT_NAME: "axtro_conversation_overage",
  STRIPE_PRICE_PILOTO_BASE: "price_PilotoBase20260813",
  STRIPE_PRICE_PILOTO_OVERAGE: "price_PilotoOverage20260813",
  STRIPE_PRICE_CRESCIMENTO_BASE: "price_CrescimentoBase20260813",
  STRIPE_PRICE_CRESCIMENTO_OVERAGE: "price_CrescimentoOverage20260813",
  STRIPE_PRICE_ESCALA_BASE: "price_EscalaBase20260813",
  STRIPE_PRICE_ESCALA_OVERAGE: "price_EscalaOverage20260813",
});

const SCHEMA = Object.freeze({
  version: 46,
  providerEffectReservations: true,
  providerEffectTerminationFence: true,
  providerEffectReconciliation: true,
  billingUsageOutbox: true,
  recallWebhookDedupe: true,
  recallTenantBinding: true,
  tavusWebhookCapabilities: true,
  tavusWebhookCapabilityLifecycle: true,
  tavusCustomerDeliveryReceipts: true,
  tavusStageCapabilities: true,
  aiUsageReservations: true,
  aiUsageReconciliation: true,
  workerHeartbeats: true,
  providerTranscriptService: true,
  authenticatedProviderTranscriptPreclaimBlocked: true,
  authenticatedMeetingBotPreclaimBlocked: true,
  billingCheckoutIntents: true,
  strictSubscriptionIdentity: true,
  legacySubscriptionWriterRevoked: true,
  costEventSchemaVersion: true,
  legacyCostWritersRevoked: true,
  runtimeChannelAdmission: true,
  runtimeChannelGrantFences: true,
  runtimeProviderBindingReceipts: true,
  runtimeSceneReceipts: true,
  runtimeKillSwitches: true,
  runtimeDualOperatorReconciliation: true,
  runtimeBridgeReceiptIntegrity: true,
});

const BILLING_BACKLOG = Object.freeze({
  pending: 0,
  oldestAgeSeconds: 0,
  deadLetter: 0,
  held: 0,
  oldestHeldAgeSeconds: 0,
  providerInFlight: 0,
  unknown: 0,
  cleanupPending: 0,
  oldestProviderPendingAgeSeconds: 0,
});

const PROVIDER_BACKLOG = Object.freeze({
  pending: 0,
  processing: 0,
  deadLetter: 0,
  providerInFlight: 0,
  unknown: 0,
  cleanupPending: 0,
  oldestAgeSeconds: 0,
  oldestUnknownAgeSeconds: 0,
});

const AI_BACKLOG = Object.freeze({
  reserved: 0,
  providerInFlight: 0,
  unknown: 0,
  unknownMaxTokens: 0,
  unknownMaxCostUsd: 0,
  oldestProviderInFlightAgeSeconds: 0,
  oldestUnknownAgeSeconds: 0,
  receiptCount: 3,
});

const PRICE_DEFINITIONS = new Map([
  [ENV.STRIPE_PRICE_PILOTO_BASE, [49_700, "licensed"]],
  [ENV.STRIPE_PRICE_PILOTO_OVERAGE, [3_000, "metered"]],
  [ENV.STRIPE_PRICE_CRESCIMENTO_BASE, [149_700, "licensed"]],
  [ENV.STRIPE_PRICE_CRESCIMENTO_OVERAGE, [3_000, "metered"]],
  [ENV.STRIPE_PRICE_ESCALA_BASE, [399_700, "licensed"]],
  [ENV.STRIPE_PRICE_ESCALA_OVERAGE, [3_000, "metered"]],
]);

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function fakeFetch(options = {}) {
  const calls = [];
  const fetchImplementation = async (input, init = {}) => {
    const url = new URL(input);
    calls.push({ url: url.href, method: init.method, body: init.body, redirect: init.redirect, headers: init.headers });
    if (url.origin === "https://production-bootstrap.supabase.co") {
      const rpc = url.pathname.split("/").at(-1);
      const parameters = JSON.parse(init.body);
      if (rpc === "portal_schema_capabilities_service") return json(options.schema ?? SCHEMA);
      if (rpc === "portal_billing_usage_backlog_service") return json(options.billingBacklog ?? BILLING_BACKLOG);
      if (rpc === "portal_provider_effect_reconciliation_backlog_service") return json(options.providerBacklog ?? PROVIDER_BACKLOG);
      if (rpc === "portal_ai_usage_reconciliation_backlog_service") return json(options.aiBacklog ?? AI_BACKLOG);
      if (rpc === "portal_record_worker_heartbeat_service") {
        if (options.heartbeatReceipt === false) return json(false);
        return json(true);
      }
      return json({ error: "unexpected RPC" }, 404);
    }
    if (url.origin === "https://api.stripe.com" && url.pathname.startsWith("/v1/prices/")) {
      const priceId = decodeURIComponent(url.pathname.split("/").at(-1));
      const [configuredAmount, usageType] = PRICE_DEFINITIONS.get(priceId) ?? [];
      const amount = options.catalogMismatch && priceId === ENV.STRIPE_PRICE_PILOTO_OVERAGE
        ? 1_000
        : configuredAmount;
      return json({
        id: priceId,
        object: "price",
        active: true,
        currency: "usd",
        livemode: options.livemode ?? false,
        type: "recurring",
        billing_scheme: "per_unit",
        unit_amount: amount,
        recurring: {
          interval: "month",
          interval_count: 1,
          usage_type: usageType,
          meter: usageType === "metered" ? "mtr_axtro_conversation" : null,
        },
      });
    }
    if (url.href === "https://api.stripe.com/v1/billing/meters/mtr_axtro_conversation") {
      return json({
        id: "mtr_axtro_conversation",
        object: "billing.meter",
        status: "active",
        event_name: ENV.STRIPE_CONVERSATION_OVERAGE_EVENT_NAME,
        livemode: options.livemode ?? false,
        default_aggregation: { formula: "sum" },
        customer_mapping: { type: "by_id", event_payload_key: "stripe_customer_id" },
        value_settings: { event_payload_key: "value" },
      });
    }
    return json({ error: "unexpected request" }, 404);
  };
  return { calls, fetchImplementation };
}

function run(options = {}) {
  const transport = fakeFetch(options);
  return {
    ...transport,
    promise: runProductionReadinessBootstrap({
      env: { ...ENV, ...(options.env ?? {}) },
      fetchImplementation: transport.fetchImplementation,
      runIdFactory: (worker) => worker === "billing_usage" ? BILLING_RUN_ID : PROVIDER_RUN_ID,
    }),
  };
}

function isCode(code) {
  return (error) => error instanceof ProductionReadinessBootstrapError && error.code === code;
}

test("schema v44 capability mismatch fails before backlog, Stripe or heartbeat calls", async () => {
  for (const capability of [
    "workerHeartbeats",
    "billingCheckoutIntents",
    "strictSubscriptionIdentity",
    "legacySubscriptionWriterRevoked",
    "costEventSchemaVersion",
    "legacyCostWritersRevoked",
    "providerEffectTerminationFence",
    "runtimeChannelAdmission",
    "runtimeChannelGrantFences",
    "runtimeProviderBindingReceipts",
    "runtimeSceneReceipts",
    "runtimeKillSwitches",
    "runtimeDualOperatorReconciliation",
    "runtimeBridgeReceiptIntegrity",
  ]) {
    for (const absentValue of [false, undefined]) {
      const { calls, promise } = run({ schema: { ...SCHEMA, [capability]: absentValue } });
      await assert.rejects(promise, isCode("SCHEMA_CAPABILITY_MISMATCH"));
      assert.equal(calls.length, 1, `${capability}:${String(absentValue)}`);
      assert.match(calls[0].url, /portal_schema_capabilities_service$/);
    }
  }
});

test("bootstrap requires schema version 46 exactly before any downstream probe", async () => {
  for (const version of [42, 43, 44, 45, undefined]) {
    const { calls, promise } = run({ schema: { ...SCHEMA, version } });
    await assert.rejects(promise, isCode("SCHEMA_CAPABILITY_MISMATCH"));
    assert.equal(calls.length, 1, `version:${String(version)}`);
    assert.match(calls[0].url, /portal_schema_capabilities_service$/);
  }
});

test("Checkout capability SQL covers every bootstrap-gated service RPC", () => {
  const migration = readFileSync(
    new URL("../../database/supabase-only/0042_cost_event_schema_and_legacy_writer_contract.sql", import.meta.url),
    "utf8",
  );
  const checkoutCapability = migration.match(
    /'billingCheckoutIntents',[\s\S]*?'strictSubscriptionIdentity'/,
  )?.[0];
  assert.ok(checkoutCapability, "billingCheckoutIntents capability block is required");
  for (const rpc of [
    "portal_begin_billing_checkout_intent_service",
    "portal_mark_billing_checkout_dispatched_service",
    "portal_bind_billing_checkout_session_service",
    "portal_release_billing_checkout_intent_service",
    "portal_apply_billing_checkout_event_service",
    "portal_apply_tenant_subscription_event_service",
  ]) {
    assert.match(checkoutCapability, new RegExp(`to_regprocedure\\('public\\.${rpc}\\(`), rpc);
  }
});

test("any critical financial backlog fails before Stripe and heartbeat writes", async () => {
  for (const [options, code] of [
    [{ billingBacklog: { ...BILLING_BACKLOG, held: 1 } }, "BILLING_BACKLOG_NOT_CLEAN"],
    [{ providerBacklog: { ...PROVIDER_BACKLOG, processing: 1 } }, "PROVIDER_BACKLOG_NOT_CLEAN"],
    [{ aiBacklog: { ...AI_BACKLOG, unknown: 1, unknownMaxTokens: 20_512, unknownMaxCostUsd: 1.25 } }, "AI_BACKLOG_NOT_CLEAN"],
    [{ billingBacklog: { ...BILLING_BACKLOG, pending: 0.5 } }, "BILLING_BACKLOG_NOT_CLEAN"],
  ]) {
    const { calls, promise } = run(options);
    await assert.rejects(promise, isCode(code));
    assert.equal(calls.filter((call) => call.url.includes("api.stripe.com")).length, 0);
    assert.equal(calls.filter((call) => call.url.endsWith("portal_record_worker_heartbeat_service")).length, 0);
  }
});

test("semantic Stripe mismatch uses GET only and fails before heartbeat writes", async () => {
  const { calls, promise } = run({ catalogMismatch: true });
  await assert.rejects(promise, isCode("STRIPE_CATALOG_MISMATCH"));
  const stripeCalls = calls.filter((call) => call.url.includes("api.stripe.com"));
  assert.ok(stripeCalls.length > 0);
  assert.ok(stripeCalls.every((call) => call.method === "GET" && call.body === undefined && call.redirect === "manual"));
  assert.equal(calls.filter((call) => call.url.endsWith("portal_record_worker_heartbeat_service")).length, 0);
});

test("a non-true heartbeat RPC receipt fails closed", async () => {
  const { calls, promise } = run({ heartbeatReceipt: false });
  await assert.rejects(promise, isCode("HEARTBEAT_RECEIPT_INVALID"));
  assert.equal(calls.filter((call) => call.url.endsWith("portal_record_worker_heartbeat_service")).length, 1);
});

test("happy path validates all read-only probes then persists exact versioned heartbeat phases", async () => {
  const { calls, promise } = run();
  assert.deepEqual(await promise, {
    ok: true,
    schemaVersion: 46,
    bootstrapVersion: PRODUCTION_BOOTSTRAP_VERSION,
    deploymentId: ENV.RAILWAY_GIT_COMMIT_SHA,
    stripeMode: "test",
    catalogPriceCount: 6,
    heartbeats: 2,
  });

  const stripeCalls = calls.filter((call) => call.url.includes("api.stripe.com"));
  assert.equal(stripeCalls.length, 7);
  assert.ok(stripeCalls.every((call) => call.method === "GET" && call.body === undefined));
  const heartbeatCalls = calls
    .filter((call) => call.url.endsWith("portal_record_worker_heartbeat_service"))
    .map((call) => JSON.parse(call.body));
  assert.equal(heartbeatCalls.length, 4);
  assert.deepEqual(heartbeatCalls.map((call) => [call.p_worker_kind, call.p_phase]), [
    ["billing_usage", "started"],
    ["billing_usage", "succeeded"],
    ["provider_effect_reconciler", "started"],
    ["provider_effect_reconciler", "succeeded"],
  ]);
  assert.ok(heartbeatCalls.every((call) => call.p_version === PRODUCTION_BOOTSTRAP_VERSION));
  assert.ok(heartbeatCalls.every((call) => call.p_deployment_id === ENV.RAILWAY_GIT_COMMIT_SHA));
  assert.deepEqual(heartbeatCalls[0].p_counters, {});
  assert.equal(heartbeatCalls[1].p_counters.catalogVerified, true);
  assert.equal(heartbeatCalls[1].p_counters.unknown, 0);
  assert.equal(heartbeatCalls[3].p_counters.operatorRequired, 0);
});

test("an explicitly configured live Stripe catalog is verified with read-only GETs", async () => {
  const { calls, promise } = run({
    env: { STRIPE_SECRET_KEY: "sk_live_production_bootstrap_20260813" },
    livemode: true,
  });
  const result = await promise;
  assert.equal(result.stripeMode, "live");
  const stripeCalls = calls.filter((call) => call.url.includes("api.stripe.com"));
  assert.equal(stripeCalls.length, 7);
  assert.ok(stripeCalls.every((call) => call.method === "GET" && call.body === undefined && call.redirect === "manual"));
});

test("bootstrap and portal compute the same deployment/config fingerprints", () => {
  assert.deepEqual(
    financialWorkerIdentity("billing_usage", { ...ENV }),
    portalFinancialWorkerIdentity("billing_usage", { ...ENV }),
  );
  assert.deepEqual(
    financialWorkerIdentity("provider_effect_reconciler", { ...ENV }),
    portalFinancialWorkerIdentity("provider_effect_reconciler", { ...ENV }),
  );
});

test("bootstrap and portal both prefer Railway commit identity over a distinct explicit fallback", () => {
  const railwayCommit = "0123456789abcdef0123456789abcdef01234567";
  const explicitDeployment = "explicit-deployment-fallback";
  const env = {
    ...ENV,
    RAILWAY_GIT_COMMIT_SHA: railwayCommit,
    AXTRO_DEPLOYMENT_ID: explicitDeployment,
  };
  assert.notEqual(railwayCommit, explicitDeployment);

  for (const worker of ["billing_usage", "provider_effect_reconciler"]) {
    const bootstrapIdentity = financialWorkerIdentity(worker, env);
    const portalIdentity = portalFinancialWorkerIdentity(worker, env);
    assert.equal(bootstrapIdentity.deploymentId, railwayCommit);
    assert.equal(portalIdentity.deploymentId, railwayCommit);
    assert.deepEqual(bootstrapIdentity, portalIdentity);
  }
});

test("CLI failure output is closed and never prints configured secrets", () => {
  const secretMarker = "sb_secret_MUST_NOT_APPEAR_IN_OUTPUT_20260813";
  const result = spawnSync(process.execPath, [
    new URL("../../scripts/production-readiness-bootstrap.mjs", import.meta.url).pathname,
  ], {
    encoding: "utf8",
    env: {
      NEXT_PUBLIC_SUPABASE_URL: ENV.NEXT_PUBLIC_SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: secretMarker,
      PORTAL_FAKE_PROVIDERS: "1",
    },
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "[production-bootstrap] failed code=CONFIG_INVALID\n");
  assert.equal(result.stderr.includes(secretMarker), false);
});
