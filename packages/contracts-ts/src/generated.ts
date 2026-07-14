/*
 * GENERATED FILE. DO NOT EDIT.
 * generator: scripts/generate_contract_types.py@1.0.0
 * source: 33 JSON Schema Draft 2020-12 documents under contracts/schemas/
 */

export const CONTRACT_GENERATOR_VERSION = "1.0.0" as const;
export interface ContractMetadata {
  schema_id: string;
  schema_version: string;
  source_hash: string;
  source_schema: string;
}

/** Source: contracts/schemas/action_intent.schema.json; schema: https://schemas.axtro.ai/v2/action_intent.schema.json; version: 2.0.0. */
export interface ActionIntent {
  schema_version: "2.0.0";
  intent_id: string;
  session_id: string;
  tenant_id: string;
  actor_id: string;
  actor_type: "presenter" | "specialist" | "workflow" | "human_operator" | "axtro_agent";
  tool_contract_id: string;
  action: string;
  arguments_json: string;
  purpose: string;
  idempotency_key: string;
  requested_at: string;
  expires_at: string;
}

/** Source: contracts/schemas/agent_suggestion.schema.json; schema: https://schemas.axtro.ai/v2/agent_suggestion.schema.json; version: 2.0.0. */
export interface AgentSuggestion {
  schema_version: "2.0.0";
  suggestion_id: string;
  session_id: string;
  tenant_id: string;
  source_agent_type: string;
  suggestion_type: "next_question" | "strategy" | "risk" | "handoff" | "scene" | "tool" | "fact_check";
  content: string;
  confidence: number;
  evidence_refs: Array<string>;
  priority: number;
  created_at: string;
  expires_at: string;
}

/** Source: contracts/schemas/behavior_directive.schema.json; schema: https://schemas.axtro.ai/v2/behavior_directive.schema.json; version: 2.0.0. */
export interface BehaviorDirective {
  schema_version: "2.0.0";
  directive_id: string;
  session_id: string;
  tenant_id: string;
  target_presenter_id: string;
  posture: "neutral" | "listening" | "explaining" | "presenting" | "handoff";
  facial_expression: "neutral_warm" | "attentive" | "light_smile" | "concerned" | "confident" | "none";
  gaze: "camera" | "participant" | "content" | "neutral";
  gesture: "none" | "micro_nod" | "single_nod" | "open_hand" | "settle";
  vocal_style: "neutral" | "warm" | "calm" | "energetic" | "reassuring" | "concise";
  pause_ms: number;
  duration_ms: number;
  reason: string;
  priority: number;
  generated_at: string;
  expires_at: string;
}

/** Source: contracts/schemas/consent_evidence.schema.json; schema: https://schemas.axtro.ai/v2/consent_evidence.schema.json; version: 2.0.0. */
export interface ConsentEvidence {
  schema_version: "2.0.0";
  consent_id: string;
  session_id: string;
  tenant_id: string;
  subject_ref: string;
  consent_type: "essential_processing" | "recording" | "behavioral_analysis" | "emotion_inference" | "biometric_identity" | "marketing_contact" | "data_retention";
  purpose: string;
  status: "granted" | "denied" | "revoked" | "expired";
  method: "spoken" | "click" | "written" | "signed" | "system_import";
  disclosure_version: string;
  jurisdiction: string;
  evidence_hash: string;
  captured_at: string;
  expires_at: string | null;
  revoked_at: string | null;
}

/** Source: contracts/schemas/conversation_state.schema.json; schema: https://schemas.axtro.ai/v2/conversation_state.schema.json; version: 2.0.0. */
export interface ConversationState {
  schema_version: "2.0.0";
  session_id: string;
  tenant_id: string;
  turn_index: number;
  active_topic: string | null;
  language: string;
  open_questions: Array<string>;
  confirmed_facts: Array<{
    evidence_id: string;
    kind: "explicit_user_statement" | "tool_verified" | "knowledge_source" | "derived_hypothesis" | "operator_input" | "system_observation";
    summary: string;
    source_ref: string;
    confidence: number;
    observed_at: string;
    expires_at: string | null;
  }>;
  repair_state: "none" | "clarifying" | "recovering_interruption" | "recovering_tool_failure" | "recovering_connection";
  incremental_summary: string;
  updated_at: string;
}

