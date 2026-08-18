# Deletion and Retention Graph

## Tenant closure

`tenants -> tenant configuration -> contacts/sessions/knowledge/workflows/governance`

Deletion is a workflow, not a single unrestricted SQL statement.

1. Mark tenant `closing` and disable new sessions.
2. Revoke provider connections and service identities.
3. Export data when contractually required.
4. Delete or tombstone PII according to the active retention policy.
5. Delete recordings and object storage by inventory.
6. Cascade operational rows only after legal holds are checked.
7. Preserve permitted integrity metadata without content.
8. Produce a deletion receipt and independent verification.

## Contact deletion

Contact PII can be cryptographically erased while session integrity metadata remains. Free-text transcripts must pass redaction or deletion policy and cannot be assumed anonymous.

## Knowledge deletion

Deleting a source cascades versions, chunks and embeddings. Caches and indexes receive explicit invalidation events.

## Evidence under legal hold

Legal hold is purpose-specific and time-bounded. It blocks deletion only for the referenced artifacts, not the entire tenant by default.

## Post-call workflow evidence

Post-call commands, checkpoint receipts, deterministic results and their timeline evidence are append-only and tenant-scoped. A result can contain restricted structural summary data, so retention or erasure must follow the session purpose and legal-hold policy. The relational evidence link must not be detached or reassigned to another tenant or session. M1 does not create external follow-up content or provider-side data to delete.

## Financial and provider-effect evidence

Provider-effect reservations, cost events, billing outbox rows, provider/AI
reconciliation receipts, Stripe Checkout intents and webhook delivery digests are financial integrity
evidence. Tenant closure first disables new effects and drains or manually
reconciles every in-flight/unknown/cleanup row. Rows required by invoice,
chargeback, tax or legal-hold policy are retained tenant-scoped for the
applicable period; credentials, transcript content and meeting URLs are never
copied into this evidence. After retention expires, deletion is performed by
the closure workflow in foreign-key order and produces a deletion receipt.
An open Checkout intent must first reach signed `expired`, `completed` or a
reconciled terminal state; closure never deletes an ambiguous dispatched
intent merely because its local expiry elapsed.

Provider-effect termination receipts are separate, append-only operational evidence.
They retain only tenant-scoped actor identity, bounded status/error code and an
opaque provider receipt digest; never a provider reference, meeting URL or media.
Tenant closure waits for any live termination lease to settle or reaches its
documented operator-required state before its retention workflow may purge it.

Tavus stage capabilities are operational secrets, not financial evidence.
They store only the token hash plus a private room URL, expire within 45
minutes, are revoked when the provider effect terminates, and must be purged
before tenant closure completes. Worker heartbeats contain only versioned,
low-cardinality counters and may be replaced or purged after the operational
audit window; they must never carry tenant IDs, provider references or PII.

## Runtime bridge evidence

Runtime-channel bindings, provider-channel receipts, scene receipts and
kill-switch events are tenant-scoped operational integrity evidence. Retain
only for the applicable audit, billing-dispute or legal-hold period; never
copy provider credentials, transcript content or meeting URLs into a deletion
receipt. Closure first blocks new runtime admissions and provider dispatch,
then reconciles or preserves any `unknown`/`cleanup_pending` reservation. A
provider receipt is inseparable from its reservation's exact provider reference
and URL, while kill-switch event retention follows the same tenant as the
switch; neither relationship may be reassigned during erasure.
