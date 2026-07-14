# ADR-005: Structured session state with append-only timeline

**Status:** Accepted  
**Date:** 2026-07-14

## Context

LLM context cannot be the source of truth for consent, actions, price, presenter ownership or commitments. Full event sourcing everywhere would be excessive.

## Decision

Use structured current state, pure reducers, append-only session timeline and rebuildable snapshots for the session aggregate. Other domains use conventional relational state plus audit and outbox.

## Alternatives considered

Prompt memory as truth; full event sourcing for all modules.

## Consequences

Replay, audit and concurrency safety where they matter without imposing event sourcing on the full platform.

## Revisit trigger

Timeline volume or rebuild cost requires snapshot policy tuning, not abandonment of authoritative events.
