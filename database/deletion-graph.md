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
