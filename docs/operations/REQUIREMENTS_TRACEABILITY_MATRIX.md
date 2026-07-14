# Requirements Traceability Matrix

This matrix covers P0 requirements at architecture level. Task IDs reference `backlog/MVP_TASK_GRAPH.yaml`.

| Requirement | Component | Contract | Data | Task | Test | Metric/Fallback |
|---|---|---|---|---|---|---|
| REQ-SESSION-001 | Session Actor | interaction_session_state | sessions/timeline | M1-01 | state machine E2E | invalid transition count |
| REQ-SESSION-002 | Floor Manager | handoff_packet | sessions.active_presenter | M1-02 | CAS concurrency | presenter conflict; fail closed |
| REQ-SESSION-003 | Channel ports | provider_capability | provider catalog | M2-01 | adapter contract | native fake fallback |
| REQ-RT-001 | Turn Coordinator | conversation_state | conversation turns | M2-02 | replay suite | false endpoint rate |
| REQ-RT-002 | Cancellation | session_health_state | timeline | M2-03 | delayed output | barge-in p95; hard mute |
| REQ-RT-003 | Model Gateway | provider_capability | deployments | M2-04 | dual adapter | switch to modular |
| REQ-RT-004 | Cognitive Fabric | agent_suggestion | timeline refs | M1-03 | daemon kill | ignore async lanes |
| REQ-STATE-001 | Reducers | interaction_session_state/event_envelope | snapshots/timeline | M0-04 | replay hash | rebuild from timeline |
| REQ-STATE-002 | Role architecture | role_state/sales_state | role states | M0-05 | no-sales kernel test | remove pack |
| REQ-STATE-003 | Quality state | interaction_quality_state | session state | M1-04 | evidence validation | omit low confidence |
| REQ-COG-001 | One Mouth | specialist_result | active presenter | M2-05 | no media publish | block specialist output |
| REQ-PRES-001 | Behavior Director | behavior_directive | timeline | M2-06 | directive policy | neutral fallback |
| REQ-PRES-002 | Scene Director | scene_manifest/scene_directive | scene versions | M2-07 | origin injection | avatar fallback |
| REQ-PRES-003 | Avatar adapter | provider_capability | session health | M2-08 | provider crash | voice-only |
| REQ-PRIV-001 | Disclosure gate | disclosure_record | disclosure records | M1-05 | session activation | block activation |
| REQ-PRIV-002 | Consent engine | consent_evidence | consents | M1-06 | purpose matrix | disable capability |
| REQ-PRIV-003 | Perception | perception_signal/derived_hypothesis | timeline | M2-09 | expiry | discard expired |
| REQ-ACT-001 | Action Runtime | tool_contract/action_intent | tool registry | M1-07 | unknown tool | deny |
| REQ-ACT-002 | Execution ledger | tool_execution_receipt | tool executions | M1-08 | retry storm | return prior receipt |
| REQ-ACT-003 | Presenter gate | receipt | timeline | M1-09 | announcement eval | state pending |
| REQ-HANDOFF-001 | Floor Manager | handoff_packet | handoffs | M3-05 | concurrent accept | single winner |
| REQ-TENANT-001 | RLS | all tenant contracts | tenant tables | M0-06 | cross-tenant suite | build fails |
| REQ-TENANT-002 | Context middleware | event envelope | DB/cache | M0-07 | pool/cache collision | clear context |
| REQ-SEC-001 | Context Composer | source metadata | knowledge | M1-10 | RAG injection | ignore commands |
| REQ-SEC-002 | Secret broker | provider connection ref | secret refs | M0-08 | secret scan | block build |
| REQ-OBS-001 | OTel conventions | event envelope | logs/traces | M0-09 | correlation test | reject missing |
| REQ-OBS-002 | Cost ledger | cost_event | cost events | M1-11 | reconciliation | budget degrade |
| REQ-OBS-003 | Health manager | session_health_state | health | M2-10 | threshold chaos | degradation mode |
| REQ-AXTRO-001 | Axtro Bridge | agent_suggestion | outbox/bridge | M1-12 | sync dependency scan | daemon disabled |
