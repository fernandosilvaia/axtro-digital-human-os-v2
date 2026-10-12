import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { WORKERS, gateBilling, gateMeeting, gateReconciler } from "../../deploy/worker-cron/gates.mjs";
import { run } from "../../deploy/worker-cron/worker-cron.mjs";

const root = (path) => fileURLToPath(new URL(`../../${path}`, import.meta.url));
const read = (path) => readFileSync(root(path), "utf8");
const jqAvailable = spawnSync("jq", ["--version"]).status === 0;

const WORKFLOWS = Object.freeze({
  billing: ".github/workflows/billing-usage-dispatch.yml",
  reconciler: ".github/workflows/provider-effect-reconcile.yml",
  meeting: ".github/workflows/meeting-terminal-notification-dispatch.yml",
});

const BILLING_OK = Object.freeze({
  ok: true, catalogVerified: true, leased: 2, delivered: 2, failed: 0, deadLettered: 0,
  backlog: 0, deadLetterBacklog: 0, held: 0, providerInFlight: 0, unknown: 0, cleanupPending: 0,
  oldestAgeSeconds: null, oldestHeldAgeSeconds: null, oldestProviderPendingAgeSeconds: null,
});
const RECONCILER_OK = Object.freeze({
  ok: true, leased: 1, reconciled: 1, failed: 0, deadLettered: 0, operatorRequired: 0,
  backlog: 0, processing: 0, deadLetterBacklog: 0, providerInFlight: 0, unknown: 0,
  cleanupPending: 0, oldestAgeSeconds: null, oldestUnknownAgeSeconds: null,
});
const MEETING_OK = Object.freeze({
  ok: true, leased: 0, providerAccepted: 0, simulated: 0, retryScheduled: 0, ambiguous: 0,
  deadLettered: 0, suppressed: 0, backlog: 0, deadLetterBacklog: 0, ambiguousBacklog: 0,
  oldestDispatchableAgeSeconds: 0,
});

const BAD_VALUES = [null, "0", "x", -1, 0.5, 1, 3, 7, false, true, {}, []];

// Variacoes sistematicas de um payload valido: o proprio, cada chave removida, cada chave
// trocada por valores de tipos e faixas diferentes, uma chave extra e formatos nao objeto.
function variants(base) {
  const out = [base, { ...base, extraneous: 1 }];
  for (const name of Object.keys(base)) {
    const missing = { ...base };
    delete missing[name];
    out.push(missing);
    for (const value of BAD_VALUES) out.push({ ...base, [name]: value });
  }
  for (const payload of [null, [], 0, "result", true, {}]) out.push(payload);
  return out;
}

function jqAccepts(payload, args) {
  return spawnSync("jq", ["-e", ...args], { input: JSON.stringify(payload), encoding: "utf8" }).status === 0;
}

test("billing gate is equivalent to scripts/worker-response-gate.jq on every variation", { skip: !jqAvailable }, () => {
  const gate = root("scripts/worker-response-gate.jq");
  const populated = [
    { ...BILLING_OK, backlog: 2, oldestAgeSeconds: 3 },
    { ...BILLING_OK, backlog: 2, oldestAgeSeconds: null },
    { ...BILLING_OK, held: 1, oldestHeldAgeSeconds: 5 },
    { ...BILLING_OK, held: 1, oldestHeldAgeSeconds: null },
    { ...BILLING_OK, providerInFlight: 1, oldestProviderPendingAgeSeconds: 9 },
    { ...BILLING_OK, providerInFlight: 1, oldestProviderPendingAgeSeconds: null },
    { ...BILLING_OK, operatorRequired: 0 },
    { ...BILLING_OK, operatorRequired: 1 },
  ];
  let accepted = 0;
  for (const payload of [...variants(BILLING_OK), ...populated]) {
    const expected = jqAccepts(payload, ["--arg", "worker", "billing", "-f", gate]);
    assert.equal(gateBilling(JSON.parse(JSON.stringify(payload))), expected, JSON.stringify(payload));
    if (expected) accepted += 1;
  }
  assert.ok(accepted >= 4, "the variation set must exercise accepting payloads too");
});

test("reconciler gate is equivalent to scripts/worker-response-gate.jq on every variation", { skip: !jqAvailable }, () => {
  const gate = root("scripts/worker-response-gate.jq");
  const populated = [
    { ...RECONCILER_OK, backlog: 1, oldestAgeSeconds: 4 },
    { ...RECONCILER_OK, backlog: 1, oldestAgeSeconds: null },
    { ...RECONCILER_OK, processing: 2, oldestAgeSeconds: 0 },
    { ...RECONCILER_OK, processing: 2, oldestAgeSeconds: null },
    { ...RECONCILER_OK, deadLetterBacklog: 1 },
    { ...RECONCILER_OK, unknown: 1, oldestUnknownAgeSeconds: 2 },
    { ...RECONCILER_OK, operatorRequired: 2 },
  ];
  let accepted = 0;
  for (const payload of [...variants(RECONCILER_OK), ...populated]) {
    const expected = jqAccepts(payload, ["--arg", "worker", "reconciler", "-f", gate]);
    assert.equal(gateReconciler(JSON.parse(JSON.stringify(payload))), expected, JSON.stringify(payload));
    if (expected) accepted += 1;
  }
  assert.ok(accepted >= 4, "the variation set must exercise accepting payloads too");
});

