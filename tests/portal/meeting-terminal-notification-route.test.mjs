import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

const workerModuleUrl = new URL(
  "../../apps/portal/src/lib/workers/meeting-terminal-notifications.ts",
  import.meta.url,
).href;
const heartbeatModuleUrl = new URL(
  "../../apps/portal/src/lib/workers/heartbeat.ts",
  import.meta.url,
).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/server") return { url: "meeting-route-mock:next-server", shortCircuit: true };
    if (specifier === "@/lib/workers/meeting-terminal-notifications") return { url: workerModuleUrl, shortCircuit: true };
    if (specifier === "@/lib/workers/heartbeat") return { url: heartbeatModuleUrl, shortCircuit: true };
    if (specifier === "@/lib/telemetry") return { url: "meeting-route-mock:telemetry", shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === "meeting-route-mock:next-server") {
      return {
        format: "module",
        shortCircuit: true,
        source: `
          export class NextRequest {}
          export class NextResponse extends Response {
            static json(body, init = {}) {
              const headers = new Headers(init.headers);
              headers.set("content-type", "application/json");
              return new NextResponse(JSON.stringify(body), { ...init, headers });
            }
          }
        `,
      };
    }
    if (url === "meeting-route-mock:telemetry") {
      return { format: "module", shortCircuit: true, source: "export function logError() {}" };
    }
    return nextLoad(url, context);
  },
});

const { handleMeetingTerminalNotificationDispatch } = await import(
  "../../apps/portal/src/app/api/internal/meeting-terminal-notifications/route.ts"
);
const {
  PORTAL_MEETING_TERMINAL_NOTIFICATION_WORKER_VERSION,
  notificationWorkerRunSucceeded,
  portalWorkerIdentity,
  recordWorkerHeartbeat,
} = await import("../../apps/portal/src/lib/workers/heartbeat.ts");

const SECRET = "meeting-notification-secret-for-tests";
const RUN_ID = "0198f5d0-45c0-7000-8000-000000000700";
const REQUEST = Object.freeze({ headers: new Headers({ authorization: `Bearer ${SECRET}` }) });
const ENV = Object.freeze({
  AXTRO_DEPLOYMENT_ID: "deployment-meeting-worker-20260831",
  PORTAL_FAKE_PROVIDERS: "0",
  MEETING_TERMINAL_NOTIFICATION_OUTBOX_ENABLED: "true",
  MEETING_TERMINAL_NOTIFICATION_DISPATCH_SECRET: SECRET,
  RESEND_API_KEY: "re_test_route_key",
});
const RESULT = Object.freeze({
  leased: 1,
  providerAccepted: 1,
  simulated: 0,
  retryScheduled: 0,
  ambiguous: 0,
  deadLettered: 0,
  suppressed: 0,
  backlog: 0,
  deadLetterBacklog: 0,
  ambiguousBacklog: 0,
  oldestDispatchableAgeSeconds: 0,
});
const COUNTERS = Object.freeze(Object.fromEntries(
  Object.entries(RESULT).filter(([key]) => key !== "oldestDispatchableAgeSeconds"),
));

test("heartbeat de notificação usa versão própria, identidade sem segredo e receipt booleano", async () => {
  const identity = portalWorkerIdentity("meeting_terminal_notification", { ...ENV });
  assert.match(identity.configFingerprint, /^sha256:[0-9a-f]{64}$/);
  assert.equal(identity.configFingerprint.includes(SECRET), false);
  assert.equal(identity.configFingerprint.includes(ENV.RESEND_API_KEY), false);
  const calls = [];
  await recordWorkerHeartbeat(
    "meeting_terminal_notification",RUN_ID,"started",{},identity,
    { createClient: () => ({ rpc: async (name, parameters) => { calls.push({ name, parameters }); return { data: true, error: null }; } }) },
  );
  assert.equal(calls[0].parameters.p_version, PORTAL_MEETING_TERMINAL_NOTIFICATION_WORKER_VERSION);
  assert.equal(calls[0].parameters.p_worker_kind, "meeting_terminal_notification");
});

