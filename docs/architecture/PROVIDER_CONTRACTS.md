# Provider Contracts

## Common requirements

Every adapter implements:
- `health()`;
- `capabilities()`;
- `estimate_cost()`;
- timeouts and cancellation;
- trace propagation;
- redacted error mapping;
- close/cleanup;
- fake implementation.

## Failure taxonomy
- invalid_configuration;
- authentication;
- rate_limited;
- capacity;
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

## Session duration and renewal

`max_session_minutes` is a runtime constraint, not the duration of the business interaction. Adapters with finite sessions must emit pre-expiry health events. The Session Runtime owns renewal, provider-session epochs and fallback. A provider adapter cannot reset domain state or replay tools during reconnection.

## Cost metering

Every adapter reports the billing quantity and unit it can observe. The Cost Ledger may combine provider-reported usage with a datestamped rate card. Estimated and invoiced costs remain distinct until reconciliation.
