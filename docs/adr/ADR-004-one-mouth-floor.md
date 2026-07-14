# ADR-004: One Mouth Rule and atomic presenter floor

**Status:** Accepted  
**Date:** 2026-07-14

## Context

Multi-agent reasoning can accidentally produce overlapping voices, especially during handoff and retries.

## Decision

Exactly one active_presenter_id owns the floor. Specialists can only return typed suggestions. Floor transfer is an optimistic, atomic state transition with timeline evidence. Late media from the prior presenter is discarded by generation token.

## Alternatives considered

Allow multiple speaking agents; coordinate only by prompts.

## Consequences

Mechanical prevention of double speech at the cost of a formal handoff protocol.

## Revisit trigger

Never. This is constitutional unless a future product explicitly implements moderated multi-speaker sessions under a separate session type.
