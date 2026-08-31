import { NextResponse } from "next/server";

import { createServiceRoleClient } from "@/lib/supabase/service";
import { logError as trackError } from "@/lib/telemetry";
import {
  PORTAL_FINANCIAL_WORKER_VERSION,
  PORTAL_MEETING_TERMINAL_NOTIFICATION_WORKER_VERSION,
  portalFinancialWorkerIdentity,
  portalWorkerIdentity,
  type PortalFinancialWorkerIdentity,
} from "@/lib/workers/heartbeat";
import {
  readinessConfig,
  readinessConfigOk,
  readinessBusinessActionsEnabled,
  readinessMeetingTerminalNotificationsEnabled,
  readinessRequiresProviderEffectReconciliation,
  readinessRequiresWorkerHeartbeats,
} from "./checks.ts";

export const dynamic = "force-dynamic";

const READINESS_DATABASE_TIMEOUT_MS = 3_000;
const MAXIMUM_COMPATIBLE_SCHEMA_VERSION = 58;
const MEETING_NOTIFICATION_SCHEMA_VERSIONS = new Set([57, MAXIMUM_COMPATIBLE_SCHEMA_VERSION]);
const COMPATIBLE_SCHEMA_VERSIONS = new Set([50, 56, ...MEETING_NOTIFICATION_SCHEMA_VERSIONS]);

const BASE_SCHEMA_CAPABILITIES = Object.freeze([
  "providerEffectReservations",
  "providerEffectTerminationFence",
  "tavusStageExpiryConcurrencyFence",
  "serviceRoleAppSchemaUsage",
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
  "portalTextPreviewAdmission",
  "portalTextPreviewTurnFence",
  "portalTextPreviewEgressAuthorization",
  "portalTextPreviewProviderFailureReceipt",
  "portalTextTranscriptOptIn",
  "portalTextPreviewCleanup",
  "portalTextPreviewCanonicalOutbox",
  "portalTextPreviewSecurityBoundary",
  "legacyAuthenticatedChatTranscriptWriterAvailable",
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
] as const);

const MEETING_NOTIFICATION_SCHEMA_CAPABILITIES = Object.freeze([
  "meetingTerminalNotificationOutbox",
  "meetingTerminalNotificationAtomicEnqueue",
  "meetingTerminalNotificationLegacyClaimDisabled",
  "meetingTerminalNotificationBoundedUnknown",
  "meetingTerminalNotificationWorkerHeartbeat",
] as const);

const BUSINESS_ACTION_SCHEMA_CAPABILITIES = Object.freeze([
  "businessActionKillSwitches",
  "businessActionGrants",
  "businessActionReceipts",
  "businessActionLeads",
  "businessActionProposals",
  "businessActionCalendarReservations",
  "businessActionCalendarConnections",
  "businessActionCalendarCredentialRead",
  "businessActionLiveCallContext",
  "businessActionEmailLengthBound",
] as const);

interface ReadinessRpcResult {
  readonly data: unknown;
  readonly error: unknown;
}

interface ReadinessRpcOperation extends PromiseLike<ReadinessRpcResult> {
  abortSignal?(signal: AbortSignal): PromiseLike<ReadinessRpcResult>;
}

interface ReadinessClient {
  rpc(name: string, parameters?: Readonly<Record<string, unknown>>): ReadinessRpcOperation;
}

export interface ReadinessRouteDependencies {
  readonly env?: NodeJS.ProcessEnv;
  readonly createClient?: () => ReadinessClient;
  readonly logError?: (event: string, error: unknown, context: Readonly<Record<string, unknown>>) => void;
  readonly timeoutMs?: number;
}

class ReadinessDeadlineError extends Error {
  constructor() {
    super("portal readiness database deadline exceeded");
    this.name = "ReadinessDeadlineError";
  }
}

interface WorkerReadinessRecord {
  readonly lastSucceededAt: string;
  readonly ageSeconds: number;
  readonly version: string;
  readonly deploymentId: string;
  readonly configFingerprint: string;
}

