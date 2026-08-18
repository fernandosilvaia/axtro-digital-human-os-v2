# ADR-036: Durable reservations and an unknown-outcome barrier for paid provider effects

**Status:** Accepted for M5-01  
**Date:** 2026-08-13  
**Supersedes:** portal-local check-then-spend behavior described by D-V2-101, D-V2-114 and D-V2-116 where it conflicts with this decision  
**Related:** ADR-010, ADR-011, ADR-018, ADR-021

## Context

The production portal opens paid Tavus conversations and Recall meeting bots,
executes paid OpenRouter generation/embedding calls, and reports Stripe
overage usage from several independent Next.js paths. Those paths previously
checked usage, called the provider and appended cost evidence as separate
operations. A process crash, a concurrent request or an ambiguous provider
timeout could therefore create an effect that was not counted, create more
effects than the tenant cap permitted, or cause a retry to create the same
paid effect again.

An in-memory dedup window cannot coordinate Railway replicas or survive a
restart. A time-limited database claim is also unsafe: expiry does not prove
that an external effect was rejected. Stripe reporting has the same problem in
the other direction—an accepted conversation can permanently lose its billed
overage when the synchronous request or its single retry fails.

Subscription Checkout is also an external paid/account effect. A minute-bucket
idempotency key and a browser submit guard cannot prevent two sessions across
replicas or reconcile a timeout after Stripe accepted the request. A
tenant-keyed last-write-wins subscription upsert can also hide a second live
`sub_*` while the first continues billing. M5-01 therefore applies the same
durable-intent discipline to Checkout, without pretending that a Checkout
intent is a provider cost reservation.

The portal database already has an append-only cost ledger, but it lacks the
durable intent boundary between authorization and provider execution. The
production effect state also needs an explicit recovery rule for the interval
where the provider outcome is not known.

## Decision

### One reservation boundary

Every paid Tavus or Recall creation MUST first acquire a tenant-scoped,
idempotent reservation in PostgreSQL. The reservation RPC serializes on the
tenant, counts committed usage plus every non-released reservation in the same
cap bucket and returns one of:

- `reserved`: this caller owns the right to attempt the provider effect;
- `replayed`: the same idempotency key already owns or completed that intent;
- `capped`: no provider call is authorized;
- `blocked_unknown`: an earlier attempt may have produced an external effect
  and must be reconciled before retry.

The application transitions `reserved` to `provider_in_flight` immediately
before the provider call. This transition is the execution fence. A second
caller never invokes the provider for the same reservation.

Paid OpenRouter generation and embedding use a separate, smaller reservation
table because their measured unit and lifecycle are tokens rather than a
long-lived provider resource. They obey the same ordering: reserve the maximum
token/cost envelope, acquire a single dispatch fence, call the provider, then
commit actual tokens and provider-reported cost. Any failure after dispatch is
`unknown`; an HTTP rejection alone is not proof that no billable inference
occurred. The daily tenant envelope is 500,000 reserved tokens and knowledge
ingestion is additionally limited to 30 reservations per UTC day. Committed
rows count their measured input/output tokens; only `reserved`,
`provider_in_flight` and `unknown` rows retain the maximum envelope.

The Tavus brain derives idempotency from an authenticated provider request ID
when one is present and includes a body fingerprint. If Tavus sends no stable
request identity, the server creates a fresh request scope; this sacrifices
cross-request retry deduplication but prevents two distinct conversations with
identical message arrays from replaying one historical commit forever. The
daily cap remains the bounded-spend fallback.

### Unknown is a barrier, never a lease expiry

