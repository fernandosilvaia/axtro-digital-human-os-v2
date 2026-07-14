# ADR-021: Deterministic append-only cost ledger

**Status:** Accepted  
**Date:** 2026-07-14

## Context

Provider operations can produce estimated, measured, or provider-reported cost
evidence. The existing `cost_events` table is tenant-scoped and append-only,
but its first migration did not enforce the contractual USD currency, unit
catalogue, provider and service bounds, or the arithmetic relationship between
quantity, unit price, and amount. JavaScript floating-point arithmetic is not
an acceptable source of truth for monetary attribution.

M0 needs deterministic, fake-only cost attribution to tenant, session, provider,
and service. It does not have credentials, provider invoices, or a selected
provider billing API.

## Decision

- `cost_events` remains the authoritative, append-only monetary ledger.
- The costing bounded context computes with scaled integers: quantity at eight
  decimal places, unit price at ten, and USD amount at eight. Non-negative
  products round half-up at the USD amount scale.
- The database repeats the amount equation with a forward-only `NOT VALID`
  constraint, preserving read access to pre-M0 events while enforcing the rule
  for every new write.
- `estimated`, `measured`, and `provider_reported` remain distinct source
  buckets. A later source may link to an estimated event for provenance, but it
  never mutates or overwrites that event.
- New events carry a local rate-card reference and its effective timestamp, a
  server-minted provider request reference, and a trusted trace identifier.
  These fields are optional in the compatible contract revision so historical
  events remain readable, but mandatory at the M0 ledger write boundary.
- Rate cards and provider request references are opaque, in-process
  capabilities. A provider request reference is minted for exactly one rate
  card, tenant, and optional session, and is accepted only once per source in
  that tenant, except for an idempotent replay of the same event ID. The
  authoritative database enforces the same replay boundary with a partial
  unique index on tenant, source, and non-null request reference. The ledger
  does not call provider adapters, use provider SDKs, fetch invoices, or enter
  the realtime critical path.
- The generated JSON contract uses numbers, so the ledger rejects any scaled
  value that would not round-trip through that contract without precision loss.
- The database trigger accepts a reconciliation only when its target is an
  estimated event with the same tenant, session, provider, service, and unit.
- The deterministic M0 repository accepts only an authenticated request context.
  A future SQL writer must execute inside the existing transaction-local tenant
  context before it inserts the same append-only event.
- M0 reconciliation means deterministic comparison and aggregation of ledger
  events. Invoice ingestion and provider billing reconciliation remain a later
  contract-first integration.

## Alternatives considered

- Use JavaScript `number` multiplication and trust a caller-provided total.
- Update an estimated row when a measured value arrives.
- Use `usage_ledger` as the monetary source of truth.
- Fetch provider invoices or choose a billing provider in M0.

## Consequences

Cost totals are reproducible and auditable without real provider access. The
ledger preserves estimate and measurement evidence side by side, while avoiding
double counting by exposing source-specific subtotals. A later invoice adapter
must add its own approved contract and cannot alter historical ledger evidence.
