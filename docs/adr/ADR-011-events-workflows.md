# ADR-011: Transactional outbox separated from durable workflows

**Status:** Accepted  
**Date:** 2026-07-14

## Context

Events distribute facts, while follow-ups, timers, retries and compensations need durable orchestration. Treating the event bus as a workflow engine creates fragile consumers.

## Decision

Commit domain event to outbox with aggregate changes. Relay at least once. Start explicit workflow commands handled by a durable workflow port. Choose Temporal or equivalent during M1 based on operational fit.

## Alternatives considered

Synchronous cross-module calls; use Redis Streams alone for every long-running process.

## Consequences

Clear delivery semantics and recoverable processes, with one workflow technology decision deferred behind a port.

## Revisit trigger

Workflow provider selection can change if replay, timer and migration contract tests pass.
