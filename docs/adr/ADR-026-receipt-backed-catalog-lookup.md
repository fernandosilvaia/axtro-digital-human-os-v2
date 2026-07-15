# ADR-026: Receipt-backed catalog lookup outside the Fast Lane

**Status:** Accepted

**Date:** 2026-07-14

## Context

M1-05 completes the smallest governed action path for an explicit catalog
question. ADR-010 already requires `ActionIntent`, server-side
`PolicyDecision`, and `ToolExecutionReceipt`; ADR-024 keeps the Fast Lane and
textual Turn Driver free of tools and the synchronous Axtro Agent path.

The Walking Skeleton needs deterministic proof that a catalog answer is backed
by a successful receipt rather than model memory. It also needs an auditable
unknown-effect path without opening a provider adapter, accepting model text,
or allowing a blind retry.

## Decision

- Add the generated, closed `catalog_lookup_command` contract. It accepts only
  `question_id`, `session_id`, and the allowlisted `starter` or `growth`
  `plan_id`. It accepts no tenant, actor, policy, receipt, idempotency key,
  raw text, provider, endpoint, scenario, timeout, reconciliation status, or
  tool arguments from the caller.
- Add a server-owned Catalog Lookup Coordinator in `@axtro/tool-runtime`,
  outside `@axtro/turns`, the Session Actor mailbox, Fast Lane, media path,
  Presenter publishing, and durable timeline. Trusted composition supplies a
  bounded session authority registry and a clock. The coordinator derives
  tenant, Presenter actor, action intent ID, idempotency key, purpose,
  timestamps, tool contract, action, and canonical arguments after checking
  authenticated `session:read`, `session:write`, and `tool:use` scopes plus
  `essential_processing` and `tool_auth` purposes.
- The coordinator submits only the internally derived `ActionIntent` to the
  existing deterministic policy and private read-only catalog fake. `ToolPort`
  remains fail-closed and no provider SDK, credential, network, callback, or
  authorized provider execution factory is added.
- The response is a candidate only. It can state plan availability only when a
  validated `ToolExecutionReceipt` is `succeeded`, belongs to the authorized
  tenant and derived intent, has canonical result JSON, and has an effect hash
  that matches that result. The candidate carries the derived tenant scope and
  cites receipt execution ID, effect
  hash, catalog version, plan ID, and status. It is neither an automatic Fast
  Lane response nor a Presenter or timeline write. M1-06 and later own
  durable timeline and publication fences.
- Idempotency is derived from `question_id` and scoped by tenant. The
  coordinator and underlying action runtime use bounded per-tenant ledgers.
  Replays return the prior candidate; new entries fail closed at capacity.
- A closed trusted fake mode can make the first allowed dispatch for each
  tenant return a receipt with status `unknown`, normalized timeout evidence,
  and an exact tenant-scoped barrier. The caller cannot select that mode.
  Reconciliation accepts the same authenticated,
  server-validated command only, derives all matching identities internally,
  reports deterministic `not_applied`, and clears only that exact barrier. A
  new question ID may then retry. Receipt, status, result, effect hash, and
  reconciliation outcome are never caller inputs.

## Alternatives considered

- Add `action_intent` to the Fast Lane response or import Action Runtime into
  `@axtro/turns`.
- Open `ToolPort` or move the private M0 fake to `@axtro/provider-fakes`.
- Accept model-produced text, tool arguments, idempotency keys, provider
  choices, timeout controls, or receipts at the command boundary.
- Confirm catalog availability before a receipt succeeds.
- Clear an unknown result by retrying or by accepting a caller-provided effect
  result.

## Consequences

The Walking Skeleton proves a complete deterministic action chain while
preserving the One Mouth Rule and realtime latency boundary. The coordinator
is intentionally narrow and read-only. Any general command parser, provider
adapter, durable receipt store, timeline publication, or automatic speech
requires its own contract and architecture review.

## Revisit trigger

Revisit when M1-06 introduces durable snapshots and timeline persistence, when
a provider adapter is selected after its benchmark, or when a new action class
requires a different policy, approval, or reconciliation model.
