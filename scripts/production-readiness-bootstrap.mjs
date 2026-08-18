#!/usr/bin/env node

import { createHash, randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";

export const PRODUCTION_BOOTSTRAP_VERSION = "m5-02-v1";
export const REQUIRED_SCHEMA_VERSION = 48;

const REQUEST_TIMEOUT_MS = 20_000;
const MAX_RPC_RESPONSE_BYTES = 64 * 1024;
const DEPLOYMENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/;
const CONFIG_FINGERPRINT_PATTERN = /^sha256:[a-f0-9]{64}$/;
const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PRICE_ID_PATTERN = /^price_[A-Za-z0-9]{1,255}$/;
const METER_ID_PATTERN = /^mtr_[A-Za-z0-9_]{1,195}$/;
const RECALL_REGIONS = new Set(["us-east-1", "us-west-2", "eu-central-1", "ap-northeast-1"]);

const REQUIRED_CAPABILITIES = Object.freeze([
  "providerEffectReservations",
  "providerEffectTerminationFence",
  "tavusStageExpiryConcurrencyFence",
  "serviceRoleAppSchemaUsage",
  "providerEffectReconciliation",
  "billingUsageOutbox",
  "recallWebhookDedupe",
  "recallTenantBinding",
  "tavusWebhookCapabilities",
  "tavusWebhookCapabilityLifecycle",
  "tavusCustomerDeliveryReceipts",
  "tavusStageCapabilities",
  "aiUsageReservations",
  "aiUsageReconciliation",
  "workerHeartbeats",
  "providerTranscriptService",
  "authenticatedProviderTranscriptPreclaimBlocked",
  "authenticatedMeetingBotPreclaimBlocked",
  "billingCheckoutIntents",
  "strictSubscriptionIdentity",
  "legacySubscriptionWriterRevoked",
  "costEventSchemaVersion",
  "legacyCostWritersRevoked",
  "runtimeChannelAdmission",
  "runtimeChannelGrantFences",
  "runtimeProviderBindingReceipts",
  "runtimeSceneReceipts",
  "runtimeKillSwitches",
  "runtimeDualOperatorReconciliation",
  "runtimeBridgeReceiptIntegrity",
]);

const SERVICE_ROLE_RPC_PROBE = Object.freeze({
  p_tenant_id: "019f0000-0000-7000-8000-000000004701",
  p_agent_id: "019f0000-0000-7000-8000-000000004702",
  p_channel_kind: "bootstrap_probe",
  p_capability: "bootstrap_probe",
});

const PRICE_CATALOG = Object.freeze([
  Object.freeze({ env: "STRIPE_PRICE_PILOTO_BASE", amount: 49_700, usageType: "licensed" }),
  Object.freeze({ env: "STRIPE_PRICE_PILOTO_OVERAGE", amount: 3_000, usageType: "metered" }),
  Object.freeze({ env: "STRIPE_PRICE_CRESCIMENTO_BASE", amount: 149_700, usageType: "licensed" }),
  Object.freeze({ env: "STRIPE_PRICE_CRESCIMENTO_OVERAGE", amount: 3_000, usageType: "metered" }),
  Object.freeze({ env: "STRIPE_PRICE_ESCALA_BASE", amount: 399_700, usageType: "licensed" }),
  Object.freeze({ env: "STRIPE_PRICE_ESCALA_OVERAGE", amount: 3_000, usageType: "metered" }),
]);

const BILLING_BACKLOG_KEYS = Object.freeze([
  "pending",
  "oldestAgeSeconds",
  "deadLetter",
  "held",
  "oldestHeldAgeSeconds",
  "providerInFlight",
  "unknown",
  "cleanupPending",
  "oldestProviderPendingAgeSeconds",
]);
const PROVIDER_BACKLOG_KEYS = Object.freeze([
  "pending",
  "processing",
  "deadLetter",
  "providerInFlight",
  "unknown",
  "cleanupPending",
  "oldestAgeSeconds",
  "oldestUnknownAgeSeconds",
]);
const AI_BACKLOG_KEYS = Object.freeze([
  "reserved",
  "providerInFlight",
  "unknown",
  "unknownMaxTokens",
  "unknownMaxCostUsd",
  "oldestProviderInFlightAgeSeconds",
  "oldestUnknownAgeSeconds",
  "receiptCount",
]);

export class ProductionReadinessBootstrapError extends Error {
  constructor(code, cause) {
    super(code, cause instanceof Error ? { cause } : undefined);
    this.name = "ProductionReadinessBootstrapError";
    this.code = code;
  }
}

function fail(code, cause) {
  throw new ProductionReadinessBootstrapError(code, cause);
}

function normalizedEnv(env, name) {
  return (env[name] ?? "").trim();
}

function ownRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null ? value : null;
}

