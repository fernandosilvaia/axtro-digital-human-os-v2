import assert from "node:assert/strict";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../..", import.meta.url));
const workflows = await import(pathToFileURL(join(root, "packages/workflows/dist/index.js")).href);

const TENANT_ALPHA = "018bcfe5-0000-7abc-8f01-020304050607";

function fakeGenerator() {
  const calls = [];
  return {
    generator: {
      async generate(evidence) {
        calls.push(evidence);
        return { subject: `Follow-up: ${evidence.summary.slice(0, 40)}`, bodyReferences: [...evidence.confirmedFactIds, ...evidence.receiptIds] };
      },
    },
    calls,
  };
}

function recordingSendSink() {
  const sent = [];
  return {
    sink: {
      async send(draft) {
        sent.push(draft);
        return { externalRef: `ext-${sent.length}` };
      },
    },
    sent,
  };
}

function baseInput(overrides = {}) {
  return {
    tenantId: TENANT_ALPHA,
    sessionId: "session-1",
    idempotencyKey: "followup-1",
    evidence: {
      summary: "Customer asked for enterprise pricing and a Q3 close date.",
      confirmedFactIds: ["fact-1", "fact-2"],
      openActions: ["Send updated proposal"],
      receiptIds: ["receipt-1"],
    },
    ...overrides,
  };
}

test("draft: the follow-up draft is tied to session evidence, never free text", async () => {
  const { generator, calls } = fakeGenerator();
  const { sink } = recordingSendSink();
  const workflow = workflows.createSandboxFollowUpWorkflow(generator, sink);

  const result = await workflow.run(baseInput());
  assert.equal(result.status, "send_denied_sandbox");
  assert.deepEqual(result.draft.bodyReferences, ["fact-1", "fact-2", "receipt-1"]);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].confirmedFactIds, ["fact-1", "fact-2"]);
});

test("sandbox: no send happens unless approvalPathEnabled is explicitly true", async () => {
  const { generator } = fakeGenerator();
  const { sink, sent } = recordingSendSink();
  const workflow = workflows.createSandboxFollowUpWorkflow(generator, sink);

  await workflow.run(baseInput());
  assert.equal(sent.length, 0, "sandbox mode (the default) never sends");

  const result = await workflow.run(baseInput({ idempotencyKey: "followup-2", approvalPathEnabled: true }));
  assert.equal(result.status, "sent");
  assert.ok(result.externalRef);
  assert.equal(sent.length, 1);
});

test("retry: a transient generator failure propagates, and a retry with the same idempotencyKey succeeds without duplicating the draft", async () => {
  let callCount = 0;
  const generator = {
    async generate(evidence) {
      callCount += 1;
      if (callCount === 1) throw new Error("transient provider failure");
      return { subject: "Follow-up", bodyReferences: [...evidence.confirmedFactIds] };
    },
  };
  const { sink, sent } = recordingSendSink();
  const workflow = workflows.createSandboxFollowUpWorkflow(generator, sink);
  const input = baseInput({ idempotencyKey: "followup-retry" });

  await assert.rejects(workflow.run(input));
  assert.equal(workflow.attemptsFor(TENANT_ALPHA, "followup-retry"), 1);

  const retried = await workflow.run(input);
  assert.equal(retried.status, "send_denied_sandbox");
  assert.equal(workflow.attemptsFor(TENANT_ALPHA, "followup-retry"), 2);
  assert.equal(callCount, 2, "the generator ran exactly twice — once failed, once succeeded");
  assert.equal(sent.length, 0);
});

test("duplicate completion: running an already-resolved idempotencyKey again returns the identical result without regenerating or resending", async () => {
  const { generator, calls } = fakeGenerator();
  const { sink, sent } = recordingSendSink();
  const workflow = workflows.createSandboxFollowUpWorkflow(generator, sink);
  const input = baseInput({ idempotencyKey: "followup-dup", approvalPathEnabled: true });

  const first = await workflow.run(input);
  const second = await workflow.run(input);
  assert.deepEqual(first, second);
  assert.equal(calls.length, 1, "the generator never runs twice for a completed idempotency key");
  assert.equal(sent.length, 1, "the send sink never fires twice for a completed idempotency key");
});

test("two different idempotency keys for the same session produce two independent drafts", async () => {
  const { generator } = fakeGenerator();
  const { sink } = recordingSendSink();
  const workflow = workflows.createSandboxFollowUpWorkflow(generator, sink);

  const first = await workflow.run(baseInput({ idempotencyKey: "followup-a" }));
  const second = await workflow.run(baseInput({ idempotencyKey: "followup-b" }));
  assert.notEqual(first.draft.draftId, second.draft.draftId);
});
