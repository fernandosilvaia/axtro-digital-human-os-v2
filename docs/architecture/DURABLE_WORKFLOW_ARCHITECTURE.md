# Durable Workflow Architecture

## Por que separado de eventos

Event stream distribui fatos. Workflow engine mantém timers, retries, state, compensações e long-running orchestration.

## Workflows iniciais

### PreCallPreparation
Lead recebido → briefing → provider warm-up → readiness check → session ready.

### PostCallProcessing
Session completed → summary → extraction → CRM update → follow-up draft/send policy → eval → cost reconciliation.

### HandoffEscalation
Request → notify candidates → timer → accept → presenter swap ou fallback scheduled.

### DataDeletion
Request validated → graph plan → delete active stores → provider delete → tombstone → backup expiry tracking.

### ExperimentPromotion
Candidate → offline eval → shadow → canary → metrics gate → promotion ou rollback.

## Engine

Preferência proposta: Temporal ou equivalente com durable timers e typed workflows. M0 pode usar interface fake e implementação simples de job queue, mas domínio não deve acoplar-se ao engine.

## Regras

- activities idempotentes;
- retries classificados por erro;
- non-retryable para policy denied;
- compensation explícita onde efeito é reversível;
- workflow IDs determinísticos;
- PII mínima no history, preferindo references.