function exactKeys(record, expected) {
  const actual = Object.keys(record).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function safeBacklogNumber(key, value) {
  if (key === "unknownMaxCostUsd") return typeof value === "number" && Number.isFinite(value) && value >= 0;
  return Number.isSafeInteger(value) && value >= 0;
}

function parseBacklog(value, keys, zeroKeys, code) {
  const record = ownRecord(value);
  if (!record || !exactKeys(record, keys) || !keys.every((key) => safeBacklogNumber(key, record[key]))) fail(code);
  if (!zeroKeys.every((key) => record[key] === 0)) fail(code);
  return Object.freeze({ ...record });
}

function parseSupabaseUrl(value) {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:"
      || url.username !== ""
      || url.password !== ""
      || url.pathname !== "/"
      || url.search !== ""
      || url.hash !== ""
    ) fail("CONFIG_INVALID");
    return url.origin;
  } catch (error) {
    if (error instanceof ProductionReadinessBootstrapError) throw error;
    fail("CONFIG_INVALID");
  }
}

function deploymentId(env) {
  const value = normalizedEnv(env, "RAILWAY_GIT_COMMIT_SHA") || normalizedEnv(env, "AXTRO_DEPLOYMENT_ID");
  if (!DEPLOYMENT_ID_PATTERN.test(value)) fail("CONFIG_INVALID");
  return value;
}

function stripeApiMode(secretKey) {
  if (/^(?:sk|rk)_test_[A-Za-z0-9_]{8,}$/.test(secretKey)) return "test";
  if (/^(?:sk|rk)_live_[A-Za-z0-9_]{8,}$/.test(secretKey)) return "live";
  fail("CONFIG_INVALID");
}

function fingerprint(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex")}`;
}

export function financialWorkerIdentity(worker, env) {
  const resolvedDeploymentId = deploymentId(env);
  const config = worker === "billing_usage"
    ? {
        schema: "portal-financial-worker-config/v1",
        worker,
        providerMode: "real",
        enabled: normalizedEnv(env, "BILLING_USAGE_OUTBOX_ENABLED"),
        stripeApiMode: stripeApiMode(normalizedEnv(env, "STRIPE_SECRET_KEY")),
        meterName: normalizedEnv(env, "STRIPE_CONVERSATION_OVERAGE_EVENT_NAME"),
        priceCatalog: PRICE_CATALOG.map(({ env: name }) => [name, normalizedEnv(env, name)]),
      }
    : worker === "provider_effect_reconciler"
      ? {
          schema: "portal-financial-worker-config/v1",
          worker,
          providerMode: "real",
          enabled: normalizedEnv(env, "PROVIDER_EFFECT_RECONCILER_ENABLED"),
          providers: [
            ["recall", normalizedEnv(env, "RECALL_API_REGION")],
            ["tavus", "global"],
          ],
        }
      : fail("CONFIG_INVALID");
  const configFingerprint = fingerprint(config);
  if (!CONFIG_FINGERPRINT_PATTERN.test(configFingerprint)) fail("CONFIG_INVALID");
  return Object.freeze({ deploymentId: resolvedDeploymentId, configFingerprint });
}

