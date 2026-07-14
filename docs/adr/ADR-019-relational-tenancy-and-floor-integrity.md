# ADR-019: Relational tenancy and presenter-floor integrity repair

**Status:** Accepted  
**Date:** 2026-07-14

## Context

The initial reference schema used composite foreign keys for tenant boundaries, but three session relations accepted a participant from another session in the same tenant. Two optional session references also used `ON DELETE SET NULL` over `(tenant_id, session_id)`, even though `tenant_id` is non-nullable. A real local integration run also proved that updating a `cost_events.session_id` during that referential action violates the table's append-only trigger.

## Decision

Add a forward-only migration that:

- references session participants by `(tenant_id, session_id, id)` for `active_presenter_id`, conversation turns, and handoffs;
- makes session deletion restrictive while cost or evaluation history references it, preserving append-only financial evidence and tenant attribution;
- proves the constraints and RLS boundary with a non-superuser runtime role and negative integration tests.

No public API, event, or JSON Schema payload changes in this migration. Authentication still becomes the authority that selects an allowed tenant context in M0-09.

## Alternatives considered

- Retain same-tenant-only foreign keys and depend on application checks.
- Make optional session references nullable including `tenant_id`.
- Bypass the append-only trigger for a foreign-key update.

## Consequences

The database independently rejects cross-session presenter and participant links. It also rejects physical deletion of a session with cost or evaluation history, so append-only evidence keeps its original session and tenant attribution. The migration remains forward-only.
