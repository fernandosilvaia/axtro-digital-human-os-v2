# ADR-030: Framework-neutral read-only operations console

**Status:** Accepted
**Date:** 2026-07-15

## Context

M1 needs one minimal operations console that displays the authorized session
state, the ordered canonical timeline, governed action receipts and exact cost
totals. The repository has no browser runtime, user-claim tenant selector,
React or Next.js dependency yet. Selecting those now would add installation,
hydration and deployment concerns that are not needed to prove the Walking
Skeleton.

The console crosses sensitive boundaries. A guessed session identifier must
not reveal another tenant. Timeline payloads, transcripts, tool results and raw
errors can contain restricted data. A `ToolExecutionReceipt` has no
`session_id`, so it cannot be assigned to a session from its execution ID.
Derived hypotheses are explicitly uncertain and must never look like receipts.

## Decision

- M1 uses framework-neutral TypeScript server-side rendering. `apps/web` owns
  a request adapter over an already resolved trusted `AuthorizedRequestContext`
  and read-model composition. It does not interpret browser authentication or
  tenant headers. `@axtro/ui`
  owns pure semantic HTML and static styles. Neither package opens a socket,
  performs provider I/O or introduces a production dependency.
- The only session deep link is
  `/operations/sessions/:session_id`. No tenant selector is accepted from the
  path, query, body, client state or header. Tenant authority comes only from
  an existing `AuthorizedRequestContext`.
- The route accepts the current fake-auth limitation rather than pretending a
  browser identity exists. It requires a `human_operator`, `session:read` and
  `essential_processing`. A future browser login and user tenant selector need
  their own identity contract and review.
- `SessionLifecycleApplication.getSession()` is called first. Missing and
  cross-tenant sessions produce the same generic 404 response. Timeline,
  action evidence and costs are never queried after that denial.
- After the lifecycle authority succeeds, ordered events come only from the
  M1-06 authoritative `SessionTimelineRepository`. A page contains at most 100
  metadata rows. More events are disclosed through a bounded cursor link, not
  by an automatic global scan or polling loop.
- A bounded replay of that exact session verifies the canonical state and
  produces its state hash. Its tenant, session and version must match the
  lifecycle authority before any document is rendered. M1 caps this replay at
  10,000 envelopes and 5 MB of aggregate UTF-8 payload.
- The console action projection is read-only and bounded. Each row is bound by
  a matching `ActionIntent`, `PolicyDecision` and `ToolExecutionReceipt` with
  the same tenant and intent identity. The intent supplies the trusted session
  relation. Its startup input is capped at 10,000 records, 100 rows per session
  and 5 MB cumulative UTF-8 evidence. The route never receives an Action
  Runtime execution method.
- A receipt is labelled as a confirmed effect only when its status is
  `succeeded`, the policy outcome is `allow`, and a valid effect hash is
  present. Every derived hypothesis is labelled as unverified, including a
  contract value whose status says `confirmed`.
- The renderer uses an allowlisted view model. It omits `payload_json`,
  transcript, `arguments_json`, `purpose`, `result_json`, raw error messages,
  provider codes, provider request references, external session references and
  rate-card references. All remaining dynamic text is HTML-escaped.
- Costs are read only after session authorization, validated against the exact
  tenant and session, grouped by evidence source and summed with fixed-scale
  integers. Measured, estimated and provider-reported values are never merged
  into a misleading grand total.
- Pages are bounded to 100 timeline rows, 100 action rows, 100 hypothesis rows
  and 100 cost buckets. Overflow fails explicitly without silently truncating
  financial totals.
- The response is script-free and uses a hash-pinned inline stylesheet. It
  sends `private, no-store`, `nosniff`, a closed Content Security Policy and
  frame denial. Loading, empty, error and populated documents share semantic
  landmarks, visible focus, live-region status and non-color evidence labels.
- The web request receives a server-minted trace and correlation ID. Its root
  trace remains tenant-only with `session_id=null` because the deep-link value
  is untrusted until the lifecycle gate succeeds. Telemetry includes only
  closed route, outcome and operation attributes. Sink failures cannot alter
  the response and raw errors never enter logs or HTML.
- The HTML view model is private to the web process, so M1 adds no OpenAPI,
  AsyncAPI or JSON Schema. Existing generated contracts remain the source for
  session state, event, action, policy, receipt, hypothesis and cost shapes.

## Options considered

### Add Next.js and React now

Rejected for M1. It would select a production framework and hydration model
without a browser authentication contract or interactive requirement. The pure
renderer and request adapter remain compatible with a future Next.js shell.

### Read directly from a global console projection

Rejected. A global lookup can reveal whether a foreign session exists and can
mix tenant data before authorization.

### Put tenant ID in the deep link

Rejected. The current development auth accepts tenant selection only for
service identities. A URL value is not identity authority.

### Render raw contracts as JSON

Rejected. It would expose restricted payloads and make receipts visually
indistinguishable from hypotheses.

## Consequences

- M1 obtains a real, renderable and accessible HTML console without network,
  deploy, provider, secret or frontend framework dependency.
- The request adapter and pure renderer can be wrapped by Next.js later without
  moving tenancy, evidence or financial rules into components.
- The local action projection is a deterministic read index, not a new source
  of truth. M1 renders no hypothesis source: it keeps only the explicit
  unverified component variant and its tests. A durable projection and browser
  auth remain future work.
- Server rendering has no client polling or live updates. Operators refresh or
  follow the bounded next-page link in M1.

## Revisit trigger

Revisit when the browser receives a production identity contract, the room
needs interactive client state, or a durable query projection is introduced.
Those changes must preserve lifecycle-first authorization, canonical timeline
authority, receipt binding, uncertainty labels and exact cost arithmetic.
