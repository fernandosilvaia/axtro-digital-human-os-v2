# ADR-017: OpenTelemetry correlation across technical, human and commercial telemetry

**Status:** Accepted  
**Date:** 2026-07-14

## Context

Realtime quality cannot be diagnosed from a single latency number. The system also needs tenant-safe cost, action, workflow and commercial evidence without logging secrets or unnecessary PII.

## Decision

Use OpenTelemetry-compatible traces, metrics and structured logs with `tenant_id`, `session_id`, `trace_id`, `correlation_id`, `causation_id`, provider, model version and capability mode where permitted. Measure each media stage separately and record connected-minute and spoken-minute cost events. Sensitive payloads are redacted or represented only by approved local references.

Telemetry schemas are versioned. Sampling may reduce volume but must retain all security events, destructive actions, policy denials, handoffs, provider failures and cost anomalies. Provider-native telemetry is correlated through adapters rather than treated as the source of truth.

## M0 implementation profile

M0 implements a small OpenTelemetry-compatible core without an SDK, exporter, automatic HTTP or database instrumentation. It emits versioned spans and structured records through injected local sinks, leaving backend selection reversible.

The public API always mints a new W3C trace root and UUIDv7 correlation ID after authentication. Its root span starts with no session ID. A strict `traceparent` carrier is accepted only on authenticated internal boundaries such as a validated event delivered to the realtime worker. The carrier contains only `traceparent`, never tenant, session, correlation ID, baggage or tracestate. Tenant and session continue in typed authorized context or validated event data, with the session added only after lookup and RLS authorization. A provider callback receives only the narrow carrier, while its trusted adapter wrapper keeps correlation locally.

The structured logger accepts only code-owned closed operational values. A provider request reference is minted locally from the provider span ID, and neither raw provider request IDs nor provider-supplied references are accepted. It never accepts payloads, prompts, transcripts, media, headers, cookies, SQL, free-text messages, actor identifiers, exception stacks or raw errors. Restricted data records only its classification and that the payload was omitted.

## Alternatives considered

Provider dashboards only; unstructured application logs; full raw payload logging.

## Consequences

Higher implementation discipline and storage cost, but reproducible latency, reliability, security and unit-economic analysis.

## Revisit trigger

The selected observability backend cannot support required correlation, regional storage, retention or cost.