Provider timeout, network loss after request dispatch, process death or a
failed compensation do not release capacity. They persist `unknown` or
`cleanup_pending`. There is no automatic expiry that permits a new spend.
For OpenRouter, any unresolved `provider_in_flight` or `unknown` row blocks
every new AI begin and also blocks the dispatch fence of reservations acquired
just before the ambiguous outcome. OpenRouter does not expose a request lookup
contract that can safely infer absence. A bounded worker sweep changes an AI
row left `provider_in_flight` for ten minutes to `unknown`; this changes its
classification but never releases capacity. The service-only reconciliation
boundary accepts exactly either `provider_invoice_no_charge` or bounded
`provider_invoice_usage_confirmed`, persists an immutable receipt with a
globally unique provider reference, and rejects caller-supplied tenant/actor
authority. M5-01 exposes only its aggregate backlog over HTTP; the mutating
operator endpoint remains closed until M5-02 supplies authenticated operator
identity and dual approval. There is no TTL, automatic release or unaudited
escape hatch. Request paths release only reservations that provably never
crossed the dispatch fence.

The sole time-based reclaim is a ten-minute sweep of rows still exactly in
`reserved`. This is not an ambiguous effect: both Tavus and AI provider calls
require a database transition out of `reserved` before dispatch. Sweep and
dispatch serialize on the row, so the sweep can win only before the provider
fence; `provider_in_flight`, `unknown` and `cleanup_pending` never expire.

Only one of the following may release a provider-resource reservation after
dispatch:

1. a provider lookup/reconciliation proves no effect exists;
2. a compensating termination returns a confirmed receipt.

Manual reconciliation is preferable to duplicate spend. Provider-facing
names and request references include the reservation ID so an operator or a
future reconciler can correlate an ambiguous attempt.

### Atomic provider evidence, held delivery and durable billing

A successful provider result is committed with its provider reference and one
cost event in the same database transaction. The cost event ID belongs to the
reservation and is stable across retries. Replaying the same finalize request
returns the prior committed result; it does not insert another cost event.

Provider commit does **not** charge the customer yet. It leaves customer
delivery in `held` until customer-visible evidence is durable: a capability-
authorized final Tavus transcript with a non-empty `user` turn for direct
flows, or signed Recall `in_call` plus durable `camera_started` for the delayed
sentinel flow. A placeholder, assistant-only transcript or replica-ready event
is never delivery evidence. Activation then takes the tenant lock, snapshots the
Stripe customer, plan, meter instant, billing period and included ordinal, and
atomically appends `billing_usage_outbox` only when that activated ordinal is
an overage. This prevents charging for a provider resource that the application
failed to make usable.

If customer-visible persistence fails before activation, the held delivery is
voided and the known provider resource is compensated. A leased, delivered or
dead-lettered billing row is never silently voided; that ambiguity becomes
`cleanup_pending` and requires reconciliation. Stripe delivery is asynchronous,
leased and retryable with a stable idempotency key derived from the cost event,
so Stripe availability never enters the customer request path.

### Durable Stripe Checkout identity

Every subscription Checkout starts with one tenant-serialized
`billing_checkout_intent`. The database snapshots the exact plan, Stripe price
IDs, catalog amounts, meter name, public success/cancel origins, expiry and a
stable idempotency key derived from the UUIDv7 intent. It rejects a new intent
while a subscription is nonterminal or another intent is open. The app verifies
the Stripe catalog, crosses a single `reserved -> dispatched` fence, creates
the session with the stored request and binds the exact `cs_*`, URL and expiry
before redirecting. Timeout or lost response after dispatch remains `unknown`;
only a proven pre-dispatch catalog failure may release.

Signed Checkout and subscription webhooks converge on that same intent.
Session metadata and subscription metadata carry server-owned intent, tenant
and plan identities. A different subscription ID may replace the tenant row
only when the previous subscription is terminal and the incoming identity is
backed by the matching intent. A second live subscription becomes an explicit
conflict, and late events for a superseded `sub_*` never overwrite the active
row. Checkout session IDs, subscription IDs and Stripe event IDs are globally
single-owner. The browser never supplies customer authority, price amounts,
idempotency or reconciliation evidence.

### Cap buckets