interface ExpectedWorkerReadiness {
  readonly billingUsage: PortalFinancialWorkerIdentity;
  readonly providerEffectReconciler: PortalFinancialWorkerIdentity;
  readonly meetingTerminalNotification: PortalFinancialWorkerIdentity;
}

const WORKER_MAX_AGE_SECONDS = 720;

function ownRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null ? value as Record<string, unknown> : null;
}

function hasExactKeys(record: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(record).sort();
  const sortedExpected = [...expected].sort();
  return keys.length === sortedExpected.length && keys.every((key, index) => key === sortedExpected[index]);
}

function parseWorkerReadinessRecord(
  value: unknown,
  expected: PortalFinancialWorkerIdentity,
  expectedVersion: string,
): WorkerReadinessRecord | null {
  const record = ownRecord(value);
  if (!record || !hasExactKeys(record, [
    "lastSucceededAt",
    "ageSeconds",
    "version",
    "deploymentId",
    "configFingerprint",
  ])) return null;
  if (
    typeof record.lastSucceededAt !== "string"
    || !Number.isFinite(Date.parse(record.lastSucceededAt))
    || !Number.isInteger(record.ageSeconds)
    || Number(record.ageSeconds) < 0
    || Number(record.ageSeconds) > WORKER_MAX_AGE_SECONDS
    || record.version !== expectedVersion
    || record.deploymentId !== expected.deploymentId
    || record.configFingerprint !== expected.configFingerprint
  ) return null;
  return record as unknown as WorkerReadinessRecord;
}

export function workerReadinessOk(
  value: unknown,
  expected: ExpectedWorkerReadiness,
  requireMeetingTerminalNotification: boolean,
): boolean {
  const record = ownRecord(value);
  if (!record) return false;
  const expectedKeys = Object.hasOwn(record, "meetingTerminalNotification")
    ? ["billingUsage", "meetingTerminalNotification", "providerEffectReconciler"]
    : ["billingUsage", "providerEffectReconciler"];
  if (!hasExactKeys(record, expectedKeys)) return false;
  const financialReady = parseWorkerReadinessRecord(
    record.billingUsage,
    expected.billingUsage,
    PORTAL_FINANCIAL_WORKER_VERSION,
  ) !== null && parseWorkerReadinessRecord(
    record.providerEffectReconciler,
    expected.providerEffectReconciler,
    PORTAL_FINANCIAL_WORKER_VERSION,
  ) !== null;
  if (!financialReady || !requireMeetingTerminalNotification) return financialReady;
  return parseWorkerReadinessRecord(
    record.meetingTerminalNotification,
    expected.meetingTerminalNotification,
    PORTAL_MEETING_TERMINAL_NOTIFICATION_WORKER_VERSION,
  ) !== null;
}

export function schemaReadinessOk(value: unknown, env: NodeJS.ProcessEnv): boolean {
  const capabilities = ownRecord(value);
  if (!capabilities) return false;
  const version = capabilities.version;
  if (
    !Number.isInteger(version)
    || !COMPATIBLE_SCHEMA_VERSIONS.has(Number(version))
    || !BASE_SCHEMA_CAPABILITIES.every((capability) => capabilities[capability] === true)
    || (readinessRequiresProviderEffectReconciliation(env)
      && capabilities.providerEffectReconciliation !== true)
  ) return false;
  const isNotificationOutboxSchema = MEETING_NOTIFICATION_SCHEMA_VERSIONS.has(Number(version))
    && capabilities.meetingTerminalNotificationClaim === false
    && MEETING_NOTIFICATION_SCHEMA_CAPABILITIES.every((capability) => capabilities[capability] === true);
  const isLegacyNotificationSchema = (version === 50 || version === 56)
    && capabilities.meetingTerminalNotificationClaim === true;
  if (!isNotificationOutboxSchema && !isLegacyNotificationSchema) return false;
  if (version === MAXIMUM_COMPATIBLE_SCHEMA_VERSION && capabilities.portalTextPreviewAuthorityRepair !== true) {
    return false;
  }
  if (readinessMeetingTerminalNotificationsEnabled(env) && !isNotificationOutboxSchema) return false;
  if (!readinessBusinessActionsEnabled(env)) return true;
  return Number(version) >= 56
    && BUSINESS_ACTION_SCHEMA_CAPABILITIES.every((capability) => capabilities[capability] === true);
}

