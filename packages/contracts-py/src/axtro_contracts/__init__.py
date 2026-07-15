"""Generated contract type declarations. Do not edit manually."""
from __future__ import annotations

from typing import Any, Literal, TypedDict

CONTRACT_GENERATOR_VERSION = '1.0.0'

# Source: contracts/schemas/action_intent.schema.json; schema: https://schemas.axtro.ai/v2/action_intent.schema.json; version: 2.0.0.
class ActionIntent(TypedDict):
    schema_version: Literal['2.0.0']
    intent_id: str
    session_id: str
    tenant_id: str
    actor_id: str
    actor_type: Literal['presenter', 'specialist', 'workflow', 'human_operator', 'axtro_agent']
    tool_contract_id: str
    action: str
    arguments_json: str
    purpose: str
    idempotency_key: str
    requested_at: str
    expires_at: str

# Source: contracts/schemas/agent_suggestion.schema.json; schema: https://schemas.axtro.ai/v2/agent_suggestion.schema.json; version: 2.0.0.
class AgentSuggestion(TypedDict):
    schema_version: Literal['2.0.0']
    suggestion_id: str
    session_id: str
    tenant_id: str
    source_agent_type: str
    suggestion_type: Literal['next_question', 'strategy', 'risk', 'handoff', 'scene', 'tool', 'fact_check']
    content: str
    confidence: float
    evidence_refs: list[str]
    priority: int
    created_at: str
    expires_at: str

# Source: contracts/schemas/behavior_directive.schema.json; schema: https://schemas.axtro.ai/v2/behavior_directive.schema.json; version: 2.0.0.
class BehaviorDirective(TypedDict):
    schema_version: Literal['2.0.0']
    directive_id: str
    session_id: str
    tenant_id: str
    target_presenter_id: str
    posture: Literal['neutral', 'listening', 'explaining', 'presenting', 'handoff']
    facial_expression: Literal['neutral_warm', 'attentive', 'light_smile', 'concerned', 'confident', 'none']
    gaze: Literal['camera', 'participant', 'content', 'neutral']
    gesture: Literal['none', 'micro_nod', 'single_nod', 'open_hand', 'settle']
    vocal_style: Literal['neutral', 'warm', 'calm', 'energetic', 'reassuring', 'concise']
    pause_ms: int
    duration_ms: int
    reason: str
    priority: int
    generated_at: str
    expires_at: str

# Source: contracts/schemas/consent_evidence.schema.json; schema: https://schemas.axtro.ai/v2/consent_evidence.schema.json; version: 2.0.0.
class ConsentEvidence(TypedDict):
    schema_version: Literal['2.0.0']
    consent_id: str
    session_id: str
    tenant_id: str
    subject_ref: str
    consent_type: Literal['essential_processing', 'recording', 'behavioral_analysis', 'emotion_inference', 'biometric_identity', 'marketing_contact', 'data_retention']
    purpose: str
    status: Literal['granted', 'denied', 'revoked', 'expired']
    method: Literal['spoken', 'click', 'written', 'signed', 'system_import']
    disclosure_version: str
    jurisdiction: str
    evidence_hash: str
    captured_at: str
    expires_at: str | None
    revoked_at: str | None

# Source: contracts/schemas/conversation_state.schema.json; schema: https://schemas.axtro.ai/v2/conversation_state.schema.json; version: 2.0.0.
class ConversationState(TypedDict):
    schema_version: Literal['2.0.0']
    session_id: str
    tenant_id: str
    turn_index: int
    active_topic: str | None
    language: str
    open_questions: list[str]
    confirmed_facts: list[dict[str, object]]
    repair_state: Literal['none', 'clarifying', 'recovering_interruption', 'recovering_tool_failure', 'recovering_connection']
    incremental_summary: str
    updated_at: str

# Source: contracts/schemas/cost_event.schema.json; schema: https://schemas.axtro.ai/v2/cost_event.schema.json; version: 2.0.0.
class _CostEventRequired(TypedDict):
    schema_version: Literal['2.0.0']
    cost_event_id: str
    tenant_id: str
    session_id: str | None
    provider_id: str
    service: str
    unit_type: Literal['minute', 'second', 'token', 'character', 'megabyte', 'request', 'seat', 'flat']
    quantity: float
    unit_cost_usd: float
    amount_usd: float
    currency: Literal['USD']
    source: Literal['measured', 'provider_reported', 'estimated']
    occurred_at: str

class CostEvent(_CostEventRequired, total=False):
    rate_card_ref: str | None
    rate_card_as_of: str | None
    reconciles_cost_event_id: str | None
    trace_id: str | None
    provider_request_ref: str | None

# Source: contracts/schemas/deployment_promotion.schema.json; schema: https://schemas.axtro.ai/v2/deployment_promotion.schema.json; version: 2.0.0.
class DeploymentPromotion(TypedDict):
    schema_version: Literal['2.0.0']
    promotion_id: str
    experiment_id: str
    tenant_id: str | None
    component: str
    from_version: str
    to_version: str
    environment: Literal['development', 'staging', 'canary', 'production']
    rollout_percentage: float
    decision: Literal['promote', 'hold', 'rollback', 'reject']
    decision_reasons: list[str]
    rollback_plan: str
    approved_by: str
    promoted_at: str

