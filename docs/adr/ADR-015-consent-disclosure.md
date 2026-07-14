# ADR-015: Purpose-specific consent and persistent AI disclosure

**Status:** Accepted  
**Date:** 2026-07-14

## Context

Essential live processing, recording, behavioral analysis, biometrics and training are different purposes. Prompt-only disclosure is not auditable.

## Decision

Deliver and persist AI identity disclosure. Record consent separately per purpose and jurisdiction. Missing optional consent disables that processing without necessarily blocking essential conversation.

## Alternatives considered

One global consent flag; silent processing.

## Consequences

More state and policy evaluation, but clearer user control and evidence.

## Revisit trigger

Regional policy can require stricter behavior or block the entire session.