test("predicado de sucesso exige todos os contadores e zero estado não resolvido", () => {
  assert.equal(notificationWorkerRunSucceeded(COUNTERS), true);
  for (const patch of [
    { retryScheduled: 1 }, { ambiguous: 1 }, { deadLettered: 1 },
    { deadLetterBacklog: 1 }, { ambiguousBacklog: 1 }, { providerAccepted: undefined },
  ]) assert.equal(notificationWorkerRunSucceeded({ ...COUNTERS, ...patch }), false);
});

test("rota registra started e succeeded somente para batch limpo", async () => {
  const phases = [];
  const response = await handleMeetingTerminalNotificationDispatch(REQUEST, {
    env: { ...ENV },
    createRunId: () => RUN_ID,
    dispatch: async () => RESULT,
    recordHeartbeat: async (worker, runId, phase, counters = {}, identity) => {
      phases.push({ worker, runId, phase, counters, identity });
    },
    logError: () => {},
  });
  assert.equal(response.status, 200);
  assert.deepEqual(phases.map(({ phase }) => phase), ["started", "succeeded"]);
  assert.ok(phases.every(({ worker, runId }) => worker === "meeting_terminal_notification" && runId === RUN_ID));
  assert.deepEqual(Object.keys(phases[1].counters).sort(), [
    "ambiguous", "ambiguousBacklog", "backlog", "deadLetterBacklog", "deadLettered",
    "leased", "providerAccepted", "retryScheduled", "simulated", "suppressed",
  ]);
});

test("flag, segredo, identidade e heartbeat started falham antes do dispatch", async () => {
  for (const scenario of [
    { env: { ...ENV, MEETING_TERMINAL_NOTIFICATION_OUTBOX_ENABLED: " TRUE " }, request: REQUEST },
    { env: { ...ENV, MEETING_TERMINAL_NOTIFICATION_DISPATCH_SECRET: "short" }, request: REQUEST },
    { env: { ...ENV, RESEND_API_KEY: "" }, request: REQUEST },
    { env: { ...ENV }, request: { headers: new Headers({ authorization: "Bearer wrong" }) } },
    { env: { ...ENV, AXTRO_DEPLOYMENT_ID: "" }, request: REQUEST },
  ]) {
    let dispatchCalls = 0;
    const response = await handleMeetingTerminalNotificationDispatch(scenario.request, {
      env: scenario.env,
      createRunId: () => RUN_ID,
      dispatch: async () => { dispatchCalls += 1; return RESULT; },
      recordHeartbeat: async () => {},
      logError: () => {},
    });
    assert.ok([401, 503].includes(response.status));
    assert.equal(dispatchCalls, 0);
  }

  let dispatchCalls = 0;
  const heartbeatFailure = await handleMeetingTerminalNotificationDispatch(REQUEST, {
    env: { ...ENV },
    createRunId: () => RUN_ID,
    dispatch: async () => { dispatchCalls += 1; return RESULT; },
    recordHeartbeat: async () => { throw new Error("heartbeat unavailable"); },
    logError: () => {},
  });
  assert.equal(heartbeatFailure.status, 503);
  assert.equal(dispatchCalls, 0);
});

test("ambiguidade e dead letter registram failed e retornam resposta genérica sem PII", async () => {
  for (const patch of [{ ambiguous: 1 }, { deadLettered: 1 }, { deadLetterBacklog: 1 }]) {
    const phases = [];
    const response = await handleMeetingTerminalNotificationDispatch(REQUEST, {
      env: { ...ENV },
      createRunId: () => RUN_ID,
      dispatch: async () => ({ ...RESULT, ...patch }),
      recordHeartbeat: async (_worker, _runId, phase) => phases.push(phase),
      logError: () => {},
    });
    assert.equal(response.status, 503);
    assert.deepEqual(phases, ["started", "failed"]);
    const body = await response.text();
    assert.deepEqual(JSON.parse(body), { ok: false, error: "dispatch_failed" });
    assert.equal(body.includes("@"), false);
  }
});
