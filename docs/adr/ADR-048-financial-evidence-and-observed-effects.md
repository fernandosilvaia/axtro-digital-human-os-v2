# ADR-048: Financial evidence and observed external effects

**Status:** Accepted for local corrective audit AUD-05
**Date:** 2026-10-01
**Related:** ADR-033, ADR-034, ADR-036, ADR-038, ADR-046, ADR-047

## Context

Zero-token OpenRouter responses with a reported cost can bypass token quotas.
A hidden 429 retry creates two physical attempts under one reservation.
Billing void failure prevents stopping a known Tavus/Recall resource. The
0067 timeout sweep fabricates an immutable provider-reported receipt from
elapsed time and makes later invoice reconciliation conflict with that receipt.
The dormant scene helper records succeeded after selecting a directive,
without a controlled renderer or acknowledgement of the effect.

## Decision

Keep existing public payloads and service-only RPC signatures. Normalize an
all-zero token tuple to the reserved input/output envelope irrespective of
reported cost; preserve the provider cost at the existing numeric(20,8) precision in the
reservation and normalize
the same caller tuple before initial commit and idempotent replay.
Recognize an exact already committed caller tuple before normalization, so
legacy zero-token commits can replay without rewriting history or adding a
new ledger event. New zero-token commits use the reserved envelope.
Validate the original monetary input against reservation bounds before rounding
to the existing eight decimal places. Commit and real-invoice reconciliation
compare the same canonical monetary value on replay, so a nine-decimal provider
cost cannot conflict with its own stored receipt. This changes no storage
precision, operator authority or public payload shape.
The envelope is conservative quota accounting, not proof of measured usage.
The existing ledger CHECK derives amount from quantity and its rounded unit
price, so a quantization difference can remain versus the stored reported cost.
A new precision/adjustment model is outside this bounded repair.

Each adapter invocation makes at most one physical OpenRouter POST. Revalidate
before that dispatch, retain the timeout through response consumption and
cancel unread error bodies without awaiting unbounded cancellation; abort the
owned request during final cleanup. No hidden retry, fallback provider or idempotency
assumption may create another paid attempt within the same reservation.

For known-resource compensation, attempt provider termination independently
of billing void. Await both operations and acknowledge the stable receipt
under the same lease only when both succeed. Any failure retains the barrier
and retry state. Provider acceptance remains distinct from physical silence.

Replace the timeout sweeper with a service-only, argument-validating no-op
returning zero. Preserve its signature so the reservation caller remains
compatible. Publish aiUsageTimeoutSettlementEnabled=false while retaining
existing reservation and real-evidence reconciliation capabilities. Time
cannot establish a provider invoice or no-charge conclusion. An ambiguous
reservation blocks new tenant AI usage until real service reconciliation.
The Portal manual route remains unavailable; no new operator authority is
created. Availability can therefore remain blocked indefinitely.

Existing timeout_assumed_max rows remain immutable. They require real invoice
evidence and a future approved append-only adjustment and aggregation path.
Historical zero-token commits also remain unchanged and need a governed
adjustment if invoice evidence establishes missing usage.
This repair prevents new false settlements; it does not reconcile history or
claim that the existing operator product is complete.

Close the scene helper after its existing enablement, grant, status and
generation checks, before consuming the scene grant or writing success.
Selection is not execution. A future renderer needs policy, generation fence
and a receipt after a confirmed effect, as already required by ADR-038.

## Alternatives and consequences

Keep conservative timeout estimates as a distinct nonterminal projection was
considered, but a complete adjustment model changes receipts, aggregation and
operator approval contracts. The bounded reversible default is to stop new
false evidence and document that larger follow-up. Automatically declaring
no charge, ignoring billing failure during ACK, or weakening the unknown
barrier would falsely resolve external state.

No constitutional amendment, permanent provider choice, new production
dependency, remote migration, external cleanup or financial operation occurs
in this local repair. M6-04 and later rollout gates remain unchanged.

## Validation

PostgreSQL proves zero tuples with positive/zero/absent cost, quota admission,
raw replay, cross-tenant rejection, immutable historical estimates and repeated
timeout sweeps with no row/timestamp/receipt/ledger changes. Real invoice and
no-charge fixtures resolve unknown exactly once; unauthorized calls fail.
Injected adapters prove one POST on 429, response-body cleanup and deadlines.
Reconciler replays cover billing false/error/throw and provider failure for
both providers, stable leases and no premature ACK. Scene tests prove no grant
consumption, renderer call or success RPC while preserving stale/kill checks.