# Source: contracts/schemas/derived_hypothesis.schema.json; schema: https://schemas.axtro.ai/v2/derived_hypothesis.schema.json; version: 2.0.0.
class DerivedHypothesis(TypedDict):
    schema_version: Literal['2.0.0']
    hypothesis_id: str
    session_id: str
    tenant_id: str
    label: str
    statement: str
    evidence_signal_ids: list[str]
    confidence: float
    status: Literal['candidate', 'active', 'confirmed', 'rejected', 'expired']
    allowed_use: Literal['turn_strategy', 'clarification', 'accessibility', 'quality', 'safety', 'prohibited']
    created_at: str
    expires_at: str

# Source: contracts/schemas/disclosure_record.schema.json; schema: https://schemas.axtro.ai/v2/disclosure_record.schema.json; version: 2.0.0.
class DisclosureRecord(TypedDict):
    schema_version: Literal['2.0.0']
    disclosure_id: str
    session_id: str
    tenant_id: str
    disclosure_type: Literal['ai_identity', 'recording', 'data_use', 'regulated_scope', 'marketing_contact']
    version: str
    content_hash: str
    delivery_channel: Literal['spoken', 'visual', 'chat', 'email', 'signed_document']
    language: str
    delivered_at: str
    acknowledged: bool
    acknowledged_at: str | None

# Source: contracts/schemas/event_envelope.schema.json; schema: https://schemas.axtro.ai/v2/event_envelope.schema.json; version: 2.0.0.
class EventEnvelope(TypedDict):
    schema_version: Literal['2.0.0']
    event_id: str
    event_type: str
    event_version: int
    aggregate_type: str
    aggregate_id: str
    aggregate_version: int
    tenant_id: str
    session_id: str | None
    producer: str
    trace_id: str
    correlation_id: str
    causation_id: str | None
    data_classification: Literal['public', 'internal', 'confidential', 'restricted']
    payload_json: str
    occurred_at: str

# Source: contracts/schemas/experiment_candidate.schema.json; schema: https://schemas.axtro.ai/v2/experiment_candidate.schema.json; version: 2.0.0.
class ExperimentCandidate(TypedDict):
    schema_version: Literal['2.0.0']
    experiment_id: str
    scope_type: Literal['global', 'tenant', 'role_pack', 'agent']
    tenant_id: str | None
    component: str
    hypothesis: str
    baseline_version: str
    candidate_version: str
    target_metrics: list[str]
    guardrails: list[str]
    status: Literal['draft', 'simulating', 'shadow', 'canary', 'running', 'paused', 'completed', 'rejected']
    created_at: str

# Source: contracts/schemas/fake_provider_journal_entry.schema.json; schema: https://schemas.axtro.ai/v2/fake_provider_journal_entry.schema.json; version: 2.0.0.
class FakeProviderJournalEntry(TypedDict):
    schema_version: Literal['2.0.0']
    port_kind: Literal['channel', 'realtime_model', 'stt', 'tts', 'avatar', 'meeting', 'telephony', 'tool', 'storage']
    operation: Literal['channel.health', 'channel.estimateCost', 'channel.close', 'channel.open', 'channel.closeConnection', 'realtime_model.health', 'realtime_model.estimateCost', 'realtime_model.close', 'realtime_model.openSession', 'realtime_model.closeSession', 'stt.health', 'stt.estimateCost', 'stt.close', 'stt.transcribe', 'tts.health', 'tts.estimateCost', 'tts.close', 'tts.synthesize', 'avatar.health', 'avatar.estimateCost', 'avatar.close', 'avatar.render', 'meeting.health', 'meeting.estimateCost', 'meeting.close', 'meeting.join', 'meeting.leave', 'telephony.health', 'telephony.estimateCost', 'telephony.close', 'telephony.connect', 'telephony.disconnect', 'tool.health', 'tool.estimateCost', 'tool.close', 'storage.health', 'storage.estimateCost', 'storage.close', 'storage.read', 'storage.write']
    invocation: int
    sequence: int
    phase: Literal['started', 'partial', 'completed', 'failed', 'cancelled', 'timed_out']
    simulated_at_ms: int
    failure_code: Literal[None, 'invalid_configuration', 'authentication', 'rate_limited', 'capacity', 'timeout', 'transient_network', 'provider_internal', 'unsupported_capability', 'policy_blocked', 'budget_blocked', 'cancelled', 'unknown']

# Source: contracts/schemas/fake_provider_replay_descriptor.schema.json; schema: https://schemas.axtro.ai/v2/fake_provider_replay_descriptor.schema.json; version: 2.0.0.
class FakeProviderReplayDescriptor(TypedDict):
    schema_version: Literal['2.0.0']
    seed: str
    scenario_hash: str

# Source: contracts/schemas/fake_provider_scenario.schema.json; schema: https://schemas.axtro.ai/v2/fake_provider_scenario.schema.json; version: 2.0.0.
class _FakeProviderScenarioRequired(TypedDict):
    schema_version: Literal['2.0.0']
    seed: str

