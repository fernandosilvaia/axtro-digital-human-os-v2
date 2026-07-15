# Observability

## Correlation fields

Every log, span, metric exemplar and cost event should carry when applicable:
- `tenant_id`;
- `agent_id`;
- `deployment_id`;
- `session_id`;
- `turn_id`;
- `generation_id`;
- `trace_id`;
- `provider` and a local, server-minted `provider_request_ref`.

PII is not a correlation field.

## M0 trust boundaries and carrier

- A public API request always receives a new server-minted trace root and correlation ID after authentication. Its root span has no session ID. A session ID may be attached only by a downstream boundary after session lookup and RLS authorization. Public `traceparent`, `tracestate`, `baggage`, request IDs and tenant headers do not control telemetry lineage.
- Only a trusted internal boundary may continue a trace. The M0 carrier is one strict W3C `traceparent` with version `00`, a nonzero 32-hex trace ID, a nonzero 16-hex span ID and two hex flags.
- The carrier never contains tenant, session, correlation, causation, actor, payload or provider credentials. Tenant, session, correlation and causation remain in typed authorized context or in an already validated event envelope.
- The realtime worker rejects absent or invalid internal trace context. It does not create a replacement trace for a malformed internal carrier.
- A provider fake callback receives only the internal `traceparent` and creates a child span. The trusted adapter wrapper retains correlation locally for that span and never forwards tenant, session, correlation, conversation content or secret references to the callback.

## Structured log profile

M0 logs versioned event codes and closed operational attribute values only. Route templates, providers, components, operations, status, model versions and error codes come from code-owned registries. A `provider_request_ref` is minted locally from the provider span ID, and no raw provider request ID or provider-supplied reference is accepted. IDs that identify the authorized tenant, session, trace and correlation are emitted in dedicated fields.

Payloads, prompts, completions, transcripts, media, headers, cookies, SQL, actor identifiers, email, phone, CPF or CNPJ, raw exception messages and stacks are rejected by construction. Redaction remains a second protection layer. For `restricted` data, the record keeps only the data classification and `payload_omitted=true`.

## Trace model per turn

```text
turn.commit
  context.compose
  model.request
    model.first_output
  action.evaluate
  tts.request
    tts.first_audio
  avatar.publish
  channel.publish
turn.complete
```

Cancellation and late result spans are retained to diagnose wasted cost.

## Metrics

### Technical
- session join success;
- EOT to first audio and first frame;
- barge-in stop;
- jitter, packet loss and reconnect;
- provider latency, error and circuit state;
- mailbox depth;
- workflow retry and DLQ.

### Human presence
- overlap rate;
- false interruption rate;
- long silence rate;
- average reply length;
- repeated behavior directive rate;
- avatar voice mismatch;
- user-requested repetitions.

### Quality and safety
- unsupported claim rate;
- policy blocks;
- action announced before receipt;
- disclosure coverage;
- consent mismatch;
- cross-tenant test failures;
- handoff success.

### Business and economics
- qualified sessions;
- next-step rate;
- influenced revenue;
- cost per connected minute;
- cost per spoken minute;
- gross margin by tenant and channel;
- speculative model waste.

## Dashboards

1. Realtime health.
2. Provider and cost.
3. Session quality.
4. Safety and compliance.
5. Sales pack outcomes.
6. Workflows and Axtro Agent.

## M1 release alerts

M1 evaluates these conditions deterministically in tests and release gates. It
does not deploy a pager, hosted dashboard or production alert transport.

| Code | Condition | Severity | Safe response |
|---|---|---|---|
| `tenant_isolation_regression` | any cross-tenant negative test returns data, changes foreign state or performs a secondary console read | Critical | block release and disable the affected read or write path |
| `one_mouth_violation` | more than one Presenter speaks, or a Presenter does not own the active floor | Critical | block release and stop the Presenter publication path |
| `action_receipt_violation` | an action is confirmed without policy allow, successful receipt and effect hash, or a candidate is published automatically | Critical | block release and keep the action effect unconfirmed |
| `sensitive_telemetry_detected` | a token, synthetic turn text, secret handle or restricted payload marker reaches telemetry or a release artifact | Critical | block release and discard the unsafe artifact |
| `outbox_delivery_exhausted` | a delivery reaches dead letter, exceeds its pinned attempt budget or duplicates the timeline or workflow effect | High | stop the affected aggregate lane and retain the PII-free receipt for review |
| `workflow_terminal_failure` | the deterministic post-call run does not finish its four checkpoints or reports an external follow-up effect | High | keep follow-up disabled and block the milestone gate |
| `fake_cost_baseline_drift` | the nominal M1 catalog lookup differs from USD 0.02 estimated, or measured or provider-reported cost appears | High | block golden promotion and review cost attribution |

Alert transport, SLO windows and operator routing require a later deployment
decision. Their absence in M1 cannot weaken the blocking local conditions.

## Sampling

100% for errors, policy violations, action writes and pilot sessions. Lower sampling may apply to ordinary media spans at scale, preserving aggregated metrics.
