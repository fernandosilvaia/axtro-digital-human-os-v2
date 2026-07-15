# Requirements Traceability Matrix

This matrix covers P0 requirements at architecture level. Task IDs reference `backlog/MVP_TASK_GRAPH.yaml`.

| Requirement | Component | Contract | Data | Task | Test | Metric/Fallback |
|---|---|---|---|---|---|---|
| REQ-SESSION-001 | Session lifecycle application | interaction_session_state/event_envelope | sessions/timeline/outbox | M1-01 | OpenAPI-backed lifecycle API, CAS, idempotency, deadline and timeline tests | invalid transition, stale command or expiry produces no state write |
| REQ-SESSION-002 | Session Actor Floor Manager projection | event_envelope | hot actor state plus canonical timeline | M1-02 | canonical concurrent delivery, duplicate event, bounded historical replay, source deadline and presenter CAS reducer tests | version, presenter, source timeout or replay flood fails closed without media publish |
| REQ-SESSION-003 | Channel ports | provider_capability | provider catalog | M2-01 | adapter contract | native fake fallback |
| REQ-RT-001 | Turn Coordinator | conversation_state | conversation turns | M2-02 | replay suite | false endpoint rate |
| REQ-RT-002 | Cancellation | session_health_state | timeline | M2-02 | delayed output | barge-in p95; hard mute |
| REQ-RT-003 | Model Gateway | provider_capability | deployments | M2-04 | dual adapter | switch to modular |
| REQ-RT-004 | Textual Turn Driver Fast Lane | turn_submission/turn_committed | canonical timeline | M1-03 | deterministic three-turn, timeout, cancellation and late-output tests | local fake stays independent from daemon and specialists |
| REQ-STATE-001 | Reducers | interaction_session_state/event_envelope | snapshots/timeline | M0-05 | replay hash | rebuild from timeline |
| REQ-STATE-002 | Role architecture | role_state/sales_state | role states | M0-05 | no-sales kernel test | remove pack |
| REQ-STATE-003 | Quality state | interaction_quality_state | session state | M0-05 | evidence validation | omit low confidence |
| REQ-COG-001 | One Mouth | specialist_result | active presenter | M2-08 | no media publish | block specialist output |
| REQ-PRES-001 | Behavior Director | behavior_directive | timeline | M2-05 | directive policy | neutral fallback |
| REQ-PRES-002 | Scene Director | scene_manifest/scene_directive | scene versions | M2-07 | origin injection | avatar fallback |
| REQ-PRES-003 | Avatar adapter | provider_capability | session health | M2-06 | provider crash | voice-only |
| REQ-PRIV-001 | Session lifecycle application | disclosure_record | disclosure records/timeline | M1-01 | deterministic delivery receipt, record proof and channel-policy negative tests | block activation and readiness before receipt |
| REQ-PRIV-002 | Session lifecycle application | consent_evidence | consents/timeline | M1-01 | server-side essential consent policy | disable capability |
| REQ-PRIV-003 | Perception | perception_signal/derived_hypothesis | timeline | M2-09 | expiry | discard expired |
| REQ-ACT-001 | Action Runtime | tool_contract/action_intent | tool registry | M0-14 | unknown tool | deny |
| REQ-ACT-002 | Execution ledger | action_intent/policy_decision/tool_execution_receipt/catalog_lookup_command | bounded action ledger | M0-14, M1-05 | replay, capacity, unknown and authenticated reconciliation | return prior receipt; block retry until reconciliation |
| REQ-ACT-003 | Receipt-backed catalog coordinator | tool_execution_receipt/catalog_lookup_command | candidate only, no timeline write | M1-05 | successful receipt citation and non-success no-confirmation | no automatic speech or state change |
| REQ-HANDOFF-001 | Floor Manager | handoff_packet | handoffs | M3-06 | concurrent accept | single winner |
| REQ-TENANT-001 | RLS | all tenant contracts | tenant tables | M0-08 | cross-tenant suite | build fails |
| REQ-TENANT-002 | Context middleware | event envelope | DB/cache | M0-09 | pool/cache collision | clear context |
| REQ-SEC-001 | Context Composer | context_composition | authorized opaque projected state and approved knowledge | M1-04 | byte budget, strict TTL, provenance, tenant, snapshot, injection and trusted-clock freshness suite | omit untrusted or stale source; no synchronous Agent or RAG |
| REQ-SEC-002 | Secret broker | provider connection ref | secret refs | M0-06 | secret scan | block build |
| REQ-OBS-001 | OTel conventions | event envelope | logs/traces | M0-10 | correlation test | reject missing |
| REQ-OBS-002 | Cost ledger | cost_event | cost events | M0-16 | deterministic decimal reconciliation, precision rejection, source buckets, request capability binding and cross-tenant denial | budget degrade; no invoice integration in M0 |
| REQ-OBS-003 | Health manager | session_health_state | health | M2-10 | threshold chaos | degradation mode |
| REQ-AXTRO-001 | Textual Turn Driver boundary | turn_submission/turn_committed | canonical timeline | M1-03 | static dependency scan and fake-only Fast Lane tests | no synchronous Axtro Agent bridge |
