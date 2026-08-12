# ADR-016: Purpose-bound retention and verifiable deletion

**Status:** Accepted  
**Date:** 2026-07-14

## Context

The platform stores session state, recordings, transcripts, perception evidence, action receipts, knowledge artifacts, audit records and provider identifiers. A single global retention period is not sufficient because purpose, jurisdiction, tenant policy and legal hold can differ.

## Decision

Retention is policy-driven by data class, purpose, tenant, region and legal hold. Tenant-owned data uses the deletion graph in `database/deletion-graph.md`; deletion workflows are durable, idempotent and produce immutable evidence without retaining deleted content. Recordings and optional perception data default to the shortest configured period. Audit and financial receipts retain only the minimum fields required for accountability.

Production deletion must cover primary storage, object storage, caches, search indexes, vector stores, provider copies and backups according to documented recovery windows. A tenant cannot silently extend end-user consent by changing retention after collection.

## Alternatives considered

One retention period for all data; indefinite retention for model improvement; best-effort manual deletion.

## Consequences

More policy and workflow complexity, but predictable privacy behavior, enterprise configurability and auditable deletion.

## Revisit trigger

A jurisdiction, regulated vertical, provider contract or backup architecture requires a stricter retention or deletion model.

## Implementation notes (added 2026-08-12, D-V2-114)

- The "documented recovery windows" this ADR references did not exist as a
  concrete artifact until `docs/operations/DISASTER_RECOVERY.md` (P1 finding,
  audit wave 5) — that document is now the recovery-window reference for the
  hosted Supabase project. PITR status and a real restore test are still
  pending confirmation, tracked there.
- `conversation_transcripts` (migration 0029, shipped after this ADR) had no
  deletion or retention/purge mechanism at all until migration `0034`
  (`portal_delete_conversation_transcript`, `portal_delete_conversation_transcript_service`,
  `portal_purge_old_conversation_transcripts_service`) — written but not yet
  applied to production pending Fernando's authorization. The purge RPC is
  parameterized (no default retention period baked in): the actual retention
  window this ADR calls for ("shortest configured period") is still a
  pending product/legal decision, not something invented unilaterally here.
