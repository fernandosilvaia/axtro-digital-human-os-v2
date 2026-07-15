# ADR-022: Session lifecycle application command boundary

**Status:** Accepted

**Date:** 2026-07-14

## Context

M1 needs the five OpenAPI lifecycle operations without selecting an HTTP
framework, ORM, provider, worker, or production database client. A session
cannot become active after only `session.created`: the existing reducer
requires a prepared state, delivered AI disclosure, and allowed essential
processing consent. The M0 deterministic outbox accepts one event at a time,
while a lifecycle create needs that sequence to be atomic and retry-safe.

The API also needs HTTP idempotency and optimistic version checks. Event IDs
are server-minted, so outbox event-id uniqueness does not itself make a retry
of an HTTP command idempotent. Presenter ownership must be proven against a
participant belonging to the same tenant and session before the state gains an
`active_presenter_id`.

## Decision

- Add `@axtro/session-application` as the application command and read
  boundary between `apps/api` and the domain plus outbox packages. It owns no
  HTTP parsing, provider SDK selection, LLM call, tool execution, realtime
  worker, or Axtro Agent invocation. Its only delivery dependency is the
  injected, deterministic local proof seam described below.
- Keep `apps/api` framework-neutral. Its lifecycle adapter composes existing
  ingress protection, verified tenant context, scope checks, OpenAPI-shaped
  validation, and closed problem responses. An authenticated operation uses
  its telemetry trace; an ingress or authentication rejection receives a new
  server-generated trace ID and never accepts a public trace carrier.
- Every lifecycle command and read requires the `essential_processing` purpose
  together with its `session:write` or `session:read` scope. A valid tenant
  grant minted only for provider or tool authentication cannot observe or
  mutate session lifecycle state.
- Extend the deterministic outbox with an all-or-nothing event batch. Create
  appends `session.created`, `session.prepared`, `disclosure.delivered`, and
  `consent.recorded` in continuous aggregate order. The session application
  writes the corresponding disclosure evidence and server-side participant
  registry within the same local command boundary; production persistence must
  place these writes in the transaction-local tenant transaction.
- A server-owned tenant catalog validates an active agent and role-pack
  installation, derives the permitted channel policy and capabilities, and
  provisions a digital presenter participant. M1 defaults each registration
  to the local `api` channel. The deterministic disclosure-delivery fake must
  return a validated receipt before `disclosure.delivered`, the disclosure
  record, or readiness is committed. Request bodies cannot choose tenant,
  actor, trace, event IDs, consent, disclosure, capabilities, region, or
  arbitrary presenters.
- Every mutation has an idempotency ledger key scoped by tenant, operation,
  resource, and `Idempotency-Key`, bound to a canonical request hash. A
  completion reason contributes only its SHA-256 canonical hash and is never
  written to event, timeline, logs, or response. The same command returns its
  original result; any reuse with a different route, resource, or payload is a
  conflict. The local fake retains a bounded, per-tenant ledger without TTL to
  avoid replay after eviction and fails closed with 429 at capacity.
- Activate and complete run under a per-session command boundary. They compare
  the supplied `expected_state_version` with authoritative state and derive the
  next event version server-side. A trusted request deadline is checked before
  lock acquisition, after it, and inside the deterministic outbox transaction
  before commit. A stale request or expiry before commit produces no state,
  timeline, or outbox change. A completed atomic commit remains idempotently
  readable even if its transport response is lost.
- Timeline reads only canonical envelopes for the authorized tenant and exact
  aggregate, in increasing aggregate version. Snapshots, replay persistence,
  relay, dead letters, and workflow execution remain in M1-06 through M1-08.

## Alternatives considered

- Put reducer and outbox calls directly in API route handlers.
- Create a session with only `session.created` and defer preparation to an
  unimplemented endpoint.
- Treat duplicate server-minted event IDs as HTTP idempotency.
- Accept any UUIDv7 presenter and rely only on the reducer.
- Add a web server, ORM, queue, provider, or remote database during M1-01.

## Consequences

The Walking Skeleton has a small, deterministic lifecycle seam with explicit
proof for disclosure, consent policy, tenancy, One Mouth ownership, command
idempotency, optimistic versioning, timeline and outbox. It stays reversible:
a future SQL implementation replaces the deterministic store behind the same
application boundary without moving HTTP or provider concerns into the domain.
No constitutional article changes, no production access, and no realtime
critical-path dependency on the Axtro Agent are introduced.