/** Source: contracts/schemas/cost_event.schema.json; schema: https://schemas.axtro.ai/v2/cost_event.schema.json; version: 2.0.0. */
export interface CostEvent {
  schema_version: "2.0.0";
  cost_event_id: string;
  tenant_id: string;
  session_id: string | null;
  provider_id: string;
  service: string;
  unit_type: "minute" | "second" | "token" | "character" | "megabyte" | "request" | "seat" | "flat";
  quantity: number;
  unit_cost_usd: number;
  amount_usd: number;
  currency: "USD";
  source: "measured" | "provider_reported" | "estimated";
  occurred_at: string;
}

/** Source: contracts/schemas/deployment_promotion.schema.json; schema: https://schemas.axtro.ai/v2/deployment_promotion.schema.json; version: 2.0.0. */
export interface DeploymentPromotion {
  schema_version: "2.0.0";
  promotion_id: string;
  experiment_id: string;
  tenant_id: string | null;
  component: string;
  from_version: string;
  to_version: string;
  environment: "development" | "staging" | "canary" | "production";
  rollout_percentage: number;
  decision: "promote" | "hold" | "rollback" | "reject";
  decision_reasons: Array<string>;
  rollback_plan: string;
  approved_by: string;
  promoted_at: string;
}

/** Source: contracts/schemas/derived_hypothesis.schema.json; schema: https://schemas.axtro.ai/v2/derived_hypothesis.schema.json; version: 2.0.0. */
export interface DerivedHypothesis {
  schema_version: "2.0.0";
  hypothesis_id: string;
  session_id: string;
  tenant_id: string;
  label: string;
  statement: string;
  evidence_signal_ids: Array<string>;
  confidence: number;
  status: "candidate" | "active" | "confirmed" | "rejected" | "expired";
  allowed_use: "turn_strategy" | "clarification" | "accessibility" | "quality" | "safety" | "prohibited";
  created_at: string;
  expires_at: string;
}

/** Source: contracts/schemas/disclosure_record.schema.json; schema: https://schemas.axtro.ai/v2/disclosure_record.schema.json; version: 2.0.0. */
export interface DisclosureRecord {
  schema_version: "2.0.0";
  disclosure_id: string;
  session_id: string;
  tenant_id: string;
  disclosure_type: "ai_identity" | "recording" | "data_use" | "regulated_scope" | "marketing_contact";
  version: string;
  content_hash: string;
  delivery_channel: "spoken" | "visual" | "chat" | "email" | "signed_document";
  language: string;
  delivered_at: string;
  acknowledged: boolean;
  acknowledged_at: string | null;
}

/** Source: contracts/schemas/event_envelope.schema.json; schema: https://schemas.axtro.ai/v2/event_envelope.schema.json; version: 2.0.0. */
export interface EventEnvelope {
  schema_version: "2.0.0";
  event_id: string;
  event_type: string;
  event_version: number;
  aggregate_type: string;
  aggregate_id: string;
  aggregate_version: number;
  tenant_id: string;
  session_id: string | null;
  producer: string;
  trace_id: string;
  correlation_id: string;
  causation_id: string | null;
  data_classification: "public" | "internal" | "confidential" | "restricted";
  payload_json: string;
  occurred_at: string;
}

/** Source: contracts/schemas/experiment_candidate.schema.json; schema: https://schemas.axtro.ai/v2/experiment_candidate.schema.json; version: 2.0.0. */
export interface ExperimentCandidate {
  schema_version: "2.0.0";
  experiment_id: string;
  scope_type: "global" | "tenant" | "role_pack" | "agent";
  tenant_id: string | null;
  component: string;
  hypothesis: string;
  baseline_version: string;
  candidate_version: string;
  target_metrics: Array<string>;
  guardrails: Array<string>;
  status: "draft" | "simulating" | "shadow" | "canary" | "running" | "paused" | "completed" | "rejected";
  created_at: string;
}