class FakeProviderScenario(_FakeProviderScenarioRequired, total=False):
    clock_start_ms: int
    plans: list[dict[str, object]]

# Source: contracts/schemas/handoff_packet.schema.json; schema: https://schemas.axtro.ai/v2/handoff_packet.schema.json; version: 2.0.0.
class HandoffPacket(TypedDict):
    schema_version: Literal['2.0.0']
    handoff_id: str
    session_id: str
    tenant_id: str
    from_presenter_id: str
    target_type: Literal['specific_human', 'team_queue', 'specialist_human', 'fallback_queue']
    target_id: str | None
    reason_code: str
    priority: Literal['normal', 'high', 'urgent']
    summary: str
    customer_context_json: str
    role_state_snapshot_json: str
    actions_completed: list[str]
    open_actions: list[str]
    requested_at: str
    expires_at: str

# Source: contracts/schemas/interaction_quality_state.schema.json; schema: https://schemas.axtro.ai/v2/interaction_quality_state.schema.json; version: 2.0.0.
class InteractionQualityState(TypedDict):
    schema_version: Literal['2.0.0']
    session_id: str
    tenant_id: str
    dimensions: list[dict[str, object]]
    aggregate_confidence: float
    updated_at: str

# Source: contracts/schemas/interaction_session_state.schema.json; schema: https://schemas.axtro.ai/v2/interaction_session_state.schema.json; version: 2.0.0.
class InteractionSessionState(TypedDict):
    schema_version: Literal['2.0.0']
    session_id: str
    tenant_id: str
    agent_id: str
    status: Literal['preparing', 'ready', 'active', 'handoff_pending', 'completed', 'failed']
    active_presenter_id: str | None
    channel: dict[str, object]
    state_version: int
    consent_status: Literal['not_required', 'pending', 'granted', 'denied', 'revoked']
    disclosure_status: Literal['pending', 'delivered', 'acknowledged', 'failed']
    capabilities: dict[str, object]
    degradation_level: Literal['none', 'minor', 'major', 'voice_only', 'text_only', 'terminated']
    started_at: str | None
    updated_at: str

# Source: contracts/schemas/perception_signal.schema.json; schema: https://schemas.axtro.ai/v2/perception_signal.schema.json; version: 2.0.0.
class PerceptionSignal(TypedDict):
    schema_version: Literal['2.0.0']
    signal_id: str
    session_id: str
    tenant_id: str
    modality: Literal['audio', 'text', 'video', 'screen', 'interaction', 'technical']
    signal_type: str
    observed_value_json: str
    source: str
    confidence: float
    evidence_ref: str
    occurred_at: str
    expires_at: str
    consent_scope: Literal['essential_processing', 'recording', 'behavioral_analysis', 'emotion_inference', 'biometric_identity', 'technical_quality']
    allowed_use: Literal['turn_taking', 'accessibility', 'quality', 'personalization', 'safety', 'prohibited']

# Source: contracts/schemas/policy_decision.schema.json; schema: https://schemas.axtro.ai/v2/policy_decision.schema.json; version: 2.0.0.
class PolicyDecision(TypedDict):
    schema_version: Literal['2.0.0']
    decision_id: str
    intent_id: str
    tenant_id: str
    outcome: Literal['allow', 'deny', 'require_approval']
    reasons: list[str]
    obligations: list[str]
    policy_version: str
    evaluated_at: str
    expires_at: str

# Source: contracts/schemas/pre_call_briefing.schema.json; schema: https://schemas.axtro.ai/v2/pre_call_briefing.schema.json; version: 2.0.0.
class PreCallBriefing(TypedDict):
    schema_version: Literal['2.0.0']
    briefing_id: str
    session_id: str
    tenant_id: str
    lead_ref: str | None
    purpose: str
    known_facts: list[dict[str, object]]
    hypotheses: list[str]
    recommended_plan: list[str]
    approved_material_ids: list[str]
    tool_grants: list[str]
    risk_notes: list[str]
    created_at: str
    expires_at: str

# Source: contracts/schemas/provider_capability.schema.json; schema: https://schemas.axtro.ai/v2/provider_capability.schema.json; version: 2.0.0.
class ProviderCapability(TypedDict):
    schema_version: Literal['2.0.0']
    provider_id: str
    provider_type: Literal['realtime_model', 'stt', 'tts', 'avatar', 'meeting', 'telephony', 'database', 'observability', 'channel', 'tool', 'storage']
    capability: str
    version: str
    supported_regions: list[str]
    languages: list[str]
    max_session_minutes: int
    supports_streaming: bool
    supports_barge_in: bool
    supports_data_residency: bool
    latency_class: Literal['ultra_low', 'low', 'medium', 'batch']
    cost_model_ref: str
    status: Literal['candidate', 'approved', 'fallback', 'deprecated', 'disabled']
    evaluated_at: str

