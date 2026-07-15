# Event Architecture

## Princípios

- fatos no passado;
- envelope versionado;
- outbox na mesma transação do aggregate;
- consumers idempotentes;
- correlation e causation obrigatórios;
- PII por referência sempre que possível.

## Envelope

`event_envelope` contém event ID, type, version, occurred_at, tenant, session, producer, trace, correlation, causation, classification e payload.

## Domínios e eventos iniciais

### Session
`session.created`, `session.prepared`, `session.activated`, `session.degraded`, `session.completed`, `session.failed`.

### Conversation
`turn.started`, `turn.committed`, `turn.interrupted`, `turn.response_started`, `turn.response_completed`.

M1-03 materializes `turn.committed` for both the authorized participant and
the active Presenter. Its explicit payload carries the speaker participant ID,
speaker role, restricted transcript text, generation ID, and structured
conversation patch. The reducer accepts a Presenter turn only when its speaker
matches the active floor. `turn.interrupted` remains a canonical marker after
the runtime safety lane has fenced the generation.

### Presenter and handoff
`presenter.floor_requested`, `presenter.changed`, `handoff.requested`, `handoff.accepted`, `handoff.expired`.

### Actions
`action.requested`, `action.authorized`, `action.denied`, `tool.started`, `tool.succeeded`, `tool.failed`, `tool.unknown`.

### Scene and behavior
`scene.changed`, `behavior.changed`, `avatar.degraded`.

### Governance
`consent.recorded`, `disclosure.delivered`, `policy.violation_detected`, `budget.threshold_reached`.

### Workflow and learning
`workflow.started`, `workflow.completed`, `evaluation.completed`, `experiment.candidate_created`, `deployment.promoted`, `deployment.rolled_back`.

## Delivery

M0: transactional outbox plus a deterministic local relay seam. The repository commits reduced aggregate state and a canonical envelope together, and materializes `event_id` for tenant-scoped deduplication. The database rejects envelopes whose event or tenant identity differs from the outbox row.

M1-07 adds a deterministic operational relay with one-event `runOnce`, tenant-scoped claims, bounded lease, historically single-use UUIDv7 fencing tokens, retry availability, maximum attempts and PII-free dead letters. The lease deadline is exclusive for acknowledgement and retry completion. The code-owned M1 registry accepts only `session-timeline`; the consumer reconciles tenant, session, event, aggregate version and canonical fingerprint before acknowledgement. The authoritative timeline is its idempotent effect ledger, so redelivery after an acknowledgement crash cannot duplicate state. A dead-lettered predecessor blocks only its aggregate. Receipt and `outbox.relay` telemetry preserve trace and correlation identity without payload; contract-valid trace IDs outside the 32-character W3C profile use a stable versioned hash normalization for spans while receipts retain the original value. The implementation has no broker, network, global tenant scan or PostgreSQL adapter and does not claim persistence across process loss. Workflow commands are not inferred from arbitrary event text; consumers map explicit event type to a future workflow start.

## Ordering

Ordering is guaranteed only per aggregate key. Consumers must not assume global order. `aggregate_version` prevents missing or duplicate state transitions.

## Retention

Event metadata may outlive payload. Sensitive payload can be encrypted separately or replaced by deletion tombstone while retaining integrity metadata.
