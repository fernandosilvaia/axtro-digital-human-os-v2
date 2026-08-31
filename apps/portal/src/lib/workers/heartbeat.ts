import { createHash } from "node:crypto";

import { isUuidV7 } from "@axtro/domain";

import { createServiceRoleClient } from "../supabase/service.ts";

export const PORTAL_FINANCIAL_WORKER_VERSION = "m5-02-v1";
export const PORTAL_MEETING_TERMINAL_NOTIFICATION_WORKER_VERSION = "m6-01-v1";

export type PortalFinancialWorker = "billing_usage" | "provider_effect_reconciler";
export type PortalWorker = PortalFinancialWorker | "meeting_terminal_notification";
export type WorkerHeartbeatPhase = "started" | "succeeded" | "failed";

type CounterValue = boolean | number | null;
export type WorkerHeartbeatCounters = Readonly<Record<string, CounterValue>>;

export interface PortalFinancialWorkerIdentity {
  readonly deploymentId: string;
  readonly configFingerprint: string;
}
export type PortalWorkerIdentity = PortalFinancialWorkerIdentity;

interface HeartbeatRpcResult {
  readonly data: unknown;
  readonly error: { readonly message: string } | null;
}

interface HeartbeatRpcClient {
  rpc(name: string, parameters: Readonly<Record<string, unknown>>): PromiseLike<HeartbeatRpcResult>;
}

export interface RecordWorkerHeartbeatDependencies {
  readonly createClient?: () => HeartbeatRpcClient;
}

const COUNTER_KEYS = Object.freeze({
  billing_usage: new Set([
    "catalogVerified",
    "leased",
    "delivered",
    "failed",
    "deadLettered",
    "backlog",
    "deadLetterBacklog",
    "held",
    "providerInFlight",
    "unknown",
    "cleanupPending",
  ]),
  provider_effect_reconciler: new Set([
    "leased",
    "reconciled",
    "failed",
    "deadLettered",
    "operatorRequired",
    "backlog",
    "processing",
    "deadLetterBacklog",
    "providerInFlight",
    "unknown",
    "cleanupPending",
  ]),
  meeting_terminal_notification: new Set([
    "leased",
    "providerAccepted",
    "simulated",
    "retryScheduled",
    "ambiguous",
    "deadLettered",
    "suppressed",
    "backlog",
    "deadLetterBacklog",
    "ambiguousBacklog",
  ]),
} satisfies Record<PortalWorker, ReadonlySet<string>>);

const DEPLOYMENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/;
const CONFIG_FINGERPRINT_PATTERN = /^sha256:[a-f0-9]{64}$/;
const STRIPE_PRICE_ENV_VARS = Object.freeze([
  "STRIPE_PRICE_PILOTO_BASE",
  "STRIPE_PRICE_PILOTO_OVERAGE",
  "STRIPE_PRICE_CRESCIMENTO_BASE",
  "STRIPE_PRICE_CRESCIMENTO_OVERAGE",
  "STRIPE_PRICE_ESCALA_BASE",
  "STRIPE_PRICE_ESCALA_OVERAGE",
] as const);

function normalizedEnv(env: NodeJS.ProcessEnv, name: string): string {
  return (env[name] ?? "").trim();
}

function stripeApiMode(secretKey: string): "live" | "test" | "unknown" {
  if (/^(?:sk|rk)_live_/.test(secretKey)) return "live";
  if (/^(?:sk|rk)_test_/.test(secretKey)) return "test";
  return "unknown";
}

function configFingerprint(value: Readonly<Record<string, unknown>>): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex")}`;
}

/**
 * Resolve immutable deployment evidence owned by the server runtime. Railway's
 * commit SHA is the default; AXTRO_DEPLOYMENT_ID supports other deployment
 * systems. Fake mode uses a deterministic local identity and never needs
 * deployment metadata.
 */
export function portalDeploymentId(env: NodeJS.ProcessEnv): string {
  if (normalizedEnv(env, "PORTAL_FAKE_PROVIDERS") === "1") return "fake-mode";
  const explicit = normalizedEnv(env, "AXTRO_DEPLOYMENT_ID");
  const railwayCommit = normalizedEnv(env, "RAILWAY_GIT_COMMIT_SHA");
  const deploymentId = railwayCommit || explicit;
  if (!DEPLOYMENT_ID_PATTERN.test(deploymentId)) {
    throw new Error("portal deployment identity is missing or invalid");
  }
  return deploymentId;
}