# Source: contracts/schemas/provider_registry_entry.schema.json; schema: https://schemas.axtro.ai/v2/provider_registry_entry.schema.json; version: 2.0.0.
class ProviderRegistryEntry(TypedDict):
    schema_version: Literal['2.0.0']
    port_kind: Literal['channel', 'realtime_model', 'stt', 'tts', 'avatar', 'meeting', 'telephony', 'tool', 'storage']
    provider_mode: Literal['fake']
    provider_capabilities: list[ProviderCapability]
    default_timeout_ms: int
    supports_cancellation: bool
    health_status: Literal['healthy', 'degraded', 'unavailable', 'unknown']
    circuit_state: Literal['closed', 'open', 'half_open']
    fallback_provider_ids: list[str]

# Source: contracts/schemas/role_pack_manifest.schema.json; schema: https://schemas.axtro.ai/v2/role_pack_manifest.schema.json; version: 2.0.0.
class RolePackManifest(TypedDict):
    schema_version: Literal['2.0.0']
    role_pack_id: str
    name: str
    version: str
    role_type: str
    description: str
    state_schema_ref: str
    allowed_skill_pack_ids: list[str]
    required_disclosures: list[str]
    default_policies: list[str]
    supported_languages: list[str]
    status: Literal['draft', 'active', 'deprecated', 'disabled']
    checksum: str

# Source: contracts/schemas/role_state.schema.json; schema: https://schemas.axtro.ai/v2/role_state.schema.json; version: 2.0.0.
class RoleState(TypedDict):
    schema_version: Literal['2.0.0']
    session_id: str
    tenant_id: str
    role_pack_id: str
    role_pack_version: str
    objective: str
    stage: str
    milestones: list[dict[str, object]]
    missing_fields: list[str]
    next_best_action: dict[str, object]
    updated_at: str

# Source: contracts/schemas/runtime_configuration.schema.json; schema: https://schemas.axtro.ai/v2/runtime_configuration.schema.json; version: 2.0.0.
class RuntimeConfiguration(TypedDict):
    schema_version: Literal['2.0.0']
    environment: Literal['development', 'test', 'staging', 'canary', 'production']
    service_name: Literal['api', 'realtime-worker', 'axtro-supervisor', 'meeting-bot-worker', 'workflow-worker']
    provider_mode: Literal['fake']
    secret_broker_handle: str
    port: int
    request_timeout_ms: int
    dev_auth_enabled: bool
    log_level: Literal['debug', 'info', 'warn', 'error']

# Source: contracts/schemas/sales_state.schema.json; schema: https://schemas.axtro.ai/v2/sales_state.schema.json; version: 2.0.0.
class SalesState(TypedDict):
    schema_version: Literal['2.0.0']
    session_id: str
    tenant_id: str
    funnel_stage: Literal['opening', 'discovery', 'qualification', 'solution_fit', 'demonstration', 'objection_handling', 'proposal', 'commitment', 'follow_up', 'closed_won', 'closed_lost']
    methodology: str
    qualification: list[dict[str, object]]
    objections: list[dict[str, object]]
    proposal_status: Literal['not_started', 'drafting', 'presented', 'revising', 'accepted', 'rejected', 'expired']
    conversion_probability: float
    next_step: str | None
    updated_at: str

# Source: contracts/schemas/scene_directive.schema.json; schema: https://schemas.axtro.ai/v2/scene_directive.schema.json; version: 2.0.0.
class SceneDirective(TypedDict):
    schema_version: Literal['2.0.0']
    directive_id: str
    session_id: str
    tenant_id: str
    scene_id: str
    command: Literal['open', 'update', 'focus', 'close']
    bindings_json: str
    requested_by: str
    priority: int
    issued_at: str
    expires_at: str

# Source: contracts/schemas/scene_manifest.schema.json; schema: https://schemas.axtro.ai/v2/scene_manifest.schema.json; version: 2.0.0.
class SceneManifest(TypedDict):
    schema_version: Literal['2.0.0']
    scene_id: str
    tenant_id: str
    name: str
    version: str
    scene_type: Literal['avatar_full', 'avatar_with_slides', 'comparison', 'calculator', 'proposal', 'web_demo', 'handoff', 'error']
    allowed_components: list[str]
    data_bindings: list[dict[str, object]]
    allowed_roles: list[str]
    max_duration_seconds: int
    requires_consent: bool
    checksum: str
    status: Literal['draft', 'active', 'deprecated', 'disabled']

# Source: contracts/schemas/session_health_state.schema.json; schema: https://schemas.axtro.ai/v2/session_health_state.schema.json; version: 2.0.0.
class SessionHealthState(TypedDict):
    schema_version: Literal['2.0.0']
    session_id: str
    tenant_id: str
    overall_status: Literal['healthy', 'degraded', 'critical', 'terminated']
    degradation_level: Literal['none', 'minor', 'major', 'voice_only', 'text_only', 'terminated']
    metrics: dict[str, object]
    provider_statuses: list[dict[str, object]]
    active_incidents: list[str]
    updated_at: str

