# ADR-046: Governed data disposition, legal hold and verifiable erasure

**Status:** Accepted for M6-04
**Date:** 2026-08-31
**Related:** Constitution Arts. 3, 5, 7, 9, 10, 15, 16 and 17; ADR-009, ADR-016, ADR-036, ADR-043 and ADR-044

## Context

The current database has 85 tenant-scoped tables plus the `tenants` root. Some
records are append-only, some foreign keys use `RESTRICT`, and several durable
records still contain customer content. The governed data surface also extends
beyond PostgreSQL to object storage, caches, vector or search indexes, provider
copies, Supabase Auth and Vault, and backups or PITR.

The earlier transcript deletion functions are not a complete disposition
boundary. In particular, `portal_purge_old_conversation_transcripts_service`
can delete across every tenant based only on age. It has no request, tenant,
legal-hold, approval, inventory, receipt or external cleanup identity.

Direct tenant deletion is also unsafe. Cascades can collide with append-only
triggers and restrictive edges, while a successful SQL transaction would say
nothing about provider copies, objects, caches or backup recovery windows. A
generic switch that disables immutability would turn a narrow privacy operation
into an unaudited way to rewrite historical evidence.

Data-subject disposition has an additional problem: historical records do not
all carry a stable subject identity. Similar names, e-mail addresses, phone
numbers or text hashes are not sufficient evidence that two records describe
the same person. A system must not claim complete erasure by guessing.

## Decision

### A specialized workflow profile

M6-04 introduces a second workflow profile named
`data_governance_disposition@1.0.0`. It is additive and specialized. It reuses
the existing worker composition, idempotency, fingerprint conflict, lease,
fencing and bounded retry patterns, but does not generalize or refactor the
frozen post-call workflow state machine.

Five Draft 2020-12 contracts, all at `schema_version: 2.0.0`, define the closed
boundary:

- `data_governance_command`;
- `data_governance_status`;
- `data_governance_work_item`;
- `data_governance_receipt`;
- `data_legal_hold`, a discriminated contract for create, release and expire
  commands and receipts.

The disposition request state machine is:

```text
requested -> denied | approval_pending | cancelled
approval_pending -> denied | expired | authorized | cancelled
authorized -> inventorying | cancelled
inventorying -> ready | blocked_by_legal_hold | operator_required | cancelled
blocked_by_legal_hold -> inventorying | expired | cancelled
ready -> executing_redaction | executing_irreversible_deletion | cancelled
executing_redaction -> retry_wait | effect_unknown | verifying | operator_required
executing_irreversible_deletion -> retry_wait | effect_unknown | verifying | operator_required
retry_wait -> executing_redaction | executing_irreversible_deletion
effect_unknown -> retry_wait | verifying | operator_required
verifying -> completed | retry_wait | operator_required
```

`cancelled` is permitted only before the request's first irreversible effect.
After that fence, a request must converge through retry, verification or
operator intervention. Work-item states are exactly `pending`, `held`,
`leased`, `applying`, `retry_wait`, `effect_unknown`, `verification_pending`,
`verified`, `operator_required` and `retained_exception`. A normal item moves
through `pending -> leased -> applying -> verification_pending -> verified`.
An active matching legal hold moves it to `held`; an authorized content-free
retention rule moves it to `retained_exception`. Reconciliation is an operation
performed while resolving `effect_unknown`, not another state. Time does not
turn an unknown external effect into success.

### Scope and subject lineage

The request scope is closed: `tenant` or `data_subject`. Tenant closure covers
the complete catalog. A subject request is valid only for artifacts linked by
an explicit, same-tenant, durable subject lineage. The system never joins or
deletes by a guessed name, e-mail, phone, transcript fragment, embedding or
content hash.

Historical or new PII without proven lineage is an inventory exception. It
moves the request to `operator_required`; it cannot be silently omitted and a
completion receipt cannot be issued. Subject links are tenant-composite and
cannot be detached, reassigned to another tenant or backfilled from heuristic
similarity.

### Machine-readable inventory and drift denial

The normative inventory is machine-readable and versioned. Its initial
database baseline is the 85 tenant-scoped tables listed in
`database/deletion-graph.md`, the `tenants` root, and every declared external
surface. Each catalog item declares scope, disposition strategy, legal-hold
applicability, verification method, dependency order and whether a bounded
content-free retention exception is authorized.

The governance profile also self-registers every new tenant-scoped control
table under the `v59_control` generation. Those control tables are not part of
the 85-table historical baseline, but they remain subject to the same drift
check and declare whether they are an operational locator to erase or a closed,
content-free record to retain.