- `tavus_video_daily` is shared by direct video, presentation, institutional
  lead video, immediate external meetings and delayed sentinel attachment.
  Because a Tavus room starts accruing cost before delivery is proven, the
  tenant may have at most three total unresolved or historically dispatched,
  non-activated Tavus effects in the current billing period. The `held` and
  no-delivery sets are disjoint but share this one budget; moving an effect
  from one set to the other never creates a new slot. Activated conversations
  and legitimate overage do not consume the no-delivery budget. Three
  30-minute envelopes bound modeled unbilled exposure to US$33.30 per period
  at the dated US$0.37/min rate.
- `recall_bot_active` limits scheduled and immediate Recall bots separately,
  because scheduling already creates a paid external resource even before a
  Tavus camera is attached. A second `recall_bot_daily` budget counts all
  committed Recall cost evidence, including effects later completed or
  compensated, plus uncommitted envelopes. It bounds sequential paid attempts
  that would otherwise leave the active-concurrency bucket after termination.
- `ai_tokens_daily` reserves the worst-case input/output envelope across
  generation, RAG query embeddings and ingestion embeddings; the separate
  `knowledge_ingestions_daily` count prevents provider fan-out by many small
  ingestion requests.

Committed cost evidence is counted at actual quantity. Non-released,
uncommitted reservations retain their maximum envelope. Daily buckets use the
UTC date already used by the portal. Monthly included usage is assigned
atomically by ordinal, so concurrent requests at the plan threshold produce
the exact overage quantity.

### Terminal meeting state and resumable camera attachment

A terminal Recall session can never reserve or resume a new paid effect.
Delayed camera attachment persists its progress. Replays may resume
`conversation_created -> camera_started`; they must never create a second
conversation. Camera start success is a durable receipt/state, and failed
cleanup remains fenced.

### Durable operator termination lease and receipt

Ending a known Tavus conversation or Recall bot is a lifecycle-containment
operation, not reconciliation and not a financial compensation. It therefore
has a separate, append-only termination receipt scoped to the existing
reservation. The receipt records the server-derived tenant, canonical actor,
provider, attempt, state, lease and sanitized failure/acceptance evidence. It
never exposes a provider reference, reservation ID or lease token to the
browser.

The termination begin boundary locks the reservation and independently verifies
that the authenticated user and canonical actor are the same `tenant_admin`
membership. It resolves the reservation only from server-derived tenant, agent,
provider and idempotency data. At most one live dispatching lease exists for a
reservation across all replicas. A live lease returns an in-progress status;
an accepted receipt replays an accepted status; a due retry appends the next
attempt. Process-local rate limiting may improve UX but is never the authority
for a provider call.

The provider reference is released only to the server action that owns a fresh
lease. A successful provider acknowledgement atomically settles the receipt
and transitions the already-committed reservation to `completed`. A timeout or
failure does not release, void, reconcile, or mark the paid reservation
`unknown`: it records a retryable failure with bounded backoff, and eventually
requires an operator. A stale lease token cannot settle a later attempt.

This gives one concurrent provider termination dispatch, not a false
exactly-once claim for an HTTP request after an ambiguous timeout. It also does
not prove physical media silence, cancel late audio/video output, or replace
the realtime generation fence required by ADR-038. User-facing success means
only that the termination request was accepted by the provider boundary.

### Expand-contract deployment

The first migration is additive: new tables, RPCs and a schema-capability probe
are added without narrowing the old transcript RPC. With maintenance and drain
still active, apply v40 and then v41 before starting the new application
artifact. Verify the v41 capability probe, start the v41-aware candidate at
zero public traffic, run both workers once, and only then allow `/api/ready` to
return 200 and route traffic. There is no live v40 soak or v40 candidate: it
would leave the authenticated provider-reference preclaim surface open and is
incompatible with Railway's mandatory `/api/ready` healthcheck.
Application rollback to the legacy writer is compatible only before v41.
After v41, rollback must use the v41-aware application or a forward hotfix; it
must never reopen authenticated provider-reference claims.

### Security and tenancy