# Source: contracts/schemas/skill_pack_manifest.schema.json; schema: https://schemas.axtro.ai/v2/skill_pack_manifest.schema.json; version: 2.0.0.
class SkillPackManifest(TypedDict):
    schema_version: Literal['2.0.0']
    skill_pack_id: str
    name: str
    version: str
    description: str
    capabilities: list[str]
    tool_contract_ids: list[str]
    input_schema_ref: str
    output_schema_ref: str
    risk_class: Literal['read_public', 'read_tenant', 'read_pii', 'write_low', 'write_high', 'financial', 'irreversible']
    supported_role_types: list[str]
    status: Literal['draft', 'active', 'deprecated', 'disabled']
    checksum: str

# Source: contracts/schemas/specialist_request.schema.json; schema: https://schemas.axtro.ai/v2/specialist_request.schema.json; version: 2.0.0.
class SpecialistRequest(TypedDict):
    schema_version: Literal['2.0.0']
    request_id: str
    session_id: str
    tenant_id: str
    specialist_type: str
    question: str
    context_json: str
    required_output_schema_ref: str
    priority: Literal['low', 'normal', 'high', 'urgent']
    deadline_at: str
    requested_at: str

# Source: contracts/schemas/specialist_result.schema.json; schema: https://schemas.axtro.ai/v2/specialist_result.schema.json; version: 2.0.0.
class SpecialistResult(TypedDict):
    schema_version: Literal['2.0.0']
    result_id: str
    request_id: str
    session_id: str
    tenant_id: str
    status: Literal['completed', 'partial', 'failed', 'expired']
    answer: str
    claims: list[dict[str, object]]
    recommended_actions: list[str]
    completed_at: str
    expires_at: str

# Source: contracts/schemas/tool_contract.schema.json; schema: https://schemas.axtro.ai/v2/tool_contract.schema.json; version: 2.0.0.
class ToolContract(TypedDict):
    schema_version: Literal['2.0.0']
    contract_id: str
    version: str
    tool_name: str
    tenant_scope: Literal['global_catalog', 'tenant_installation', 'session_grant']
    risk_class: Literal['read_public', 'read_tenant', 'read_pii', 'write_low', 'write_high', 'financial', 'irreversible']
    input_schema_ref: str
    output_schema_ref: str
    timeout_ms: int
    idempotency_required: bool
    human_approval: Literal['never', 'policy_based', 'always']
    allowed_actors: list[str]
    data_classification: Literal['public', 'internal', 'confidential', 'restricted']
    side_effects: Literal['none', 'reversible', 'compensatable', 'irreversible']
    status: Literal['draft', 'active', 'deprecated', 'disabled']

# Source: contracts/schemas/tool_execution_receipt.schema.json; schema: https://schemas.axtro.ai/v2/tool_execution_receipt.schema.json; version: 2.0.0.
class ToolExecutionReceipt(TypedDict):
    schema_version: Literal['2.0.0']
    execution_id: str
    intent_id: str
    tenant_id: str
    status: Literal['started', 'succeeded', 'failed', 'pending', 'unknown', 'cancelled']
    provider_id: str
    attempt: int
    result_json: str | None
    error: (dict[str, object]) | (None)
    effect_hash: str | None
    started_at: str
    completed_at: str | None

# Source: contracts/schemas/turn_committed.schema.json; schema: https://schemas.axtro.ai/v2/turn_committed.schema.json; version: 2.0.0.
class TurnCommitted(TypedDict):
    schema_version: Literal['2.0.0']
    speaker_participant_id: str
    speaker_role: Literal['participant', 'presenter']
    transcript_text: str
    generation_id: int | None
    turn_index: int
    active_topic: str | None
    language: str
    open_questions: list[str]
    confirmed_facts: list[dict[str, object]]
    repair_state: Literal['none', 'clarifying', 'recovering_interruption', 'recovering_tool_failure', 'recovering_connection']
    incremental_summary: str

# Source: contracts/schemas/turn_submission.schema.json; schema: https://schemas.axtro.ai/v2/turn_submission.schema.json; version: 2.0.0.
class TurnSubmission(TypedDict):
    schema_version: Literal['2.0.0']
    speaker_participant_id: str
    text: str
    language: str
    client_turn_id: str

# Source: contracts/schemas/workflow_command.schema.json; schema: https://schemas.axtro.ai/v2/workflow_command.schema.json; version: 2.0.0.
class WorkflowCommand(TypedDict):
    schema_version: Literal['2.0.0']
    command_id: str
    tenant_id: str
    workflow_type: str
    workflow_version: str
    aggregate_type: str
    aggregate_id: str
    input_json: str
    idempotency_key: str
    requested_by: str
    scheduled_at: str
    created_at: str

# Source: contracts/schemas/workflow_status.schema.json; schema: https://schemas.axtro.ai/v2/workflow_status.schema.json; version: 2.0.0.
class WorkflowStatus(TypedDict):
    schema_version: Literal['2.0.0']
    workflow_run_id: str
    command_id: str
    tenant_id: str
    status: Literal['queued', 'running', 'waiting', 'completed', 'failed', 'cancelled', 'compensating']
    current_step: str
    attempts: int
    last_error: (dict[str, object]) | (None)
    started_at: str | None
    updated_at: str
    completed_at: str | None

