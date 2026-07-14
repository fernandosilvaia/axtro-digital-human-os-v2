# ADR-012: Provider adapters and evidence-based bake-off

**Status:** Accepted  
**Date:** 2026-07-14

## Context

Realtime, voice, avatar and meeting APIs change quickly and differ by language, latency, privacy and cost.

## Decision

Normalize capabilities and use deterministic fakes. No candidate becomes production default before the M2 protocol measures quality, latency, interruption, failure, privacy and cost. Preview capabilities require fallback.

## M0 implementation profile

M0 defines provider-neutral ports for channel, realtime model, STT, TTS, avatar, meeting, telephony, governed tools and storage. Every exposed adapter method receives one normalized timeout and a derived cancellation signal, reports a redacted normalized health record and declares dated capability records through the registry. The registry is in-memory and code-owned in M0, accepts no provider SDK or network client, accepts only `fake` runtime entries and never chooses a production default. Provider credentials, tenant identity, session identity, correlation and external headers are outside the port wire contract.

`provider_registry_entry` is a separate version 2.0.0 schema that binds a closed port kind to one or more canonical `provider_capability` records and adds normalized timeout, cancellation, health, circuit and fallback fields. A caller must name the provider explicitly. It can evaluate a closed capability requirement but cannot receive automatic routing, fallback or promotion. Runtime resolution fails closed for disabled or deprecated capability evidence, unavailable or unknown health, and a circuit that is not closed. `provider_capability` remains the sole evidence schema and accepts the channel, tool and storage categories required by the catalog. No persisted capability registry or public endpoint exists yet, so no live data migration or compatibility adapter is needed.

Storage references are sealed process-local capabilities scoped before the adapter boundary. The authenticated application maps tenant-owned object keys to those references and the registry rejects a different scope before invoking an adapter. Raw keys and tenant IDs never cross the provider contract. Tool execution is intentionally disabled in M0-11: no public factory can mint authorization from structurally valid payloads, and M0-14 alone will implement policy, approval, idempotency and receipt validation.

M0-12 implements the local deterministic fake bundle. Its scenario, journal entry and replay descriptor are generated strict contracts. It is driven by a bounded seed and optionally a package-owned manual clock. Delay, normalized timeout, bounded journal-only partial markers and closed injected failures can be reproduced per port operation and invocation. The provider contract derives one immutable adapter-local deadline budget from the absolute deadline at invocation time. Real adapters retain the absolute deadline guard, while the fake obtains only that budget through the provider contract and applies it with its manual scheduler, never reading an ambient clock. An already expired raw bootstrap control fails before journal or output. The journal holds only a closed operation enum, port kind, sequence, phase, simulated time and closed failure code. It holds no reference, input, output, tenant, session, trace or seed. A derived abort signal stops the fake wait and fences late output. The fake storage adapter remains stateless and preserves only the sealed reference passed by the registry. The fake ToolPort has no scenario operation and fails closed before any action adapter call.

## Alternatives considered

Commit to one vendor in architecture; build every model internally.

## Consequences

Higher initial adapter cost, lower lock-in and more honest provider decisions. M0 capability and health metadata are normalized local fake configuration, not a replacement for the region and capability breaker manager required later.

## Revisit trigger

A provider may become preferred after repeated evidence but never bypasses the port.
