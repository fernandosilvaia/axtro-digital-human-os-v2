# Isolated public demo rollout

This runbook retires the historical shared administrative login and opens the
synthetic `/demo` boundary from ADR-045. Every production step changes remote
state and requires explicit operator authorization. M6-03 local implementation
does not execute any step below.

## Safety properties

- The public demo never authenticates with Supabase.
- The demo cookie is not customer authority and is scoped to `/demo`.
- No demo path imports database, provider, billing, calendar, e-mail, meeting,
  transcript or customer Server Actions.
- Rollback closes the demo. It never restores the shared login.
- The former auth user and tenant are not deleted in this runbook. M6-04 owns
  governed deletion and retained evidence.

## Prerequisites

1. M6-03 code, contract, unit, static, build and PostgreSQL regression gates are
   green on the exact release commit.
2. Architecture, security, data and test reviewers have no open P0, P1 or P2.
3. The release preserves customer login, signup and tenant provisioning.
4. The platform ingress has the exact global v3 policy below for the dedicated
   demo handlers. Per-instance application load shedding is defense in depth,
   not a replacement for this gate.
5. An operator has access to Railway, Supabase Auth and the former demo tenant.
6. An incident window and rollback owner are named.

## Configure the global edge policy

Apply this policy across every replica before enabling the demo:

| Match | Global ceiling | Window |
|---|---:|---:|
| `POST /demo/start` | 120 requests | 60 seconds |
| `POST /demo/command` and `POST /demo/end` | 600 requests | 60 seconds |
| `GET` or `HEAD` on `/demo` and `/demo/*` | 900 requests | 60 seconds |

All three rules reject with HTTP 429, permit no queue and share a hard global
ceiling of 32 active demo requests. The scope must include every replica and
must execute before application compute. There are no public demo Server
Actions, so the handlers cannot be forwarded from another pathname by Next.
The handlers also require an exact same-origin `Origin`; `/demo/command`
accepts only bounded UTF-8 JSON up to 1024 bytes.

After applying and exercising the rules, store this exact non-secret value as
`PORTAL_PUBLIC_DEMO_EDGE_POLICY_ATTESTATION`:

```text
axtro-public-demo-edge/v3;scope=global;post-start=120/60s;post-command-end=600/60s;get-head-demo=900/60s;concurrency=32;queue=0;reject=429
```

Readiness and the production bootstrap must remain red if the signing secret is
present without this exact value. Setting the attestation before the edge rule
is active is a release-policy violation.

## Configure the isolated demo

Generate a dedicated 32-byte secret without copying it into a ticket, log or
handoff:

```bash
openssl rand -hex 32
```

Store the value as `PORTAL_PUBLIC_DEMO_STATE_SECRET` in the approved production
secret manager only after the edge attestation is configured. Do not reuse a
provider, webhook, auth, preview or scheduler secret.

Before storing it, confirm the value was produced directly by the CSPRNG command
above. Runtime shape and diversity checks reject obvious weak values but cannot
prove how a secret was generated.

Deploy the M6-03 release with the old `DEMO_EMAIL` and `DEMO_PASSWORD` still
present only long enough to avoid an uncoordinated rollback. The new code must
not read either variable.

## Canary verification

Use two clean browser contexts and one existing authenticated customer canary.

1. Open `/` and start the demonstration in context A.
2. Confirm the response creates only the dedicated demo cookie. It must be
   HttpOnly, SameSite Lax, scoped to `/demo`, Secure in production and expire
   within 900 seconds.
3. Confirm there is no new `sb-*` cookie, auth user, membership or tenant.
4. Change one permitted synthetic state in context A.
5. Start the demo in context B and confirm it remains at the pristine fixture.
6. Confirm `/dashboard` still redirects an anonymous context to `/login`.
7. Confirm the demo has no team, invitation, billing, OAuth, activation,
   provider or destructive controls.
8. Inspect application telemetry and provider dashboards. The canary must add
   zero Supabase mutations, reservations, cost events, outbox rows and provider
   calls.
9. Start and end the demo from the authenticated customer canary. Its Supabase
   user, tenant and auth cookies must remain unchanged.
10. Exercise all three documented ingress matches and the 32-request active
    ceiling. Confirm excess traffic is rejected with 429, without a queue and
    before application compute.

Stop and roll back if any check fails.

## Retire the historical shared identity

This phase closes persistence paths left by the old public administrator. It
must run only after the isolated canary is green.

1. Resolve the former shared auth user through the secret manager and Supabase
   Auth without printing its e-mail, user ID or tokens.
2. Revoke every active refresh session and disable further sign-in for that
   identity. Rotate its password as defense in depth.
3. Resolve its historical tenant and inventory:
   - all `user_tenant_memberships`;
   - all pending tenant invitations;
   - invitation creator and requested role;
   - recent member removals and password changes;
   - agents, knowledge sources and transcripts changed during the public era.
4. Compare memberships and invitations to an operator-approved principal list.
   Revoke unexpected pending invitations. Remove unexpected memberships only
   through the existing guarded function and only after preserving the required
   audit evidence.
5. Do not delete the former auth user or tenant. Restrictive financial,
   provider and governance references require the M6-04 workflow.
6. Remove `DEMO_EMAIL` and `DEMO_PASSWORD` from Railway and the primary secret
   manager.
7. Rename the GitHub E2E secrets to
   `E2E_TENANT_ADMIN_EMAIL` and `E2E_TENANT_ADMIN_PASSWORD`. The workflow can
   read legacy names during the transition, but production runtime cannot.
8. Run the canary verification again after secret removal.

## Rollback

1. Remove or invalidate `PORTAL_PUBLIC_DEMO_STATE_SECRET` and redeploy. The
   route must show the deterministic unavailable state. Remove the edge
   attestation too if the infrastructure rule is being retired.
2. Confirm customer login and protected routes remain healthy.
3. Keep the old shared identity disabled. Never restore automatic public
   sign-in as a rollback mechanism.
4. Preserve logs and review evidence without including cookie tokens, auth IDs,
   e-mail addresses or customer content.

## Completion evidence

Record the release commit, deployment ID, operator approvals, canary timestamps,
cookie attribute checks, zero-effect query results, session revocation result,
membership and invitation audit result, secret removal confirmation and rollback
owner. Do not record secret values, auth tokens, PII or signed demo state.
