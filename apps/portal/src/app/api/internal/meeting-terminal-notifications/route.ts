import { createUuidV7 } from "@axtro/domain";
import { NextRequest, NextResponse } from "next/server";

import {
  authorizeMeetingTerminalNotificationDispatch,
  dispatchMeetingTerminalNotifications,
  isMeetingTerminalNotificationDispatchEnabled,
  meetingTerminalNotificationProviderReady,
} from "@/lib/workers/meeting-terminal-notifications";
import { logError as trackError } from "@/lib/telemetry";
import {
  notificationWorkerRunSucceeded,
  portalWorkerIdentity,
  recordWorkerHeartbeat,
  type WorkerHeartbeatCounters,
} from "@/lib/workers/heartbeat";

export const dynamic = "force-dynamic";
const NO_STORE = { "cache-control": "no-store" } as const;

export interface MeetingTerminalNotificationRouteDependencies {
  readonly env?: NodeJS.ProcessEnv;
  readonly createRunId?: () => string;
  readonly dispatch?: typeof dispatchMeetingTerminalNotifications;
  readonly recordHeartbeat?: typeof recordWorkerHeartbeat;
  readonly logError?: typeof trackError;
}

function notificationCounters(
  result: Awaited<ReturnType<typeof dispatchMeetingTerminalNotifications>>,
): WorkerHeartbeatCounters {
  return {
    leased: result.leased,
    providerAccepted: result.providerAccepted,
    simulated: result.simulated,
    retryScheduled: result.retryScheduled,
    ambiguous: result.ambiguous,
    deadLettered: result.deadLettered,
    suppressed: result.suppressed,
    backlog: result.backlog,
    deadLetterBacklog: result.deadLetterBacklog,
    ambiguousBacklog: result.ambiguousBacklog,
  };
}

export async function handleMeetingTerminalNotificationDispatch(
  request: Pick<NextRequest, "headers">,
  dependencies: MeetingTerminalNotificationRouteDependencies = {},
): Promise<Response> {
  const env = dependencies.env ?? process.env;
  const reportError = dependencies.logError ?? trackError;
  if (!isMeetingTerminalNotificationDispatchEnabled(env)) {
    return NextResponse.json({ error: "not_configured" }, { status: 503, headers: NO_STORE });
  }
  const authorization = authorizeMeetingTerminalNotificationDispatch(
    request.headers.get("authorization"),
    env.MEETING_TERMINAL_NOTIFICATION_DISPATCH_SECRET,
  );
  if (authorization === "not_configured") {
    return NextResponse.json({ error: "not_configured" }, { status: 503, headers: NO_STORE });
  }
  if (authorization === "unauthorized") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }
  if (!meetingTerminalNotificationProviderReady(env)) {
    return NextResponse.json({ error: "not_configured" }, { status: 503, headers: NO_STORE });
  }

  const runId = (dependencies.createRunId ?? createUuidV7)();
  const heartbeat = dependencies.recordHeartbeat ?? recordWorkerHeartbeat;
  let identity;
  try {
    identity = portalWorkerIdentity("meeting_terminal_notification", env);
  } catch (error) {
    reportError("meeting_terminal_notification_identity_invalid", error, {});
    return NextResponse.json({ ok: false, error: "dispatch_failed" }, { status: 503, headers: NO_STORE });
  }
  try {
    await heartbeat("meeting_terminal_notification", runId, "started", {}, identity);
  } catch (error) {
    reportError("meeting_terminal_notification_heartbeat_started_failed", error, {});
    return NextResponse.json({ ok: false, error: "dispatch_failed" }, { status: 503, headers: NO_STORE });
  }

  try {
    const result = await (dependencies.dispatch ?? dispatchMeetingTerminalNotifications)();
    const counters = notificationCounters(result);
    if (!notificationWorkerRunSucceeded(counters)) {
      throw new Error("meeting notification batch has unresolved outcomes");
    }
    await heartbeat("meeting_terminal_notification", runId, "succeeded", counters, identity);
    return NextResponse.json({ ok: true, ...result }, { headers: NO_STORE });
  } catch (error) {
    reportError("meeting_terminal_notification_dispatch_failed", error, {});
    try {
      await heartbeat("meeting_terminal_notification", runId, "failed", {}, identity);
    } catch (heartbeatError) {
      reportError("meeting_terminal_notification_heartbeat_failed_failed", heartbeatError, {});
    }
    return NextResponse.json({ ok: false, error: "dispatch_failed" }, { status: 503, headers: NO_STORE });
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  return handleMeetingTerminalNotificationDispatch(request);
}
