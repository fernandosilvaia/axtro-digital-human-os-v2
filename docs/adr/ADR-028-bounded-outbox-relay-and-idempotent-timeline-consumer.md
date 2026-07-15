# ADR-028: Bounded outbox relay and idempotent timeline consumer

**Status:** Accepted

**Date:** 2026-07-15

## Context

ADR-011 and M0-13 established an atomic outbox and a local seam that proves
basic at-least-once delivery. That seam cannot recover a record left in
`publishing`, binds consumer deduplication to a process-local `WeakMap`, has no
lease or fencing token, has no bounded retry policy and does not expose a
dead-letter state. M1-06 made the session timeline authoritative and its append
operation idempotent by tenant, event identity and canonical fingerprint.

M1-07 must connect these boundaries without selecting a broker, database client,
provider or workflow engine. The session timeline remains the effect ledger and
the outbox remains the delivery authority.

## Decision

- `@axtro/events` owns the deterministic delivery state machine. The states are
  `pending`, `publishing`, `failed`, `published` and `dead_letter`. A claim is
  tenant-scoped, atomic, has a bounded lease and a UUIDv7 fencing token, and
  increments a bounded attempt counter.
- A claim token is single-use for the lifetime of its bounded tenant repository.
  A stale or historically reused token cannot acknowledge, retry, dead-letter
  or claim a newer attempt. The lease is expired when the trusted injected
  clock reaches its deadline, so completion must occur strictly before that
  instant. Retry availability and backoff use the same clock and no timer or
  tight retry loop is created.
- Ordering is guaranteed only per tenant and aggregate version. A predecessor
  in any state other than `published` blocks its successors. A dead letter
  therefore prevents a silent aggregate gap while independent aggregates remain
  eligible.
- The outbox is bounded per tenant. Each relay invocation handles at most one
  event, attempts and lease duration are capped, and a poison event or exhausted
  retry budget becomes `dead_letter` exactly once.
- The first successful claim pins the bounded attempt budget for that event.
  Replacement relay configuration cannot expand, shrink or conflict with the
  in-flight budget, so configuration drift cannot strand the tenant lane.
- `apps/event-relay` owns the bounded `runOnce` orchestration and the explicit
  timeline consumer. It claims one canonical envelope, calls
  `SessionTimelineRepository.appendCanonicalEvent`, then acknowledges with the
  returned state hash. An identical redelivery returns the same timeline append
  receipt, so a crash after the effect and before acknowledgement does not apply
  the effect twice.
- A crash after claim leaves the fenced lease intact. A replacement relay
  instance using the same repository can recover only after lease expiry. A
  crash after the timeline effect follows the same recovery path and relies on
  timeline idempotency rather than an in-process consumer ledger.
- The M1 registry is code-owned and admits only the `session-timeline`
  consumer. A caller cannot bind a pending event to an arbitrary consumer name.
  Additional consumers require an explicit contract and registry change.
- Add `event:relay` for claim, acknowledgement, retry and dead-letter mutation.
  It is accepted only for a service identity whose actor type is `workflow`.
  Add `event:observe` for tenant-scoped delivery and dead-letter reads. Neither
  scope grants session lifecycle writes, and both require the
  `essential_processing` purpose at the repository boundary. The timeline
  consumer still requires its existing `session:write` scope.
- Add the closed generated `event_delivery_receipt` contract. It contains only
  tenant and event identity, aggregate ordering, consumer name, canonical
  fingerprint, trace and correlation identity, status, bounded attempts, closed
  failure code, optional effect hash and timestamps. It is `internal` and never
  contains payload, transcript, claim token, bearer token, exception text or
  stack.
- `event-relay` is a registered telemetry service. Each claimed delivery uses
  the canonical event trace and correlation identifiers in an `outbox.relay`
  span with closed event codes and PII-free attributes. Canonical 32-character
  nonzero trace IDs continue unchanged. Other contract-valid 16 to 64
  character hexadecimal trace IDs are deterministically normalized to a W3C
  32-character ID with the versioned `axtro-event-trace-v1` hash domain; the
  receipt still preserves the original trace identity. Sink failures are
  isolated from acknowledgement, retry and dead-letter state.
- No AsyncAPI change is needed because the receipt is an operational read model,
  not a published event or workflow command.

## Deterministic M1 persistence profile

The M1 implementation keeps delivery state in the deterministic local outbox
repository. It survives replacement of the relay application object while that
repository remains available, but it is not a PostgreSQL adapter and does not
claim persistence across process or machine loss. The existing normative table
already models status, attempts, availability and dead-letter state. A future
PostgreSQL adapter for this exact claim protocol requires a forward-only
migration for claim token, lease expiry, consumer binding, closed failure code
and dead-letter timestamp before it may claim durable restart recovery.

## Alternatives considered

- Continue using `relayOnce` and the consumer `WeakMap` from M0.
- Reuse `session:write` alone to control delivery state.
- Acknowledge before applying the timeline effect.
- Allow a dead-lettered predecessor to be skipped.
- Scan all tenants globally or run an unbounded drain loop.
- Add Redis, Kafka, Temporal, a PostgreSQL client or a production worker now.

## Consequences

M1 can prove crash recovery, stale-worker fencing, at-least-once delivery,
idempotent timeline effects, bounded retries and observable dead letters with no
network or credential. The architecture remains reversible because delivery
orchestration depends on ports and canonical contracts rather than a selected
broker.

The local repository remains a Walking Skeleton persistence model. Process-loss
durability, distributed claim contention and operational requeue require a
future database adapter and migration; M1-07 does not pretend those exist.

## Revisit trigger

Revisit before a multi-process relay, broker, workflow engine or PostgreSQL
adapter is enabled, and before dead-letter requeue becomes an operator action.
