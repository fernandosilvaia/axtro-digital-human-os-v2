# ADR-029: Checkpointed post-call workflow fake

**Status:** Accepted

**Date:** 2026-07-15

## Context

M1-07 relays each canonical session event through one code-owned consumer named
`session-timeline`. That delivery model cannot safely add an independent second
consumer without redesigning outbox delivery state per consumer. M1-08 must
start post-call processing from `session.completed`, persist resumable status,
generate deterministic summary and evaluation evidence, prove cancellation and
retry, and prevent duplicate follow-up effects.

The generic `workflow_command` and `workflow_status` contracts remain useful as
future transport envelopes, but they admit open workflow names, JSON input and
free error text. They are not authority for the closed M1 runtime. ADR-011 also
proposed selecting Temporal or an equivalent during M1, while Constitution
Article 10 requires provider selection only after interchangeable adapters and
benchmark evidence exist.

## Decision

### Composite delivery handoff

- Keep one outbox consumer. `apps/event-relay` first appends and reconciles the
  authoritative timeline receipt. Only for the exact canonical event type
  `session.completed`, it then invokes a narrow
  `SessionCompletionWorkflowSink` owned by `packages/workflows`.
- The composed factory requires its workflow sink at bootstrap. The explicit
  timeline-only factory rejects `session.completed` before timeline append, so
  a missing handoff cannot create a terminal partial effect.
- The relay acknowledges the outbox only after the sink returns a reconciled,
  idempotent enqueue receipt. The completion effect hash binds the timeline
  state hash and workflow command fingerprint. Other event types preserve the
  timeline state hash behavior from M1-07.
- A failure after timeline append and before enqueue leaves the outbox
  retryable. Redelivery repeats the idempotent timeline append and then creates
  one command. A failure after enqueue and before outbox acknowledgement repeats
  both effects and returns the same command, run and receipt.
- Do not add generic fanout, a second consumer, a broker, Redis, Temporal or a
  global tenant scan in M1.

### Closed M1 workflow profile

- Add specialized contracts for `post_call_processing@1.0.0`: command, status,
  enqueue receipt, step receipt and result. The generic workflow contracts stay
  available for future profiles but are never accepted as runtime authority.
- Tenant, session, command, run, source event, source fingerprint, source
  aggregate version, timeline state hash, trace, correlation, causation,
  timestamps, requested actor and idempotency key are derived server-side.
- The command contains only references and integrity metadata. It never stores
  transcript, prompt, summary, provider payload or caller-selected workflow
  configuration.
- The authoritative timeline must already contain the identical completion
  event and must replay to a completed session before enqueue or execution can
  mutate workflow state.

### Checkpoint state machine

- `packages/workflows` owns the state machine, validation, deterministic store,
  idempotency ledgers and pure fake activities. The closed steps are
  `generate_summary`, `evaluate`, `record_follow_up_guard` and `finalize`.
- `apps/workflow-worker` owns bounded `runOnce` orchestration and telemetry. A
  call receives an explicit tenant-scoped run ID and executes at most one step.
  It never scans tenants or drains a queue.
- The store is injected separately from the worker instance. Each claim has a
  bounded lease, tenant-scoped historically single-use UUIDv7 fencing token,
  exclusive deadline, pinned attempt budget and state version. Retry uses a
  positive bounded backoff and injected clock. Only the repository clock can
  create claim, checkpoint, failure and cancellation timestamps; worker input
  cannot advance a lease or retrodate a checkpoint. Cancellation persists and
  invalidates late or stale completion.
- Only `WorkflowActivityRetryableError` schedules retry. Validation or source
  conflicts become terminal `invalid_source`, policy denial becomes terminal
  `policy_denied`, and unknown exceptions become terminal `internal_failure`.
  Raw errors never enter status, receipts or telemetry.
- Summary, evaluation and follow-up guard effects are recorded by idempotency
  key before checkpoint acknowledgement. A worker replacement using the same
  local store and activity ledger resumes the persisted step. M1 does not claim
  survival across process, machine or repository loss.

### Output and external effects

- The deterministic summary is a bounded structural statement derived only
  from canonical event count, final version and replay hash. The evaluation is
  a fake structural integrity score with explicit provenance. Neither performs
  emotional, biometric, protected-attribute or deception inference.
- M1 records one local follow-up guard marker with mode `deterministic_noop`,
  status `not_sent` and `external_effect=false`. It does not create draft text,
  CRM data, email, message, task or network call.
- Any future draft or send remains M3 scope and must pass through
  `ActionIntent`, `PolicyDecision` and `ToolExecutionReceipt`. Model text can
  never select a workflow step, retry policy or external action.

### Authorization and telemetry

- Add `workflow:dispatch`, `workflow:execute` and `workflow:observe`, limited to
  service identities whose actor type is `workflow`. All require
  `essential_processing` at the repository boundary. The relay uses dispatch,
  not execute, and also needs `session:read` to derive canonical evidence.
  Claim and checkpoint need execute plus `session:read`; cancellation needs
  execute only. Result reads need observe plus `session:read` because the result
  is `restricted`. The worker does not need `session:write`, `tool:use`,
  `provider:use` or `event:relay`.
- Use `workflow.run` spans with closed start, checkpoint, retry, cancellation,
  completion and failure event codes. Attributes are limited to step, status
  and attempt. Trace and correlation come from the canonical completion event.
  Transcript, summary, input documents, raw errors and secrets never enter
  telemetry. Sink failure cannot alter workflow state.

### Persistence profile

- Add a forward-only SQL migration for the normative durable shape: append-only
  commands, workflow runtime state, append-only step receipts and append-only
  post-call results, all tenant-scoped with forced RLS and composite source
  identity constraints.
- Composite keys bind each receipt and result to one matching run, command,
  session and completion source. Result evidence also binds to the result
  session, not only to a tenant and run ID.
- The TypeScript M1 adapter remains a deterministic local store. The migration
  proves the future PostgreSQL boundary and local tenant isolation but is not a
  PostgreSQL runtime adapter. No remote database is accessed.
- Selection of a durable workflow engine is deferred until adapter contract
  tests, benchmark evidence and operational fit can be reviewed. This refines
  ADR-011 without changing the Constitution.

## Alternatives considered

- Add a second outbox consumer without per-consumer delivery state.
- Enqueue synchronously in the session completion API before timeline delivery.
- Scan every tenant timeline for unprocessed completion events.
- Accept arbitrary `workflow_command` payloads as execution authority.
- Run the entire workflow in one invocation without checkpoints or fencing.
- Generate or send real follow-up content in M1.
- Select Temporal, Redis, a provider SDK or production worker now.

## Consequences

M1 proves the complete event-to-workflow handoff, deterministic restart,
idempotent artifacts, bounded retry, cancellation and tenant isolation without
provider credentials or external effects. The single-consumer outbox remains
coherent and the future workflow engine stays replaceable.

The composite consumer is deliberately narrow. A second workflow profile or
independent event consumer requires explicit fanout delivery state, a new
contract and architectural review. The local store is evidence for behavior,
not production durability.

Migration 0011 does not preserve an abandoned claim token after its active
runtime row is cleared without a step receipt. The local M1 store does preserve
every issued token in process. A PostgreSQL runtime adapter therefore requires
an append-only claim ledger and its own contract before it can claim historical
single-use fencing durability. This limitation is not bypassed or described as
production-ready in M1.

## Revisit trigger

Revisit before enabling a second workflow profile, an external follow-up,
multi-process execution, a PostgreSQL runtime adapter, a durable workflow
engine or any production deployment.