Tables use forced RLS with no direct client policy. Provider-resource,
reconciliation, webhook and billing RPCs are executable solely by
`service_role`; tenant and agent are resolved by the server and revalidated
through the composite tenant/agent key inside the transaction. AI mutation
RPCs are also `service_role`-only; there are no authenticated AI wrappers.
Server Actions first resolve the authenticated membership and owned
agent/source through RLS, then pass only that server-derived tenant to the
fixed-envelope service boundary. A browser can neither choose a token/cost
envelope nor mutate, release or forge ledger state. Webhook delivery IDs are
claimed once before effects, and real Recall mode requires its signed webhook
secret at readiness.
Because Tavus does not provide an authenticated callback signature, each
conversation receives an independent 256-bit capability; PostgreSQL stores
only its SHA-256 hash. Preflight authorizes before any provider-controlled body
is read, the claim binds provider reference, digest and observed time, expiry
is the server-owned conversation duration plus a fixed 15-minute retry margin,
and successful completion revokes all nonterminal authority. Callback and
Checkout return URLs use one reviewed HTTPS origin allowlist; forwarded host
headers never choose an external destination.
Checkout mutation RPCs are likewise `service_role`-only. The Server Action
first authenticates the user and derives tenant and administrator role; the SQL
boundary independently resolves that auth user membership and stores its
canonical actor ID. Checkout callbacks are accepted only through the signed
Stripe webhook.

## Alternatives considered

1. Keep check-then-spend and improve in-memory dedup. Rejected because it does
   not coordinate replicas or survive restart.
2. Use a five-minute database lease and retry afterward. Rejected because time
   does not resolve whether a provider accepted a request.
3. Roll back every ambiguous attempt with best-effort termination. Rejected
   because a failed or timed-out termination is another ambiguous external
   effect.
4. Block the HTTP response until Stripe accepts overage. Rejected because
   billing availability must not extend user-path latency and a crash would
   still lose the unit without durable state.
5. Use a process-local stop deduplication window or reuse provider-effect
   reconciliation receipts. Rejected because the former does not coordinate
   replicas and the latter has billing-release semantics that are incorrect for
   a normal operator termination.

## Consequences

- Paid provider calls require a reservation ID and stable idempotency key.
- Unknown outcomes intentionally consume capacity until reconciled.
- A billing dispatcher is mandatory in real-provider mode; inline Stripe
  overage reporting is not a compatibility fallback for M5-01 paths.
- A durable Checkout intent and strict subscription-identity writer are
  mandatory in real billing mode; time buckets and last-write-wins subscription
  replacement are not compatibility fallbacks.
- Billing and provider-reconciliation workers persist versioned success
  heartbeats. Production readiness requires both receipts to be no older than
  two scheduled intervals; configuration flags alone are not execution proof.
- Railway runs a versioned, read-only bootstrap before process start. It
  validates schema, critical backlogs and the configured Stripe catalog, then
  writes deployment- and fingerprint-bound initial worker heartbeats.
- The portal can report a truthful pending/reconciliation state instead of a
  false success.
- Supabase-only migrations need an executable local harness for concurrency,
  grants, rollback and RLS; regex source tests remain lint only.
- Normal operator termination has a separate durable receipt/lease and
  `tenant_admin` authorization boundary; it cannot reuse financial
  reconciliation or report media silence without independent evidence.

## Rollback

Before v41, deploy the previous application only after disabling traffic to the
new paid paths and reconciling every `provider_in_flight`, `unknown` and
`cleanup_pending` row. After v41, a legacy application rollback is forbidden;
deploy the last v41-aware build or a forward hotfix. Do not drop reservations
or outbox rows because they are financial evidence, and never restore the
authenticated provider-reference claim surface.

## Revisit trigger

Revisit when a provider supplies native idempotency/lookup, connected-duration
webhooks allow measured unit billing, or the generic Action Runtime gains a
production provider-effect contract that can replace this portal bridge.
