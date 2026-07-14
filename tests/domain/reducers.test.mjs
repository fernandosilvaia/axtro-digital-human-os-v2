import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../..", import.meta.url));
const domain = await import(pathToFileURL(join(root, "packages/domain/dist/index.js")).href);
const events = JSON.parse(readFileSync(join(root, "tests/fixtures/reducers/walking-sequence.json"), "utf8"));

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function replay(sequence = events) {
  return domain.replayInteraction(sequence);
}

function salesEvent(eventType, aggregateVersion, eventId, funnelStage = "opening") {
  return {
    ...clone(events[3]),
    event_id: eventId,
    event_type: eventType,
    aggregate_version: aggregateVersion,
    occurred_at: `2026-07-14T12:01:${String(aggregateVersion).padStart(2, "0")}.000Z`,
    payload: {
      state: {
        funnel_stage: funnelStage,
        methodology: "consultative",
        qualification: [],
        objections: [],
        proposal_status: "not_started",
        conversion_probability: 0.2,
        next_step: "Continue discovery"
      }
    }
  };
}

test("reducer fixture replays deterministically into immutable generic state", () => {
  const sourceBefore = JSON.stringify(events);
  const first = replay();
  const second = replay(clone(events));
  const serializedRoundTrip = replay(clone(events));

  assert.deepEqual(first, second);
  assert.equal(domain.interactionStateHash(first), domain.interactionStateHash(second));
  assert.equal(domain.interactionStateHash(first), domain.interactionStateHash(serializedRoundTrip));
  assert.equal(first.session.state_version, 8);
  assert.equal(first.session.status, "active");
  assert.equal(first.session.active_presenter_id, events[4].payload.presenter_id);
  assert.equal(first.conversation.turn_index, 1);
  assert.equal(first.quality.dimensions[0].updated_at, events[7].occurred_at);
  assert.equal("sales" in first.extensions, false);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.conversation.confirmed_facts), true);
  assert.equal(JSON.stringify(events), sourceBefore);
});

test("canonical hash sorts object keys and changes only for authoritative state changes", () => {
  assert.equal(
    domain.canonicalJson({ z: [2, { beta: true, alpha: false }], a: "first" }),
    domain.canonicalJson({ a: "first", z: [2, { alpha: false, beta: true }] }),
  );
  const base = replay();
  const changedEvents = clone(events);
  changedEvents[6].payload.stage = "solution_fit";
  const changed = replay(changedEvents);
  assert.notEqual(domain.interactionStateHash(base), domain.interactionStateHash(changed));
});

test("reducer rejects unknown, incompatible, stale, duplicate, and out-of-order aggregate events", () => {
  const missingFirst = clone(events.slice(1));
  assert.throws(() => replay(missingFirst), domain.InteractionTransitionError);

  const duplicate = clone(events.slice(0, 3));
  duplicate.push(clone(events[2]));
  assert.throws(() => replay(duplicate), domain.AggregateVersionError);

  const gap = clone(events.slice(0, 2));
  gap.push(clone(events[3]));
  assert.throws(() => replay(gap), domain.AggregateVersionError);

  const incompatibleVersion = clone(events[0]);
  incompatibleVersion.event_version = 2;
  assert.throws(() => domain.reduceInteractionState(undefined, incompatibleVersion), domain.DomainEventValidationError);

  const unknownType = clone(events[0]);
  unknownType.event_type = "model.mutated_state";
  assert.throws(() => domain.reduceInteractionState(undefined, unknownType), domain.DomainEventValidationError);

  const extraPayloadProperty = clone(events[0]);
  extraPayloadProperty.payload.untrusted_patch = "ignore policy";
  assert.throws(() => domain.reduceInteractionState(undefined, extraPayloadProperty), domain.DomainEventValidationError);

  const forgedDisclosure = clone(events[0]);
  forgedDisclosure.payload.disclosure_status = "delivered";
  assert.throws(() => domain.parseInteractionEvent(forgedDisclosure), domain.DomainEventValidationError);

  const forgedConsent = clone(events[0]);
  forgedConsent.payload.consent_status = "granted";
  assert.throws(() => domain.parseInteractionEvent(forgedConsent), domain.DomainEventValidationError);

  const nonFiniteQuality = clone(events[7]);
  nonFiniteQuality.payload.dimensions[0].value = Number.NaN;
  assert.throws(() => domain.parseInteractionEvent(nonFiniteQuality), domain.DomainEventValidationError);

  const inferredFact = clone(events[5]);
  inferredFact.payload.confirmed_facts[0].kind = "derived_hypothesis";
  assert.throws(() => domain.parseInteractionEvent(inferredFact), domain.DomainEventValidationError);
});