/** Hash only semantic, non-secret worker configuration in a fixed order. */
export function portalFinancialWorkerIdentity(
  worker: PortalFinancialWorker,
  env: NodeJS.ProcessEnv,
): PortalFinancialWorkerIdentity {
  const deploymentId = portalDeploymentId(env);
  const fakeMode = normalizedEnv(env, "PORTAL_FAKE_PROVIDERS") === "1";
  const config = worker === "billing_usage"
    ? {
        schema: "portal-financial-worker-config/v1",
        worker,
        providerMode: fakeMode ? "fake" : "real",
        enabled: normalizedEnv(env, "BILLING_USAGE_OUTBOX_ENABLED"),
        stripeApiMode: stripeApiMode(normalizedEnv(env, "STRIPE_SECRET_KEY")),
        meterName: normalizedEnv(env, "STRIPE_CONVERSATION_OVERAGE_EVENT_NAME"),
        priceCatalog: STRIPE_PRICE_ENV_VARS.map((name) => [name, normalizedEnv(env, name)]),
      }
    : {
        schema: "portal-financial-worker-config/v1",
        worker,
        providerMode: fakeMode ? "fake" : "real",
        enabled: normalizedEnv(env, "PROVIDER_EFFECT_RECONCILER_ENABLED"),
        providers: [
          ["recall", normalizedEnv(env, "RECALL_API_REGION")],
          ["tavus", "global"],
        ],
      };
  return Object.freeze({ deploymentId, configFingerprint: configFingerprint(config) });
}

/** Resolve semantic identity for any Portal background worker. */
export function portalWorkerIdentity(
  worker: PortalWorker,
  env: NodeJS.ProcessEnv,
): PortalWorkerIdentity {
  if (worker !== "meeting_terminal_notification") {
    return portalFinancialWorkerIdentity(worker, env);
  }
  const deploymentId = portalDeploymentId(env);
  const fakeMode = normalizedEnv(env, "PORTAL_FAKE_PROVIDERS") === "1";
  return Object.freeze({
    deploymentId,
    configFingerprint: configFingerprint({
      schema: "meeting-terminal-notification-worker-config/v1",
      worker,
      providerMode: fakeMode ? "fake" : "real",
      enabled: normalizedEnv(env, "MEETING_TERMINAL_NOTIFICATION_OUTBOX_ENABLED"),
      provider: "resend",
      templateVersion: 1,
      batchLimit: 4,
      leaseSeconds: 60,
      providerTimeoutMs: 10_000,
      idempotencyWindowHours: 23,
    }),
  });
}

function validatedIdentity(identity: PortalFinancialWorkerIdentity): PortalFinancialWorkerIdentity {
  const prototype = identity !== null && typeof identity === "object"
    ? Object.getPrototypeOf(identity)
    : undefined;
  if (
    identity === null
    || typeof identity !== "object"
    || Array.isArray(identity)
    || (prototype !== Object.prototype && prototype !== null)
    || typeof identity.deploymentId !== "string"
    || typeof identity.configFingerprint !== "string"
    || !DEPLOYMENT_ID_PATTERN.test(identity.deploymentId)
    || !CONFIG_FINGERPRINT_PATTERN.test(identity.configFingerprint)
    || Object.keys(identity).sort().join(",") !== "configFingerprint,deploymentId"
  ) {
    throw new Error("worker heartbeat identity is invalid");
  }
  return Object.freeze({
    deploymentId: identity.deploymentId,
    configFingerprint: identity.configFingerprint,
  });
}

function validatedCounters(
  worker: PortalWorker,
  phase: WorkerHeartbeatPhase,
  counters: WorkerHeartbeatCounters,
): WorkerHeartbeatCounters {
  if (counters === null || typeof counters !== "object" || Array.isArray(counters)) {
    throw new Error("worker heartbeat counters must be an object");
  }
  const prototype = Object.getPrototypeOf(counters);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error("worker heartbeat counters must be a plain object");
  }
  const entries = Object.entries(counters);
  if (phase !== "succeeded" && entries.length !== 0) {
    throw new Error("non-success worker heartbeats cannot carry counters");
  }
  const allowed = COUNTER_KEYS[worker];
  for (const [key, value] of entries) {
    if (!allowed.has(key)) throw new Error("worker heartbeat counter is not allowed");
    if (value === null || typeof value === "boolean") continue;
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error("worker heartbeat counter must be a non-negative safe integer");
    }
  }
  return Object.freeze(Object.fromEntries(entries));
}

