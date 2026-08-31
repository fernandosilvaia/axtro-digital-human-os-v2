import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowUrl = new URL(
  "../../.github/workflows/meeting-terminal-notification-dispatch.yml",
  import.meta.url,
);

test("workflow de notificação terminal permanece manual, protegido e sem retry HTTP", async () => {
  const workflow = await readFile(workflowUrl, "utf8");

  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /\bschedule:/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /permissions: \{\}/);
  assert.match(workflow, /environment: production/);
  assert.doesNotMatch(workflow, /actions\/checkout/);
  assert.match(workflow, /https:\/\/closer\.axtroai\.com\/api\/internal\/meeting-terminal-notifications/);
  assert.match(workflow, /Authorization: Bearer \$\{MEETING_TERMINAL_NOTIFICATION_DISPATCH_SECRET\}/);
  assert.match(workflow, /--connect-timeout 10 --max-time 120/);
  assert.doesNotMatch(workflow, /--retry/);
  assert.match(workflow, /MEETING_TERMINAL_NOTIFICATION_DISPATCH_SECRET: \$\{\{ secrets\.MEETING_TERMINAL_NOTIFICATION_DISPATCH_SECRET \}\}/);
  const jobEnv = workflow.match(/env:\n      MEETING_TERMINAL_NOTIFICATION_DISPATCH_URL:[\s\S]*?    steps:/)?.[0] ?? "";
  assert.doesNotMatch(jobEnv, /DISPATCH_SECRET/);
  assert.match(workflow, /jq -e "\$\{RESPONSE_GATE\}"/);
});

test("workflow rejeita qualquer resultado não resolvido e permite backlog normal", async () => {
  const workflow = await readFile(workflowUrl, "utf8");

  assert.doesNotMatch(workflow, /\.backlog == 0/);
  assert.doesNotMatch(workflow, /recipient|subject|html|providerReceipt/i);
});

test("gate jq valida shape e falha fechado para todos os estados não resolvidos", () => {
  const workflow = readFileSync(workflowUrl, "utf8");
  const gate = workflow.match(/RESPONSE_GATE='([\s\S]*?)'\n\s+jq -e "\$\{RESPONSE_GATE\}"/)?.[1];
  assert.equal(typeof gate, "string", "o teste deve extrair o mesmo gate inline executado pelo workflow");
  const run = (payload) => spawnSync("jq", ["-e", gate], {
    input: JSON.stringify(payload),
    encoding: "utf8",
  }).status;
  const success = Object.freeze({
    ok: true,
    leased: 1,
    providerAccepted: 1,
    simulated: 0,
    retryScheduled: 0,
    ambiguous: 0,
    deadLettered: 0,
    suppressed: 0,
    backlog: 9,
    deadLetterBacklog: 0,
    ambiguousBacklog: 0,
    oldestDispatchableAgeSeconds: 123,
  });

  assert.equal(run(success), 0, "backlog ordinário é permitido");

  for (const counter of [
    "retryScheduled",
    "ambiguous",
    "deadLettered",
    "deadLetterBacklog",
    "ambiguousBacklog",
  ]) {
    assert.notEqual(run({ ...success, [counter]: 1 }), 0, counter);
  }
  for (const counter of [
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
    "oldestDispatchableAgeSeconds",
  ]) {
    const absent = { ...success };
    delete absent[counter];
    assert.notEqual(run(absent), 0, `${counter}:absent`);
    for (const value of [null, "0", -1, 0.5]) {
      assert.notEqual(run({ ...success, [counter]: value }), 0, `${counter}:${String(value)}`);
    }
  }
  assert.notEqual(run({ ...success, ok: false }), 0);
  for (const extra of ["recipient", "html", "providerReceipt"]) {
    assert.notEqual(run({ ...success, [extra]: "restricted" }), 0, `${extra}:extra`);
  }
});
