# ADR-012: Provider adapters and evidence-based bake-off

**Status:** Accepted  
**Date:** 2026-07-14

## Context

Realtime, voice, avatar and meeting APIs change quickly and differ by language, latency, privacy and cost.

## Decision

Normalize capabilities and use deterministic fakes. No candidate becomes production default before the M2 protocol measures quality, latency, interruption, failure, privacy and cost. Preview capabilities require fallback.

## Alternatives considered

Commit to one vendor in architecture; build every model internally.

## Consequences

Higher initial adapter cost, lower lock-in and more honest provider decisions.

## Revisit trigger

A provider may become preferred after repeated evidence but never bypasses the port.
