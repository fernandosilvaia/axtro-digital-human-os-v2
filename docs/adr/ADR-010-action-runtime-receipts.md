# ADR-010: Governed action runtime and receipts

**Status:** Accepted  
**Date:** 2026-07-14

## Context

A natural-language model must not possess direct authority over CRM, calendar, proposals or payments.

## Decision

All actions follow ActionIntent, contract validation, PolicyDecision, optional approval, idempotent execution and ToolExecutionReceipt. Only a succeeded receipt confirms effect. Unknown effect requires reconciliation.

### M0 implementation profile

M0 implements the funnel with one runtime-local, deterministic catalog fixture. The fixture is read-only, has a closed contract and argument allowlist, and is private to `@axtro/tool-runtime`. It is not a provider adapter and does not mint or consume `AuthorizedToolExecution`.

`ToolPort` remains fail-closed while the runtime owns validation, authenticated tenant and actor checks, policy evaluation, approval gating, idempotency, and receipts. The M0 idempotency ledger is tenant-scoped. An `unknown` receipt is an immutable execution barrier for the same canonical operation, including a new idempotency key, until a later reconciliation capability exists.

The approval branch is exercised through a closed composition profile that can only make the M0 fixture stricter. It is not an `ActionIntent` field and cannot be selected by model text, a caller-supplied policy decision, or a receipt. The default catalog fixture remains aligned with the active `catalog.lookup` contract: tenant installation scope, `read_tenant`, internal classification, no side effects, and only Presenter or Workflow actors.

## Alternatives considered

Direct tool calling from model output; human approval for every action.

## Consequences

Safe scalable automation with more explicit schemas and adapters. The M0 catalog fixture is deliberately not reusable as a provider integration, so a later provider binding must preserve the same runtime-owned authorization boundary.

## Revisit trigger

Risk policy may become stricter per sector, but the funnel remains.
