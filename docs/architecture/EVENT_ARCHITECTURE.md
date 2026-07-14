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

M0: transactional outbox plus relay to Redis Streams or equivalent. Workflow commands are not inferred from arbitrary event text; consumers map explicit event type to workflow start.

## Ordering

Ordering is guaranteed only per aggregate key. Consumers must not assume global order. `aggregate_version` prevents missing or duplicate state transitions.

## Retention

Event metadata may outlive payload. Sensitive payload can be encrypted separately or replaced by deletion tombstone while retaining integrity metadata.
