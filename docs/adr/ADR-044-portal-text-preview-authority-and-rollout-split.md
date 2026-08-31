# ADR-044: Portal text preview authority and rollout split

**Status:** Accepted for M6-02
**Date:** 2026-08-31
**Related:** Constitution Arts. 3, 4, 5, 7, 9, 10, 15 and 16; ADR-028, ADR-033, ADR-036, ADR-042

## Context

M6-00 recovered the immutable text-preview database producer and its canonical
event contract while hard-closing the legacy Portal path. The remaining
historical application bundle contains useful contract-first orchestration,
but it also assumes a single environment flag is enough to permit provider
egress and lets a global service credential choose the user represented by an
admission request.

The adversarial architecture, security, data, test and cost reviews found that
the database still lacks the production event relay, cleanup scheduling,
operator resolution of ambiguous provider effects, tenant-fair budgets and a
rollout gate backed by live operational evidence. The shared public demo also
cannot be allowed to consume paid preview capacity. Restoring the historical
bundle wholesale would therefore turn code recovery into an unsafe product
activation.

Migration `0049_portal_text_preview_admission.sql` is immutable by checksum.
Any authority or integrity repair must be forward-only.

## Decision

M6-02 restores a locally executable, contract-first preview core while keeping
the customer-facing path unavailable.

1. Five normative contracts land together: admission, browser command, signed
   state payload, browser-safe action result and provider processing profile.
   Generated TypeScript and Python types are the only application contract
   source.
2. Browser input never carries tenant, user, actor, admission, transcript or
   conversation history authority. The browser state is HMAC signed, bounded
   and expiring, but remains continuity evidence rather than database
   authority.
3. Admission authority is repaired in a migration after 0049. The recovered
   boundary derives caller identity from `auth.uid()` and the global service
   role can no longer select an arbitrary user for the historical admission
   function. During M6-02 the recovered boundary remains owner-only, including
   for authenticated clients. M6-06 may expose a narrower guarded boundary only
   after code-owned disclosure evidence and every compound rollout gate exist.
   Downstream workers may act only on an immutable admission already bound to
   that user and tenant.
4. The database, not only the browser token, enforces at most ten exchanges.
   Transcript references are tenant-composite foreign keys.
5. The OpenRouter processing profile is code-owned, versioned and
   fingerprinted. Preview requests require no provider data collection, ZDR,
   no routing fallback and strict parameter support. M6-02 provides a local
   fail-closed attestation and per-attempt revalidation boundary. M6-06 must
   replace that evidence with a current deployment-bound proof before any real
   provider attempt.
6. Transcript persistence remains a separate explicit opt-in and stays closed
   until the M6-04 retention, deletion, redaction and legal-hold work is green.
7. The public Server Action returns a deterministic unavailable result before
   authentication, database access, ledger access or provider access. The UI
   exposes no submit control. `PORTAL_TEXT_PREVIEW_ENABLED=true` remains an
   invalid production configuration during M6-02.

M6-06 owns production activation. It must deliver the durable PostgreSQL
outbox relay, bounded and observable cleanup, append-only ambiguity
reconciliation, cancellation and late-output fencing, provider privacy proof,
tenant-fair cost controls, allowlisted canary rollout and compound readiness.
The feature cannot open until every one of those gates is green.

## Provider request boundary

The strict provider routing object for this preview is at minimum:

```json
{
  "data_collection": "deny",
  "zdr": true,
  "allow_fallbacks": false,
  "require_parameters": true
}
```

The immutable 0049 admission field keeps the historical fingerprint
`sha256:70e60ec32d8a29d0f6264a0545e2ea1d215d02fe164d90dadaa63e99e59472de`.
That value identifies only the original minimum privacy subset
`data_collection=deny` and `zdr=true`; it is not proof of the complete request
object above. The privacy attestation carries a separate exact fingerprint for
all four routing fields. Replacing the admission fingerprint requires a new
profile identity and version in a later forward-only migration, never a silent
reinterpretation of profile v1.

Price ceilings and the selected model must come from an approved rate card and
capacity decision. M6-02 must not invent them or make a real provider call.

The OpenRouter adapter now declares `@axtro/contracts-ts` as an internal
production dependency at `workspace:*` so its processing-profile type is
generated from the normative schema. The version follows the repository
workspace release. The rejected alternative was a hand-maintained duplicate
type inside the adapter, which would permit schema drift without a generation
gate. No external package or provider SDK was added.

## Consequences

The runtime can be verified locally with deterministic fakes and real
PostgreSQL contracts without reopening the unsafe legacy route. The new SQL
constraints narrow authority without rewriting historical lineage. Customers
still see an explicit recovery state, and no remote migration, deployment,
secret, schedule, flag, purchase or paid effect is implied.

This split makes M6-02 smaller than the final production feature. That is
intentional: local code completeness and operational authorization are
different states.

## Alternatives considered

1. Restore the historical Server Action and release gate unchanged. Rejected
   because one environment value cannot prove relay, cleanup, privacy, cost or
   canary health.
2. Keep service-role admission with a free user parameter. Rejected because a
   global credential could fabricate the legal and tenant identity represented
   by an admission.
3. Implement relay and cleanup inside the Server Action. Rejected because
   durable asynchronous effects need independent leases, retries, receipts,
   heartbeats and operator visibility.
4. Enable transcripts with the essential preview. Rejected because content
   retention and deletion authority are not yet complete.

## Revisit trigger

Revisit only after M6-03, M6-04 and M6-06 are complete and the staged rollout
has explicit operator authorization.
