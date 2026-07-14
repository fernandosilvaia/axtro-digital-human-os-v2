# Implementation Plan

The executable source is `backlog/MVP_TASK_GRAPH.yaml`. This document explains sequencing.

## Workstreams

A. Repository and contracts.
B. Tenancy, data and security.
C. Realtime kernel and fakes.
D. Native room and presence.
E. Action, workflow and Axtro bridge.
F. UI, observability and evaluation.

## Sequence

### M0
1. Bootstrap repo and CI.
2. Install contract validation and type generation.
3. Implement domain state and reducers.
4. Implement database and RLS.
5. Implement provider ports and fakes.
6. Add observability and config.
7. Add security and secret gates.

### M1
1. Session API and Session Actor fake.
2. Text turn driver and context composer.
3. Action Runtime read-only fake.
4. Outbox and relay.
5. Post-call workflow fake.
6. Console timeline.
7. E2E and replay evidence.

### M2
1. Channel adapter and native room.
2. Turn Coordinator harness.
3. Modular voice adapter.
4. S2S experiment adapter.
5. Behavior Director.
6. Avatar adapter and fake.
7. Scene Director and safe presentation.
8. Specialist Fabric.
9. Failure and cost report.

### M3
Sales Role Pack, RAG, handoff, CRM-lite, scheduling, evals and internal pilot.

## PR discipline

One coherent task per PR. Schema, generated types and consumer updates stay in the same PR. Do not parallelize writes to shared domain files without worktrees and ownership assignment.