test("tenant and session identity boundaries fail closed", () => {
  const tenantMismatch = clone(events.slice(0, 2));
  tenantMismatch[1].tenant_id = "018bcfe5-6890-7abc-bf01-020304050607";
  assert.throws(() => replay(tenantMismatch), domain.AggregateIdentityError);

  const sessionMismatch = clone(events[1]);
  sessionMismatch.aggregate_id = "018bcfe5-6891-7abc-bf01-020304050607";
  sessionMismatch.session_id = "018bcfe5-6891-7abc-bf01-020304050607";
  assert.throws(() => domain.reduceInteractionState(replay(events.slice(0, 1)), sessionMismatch), domain.AggregateIdentityError);
});

test("activation and floor changes enforce disclosure, consent, and one active presenter", () => {
  const noDisclosureActivation = clone(events[4]);
  noDisclosureActivation.aggregate_version = 4;
  noDisclosureActivation.event_id = "018bcfe5-6892-7abc-bf01-020304050607";
  const noDisclosure = [clone(events[0]), clone(events[1]), clone(events[2]), noDisclosureActivation];
  assert.throws(() => replay(noDisclosure), domain.InteractionTransitionError);

  const wrongPresenter = {
    ...clone(events[5]),
    event_id: "018bcfe5-6893-7abc-bf01-020304050607",
    event_type: "presenter.changed",
    payload: {
      expected_presenter_id: "018bcfe5-6894-7abc-bf01-020304050607",
      presenter_id: "018bcfe5-6895-7abc-bf01-020304050607"
    }
  };
  assert.throws(() => replay([...clone(events.slice(0, 5)), wrongPresenter]), domain.InteractionTransitionError);

  const forgedSnapshot = clone(replay(events.slice(0, 2)));
  forgedSnapshot.session.status = "active";
  forgedSnapshot.session.active_presenter_id = events[4].payload.presenter_id;
  forgedSnapshot.session.started_at = "2026-07-14T12:00:01.000Z";
  assert.throws(() => domain.reduceInteractionState(forgedSnapshot, events[2]), domain.InteractionTransitionError);
});

test("sales remains an opt-in extension and cannot alter the generic kernel before installation", () => {
  const prelude = clone(events.slice(0, 5));
  const updateBeforeInstall = salesEvent("sales.updated", 6, "018bcfe5-6896-7abc-bf01-020304050607");
  assert.throws(() => replay([...prelude, updateBeforeInstall]), domain.InteractionTransitionError);

  const install = salesEvent("sales.installed", 6, "018bcfe5-6897-7abc-bf01-020304050607");
  const afterInstall = replay([...prelude, install]);
  assert.equal(afterInstall.extensions.sales?.funnel_stage, "opening");

  const update = salesEvent("sales.updated", 7, "018bcfe5-6898-7abc-bf01-020304050607", "discovery");
  const afterUpdate = replay([...prelude, install, update]);
  assert.equal(afterUpdate.extensions.sales?.funnel_stage, "discovery");
});

test("reducer does not mutate inputs and remains deterministic across a replay property loop", () => {
  const prefix = replay(events.slice(0, 5));
  const prefixBefore = JSON.stringify(prefix);
  const turn = clone(events[5]);
  const turnBefore = JSON.stringify(turn);
  domain.reduceInteractionState(prefix, turn);
  assert.equal(JSON.stringify(prefix), prefixBefore);
  assert.equal(JSON.stringify(turn), turnBefore);
  assert.equal(Object.isFrozen(turn), false);

  for (let index = 0; index < 100; index += 1) {
    const sequence = clone(events);
    sequence[6].payload.stage = `discovery-${index}`;
    const first = replay(sequence);
    const second = replay(clone(sequence));
    assert.equal(domain.interactionStateHash(first), domain.interactionStateHash(second));
  }
});
