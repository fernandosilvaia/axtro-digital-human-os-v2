# ADR-011: Transactional outbox separated from durable workflows

**Status:** Accepted  
**Date:** 2026-07-14

## Context

Events distribute facts, while follow-ups, timers, retries and compensations need durable orchestration. Treating the event bus as a workflow engine creates fragile consumers.

## Decision

Commit domain event to outbox with aggregate changes. Relay at least once. Start explicit workflow commands handled by a durable workflow port. Choose Temporal or equivalent during M1 based on operational fit.

## M0 implementation profile

M0-13 uses a deterministic in-memory transaction coordinator behind a repository seam. It accepts only an authenticated request context, derives the tenant from that opaque context, validates an interaction event through the existing event codec, and atomically stages the reduced aggregate state with one canonical event envelope. A forward-only migration materializes `event_id` in `events_outbox`, makes `(tenant_id, event_id)` unique in addition to the existing aggregate-version key, and rejects an envelope whose event or tenant identity does not match its row.

The M0 relay is a bounded local fake. It has at-least-once delivery semantics, preserves order only per tenant and aggregate, and proves a fake consumer effect is idempotent by `(tenant_id, event_id)`. It has no broker, network client, worker, global tenant scan, lease recovery, dead-letter loop, or workflow dispatch. M1-07 remains responsible for a production relay and durable consumer implementation.

## Alternatives considered

Synchronous cross-module calls; use Redis Streams alone for every long-running process.

## Consequences

Clear delivery semantics and recoverable processes, with one workflow technology decision deferred behind a port.

## Revisit trigger

Workflow provider selection can change if replay, timer and migration contract tests pass.