/** Source: contracts/schemas/handoff_packet.schema.json; schema: https://schemas.axtro.ai/v2/handoff_packet.schema.json; version: 2.0.0. */
export interface HandoffPacket {
  schema_version: "2.0.0";
  handoff_id: string;
  session_id: string;
  tenant_id: string;
  from_presenter_id: string;
  target_type: "specific_human" | "team_queue" | "specialist_human" | "fallback_queue";
  target_id: string | null;
  reason_code: string;
  priority: "normal" | "high" | "urgent";
  summary: string;
  customer_context_json: string;
  role_state_snapshot_json: string;
  actions_completed: Array<string>;
  open_actions: Array<string>;
  requested_at: string;
  expires_at: string;
}

/** Source: contracts/schemas/interaction_quality_state.schema.json; schema: https://schemas.axtro.ai/v2/interaction_quality_state.schema.json; version: 2.0.0. */
export interface InteractionQualityState {
  schema_version: "2.0.0";
  session_id: string;
  tenant_id: string;
  dimensions: Array<{
    name: "clarity" | "explicit_interest" | "engagement" | "resistance" | "urgency" | "next_step_readiness" | "relationship_continuity" | "system_confidence";
    value: number;
    confidence: number;
    evidence_refs: Array<string>;
    rationale: string;
    updated_at: string;
    expires_at: string | null;
  }>;
  aggregate_confidence: number;
  updated_at: string;
}

/** Source: contracts/schemas/interaction_session_state.schema.json; schema: https://schemas.axtro.ai/v2/interaction_session_state.schema.json; version: 2.0.0. */
export interface InteractionSessionState {
  schema_version: "2.0.0";
  session_id: string;
  tenant_id: string;
  agent_id: string;
  status: "preparing" | "ready" | "active" | "handoff_pending" | "completed" | "failed";
  active_presenter_id: string | null;
  channel: {
    type: "native_room" | "telephone" | "google_meet" | "zoom" | "teams" | "web_widget" | "api";
    external_session_ref: string | null;
    region: string;
  };
  state_version: number;
  consent_status: "not_required" | "pending" | "granted" | "denied" | "revoked";
  disclosure_status: "pending" | "delivered" | "acknowledged" | "failed";
  capabilities: {
    audio: boolean;
    video: boolean;
    avatar: boolean;
    screen_share: boolean;
    tools: boolean;
    handoff: boolean;
  };
  degradation_level: "none" | "minor" | "major" | "voice_only" | "text_only" | "terminated";
  started_at: string | null;
  updated_at: string;
}

/** Source: contracts/schemas/perception_signal.schema.json; schema: https://schemas.axtro.ai/v2/perception_signal.schema.json; version: 2.0.0. */
export interface PerceptionSignal {
  schema_version: "2.0.0";
  signal_id: string;
  session_id: string;
  tenant_id: string;
  modality: "audio" | "text" | "video" | "screen" | "interaction" | "technical";
  signal_type: string;
  observed_value_json: string;
  source: string;
  confidence: number;
  evidence_ref: string;
  occurred_at: string;
  expires_at: string;
  consent_scope: "essential_processing" | "recording" | "behavioral_analysis" | "emotion_inference" | "biometric_identity" | "technical_quality";
  allowed_use: "turn_taking" | "accessibility" | "quality" | "personalization" | "safety" | "prohibited";
}

/** Source: contracts/schemas/policy_decision.schema.json; schema: https://schemas.axtro.ai/v2/policy_decision.schema.json; version: 2.0.0. */
export interface PolicyDecision {
  schema_version: "2.0.0";
  decision_id: string;
  intent_id: string;
  tenant_id: string;
  outcome: "allow" | "deny" | "require_approval";
  reasons: Array<string>;
  obligations: Array<string>;
  policy_version: string;
  evaluated_at: string;
  expires_at: string;
}

