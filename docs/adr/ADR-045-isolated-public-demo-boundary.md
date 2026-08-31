# ADR-045: Isolated public demo boundary

**Status:** Accepted for M6-03
**Date:** 2026-08-31
**Related:** Constitution Arts. 3, 6, 7, 9, 10, 15 and 16; ADR-001, ADR-009, ADR-032, ADR-036, ADR-044

## Context

The public landing page currently signs every visitor into one real Supabase
user through `DEMO_EMAIL` and `DEMO_PASSWORD`. That identity is a member of a
normal tenant and the authenticated Portal treats it exactly like a customer
administrator. The existing end-to-end suite confirms that the identity can
activate agents, mutate knowledge and create tenant invitations.

This design violates the M6-03 requirements in four independent ways:

1. an anonymous visitor receives a mutable `tenant_admin` identity;
2. every browser shares the same customer-like state;
3. invitations can persist a second administrative identity after the public
   login path is removed;
4. a deployment with real provider credentials can expose paid effects because
   fake-provider configuration is global, not scoped to the public visitor.

Creating a tenant per visitor would move disposable presentation state into a
governed customer data graph. Adding a `demo` membership role would spread a
new public authority class through RLS, RPCs and application actions. Neither
option is a bounded correction.

## Decision

The public demonstration is a separate simulation boundary. It is not human
authentication, a tenant, a trial account or a provider session.

1. `/demo` uses its own public route group, layout, view models and handlers.
   It must not import the authenticated Portal shell or customer data loaders.
2. Demonstration content is a reviewed, immutable, synthetic fixture stored in
   code. It contains no PII, customer content, tenant identifiers or provider
   identifiers.
3. Mutable progress is carried only in a short-lived, HMAC-signed, HttpOnly
   cookie scoped to `/demo`. The token is continuity evidence for the local
   simulation and grants no authority anywhere else.
4. The cookie uses `SameSite=Lax`, is `Secure` in production, has a bounded
   lifetime and is replaced when a new demo starts. No token is returned to
   browser JavaScript.
5. The reducer accepts only a versioned, closed command allowlist. The signed
   state carries at most twelve accepted command identities and their exact
   inputs. The reducer rejects divergent identity reuse and replays an exact
   historical command without mutation.
6. The demo has no Supabase Auth session, tenant membership, actor, database
   row, transcript, outbox, cost event, tool receipt or provider capability.
7. Customer login, signup, tenant provisioning and tenant selection keep their
   existing boundaries and fail-closed behavior unchanged.
8. Ending the demo deletes its dedicated cookie. Expiry or malformed state
   returns an unavailable or pristine result without fallback to the old
   shared login.
9. Mutations use dedicated POST route handlers at `/demo/start`,
   `/demo/command` and `/demo/end`. The boundary owns no Next Server Action,
   so framework action forwarding cannot move a demo mutation to another path.
10. Every mutation requires an exact same-origin `Origin`. Command input must
    be UTF-8 JSON and is rejected before parsing above 1024 bytes.

The signing secret is dedicated to this boundary. Runtime validation requires
32 bytes encoded in lowercase hexadecimal and rejects obvious low-diversity
values. Randomness itself is a provisioning property and must come from a
CSPRNG in the approved secret manager. The secret must not be reused by any
other token or route.

## Contract boundary

Three generated contracts define the complete mutable surface:

- `portal_public_demo_signed_state_payload` carries fixture version, random
  demo session ID, bounded revision, up to twelve accepted command records,
  closed surface and step enums, issue time and expiry time;
- `portal_public_demo_command` carries a random command ID, expected revision
  and one command from the closed demonstration allowlist;
- `portal_public_demo_action_result` returns only a discriminated outcome and a
  browser-safe bounded snapshot. It never returns the signed token, a role, a
  provider result or any kind of execution receipt.

All schemas reject additional properties. The token codec additionally checks
canonical JSON, canonical base64url, byte and character ceilings, timestamp
shape, future issuance, TTL, signature length and constant-time equality.

## Structural egress denial

The public demo module owns no port capable of an external effect. Its import
graph must exclude:

- Supabase clients and `portal-data`;
- database, service-role and tenant provisioning code;
- provider packages, `paid-effects`, ledgers and runtime bridges;
- billing, calendar, e-mail, meeting, transcript and customer Server Actions.

This is an architectural denial, not an environment flag. Real credentials can
exist in the same process without granting the demo a path to use them.

## State lifecycle

Starting a demo creates a new UUIDv7 session ID and revision zero from the
immutable fixture. Each accepted command rotates the signed cookie with a new
bounded state. An exact command identity can replay anywhere in its bounded
lineage without mutation. Reusing that identity with a different command or
revision fails closed. A stale expected revision is rejected, and an expired
or malformed token never produces state. Reset remains a local simulation
command and does not touch customer data.

