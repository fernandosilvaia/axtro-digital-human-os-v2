# ADR-027: Authoritative session timeline and replay verification

**Status:** Accepted

**Date:** 2026-07-15

## Context

ADR-005 makes the append-only session timeline authoritative and treats
snapshots as rebuildable caches. ADR-023 introduced a read-only Session Actor
projection, but its temporary source reads the complete timeline from version
zero and only filters a snapshot tail in memory. That does not prove a real
`snapshot + tail` read, and the existing `session_timeline` table does not
materialize `event_id` or reconcile the canonical envelope with its relational
identity columns.

M1-06 must persist and verify this boundary without connecting a broker,
provider, remote database, or production environment. M1-07 remains responsible
for wiring the outbox relay to the timeline writer.

## Decision

- `@axtro/events` owns a tenant-scoped session timeline repository. The M1
  implementation is a deterministic local persistence model behind a repository
  interface; it does not claim to be a PostgreSQL client. Append requires an
  authenticated `session:write` scope, and reads require `session:read`.
- Canonical events use the existing generated `event_envelope` contract. The
  repository preserves insertion order and a canonical envelope fingerprint,
  enforces contiguous aggregate versions, and indexes both
  `(tenant_id, event_id)` and `(tenant_id, session_id, aggregate_version)`.
  An identical redelivery returns the prior append result. Reusing an event ID
  with different content, reusing a version, introducing a gap, or crossing a
  tenant or session fails before mutation.
- Timeline capacity is bounded per session and session allocation is bounded per
  tenant. Reads do not create storage buckets and never sort malformed source
  data before validation.
- Add the closed generated `session_state_snapshot` contract for the complete
  interaction aggregate: session, conversation, role, quality and optional role
  extensions. It carries explicit tenant, session, aggregate version, state
  hash, snapshot identity and creation timestamp. Snapshot documents are
  classified as `restricted` operational data and must not be logged.
- The repository materializes a snapshot only by replaying its own canonical
  timeline. A caller may supply only trusted storage metadata, never state,
  version or hash. At most the latest cache entry is retained per session in the
  deterministic implementation. Snapshot absence never blocks replay from zero.
- `@axtro/session-runtime` owns a public deterministic replay verifier. It
  replays the complete authoritative history, validates an optional snapshot
  against the exact canonical prefix, performs a real
  `listTimeline(..., snapshot.aggregate_version)` read, compares that tail with
  the authoritative suffix by event identity and fingerprint, then proves final
  state, version and hash equivalence. The Actor publishes state only after the
  complete verification succeeds.
- Replay-source I/O remains outside the mailbox and under its existing bounded
  deadline and cancellation signal. The Session Actor gains no timeline,
  snapshot, outbox, provider, tool, media or Axtro Agent write port.
- Add forward-only migration `0010` to materialize UUIDv7 `event_id` on
  `session_timeline`, validate and backfill existing canonical envelopes, enforce
  tenant-scoped event uniqueness, and reconcile envelope identity and metadata
  with relational columns. Existing forced RLS and append-only mutation trigger
  remain authoritative. For the controlled historical backfill only, migration
  `0010` disables that one trigger inside its transaction and re-enables it
  before constraints and commit; any failure rolls the trigger state back.
  Continuity stays in the transactional writer rather than a database trigger
  in M1.
- A future PostgreSQL repository must read snapshot, full replay and tail from a
  consistent transaction or explicit watermark. The deterministic repository
  has an immutable view during each synchronous read; the verifier also rejects
  divergent full and tail sequences.

## Alternatives considered

- Continue filtering a complete replay in memory and call it snapshot plus tail.
- Trust a self-consistent snapshot hash without comparing it to canonical events.
- Let the Session Actor write snapshots or timeline rows.
- Duplicate the event envelope with a second timeline-event contract.
- Add a PostgreSQL driver, broker relay, hash chain or signing service in M1-06.

## Consequences

M1 obtains a receipt-like append result, an idempotent and bounded timeline
writer, a rebuildable snapshot cache, and explicit evidence that replay from
zero equals replay from snapshot plus a real tail read. Tenant isolation and
canonical identity are enforced both in the application model and in the
normative PostgreSQL schema.

The local repository is deterministic and suitable for the Walking Skeleton,
but it is not a process-durable PostgreSQL adapter. M1-07 will connect at-least-
once outbox delivery to this writer. Protection against an administrator who
can rewrite the entire store would require a signed hash chain and a separate
ADR; it is not part of M1-06.

## Revisit trigger

Revisit when a PostgreSQL client is selected, when timeline volume exceeds the
10,000-event M1 bound, or when a threat model requires externally anchored
event signatures.