/** Source: contracts/schemas/pre_call_briefing.schema.json; schema: https://schemas.axtro.ai/v2/pre_call_briefing.schema.json; version: 2.0.0. */
export interface PreCallBriefing {
  schema_version: "2.0.0";
  briefing_id: string;
  session_id: string;
  tenant_id: string;
  lead_ref: string | null;
  purpose: string;
  known_facts: Array<{
    evidence_id: string;
    kind: "explicit_user_statement" | "tool_verified" | "knowledge_source" | "derived_hypothesis" | "operator_input" | "system_observation";
    summary: string;
    source_ref: string;
    confidence: number;
    observed_at: string;
    expires_at: string | null;
  }>;
  hypotheses: Array<string>;
  recommended_plan: Array<string>;
  approved_material_ids: Array<string>;
  tool_grants: Array<string>;
  risk_notes: Array<string>;
  created_at: string;
  expires_at: string;
}

/** Source: contracts/schemas/provider_capability.schema.json; schema: https://schemas.axtro.ai/v2/provider_capability.schema.json; version: 2.0.0. */
export interface ProviderCapability {
  schema_version: "2.0.0";
  provider_id: string;
  provider_type: "realtime_model" | "stt" | "tts" | "avatar" | "meeting" | "telephony" | "database" | "observability" | "channel" | "tool" | "storage";
  capability: string;
  version: string;
  supported_regions: Array<string>;
  languages: Array<string>;
  max_session_minutes: number;
  supports_streaming: boolean;
  supports_barge_in: boolean;
  supports_data_residency: boolean;
  latency_class: "ultra_low" | "low" | "medium" | "batch";
  cost_model_ref: string;
  status: "candidate" | "approved" | "fallback" | "deprecated" | "disabled";
  evaluated_at: string;
}

/** Source: contracts/schemas/provider_registry_entry.schema.json; schema: https://schemas.axtro.ai/v2/provider_registry_entry.schema.json; version: 2.0.0. */
export interface ProviderRegistryEntry {
  schema_version: "2.0.0";
  port_kind: "channel" | "realtime_model" | "stt" | "tts" | "avatar" | "meeting" | "telephony" | "tool" | "storage";
  provider_mode: "fake";
  provider_capabilities: Array<ProviderCapability>;
  default_timeout_ms: number;
  supports_cancellation: boolean;
  health_status: "healthy" | "degraded" | "unavailable" | "unknown";
  circuit_state: "closed" | "open" | "half_open";
  fallback_provider_ids: Array<string>;
}

/** Source: contracts/schemas/role_pack_manifest.schema.json; schema: https://schemas.axtro.ai/v2/role_pack_manifest.schema.json; version: 2.0.0. */
export interface RolePackManifest {
  schema_version: "2.0.0";
  role_pack_id: string;
  name: string;
  version: string;
  role_type: string;
  description: string;
  state_schema_ref: string;
  allowed_skill_pack_ids: Array<string>;
  required_disclosures: Array<string>;
  default_policies: Array<string>;
  supported_languages: Array<string>;
  status: "draft" | "active" | "deprecated" | "disabled";
  checksum: string;
}

/** Source: contracts/schemas/role_state.schema.json; schema: https://schemas.axtro.ai/v2/role_state.schema.json; version: 2.0.0. */
export interface RoleState {
  schema_version: "2.0.0";
  session_id: string;
  tenant_id: string;
  role_pack_id: string;
  role_pack_version: string;
  objective: string;
  stage: string;
  milestones: Array<{
    code: string;
    status: "not_started" | "in_progress" | "completed" | "blocked" | "skipped";
    evidence_refs: Array<string>;
  }>;
  missing_fields: Array<string>;
  next_best_action: {
    action_code: string;
    reason: string;
    confidence: number;
    expires_at: string;
  };
  updated_at: string;
}

/** Source: contracts/schemas/runtime_configuration.schema.json; schema: https://schemas.axtro.ai/v2/runtime_configuration.schema.json; version: 2.0.0. */
export interface RuntimeConfiguration {
  schema_version: "2.0.0";
  environment: "development" | "test" | "staging" | "canary" | "production";
  service_name: "api" | "realtime-worker" | "axtro-supervisor" | "meeting-bot-worker" | "workflow-worker";
  provider_mode: "fake";
  secret_broker_handle: string;
  port: number;
  request_timeout_ms: number;
  dev_auth_enabled: boolean;
  log_level: "debug" | "info" | "warn" | "error";
}

