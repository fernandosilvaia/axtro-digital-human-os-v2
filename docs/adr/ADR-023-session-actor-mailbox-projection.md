# ADR-023: Session Actor mailbox as a canonical-event projection

**Status:** Accepted

**Date:** 2026-07-14

## Context

M1 needs a Session Actor that serializes hot-session mutations without adding a
daemon, broker, provider SDK, or a second implementation of the domain
reducer. The existing M0 deterministic outbox is intentionally a local
transaction fake. It rejects truly overlapping asynchronous transactions and
therefore cannot safely become a global mailbox or a realtime synchronization
primitive.

The authoritative state remains the append-only timeline and the pure reducer.
M1-01 already writes canonical lifecycle envelopes. M1-06 owns durable timeline
and snapshot persistence, replay verification, and production persistence
adapters. The Python realtime worker already owns only trusted telemetry
handling and must not duplicate the actor or reducer in this milestone.

## Decision

- Add `@axtro/session-runtime` as the only M1 implementation of the Session
  Actor and its bounded in-process mailbox. An actor registry is keyed by the
  pair `(tenant_id, session_id)`. It has no global queue, lock, ordering key, or
  daemon dependency.
- The actor accepts only an existing canonical `EventEnvelope`, decodes it with
  `@axtro/events`, and applies the existing pure domain reducer. It never
  creates an event, calls the outbox, writes a timeline or snapshot, calls a
  provider, invokes the Axtro Agent, or publishes media.
- Canonical event delivery is idempotent by `event_id` plus a canonical
  envelope fingerprint. An identical hot re-delivery returns the prior reduced
  result. When the bounded hot ledger has evicted a delivery, the actor reads
  the authoritative bounded canonical history and returns the historical
  result without re-running the reducer. Reusing an event ID with a different
  envelope fails closed before a mutation. If a stale delivery is absent from
  canonical evidence, the actor raises `SessionActorReplayWindowError` without
  changing state or metrics. The cancellation ledger separately evicts settled
  records only when a new safety command needs capacity, so completed
  cancellation work cannot permanently consume the safety lane.
- Rehydration reads an optional local snapshot and the canonical timeline from
  a tenant-scoped source. It validates snapshot identity, state hash and
  version, validates every timeline envelope, requires continuous aggregate
  versions, and confirms that snapshot plus tail matches full replay. Missing
  snapshots replay from version zero. An altered snapshot, a tenant or session
  mismatch, an event-ID conflict, or a version gap fails closed.
- Every replay-source read receives one bounded deadline and cancellation
  signal. A timeout aborts the local control, discards any late source result,
  fails closed, and lets the registry remove the partially hydrated actor.
  Source I/O remains outside the mailbox state section. Each actor allows one
  cache-miss historical replay lookup at a time and coalesces identical
  `(event_id, fingerprint)` lookups before source I/O.
- The mailbox serializes only short synchronous state reductions. Source reads
  happen before a reduction enters the mailbox. Future provider or channel I/O
  must complete outside the state section and return as a new canonical command.
  Safety cancellation has a reserved control slot, generation identifiers are
  monotonic, and a late generation is rejected before any future publish port
  can use it.
- The M1 Floor Manager is the reducer-derived `active_presenter_id` only.
  `session.activated` and `presenter.changed` arrive only after the authorized
  writer has committed them. This milestone does not accept a presenter as a
  direct command, perform human handoff, or publish media.
- No JSON Schema, OpenAPI operation, AsyncAPI event, migration, or Python
  cross-process bridge is added. The existing `EventEnvelope` contract and
  internal `InteractionAggregateState` cover this local boundary. M1-06 owns
  durable snapshot and timeline contracts; M2 owns Python and media adapter
  integration.

## Alternatives considered

- Let the Session Actor create events and commit through the deterministic
  outbox.
- Use a process-global queue around the existing transaction coordinator.
- Duplicate the actor and reducer in the Python realtime worker.
- Accept arbitrary presenter or state patch commands from a caller.

## Consequences

The Walking Skeleton has deterministic per-session serialization, replay,
duplicate-delivery handling, One Mouth projection, and cancellation semantics
without coupling realtime execution to a fake transaction coordinator. A
future durable store replaces the local replay source without moving policy,
provider, or HTTP responsibilities into the domain. Timeline writers remain
responsible for authorization and atomic persistence before the actor observes
an event.

## Revisit trigger

M1-06 introduces canonical durable snapshot and timeline adapters, or M2
introduces the Python worker bridge and media cancellation ports.

## Operational limit

M1-02 bounds a source replay to 10,000 canonical events and uses a full local
replay only on a hot-ledger historical cache miss. Each source read defaults to
a 1,000 ms deadline and cannot exceed 10,000 ms. M1-06 must replace this
temporary lookup with a durable snapshot plus tail and receipt lookup strategy
before a larger production timeline is supported. The single in-flight lookup
limit is a local DoS boundary, not a future production throughput target.
