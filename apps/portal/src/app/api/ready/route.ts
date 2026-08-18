import { NextResponse } from "next/server";

import { createServiceRoleClient } from "@/lib/supabase/service";
import { logError as trackError } from "@/lib/telemetry";
import {
  PORTAL_FINANCIAL_WORKER_VERSION,
  portalFinancialWorkerIdentity,
  type PortalFinancialWorkerIdentity,
} from "@/lib/workers/heartbeat";
import {
  readinessConfig,
  readinessConfigOk,
  readinessRequiresProviderEffectReconciliation,
  readinessRequiresWorkerHeartbeats,
} from "./checks.ts";

export const dynamic = "force-dynamic";

const READINESS_DATABASE_TIMEOUT_MS = 3_000;

interface ReadinessRpcResult {
  readonly data: unknown;
  readonly error: unknown;
}

interface ReadinessRpcOperation extends PromiseLike<ReadinessRpcResult> {
  abortSignal?(signal: AbortSignal): PromiseLike<ReadinessRpcResult>;
}

interface ReadinessClient {
  rpc(name: string): ReadinessRpcOperation;
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
    || record.version !== PORTAL_FINANCIAL_WORKER_VERSION
    || record.deploymentId !== expected.deploymentId
    || record.configFingerprint !== expected.configFingerprint
  ) return null;
  return record as unknown as WorkerReadinessRecord;
}

export function workerReadinessOk(value: unknown, expected: ExpectedWorkerReadiness): boolean {
  const record = ownRecord(value);
  if (!record || !hasExactKeys(record, ["billingUsage", "providerEffectReconciler"])) return false;
  return parseWorkerReadinessRecord(record.billingUsage, expected.billingUsage) !== null
    && parseWorkerReadinessRecord(record.providerEffectReconciler, expected.providerEffectReconciler) !== null;
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
  });

  let schemaReady = false;
  try {
    const supabase = (dependencies.createClient ?? (() => createServiceRoleClient() as ReadinessClient))();
    const timeoutMs = dependencies.timeoutMs ?? READINESS_DATABASE_TIMEOUT_MS;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > READINESS_DATABASE_TIMEOUT_MS) {
      throw new Error("invalid readiness database deadline");
    }
    const controller = new AbortController();
    const query = async (name: string): Promise<ReadinessRpcResult> => {
      const rpc = supabase.rpc(name);
      const cancellableRpc = rpc.abortSignal?.(controller.signal) ?? rpc;
      return Promise.resolve(cancellableRpc);
    };
    const result = await withDeadline((async () => {
      const schema = await query("portal_schema_capabilities_service");
      if (schema.error) throw new Error("portal schema capability RPC failed");
      const capabilities = ownRecord(schema.data);
      schemaReady = capabilities !== null
        && capabilities.version === 46
        && capabilities.providerEffectReservations === true
        && capabilities.providerEffectTerminationFence === true
        && capabilities.billingUsageOutbox === true
        && capabilities.recallWebhookDedupe === true
        && capabilities.recallTenantBinding === true
        && capabilities.tavusWebhookCapabilities === true
        && capabilities.tavusWebhookCapabilityLifecycle === true
        && capabilities.tavusCustomerDeliveryReceipts === true
        && capabilities.tavusStageCapabilities === true
        && capabilities.aiUsageReservations === true
        && capabilities.aiUsageReconciliation === true
        && capabilities.workerHeartbeats === true
        && capabilities.providerTranscriptService === true
        && capabilities.authenticatedProviderTranscriptPreclaimBlocked === true
        && capabilities.authenticatedMeetingBotPreclaimBlocked === true
        && capabilities.billingCheckoutIntents === true
        && capabilities.strictSubscriptionIdentity === true
        && capabilities.legacySubscriptionWriterRevoked === true
        && capabilities.costEventSchemaVersion === true
        && capabilities.legacyCostWritersRevoked === true
        && capabilities.runtimeChannelAdmission === true
        && capabilities.runtimeChannelGrantFences === true
        && capabilities.runtimeProviderBindingReceipts === true
        && capabilities.runtimeSceneReceipts === true
        && capabilities.runtimeKillSwitches === true
        && capabilities.runtimeDualOperatorReconciliation === true
        && capabilities.runtimeBridgeReceiptIntegrity === true
        && (!readinessRequiresProviderEffectReconciliation(env)
          || capabilities.providerEffectReconciliation === true);
      if (!schemaReady) return { workersReady: false };
      if (!readinessRequiresWorkerHeartbeats(env)) return { workersReady: true };
      const workers = await query("portal_worker_readiness_service");
      if (workers.error) throw new Error("portal worker readiness RPC failed");
      return { workersReady: workerReadinessOk(workers.data, expectedWorkers) };
    })(), timeoutMs, () => controller.abort());

    if (!schemaReady || !result.workersReady) {
      return NextResponse.json(
        {
          ok: false,
          service: "axtro-portal",
          checks: { ...checks, database: true, schema: schemaReady, workers: result.workersReady },
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
        checks: { ...checks, database: false, schema: schemaReady, workers: false },
      },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }

  return NextResponse.json(
    { ok: true, service: "axtro-portal", checks: { ...checks, database: true, schema: true, workers: true } },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function GET(): Promise<NextResponse> {
  return handleReadiness();
}
