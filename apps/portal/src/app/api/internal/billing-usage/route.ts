import { NextRequest, NextResponse } from "next/server";
import { createUuidV7 } from "@axtro/domain";

import {
  authorizeBillingDispatch,
  dispatchBillingUsageOutbox,
  isBillingUsageDispatchEnabled,
} from "@/lib/billing/usage-outbox";
import { logError as trackError } from "@/lib/telemetry";
import {
  financialWorkerRunSucceeded,
  portalFinancialWorkerIdentity,
  recordWorkerHeartbeat,
  type WorkerHeartbeatCounters,
} from "@/lib/workers/heartbeat";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" } as const;

export interface BillingUsageRouteDependencies {
  readonly env?: NodeJS.ProcessEnv;
  readonly createRunId?: () => string;
  readonly dispatch?: typeof dispatchBillingUsageOutbox;
  readonly recordHeartbeat?: typeof recordWorkerHeartbeat;
  readonly logError?: typeof trackError;
}

function billingCounters(result: Awaited<ReturnType<typeof dispatchBillingUsageOutbox>>): WorkerHeartbeatCounters {
  if (result.catalogVerified !== true) throw new Error("billing usage preflight receipt is invalid");
  return {
    catalogVerified: true,
    leased: result.leased,
    delivered: result.delivered,
    failed: result.failed,
    deadLettered: result.deadLettered,
    backlog: result.backlog,
    deadLetterBacklog: result.deadLetterBacklog,
    held: result.held,
    providerInFlight: result.providerInFlight,
    unknown: result.unknown,
    cleanupPending: result.cleanupPending,
  };
}

export async function handleBillingUsageDispatch(
  request: Pick<NextRequest, "headers">,
  dependencies: BillingUsageRouteDependencies = {},
): Promise<Response> {
  const env = dependencies.env ?? process.env;
  const reportError = dependencies.logError ?? trackError;
  if (!isBillingUsageDispatchEnabled(env)) {
    return NextResponse.json({ error: "not_configured" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
  const authorization = authorizeBillingDispatch(
    request.headers.get("authorization"),
    env.BILLING_DISPATCH_SECRET,
  );
  if (authorization === "not_configured") return NextResponse.json({ error: "not_configured" }, { status: 503, headers: NO_STORE });
  if (authorization === "unauthorized") return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });

  const runId = (dependencies.createRunId ?? createUuidV7)();
  const heartbeat = dependencies.recordHeartbeat ?? recordWorkerHeartbeat;
  let workerIdentity;
  try {
    workerIdentity = portalFinancialWorkerIdentity("billing_usage", env);
  } catch (error) {
    reportError("billing_usage_deployment_identity_invalid", error, {});
    return NextResponse.json({ ok: false, error: "dispatch_failed" }, { status: 503, headers: NO_STORE });
  }
  try {
    await heartbeat("billing_usage", runId, "started", {}, workerIdentity);
  } catch (error) {
    reportError("billing_usage_heartbeat_started_failed", error, {});
    return NextResponse.json({ ok: false, error: "dispatch_failed" }, { status: 503, headers: NO_STORE });
  }

  try {
    const result = await (dependencies.dispatch ?? dispatchBillingUsageOutbox)();
    const counters = billingCounters(result);
    if (!financialWorkerRunSucceeded("billing_usage", counters)) {
      throw new Error("billing usage batch reported unresolved financial failures");
    }
    await heartbeat("billing_usage", runId, "succeeded", counters, workerIdentity);
    return NextResponse.json({ ok: true, ...result }, { headers: NO_STORE });
  } catch (error) {
    reportError("billing_usage_dispatch_failed", error, {});
    try {
      await heartbeat("billing_usage", runId, "failed", {}, workerIdentity);
    } catch (heartbeatError) {
      reportError("billing_usage_heartbeat_failed_failed", heartbeatError, {});
    }
    return NextResponse.json({ ok: false, error: "dispatch_failed" }, { status: 503, headers: NO_STORE });
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  return handleBillingUsageDispatch(request);
}