async function withDeadline<T>(operation: PromiseLike<T>, timeoutMs: number, onTimeout: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        onTimeout();
        reject(new ReadinessDeadlineError());
      }, timeoutMs);
    });
    return await Promise.race([Promise.resolve(operation), deadline]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function handleReadiness(dependencies: ReadinessRouteDependencies = {}): Promise<NextResponse> {
  const env = dependencies.env ?? process.env;
  const checks = readinessConfig(env);
  const reportError = dependencies.logError ?? trackError;
  if (!readinessConfigOk(checks)) {
    return NextResponse.json(
      { ok: false, service: "axtro-portal", checks: { ...checks, database: false } },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }

  const expectedWorkers = Object.freeze({
    billingUsage: portalFinancialWorkerIdentity("billing_usage", env),
    providerEffectReconciler: portalFinancialWorkerIdentity("provider_effect_reconciler", env),
    meetingTerminalNotification: portalWorkerIdentity("meeting_terminal_notification", env),
  });
  const meetingTerminalNotificationsEnabled = readinessMeetingTerminalNotificationsEnabled(env);

  let schemaReady = false;
  try {
    const supabase = (dependencies.createClient ?? (() => createServiceRoleClient() as ReadinessClient))();
    const timeoutMs = dependencies.timeoutMs ?? READINESS_DATABASE_TIMEOUT_MS;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > READINESS_DATABASE_TIMEOUT_MS) {
      throw new Error("invalid readiness database deadline");
    }
    const controller = new AbortController();
    const query = async (
      name: string,
      parameters?: Readonly<Record<string, unknown>>,
    ): Promise<ReadinessRpcResult> => {
      const rpc = supabase.rpc(name, parameters);
      const cancellableRpc = rpc.abortSignal?.(controller.signal) ?? rpc;
      return Promise.resolve(cancellableRpc);
    };
    const result = await withDeadline((async () => {
      const schema = await query("portal_schema_capabilities_service");
      if (schema.error) throw new Error("portal schema capability RPC failed");
      schemaReady = schemaReadinessOk(schema.data, env);
      if (!schemaReady) return { workersReady: false, notificationWorkerReady: false };
      if (!readinessRequiresWorkerHeartbeats(env)) return { workersReady: true, notificationWorkerReady: true };
      const workers = await query("portal_worker_readiness_service");
      if (workers.error) throw new Error("portal worker readiness RPC failed");
      const workersReady = workerReadinessOk(
        workers.data,
        expectedWorkers,
        meetingTerminalNotificationsEnabled,
      );
      return { workersReady, notificationWorkerReady: !meetingTerminalNotificationsEnabled || workersReady };
    })(), timeoutMs, () => controller.abort());

    if (!schemaReady || !result.workersReady) {
      return NextResponse.json(
        {
          ok: false,
          service: "axtro-portal",
          checks: {
            ...checks,
            database: true,
            schema: schemaReady,
            workers: result.workersReady,
            meeting_notification_worker: result.notificationWorkerReady,
          },
        },
        { status: 503, headers: { "cache-control": "no-store" } },
      );
    }
  } catch (error) {
    reportError("portal_readiness_database_failed", error, {});
    return NextResponse.json(
      {
        ok: false,
        service: "axtro-portal",
        checks: { ...checks, database: false, schema: schemaReady, workers: false, meeting_notification_worker: false },
      },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      service: "axtro-portal",
      checks: { ...checks, database: true, schema: true, workers: true, meeting_notification_worker: true },
    },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function GET(): Promise<NextResponse> {
  return handleReadiness();
}
