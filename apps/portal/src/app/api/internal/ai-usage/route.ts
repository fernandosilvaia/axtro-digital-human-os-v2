import { type NextRequest, NextResponse } from "next/server";

import {
  authorizeAiUsageReconciliation,
  readAiUsageReconciliationBacklog,
} from "@/lib/ai-budget/reconciliation";
import { logError as trackError, logEvent } from "@/lib/telemetry";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" } as const;

export async function GET(request: NextRequest): Promise<Response> {
  const authorization = authorizeAiUsageReconciliation(
    request.headers.get("authorization"),
    process.env.AI_USAGE_RECONCILE_SECRET,
  );
  if (authorization === "not_configured") {
    return NextResponse.json({ error: "not_configured" }, { status: 503, headers: NO_STORE });
  }
  if (authorization === "unauthorized") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }

  try {
    const backlog = await readAiUsageReconciliationBacklog();
    logEvent("ai_usage_reconciliation_backlog_observed", {
      reserved: backlog.reserved,
      provider_in_flight: backlog.providerInFlight,
      unknown: backlog.unknown,
      receipt_count: backlog.receiptCount,
    });
    return NextResponse.json({ ok: true, backlog }, { headers: NO_STORE });
  } catch (error) {
    trackError("ai_usage_reconciliation_backlog_failed", error, {});
    return NextResponse.json({ error: "reconciliation_unavailable" }, { status: 503, headers: NO_STORE });
  }
}
