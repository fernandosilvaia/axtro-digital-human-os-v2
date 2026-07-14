# ADR-007: Deterministic behavior and scene directors

**Status:** Accepted  
**Date:** 2026-07-14

## Context

Letting an LLM directly drive gestures, browser navigation and screen content is unpredictable and unsafe.

## Decision

The LLM emits high-level intent. Behavior Director emits bounded presence directives. Scene Director renders allowlisted manifests with receipt-backed bindings. Arbitrary browser control is outside M0-M3.

## Alternatives considered

Direct provider commands from the LLM; static avatar with no direction.

## Consequences

More deterministic components, but repeatability, safety and provider portability improve.

## Revisit trigger

A provider offers an equivalent declarative contract and passes all existing safety and replay tests.
