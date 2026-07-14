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