test("meeting gate is equivalent to the RESPONSE_GATE embedded in its workflow", { skip: !jqAvailable }, () => {
  const workflow = read(WORKFLOWS.meeting);
  const gate = /RESPONSE_GATE='([^']*)'/.exec(workflow)?.[1];
  assert.ok(gate && gate.includes("ambiguousBacklog"), "the workflow gate must be found");
  let accepted = 0;
  for (const payload of variants(MEETING_OK)) {
    const expected = jqAccepts(payload, [gate]);
    assert.equal(gateMeeting(JSON.parse(JSON.stringify(payload))), expected, JSON.stringify(payload));
    if (expected) accepted += 1;
  }
  assert.ok(accepted >= 1);
});

test("each worker mirrors its workflow: call timeout and the fields it logs", () => {
  const expectedTimeouts = { billing: 480, reconciler: 90, meeting: 120 };
  for (const [name, path] of Object.entries(WORKFLOWS)) {
    const workflow = read(path);
    assert.equal(Number(/--max-time (\d+)/.exec(workflow)?.[1]), expectedTimeouts[name], `${name} workflow timeout`);
    assert.equal(WORKERS[name].maxTimeMs, expectedTimeouts[name] * 1000, `${name} cron timeout`);
    const summaries = [...workflow.matchAll(/jq -c '\{([^}]*)\}'/g)].map((match) => match[1].split(","));
    assert.deepEqual([...WORKERS[name].summary].sort(), [...summaries.at(-1)].sort(), `${name} logged fields`);
    assert.ok(existsSync(root(`apps/portal/src/app/api/internal${WORKERS[name].path.slice("/api/internal".length)}/route.ts`)),
      `${name} protected route exists in the portal`);
  }
});

function fakeFetch(status, body, calls) {
  return async (url, init) => {
    calls.push({ url, init });
    return new Response(typeof body === "string" || body === null ? body : JSON.stringify(body), { status });
  };
}

const SECRET = "test-secret-".padEnd(40, "s");
const baseEnv = (overrides = {}) => ({
  WORKER: "billing",
  WORKER_URL: "https://portal.example.test/api/internal/billing-usage",
  WORKER_SECRET: SECRET,
  ...overrides,
});

async function runWith(env, fetchImpl) {
  const out = [];
  const err = [];
  const code = await run(env, { fetchImpl, stdout: (line) => out.push(line), stderr: (line) => err.push(line) });
  return { code, out, err, all: [...out, ...err].join("\n") };
}