Because the state is a non-authoritative bearer envelope, a visitor who copies
an older valid cookie can fork a local synthetic lineage. Preventing rollback
would require durable server-side CAS and is intentionally outside M6-03. A
fork grants no tenant or external capability. The twelve-transition ceiling is
a UX and envelope bound, not the infrastructure abuse control.

Anonymous infrastructure load is bounded separately. A fixed-key,
per-instance admission guard limits starts, reads, commands and concurrent
work without trusting forwarded client identity. It carries no demo state and
queues no work. A hard ingress rate limit at the platform edge remains a
mandatory rollout gate because an in-process guard cannot coordinate replicas
or stop requests before compute allocation. The exact v3 policy is global
across replicas, rejects without a queue using HTTP 429, caps active requests
at 32, and applies 120 starts per 60 seconds to `POST /demo/start`, 600
commands or exits per 60 seconds to `POST /demo/command` and `POST /demo/end`,
and 900 reads per 60 seconds to `GET` or `HEAD` on `/demo` and descendants.

The application requires both the signing secret and the exact non-secret edge
policy attestation. Readiness and the production bootstrap fail closed when
only one is present, the policy version differs or the secret is weak. The
attestation records an operator-verified infrastructure fact; it must never be
set before the edge rule is active.

Ending a session is the one intentional local shedding exception: the handler
may delete the demo cookie even when the process-local command lease is full.
Cookie deletion is a bounded security cleanup and creates no product state or
external effect. The edge v3 policy remains the authoritative global request
limit for this endpoint.

Because the attestation is configuration evidence rather than a live control
plane query, operations must also run a recurring canary that proves the edge
policy still matches v3. A stale attestation must not be treated as proof of a
currently active rule.

No server-side cleanup worker is required because the server stores no demo
state. The small process-local admission counters are abuse controls, not
session storage. Cookie deletion, expiry or browser disposal removes the only
mutable product state. A later requirement for real model, avatar, tool or
provider interaction would cross this boundary and requires a separate
contract, durable authority, cost controls and production review.

## Consequences

Anonymous visitors can explore a representative workflow without acquiring an
account or changing shared resources. Independent cookie jars cannot affect one
another, paid-effect code is unreachable, and customer auth remains separate.

The demonstration is intentionally synthetic. It cannot claim a real provider
completion, commercial outcome, transcript, consent record or tool receipt.
Product copy must identify that limitation clearly.

Production closure also needs an authorized operational runbook after the new
code is deployed. Operators must revoke old shared-user sessions, disable its
sign-in, remove runtime `DEMO_EMAIL` and `DEMO_PASSWORD`, and inventory pending
invites and unexpected memberships in the former demo tenant. Direct deletion
of that user or tenant is not part of M6-03 because restrictive financial and
governance references require the M6-04 deletion workflow.

## Alternatives considered

1. Keep the shared user and add UI restrictions. Rejected because direct RPCs,
   stale sessions and invitation persistence retain real authority.
2. Use Supabase anonymous authentication. Rejected because any authenticated
   user without a membership reaches self-serve provisioning and becomes a
   tenant administrator.
3. Add a `demo` tenant role. Rejected because many data functions authorize by
   membership existence and would require a full surface audit and migration.
4. Create a disposable tenant per visit. Rejected because tenant deletion,
   receipts and provider effects are governed durable workflows.
5. Store mutable demo sessions in PostgreSQL or process memory. Rejected because
   the simulation needs neither durable storage nor replica-local state.
6. Keep all progress only in browser-readable storage. Rejected for this release
   because a signed HttpOnly envelope gives deterministic expiry, replay and
   integrity behavior without granting backend authority.

## Rollout and rollback

Rollout is fail closed:

1. deploy `/demo` with the feature unavailable when its dedicated secret is
   absent, invalid or missing the exact edge attestation;
2. configure and verify the global v3 edge policy for the three dedicated POST
   handlers and the demo GET tree;
3. configure the exact edge policy attestation, then the dedicated secret,
   through the approved configuration and secret managers;
4. verify two-session isolation, local load shedding, zero Supabase cookie and
   zero external calls;
5. remove the old shared credentials from runtime;
6. execute the authorized session and membership audit runbook.

Rollback disables the isolated demo. It must never restore automatic sign-in
to the shared customer-like identity.

## Revisit trigger

Revisit when the public experience needs a real model, live avatar, external
tool, provider, persisted transcript or user-supplied free text. That change
requires a new durable authority and cost design after M6-04 and M6-06, not an
extension of this browser-carried simulation token.