A two-way anti-join is a release gate:

1. every public table carrying `tenant_id` must appear exactly once in the
   catalog;
2. every cataloged PostgreSQL table must exist and carry `tenant_id`, except
   the explicitly classified `tenants` root;
3. every external port enabled by the deployment must have a catalog entry and
   a verifier.

Catalog drift fails closed before execution and before completion. A new table,
bucket, index, cache namespace or provider copy cannot inherit a deletion rule
implicitly.

### Legal holds are separate, narrow authority

Legal holds are separate durable records with their own append-only receipts.
Each hold has an exact tenant, purpose code, artifact scope, issuing authority,
effective time and bounded expiry. A hold may target a subject, session,
artifact class or exact artifact. It does not cover the whole tenant unless
that exact scope was authorized.

Creation, release and expiry are distinct commands. Release never rewrites the
creation receipt, and expiry is recorded rather than inferred only from wall
clock time. During inventory and every irreversible fence, the worker locks
and rechecks the relevant hold set. A concurrently created matching hold wins;
unrelated work items may continue.

### Authentication, policy and approval

The authenticated admission boundary derives `auth.uid()`, tenant and canonical
actor from current membership inside PostgreSQL. Browser or provider input can
never select the tenant, subject lineage, disposition rule or retained fields.

Admission follows Constitution Art. 7: intent, validation, policy decision,
individual approval where required, idempotent execution, receipt, state
reduction, event and audit. Irreversible tenant closure requires two distinct,
current individual approvals. A tenant with only one eligible administrator
enters `operator_required` until an independent approved authority is
available. Policy can require the same or a stricter quorum for sensitive
subject requests or legal-hold release.

`service_role` is worker transport, not a human approver. The worker may lease
only an already authorized request and derives tenant, scope and target from
the locked request and work item. Direct DML to governance state and terminal
disposition primitives is revoked from application roles, including the
general service role where a narrower worker boundary is available.

### Closing write fence and exact terminal disposition

Inventory is taken while the tenant remains active. Before closing, the
workflow drains or moves to `operator_required` every in-flight provider,
billing, workflow, notification and reconciliation effect. Only then does one
transaction revalidate approvals and holds, transition the tenant to
`closing`, and establish the database write fence.

The write fence blocks new customer, runtime and provider-effect writes across
the catalog. Governance reconciliation and disposition can continue only
through private functions that validate the exact request ID, work-item ID,
tenant, target catalog item and current lease fence inside the same
transaction. No caller-controlled GUC, session flag, role-wide trigger bypass
or generic `prevent_mutation` disable is permitted.

Append-only records are not rewritten through a general exception. Each
content-bearing class receives a narrowly scoped terminal-disposition routine
that either:

- redacts only the cataloged content columns while preserving authorized
  structural accountability fields; or
- irreversibly deletes the exact row after restrictive dependencies and holds
  are resolved.

The routine records the matching content-free receipt atomically. A stale
lease, wrong tenant, uncataloged column, missing receipt or changed generation
fails without mutation.

### Tenant tombstone

Tenant closure retains the original tenant UUID as a content-free scope anchor
for authorized integrity receipts. The `tenants` row is not physically
deleted. Its name, slug and other customer-identifying fields are replaced by
an opaque tombstone and it remains permanently non-admissible for product
traffic. Memberships, credentials, settings and customer content are removed.

The tenant UUID is not reusable or reassigned. Retaining the tombstone is the
documented relational exception that allows content-free receipts to stay
tenant-scoped without preserving customer identity or content.

### External apply, reconcile and verify

External cleanup uses a dedicated port with `apply`, `reconcile` and `verify`
operations. Every operation has a stable idempotency identity, timeout,
cancellation and a closed outcome: `succeeded`, `retryable`, `unknown` or
`denied`. The same work item is replayed after a crash; a fresh item must not be
fabricated for the same target.

Objects are deleted by server-owned tenant namespace, not caller-supplied URL.
Cache, search and vector namespaces are invalidated and then independently
queried for absence. Provider copies are removed or reconciled through the
provider adapter. Vault and Auth cleanup use exact server-derived identities.
Receipts never store an object key, URL, provider reference, credential name or
provider error body.

Backups and PITR are not falsely described as synchronously deleted. The
receipt carries `recoverable_until` derived from the verified operational
recovery window. Primary and external active surfaces can be verified before
that time, but the product must disclose the bounded backup exception and must
not claim that recovery is impossible until the window has elapsed and a later
verification receipt is present. Restore procedures replay disposition
tombstones before read traffic is admitted.