function validateEnvironment(env) {
  const supabaseOrigin = parseSupabaseUrl(normalizedEnv(env, "NEXT_PUBLIC_SUPABASE_URL"));
  const serviceRoleKey = normalizedEnv(env, "SUPABASE_SERVICE_ROLE_KEY");
  const stripeSecretKey = normalizedEnv(env, "STRIPE_SECRET_KEY");
  const meterEventName = normalizedEnv(env, "STRIPE_CONVERSATION_OVERAGE_EVENT_NAME");
  const priceIds = PRICE_CATALOG.map(({ env: name }) => normalizedEnv(env, name));
  const providerMode = normalizedEnv(env, "PORTAL_FAKE_PROVIDERS");
  if (
    (providerMode !== "" && providerMode !== "0")
    || normalizedEnv(env, "BILLING_USAGE_OUTBOX_ENABLED") !== "true"
    || normalizedEnv(env, "PROVIDER_EFFECT_RECONCILER_ENABLED") !== "true"
    || serviceRoleKey.length < 20
    || /\s/.test(serviceRoleKey)
    || !RECALL_REGIONS.has(normalizedEnv(env, "RECALL_API_REGION"))
    || !/^[a-z][a-z0-9_]{2,79}$/.test(meterEventName)
    || !priceIds.every((priceId) => PRICE_ID_PATTERN.test(priceId))
    || new Set(priceIds).size !== priceIds.length
  ) fail("CONFIG_INVALID");
  const stripeMode = stripeApiMode(stripeSecretKey);
  deploymentId(env);
  return Object.freeze({ supabaseOrigin, serviceRoleKey, stripeSecretKey, stripeMode, meterEventName, priceIds });
}

async function readBoundedJson(response) {
  const contentType = response.headers.get("content-type") ?? "";
  const contentLength = response.headers.get("content-length");
  if (!contentType.toLowerCase().startsWith("application/json")) fail("RPC_RESPONSE_INVALID");
  if (contentLength !== null && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_RPC_RESPONSE_BYTES)) {
    fail("RPC_RESPONSE_INVALID");
  }
  if (response.body === null) fail("RPC_RESPONSE_INVALID");
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RPC_RESPONSE_BYTES) {
      await reader.cancel();
      fail("RPC_RESPONSE_INVALID");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    fail("RPC_RESPONSE_INVALID");
  }
}

function createRpc(configuration, fetchImplementation) {
  const allowedRpcs = new Set([
    "portal_schema_capabilities_service",
    "portal_runtime_channel_status_service",
    "portal_billing_usage_backlog_service",
    "portal_provider_effect_reconciliation_backlog_service",
    "portal_ai_usage_reconciliation_backlog_service",
    "portal_record_worker_heartbeat_service",
  ]);
  return async (name, parameters = {}) => {
    if (!allowedRpcs.has(name)) fail("RPC_NOT_ALLOWED");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response;
    try {
      response = await fetchImplementation(`${configuration.supabaseOrigin}/rest/v1/rpc/${name}`, {
        method: "POST",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          apikey: configuration.serviceRoleKey,
          authorization: `Bearer ${configuration.serviceRoleKey}`,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify(parameters),
      });
    } catch (error) {
      clearTimeout(timer);
      fail("RPC_UNAVAILABLE", error);
    }
    try {
      if (!response.ok) fail("RPC_UNAVAILABLE", new Error(`rpc ${name} responded ${response.status} ${response.statusText || ""}`.trim()));
      return await readBoundedJson(response);
    } finally {
      clearTimeout(timer);
    }
  };
}

function createReadOnlyStripeFetch(fetchImplementation) {
  return async (input, init = {}) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    const allowedPath = /^\/v1\/prices\/price_[A-Za-z0-9]{1,255}$/.test(url.pathname)
      || /^\/v1\/billing\/meters\/mtr_[A-Za-z0-9_]{1,195}$/.test(url.pathname);
    if (
      url.origin !== "https://api.stripe.com"
      || url.search !== ""
      || url.hash !== ""
      || init.method !== "GET"
      || init.body !== undefined
      || !allowedPath
    ) fail("STRIPE_EFFECT_FORBIDDEN");
    return fetchImplementation(url, { ...init, redirect: "manual" });
  };
}

