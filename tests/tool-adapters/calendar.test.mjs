import assert from "node:assert/strict";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../..", import.meta.url));
const calendar = await import(pathToFileURL(join(root, "packages/tool-adapters/calendar/dist/index.js")).href);

const TENANT_ALPHA = "018bcfe5-0000-7abc-8f01-020304050607";
const DAY_START_MS = 1_000_000_000_000;
const HOUR_MS = 60 * 60 * 1_000;

function manualClock(startMs) {
  let value = startMs;
  return { now: () => value, advance: (deltaMs) => { value += deltaMs; } };
}

function noBusySource() {
  return { async busyIntervals() { return []; } };
}

function busySource(intervalsByParticipant) {
  return {
    async busyIntervals(participantId, windowStartMs, windowEndMs) {
      const intervals = intervalsByParticipant[participantId] ?? [];
      return intervals.filter((interval) => interval.startMs < windowEndMs && interval.endMs > windowStartMs);
    },
  };
}

function recordingWriteSink() {
  const created = [];
  return {
    sink: {
      async createEvent(input) {
        const externalEventId = `evt-${created.length + 1}`;
        created.push({ ...input, externalEventId });
        return { externalEventId };
      },
    },
    created,
  };
}

function baseProposeRequest(overrides = {}) {
  return {
    tenantId: TENANT_ALPHA,
    requesterActorId: "agent-1",
    participantIds: ["rep-1", "customer-1"],
    durationMinutes: 30,
    windowStartMs: DAY_START_MS,
    windowEndMs: DAY_START_MS + 4 * HOUR_MS,
    timezone: "America/Sao_Paulo",
    ...overrides,
  };
}

test("timezone: an unsupported timezone is rejected before any slot is computed", async () => {
  const port = calendar.createCalendarProposalPort(noBusySource(), recordingWriteSink().sink);
  await assert.rejects(port.proposeSlots(baseProposeRequest({ timezone: "Mars/Colony_One" })), calendar.CalendarAdapterError);
});

test("timezone: a supported timezone proposes slots tagged with that exact timezone", async () => {
  const port = calendar.createCalendarProposalPort(noBusySource(), recordingWriteSink().sink);
  const result = await port.proposeSlots(baseProposeRequest());
  assert.ok(result.slots.length > 0);
  for (const slot of result.slots) assert.equal(slot.timezone, "America/Sao_Paulo");
});

test("conflict: a busy interval removes exactly the overlapping slots from the proposal", async () => {
  const source = busySource({ "rep-1": [{ startMs: DAY_START_MS + HOUR_MS, endMs: DAY_START_MS + 2 * HOUR_MS }] });
  const port = calendar.createCalendarProposalPort(source, recordingWriteSink().sink);
  const result = await port.proposeSlots(baseProposeRequest({ maxSlots: 10 }));
  for (const slot of result.slots) {
    const overlaps = slot.startMs < DAY_START_MS + 2 * HOUR_MS && slot.endMs > DAY_START_MS + HOUR_MS;
    assert.equal(overlaps, false, `slot ${slot.startMs} must not overlap the busy interval`);
  }
});

test("conflict: confirming a slot that became busy after the proposal is rejected at confirmation time", async () => {
  const source = busySource({});
  const port = calendar.createCalendarProposalPort(source, recordingWriteSink().sink);
  const proposal = await port.proposeSlots(baseProposeRequest());
  const slot = proposal.slots[0];

  // Someone else books rep-1 for that exact slot between proposal and confirmation.
  source.busyIntervals = async (participantId) => (participantId === "rep-1" ? [{ startMs: slot.startMs, endMs: slot.endMs }] : []);

  const result = await port.confirmSlot({
    tenantId: TENANT_ALPHA,
    requesterActorId: "agent-1",
    proposalId: proposal.proposalId,
    selectedSlot: slot,
    approved: true,
    dryRun: false,
    idempotencyKey: "confirm-1",
  });
  assert.equal(result.status, "conflict");
  assert.equal(result.externalEventId, null);
});