### Content-free receipts

The retained completion evidence is a closed schema. It may contain request,
tenant, policy, catalog and receipt identifiers; scope and terminal status;
schema, policy and inventory versions or fingerprints; bounded per-class
counts; normalized result codes; approval and fence evidence; timestamps; and
`recoverable_until`.

It must not contain a subject reference, name, e-mail, phone, transcript,
summary, prompt, knowledge text, meeting URL, object key, provider reference,
free-form JSON, raw error, content-derived embedding or content digest. Receipt
updates and deletes are rejected. Detailed work locators are operational and
must themselves be disposed after verification according to the catalog.

### Bounded capacity, cost and fairness

Inventory, apply, reconcile and verification run in bounded batches with
statement timeouts, lease expiry before external dispatch, capped attempts,
jittered retry and tenant-fair selection. Per-tenant and global limits bound
queued items, object listings, provider calls and retained operational rows.
Large tenants cannot starve subject requests from another tenant, and one
malformed graph cannot create unbounded retries or provider spend.

Metrics expose only low-cardinality counts and ages. They must not carry tenant
content or subject identity. Estimated external-delete cost and capacity are
checked before authorization; exhaustion yields a closed status, not partial
unreported deletion. The profile runs in the existing workflow worker
composition and does not create a new microservice.

### Closure sequence

The mandatory tenant sequence is:

1. admit the authenticated request and freeze its policy and catalog versions;
2. build the complete catalog inventory and fail on missing lineage or drift;
3. settle provider, billing, notification, workflow and reconciliation work;
4. recheck narrow legal holds and obtain the required approvals;
5. complete any contractually authorized export;
6. atomically enter `closing` and activate the catalog write fence;
7. revoke product sessions, service identities and provider admissions;
8. apply and reconcile external cleanup in bounded work items;
9. perform exact PostgreSQL redaction or deletion in dependency order;
10. independently verify every database and external catalog item;
11. replace the tenant root with its opaque tombstone and emit the content-free
    completion receipt;
12. keep the backup exception visible until `recoverable_until`, then append
    the final recovery-window verification.

The subject sequence uses the same inventory, hold, work-item and verification
rules without placing the whole tenant in `closing`. Its write fence is the
exact linked subject/artifact generation, so concurrent new lineage cannot
escape the request inventory.

The global transcript purge and all point-delete paths must be revoked or
wrapped by this request boundary. Age alone is never deletion authority.

### Expand-contract and rollback

The database change after v58 is forward-only and additive. It adds the
catalog, governance state, holds, fences, receipts and capability proof before
any legacy path is narrowed. Application activation requires the complete
capability and catalog anti-join to pass. No remote migration, schedule or
customer disposition is authorized by this ADR.

Before the first irreversible effect, rollback may disable admission and run
the prior application against the additive schema. After the first redaction,
external delete or tombstone, rollback is forward-only: stop new leases,
preserve receipts and repair with a compatible worker. Deleted content is
never reconstructed and an old binary must never reopen the legacy purge or
bypass the closing fence.

## Alternatives considered

1. Cascade-delete the tenant in one SQL transaction. Rejected because it cannot
   cover external surfaces, legal holds, restrictive edges or verification.
2. Extend the post-call workflow into a generic engine. Rejected because it
   broadens a stable profile and couples unrelated lifecycle semantics.
3. Disable append-only triggers with a transaction GUC. Rejected because any
   privileged caller could rewrite unrelated historical evidence.
4. Match data subjects by e-mail, phone or content hash. Rejected because
   similarity is not authority and can delete another person's records.
5. Preserve every append-only row indefinitely. Rejected because some rows
   contain content and append-only integrity does not create a retention basis.
6. Mark provider cleanup successful after timeout. Rejected because unknown is
   not evidence of absence.
7. Physically delete the tenant root. Rejected because authorized content-free
   receipts need a stable tenant scope and restrictive edges make reuse unsafe.

## Consequences

Disposition becomes slower and operationally more expensive than a direct
delete, but it is tenant-isolated, resumable, reviewable and honest about
external and backup state. New tenant-bearing data surfaces must update the
machine-readable catalog and tests in the same change. Historical data without
stable subject lineage may require operator remediation and cannot produce a
false completion receipt.

## Revisit triggers

- a jurisdiction requires physical deletion of the tenant scope UUID;
- the backup or PITR window changes;
- a provider cannot implement bounded reconciliation or verification;
- the platform adds a new storage, cache, search or identity authority;
- a dedicated governance worker role or independent approval service becomes
  available;
- production evidence justifies revising batch, cost or fairness limits.