/** Source: contracts/schemas/sales_state.schema.json; schema: https://schemas.axtro.ai/v2/sales_state.schema.json; version: 2.0.0. */
export interface SalesState {
  schema_version: "2.0.0";
  session_id: string;
  tenant_id: string;
  funnel_stage: "opening" | "discovery" | "qualification" | "solution_fit" | "demonstration" | "objection_handling" | "proposal" | "commitment" | "follow_up" | "closed_won" | "closed_lost";
  methodology: string;
  qualification: Array<{
    dimension: "budget" | "authority" | "need" | "timing" | "impact" | "decision_process";
    status: "unknown" | "partial" | "confirmed" | "not_applicable";
    value_summary: string | null;
    evidence_refs: Array<string>;
  }>;
  objections: Array<{
    objection_id: string;
    category: string;
    summary: string;
    status: "open" | "exploring" | "addressed" | "unresolved";
    evidence_refs: Array<string>;
  }>;
  proposal_status: "not_started" | "drafting" | "presented" | "revising" | "accepted" | "rejected" | "expired";
  conversion_probability: number;
  next_step: string | null;
  updated_at: string;
}

/** Source: contracts/schemas/scene_directive.schema.json; schema: https://schemas.axtro.ai/v2/scene_directive.schema.json; version: 2.0.0. */
export interface SceneDirective {
  schema_version: "2.0.0";
  directive_id: string;
  session_id: string;
  tenant_id: string;
  scene_id: string;
  command: "open" | "update" | "focus" | "close";
  bindings_json: string;
  requested_by: string;
  priority: number;
  issued_at: string;
  expires_at: string;
}

/** Source: contracts/schemas/scene_manifest.schema.json; schema: https://schemas.axtro.ai/v2/scene_manifest.schema.json; version: 2.0.0. */
export interface SceneManifest {
  schema_version: "2.0.0";
  scene_id: string;
  tenant_id: string;
  name: string;
  version: string;
  scene_type: "avatar_full" | "avatar_with_slides" | "comparison" | "calculator" | "proposal" | "web_demo" | "handoff" | "error";
  allowed_components: Array<string>;
  data_bindings: Array<{
    name: string;
    classification: "public" | "internal" | "confidential" | "restricted";
    source: "static" | "session_state" | "tool_receipt" | "approved_document";
  }>;
  allowed_roles: Array<string>;
  max_duration_seconds: number;
  requires_consent: boolean;
  checksum: string;
  status: "draft" | "active" | "deprecated" | "disabled";
}

/** Source: contracts/schemas/session_health_state.schema.json; schema: https://schemas.axtro.ai/v2/session_health_state.schema.json; version: 2.0.0. */
export interface SessionHealthState {
  schema_version: "2.0.0";
  session_id: string;
  tenant_id: string;
  overall_status: "healthy" | "degraded" | "critical" | "terminated";
  degradation_level: "none" | "minor" | "major" | "voice_only" | "text_only" | "terminated";
  metrics: {
    end_of_turn_to_first_audio_ms: number;
    interrupt_stop_ms: number;
    jitter_ms: number;
    packet_loss_percent: number;
    tool_p95_ms: number;
    estimated_cost_usd: number;
  };
  provider_statuses: Array<{
    provider_id: string;
    component: "realtime_model" | "stt" | "tts" | "avatar" | "meeting" | "telephony" | "database" | "cache" | "tool";
    status: "healthy" | "degraded" | "unavailable" | "unknown";
    latency_ms: number;
    last_error_code: string | null;
    checked_at: string;
  }>;
  active_incidents: Array<string>;
  updated_at: string;
}

/** Source: contracts/schemas/skill_pack_manifest.schema.json; schema: https://schemas.axtro.ai/v2/skill_pack_manifest.schema.json; version: 2.0.0. */
export interface SkillPackManifest {
  schema_version: "2.0.0";
  skill_pack_id: string;
  name: string;
  version: string;
  description: string;
  capabilities: Array<string>;
  tool_contract_ids: Array<string>;
  input_schema_ref: string;
  output_schema_ref: string;
  risk_class: "read_public" | "read_tenant" | "read_pii" | "write_low" | "write_high" | "financial" | "irreversible";
  supported_role_types: Array<string>;
  status: "draft" | "active" | "deprecated" | "disabled";
  checksum: string;
}