CONTRACT_METADATA: dict[str, dict[str, str]] = {
  "ActionIntent": {
    "schema_id": "https://schemas.axtro.ai/v2/action_intent.schema.json",
    "schema_version": "2.0.0",
    "source_hash": "d9016a1aa668c7896840ba40a1b4c5f906fba6e5421c0dd964900c4ac758162a",
    "source_schema": "contracts/schemas/action_intent.schema.json"
  },
  "AgentSuggestion": {
    "schema_id": "https://schemas.axtro.ai/v2/agent_suggestion.schema.json",
    "schema_version": "2.0.0",
    "source_hash": "e7a215bd1003b7f9bf2c6f6cea7474986546ece45e7aab5e80f07d65a8abdf33",
    "source_schema": "contracts/schemas/agent_suggestion.schema.json"
  },
  "BehaviorDirective": {
    "schema_id": "https://schemas.axtro.ai/v2/behavior_directive.schema.json",
    "schema_version": "2.0.0",
    "source_hash": "c39247db6b39501972745ca9e0920416751e92bbdeb1c83f7b3445405fe7454c",
    "source_schema": "contracts/schemas/behavior_directive.schema.json"
  },
  "ConsentEvidence": {
    "schema_id": "https://schemas.axtro.ai/v2/consent_evidence.schema.json",
    "schema_version": "2.0.0",
    "source_hash": "5d5fb9efb2451d34c774ef614ec6a0e499a288bc1e4d9c56de6574111f3b90a7",
    "source_schema": "contracts/schemas/consent_evidence.schema.json"
  },
  "ConversationState": {
    "schema_id": "https://schemas.axtro.ai/v2/conversation_state.schema.json",
    "schema_version": "2.0.0",
    "source_hash": "c71e46f815a16e256efd8088a9a598797e22fe2f31fc4e375e2d2daa32baeeec",
    "source_schema": "contracts/schemas/conversation_state.schema.json"
  },
  "CostEvent": {
    "schema_id": "https://schemas.axtro.ai/v2/cost_event.schema.json",
    "schema_version": "2.0.0",
    "source_hash": "bed4a4a890ed8779b0ac9b79a392aec01f31eb8bea68ab038beab1f5a9e75e98",
    "source_schema": "contracts/schemas/cost_event.schema.json"
  },
  "DeploymentPromotion": {
    "schema_id": "https://schemas.axtro.ai/v2/deployment_promotion.schema.json",
    "schema_version": "2.0.0",
    "source_hash": "8d1c3c47a74a1c9780c0a82fa34c8852dc8eff2aa1403a7cf321064f31b7de5f",
    "source_schema": "contracts/schemas/deployment_promotion.schema.json"
  },
  "DerivedHypothesis": {
    "schema_id": "https://schemas.axtro.ai/v2/derived_hypothesis.schema.json",
    "schema_version": "2.0.0",
    "source_hash": "bb6806f1a36a6a462a6f553322c1620bec221955577b1e67173a52d4cbeee736",
    "source_schema": "contracts/schemas/derived_hypothesis.schema.json"
  },
  "DisclosureRecord": {
    "schema_id": "https://schemas.axtro.ai/v2/disclosure_record.schema.json",
    "schema_version": "2.0.0",
    "source_hash": "dd9af87ab35fbb75b8e22e1a410fff482daeb94cede48d9ffa94cf6fbaac6815",
    "source_schema": "contracts/schemas/disclosure_record.schema.json"
  },
  "EventEnvelope": {
    "schema_id": "https://schemas.axtro.ai/v2/event_envelope.schema.json",
    "schema_version": "2.0.0",
    "source_hash": "364ea2393c98d7d64a671d0aefe4ca14d5f9dddf129e52fbc0f2babcb00e5e1b",
    "source_schema": "contracts/schemas/event_envelope.schema.json"
  },
  "ExperimentCandidate": {
    "schema_id": "https://schemas.axtro.ai/v2/experiment_candidate.schema.json",
    "schema_version": "2.0.0",
    "source_hash": "cfb4900584410e685deb371923cb51b36d0478e4471a81762478b22ce3c93c6c",
    "source_schema": "contracts/schemas/experiment_candidate.schema.json"
  },
  "FakeProviderJournalEntry": {
    "schema_id": "https://schemas.axtro.ai/v2/fake_provider_journal_entry.schema.json",
    "schema_version": "2.0.0",
    "source_hash": "07b0297e5f2391c0ed491361c49f26a8795ec6294a66e15ebba0ec239eace038",
    "source_schema": "contracts/schemas/fake_provider_journal_entry.schema.json"
  },
  "FakeProviderReplayDescriptor": {
    "schema_id": "https://schemas.axtro.ai/v2/fake_provider_replay_descriptor.schema.json",
    "schema_version": "2.0.0",
    "source_hash": "3aa874bc15651ad66c4a604a62655ed2f887e264f51732201b2f5648c1ddb736",
    "source_schema": "contracts/schemas/fake_provider_replay_descriptor.schema.json"
  },
  "FakeProviderScenario": {
    "schema_id": "https://schemas.axtro.ai/v2/fake_provider_scenario.schema.json",
    "schema_version": "2.0.0",
    "source_hash": "dfd3326a8dc216238e052fe9cad34bf531d9bd69de15df19eda8c311a4dfe9d1",
    "source_schema": "contracts/schemas/fake_provider_scenario.schema.json"
  },
  "HandoffPacket": {
    "schema_id": "https://schemas.axtro.ai/v2/handoff_packet.schema.json",
    "schema_version": "2.0.0",
    "source_hash": "a5a8e2d9fd7ecb627a73505ced67af0212761adda7c95b0e2bcb819d9def2c87",
    "source_schema": "contracts/schemas/handoff_packet.schema.json"
  },
  "InteractionQualityState": {
    "schema_id": "https://schemas.axtro.ai/v2/interaction_quality_state.schema.json",
    "schema_version": "2.0.0",
    "source_hash": "bec182bf9a3abbc82d5d8ce7e986e365c695ffb76f19d9cf84d94a97bc3e642d",
    "source_schema": "contracts/schemas/interaction_quality_state.schema.json"
  },
  "InteractionSessionState": {
    "schema_id": "https://schemas.axtro.ai/v2/interaction_session_state.schema.json",
    "schema_version": "2.0.0",
    "source_hash": "641554550db45bed0f891b726e5b92344d23be5d51308183b136dbb36090bac8",
    "source_schema": "contracts/schemas/interaction_session_state.schema.json"
  },
  "PerceptionSignal": {
    "schema_id": "https://schemas.axtro.ai/v2/perception_signal.schema.json",
    "schema_version": "2.0.0",
    "source_hash": "5ab134b0555d344ad7cf48452d517e945839d13f8b2d65e3229728179a1e6a91",
    "source_schema": "contracts/schemas/perception_signal.schema.json"
  },
  "PolicyDecision": {
    "schema_id": "https://schemas.axtro.ai/v2/policy_decision.schema.json",
    "schema_version": "2.0.0",
    "source_hash": "4832dfa5d90d69b7365eade438c32da0c4ef86210415974e425e8e6e38684b3b",
    "source_schema": "contracts/schemas/policy_decision.schema.json"
  },
  "PreCallBriefing": {
    "schema_id": "https://schemas.axtro.ai/v2/pre_call_briefing.schema.json",
    "schema_version": "2.0.0",
    "source_hash": "2f299c4cf2feb46aa07a4f1e2d2865a588ff150cade828112feafc855c2cbe3a",
    "source_schema": "contracts/schemas/pre_call_briefing.schema.json"
  },
  "ProviderCapability": {
    "schema_id": "https://schemas.axtro.ai/v2/provider_capability.schema.json",
    "schema_version": "2.0.0",
    "source_hash": "34b35d929e7f5bfb368350217d510533da5f3072ddae227b6ab166e3c81ac7b7",
    "source_schema": "contracts/schemas/provider_capability.schema.json"
  },
  "ProviderRegistryEntry": {
    "schema_id": "https://schemas.axtro.ai/v2/provider_registry_entry.schema.json",
    "schema_version": "2.0.0",
    "source_hash": "a5df686e2152d90c9a4ec42da7b88492223eb6e5a6c02a14304f3bfe48c9c1ce",
    "source_schema": "contracts/schemas/provider_registry_entry.schema.json"
  },
  "RolePackManifest": {
    "schema_id": "https://schemas.axtro.ai/v2/role_pack_manifest.schema.json",
    "schema_version": "2.0.0",
    "source_hash": "3c547e93a72f6a1110b5b940adb3e7cb3edb6e985b7ff60e2f481b29c1a8ad75",
    "source_schema": "contracts/schemas/role_pack_manifest.schema.json"
  },
  "RoleState": {
    "schema_id": "https://schemas.axtro.ai/v2/role_state.schema.json",
    "schema_version": "2.0.0",
    "source_hash": "67f83b4138742728d88cdef4db3ef851175ae1ebd0ab7a2bfa2181346b3a65ba",
    "source_schema": "contracts/schemas/role_state.schema.json"
  },
  "RuntimeConfiguration": {
    "schema_id": "https://schemas.axtro.ai/v2/runtime_configuration.schema.json",
    "schema_version": "2.0.0",
    "source_hash": "206376a0bcacadeea2b928436d008d574d6f13bca41a4835af57a0d701cc3898",
    "source_schema": "contracts/schemas/runtime_configuration.schema.json"
  },
  "SalesState": {
    "schema_id": "https://schemas.axtro.ai/v2/sales_state.schema.json",
    "schema_version": "2.0.0",
    "source_hash": "b71dae859adfec31886e9c8bd49740bf1f078481f66e5f52556f42bdb2a6484b",
    "source_schema": "contracts/schemas/sales_state.schema.json"
  },
  "SceneDirective": {
    "schema_id": "https://schemas.axtro.ai/v2/scene_directive.schema.json",
    "schema_version": "2.0.0",
    "source_hash": "afcdef82160e8df27fc4266e44c5c00a159225ec370c3edcacc1525ff8cf57ab",
    "source_schema": "contracts/schemas/scene_directive.schema.json"
  },
  "SceneManifest": {
    "schema_id": "https://schemas.axtro.ai/v2/scene_manifest.schema.json",
    "schema_version": "2.0.0",
    "source_hash": "2e63a97ce37600b08695688b938fceab91c740e433ae4cf57dbc2e4c00f13430",
    "source_schema": "contracts/schemas/scene_manifest.schema.json"
  },
  "SessionHealthState": {
    "schema_id": "https://schemas.axtro.ai/v2/session_health_state.schema.json",
    "schema_version": "2.0.0",
    "source_hash": "09db010a88aed2d8308094923ca1acdac9091fcaf1f8b5cb93a363f7ff0f03d5",
    "source_schema": "contracts/schemas/session_health_state.schema.json"
  },
  "SkillPackManifest": {
    "schema_id": "https://schemas.axtro.ai/v2/skill_pack_manifest.schema.json",
    "schema_version": "2.0.0",
    "source_hash": "4a9752f79a812a1152b1da2f6a315afb20e0220d91e42514e7d50bd9ff8af6d7",
    "source_schema": "contracts/schemas/skill_pack_manifest.schema.json"
  },
  "SpecialistRequest": {
    "schema_id": "https://schemas.axtro.ai/v2/specialist_request.schema.json",
    "schema_version": "2.0.0",
    "source_hash": "7747c1c7ba88c2f1d8ceae5160e17616b524a389c2ed3cfb729404394ce6bc95",
    "source_schema": "contracts/schemas/specialist_request.schema.json"
  },
  "SpecialistResult": {
    "schema_id": "https://schemas.axtro.ai/v2/specialist_result.schema.json",
    "schema_version": "2.0.0",
    "source_hash": "6dfaa40675eed45e165301369fc22a4d56d33d146aed5ed88728fbb12ba8441b",
    "source_schema": "contracts/schemas/specialist_result.schema.json"
  },
  "ToolContract": {
    "schema_id": "https://schemas.axtro.ai/v2/tool_contract.schema.json",
    "schema_version": "2.0.0",
    "source_hash": "42d64c9423d35802a78f3c67d5927d2692d6f6c357fd7572e62da1001db65d07",
    "source_schema": "contracts/schemas/tool_contract.schema.json"
  },
  "ToolExecutionReceipt": {
    "schema_id": "https://schemas.axtro.ai/v2/tool_execution_receipt.schema.json",
    "schema_version": "2.0.0",
    "source_hash": "597cd7829d0e32a52b79826fe93d8a932478af71ff772e9e9280d97b093bc377",
    "source_schema": "contracts/schemas/tool_execution_receipt.schema.json"
  },
  "TurnCommitted": {
    "schema_id": "https://schemas.axtro.ai/v2/turn_committed.schema.json",
    "schema_version": "2.0.0",
    "source_hash": "7f490c188c3b700454ef15aa36503c5e25d9b30d14644a32b962e24653ba4b1d",
    "source_schema": "contracts/schemas/turn_committed.schema.json"
  },
  "TurnSubmission": {
    "schema_id": "https://schemas.axtro.ai/v2/turn_submission.schema.json",
    "schema_version": "2.0.0",
    "source_hash": "42d3f539f3f1c8743e227fbd1d7401d51a9c4e134eb76ea6ef996f88e2806de4",
    "source_schema": "contracts/schemas/turn_submission.schema.json"
  },
  "WorkflowCommand": {
    "schema_id": "https://schemas.axtro.ai/v2/workflow_command.schema.json",
    "schema_version": "2.0.0",
    "source_hash": "a11b261743249b2e3afbccdc4185d504c26cdfd3fc4024c804959beaca53dfe4",
    "source_schema": "contracts/schemas/workflow_command.schema.json"
  },
  "WorkflowStatus": {
    "schema_id": "https://schemas.axtro.ai/v2/workflow_status.schema.json",
    "schema_version": "2.0.0",
    "source_hash": "290e0011bbed957d83af4d12a5d720721a41077e9965553f5920bc8e2961599f",
    "source_schema": "contracts/schemas/workflow_status.schema.json"
  }
}

__all__ = [
    'CONTRACT_GENERATOR_VERSION',
    'CONTRACT_METADATA',
    'ActionIntent',
    'AgentSuggestion',
    'BehaviorDirective',
    'ConsentEvidence',
    'ConversationState',
    'CostEvent',
    'DeploymentPromotion',
    'DerivedHypothesis',
    'DisclosureRecord',
    'EventEnvelope',
    'ExperimentCandidate',
    'FakeProviderJournalEntry',
    'FakeProviderReplayDescriptor',
    'FakeProviderScenario',
    'HandoffPacket',
    'InteractionQualityState',
    'InteractionSessionState',
    'PerceptionSignal',
    'PolicyDecision',
    'PreCallBriefing',
    'ProviderCapability',
    'ProviderRegistryEntry',
    'RolePackManifest',
    'RoleState',
    'RuntimeConfiguration',
    'SalesState',
    'SceneDirective',
    'SceneManifest',
    'SessionHealthState',
    'SkillPackManifest',
    'SpecialistRequest',
    'SpecialistResult',
    'ToolContract',
    'ToolExecutionReceipt',
    'TurnCommitted',
    'TurnSubmission',
    'WorkflowCommand',
    'WorkflowStatus',
]
