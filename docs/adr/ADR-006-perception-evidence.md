# ADR-006: Evidence-based multimodal perception

**Status:** Accepted  
**Date:** 2026-07-14

## Context

Visual and behavioral signals can improve turn coordination and accessibility, but unsupported emotion or intent claims create ethical, legal and product risk.

## Decision

Represent observations as expiring perception_signal records with provenance, confidence, consent scope and allowed use. Derived hypotheses remain uncertain and cannot become protected-attribute, lie or diagnosis claims.

## Alternatives considered

Hidden emotion score; no perception at all.

## Consequences

Useful bounded signals with additional consent, policy and evaluation complexity.

## Revisit trigger

A jurisdiction, sector or customer policy disables a modality or purpose. Essential turn signals continue only where lawful.
