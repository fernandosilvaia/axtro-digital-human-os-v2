# Durable Workflow Architecture

## Por que separado de eventos

Event stream distribui fatos. Workflow engine mantém timers, retries, state, compensações e long-running orchestration.

## Workflows iniciais

### PreCallPreparation
Lead recebido → briefing → provider warm-up → readiness check → session ready.

### PostCallProcessing
Session completed → deterministic summary → structural evaluation → no-effect follow-up guard → finalize.

M1 implements only this closed fake profile. CRM update, follow-up draft or send, provider work and cost reconciliation remain later workflows and require their own governed contracts.

### HandoffEscalation
Request → notify candidates → timer → accept → presenter swap ou fallback scheduled.

### DataDeletion
Request validated → graph plan → delete active stores → provider delete → tombstone → backup expiry tracking.

### ExperimentPromotion
Candidate → offline eval → shadow → canary → metrics gate → promotion ou rollback.

## Engine

ADR-029 defers engine selection. M1 uses a deterministic injected store and one-step `runOnce` worker to prove checkpoint, lease, fencing, retry, cancellation and replacement-worker resume. The store owns the trusted clock; a worker cannot supply claim or completion timestamps. Only the explicit retryable activity error schedules another attempt, while source, policy and internal failures terminate with closed codes. M1 does not claim survival after process, machine or store loss. Temporal or an equivalent remains a candidate only after adapter contract tests, benchmark evidence and operational review; the domain cannot depend on an engine SDK.

## Regras

- activities idempotentes;
- retries classificados por erro;
- non-retryable para policy denied;
- compensation explícita onde efeito é reversível;
- workflow IDs determinísticos;
- PII mínima no history, preferindo references.
- dispatch, execution and observation use separate least-privilege scopes;
- command derivado server-side de um `session.completed` canônico;
- um checkpoint por `runOnce`, sem scan global de tenants;
- nenhum efeito externo confirmado sem `ActionIntent`, `PolicyDecision` e `ToolExecutionReceipt`.