test("approval: default dry-run confirms without approval or write, and confirmed requires both approved and dryRun:false", async () => {
  const { sink, created } = recordingWriteSink();
  const port = calendar.createCalendarProposalPort(noBusySource(), sink);
  const proposal = await port.proposeSlots(baseProposeRequest());
  const slot = proposal.slots[0];

  const dryRunDefault = await port.confirmSlot({
    tenantId: TENANT_ALPHA,
    requesterActorId: "agent-1",
    proposalId: proposal.proposalId,
    selectedSlot: slot,
    approved: true,
    idempotencyKey: "confirm-dry-default",
  });
  assert.equal(dryRunDefault.status, "dry_run_confirmed");
  assert.equal(dryRunDefault.dryRun, true);
  assert.equal(created.length, 0, "dry-run never touches the write sink");

  const notApproved = await port.confirmSlot({
    tenantId: TENANT_ALPHA,
    requesterActorId: "agent-1",
    proposalId: proposal.proposalId,
    selectedSlot: proposal.slots[1],
    approved: false,
    dryRun: false,
    idempotencyKey: "confirm-not-approved",
  });
  assert.equal(notApproved.status, "not_approved");
  assert.equal(created.length, 0, "an unapproved confirmation never writes even with dryRun:false");

  const confirmed = await port.confirmSlot({
    tenantId: TENANT_ALPHA,
    requesterActorId: "agent-1",
    proposalId: proposal.proposalId,
    selectedSlot: proposal.slots[1],
    approved: true,
    dryRun: false,
    idempotencyKey: "confirm-real",
  });
  assert.equal(confirmed.status, "confirmed");
  assert.ok(confirmed.externalEventId);
  assert.equal(created.length, 1);
});

test("idempotency: replaying the same idempotencyKey never creates a second external event", async () => {
  const { sink, created } = recordingWriteSink();
  const port = calendar.createCalendarProposalPort(noBusySource(), sink);
  const proposal = await port.proposeSlots(baseProposeRequest());
  const slot = proposal.slots[0];
  const request = {
    tenantId: TENANT_ALPHA,
    requesterActorId: "agent-1",
    proposalId: proposal.proposalId,
    selectedSlot: slot,
    approved: true,
    dryRun: false,
    idempotencyKey: "confirm-idempotent",
  };

  const first = await port.confirmSlot(request);
  const second = await port.confirmSlot(request);
  assert.deepEqual(first, second);
  assert.equal(created.length, 1, "only one external event was ever created");
});

test("an expired proposal cannot be confirmed", async () => {
  const clock = manualClock(0);
  const port = calendar.createCalendarProposalPort(noBusySource(), recordingWriteSink().sink, { clock, proposalTtlMs: 1_000 });
  const proposal = await port.proposeSlots(baseProposeRequest());
  clock.advance(2_000);
  const result = await port.confirmSlot({
    tenantId: TENANT_ALPHA,
    requesterActorId: "agent-1",
    proposalId: proposal.proposalId,
    selectedSlot: proposal.slots[0],
    approved: true,
    dryRun: false,
    idempotencyKey: "confirm-expired",
  });
  assert.equal(result.status, "expired_proposal");
});

test("a slot that was never offered in the proposal cannot be confirmed", async () => {
  const port = calendar.createCalendarProposalPort(noBusySource(), recordingWriteSink().sink);
  const proposal = await port.proposeSlots(baseProposeRequest());
  const result = await port.confirmSlot({
    tenantId: TENANT_ALPHA,
    requesterActorId: "agent-1",
    proposalId: proposal.proposalId,
    selectedSlot: { startMs: proposal.slots[0].startMs + 999, endMs: proposal.slots[0].endMs + 999, timezone: "America/Sao_Paulo" },
    approved: true,
    dryRun: false,
    idempotencyKey: "confirm-unknown-slot",
  });
  assert.equal(result.status, "unknown_slot");
});
