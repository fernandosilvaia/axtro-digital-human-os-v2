# ADR-010: Governed action runtime and receipts

**Status:** Accepted  
**Date:** 2026-07-14

## Context

A natural-language model must not possess direct authority over CRM, calendar, proposals or payments.

## Decision

All actions follow ActionIntent, contract validation, PolicyDecision, optional approval, idempotent execution and ToolExecutionReceipt. Only a succeeded receipt confirms effect. Unknown effect requires reconciliation.

## Alternatives considered

Direct tool calling from model output; human approval for every action.

## Consequences

Safe scalable automation with more explicit schemas and adapters.

## Revisit trigger

Risk policy may become stricter per sector, but the funnel remains.
