# RLS Policy Matrix

## Rule

Every table that stores or directly relates tenant data has `tenant_id`, forced RLS and negative isolation tests. Truly global catalogs do not receive fake tenant ownership.

| Group | Tables | RLS | Mutation model |
|---|---|---|---|
| Tenant root | `tenants` | `id = current_tenant_id()` | lifecycle controlled |
| Tenant configuration | settings, identities, agents, deployments, packs, provider connections | tenant policy | normal CRUD with audit |
| Contacts | contact profiles | tenant policy | encrypted PII, tombstone deletion |
| Sessions | sessions, participants, snapshots, turns, health | tenant policy | lifecycle and version checks; presenter and participant links are session-scoped |
| Evidence | timeline, consent, disclosures | tenant policy | append-only |
| Actions | intents, decisions, approvals, executions, receipts, handoffs | tenant policy | receipts append-only |
| Knowledge | sources, versions, chunks, embeddings | tenant policy | source deletion graph |
| Workflows and governance | workflows, audit, outbox, costs, usage, evaluations, experiments, promotions | tenant policy | audit and cost append-only |
| Global catalog | schema, provider, region policy | no tenant RLS | privileged writes only |

## Application requirement

The authenticated JWT or service identity is mapped to an allowed tenant before `SET LOCAL app.tenant_id`. `X-Tenant-Id` is a requested context, not authority.

## Required tests

For each tenant table:

1. Tenant A can access its own row.
2. Tenant B receives zero rows or authorization failure for Tenant A data.
3. Tenant B cannot insert a row that references Tenant A.
4. Service workers cannot omit tenant context.
5. Cache keys and object storage paths include tenant and environment.
6. A presenter, turn participant or handoff presenter from another session is rejected.
7. Hard deletion of a session with cost or evaluation history is rejected so append-only evidence remains linked.
