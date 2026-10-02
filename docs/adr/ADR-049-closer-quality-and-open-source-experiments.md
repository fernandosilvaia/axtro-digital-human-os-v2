# ADR-049: Closer quality and open source experiments

**Status:** Accepted for local IMP-01 through IMP-05
**Date:** 2026-10-01
**Related:** ADR-031, ADR-035, ADR-038, ADR-046, ADR-047, ADR-048

## Context

The owner authorizes implementing the audit roadmap and open source quality improvements.
The kernel already has evaluation and knowledge ports. The in-memory retrieval currently
uses a hash as a vector-like score; Portal has pgvector but no lexical candidate lane.
Substring goldens do not establish that a commercial effect completed. Existing data
governance schemas are present, while canonical SQL ledgers, projectors and external
verification remain incomplete. None of these facts justify changing production gates.

## Decision

Implement five sequential local graph items. IMP-01 introduces receipt-based evidence
projections and bounded synthetic baseline/candidate comparisons, with an offline custom
Promptfoo provider. Standalone lab artifact schemas describe benchmark reports; they are
not new public commands or domain events. Runtime projections read canonical receipts,
never trust model text as proof of completion, and expose no raw receipt result or PII.
Naturalness, real conversation quality and promotion require human and measured evidence.

IMP-02 adds an additive pgvector/lexical hybrid RPC with tenant and source/version filters,
identity-bearing citations and legacy wire compatibility. Historical SQL files remain immutable;
the additive migration hardens callable legacy search and digest bodies with the same source
policy and validity filters, so direct Data API calls cannot bypass them.
The new consumer fails closed when the hybrid RPC is unavailable: the old response has no
identity or policy/validity evidence, so a compatibility label cannot authorize its content.
Ranking may be measured on a synthetic corpus without claiming real-world recall. Query
text remains data; no retrieved instructions enter trusted system context. No second paid
embedding attempt is permitted during compatibility fallback.

IMP-03 adds isolated development-only adapters for LiveKit Agents and whisper.cpp. Explicit
local engines, assets, generation authority, deadlines and bounded queues are mandatory.
Imports cannot infer credentials or download assets. Deterministic fakes share the adapter
shape. No framework becomes a production default before the existing bake-off; SDK ACK is
not physical silence and fake timing is not a real EOT metric. No Axtro Agent or evaluation
lab enters the synchronous audio path.

IMP-05 adds a narrowly typed conversation-turn redaction projector to the existing
M6-04 authority and verification workflow. Only its two transcript content fields may
be cleared; all identity and structural fields remain immutable. It is not a general
append-only bypass and does not establish canonical ledger/outbox readiness.

IMP-04 reconciles the roadmap and evidence. M6-04, M6-05, M6-06 and provider rollout remain
gated until their real acceptance criteria are met. Historical receipts are never rewritten.

## Dependency and alternatives

Reuse existing PostgreSQL/pgvector and typed evaluation ports. Keep pinned Promptfoo and
LiveKit tooling in isolated experiment manifests rather than production dependencies.
whisper.cpp is an opt-in local executable with an explicit model, not a new server service.
Alternatives include the existing deterministic evaluator, existing vector RPC and current
Tavus/Recall adapters. These remain available; experiments do not replace deployment defaults.
Versions, licenses, reasons and official sources are recorded in the improvement report.
The isolated Promptfoo tree overrides basic-ftp to 6.2.1 to close its current parser
advisory; the alternative is retaining a vulnerable development tree. Actual CLI
compatibility and a fresh advisory scan are required before accepting that override.

## Validation

Negative receipt/tenant/claim cases, candidate regressions, bounded input and offline CLI;
real local PostgreSQL ranking, expiry, revocation, RLS and backward compatibility; fake SDK
cancellation and process timeout/failure fixtures; full contracts, lint, build and independent
reviews. Measure actual media and model quality separately when authorized assets exist.

## Development tooling security selection

Promptfoo 0.123.1 was evaluated but rejected: its jks-js path carries an unpatched
node-forge RSA verification advisory. The selected isolated development version is
0.116.7, with the separately justified basic-ftp 6.2.1 override. No advisory suppression
is allowed. Its actual CLI and full current audit must pass before the runner is accepted.
This does not choose or downgrade a production provider; the experiment exports no secrets.
