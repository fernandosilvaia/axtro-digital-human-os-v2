import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

const mockSources = new Map([
  ["next/server", `
    export class NextResponse extends Response {
      static json(body, init = {}) {
        const headers = new Headers(init.headers);
        headers.set("content-type", "application/json");
        return new NextResponse(JSON.stringify(body), { ...init, headers });
      }
    }
  `],
  ["@axtro/provider-recall", `
    export function isRecallRegion(value) { return value === "us-west-2"; }
    export function parseRecallTranscriptDownloadHosts(value) { return value === "download.test" ? [value] : null; }
    export function recallApiBaseUrl() { return "https://us-west-2.recall.ai"; }
  `],
  ["@/lib/meetings/webhook", `
    export function isRecallWebhookSecretConfigured(value) { return value === "whsec_valid_readiness_test"; }
  `],
  ["@/lib/supabase/service", `
    export function createServiceRoleClient() { throw new Error("test must inject readiness client"); }
  `],
  ["@/lib/telemetry", `export function logError() {}`],
  ["@/lib/workers/heartbeat", `
    export const PORTAL_FINANCIAL_WORKER_VERSION = "m5-02-v1";
    export const PORTAL_MEETING_TERMINAL_NOTIFICATION_WORKER_VERSION = "m6-01-v1";
    export function portalDeploymentId(env) {
      if ((env.PORTAL_FAKE_PROVIDERS ?? "").trim() === "1") return "fake-mode";
      const value = (env.RAILWAY_GIT_COMMIT_SHA || env.AXTRO_DEPLOYMENT_ID || "").trim();
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/.test(value)) throw new Error("invalid deployment");
      return value;
    }
    export function portalFinancialWorkerIdentity(worker, env) {
      return {
        deploymentId: portalDeploymentId(env),
        configFingerprint: "sha256:" + (worker === "billing_usage" ? "1" : "2").repeat(64),
      };
    }
    export function portalWorkerIdentity(worker, env) {
      if (worker !== "meeting_terminal_notification") return portalFinancialWorkerIdentity(worker, env);
      return {
        deploymentId: portalDeploymentId(env),
        configFingerprint: "sha256:" + "3".repeat(64),
      };
    }
  `],
]);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (mockSources.has(specifier)) return { url: `readiness-route-mock:${encodeURIComponent(specifier)}`, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith("readiness-route-mock:")) {
      const specifier = decodeURIComponent(url.slice("readiness-route-mock:".length));
      return { format: "module", source: mockSources.get(specifier), shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

const { handleReadiness } = await import("../../apps/portal/src/app/api/ready/route.ts");

const ENV = Object.freeze({
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable",
  SUPABASE_SERVICE_ROLE_KEY: "service-role",
  PORTAL_PUBLIC_URL: "https://closer.axtroai.com",
  AXTRO_DEPLOYMENT_ID: "deploy-readiness-20260813",
  RECALL_API_KEY: "recall-key",
  RECALL_API_REGION: "us-west-2",
  RECALL_TRANSCRIPT_DOWNLOAD_HOSTS: "download.test",
  RECALL_WEBHOOK_SECRET: `whsec_${Buffer.from("x".repeat(32)).toString("base64")}`,
  TAVUS_API_KEY: "tavus-key",
  OPENROUTER_API_KEY: "openrouter-key",
  OPENROUTER_MODEL: "anthropic/claude-haiku-4.5",
  AI_USAGE_RECONCILE_SECRET: "ai-usage-reconcile-secret-test",
  BILLING_USAGE_OUTBOX_ENABLED: "true",
  BILLING_DISPATCH_SECRET: "billing-dispatch-secret-test",
  STRIPE_SECRET_KEY: "sk_test_readiness",
  STRIPE_WEBHOOK_SECRET: "whsec_valid_readiness_secret_1234",
  STRIPE_CONVERSATION_OVERAGE_EVENT_NAME: "axtro_conversation_overage",
  STRIPE_PRICE_PILOTO_BASE: "price_PilotoBase123",
  STRIPE_PRICE_PILOTO_OVERAGE: "price_PilotoOver123",
  STRIPE_PRICE_CRESCIMENTO_BASE: "price_GrowthBase123",
  STRIPE_PRICE_CRESCIMENTO_OVERAGE: "price_GrowthOver123",
  STRIPE_PRICE_ESCALA_BASE: "price_ScaleBase123",
  STRIPE_PRICE_ESCALA_OVERAGE: "price_ScaleOver123",
  PROVIDER_EFFECT_RECONCILER_ENABLED: "true",
  PROVIDER_EFFECT_RECONCILE_SECRET: "provider-reconcile-secret-test",
  MEETING_TERMINAL_NOTIFICATION_OUTBOX_ENABLED: "false",
  PORTAL_BUSINESS_ACTION_BRIDGE_ENABLED: "false",
  PORTAL_TEXT_PREVIEW_ENABLED: "false",
});

const CAPABILITIES = Object.freeze({
  version: 50,
  providerEffectReservations: true,
  providerEffectTerminationFence: true,
  tavusStageExpiryConcurrencyFence: true,
  serviceRoleAppSchemaUsage: true,
  billingUsageOutbox: true,
  recallWebhookDedupe: true,
  recallTenantBinding: true,
  tavusWebhookCapabilities: true,
  tavusWebhookCapabilityLifecycle: true,
  tavusCustomerDeliveryReceipts: true,
  tavusStageCapabilities: true,
  providerEffectReconciliation: true,
  providerTranscriptService: true,
  authenticatedProviderTranscriptPreclaimBlocked: true,
  authenticatedMeetingBotPreclaimBlocked: true,
  portalTextPreviewAdmission: true,
  portalTextPreviewTurnFence: true,
  portalTextPreviewEgressAuthorization: true,
  portalTextPreviewProviderFailureReceipt: true,
  portalTextTranscriptOptIn: true,
  portalTextPreviewCleanup: true,
  portalTextPreviewCanonicalOutbox: true,
  portalTextPreviewSecurityBoundary: true,
  legacyAuthenticatedChatTranscriptWriterAvailable: true,
  meetingTerminalNotificationClaim: true,
  aiUsageReservations: true,
  aiUsageReconciliation: true,
  workerHeartbeats: true,
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

const BUSINESS_ACTION_CAPABILITIES = Object.freeze({
  businessActionKillSwitches: true,
  businessActionGrants: true,
  businessActionReceipts: true,
  businessActionLeads: true,
  businessActionProposals: true,
  businessActionCalendarReservations: true,
  businessActionCalendarConnections: true,
  businessActionCalendarCredentialRead: true,
  businessActionLiveCallContext: true,
  businessActionEmailLengthBound: true,
});

const MEETING_NOTIFICATION_CAPABILITIES = Object.freeze({
  version: 57,
  meetingTerminalNotificationClaim: false,
  meetingTerminalNotificationOutbox: true,
  meetingTerminalNotificationAtomicEnqueue: true,
  meetingTerminalNotificationLegacyClaimDisabled: true,
  meetingTerminalNotificationBoundedUnknown: true,
  meetingTerminalNotificationWorkerHeartbeat: true,
});

const AUTHORITY_REPAIR_CAPABILITIES = Object.freeze({
  ...MEETING_NOTIFICATION_CAPABILITIES,
  version: 58,
  portalTextPreviewAuthorityRepair: true,
});

const FRESH_WORKERS = Object.freeze({
  billingUsage: Object.freeze({
    lastSucceededAt: "2026-08-13T12:00:00.000Z",
    ageSeconds: 30,
    version: "m5-02-v1",
    deploymentId: ENV.AXTRO_DEPLOYMENT_ID,
    configFingerprint: `sha256:${"1".repeat(64)}`,
  }),
  providerEffectReconciler: Object.freeze({
    lastSucceededAt: "2026-08-13T12:00:15.000Z",
    ageSeconds: 15,
    version: "m5-02-v1",
    deploymentId: ENV.AXTRO_DEPLOYMENT_ID,
    configFingerprint: `sha256:${"2".repeat(64)}`,
  }),
});

const FRESH_WORKERS_V57 = Object.freeze({
  ...FRESH_WORKERS,
  meetingTerminalNotification: Object.freeze({
    lastSucceededAt: "2026-08-13T12:00:20.000Z",
    ageSeconds: 10,
    version: "m6-01-v1",
    deploymentId: ENV.AXTRO_DEPLOYMENT_ID,
    configFingerprint: `sha256:${"3".repeat(64)}`,
  }),
});

function clientWith(
  schemaResult,
  workerResult = { data: FRESH_WORKERS, error: null },
  calls = undefined,
) {
  return { rpc: async (name, parameters) => {
    calls?.push(name);
    if (name === "portal_schema_capabilities_service") return schemaResult;
    assert.equal(parameters, undefined);
    assert.equal(name, "portal_worker_readiness_service");
    return workerResult;
  } };
}

async function assertNoStore(response) {
  assert.equal(response.headers.get("cache-control"), "no-store");
  return response.json();
}

test("readiness returns 200 for a compatible base schema and never caches", async () => {
  const response = await handleReadiness({
    env: { ...ENV },
    createClient: () => clientWith({ data: CAPABILITIES, error: null }),
    logError: () => {},
  });
  assert.equal(response.status, 200);
  const body = await assertNoStore(response);
  assert.equal(body.ok, true);
  assert.equal(body.checks.database, true);
  assert.equal(body.checks.schema, true);
  assert.equal(body.checks.workers, true);
});

test("real-provider readiness requires both workers to have a fresh exact-version success", async () => {
  const invalidWorkerSnapshots = [
    { ...FRESH_WORKERS, billingUsage: null },
    { ...FRESH_WORKERS, billingUsage: { ...FRESH_WORKERS.billingUsage, ageSeconds: 721 } },
    { ...FRESH_WORKERS, billingUsage: { ...FRESH_WORKERS.billingUsage, ageSeconds: -1 } },
    { ...FRESH_WORKERS, providerEffectReconciler: { ...FRESH_WORKERS.providerEffectReconciler, version: "m5-01-v0" } },
    { ...FRESH_WORKERS, billingUsage: { ...FRESH_WORKERS.billingUsage, deploymentId: "another-deployment" } },
    { ...FRESH_WORKERS, billingUsage: { ...FRESH_WORKERS.billingUsage, configFingerprint: `sha256:${"3".repeat(64)}` } },
    { ...FRESH_WORKERS, billingUsage: { ...FRESH_WORKERS.billingUsage, deploymentId: undefined } },
    { ...FRESH_WORKERS, providerEffectReconciler: { ...FRESH_WORKERS.providerEffectReconciler, configFingerprint: undefined } },
  ];
  for (const workers of invalidWorkerSnapshots) {
    const response = await handleReadiness({
      env: { ...ENV },
      createClient: () => clientWith(
        { data: CAPABILITIES, error: null },
        { data: workers, error: null },
      ),
      logError: () => {},
    });
    assert.equal(response.status, 503);
    const body = await assertNoStore(response);
    assert.equal(body.checks.database, true);
    assert.equal(body.checks.schema, true);
    assert.equal(body.checks.workers, false);
  }
});

test("a started run preserves readiness through the RPC last-success snapshot", async () => {
  const response = await handleReadiness({
    env: { ...ENV },
    createClient: () => clientWith(
      { data: CAPABILITIES, error: null },
      { data: FRESH_WORKERS, error: null },
    ),
    logError: () => {},
  });
  assert.equal(response.status, 200);
  assert.equal((await assertNoStore(response)).checks.workers, true);
});

test("worker readiness RPC errors fail closed after schema validation", async () => {
  const response = await handleReadiness({
    env: { ...ENV },
    createClient: () => clientWith(
      { data: CAPABILITIES, error: null },
      { data: null, error: { message: "worker heartbeat unavailable" } },
    ),
    logError: () => {},
  });
  assert.equal(response.status, 503);
  const body = await assertNoStore(response);
  assert.equal(body.checks.database, false);
  assert.equal(body.checks.schema, true);
  assert.equal(body.checks.workers, false);
});

test("readiness rejects unknown or malformed schema versions and never probes workers", async () => {
  for (const version of [42, 43, 44, 45, 46, 47, 48, 49, 51, 52, 53, 54, 55, 56.5, 57, 58, "56", undefined]) {
    const calls = [];
    const response = await handleReadiness({
      env: { ...ENV },
      createClient: () => clientWith(
        { data: { ...CAPABILITIES, version }, error: null },
        { data: FRESH_WORKERS, error: null },
        calls,
      ),
      logError: () => {},
    });
    assert.equal(response.status, 503, `version:${String(version)}`);
    const body = await assertNoStore(response);
    assert.equal(body.checks.database, true, `version:${String(version)}`);
    assert.equal(body.checks.schema, false, `version:${String(version)}`);
    assert.equal(body.checks.workers, false, `version:${String(version)}`);
    assert.deepEqual(calls, ["portal_schema_capabilities_service"], `version:${String(version)}`);
  }
});

test("business actions disabled accept bridge schemas v50, v56 and the v57/v58 outbox", async () => {
  for (const version of [50, 56]) {
    const response = await handleReadiness({
      env: { ...ENV, PORTAL_BUSINESS_ACTION_BRIDGE_ENABLED: "false" },
      createClient: () => clientWith({ data: { ...CAPABILITIES, version }, error: null }),
      logError: () => {},
    });
    assert.equal(response.status, 200, `version:${version}`);
  }
  const response = await handleReadiness({
    env: { ...ENV, PORTAL_BUSINESS_ACTION_BRIDGE_ENABLED: "false" },
    createClient: () => clientWith(
      { data: { ...CAPABILITIES, ...MEETING_NOTIFICATION_CAPABILITIES }, error: null },
      { data: FRESH_WORKERS_V57, error: null },
    ),
    logError: () => {},
  });
  assert.equal(response.status, 200);

  const authorityRepair = await handleReadiness({
    env: { ...ENV, PORTAL_BUSINESS_ACTION_BRIDGE_ENABLED: "false" },
    createClient: () => clientWith(
      { data: { ...CAPABILITIES, ...AUTHORITY_REPAIR_CAPABILITIES }, error: null },
      { data: FRESH_WORKERS_V57, error: null },
    ),
    logError: () => {},
  });
  assert.equal(authorityRepair.status, 200);
});

test("v57 exige claim antiga false e todas as capabilities do outbox", async () => {
  const schema = { ...CAPABILITIES, ...MEETING_NOTIFICATION_CAPABILITIES };
  for (const patch of [
    { meetingTerminalNotificationClaim: true },
    { meetingTerminalNotificationClaim: undefined },
    ...Object.keys(MEETING_NOTIFICATION_CAPABILITIES)
      .filter((capability) => capability !== "version" && capability !== "meetingTerminalNotificationClaim")
      .flatMap((capability) => [
        { [capability]: false },
        { [capability]: undefined },
      ]),
  ]) {
    const calls = [];
    const response = await handleReadiness({
      env: { ...ENV },
      createClient: () => clientWith(
        { data: { ...schema, ...patch }, error: null },
        { data: FRESH_WORKERS_V57, error: null },
        calls,
      ),
      logError: () => {},
    });
    assert.equal(response.status, 503, JSON.stringify(patch));
    assert.deepEqual(calls, ["portal_schema_capabilities_service"]);
  }
});

test("v58 exige a união v57 e a capability de authority repair", async () => {
  const schema = { ...CAPABILITIES, ...AUTHORITY_REPAIR_CAPABILITIES };
  for (const patch of [
    { portalTextPreviewAuthorityRepair: false },
    { portalTextPreviewAuthorityRepair: undefined },
    { meetingTerminalNotificationClaim: true },
    ...Object.keys(MEETING_NOTIFICATION_CAPABILITIES)
      .filter((capability) => capability !== "version" && capability !== "meetingTerminalNotificationClaim")
      .map((capability) => ({ [capability]: false })),
  ]) {
    const calls = [];
    const response = await handleReadiness({
      env: { ...ENV },
      createClient: () => clientWith(
        { data: { ...schema, ...patch }, error: null },
        { data: FRESH_WORKERS_V57, error: null },
        calls,
      ),
      logError: () => {},
    });
    assert.equal(response.status, 503, JSON.stringify(patch));
    assert.deepEqual(calls, ["portal_schema_capabilities_service"]);
  }
});

test("v57 com outbox desligado não exige heartbeat do worker dormente", async () => {
  const response = await handleReadiness({
    env: { ...ENV, MEETING_TERMINAL_NOTIFICATION_OUTBOX_ENABLED: "false" },
    createClient: () => clientWith(
      { data: { ...CAPABILITIES, ...MEETING_NOTIFICATION_CAPABILITIES }, error: null },
      { data: { ...FRESH_WORKERS, meetingTerminalNotification: null }, error: null },
    ),
    logError: () => {},
  });
  assert.equal(response.status, 200);
  const body = await assertNoStore(response);
  assert.equal(body.checks.meeting_notification_worker, true);
});

test("outbox habilitado exige v57 ou v58 e um heartbeat de notificação fresco e separado", async () => {
  const enabledEnv = {
    ...ENV,
    MEETING_TERMINAL_NOTIFICATION_OUTBOX_ENABLED: "true",
    MEETING_TERMINAL_NOTIFICATION_DISPATCH_SECRET: "meeting-notification-readiness-secret",
    RESEND_API_KEY: "re_test_readiness_key",
  };
  const legacyCalls = [];
  const legacy = await handleReadiness({
    env: enabledEnv,
    createClient: () => clientWith({ data: CAPABILITIES, error: null }, { data: FRESH_WORKERS, error: null }, legacyCalls),
    logError: () => {},
  });
  assert.equal(legacy.status, 503);
  assert.deepEqual(legacyCalls, ["portal_schema_capabilities_service"]);

  for (const workers of [
    FRESH_WORKERS,
    { ...FRESH_WORKERS_V57, meetingTerminalNotification: null },
    { ...FRESH_WORKERS_V57, meetingTerminalNotification: { ...FRESH_WORKERS_V57.meetingTerminalNotification, ageSeconds: 721 } },
    { ...FRESH_WORKERS_V57, meetingTerminalNotification: { ...FRESH_WORKERS_V57.meetingTerminalNotification, version: "m6-00-v0" } },
    { ...FRESH_WORKERS_V57, meetingTerminalNotification: { ...FRESH_WORKERS_V57.meetingTerminalNotification, configFingerprint: `sha256:${"4".repeat(64)}` } },
    { ...FRESH_WORKERS_V57, meetingTerminalNotification: { ...FRESH_WORKERS_V57.meetingTerminalNotification, deploymentId: "another-deployment" } },
    { ...FRESH_WORKERS_V57, meetingTerminalNotification: { ...FRESH_WORKERS_V57.meetingTerminalNotification, ageSeconds: -1 } },
    { ...FRESH_WORKERS_V57, meetingTerminalNotification: { ...FRESH_WORKERS_V57.meetingTerminalNotification, lastSucceededAt: "not-a-timestamp" } },
    { ...FRESH_WORKERS_V57, meetingTerminalNotification: { ...FRESH_WORKERS_V57.meetingTerminalNotification, configFingerprint: undefined } },
    { ...FRESH_WORKERS_V57, meetingTerminalNotification: { ...FRESH_WORKERS_V57.meetingTerminalNotification, extra: true } },
  ]) {
    const response = await handleReadiness({
      env: enabledEnv,
      createClient: () => clientWith(
        { data: { ...CAPABILITIES, ...MEETING_NOTIFICATION_CAPABILITIES }, error: null },
        { data: workers, error: null },
      ),
      logError: () => {},
    });
    assert.equal(response.status, 503);
    const body = await assertNoStore(response);
    assert.equal(body.checks.schema, true);
    assert.equal(body.checks.workers, false);
    assert.equal(body.checks.meeting_notification_worker, false);
  }

  const ready = await handleReadiness({
    env: enabledEnv,
    createClient: () => clientWith(
      { data: { ...CAPABILITIES, ...MEETING_NOTIFICATION_CAPABILITIES }, error: null },
      { data: FRESH_WORKERS_V57, error: null },
    ),
    logError: () => {},
  });
  assert.equal(ready.status, 200);
  assert.equal((await assertNoStore(ready)).checks.meeting_notification_worker, true);

  const readyV58 = await handleReadiness({
    env: enabledEnv,
    createClient: () => clientWith(
      { data: { ...CAPABILITIES, ...AUTHORITY_REPAIR_CAPABILITIES }, error: null },
      { data: FRESH_WORKERS_V57, error: null },
    ),
    logError: () => {},
  });
  assert.equal(readyV58.status, 200);
  assert.equal((await assertNoStore(readyV58)).checks.meeting_notification_worker, true);
});

test("fake mode permite outbox habilitado sem credencial Resend e sem heartbeat", async () => {
  const response = await handleReadiness({
    env: {
      ...ENV,
      PORTAL_FAKE_PROVIDERS: "1",
      MEETING_TERMINAL_NOTIFICATION_OUTBOX_ENABLED: "true",
      MEETING_TERMINAL_NOTIFICATION_DISPATCH_SECRET: "meeting-notification-readiness-secret",
      RESEND_API_KEY: "",
    },
    createClient: () => clientWith({
      data: { ...CAPABILITIES, ...MEETING_NOTIFICATION_CAPABILITIES },
      error: null,
    }),
    logError: () => {},
  });
  assert.equal(response.status, 200);
  assert.equal((await assertNoStore(response)).checks.meeting_notification_worker, true);
});

test("meeting notification readiness flags fail closed before database access", async () => {
  for (const patch of [
    { MEETING_TERMINAL_NOTIFICATION_OUTBOX_ENABLED: " TRUE " },
    { MEETING_TERMINAL_NOTIFICATION_OUTBOX_ENABLED: "TRUE" },
    { MEETING_TERMINAL_NOTIFICATION_OUTBOX_ENABLED: "1" },
    { MEETING_TERMINAL_NOTIFICATION_OUTBOX_ENABLED: "enabled" },
    {
      MEETING_TERMINAL_NOTIFICATION_OUTBOX_ENABLED: "true",
      MEETING_TERMINAL_NOTIFICATION_DISPATCH_SECRET: "short",
      RESEND_API_KEY: "re_test_readiness_key",
    },
    {
      MEETING_TERMINAL_NOTIFICATION_OUTBOX_ENABLED: "true",
      MEETING_TERMINAL_NOTIFICATION_DISPATCH_SECRET: "meeting-notification-readiness-secret",
      RESEND_API_KEY: "",
    },
  ]) {
    let clientCreated = false;
    const response = await handleReadiness({
      env: { ...ENV, ...patch },
      createClient: () => {
        clientCreated = true;
        return clientWith({ data: CAPABILITIES, error: null });
      },
      logError: () => {},
    });
    assert.equal(response.status, 503, JSON.stringify(patch));
    assert.equal(clientCreated, false, JSON.stringify(patch));
    await assertNoStore(response);
  }
});

test("business actions enabled require v56, v57 or v58 and every business-action capability", async () => {
  const schema = { ...CAPABILITIES, version: 56, ...BUSINESS_ACTION_CAPABILITIES };
  for (const version of [48, 49, 50, 51, 52, 53, 54, 55]) {
    const calls = [];
    const response = await handleReadiness({
      env: { ...ENV, PORTAL_BUSINESS_ACTION_BRIDGE_ENABLED: "true" },
      createClient: () => clientWith({ data: { ...schema, version }, error: null }, { data: FRESH_WORKERS, error: null }, calls),
      logError: () => {},
    });
    assert.equal(response.status, 503, `version:${version}`);
    assert.deepEqual(calls, ["portal_schema_capabilities_service"]);
  }
  for (const capability of Object.keys(BUSINESS_ACTION_CAPABILITIES)) {
    for (const absentValue of [false, undefined]) {
      const calls = [];
      const response = await handleReadiness({
        env: { ...ENV, PORTAL_BUSINESS_ACTION_BRIDGE_ENABLED: "true" },
        createClient: () => clientWith({ data: { ...schema, [capability]: absentValue }, error: null }, { data: FRESH_WORKERS, error: null }, calls),
        logError: () => {},
      });
      assert.equal(response.status, 503, `${capability}:${String(absentValue)}`);
      assert.deepEqual(calls, ["portal_schema_capabilities_service"]);
    }
  }
  const response = await handleReadiness({
    env: { ...ENV, PORTAL_BUSINESS_ACTION_BRIDGE_ENABLED: "true" },
    createClient: () => clientWith({ data: schema, error: null }),
    logError: () => {},
  });
  assert.equal(response.status, 200);

  const v57 = await handleReadiness({
    env: { ...ENV, PORTAL_BUSINESS_ACTION_BRIDGE_ENABLED: "true" },
    createClient: () => clientWith(
      { data: { ...schema, ...MEETING_NOTIFICATION_CAPABILITIES }, error: null },
      { data: FRESH_WORKERS_V57, error: null },
    ),
    logError: () => {},
  });
  assert.equal(v57.status, 200);

  const v58 = await handleReadiness({
    env: { ...ENV, PORTAL_BUSINESS_ACTION_BRIDGE_ENABLED: "true" },
    createClient: () => clientWith(
      { data: { ...schema, ...AUTHORITY_REPAIR_CAPABILITIES }, error: null },
      { data: FRESH_WORKERS_V57, error: null },
    ),
    logError: () => {},
  });
  assert.equal(v58.status, 200);
});

test("invalid business-action flag fails config readiness before database access", async () => {
  let clientCreated = false;
  const response = await handleReadiness({
    env: { ...ENV, PORTAL_BUSINESS_ACTION_BRIDGE_ENABLED: "enabled" },
    createClient: () => {
      clientCreated = true;
      return clientWith({ data: CAPABILITIES, error: null });
    },
    logError: () => {},
  });
  assert.equal(response.status, 503);
  assert.equal(clientCreated, false);
  const body = await assertNoStore(response);
  assert.equal(body.checks.business_action_bridge_flag, false);
});

test("readiness requires the text preview recovery gate to be exactly false before database access", async () => {
  for (const value of [undefined, "", "true", "TRUE", "False", " false ", "0"]) {
    let clientCreated = false;
    const response = await handleReadiness({
      env: { ...ENV, PORTAL_TEXT_PREVIEW_ENABLED: value },
      createClient: () => {
        clientCreated = true;
        return clientWith({ data: CAPABILITIES, error: null });
      },
      logError: () => {},
    });
    assert.equal(response.status, 503, String(value));
    assert.equal(clientCreated, false, String(value));
    const body = await assertNoStore(response);
    assert.equal(body.checks.portal_text_preview_recovery_gate, false, String(value));
  }
});

test("readiness fails closed while Tavus webhook capabilities are absent", async () => {
  const response = await handleReadiness({
    env: { ...ENV },
    createClient: () => clientWith({ data: { ...CAPABILITIES, tavusWebhookCapabilities: false }, error: null }),
    logError: () => {},
  });
  assert.equal(response.status, 503);
  const body = await assertNoStore(response);
  assert.equal(body.checks.schema, false);
});

test("readiness fails closed while Tavus callback capability lifecycle is absent", async () => {
  const response = await handleReadiness({
    env: { ...ENV },
    createClient: () => clientWith({ data: { ...CAPABILITIES, tavusWebhookCapabilityLifecycle: false }, error: null }),
    logError: () => {},
  });
  assert.equal(response.status, 503);
  const body = await assertNoStore(response);
  assert.equal(body.checks.schema, false);
});

test("readiness fails closed while AI reservation capability is absent", async () => {
  const response = await handleReadiness({
    env: { ...ENV },
    createClient: () => clientWith({ data: { ...CAPABILITIES, aiUsageReservations: false }, error: null }),
    logError: () => {},
  });
  assert.equal(response.status, 503);
  const body = await assertNoStore(response);
  assert.equal(body.checks.schema, false);
});

test("readiness fails closed while any runtime bridge capability is absent", async () => {
  for (const capability of [
    "providerEffectTerminationFence",
    "tavusStageExpiryConcurrencyFence",
    "serviceRoleAppSchemaUsage",
    "runtimeChannelAdmission",
    "runtimeChannelGrantFences",
    "runtimeProviderBindingReceipts",
    "runtimeSceneReceipts",
    "runtimeKillSwitches",
    "runtimeDualOperatorReconciliation",
    "runtimeBridgeReceiptIntegrity",
    "portalTextPreviewAdmission",
    "portalTextPreviewTurnFence",
    "portalTextPreviewEgressAuthorization",
    "portalTextPreviewProviderFailureReceipt",
    "portalTextTranscriptOptIn",
    "portalTextPreviewCleanup",
    "portalTextPreviewCanonicalOutbox",
    "portalTextPreviewSecurityBoundary",
    "legacyAuthenticatedChatTranscriptWriterAvailable",
    "meetingTerminalNotificationClaim",
  ]) {
    for (const absentValue of [false, undefined]) {
      const calls = [];
      const response = await handleReadiness({
        env: { ...ENV },
        createClient: () => clientWith({ data: { ...CAPABILITIES, [capability]: absentValue }, error: null }, { data: FRESH_WORKERS, error: null }, calls),
        logError: () => {},
      });
      assert.equal(response.status, 503, `${capability}:${String(absentValue)}`);
      const body = await assertNoStore(response);
      assert.equal(body.checks.schema, false, `${capability}:${String(absentValue)}`);
      assert.deepEqual(calls, ["portal_schema_capabilities_service"], `${capability}:${String(absentValue)}`);
    }
  }
});

test("readiness fails closed while legacy meeting-bot preclaim remains callable", async () => {
  const response = await handleReadiness({
    env: { ...ENV },
    createClient: () => clientWith({ data: { ...CAPABILITIES, authenticatedMeetingBotPreclaimBlocked: false }, error: null }),
    logError: () => {},
  });
  assert.equal(response.status, 503);
  const body = await assertNoStore(response);
  assert.equal(body.checks.schema, false);
});

test("readiness fails closed when any durable Stripe Checkout contract is absent", async () => {
  for (const capability of [
    "billingCheckoutIntents",
    "strictSubscriptionIdentity",
    "legacySubscriptionWriterRevoked",
  ]) {
    for (const absentValue of [false, undefined]) {
      const calls = [];
      const response = await handleReadiness({
        env: { ...ENV },
        createClient: () => clientWith(
          {
            data: { ...CAPABILITIES, [capability]: absentValue },
            error: null,
          },
          { data: FRESH_WORKERS, error: null },
          calls,
        ),
        logError: () => {},
      });
      assert.equal(response.status, 503, `${capability}:${String(absentValue)}`);
      const body = await assertNoStore(response);
      assert.equal(body.checks.database, true);
      assert.equal(body.checks.schema, false);
      assert.equal(body.checks.workers, false);
      assert.deepEqual(calls, ["portal_schema_capabilities_service"]);
    }
  }
});

test("readiness fails closed while the v42 ledger contract is absent", async () => {
  for (const capability of ["costEventSchemaVersion", "legacyCostWritersRevoked"]) {
    for (const absentValue of [false, undefined]) {
      const response = await handleReadiness({
        env: { ...ENV },
        createClient: () => clientWith({ data: { ...CAPABILITIES, [capability]: absentValue }, error: null }),
        logError: () => {},
      });
      assert.equal(response.status, 503, `${capability}:${String(absentValue)}`);
      const body = await assertNoStore(response);
      assert.equal(body.checks.database, true);
      assert.equal(body.checks.schema, false);
    }
  }
});

test("readiness fails closed while provider-effect reconciliation capability is absent", async () => {
  const response = await handleReadiness({
    env: { ...ENV },
    createClient: () => clientWith({ data: { ...CAPABILITIES, providerEffectReconciliation: false }, error: null }),
    logError: () => {},
  });
  assert.equal(response.status, 503);
  const body = await assertNoStore(response);
  assert.equal(body.checks.schema, false);
});

test("readiness fails closed for an RPC error receipt", async () => {
  const response = await handleReadiness({
    env: { ...ENV },
    createClient: () => clientWith({ data: null, error: { message: "database unavailable" } }),
    logError: () => {},
  });
  assert.equal(response.status, 503);
  const body = await assertNoStore(response);
  assert.equal(body.checks.database, false);
  assert.equal(body.checks.schema, false);
});

test("readiness contains a thrown database failure", async () => {
  const response = await handleReadiness({
    env: { ...ENV },
    createClient: () => ({ rpc: async () => { throw new Error("connection reset"); } }),
    logError: () => {},
  });
  assert.equal(response.status, 503);
  const body = await assertNoStore(response);
  assert.equal(body.checks.database, false);
});

test("readiness enforces an explicit database deadline", async () => {
  const startedAt = Date.now();
  let aborted = false;
  const response = await handleReadiness({
    env: { ...ENV },
    createClient: () => ({ rpc: () => ({
      then() { /* intentionally never settles */ },
      abortSignal(signal) {
        signal.addEventListener("abort", () => { aborted = true; }, { once: true });
        return this;
      },
    }) }),
    logError: () => {},
    timeoutMs: 5,
  });
  assert.equal(response.status, 503);
  assert.equal(aborted, true);
  assert.ok(Date.now() - startedAt < 1_000);
  const body = await assertNoStore(response);
  assert.equal(body.checks.database, false);
});

test("configuration rejection does not touch the database and is no-store", async () => {
  let calls = 0;
  const response = await handleReadiness({
    env: { ...ENV, BILLING_USAGE_OUTBOX_ENABLED: "false" },
    createClient: () => {
      calls += 1;
      return clientWith({ data: CAPABILITIES, error: null });
    },
    logError: () => {},
  });
  assert.equal(response.status, 503);
  assert.equal(calls, 0);
  await assertNoStore(response);
});

test("real-provider readiness requires an immutable deployment identity before database access", async () => {
  for (const deploymentPatch of [
    { AXTRO_DEPLOYMENT_ID: "", RAILWAY_GIT_COMMIT_SHA: "" },
    { AXTRO_DEPLOYMENT_ID: "short", RAILWAY_GIT_COMMIT_SHA: "" },
    { AXTRO_DEPLOYMENT_ID: "invalid deployment", RAILWAY_GIT_COMMIT_SHA: "" },
  ]) {
    let calls = 0;
    const response = await handleReadiness({
      env: { ...ENV, ...deploymentPatch },
      createClient: () => {
        calls += 1;
        return clientWith({ data: CAPABILITIES, error: null });
      },
      logError: () => {},
    });
    assert.equal(response.status, 503);
    assert.equal(calls, 0);
    const body = await assertNoStore(response);
    assert.equal(body.checks.deployment_identity, false);
  }
});

test("real-provider readiness rejects missing or hostile public origins before database access", async () => {
  for (const publicUrl of [
    "",
    "http://closer.axtroai.com",
    "https://closer.axtroai.com:443",
    "https://closer.axtroai.com/path",
    "https://closer.axtroai.com?redirect=https://evil.example",
    "https://closer.axtroai.com.evil.example",
  ]) {
    let calls = 0;
    const response = await handleReadiness({
      env: { ...ENV, PORTAL_PUBLIC_URL: publicUrl },
      createClient: () => {
        calls += 1;
        return clientWith({ data: CAPABILITIES, error: null });
      },
      logError: () => {},
    });
    assert.equal(response.status, 503, publicUrl);
    assert.equal(calls, 0, publicUrl);
    const body = await assertNoStore(response);
    assert.equal(body.checks.public_origin, false, publicUrl);
  }
});

test("real-provider readiness requires automatic reconciliation and its protected secret", async () => {
  for (const broken of [
    { PROVIDER_EFFECT_RECONCILER_ENABLED: "false" },
    { PROVIDER_EFFECT_RECONCILER_ENABLED: "yes" },
    { PROVIDER_EFFECT_RECONCILE_SECRET: "short" },
  ]) {
    let calls = 0;
    const response = await handleReadiness({
      env: { ...ENV, ...broken },
      createClient: () => {
        calls += 1;
        return clientWith({ data: CAPABILITIES, error: null });
      },
      logError: () => {},
    });
    assert.equal(response.status, 503);
    assert.equal(calls, 0);
    await assertNoStore(response);
  }
});

test("real-provider readiness requires AI, Stripe webhook, meter and the complete price catalog", async () => {
  for (const broken of [
    { OPENROUTER_API_KEY: "" },
    { OPENROUTER_MODEL: "unreviewed/expensive-model" },
    { AI_USAGE_RECONCILE_SECRET: "short" },
    { STRIPE_WEBHOOK_SECRET: "invalid" },
    { STRIPE_CONVERSATION_OVERAGE_EVENT_NAME: "Invalid Meter" },
    { STRIPE_PRICE_PILOTO_BASE: "" },
    { STRIPE_PRICE_PILOTO_OVERAGE: "" },
    { STRIPE_PRICE_CRESCIMENTO_BASE: "" },
    { STRIPE_PRICE_CRESCIMENTO_OVERAGE: "" },
    { STRIPE_PRICE_ESCALA_BASE: "" },
    { STRIPE_PRICE_ESCALA_OVERAGE: "" },
    { STRIPE_PRICE_PILOTO_BASE: "price_hostile_suffix" },
  ]) {
    let calls = 0;
    const response = await handleReadiness({
      env: { ...ENV, ...broken },
      createClient: () => { calls += 1; return clientWith({ data: CAPABILITIES, error: null }); },
      logError: () => {},
    });
    assert.equal(response.status, 503);
    assert.equal(calls, 0);
    await assertNoStore(response);
  }
});

test("fake-provider readiness may explicitly disable the billing outbox", async () => {
  const calls = [];
  const response = await handleReadiness({
    env: {
      NEXT_PUBLIC_SUPABASE_URL: ENV.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: ENV.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      SUPABASE_SERVICE_ROLE_KEY: ENV.SUPABASE_SERVICE_ROLE_KEY,
      PORTAL_FAKE_PROVIDERS: "1",
      BILLING_USAGE_OUTBOX_ENABLED: "false",
      PROVIDER_EFFECT_RECONCILER_ENABLED: "false",
      PORTAL_TEXT_PREVIEW_ENABLED: "false",
    },
    createClient: () => ({ rpc: async (name, parameters) => {
      calls.push(name);
      assert.equal(parameters, undefined);
      assert.equal(name, "portal_schema_capabilities_service");
      return { data: CAPABILITIES, error: null };
    } }),
    logError: () => {},
  });
  assert.equal(response.status, 200);
  await assertNoStore(response);
  assert.deepEqual(calls, ["portal_schema_capabilities_service"]);
});
