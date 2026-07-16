# ADR-032: Human user sessions map to tenant context via a signed JWT claim, never a header

**Status:** Accepted

**Date:** 2026-07-16

## Context

`packages/auth` (M0-09) already resolves service identities into a
`TenantContext`, and its own test suite locks a boundary in place: "M0
rejects a tenant header selector for user identities." The code comment on
`resolveAuthorizedRequestContext` says why: "User tenant selection needs a
later, claim-based public contract and must not be inferred from a header."
That later moment is now — `apps/portal` (new this session, real Supabase
Auth) needs a real human end user to reach tenant-scoped data safely.

Two things had to be decided together, not separately: how a verified human
session maps to a `TenantContext`, and how a signed-up user gets a tenant to
belong to in the first place (asked directly; answer: self-serve — signup
creates the user's own tenant, no admin invite step exists yet).

## Decision

- **Claim source, not header.** `SupabaseSessionIdentityVerifier`
  (`packages/auth`) verifies the session JWT's signature against the
  project's own JWKS endpoint (`jose`'s `createRemoteJWKSet`, asymmetric
  ES256 — confirmed live on the `digital-human-os` project) and reads
  `tenant_id`/`actor_id`/`tenant_role` only from the `app_metadata` claims.
  No shared signing secret is ever held by application code. A token missing
  those claims authenticates no tenant — it fails closed, exactly like the
  service path.
- **Claims come from the database, injected at token-mint time**, via
  Supabase's Custom Access Token Hook (`public.custom_access_token_hook`,
  applied directly to the Supabase project) reading a new
  `public.user_tenant_memberships` table (`user_id` → `auth.users`,
  `tenant_id` → `public.tenants`, `actor_id`, `role`). This table is **not**
  a portable migration (same reasoning as D-V2-055): it references
  `auth.users`, which does not exist in the local/CI Postgres harness.
- **A brand-new function, not a modified one.** `resolveAuthorizedUserRequestContext`
  is new and async; `resolveAuthorizedRequestContext` (sync, service-only,
  M0-09-tested) is untouched. The two never share a request-tenant-selection
  code path — mirrors the M3-06 pattern of extending via a new, injected
  collaborator instead of editing a frozen, tested mechanism.
- **`actorId` must still be a real UUIDv7.** Supabase's own user id
  (`auth.users.id`) is a random UUIDv4 and cannot satisfy `parseActorId`.
  `user_tenant_memberships.actor_id` is a second, application-generated
  UUIDv7 (via `@axtro/domain`'s `createUuidV7()`), created once at
  provisioning time and carried in the JWT claim from then on — the "runner
  never creates UUIDs, application code does" rule (`database/README.md`)
  holds even though a SQL function does the insert.
- **Self-serve tenant provisioning via a `SECURITY DEFINER` RPC, not a
  service-role key.** `public.provision_self_serve_tenant` runs as the
  calling user's own session (`auth.uid()`), is idempotent (returns the
  existing tenant if one is already provisioned), and creates `tenants` +
  `tenant_settings` + `user_tenant_memberships` in one transaction using a
  tenant id and actor id the **caller** generates in TypeScript and passes
  in — the function only validates and inserts, it never invents an id. This
  keeps the real Supabase `service_role` secret out of the picture entirely,
  consistent with the user's explicit instruction to gather real provider
  keys only at the very end of this phase, not now.
- `apps/portal`'s `DashboardLayout` calls the RPC on every authenticated
  load; idempotency makes repeated calls a cheap no-op after the first.

## Alternatives considered

- **Look up `user_tenant_memberships` on every request instead of using JWT
  claims.** Rejected: makes `verifyBearerToken` require a DB round trip on
  every call, breaks the existing synchronous verifier shape for no benefit,
  and the Auth Hook mechanism is exactly what Supabase provides so this
  lookup happens once per token mint, not once per request.
- **Give the portal a `service_role` key to provision tenants directly.**
  Rejected: real provider credentials are explicitly deferred to the end of
  this phase per the user's own sequencing; the `SECURITY DEFINER` RPC gets
  the same result with only the already-public anon/publishable key.
- **Relax `parseActorId` to accept any UUID version for user identities.**
  Rejected: UUIDv7 time-ordering is a pervasive schema invariant, not a
  service-only convention; generating a second, real UUIDv7 costs one extra
  column instead.
- **Widen `BEARER_PATTERN`'s length only for the new async path.** Rejected:
  the pattern is shared, and a real signed JWT (three base64url segments)
  simply cannot fit the old 256-character bound designed for short opaque
  dev tokens; widening it to 4096 is backward compatible (no existing test
  or caller relies on tokens longer than 256 being rejected).

## Consequences

A logged-in portal user with a confirmed session and a provisioned
membership resolves a real, tenant-scoped `AuthorizedRequestContext` with
zero shared secrets in application code. `apps/api` does not consume this
yet — no caller exists today that needs it, so wiring it in is deferred
until the portal has a concrete reason to call the internal API on a user's
behalf. One manual step remains outside this session's tool access: the
Custom Access Token Hook function is deployed, but **enabling** it
(`Authentication > Hooks` in the Supabase dashboard, or the Management API's
auth-config endpoint) is not exposed through the MCP tools available here —
someone with dashboard access must flip that one switch before the claim
injection takes effect on real logins.

## Revisit trigger

Revisit when `apps/api` gains its first caller that needs a human user's
tenant context (wire `resolveAuthorizedUserRequestContext` in then, not
before), when multi-tenant-per-user or admin-invite onboarding is needed
(today's schema is one membership row per user), or when the Auth Hook is
confirmed enabled and the full signup → hook → dashboard path can be tested
without the manual `email_confirmed_at` SQL workaround this session used.