test("a 200 that passes the gate exits 0, logs the counters and never prints the secret", async () => {
  const calls = [];
  const result = await runWith(baseEnv(), fakeFetch(200, BILLING_OK, calls));
  assert.equal(result.code, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, baseEnv().WORKER_URL);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${SECRET}`);
  assert.equal(calls[0].init.redirect, "manual", "a redirect is a failure, never followed with the Bearer");
  assert.ok(calls[0].init.signal instanceof AbortSignal, "the call has a hard timeout");
  assert.equal(result.err.length, 0);
  const line = JSON.parse(result.out[0]);
  assert.equal(line.worker, "billing");
  assert.equal(line.status, 200);
  assert.equal(line.delivered, 2);
  assert.equal(line.oldestAgeSeconds, null);
  assert.ok(!result.all.includes(SECRET), "the secret must not be logged");
});

test("every worker accepts its own healthy payload through run()", async () => {
  const cases = [
    ["reconciler", "https://portal.example.test/api/internal/provider-effects/reconcile", RECONCILER_OK],
    ["meeting", "https://portal.example.test/api/internal/meeting-terminal-notifications", MEETING_OK],
  ];
  for (const [worker, url, payload] of cases) {
    const result = await runWith(baseEnv({ WORKER: worker, WORKER_URL: url }), fakeFetch(200, payload, []));
    assert.equal(result.code, 0, worker);
    assert.equal(JSON.parse(result.out[0]).worker, worker);
  }
});

test("anything other than a healthy 200 exits 1 without leaking the secret", async () => {
  const failures = [
    ["http 503", fakeFetch(503, { ok: false, error: "schema_not_ready" }, [])],
    ["http 401", fakeFetch(401, { ok: false, error: "unauthorized" }, [])],
    ["http 500 with an html body", fakeFetch(500, "<html>oops</html>", [])],
    ["redirect", async () => new Response(null, { status: 302, headers: { location: "https://elsewhere.example.test/" } })],
    ["200 with invalid json", fakeFetch(200, "not json", [])],
    ["200 with an empty body", fakeFetch(200, "", [])],
    ["gate: a failed delivery", fakeFetch(200, { ...BILLING_OK, failed: 1 }, [])],
    ["gate: catalog not verified", fakeFetch(200, { ...BILLING_OK, catalogVerified: false }, [])],
    ["gate: ok false", fakeFetch(200, { ...BILLING_OK, ok: false }, [])],
    ["network error", async () => { throw new TypeError("fetch failed: connect ECONNREFUSED"); }],
    ["timeout", async () => { throw new DOMException("The operation was aborted due to timeout", "TimeoutError"); }],
  ];
  for (const [label, fetchImpl] of failures) {
    const result = await runWith(baseEnv(), fetchImpl);
    assert.equal(result.code, 1, label);
    assert.equal(result.out.length, 0, `${label}: nothing is reported as success`);
    assert.ok(!result.all.includes(SECRET), `${label}: the secret must not be logged`);
  }
});

test("bad configuration fails before any network call", async () => {
  const invalid = [
    { WORKER: "" },
    { WORKER: "unknown" },
    { WORKER: "__proto__" },
    { WORKER_URL: "http://portal.example.test/api/internal/billing-usage" },
    { WORKER_URL: "https://portal.example.test/api/internal/provider-effects/reconcile" },
    { WORKER_URL: "https://portal.example.test/api/internal/billing-usage extra" },
    { WORKER_URL: "" },
    { WORKER_SECRET: "short" },
    { WORKER_SECRET: "" },
    { WORKER_SECRET: `${SECRET}\nX-Injected: 1` },
  ];
  for (const overrides of invalid) {
    const calls = [];
    const result = await runWith(baseEnv(overrides), fakeFetch(200, BILLING_OK, calls));
    assert.equal(result.code, 1, JSON.stringify(overrides));
    assert.equal(calls.length, 0, `${JSON.stringify(overrides)} must not reach the network`);
  }
});

test("the Railway cron service is a minimal non-root image on a five minute schedule that never restarts", () => {
  const config = JSON.parse(read("deploy/worker-cron/railway.json"));
  assert.equal(config.build.builder, "DOCKERFILE");
  assert.equal(config.deploy.cronSchedule, "*/5 * * * *", "five minutes is the Railway minimum and leaves slack inside the 720 s heartbeat window");
  assert.equal(config.deploy.restartPolicyType, "NEVER");
  const dockerfile = read("deploy/worker-cron/Dockerfile");
  assert.match(dockerfile, /^FROM node:24-alpine@sha256:[0-9a-f]{64}$/m, "the base image is pinned by digest");
  assert.match(dockerfile, /^COPY gates\.mjs worker-cron\.mjs \.\/$/m);
  assert.match(dockerfile, /^USER node$/m);
  assert.match(dockerfile, /^CMD \["node", "worker-cron\.mjs"\]$/m);
  assert.doesNotMatch(dockerfile, /\b(ENV|ARG)\b[^\n]*(SECRET|TOKEN|KEY)/i);
  const heartbeatWindow = Number(/WORKER_MAX_AGE_SECONDS = (\d+)/.exec(read("apps/portal/src/app/api/ready/route.ts"))?.[1]);
  assert.ok(heartbeatWindow >= 2 * 5 * 60, "the readiness window must tolerate one missed five minute run");
});

test("the runbook gives the exact commands, the secret references and the rollback", () => {
  const runbook = read("docs/operations/WORKER_SCHEDULERS_RAILWAY_CRON.md");
  for (const needle of [
    "railway add --service cron-billing-usage",
    "railway add --service cron-provider-effects",
    "${{portal.BILLING_DISPATCH_SECRET}}",
    "${{portal.PROVIDER_EFFECT_RECONCILE_SECRET}}",
    "${{portal.PORTAL_PUBLIC_URL}}/api/internal/billing-usage",
    "${{portal.PORTAL_PUBLIC_URL}}/api/internal/provider-effects/reconcile",
    "railway up deploy/worker-cron --path-as-root",
    "BILLING_DISPATCH_SCHEDULE_ENABLED",
    "PROVIDER_EFFECT_RECONCILE_SCHEDULE_ENABLED",
    "worker_heartbeats",
    "Reverter",
  ]) assert.ok(runbook.includes(needle), `runbook mentions ${needle}`);
  assert.ok(!runbook.includes("\u2014"), "no em dash in written text");
});
