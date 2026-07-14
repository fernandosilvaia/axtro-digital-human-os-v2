# ADR-008: Axtro Agent outside the critical media path

**Status:** Accepted  
**Date:** 2026-07-14

## Context

The Hermes-derived Axtro Agent is valuable for preparation, supervision and follow-up, but agentic planning can be slow or unavailable.

## Decision

Integrate the Axtro Agent through versioned briefs, suggestions, workflow commands and events. The live kernel continues from local state and policy if the daemon is offline.

## Alternatives considered

Route every turn through the daemon; exclude the daemon entirely.

## Consequences

Preserves autonomy without sacrificing conversational latency or availability.

## Revisit trigger

Never place it as a synchronous hard dependency. Additional low-latency advisory channels may be benchmarked.
