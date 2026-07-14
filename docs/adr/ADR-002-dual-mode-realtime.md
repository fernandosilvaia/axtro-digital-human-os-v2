# ADR-002: Dual-mode realtime conversation path

**Status:** Accepted  
**Date:** 2026-07-14

## Context

Speech-to-speech reduces latency and modular STT to LLM to TTS offers control, observability and provider flexibility. No single mode wins every language, sector and channel.

## Decision

Support both modes behind the same RealtimeModelPort and session state. Modular mode is the deterministic baseline. S2S is feature-flagged and may not bypass server-side tools, policy, disclosure or receipts.

## Alternatives considered

S2S only; modular pipeline only.

## Consequences

More adapter and test work, but provider and quality choices remain reversible.

## Revisit trigger

One path consistently meets quality, cost, safety and availability targets across all supported use cases for two release cycles.
