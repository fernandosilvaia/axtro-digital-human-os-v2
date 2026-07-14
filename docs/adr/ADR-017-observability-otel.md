# ADR-017: OpenTelemetry correlation across technical, human and commercial telemetry

**Status:** Accepted  
**Date:** 2026-07-14

## Context

Realtime quality cannot be diagnosed from a single latency number. The system also needs tenant-safe cost, action, workflow and commercial evidence without logging secrets or unnecessary PII.

## Decision

Use OpenTelemetry-compatible traces, metrics and structured logs with `tenant_id`, `session_id`, `trace_id`, `correlation_id`, `causation_id`, provider, model version and capability mode where permitted. Measure each media stage separately and record connected-minute and spoken-minute cost events. Sensitive payloads are redacted or represented by approved hashes and references.

Telemetry schemas are versioned. Sampling may reduce volume but must retain all security events, destructive actions, policy denials, handoffs, provider failures and cost anomalies. Provider-native telemetry is correlated through adapters rather than treated as the source of truth.

## Alternatives considered

Provider dashboards only; unstructured application logs; full raw payload logging.

## Consequences

Higher implementation discipline and storage cost, but reproducible latency, reliability, security and unit-economic analysis.

## Revisit trigger

The selected observability backend cannot support required correlation, regional storage, retention or cost.