/** Source: contracts/schemas/specialist_request.schema.json; schema: https://schemas.axtro.ai/v2/specialist_request.schema.json; version: 2.0.0. */
export interface SpecialistRequest {
  schema_version: "2.0.0";
  request_id: string;
  session_id: string;
  tenant_id: string;
  specialist_type: string;
  question: string;
  context_json: string;
  required_output_schema_ref: string;
  priority: "low" | "normal" | "high" | "urgent";
  deadline_at: string;
  requested_at: string;
}

/** Source: contracts/schemas/specialist_result.schema.json; schema: https://schemas.axtro.ai/v2/specialist_result.schema.json; version: 2.0.0. */
export interface SpecialistResult {
  schema_version: "2.0.0";
  result_id: string;
  request_id: string;
  session_id: string;
  tenant_id: string;
  status: "completed" | "partial" | "failed" | "expired";
  answer: string;
  claims: Array<{
    statement: string;
    confidence: number;
    source_refs: Array<string>;
  }>;
  recommended_actions: Array<string>;
  completed_at: string;
  expires_at: string;
}

/** Source: contracts/schemas/tool_contract.schema.json; schema: https://schemas.axtro.ai/v2/tool_contract.schema.json; version: 2.0.0. */
export interface ToolContract {
  schema_version: "2.0.0";
  contract_id: string;
  version: string;
  tool_name: string;
  tenant_scope: "global_catalog" | "tenant_installation" | "session_grant";
  risk_class: "read_public" | "read_tenant" | "read_pii" | "write_low" | "write_high" | "financial" | "irreversible";
  input_schema_ref: string;
  output_schema_ref: string;
  timeout_ms: number;
  idempotency_required: boolean;
  human_approval: "never" | "policy_based" | "always";
  allowed_actors: Array<string>;
  data_classification: "public" | "internal" | "confidential" | "restricted";
  side_effects: "none" | "reversible" | "compensatable" | "irreversible";
  status: "draft" | "active" | "deprecated" | "disabled";
}

/** Source: contracts/schemas/tool_execution_receipt.schema.json; schema: https://schemas.axtro.ai/v2/tool_execution_receipt.schema.json; version: 2.0.0. */
export interface ToolExecutionReceipt {
  schema_version: "2.0.0";
  execution_id: string;
  intent_id: string;
  tenant_id: string;
  status: "started" | "succeeded" | "failed" | "pending" | "unknown" | "cancelled";
  provider_id: string;
  attempt: number;
  result_json: string | null;
  error: ({
    code: string;
    message: string;
    retryable: boolean;
    provider_code: string | null;
  }) | (null);
  effect_hash: string | null;
  started_at: string;
  completed_at: string | null;
}

/** Source: contracts/schemas/workflow_command.schema.json; schema: https://schemas.axtro.ai/v2/workflow_command.schema.json; version: 2.0.0. */
export interface WorkflowCommand {
  schema_version: "2.0.0";
  command_id: string;
  tenant_id: string;
  workflow_type: string;
  workflow_version: string;
  aggregate_type: string;
  aggregate_id: string;
  input_json: string;
  idempotency_key: string;
  requested_by: string;
  scheduled_at: string;
  created_at: string;
}

/** Source: contracts/schemas/workflow_status.schema.json; schema: https://schemas.axtro.ai/v2/workflow_status.schema.json; version: 2.0.0. */
export interface WorkflowStatus {
  schema_version: "2.0.0";
  workflow_run_id: string;
  command_id: string;
  tenant_id: string;
  status: "queued" | "running" | "waiting" | "completed" | "failed" | "cancelled" | "compensating";
  current_step: string;
  attempts: number;
  last_error: ({
    code: string;
    message: string;
    retryable: boolean;
    provider_code: string | null;
  }) | (null);
  started_at: string | null;
  updated_at: string;
  completed_at: string | null;
}

export const CONTRACT_METADATA = {
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
    "source_hash": "a7c3e1dd519a538b0bd72c6a5332853d951ce00a1cf92e85ca4b8820a6bb4ac7",
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
} as const satisfies Record<string, ContractMetadata>;
