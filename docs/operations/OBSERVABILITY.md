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
- `provider` and `provider_request_id`.

PII is not a correlation field.

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

## Sampling

100% for errors, policy violations, action writes and pilot sessions. Lower sampling may apply to ordinary media spans at scale, preserving aggregated metrics.