const REQUIRED_INTEGER_COUNTERS = Object.freeze({
  billing_usage: Object.freeze([
    "leased", "delivered", "failed", "deadLettered", "backlog", "deadLetterBacklog",
    "held", "providerInFlight", "unknown", "cleanupPending",
  ]),
  provider_effect_reconciler: Object.freeze([
    "leased", "reconciled", "failed", "deadLettered", "operatorRequired", "backlog",
    "processing", "deadLetterBacklog", "providerInFlight", "unknown", "cleanupPending",
  ]),
  meeting_terminal_notification: Object.freeze([
    "leased", "providerAccepted", "simulated", "retryScheduled", "ambiguous",
    "deadLettered", "suppressed", "backlog", "deadLetterBacklog", "ambiguousBacklog",
  ]),
} satisfies Record<PortalWorker, readonly string[]>);

const FAILURE_COUNTERS = Object.freeze({
  billing_usage: Object.freeze(["failed", "deadLettered", "deadLetterBacklog", "unknown", "cleanupPending"]),
  provider_effect_reconciler: Object.freeze([
    "failed", "deadLettered", "deadLetterBacklog", "unknown", "cleanupPending", "operatorRequired",
  ]),
  meeting_terminal_notification: Object.freeze([
    "retryScheduled", "ambiguous", "deadLettered", "deadLetterBacklog", "ambiguousBacklog",
  ]),
} satisfies Record<PortalWorker, readonly string[]>);

/** A successful heartbeat is allowed only for a complete, clean financial batch. */
export function financialWorkerRunSucceeded(
  worker: PortalFinancialWorker,
  counters: WorkerHeartbeatCounters,
): boolean {
  let safeCounters: WorkerHeartbeatCounters;
  try {
    safeCounters = validatedCounters(worker, "succeeded", counters);
  } catch {
    return false;
  }
  if (worker === "billing_usage" && safeCounters.catalogVerified !== true) return false;
  if (!REQUIRED_INTEGER_COUNTERS[worker].every((key) => Number.isSafeInteger(safeCounters[key]))) return false;
  return FAILURE_COUNTERS[worker].every((key) => safeCounters[key] === 0);
}

/** A notification run is clean only when every leased command reaches a non-failure terminal receipt. */
export function notificationWorkerRunSucceeded(counters: WorkerHeartbeatCounters): boolean {
  let safeCounters: WorkerHeartbeatCounters;
  try {
    safeCounters = validatedCounters("meeting_terminal_notification", "succeeded", counters);
  } catch {
    return false;
  }
  if (!REQUIRED_INTEGER_COUNTERS.meeting_terminal_notification.every((key) => Number.isSafeInteger(safeCounters[key]))) {
    return false;
  }
  return FAILURE_COUNTERS.meeting_terminal_notification.every((key) => safeCounters[key] === 0);
}

/** Persist a service-owned worker phase. Only an exact boolean receipt is success. */
export async function recordWorkerHeartbeat(
  worker: PortalWorker,
  runId: string,
  phase: WorkerHeartbeatPhase,
  counters: WorkerHeartbeatCounters = {},
  identity?: PortalWorkerIdentity,
  dependencies: RecordWorkerHeartbeatDependencies = {},
): Promise<void> {
  if (!isUuidV7(runId)) throw new Error("worker heartbeat run id must be a UUIDv7");
  const safeCounters = validatedCounters(worker, phase, counters);
  const safeIdentity = validatedIdentity(identity ?? portalWorkerIdentity(worker, process.env));
  const client = (dependencies.createClient ?? (() => createServiceRoleClient() as HeartbeatRpcClient))();
  const { data, error } = await client.rpc("portal_record_worker_heartbeat_service", {
    p_worker_kind: worker,
    p_run_id: runId,
    p_phase: phase,
    p_version: worker === "meeting_terminal_notification"
      ? PORTAL_MEETING_TERMINAL_NOTIFICATION_WORKER_VERSION
      : PORTAL_FINANCIAL_WORKER_VERSION,
    p_deployment_id: safeIdentity.deploymentId,
    p_config_fingerprint: safeIdentity.configFingerprint,
    p_counters: safeCounters,
  });
  if (error) throw new Error(`worker heartbeat persistence failed: ${error.message}`);
  if (data !== true) throw new Error("worker heartbeat receipt was not applied");
}
