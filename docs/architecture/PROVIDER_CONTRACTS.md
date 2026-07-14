# Provider Contracts

## Common requirements

Every adapter implements:
- `health()`;
- `capabilities()`;
- `estimate_cost()`;
- timeouts and cancellation;
- trace propagation only across trusted internal adapter boundaries;
- redacted error mapping;
- close/cleanup;
- fake implementation.

## Failure taxonomy
- invalid_configuration;
- authentication;
- rate_limited;
- capacity;
- timeout;
- transient_network;
- provider_internal;
- unsupported_capability;
- policy_blocked;
- budget_blocked;
- cancelled;
- unknown.

## Circuit breakers

Breakers are per provider, region and capability, not global. Half-open probes never use a production write action.

## Capability contract

`provider_capability` is datestamped and runtime-verifiable. Marketing claims are not capability evidence. Staging probes update health, not permanent architecture decisions.

M0 consumes `provider_capability` as canonical dated evidence and `provider_registry_entry` as the runtime-safe binding to one port. A registry entry carries one or more canonical capability records for the same `provider_id` and `port_kind`, plus default timeout, cancellation support, health status, circuit state and explicit fallback IDs. The schema references the canonical capability contract rather than creating a second source of truth.

The catalog is inspection and explicit-resolution only. A caller names the provider and port, may evaluate a closed requirement for capability, region, language, streaming, barge-in, data residency, session duration, latency class and cancellation, then resolves that same provider. It never promotes a candidate, chooses a default, or changes to a fallback automatically. Candidate capability records are executable only as local `fake` entries in M0, never as a production promotion.

Runtime resolution fails closed for a disabled or deprecated matching capability, `unavailable` or `unknown` health, or a circuit that is not `closed`. `get_entry`, `get_capabilities` and `fallback_for` remain inspection helpers. A future health manager owns half-open probes and breaker state by provider, region and capability. M0 only normalizes its static fake configuration.

The registry validates capability declarations at bootstrap and wraps every exposed adapter method. It supplies the entry default timeout through `create_control`, derives one immutable adapter-local deadline budget from the absolute deadline, derives an adapter abort signal from caller cancellation and deadline expiry, normalizes health, cost estimates and result shapes, and discards late results. Raw adapter instances are bootstrap inputs only, not runtime dependencies.

## Deterministic M0 fakes

`@axtro/provider-fakes` creates a local bundle of the nine fake-only ports, immutable registry entries, a non-PII journal and a replay descriptor. `fake_provider_scenario`, `fake_provider_journal_entry` and `fake_provider_replay_descriptor` are generated version 2.0.0 contracts for these public fixture boundaries. The composition root passes its `entries` and bootstrap-only `ports` explicitly to the registry. The bundle cannot choose a default, route a fallback, load credentials or instantiate a real provider.

The scenario is closed and serializable: it requires a bounded non-secret seed and accepts only a known port operation, optional invocation number, bounded delay, bounded partial-marker count, a closed failure code and a closed failure phase. URLs, headers, callbacks, tenant, session, correlation and tool-execution configuration are rejected. The seed derives opaque output references deterministically, but references, inputs, outputs, tenant scope and trace context never enter the journal.

An optional package-owned manual clock drives fixture time without an ambient clock or random source. It schedules the immutable adapter-local deadline budget, so a shorter explicit deadline is reproduced without wall-clock waits. In normal local execution, a signal-aware timer still enforces the absolute deadline. Partial responses are only journal markers with monotonic sequence and simulated time. They do not represent transcript chunks, audio, media publication, generation fencing or barge-in behavior, all of which remain M2 responsibilities.

Every pending fake wait observes the registry-derived abort signal. Cancellation and timeout terminate the journal once and fence all later partials, results and storage writes. A raw bootstrap call whose absolute deadline has already elapsed is rejected before it emits a journal marker or invokes fake work. The normalized cancellation reason is closed and internal. Storage continues to receive only the sealed scope and reference from M0-11, returns the same validated write reference, and keeps no shared object map. The fake ToolPort fails with `action_runtime_required` before any fake action runs.

Provider wire requests never receive tenant, session, correlation, secret handle, header or arbitrary metadata. A strict `traceparent` may cross only a trusted internal adapter boundary, never becoming a default external provider header. Credential binding remains server-side in the secret broker and is intentionally outside these ports.

Storage uses a process-local sealed scope and reference capability. The authenticated application boundary maps a tenant-owned object key to that opaque reference and retains the mapping. The provider contract never receives the raw key or tenant ID. Registry validation rejects a reference from another scope before an adapter runs. The scope and reference have no enumerable tenant or object-key value.

The ToolPort is declared but disabled until M0-14. There is no public factory for an authorization artifact, and M0-11 and M0-12 never invoke a tool adapter. M0-14 must own the complete `ActionIntent` to `PolicyDecision` to idempotent execution to `ToolExecutionReceipt` funnel. A syntactically valid intent or allow decision is never authority.

## Session duration and renewal

`max_session_minutes` is a runtime constraint, not the duration of the business interaction. Adapters with finite sessions must emit pre-expiry health events. The Session Runtime owns renewal, provider-session epochs and fallback. A provider adapter cannot reset domain state or replay tools during reconnection.

## Cost metering

Every adapter reports the billing quantity and unit it can observe. `ProviderCostUnit` is exactly the generated `CostEvent.unit_type` union, including `megabyte`, `seat` and `flat`; no implicit byte conversion is allowed. M0-16 will define any byte or storage-duration conversion before ledger persistence. The Cost Ledger may combine provider-reported usage with a datestamped rate card. Estimated and invoiced costs remain distinct until reconciliation.
