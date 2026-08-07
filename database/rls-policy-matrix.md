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
| Workflows and governance | workflow runs, post-call commands, step receipts, results, relational result evidence, audit, outbox, costs, usage, evaluations, experiments, promotions | tenant policy | commands, receipts, results, result evidence, audit and cost append-only |
| Global catalog | schema, provider, region policy | no tenant RLS | privileged writes only |

## Application requirement

The authenticated JWT or service identity is mapped to an allowed tenant before `SET LOCAL app.tenant_id`. `X-Tenant-Id` is a requested context, not authority.

**Status note (added 2026-08-06, audit finding, D-V2-105):** this requirement describes the
original M0-M3 kernel design intent. It was never implemented — no migration, RPC or
application code anywhere in this repo ever calls `SET LOCAL app.tenant_id` / `set_config`.
`app.current_tenant_id()` (0001) therefore always returns `NULL`, so every `tenant_isolation`
policy built on it (0005) is permanently inert — it denies all direct table access rather than
scoping it, which is fail-closed and not a live vulnerability, but it is dead code that reads
as active protection. The portal (D-V2-058, `apps/portal`) deliberately does **not** use this
mechanism: every read/write goes through a `SECURITY DEFINER` RPC (`portal_*`) that resolves
the tenant from `auth.uid() -> user_tenant_memberships` itself, matching the newer tables'
pattern (`meeting_bot_sessions`, `tenant_subscriptions`, `agent_video_config`,
`tenant_invites`: `FORCE ROW LEVEL SECURITY` with zero policies — deny-all-by-default,
authority lives in the RPC). Do not implement `SET LOCAL app.tenant_id` from a client-supplied
header (`X-Tenant-Id`) trusting it as authority — this doc already warned against exactly that
failure mode. If this GUC-based mechanism is needed for a future non-portal consumer of the
kernel tables, it must set the GUC itself from a verified identity (JWT claim or service
context), never from client input.

## Required tests

For each tenant table:

1. Tenant A can access its own row.
2. Tenant B receives zero rows or authorization failure for Tenant A data.
3. Tenant B cannot insert a row that references Tenant A.
4. Service workers cannot omit tenant context.
5. Cache keys and object storage paths include tenant and environment.
6. A presenter, turn participant or handoff presenter from another session is rejected.
7. Hard deletion of a session with cost or evaluation history is rejected so append-only evidence remains linked.
8. A post-call command cannot reference another tenant, session, source event, aggregate version or service identity.
9. Post-call command, step receipt, result and result evidence updates or deletes are rejected.