function validateSchema(value) {
  const capabilities = ownRecord(value);
  if (
    !capabilities
    || capabilities.version !== REQUIRED_SCHEMA_VERSION
    || !REQUIRED_CAPABILITIES.every((capability) => capabilities[capability] === true)
  ) fail("SCHEMA_CAPABILITY_MISMATCH");
  return capabilities;
}

function validateServiceRoleRpcProbe(value) {
  const result = ownRecord(value);
  if (!result || Object.keys(result).length !== 1 || result.enabled !== false) {
    fail("SERVICE_ROLE_RPC_PROBE_INVALID");
  }
}

function uuidV7(nowMs = Date.now(), entropy = randomBytes(10)) {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0 || nowMs > 0xffffffffffff || entropy.length !== 10) {
    fail("RUN_ID_GENERATION_FAILED");
  }
  const bytes = new Uint8Array(16);
  let timestamp = BigInt(nowMs);
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = Number(timestamp & 0xffn);
    timestamp >>= 8n;
  }
  bytes.set(entropy, 6);
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Buffer.from(bytes).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function recordHeartbeat(rpc, worker, runId, phase, identity, counters) {
  const receipt = await rpc("portal_record_worker_heartbeat_service", {
    p_worker_kind: worker,
    p_run_id: runId,
    p_phase: phase,
    p_version: PRODUCTION_BOOTSTRAP_VERSION,
    p_deployment_id: identity.deploymentId,
    p_config_fingerprint: identity.configFingerprint,
    p_counters: counters,
  });
  if (receipt !== true) fail("HEARTBEAT_RECEIPT_INVALID");
}

