import { type NextRequest, NextResponse } from "next/server";
import { createUuidV7 } from "@axtro/domain";

import {
  authorizeProviderEffectReconciliation,
  isProviderEffectReconcilerEnabled,
  reconcilePendingProviderEffects,
} from "@/lib/paid-effects/reconciler";
import { logError as trackError } from "@/lib/telemetry";
import {
  financialWorkerRunSucceeded,
  portalFinancialWorkerIdentity,
  recordWorkerHeartbeat,
  type WorkerHeartbeatCounters,
} from "@/lib/workers/heartbeat";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" } as const;
// 3 x 25s provider deadline + DB overhead stays inside the workflow's 90s
// client deadline. The library remains reusable with other explicit limits.
const AUTOMATIC_RECONCILIATION_LIMIT = 3;

export interface ProviderEffectReconciliationRouteDependencies {
  readonly env?: NodeJS.ProcessEnv;
  readonly createRunId?: () => string;
  readonly reconcile?: typeof reconcilePendingProviderEffects;
  readonly recordHeartbeat?: typeof recordWorkerHeartbeat;
  readonly logError?: typeof trackError;
}

function reconciliationCounters(
  result: Awaited<ReturnType<typeof reconcilePendingProviderEffects>>,
): WorkerHeartbeatCounters {
  return {
    leased: result.leased,
    reconciled: result.reconciled,
    failed: result.failed,
    deadLettered: result.deadLettered,
    operatorRequired: result.operatorRequired,
    backlog: result.backlog,
    processing: result.processing,
    deadLetterBacklog: result.deadLetterBacklog,
    providerInFlight: result.providerInFlight,
    unknown: result.unknown,
    cleanupPending: result.cleanupPending,
  };
}

export async function handleProviderEffectReconciliation(
  request: Pick<NextRequest, "headers">,
  dependencies: ProviderEffectReconciliationRouteDependencies = {},
): Promise<Response> {
  const env = dependencies.env ?? process.env;
  const reportError = dependencies.logError ?? trackError;
  if (!isProviderEffectReconcilerEnabled(env)) {
    return NextResponse.json({ error: "not_configured" }, { status: 503, headers: NO_STORE });
  }
  const authorization = authorizeProviderEffectReconciliation(
    request.headers.get("authorization"),
    env.PROVIDER_EFFECT_RECONCILE_SECRET,
  );
  if (authorization === "not_configured") {
    return NextResponse.json({ error: "not_configured" }, { status: 503, headers: NO_STORE });
  }
  if (authorization === "unauthorized") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }

  const runId = (dependencies.createRunId ?? createUuidV7)();
  const heartbeat = dependencies.recordHeartbeat ?? recordWorkerHeartbeat;
  let workerIdentity;
  try {
    workerIdentity = portalFinancialWorkerIdentity("provider_effect_reconciler", env);
  } catch (error) {
    reportError("provider_effect_reconciliation_deployment_identity_invalid", error, {});
    return NextResponse.json({ ok: false, error: "reconciliation_failed" }, { status: 503, headers: NO_STORE });
  }
  try {
    await heartbeat("provider_effect_reconciler", runId, "started", {}, workerIdentity);
  } catch (error) {
    reportError("provider_effect_reconciliation_heartbeat_started_failed", error, {});
    return NextResponse.json({ ok: false, error: "reconciliation_failed" }, { status: 503, headers: NO_STORE });
  }

  try {
    const result = await (dependencies.reconcile ?? reconcilePendingProviderEffects)(AUTOMATIC_RECONCILIATION_LIMIT);
    const counters = reconciliationCounters(result);
    if (!financialWorkerRunSucceeded("provider_effect_reconciler", counters)) {
      throw new Error("provider reconciliation batch reported unresolved financial failures");
    }
    await heartbeat("provider_effect_reconciler", runId, "succeeded", counters, workerIdentity);
    return NextResponse.json(
      { ok: true, ...result },
      { headers: NO_STORE },
    );
  } catch (error) {
    reportError("provider_effect_reconciliation_failed", error, {});
    try {
      await heartbeat("provider_effect_reconciler", runId, "failed", {}, workerIdentity);
    } catch (heartbeatError) {
      reportError("provider_effect_reconciliation_heartbeat_failed_failed", heartbeatError, {});
    }
    return NextResponse.json({ ok: false, error: "reconciliation_failed" }, { status: 503, headers: NO_STORE });
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  return handleProviderEffectReconciliation(request);
}
