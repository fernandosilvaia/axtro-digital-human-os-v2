# Provider-effect reconciliation

## Purpose and invariant

This worker reconciles paid Tavus and Recall effects whose request-path result
is not safely terminal. It never treats elapsed time as proof that an external
effect does not exist. A reconciliation lease only assigns bounded worker
ownership; lease expiry never releases capacity, changes the provider-effect
state or authorizes another spend.

The automatic path handles only `cleanup_pending` rows with a known provider
reference. It calls Tavus `endConversation` or Recall `leaveCall`, then persists
one stable `compensation_confirmed` reconciliation receipt. A
`provider_in_flight` or `unknown` row, and any row without a provider reference,
remains a financial barrier and is surfaced for operator evidence.

## Configuration and activation

Required in the portal environment:

- `PROVIDER_EFFECT_RECONCILER_ENABLED=true`;
- `PROVIDER_EFFECT_RECONCILE_SECRET`, a random value of at least 24 characters;
- working `TAVUS_API_KEY`, `RECALL_API_KEY` and `RECALL_API_REGION`;
- Supabase service-role configuration required by the portal.

Required in GitHub Actions:

- repository variable `PROVIDER_EFFECT_RECONCILE_URL`, exactly
  `https://<portal>/api/internal/provider-effects/reconcile`;
- secret `PROVIDER_EFFECT_RECONCILE_SECRET`, identical to the portal value.

Keep `PROVIDER_EFFECT_RECONCILER_ENABLED` false until migrations 0040 and 0041
and the provider-effect reconciliation capability probe are present. First run
the workflow manually, inspect its JSON counters and logs, then enable the
five-minute schedule. The endpoint is `POST`-only, bearer protected, no-store
and fails closed when disabled or misconfigured.

## Processing contract

Each run leases at most 20 rows for 60 seconds. Database selection is ordered,
uses `SKIP LOCKED`, has a hard maximum of 100 and returns only reservation,
provider, provider reference, state, timestamps, attempt count and lease token.
It never returns tenant, user or actor payload to the scheduler.

Provider calls have a 25-second application deadline in addition to adapter
timeouts. Failures use bounded exponential backoff. Eight unsuccessful
attempts move the work item to the reconciliation dead letter, without changing
the underlying `provider_in_flight`, `unknown` or `cleanup_pending` barrier.
Rows are isolated: one provider or receipt persistence failure does not prevent
the worker from attempting the remaining leased rows. An unpersisted failure
receipt still makes the batch return 503 so the scheduler and telemetry observe
the fault.

The response and structured event expose only bounded aggregate counters:
`leased`, `reconciled`, `failed`, `deadLettered`, `operatorRequired`, backlog by
state and oldest ages. No tenant ID, user ID, provider reference, secret or
request payload is logged.

## Manual evidence path is closed

`POST /api/internal/provider-effects/manual` intentionally returns 404 and
does not read the request body. The unattended scheduler bearer is only an
execution capability for automatic cleanup; it cannot authorize an operator
to release an ambiguous paid effect.

No HTTP manual-release surface may be enabled until the contract persists an
authenticated operator identity, an independent approval/challenge, a bounded
provider-evidence digest and an append-only audit receipt. Until then,
`provider_in_flight` and `unknown` rows remain financial barriers. Operations
may inspect them through restricted database/provider consoles, but must not
mutate them through an ad-hoc service-role call or release them merely because
time passed.

## Alerts and incident response

Alert when any of these is non-zero or increasing:

- `deadLetterBacklog`;
- `operatorRequired`;
- `unknown` or `providerInFlight` older than the normal provider response
  window;
- `cleanupPending` or `oldestAgeSeconds` increasing across runs;
- workflow HTTP status other than 200;
- structured events `provider_effect_*_persistence_failed` or
  `provider_effect_reconciliation_failed`.

For a stuck row, disable only new affected paid entry points if spend could
continue; do not delete reservations, receipts or cost events. Check provider
status, database RPC availability and service-role grants. Retry the scheduler
with the same durable row. Escalate unknown rows rather than releasing them
under pressure; there is no manual HTTP exception path.

## Rollback

Set `PROVIDER_EFFECT_RECONCILER_ENABLED=false` and disable the GitHub schedule.
This stops worker dispatch but deliberately leaves every financial barrier and
receipt intact. Do not roll back to an application that can create a paid
effect without the reservation contract described by ADR-036.
