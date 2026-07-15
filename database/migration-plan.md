# Migration Plan

## Runner decision

M0 uses the TypeScript `@axtro/database` runner backed by local `psql`. No ORM or database client library is selected yet. The SQL files in this directory remain the normative database contract; the runner executes them verbatim and must not silently reinterpret constraints.

The runner accepts only password-free local PostgreSQL URLs with an explicit user and database name, writes ordered SHA-256 receipts to `public.axtro_schema_migrations`, and fails closed if a schema sentinel exists without its receipt. It starts subprocesses from a minimal allowlist with GSS disabled, requires an explicit opt-in for a caller-supplied loopback URL, and uses one normalized local lock for apply, read, and drift operations. The lock serializes this runner on one machine but cannot coordinate manual database clients. `pg` and Drizzle remain deferred until a repository implementation needs a database client.

## Order

1. `0001_extensions_and_domains.sql`
2. `0002_control_plane.sql`
3. `0003_interaction_and_actions.sql`
4. `0004_knowledge_governance.sql`
5. `0005_rls_and_immutability.sql`
6. `0006_reference_seeds.sql`
7. `0007_relational_tenancy_integrity.sql`
8. `0008_outbox_event_identity.sql`
9. `0009_cost_event_reconciliation.sql`
10. `0010_session_timeline_event_identity.sql`
11. `0011_post_call_workflow_persistence.sql`

## Rules

- Domain IDs are generated as UUIDv7 in application code. There is no v4 default.
- Every tenant transaction executes with `SET LOCAL app.tenant_id` from the authenticated identity, never from an untrusted header alone.
- Service operations still set tenant context and do not bypass RLS by default.
- Global catalogs are not tenant tables. Writes are restricted to migration or explicitly privileged administrative identities.
- Destructive schema changes use expand, migrate, verify, contract.
- Migrations must be tested from zero and from the previous release snapshot.
- Outbox rows carry a UUIDv7 `event_id` with a unique `(tenant_id, event_id)` constraint. A forward migration derives it only from an existing canonical event envelope whose identity fields prove `event_document.tenant_id = events_outbox.tenant_id`, and a persistent check prevents future mismatched envelopes. Historical rows that cannot prove this fail closed.
- Cost events retain tenant-scoped append-only evidence. The cost reconciliation migration applies new checks as forward-only `NOT VALID` constraints so legacy rows remain readable, and enforces USD, unit catalog, provider and service bounds, fixed-decimal amount reconciliation, dated rate-card pairing, local request and trace references. A partial unique index prevents a non-null provider request reference from creating more than one event per tenant and source. A `BEFORE INSERT` trigger admits a reconciliation only when it targets same-tenant estimated evidence with matching session, provider, service, and unit.
- Session timeline rows materialize canonical UUIDv7 `event_id`, unique per tenant, and reconcile the closed event envelope with tenant, session, aggregate, version, trace, correlation, causation and occurrence columns. Historical rows that cannot prove this fail the forward migration atomically. Continuity remains a transactional writer invariant; the database preserves uniqueness by session version and append-only immutability.
- Post-call workflow commands reference the exact tenant, session, completion event, aggregate version and event type in the authoritative timeline. Composite keys bind receipts and results to one matching run, command, session and source, and bind result evidence to the result session. The profile is closed to `post_call_processing@1.0.0`; commands, step receipts, results and relational evidence are append-only and forced-RLS. Runtime rows carry bounded attempts, availability, cancellation, lease and fencing state. The TypeScript M1 store remains local and does not claim to be a PostgreSQL runtime adapter. Historical claim-token persistence remains a prerequisite migration for any PostgreSQL runtime adapter.

## M0 evidence

- clean apply on PostgreSQL with pgvector;
- documented forward-only boundary and repair procedure;
- two-tenant negative tests for read, insert, update and delete;
- append-only mutation rejection;
- UUIDv7 rejection test;
- cross-tenant composite FK rejection;
- schema drift check in CI.
- post-call source identity, no-external-effect constraints and RLS isolation.
