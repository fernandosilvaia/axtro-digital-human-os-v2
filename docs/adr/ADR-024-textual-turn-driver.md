# ADR-024: Canonical textual turn driver with fenced Presenter responses

**Status:** Accepted

**Date:** 2026-07-14

## Context

M1-03 needs a small textual Walking Skeleton that commits a participant turn,
produces a deterministic Fast Lane response, and preserves the reducer-derived
floor. M1-02 established that the Session Actor is only a projection of
canonical envelopes. It deliberately has no writer port, transcript handling,
provider call, or media publication responsibility.

The prior `turn.committed` payload represented only a conversation-state patch.
It had no speaker identity, role, transcript, or generation fence. A late
response from an old Presenter could therefore pass an in-memory pre-check and
still be accepted by the canonical reducer after a floor change. The M0
authorization boundary also supports only verified service identities in this
development milestone, so a request body cannot establish a participant
identity.

## Decision

- Add `@axtro/turns` as the only TypeScript textual Turn Driver. It is the
  authorized writer of participant turns, interruption markers, and Presenter
  responses. The Session Actor remains an observer of each envelope returned
  by the outbox and never writes a timeline, calls a Fast Lane, or publishes
  output.
- Define generated `turn_submission` and `turn_committed` JSON Schemas with
  valid and invalid examples. The canonical `turn.committed` payload carries
  a server-validated speaker participant ID and role, restricted transcript
  text, and a generation ID that is null for a participant and positive for a
  Presenter. The reducer requires a Presenter turn to name the active
  Presenter, so the outbox closes a floor race atomically.
- The request body supplies an asserted participant ID but never establishes
  authority. A server-owned, tenant and session scoped participant directory
  maps each verified authenticated principal to exactly one permitted
  participant, and rejects duplicate speaking authority. M1
  development identities are service identities, so this is an explicit local
  channel delegation seam, not a user-claim substitute. A production channel
  must replace it with a verified participant-identity adapter before public
  traffic is enabled.
- A command requires `session:write` and the `essential_processing` purpose.
  Both `client_turn_id` and `Idempotency-Key` are bound to tenant, session,
  participant, language, and a canonical hash of the text. The bounded ledger
  coalesces an identical in-flight command and rejects changed reuse.
  Per-session mutation lanes are bounded and never cover Fast Lane I/O.
- Participant text and Presenter response text are untrusted restricted data.
  They are accepted only through the explicit turn contract, placed in a
  `restricted` canonical payload for the local deterministic outbox, and are
  omitted from errors, telemetry, metrics, fake journals, and documentation.
  M1 introduces no durable transcript store, external provider, or retention
  override. ADR-016 remains authoritative for production retention and
  deletion.
- The Fast Lane is an injected local port with a deterministic fake. It has a
  composed generation and trusted request-abort signals, a bounded timeout,
  output byte and character limits,
  and an exact response plus state-patch shape. It cannot return an action,
  tool request, media command, provider choice, specialist result, or Axtro
  Agent result. The call happens outside the actor mailbox and all command
  lanes.
- A submit sequence validates identity and state, commits the participant
  event in the outbox, projects that exact envelope into the actor, creates a
  generation, then calls Fast Lane. Before a response is committed, the
  driver reacquires the short session mutation lane, checks the generation and
  captured floor, commits a Presenter event, projects it, and only then
  returns text. The reducer and outbox are the final One Mouth fence.
- An interruption first invalidates and aborts the generation on the Actor
  safety lane, then writes and projects one `turn.interrupted` marker. The
  local per-session invalidation fence is set before its first await, and a
  marker is written only when the exact pending generation cancels with
  `cancelled`, not `stale`. Fast Lane timeout, failure, invalid output, and
  trusted request cancellation also invalidate and cancel their matching
  generation before returning a failure.
- The M1 replay source adapter reads only the authorized tenant's exact
  session envelopes from the existing local outbox. It stores no snapshot or
  extra timeline. M1-06 replaces this temporary source with durable snapshots
  and timeline persistence.
- `apps/api` exposes a thin development `submitTurn` adapter using the
  existing ingress, authentication, deadline, and problem pipeline. The Python
  realtime worker receives only a boundary document and has no duplicate
  driver, actor, reducer, queue, or bridge implementation.

## Alternatives considered

- Let the Session Actor generate and commit response events.
- Return an ephemeral response without a canonical Presenter event.
- Trust `speaker_participant_id` supplied by a public request body.
- Pass raw text to a provider contract or an Axtro Agent in the Fast Lane.
- Add a global transaction lock or persist a new transcript database in M1-03.

## Consequences

The Walking Skeleton can prove a three-turn canonical conversation,
deterministic response, idempotency, tenant isolation, floor fencing,
interruption, timeout, and late-output discard with no credentials, network,
media, tool execution, or Axtro Agent critical-path dependency. The restricted
local transcript seam is intentionally narrow and must not be promoted to a
production persistence design without a retention, encryption, deletion, and
channel identity review.

## Revisit trigger

M1-06 adds durable snapshots and timeline persistence, M2 adds a verified
participant channel identity and realtime media adapters, or a provider
benchmark selects a model adapter contract.