export async function runProductionReadinessBootstrap(dependencies = {}) {
  const env = dependencies.env ?? process.env;
  const fetchImplementation = dependencies.fetchImplementation ?? fetch;
  if (typeof fetchImplementation !== "function") fail("CONFIG_INVALID");
  const configuration = validateEnvironment(env);
  const rpc = createRpc(configuration, fetchImplementation);

  validateSchema(await rpc("portal_schema_capabilities_service"));
  validateServiceRoleRpcProbe(await rpc("portal_runtime_channel_status_service", SERVICE_ROLE_RPC_PROBE));
  const billingBacklog = parseBacklog(
    await rpc("portal_billing_usage_backlog_service"),
    BILLING_BACKLOG_KEYS,
    ["pending", "deadLetter", "held", "providerInFlight", "unknown", "cleanupPending"],
    "BILLING_BACKLOG_NOT_CLEAN",
  );
  const providerBacklog = parseBacklog(
    await rpc("portal_provider_effect_reconciliation_backlog_service"),
    PROVIDER_BACKLOG_KEYS,
    ["pending", "processing", "deadLetter", "providerInFlight", "unknown", "cleanupPending"],
    "PROVIDER_BACKLOG_NOT_CLEAN",
  );
  parseBacklog(
    await rpc("portal_ai_usage_reconciliation_backlog_service"),
    AI_BACKLOG_KEYS,
    ["reserved", "providerInFlight", "unknown", "unknownMaxTokens", "unknownMaxCostUsd", "oldestProviderInFlightAgeSeconds", "oldestUnknownAgeSeconds"],
    "AI_BACKLOG_NOT_CLEAN",
  );

  const stripeCatalog = Object.freeze({
    eventName: configuration.meterEventName,
    livemode: configuration.stripeMode === "live",
    prices: Object.freeze(PRICE_CATALOG.map((entry, index) => Object.freeze({
      priceId: configuration.priceIds[index],
      unitAmountUsdCents: entry.amount,
      usageType: entry.usageType,
    }))),
  });
  let catalogReceipt;
  try {
    const stripeFactory = dependencies.createStripeBillingPort
      ?? (await import("../packages/provider-stripe/dist/index.js")).createStripeBillingPort;
    if (typeof stripeFactory !== "function") fail("STRIPE_CATALOG_MISMATCH");
    const stripe = stripeFactory({
      apiKey: configuration.stripeSecretKey,
      timeoutMs: REQUEST_TIMEOUT_MS,
      fetchImplementation: createReadOnlyStripeFetch(fetchImplementation),
    });
    catalogReceipt = await stripe.verifyBillingCatalog(stripeCatalog);
  } catch (error) {
    if (error instanceof ProductionReadinessBootstrapError) throw error;
    fail("STRIPE_CATALOG_MISMATCH", error);
  }
  if (
    catalogReceipt?.verified !== true
    || catalogReceipt.eventName !== stripeCatalog.eventName
    || catalogReceipt.livemode !== stripeCatalog.livemode
    || catalogReceipt.priceCount !== stripeCatalog.prices.length
    || !METER_ID_PATTERN.test(catalogReceipt.meterId)
  ) fail("STRIPE_CATALOG_MISMATCH");

  const billingIdentity = financialWorkerIdentity("billing_usage", env);
  const providerIdentity = financialWorkerIdentity("provider_effect_reconciler", env);
  const runIdFactory = dependencies.runIdFactory ?? (() => uuidV7());
  const billingRunId = runIdFactory("billing_usage");
  const providerRunId = runIdFactory("provider_effect_reconciler");
  if (!UUID_V7_PATTERN.test(billingRunId) || !UUID_V7_PATTERN.test(providerRunId)) fail("RUN_ID_GENERATION_FAILED");
  const billingCounters = Object.freeze({
    catalogVerified: true,
    leased: 0,
    delivered: 0,
    failed: 0,
    deadLettered: 0,
    backlog: billingBacklog.pending,
    deadLetterBacklog: billingBacklog.deadLetter,
    held: billingBacklog.held,
    providerInFlight: billingBacklog.providerInFlight,
    unknown: billingBacklog.unknown,
    cleanupPending: billingBacklog.cleanupPending,
  });
  const providerCounters = Object.freeze({
    leased: 0,
    reconciled: 0,
    failed: 0,
    deadLettered: 0,
    operatorRequired: 0,
    backlog: providerBacklog.pending,
    processing: providerBacklog.processing,
    deadLetterBacklog: providerBacklog.deadLetter,
    providerInFlight: providerBacklog.providerInFlight,
    unknown: providerBacklog.unknown,
    cleanupPending: providerBacklog.cleanupPending,
  });

  await recordHeartbeat(rpc, "billing_usage", billingRunId, "started", billingIdentity, {});
  await recordHeartbeat(rpc, "billing_usage", billingRunId, "succeeded", billingIdentity, billingCounters);
  await recordHeartbeat(rpc, "provider_effect_reconciler", providerRunId, "started", providerIdentity, {});
  await recordHeartbeat(rpc, "provider_effect_reconciler", providerRunId, "succeeded", providerIdentity, providerCounters);

  return Object.freeze({
    ok: true,
    schemaVersion: REQUIRED_SCHEMA_VERSION,
    bootstrapVersion: PRODUCTION_BOOTSTRAP_VERSION,
    deploymentId: billingIdentity.deploymentId,
    stripeMode: configuration.stripeMode,
    catalogPriceCount: catalogReceipt.priceCount,
    heartbeats: 2,
  });
}

async function main() {
  try {
    const result = await runProductionReadinessBootstrap();
    process.stdout.write(`[production-bootstrap] ready schema=v${result.schemaVersion} version=${result.bootstrapVersion} heartbeats=${result.heartbeats}\n`);
  } catch (error) {
    const code = error instanceof ProductionReadinessBootstrapError ? error.code : "UNEXPECTED_FAILURE";
    const cause = error instanceof ProductionReadinessBootstrapError ? error.cause : undefined;
    // Diagnostic only: cause is always a network/HTTP Error we constructed or
    // caught ourselves, never request headers or body, so it cannot leak the
    // service-role key or other secrets (audited 2026-08-18, D-V2-124).
    const causeText = cause instanceof Error ? ` cause=${cause.name}:${cause.message}` : "";
    process.stderr.write(`[production-bootstrap] failed code=${code}${causeText}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
