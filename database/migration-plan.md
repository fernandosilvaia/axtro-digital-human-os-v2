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

## Rules

- Domain IDs are generated as UUIDv7 in application code. There is no v4 default.
- Every tenant transaction executes with `SET LOCAL app.tenant_id` from the authenticated identity, never from an untrusted header alone.
- Service operations still set tenant context and do not bypass RLS by default.
- Global catalogs are not tenant tables. Writes are restricted to migration or explicitly privileged administrative identities.
- Destructive schema changes use expand, migrate, verify, contract.
- Migrations must be tested from zero and from the previous release snapshot.

## M0 evidence

- clean apply on PostgreSQL with pgvector;
- documented forward-only boundary and repair procedure;
- two-tenant negative tests for read, insert, update and delete;
- append-only mutation rejection;
- UUIDv7 rejection test;
- cross-tenant composite FK rejection;
- schema drift check in CI.
