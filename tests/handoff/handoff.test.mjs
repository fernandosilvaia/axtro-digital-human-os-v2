import assert from "node:assert/strict";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../..", import.meta.url));
const handoff = await import(pathToFileURL(join(root, "packages/handoff/dist/index.js")).href);

const TENANT_ALPHA = "018bcfe5-0000-7abc-8f01-020304050607";

function manualClock(startMs = 0) {
  let value = startMs;
  return { now: () => value, advance: (deltaMs) => { value += deltaMs; } };
}

function acceptingFloorChanger() {
  const calls = [];
  return {
    changer: {
      async changePresenter(input) {
        calls.push(input);
        return { accepted: true };
      },
    },
    calls,
  };
}

function recordingNotifier() {
  const notifications = [];
  return {
    notifier: {
      async notify(handoffId, packet) {
        notifications.push({ handoffId, packet });
      },
    },
    notifications,
  };
}

function baseRequest(overrides = {}) {
  return {
    tenantId: TENANT_ALPHA,
    sessionId: "session-1",
    requestedByActorId: "axtro-agent",
    currentPresenterId: "agent-ai-1",
    targetHumanId: "human-1",
    contextPacket: {
      summary: "Customer wants enterprise pricing with a Q3 close.",
      objections: [{ category: "price", summary: "Thinks it's too expensive", status: "open" }],
      receipts: [{ receiptId: "receipt-1", description: "Catalog lookup for enterprise plan" }],
      openActions: ["Confirm final discount with manager"],
    },
    deadlineMs: 5_000,
    ...overrides,
  };
}

test("accept: an accepted transfer changes the presenter floor exactly once and delivers the full context packet", async () => {
  const { changer, calls } = acceptingFloorChanger();
  const { notifier, notifications } = recordingNotifier();
  const coordinator = handoff.createHandoffCoordinator(changer, notifier, manualClock(0));

  const proposal = await coordinator.requestHandoff(baseRequest());
  assert.equal(proposal.status, "pending");
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].packet.summary.includes("enterprise pricing"), true);
  assert.equal(notifications[0].packet.objections.length, 1);
  assert.equal(notifications[0].packet.receipts.length, 1);
  assert.equal(notifications[0].packet.openActions.length, 1);

  const accepted = await coordinator.acceptHandoff(proposal.handoffId, "human-1", 100);
  assert.equal(accepted.status, "accepted");
  assert.equal(calls.length, 1, "the floor changes exactly once");
  assert.deepEqual(calls[0], {
    tenantId: TENANT_ALPHA,
    sessionId: "session-1",
    expectedPresenterId: "agent-ai-1",
    newPresenterId: "human-1",
  });

  // Accepting again is a no-op read of the already-resolved proposal, not a second floor change.
  const acceptedAgain = await coordinator.acceptHandoff(proposal.handoffId, "human-1", 200);
  assert.equal(acceptedAgain.status, "accepted");
  assert.equal(calls.length, 1, "a second accept call never triggers a second floor change");
});

test("timeout: an unresolved proposal past its deadline is timed out and never changes the floor", async () => {
  const { changer, calls } = acceptingFloorChanger();
  const { notifier } = recordingNotifier();
  const clock = manualClock(0);
  const coordinator = handoff.createHandoffCoordinator(changer, notifier, clock);

  const proposal = await coordinator.requestHandoff(baseRequest({ deadlineMs: 1_000 }));
  clock.advance(2_000);
  const result = await coordinator.acceptHandoff(proposal.handoffId, "human-1", clock.now());
  assert.equal(result.status, "timed_out");
  assert.equal(calls.length, 0, "a timed-out handoff never touches the presenter floor");
});

test("rollback: an accepted handoff can be reversed, returning the floor to the original presenter exactly once", async () => {
  const { changer, calls } = acceptingFloorChanger();
  const { notifier } = recordingNotifier();
  const coordinator = handoff.createHandoffCoordinator(changer, notifier, manualClock(0));

  const proposal = await coordinator.requestHandoff(baseRequest());
  await coordinator.acceptHandoff(proposal.handoffId, "human-1", 100);
  const rolledBack = await coordinator.rollback(proposal.handoffId, 200);
  assert.equal(rolledBack.status, "rolled_back");
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1], {
    tenantId: TENANT_ALPHA,
    sessionId: "session-1",
    expectedPresenterId: "human-1",
    newPresenterId: "agent-ai-1",
  });

  await assert.rejects(coordinator.rollback(proposal.handoffId, 300), handoff.HandoffError, "cannot roll back a handoff twice");
});

test("simultaneous request: a second handoff request for the same session while one is pending is rejected as a conflict, not queued or merged", async () => {
  const { changer } = acceptingFloorChanger();
  const { notifier } = recordingNotifier();
  const coordinator = handoff.createHandoffCoordinator(changer, notifier, manualClock(0));

  const first = await coordinator.requestHandoff(baseRequest());
  assert.equal(first.status, "pending");

  const second = await coordinator.requestHandoff(baseRequest({ targetHumanId: "human-2" }));
  assert.equal(second.status, "conflict_simultaneous_request");

  // The original proposal is untouched and still acceptable.
  const stillPending = coordinator.getProposal(first.handoffId);
  assert.equal(stillPending.status, "pending");
});

test("simultaneous request: once the pending proposal resolves, a new request for the same session is accepted normally", async () => {
  const { changer } = acceptingFloorChanger();
  const { notifier } = recordingNotifier();
  const coordinator = handoff.createHandoffCoordinator(changer, notifier, manualClock(0));

  const first = await coordinator.requestHandoff(baseRequest());
  await coordinator.declineHandoff(first.handoffId, 50);

  const second = await coordinator.requestHandoff(baseRequest({ targetHumanId: "human-2" }));
  assert.equal(second.status, "pending");
});

test("a floor-change CAS rejection is surfaced as declined, not silently swallowed", async () => {
  const rejectingChanger = { changePresenter: async () => ({ accepted: false }) };
  const { notifier } = recordingNotifier();
  const coordinator = handoff.createHandoffCoordinator(rejectingChanger, notifier, manualClock(0));

  const proposal = await coordinator.requestHandoff(baseRequest());
  const result = await coordinator.acceptHandoff(proposal.handoffId, "human-1", 10);
  assert.equal(result.status, "declined");
});

test("only the intended human can accept a handoff", async () => {
  const { changer } = acceptingFloorChanger();
  const { notifier } = recordingNotifier();
  const coordinator = handoff.createHandoffCoordinator(changer, notifier, manualClock(0));

  const proposal = await coordinator.requestHandoff(baseRequest());
  await assert.rejects(coordinator.acceptHandoff(proposal.handoffId, "some-other-human", 10), handoff.HandoffError);
});
