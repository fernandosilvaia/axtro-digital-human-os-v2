/*
 * GENERATED FILE. DO NOT EDIT.
 * generator: scripts/generate_contract_types.py@1.2.0
 * source: 69 JSON Schema Draft 2020-12 documents under contracts/schemas/
 */

export const CONTRACT_GENERATOR_VERSION = "1.2.0" as const;
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

/** Source: contracts/schemas/billing_checkout_intent.schema.json; schema: https://schemas.axtro.ai/v2/billing_checkout_intent.schema.json; version: 2.0.0. */
export interface BillingCheckoutIntent {
  schema_version: "2.0.0";
  checkout_intent_id: string;
  tenant_id: string;
  actor_id: string;
  plan_id: "piloto" | "crescimento" | "escala";
  state: "reserved" | "dispatched" | "bound" | "completed" | "expired" | "released" | "unknown" | "conflict";
  stripe_idempotency_key: string;
  catalog_fingerprint: string;
  provider_request_fingerprint: string | null;
  stripe_livemode: boolean;
  base_price_id: string;
  overage_price_id: string;
  base_unit_amount_cents: number;
  overage_unit_amount_cents: number;
  meter_event_name: string;
  existing_stripe_customer_id: string | null;
  success_url: string;
  cancel_url: string;
  checkout_expires_at: string;
  stripe_checkout_session_id: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  provider_dispatched_at: string | null;
  session_created_at: string | null;
  checkout_completed_at: string | null;
  subscription_bound_at: string | null;
  expired_at: string | null;
  released_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Source: contracts/schemas/catalog_lookup_command.schema.json; schema: https://schemas.axtro.ai/v2/catalog_lookup_command.schema.json; version: 2.0.0. */
export interface CatalogLookupCommand {
  schema_version: "2.0.0";
  question_id: string;
  session_id: string;
  plan_id: "starter" | "growth";
}

/** Source: contracts/schemas/consent_evidence.schema.json; schema: https://schemas.axtro.ai/v2/consent_evidence.schema.json; version: 2.0.0. */
export interface ConsentEvidence {
  schema_version: "2.0.0";
  consent_id: string;
  session_id: string;
  tenant_id: string;
  subject_ref: string;
  consent_type: "essential_processing" | "recording" | "persistent_transcription" | "behavioral_analysis" | "emotion_inference" | "biometric_identity" | "marketing_contact" | "data_retention";
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

/** Source: contracts/schemas/context_composition.schema.json; schema: https://schemas.axtro.ai/v2/context_composition.schema.json; version: 2.0.0. */
export interface ContextComposition {
  schema_version: "2.0.0";
  tenant_id: string;
  session_id: string;
  context_version: number;
  max_context_bytes: number;
  content_bytes_used: number;
  omitted_entry_count: number;
  composed_at: string;
  expires_at: string | null;
  entries: Array<{
    kind: "conversation_summary" | "confirmed_fact" | "approved_knowledge" | "suggestion" | "hypothesis";
    trust_level: "confirmed" | "uncertain" | "untrusted";
    content: string;
    data_classification: "public" | "internal" | "confidential" | "restricted";
    confidence: number | null;
    provenance: {
      source_kind: "interaction_state" | "approved_knowledge_catalog" | "server_owned_suggestion_snapshot";
      source_id: string;
      source_version: string;
      checksum_sha256: string | null;
      evidence_refs: Array<string>;
      observed_at: string;
      expires_at: string | null;
    };
  }>;
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

/** Source: contracts/schemas/cost_event.schema.json; schema: https://schemas.axtro.ai/v2/cost_event.schema.json; version: 2.1.0. */
export interface CostEvent {
  schema_version: "2.1.0";
  cost_event_id: string;
  tenant_id: string;
  session_id: string | null;
  provider_id: string;
  service: string;
  unit_type: "minute" | "second" | "token" | "character" | "megabyte" | "request" | "seat" | "flat" | "conversation";
  quantity: number;
  unit_cost_usd: number;
  amount_usd: number;
  currency: "USD";
  source: "measured" | "provider_reported" | "estimated";
  rate_card_ref?: string | null;
  rate_card_as_of?: string | null;
  reconciles_cost_event_id?: string | null;
  trace_id?: string | null;
  provider_request_ref?: string | null;
  occurred_at: string;
}

/** Source: contracts/schemas/data_governance_command.schema.json; schema: https://schemas.axtro.ai/v2/data_governance_command.schema.json; version: 2.0.0. */
export interface DataGovernanceCommand {
  schema_version: "2.0.0";
  governance_version: "1.0.0";
  command_id: string;
  request_id: string;
  tenant_id: string;
  command_type: "request_deletion" | "authorize_execution" | "cancel_request";
  scope_type: "tenant" | "data_subject";
  data_subject_id: (string) | (null);
  requested_action: "redact" | "irreversible_delete";
  actor_id: string;
  policy_decision_id: (string) | (null);
  approval_ids: Array<string>;
  policy_version: "1.0.0";
  inventory_version: "1.0.0";
  request_fingerprint: string;
  idempotency_key: string;
  trace_id: string;
  correlation_id: string;
  causation_id: (string) | (null);
  issued_at: string;
  authorization_expires_at: (string) | (null);
  data_classification: "internal";
}

/** Source: contracts/schemas/data_governance_receipt.schema.json; schema: https://schemas.axtro.ai/v2/data_governance_receipt.schema.json; version: 2.0.0. */
export interface DataGovernanceReceipt {
  schema_version: "2.0.0";
  governance_version: "1.0.0";
  receipt_id: string;
  request_id: string;
  tenant_id: string;
  scope_type: "tenant" | "data_subject";
  outcome: "request_admitted" | "policy_denied" | "approval_recorded" | "execution_authorized" | "inventory_completed" | "legal_hold_blocked" | "redaction_completed" | "irreversible_deletion_completed" | "retry_scheduled" | "effect_unknown" | "verification_completed" | "request_completed" | "request_cancelled" | "request_expired" | "operator_required";
  resulting_state: "requested" | "approval_pending" | "authorized" | "inventorying" | "ready" | "blocked_by_legal_hold" | "executing_redaction" | "executing_irreversible_deletion" | "retry_wait" | "effect_unknown" | "verifying" | "operator_required" | "completed" | "denied" | "expired" | "cancelled";
  work_item_id: (string) | (null);
  surface: ("database" | "object_storage" | "cache" | "embedding_index" | "provider_copy" | "auth_identity" | "vault_secret" | "backup") | (null);
  action: ("redact" | "irreversible_delete" | "retain_content_free" | "external_delete" | "cache_invalidate" | "crypto_erase" | "backup_expiry_wait") | (null);
  policy_version: "1.0.0";
  inventory_version: "1.0.0";
  inventory_fingerprint: (string) | (null);
  affected_resource_count: number;
  verified_resource_count: number;
  retained_exception_count: number;
  outcome_code: ("policy_denied" | "legal_hold_active" | "external_retryable" | "external_effect_unknown" | "verification_failed" | "coverage_ambiguous" | "inflight_effect" | "retry_budget_exhausted" | "authority_expired" | "operator_intervention_required" | "cancelled_before_irreversible_effect") | (null);
  receipt_fingerprint: string;
  trace_id: string;
  correlation_id: string;
  causation_id: (string) | (null);
  recorded_at: string;
  data_classification: "internal";
}

/** Source: contracts/schemas/data_governance_status.schema.json; schema: https://schemas.axtro.ai/v2/data_governance_status.schema.json; version: 2.0.0. */
export interface DataGovernanceStatus {
  schema_version: "2.0.0";
  governance_version: "1.0.0";
  request_id: string;
  tenant_id: string;
  scope_type: "tenant" | "data_subject";
  state: "requested" | "approval_pending" | "authorized" | "inventorying" | "ready" | "blocked_by_legal_hold" | "executing_redaction" | "executing_irreversible_deletion" | "retry_wait" | "effect_unknown" | "verifying" | "operator_required" | "completed" | "denied" | "expired" | "cancelled";
  state_version: number;
  active_action: ("redact" | "irreversible_delete" | "retain_content_free" | "external_delete" | "cache_invalidate" | "crypto_erase" | "backup_expiry_wait") | (null);
  policy_version: "1.0.0";
  inventory_version: "1.0.0";
  inventory_fingerprint: (string) | (null);
  work_item_count: number;
  verified_work_item_count: number;
  held_work_item_count: number;
  retained_exception_count: number;
  attempt: number;
  next_attempt_at: (string) | (null);
  status_code: ("approval_required" | "authorization_expired" | "policy_denied" | "inventory_incomplete" | "legal_hold_active" | "external_retryable" | "external_effect_unknown" | "verification_failed" | "coverage_ambiguous" | "inflight_effect" | "retry_budget_exhausted" | "operator_intervention_required" | "cancelled_before_irreversible_effect") | (null);
  trace_id: string;
  correlation_id: string;
  updated_at: string;
  completed_at: (string) | (null);
  data_classification: "internal";
}

/** Source: contracts/schemas/data_governance_work_item.schema.json; schema: https://schemas.axtro.ai/v2/data_governance_work_item.schema.json; version: 2.0.0. */
export interface DataGovernanceWorkItem {
  schema_version: "2.0.0";
  governance_version: "1.0.0";
  work_item_id: string;
  request_id: string;
  tenant_id: string;
  surface: "database" | "object_storage" | "cache" | "embedding_index" | "provider_copy" | "auth_identity" | "vault_secret" | "backup";
  resource_class: "tenant_profile" | "authentication_identity" | "membership" | "configuration" | "contact_profile" | "session_content" | "transcript" | "consent_evidence" | "disclosure_evidence" | "action_evidence" | "workflow_evidence" | "knowledge_content" | "embedding" | "provider_effect" | "billing_evidence" | "audit_evidence" | "notification_payload" | "runtime_evidence" | "object_blob" | "cache_entry" | "provider_copy" | "vault_secret" | "backup_snapshot";
  action: "redact" | "irreversible_delete" | "retain_content_free" | "external_delete" | "cache_invalidate" | "crypto_erase" | "backup_expiry_wait";
  state: "pending" | "held" | "leased" | "applying" | "retry_wait" | "effect_unknown" | "verification_pending" | "verified" | "operator_required" | "retained_exception";
  resource_locator_hmac: (string) | (null);
  resource_count: number;
  attempt: number;
  max_attempts: number;
  lease_fence: (number) | (null);
  lease_token_digest: (string) | (null);
  next_attempt_at: (string) | (null);
  failure_code: ("legal_hold_active" | "external_retryable" | "external_effect_unknown" | "verification_failed" | "coverage_ambiguous" | "inflight_effect" | "lease_expired" | "retry_budget_exhausted" | "authority_expired" | "operator_intervention_required") | (null);
  verification_digest: (string) | (null);
  retention_exception_code: ("legal_hold" | "billing_statutory" | "tax_statutory" | "security_investigation" | "backup_expiry_pending") | (null);
  recoverable_until: (string) | (null);
  correlation_id: string;
  created_at: string;
  updated_at: string;
  data_classification: "internal";
}

/** Source: contracts/schemas/data_legal_hold.schema.json; schema: https://schemas.axtro.ai/v2/data_legal_hold.schema.json; version: 2.0.0. */
export type DataLegalHold = {
  schema_version: "2.0.0";
  governance_version: "1.0.0";
  record_type: "command";
  operation: "create" | "release" | "expire";
  hold_id: string;
  tenant_id: string;
  command_id: string;
  receipt_id: null;
  scope_type: "artifact_set" | "data_subject";
  scope_hmac: string;
  artifact_count: number;
  purpose_code: "litigation" | "regulatory_inquiry" | "tax_audit" | "billing_dispute" | "contractual_claim" | "security_investigation";
  authority_code: "court_order" | "regulator_request" | "statutory_duty" | "counsel_instruction" | "contractual_preservation";
  authorized_by_actor_id: string;
  authorization_id: string;
  starts_at: string;
  expires_at: string;
  outcome: null;
  outcome_code: null;
  record_fingerprint: string;
  trace_id: string;
  correlation_id: string;
  recorded_at: string;
  data_classification: "internal";
}
  | {
  schema_version: "2.0.0";
  governance_version: "1.0.0";
  record_type: "receipt";
  operation: "create" | "release" | "expire";
  hold_id: string;
  tenant_id: string;
  command_id: string;
  receipt_id: string;
  scope_type: "artifact_set" | "data_subject";
  scope_hmac: null;
  artifact_count: number;
  purpose_code: "litigation" | "regulatory_inquiry" | "tax_audit" | "billing_dispute" | "contractual_claim" | "security_investigation";
  authority_code: "court_order" | "regulator_request" | "statutory_duty" | "counsel_instruction" | "contractual_preservation";
  authorized_by_actor_id: null;
  authorization_id: string;
  starts_at: string;
  expires_at: string;
  outcome: "created" | "released" | "expired" | "denied" | "conflict";
  outcome_code: ("authority_invalid" | "scope_invalid" | "already_active" | "already_released" | "not_due" | "policy_denied") | (null);
  record_fingerprint: string;
  trace_id: string;
  correlation_id: string;
  recorded_at: string;
  data_classification: "internal";
};

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

/** Source: contracts/schemas/event_delivery_receipt.schema.json; schema: https://schemas.axtro.ai/v2/event_delivery_receipt.schema.json; version: 2.0.0. */
export interface EventDeliveryReceipt {
  schema_version: "2.0.0";
  tenant_id: string;
  event_id: string;
  aggregate_id: string;
  aggregate_version: number;
  consumer_name: "session-timeline";
  event_fingerprint: string;
  trace_id: string;
  correlation_id: string;
  status: "published" | "retry_scheduled" | "dead_letter";
  attempt: number;
  max_attempts: number;
  failure_code: ("consumer_retryable" | "consumer_rejected" | "timeline_conflict" | "timeline_capacity" | "timeline_invalid" | "lease_expired" | "max_attempts_exhausted") | (null);
  effect_hash: (string) | (null);
  started_at: string;
  completed_at: string;
  data_classification: "internal";
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

/** Source: contracts/schemas/fake_provider_journal_entry.schema.json; schema: https://schemas.axtro.ai/v2/fake_provider_journal_entry.schema.json; version: 2.0.0. */
export interface FakeProviderJournalEntry {
  schema_version: "2.0.0";
  port_kind: "channel" | "realtime_model" | "stt" | "tts" | "avatar" | "meeting" | "telephony" | "tool" | "storage";
  operation: "channel.health" | "channel.estimateCost" | "channel.close" | "channel.open" | "channel.closeConnection" | "realtime_model.health" | "realtime_model.estimateCost" | "realtime_model.close" | "realtime_model.openSession" | "realtime_model.closeSession" | "stt.health" | "stt.estimateCost" | "stt.close" | "stt.transcribe" | "tts.health" | "tts.estimateCost" | "tts.close" | "tts.synthesize" | "avatar.health" | "avatar.estimateCost" | "avatar.close" | "avatar.render" | "meeting.health" | "meeting.estimateCost" | "meeting.close" | "meeting.join" | "meeting.leave" | "telephony.health" | "telephony.estimateCost" | "telephony.close" | "telephony.connect" | "telephony.disconnect" | "tool.health" | "tool.estimateCost" | "tool.close" | "storage.health" | "storage.estimateCost" | "storage.close" | "storage.read" | "storage.write";
  invocation: number;
  sequence: number;
  phase: "started" | "partial" | "completed" | "failed" | "cancelled" | "timed_out";
  simulated_at_ms: number;
  failure_code: null | "invalid_configuration" | "authentication" | "rate_limited" | "capacity" | "timeout" | "transient_network" | "provider_internal" | "unsupported_capability" | "policy_blocked" | "budget_blocked" | "cancelled" | "unknown";
}

/** Source: contracts/schemas/fake_provider_replay_descriptor.schema.json; schema: https://schemas.axtro.ai/v2/fake_provider_replay_descriptor.schema.json; version: 2.0.0. */
export interface FakeProviderReplayDescriptor {
  schema_version: "2.0.0";
  seed: string;
  scenario_hash: string;
}

/** Source: contracts/schemas/fake_provider_scenario.schema.json; schema: https://schemas.axtro.ai/v2/fake_provider_scenario.schema.json; version: 2.0.0. */
export interface FakeProviderScenario {
  schema_version: "2.0.0";
  seed: string;
  clock_start_ms?: number;
  plans?: Array<{
    operation: "channel.health" | "channel.estimateCost" | "channel.close" | "channel.open" | "channel.closeConnection" | "realtime_model.health" | "realtime_model.estimateCost" | "realtime_model.close" | "realtime_model.openSession" | "realtime_model.closeSession" | "stt.health" | "stt.estimateCost" | "stt.close" | "stt.transcribe" | "tts.health" | "tts.estimateCost" | "tts.close" | "tts.synthesize" | "avatar.health" | "avatar.estimateCost" | "avatar.close" | "avatar.render" | "meeting.health" | "meeting.estimateCost" | "meeting.close" | "meeting.join" | "meeting.leave" | "telephony.health" | "telephony.estimateCost" | "telephony.close" | "telephony.connect" | "telephony.disconnect" | "tool.health" | "tool.estimateCost" | "tool.close" | "storage.health" | "storage.estimateCost" | "storage.close" | "storage.read" | "storage.write";
    invocation?: number;
    delay_ms?: number;
    partial_count?: number;
    partial_interval_ms?: number;
    failure_code?: "invalid_configuration" | "authentication" | "rate_limited" | "capacity" | "transient_network" | "provider_internal" | "unsupported_capability" | "policy_blocked" | "budget_blocked" | "unknown";
    failure_phase?: "before_partials" | "after_partials";
  }>;
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

/** Source: contracts/schemas/meeting_terminal_notification_command.schema.json; schema: https://schemas.axtro.ai/v2/meeting_terminal_notification_command.schema.json; version: 2.0.0. */
export type MeetingTerminalNotificationCommand = {
  schema_version: "2.0.0";
  command_id: string;
  tenant_id: string;
  meeting_session_id: string;
  terminal_status: "ended" | "failed";
  template_version: 1;
  provider: "resend";
  provider_idempotency_key: string;
  attempt: number;
  dispatch_deadline_at: string;
  recipient_emails: Array<string>;
  workspace_name: string;
  agent_name: string;
  payload_frozen: true;
  subject: string;
  html: string;
  payload_fingerprint: string;
  data_classification: "restricted";
}
  | {
  schema_version: "2.0.0";
  command_id: string;
  tenant_id: string;
  meeting_session_id: string;
  terminal_status: "ended" | "failed";
  template_version: 1;
  provider: "resend";
  provider_idempotency_key: string;
  attempt: number;
  dispatch_deadline_at: string;
  recipient_emails: Array<string>;
  workspace_name: string;
  agent_name: string;
  payload_frozen: false;
  subject: null;
  html: null;
  payload_fingerprint: null;
  data_classification: "restricted";
};

/** Source: contracts/schemas/meeting_terminal_notification_delivery_receipt.schema.json; schema: https://schemas.axtro.ai/v2/meeting_terminal_notification_delivery_receipt.schema.json; version: 2.0.0. */
export type MeetingTerminalNotificationDeliveryReceipt = {
  schema_version: "2.0.0";
  tenant_id: string;
  notification_id: string;
  meeting_session_id: string;
  attempt: number;
  recipient_count: number;
  outcome: "provider_accepted";
  failure_code: null;
  provider_receipt_digest: string;
  observed_at: string;
  data_classification: "internal";
}
  | {
  schema_version: "2.0.0";
  tenant_id: string;
  notification_id: string;
  meeting_session_id: string;
  attempt: number;
  recipient_count: number;
  outcome: "simulated";
  failure_code: null;
  provider_receipt_digest: string;
  observed_at: string;
  data_classification: "internal";
}
  | {
  schema_version: "2.0.0";
  tenant_id: string;
  notification_id: string;
  meeting_session_id: string;
  attempt: number;
  recipient_count: number;
  outcome: "retry_scheduled";
  failure_code: "provider_rate_limited" | "provider_unavailable" | "provider_not_configured";
  provider_receipt_digest: null;
  observed_at: string;
  data_classification: "internal";
}
  | {
  schema_version: "2.0.0";
  tenant_id: string;
  notification_id: string;
  meeting_session_id: string;
  attempt: number;
  recipient_count: number;
  outcome: "dead_lettered";
  failure_code: "payload_invalid" | "recipient_invalid" | "recipient_authority_changed" | "provider_rejected" | "idempotency_conflict" | "attempt_budget_exhausted" | "idempotency_window_expired";
  provider_receipt_digest: null;
  observed_at: string;
  data_classification: "internal";
}
  | {
  schema_version: "2.0.0";
  tenant_id: string;
  notification_id: string;
  meeting_session_id: string;
  attempt: number;
  recipient_count: number;
  outcome: "ambiguous";
  failure_code: "provider_timeout" | "transport_unknown" | "provider_receipt_invalid";
  provider_receipt_digest: null;
  observed_at: string;
  data_classification: "internal";
}
  | {
  schema_version: "2.0.0";
  tenant_id: string;
  notification_id: string;
  meeting_session_id: string;
  attempt: number;
  recipient_count: number;
  outcome: "lease_expired";
  failure_code: "lease_expired";
  provider_receipt_digest: null;
  observed_at: string;
  data_classification: "internal";
}
  | {
  schema_version: "2.0.0";
  tenant_id: string;
  notification_id: string;
  meeting_session_id: string;
  attempt: number;
  recipient_count: 0;
  outcome: "suppressed";
  failure_code: "no_recipients";
  provider_receipt_digest: null;
  observed_at: string;
  data_classification: "internal";
};

/** Source: contracts/schemas/operator_reconciliation_receipt.schema.json; schema: https://schemas.axtro.ai/v2/operator_reconciliation_receipt.schema.json; version: 2.0.0. */
export interface OperatorReconciliationReceipt {
  schema_version: "2.0.0";
  receipt_id: string;
  tenant_id: string;
  reservation_id: string;
  evidence_fingerprint: string;
  operator_ids: Array<string>;
  outcome: "released_after_reconciliation" | "compensation_confirmed";
  recorded_at: string;
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

/** Source: contracts/schemas/portal_public_demo_action_result.schema.json; schema: https://schemas.axtro.ai/v2/portal_public_demo_action_result.schema.json; version: 2.0.0. */
export type PortalPublicDemoActionResult = {
  schema_version: "2.0.0";
  outcome: "applied";
  revision: number;
  surface: "overview" | "agent" | "knowledge" | "conversation";
  step: "welcome" | "context" | "conversation" | "handoff";
  commands_remaining: number;
  reason_code: null;
}
  | {
  schema_version: "2.0.0";
  outcome: "replayed";
  revision: number;
  surface: "overview" | "agent" | "knowledge" | "conversation";
  step: "welcome" | "context" | "conversation" | "handoff";
  commands_remaining: number;
  reason_code: "duplicate_command";
}
  | {
  schema_version: "2.0.0";
  outcome: "stale";
  revision: number;
  surface: "overview" | "agent" | "knowledge" | "conversation";
  step: "welcome" | "context" | "conversation" | "handoff";
  commands_remaining: number;
  reason_code: "revision_mismatch";
}
  | {
  schema_version: "2.0.0";
  outcome: "expired";
  revision: null;
  surface: null;
  step: null;
  commands_remaining: null;
  reason_code: "state_expired";
}
  | {
  schema_version: "2.0.0";
  outcome: "unavailable";
  revision: null;
  surface: null;
  step: null;
  commands_remaining: null;
  reason_code: "demo_unavailable";
};

/** Source: contracts/schemas/portal_public_demo_command.schema.json; schema: https://schemas.axtro.ai/v2/portal_public_demo_command.schema.json; version: 2.0.0. */
export interface PortalPublicDemoCommand {
  schema_version: "2.0.0";
  command_id: string;
  expected_revision: number;
  command: "open_overview" | "inspect_agent" | "inspect_knowledge" | "inspect_conversation" | "advance" | "reset";
}

/** Source: contracts/schemas/portal_public_demo_signed_state_payload.schema.json; schema: https://schemas.axtro.ai/v2/portal_public_demo_signed_state_payload.schema.json; version: 2.0.0. */
export interface PortalPublicDemoSignedStatePayload {
  schema_version: "2.0.0";
  fixture_version: "1.0.0";
  demo_session_id: string;
  revision: number;
  seen_commands: Array<{
    command_id: string;
    expected_revision: number;
    command: "open_overview" | "inspect_agent" | "inspect_knowledge" | "inspect_conversation" | "advance" | "reset";
  }>;
  surface: "overview" | "agent" | "knowledge" | "conversation";
  step: "welcome" | "context" | "conversation" | "handoff";
  issued_at: string;
  expires_at: string;
}

/** Source: contracts/schemas/portal_text_preview_action_result.schema.json; schema: https://schemas.axtro.ai/v2/portal_text_preview_action_result.schema.json; version: 2.0.0. */
export type PortalTextPreviewActionResult = {
  schema_version: "2.0.0";
  outcome: "success";
  reply: string;
  error: null;
  stateToken: string;
  persistence: "disabled" | "saved" | "not_saved";
}
  | {
  schema_version: "2.0.0";
  outcome: "failure";
  reply: null;
  error: string;
  stateToken: null;
  persistence: "disabled" | "not_saved";
};

/** Source: contracts/schemas/portal_text_preview_admission.schema.json; schema: https://schemas.axtro.ai/v2/portal_text_preview_admission.schema.json; version: 2.0.0. */
export type PortalTextPreviewAdmission = {
  schema_version: "2.0.0";
  admission_id: string;
  tenant_id: string;
  actor_id: string;
  agent_id: string;
  session_id: string;
  presenter_id: string;
  profile_id: "openrouter_portal_text_essential_v1";
  profile_version: "1.0.0";
  profile_fingerprint: "sha256:5f07f0bb93393c7fcd4412516db48f30fb3095fb31e9352cd2cf849b260a5173";
  provider_configuration_fingerprint: "sha256:70e60ec32d8a29d0f6264a0545e2ea1d215d02fe164d90dadaa63e99e59472de";
  client_session_ref_hash: string;
  command_fingerprint: string;
  identity_disclosure_id: string;
  data_use_disclosure_id: string;
  essential_consent_id: string;
  privacy_policy_id: string;
  jurisdiction: string;
  privacy_policy_version: string;
  privacy_policy_fingerprint: string;
  transcript_consent_id: null;
  transcript_id: null;
  persistent_transcript: false;
  status: "issued" | "expired";
  ttl_seconds: 3600;
  issued_at: string;
  expires_at: string;
}
  | {
  schema_version: "2.0.0";
  admission_id: string;
  tenant_id: string;
  actor_id: string;
  agent_id: string;
  session_id: string;
  presenter_id: string;
  profile_id: "openrouter_portal_text_persisted_v1";
  profile_version: "1.0.0";
  profile_fingerprint: "sha256:5062dd979ac79778052389f27069a16dfa8f33fb175d38181774415b1ff585b8";
  provider_configuration_fingerprint: "sha256:70e60ec32d8a29d0f6264a0545e2ea1d215d02fe164d90dadaa63e99e59472de";
  client_session_ref_hash: string;
  command_fingerprint: string;
  identity_disclosure_id: string;
  data_use_disclosure_id: string;
  essential_consent_id: string;
  privacy_policy_id: string;
  jurisdiction: string;
  privacy_policy_version: string;
  privacy_policy_fingerprint: string;
  transcript_consent_id: string;
  transcript_id: string;
  persistent_transcript: true;
  status: "issued" | "expired";
  ttl_seconds: 3600;
  issued_at: string;
  expires_at: string;
};

/** Source: contracts/schemas/portal_text_preview_browser_command.schema.json; schema: https://schemas.axtro.ai/v2/portal_text_preview_browser_command.schema.json; version: 2.0.0. */
export interface PortalTextPreviewBrowserCommand {
  schema_version: "2.0.0";
  agentId: string;
  clientConversationId: string;
  commandId: string;
  userMessage: string;
  stateToken: (string) | (null);
  aiIdentityAcknowledged: true;
  essentialProcessingAccepted: true;
  persistentTranscript: boolean;
}

/** Source: contracts/schemas/portal_text_preview_signed_state_payload.schema.json; schema: https://schemas.axtro.ai/v2/portal_text_preview_signed_state_payload.schema.json; version: 2.0.0. */
export interface PortalTextPreviewSignedStatePayload {
  schema_version: "2.0.0";
  admission_id: string;
  binding_fingerprint: string;
  profile_id: "openrouter_portal_text_essential_v1" | "openrouter_portal_text_persisted_v1";
  profile_version: "1.0.0";
  profile_fingerprint: string;
  generation: number;
  turns: Array<({
    role: "user";
    content: string;
  }) | ({
    role: "assistant";
    content: string;
  })>;
  issued_at: string;
  expires_at: string;
}

/** Source: contracts/schemas/post_call_workflow_command.schema.json; schema: https://schemas.axtro.ai/v2/post_call_workflow_command.schema.json; version: 2.0.0. */
export interface PostCallWorkflowCommand {
  schema_version: "2.0.0";
  command_id: string;
  tenant_id: string;
  session_id: string;
  workflow_type: "post_call_processing";
  workflow_version: "1.0.0";
  aggregate_type: "interaction_session";
  source_event_id: string;
  source_event_fingerprint: string;
  source_aggregate_version: number;
  source_state_hash: string;
  trace_id: string;
  correlation_id: string;
  causation_id: (string) | (null);
  idempotency_key: string;
  requested_by: string;
  scheduled_at: string;
  created_at: string;
  data_classification: "internal";
}

/** Source: contracts/schemas/post_call_workflow_result.schema.json; schema: https://schemas.axtro.ai/v2/post_call_workflow_result.schema.json; version: 2.0.0. */
export interface PostCallWorkflowResult {
  schema_version: "2.0.0";
  tenant_id: string;
  session_id: string;
  workflow_run_id: string;
  command_id: string;
  source_event_id: string;
  source_event_fingerprint: string;
  source_aggregate_version: number;
  source_state_hash: string;
  trace_id: string;
  correlation_id: string;
  causation_id: (string) | (null);
  summary: {
    template_code: "deterministic_session_summary_v1";
    text: string;
    canonical_event_count: number;
    final_state_version: number;
  };
  evaluation: {
    evaluator_version: "fake-structural-v1";
    outcome: "passed" | "review_required";
    score_basis_points: number;
    evidence_event_ids: Array<string>;
  };
  follow_up_guard: {
    command_id: string;
    mode: "deterministic_noop";
    status: "not_sent";
    external_effect: false;
    effect_hash: string;
  };
  result_hash: string;
  completed_at: string;
  data_classification: "restricted";
}

/** Source: contracts/schemas/post_call_workflow_status.schema.json; schema: https://schemas.axtro.ai/v2/post_call_workflow_status.schema.json; version: 2.0.0. */
export interface PostCallWorkflowStatus {
  schema_version: "2.0.0";
  workflow_run_id: string;
  command_id: string;
  tenant_id: string;
  session_id: string;
  source_event_id: string;
  source_event_fingerprint: string;
  source_aggregate_version: number;
  source_state_hash: string;
  trace_id: string;
  correlation_id: string;
  causation_id: (string) | (null);
  status: "queued" | "running" | "waiting" | "completed" | "failed" | "cancelled";
  current_step: "generate_summary" | "evaluate" | "record_follow_up_guard" | "finalize";
  state_version: number;
  attempts: number;
  max_attempts: number;
  next_attempt_at: (string) | (null);
  last_error_code: ("activity_retryable" | "lease_expired" | "max_attempts_exhausted" | "invalid_source" | "policy_denied" | "internal_failure") | (null);
  result_hash: (string) | (null);
  started_at: (string) | (null);
  updated_at: string;
  completed_at: (string) | (null);
  cancelled_at: (string) | (null);
  data_classification: "internal";
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

/** Source: contracts/schemas/provider_effect_termination_result.schema.json; schema: https://schemas.axtro.ai/v2/provider_effect_termination_result.schema.json; version: 2.0.0. */
export interface ProviderEffectTerminationResult {
  schema_version: "2.0.0";
  outcome: "accepted" | "disabled" | "in_progress" | "retry_after" | "operator_required" | "not_started" | "not_stoppable" | "retryable_failure";
}

/** Source: contracts/schemas/provider_processing_profile.schema.json; schema: https://schemas.axtro.ai/v2/provider_processing_profile.schema.json; version: 2.0.0. */
export interface ProviderProcessingProfile {
  schema_version: "2.0.0";
  profile_id: string;
  profile_version: string;
  provider_id: string;
  channel_kind: "portal_text" | "tavus_video" | "recall_meeting";
  mode: "text" | "video" | "presentation" | "external_meeting";
  recording_mode: "off" | "participant_opt_in" | "automatic";
  persistent_transcript_mode: "off" | "application_opt_in" | "provider_required" | "hard_delete_after_call";
  perception_mode: "off" | "full";
  regional_policy: "eu" | "unset";
  required_consent_purposes: Array<"recording" | "persistent_transcription" | "behavioral_analysis" | "visual_analysis">;
  performed_processing_purposes: Array<"recording" | "persistent_transcription" | "behavioral_analysis" | "visual_analysis">;
  channel_features: Array<"scene_presentation">;
  essential_only_eligible: boolean;
  reviewed_at: string;
  review_ttl_hours: number;
  verification_mode: "code_owned" | "provider_readback";
  verification_ttl_hours: number;
  sources: Array<string>;
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

/** Source: contracts/schemas/runtime_channel_admission.schema.json; schema: https://schemas.axtro.ai/v2/runtime_channel_admission.schema.json; version: 2.0.0. */
export interface RuntimeChannelAdmission {
  schema_version: "2.0.0";
  admission_id: string;
  tenant_id: string;
  actor_id: string;
  agent_id: string;
  session_id: string;
  presenter_id: string;
  channel_kind: "tavus_video" | "recall_meeting";
  capabilities: Array<"recording" | "persistent_transcription" | "behavioral_analysis" | "visual_analysis" | "scene_presentation">;
  command_fingerprint: string;
  generation: number;
  disclosure_id: string;
  essential_consent_id: string;
  status: "issued" | "blocked" | "expired";
  issued_at: string;
  expires_at: string;
}

/** Source: contracts/schemas/runtime_channel_grant.schema.json; schema: https://schemas.axtro.ai/v2/runtime_channel_grant.schema.json; version: 2.0.0. */
export interface RuntimeChannelGrant {
  schema_version: "2.0.0";
  grant_id: string;
  admission_id: string;
  tenant_id: string;
  session_id: string;
  command_fingerprint: string;
  consumer_kind: "tavus" | "recall" | "scene";
  state: "issued" | "consumed" | "rejected" | "expired";
  generation: number;
  issued_at: string;
  expires_at: string;
  consumed_at: string | null;
}

/** Source: contracts/schemas/runtime_configuration.schema.json; schema: https://schemas.axtro.ai/v2/runtime_configuration.schema.json; version: 2.0.0. */
export interface RuntimeConfiguration {
  schema_version: "2.0.0";
  environment: "development" | "test" | "staging" | "canary" | "production";
  service_name: "api" | "realtime-worker" | "axtro-supervisor" | "meeting-bot-worker" | "workflow-worker" | "event-relay";
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

/** Source: contracts/schemas/scene_execution_receipt.schema.json; schema: https://schemas.axtro.ai/v2/scene_execution_receipt.schema.json; version: 2.0.0. */
export interface SceneExecutionReceipt {
  schema_version: "2.0.0";
  receipt_id: string;
  tenant_id: string;
  session_id: string;
  grant_id: string;
  scene_id: string;
  manifest_id: string;
  generation: number;
  outcome: "succeeded" | "rejected_stale_generation" | "rejected_policy" | "failed";
  effect_hash: string | null;
  recorded_at: string;
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

/** Source: contracts/schemas/session_state_snapshot.schema.json; schema: https://schemas.axtro.ai/v2/session_state_snapshot.schema.json; version: 2.0.0. */
export interface SessionStateSnapshot {
  schema_version: "2.0.0";
  snapshot_id: string;
  tenant_id: string;
  session_id: string;
  aggregate_version: number;
  state: {
    schema_version: "2.0.0";
    session: InteractionSessionState;
    conversation: ConversationState;
    role: RoleState;
    quality: InteractionQualityState;
    extensions: {
      sales?: SalesState;
    };
  };
  state_hash: string;
  created_at: string;
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

/** Source: contracts/schemas/turn_committed.schema.json; schema: https://schemas.axtro.ai/v2/turn_committed.schema.json; version: 2.0.0. */
export interface TurnCommitted {
  schema_version: "2.0.0";
  speaker_participant_id: string;
  speaker_role: "participant" | "presenter";
  transcript_text: string;
  generation_id: number | null;
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
}

/** Source: contracts/schemas/turn_outcome_recorded.schema.json; schema: https://schemas.axtro.ai/v2/turn_outcome_recorded.schema.json; version: 2.0.0. */
export type TurnOutcomeRecorded = {
  schema_version: "2.0.0";
  claim_id: string;
  generation: number;
  outcome: "succeeded";
  reason_code: "generation_succeeded";
  persistence: "disabled" | "persisted";
  resulting_turn_index: number;
}
  | {
  schema_version: "2.0.0";
  claim_id: string;
  generation: number;
  outcome: "failed";
  reason_code: "generation_failed" | "generated_reply_invalid" | "provider_response_uncommitted" | "state_issue_failed" | "session_expired" | "worker_lost";
  persistence: null;
  resulting_turn_index: number;
};

/** Source: contracts/schemas/turn_submission.schema.json; schema: https://schemas.axtro.ai/v2/turn_submission.schema.json; version: 2.0.0. */
export interface TurnSubmission {
  schema_version: "2.0.0";
  speaker_participant_id: string;
  text: string;
  language: string;
  client_turn_id: string;
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

/** Source: contracts/schemas/workflow_enqueue_receipt.schema.json; schema: https://schemas.axtro.ai/v2/workflow_enqueue_receipt.schema.json; version: 2.0.0. */
export interface WorkflowEnqueueReceipt {
  schema_version: "2.0.0";
  tenant_id: string;
  session_id: string;
  source_event_id: string;
  source_event_fingerprint: string;
  command_id: string;
  workflow_run_id: string;
  command_fingerprint: string;
  trace_id: string;
  correlation_id: string;
  enqueued_at: string;
  data_classification: "internal";
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

/** Source: contracts/schemas/workflow_step_receipt.schema.json; schema: https://schemas.axtro.ai/v2/workflow_step_receipt.schema.json; version: 2.0.0. */
export interface WorkflowStepReceipt {
  schema_version: "2.0.0";
  tenant_id: string;
  session_id: string;
  workflow_run_id: string;
  command_id: string;
  source_event_id: string;
  step: "generate_summary" | "evaluate" | "record_follow_up_guard" | "finalize";
  attempt: number;
  outcome: "checkpointed" | "retry_scheduled" | "completed" | "cancelled" | "failed";
  artifact_hash: (string) | (null);
  failure_code: ("activity_retryable" | "lease_expired" | "max_attempts_exhausted" | "invalid_source" | "policy_denied" | "internal_failure") | (null);
  trace_id: string;
  correlation_id: string;
  started_at: string;
  completed_at: string;
  data_classification: "internal";
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
  "BillingCheckoutIntent": {
    "schema_id": "https://schemas.axtro.ai/v2/billing_checkout_intent.schema.json",
    "schema_version": "2.0.0",
    "source_hash": "6d33517d05dcfdd2371a51f3496f16de81e3d983dc6ba393b50a7a876e0e6c0b",
    "source_schema": "contracts/schemas/billing_checkout_intent.schema.json"
  },
  "CatalogLookupCommand": {
    "schema_id": "https://schemas.axtro.ai/v2/catalog_lookup_command.schema.json",
    "schema_version": "2.0.0",
    "source_hash": "c4a96b99df44cd0cc22f400288f979989500e5c19430371fdedbfff834d0058f",
    "source_schema": "contracts/schemas/catalog_lookup_command.schema.json"
  },
  "ConsentEvidence": {
    "schema_id": "https://schemas.axtro.ai/v2/consent_evidence.schema.json",
    "schema_version": "2.0.0",
    "source_hash": "e32abed9a45aa9a83d90e4e66b114f2d1907ea1968e5076ca93674593ff59c4a",
    "source_schema": "contracts/schemas/consent_evidence.schema.json"
  },
  "ContextComposition": {
    "schema_id": "https://schemas.axtro.ai/v2/context_composition.schema.json",
    "schema_version": "2.0.0",
    "source_hash": "3223132fff19d049280b8a9d96d5e0ceaf28109e201b175c7ac7c02a66b40104",
    "source_schema": "contracts/schemas/context_composition.schema.json"
  },
  "ConversationState": {
    "schema_id": "https://schemas.axtro.ai/v2/conversation_state.schema.json",
    "schema_version": "2.0.0",
    "source_hash": "c71e46f815a16e256efd8088a9a598797e22fe2f31fc4e375e2d2daa32baeeec",
    "source_schema": "contracts/schemas/conversation_state.schema.json"
  },
  "CostEvent": {
    "schema_id": "https://schemas.axtro.ai/v2/cost_event.schema.json",
    "schema_version": "2.1.0",
    "source_hash": "3f8f3dc18a2c6b4f2a910d50059d5cec21549fe58c6f2926a8e4baacf5724858",
    "source_schema": "contracts/schemas/cost_event.schema.json"
  },
  "DataGovernanceCommand": {
    "schema_id": "https://schemas.axtro.ai/v2/data_governance_command.schema.json",
    "schema_version": "2.0.0",
    "source_hash": "a951513ea7912c0ea5f3caa21f23e2e589df59a404bc73bc4b996c0418c7e77a",
    "source_schema": "contracts/schemas/data_governance_command.schema.json"
  },
  "DataGovernanceReceipt": {
    "schema_id": "https://schemas.axtro.ai/v2/data_governance_receipt.schema.json",
    "schema_version": "2.0.0",
    "source_hash": "c5e8f196fae7abf78e179f9bf2b860f8fc142090a87260ef930cc12a7fe87e49",
    "source_schema": "contracts/schemas/data_governance_receipt.schema.json"
  },
  "DataGovernanceStatus": {
    "schema_id": "https://schemas.axtro.ai/v2/data_governance_status.schema.json",
    "schema_version": "2.0.0",
    "source_hash": "b1b22828931c0aa6dbb7f60adb0c2da9df26a37e20ac3998ba302d5df4dbb3ba",
    "source_schema": "contracts/schemas/data_governance_status.schema.json"
  },
  "DataGovernanceWorkItem": {
    "schema_id": "https://schemas.axtro.ai/v2/data_governance_work_item.schema.json",
    "schema_version": "2.0.0",
    "source_hash": "e12a108f30334253019d78014659898358cd4f8f0938ac1006fd8f7918d8b1e0",
    "source_schema": "contracts/schemas/data_governance_work_item.schema.json"
  },
  "DataLegalHold": {
    "schema_id": "https://schemas.axtro.ai/v2/data_legal_hold.schema.json",
    "schema_version": "2.0.0",
    "source_hash": "682efd3dc042a0e8ba84772d2588a2966382668b76e74d4bd5cf0e418b79f5db",
    "source_schema": "contracts/schemas/data_legal_hold.schema.json"
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
  "EventDeliveryReceipt": {
    "schema_id": "https://schemas.axtro.ai/v2/event_delivery_receipt.schema.json",
    "schema_version": "2.0.0",
    "source_hash": "a700b1fb8877c8bcc7816bf3c8a4911840b210d1e5262897ef32610d5da6c7fa",
    "source_schema": "contracts/schemas/event_delivery_receipt.schema.json"
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
  "MeetingTerminalNotificationCommand": {
    "schema_id": "https://schemas.axtro.ai/v2/meeting_terminal_notification_command.schema.json",
    "schema_version": "2.0.0",
    "source_hash": "3ac79fb2328de8cb85cfa46cf3323af52d72db7432f8bf726d0e20de091433ce",
    "source_schema": "contracts/schemas/meeting_terminal_notification_command.schema.json"
  },
  "MeetingTerminalNotificationDeliveryReceipt": {
    "schema_id": "https://schemas.axtro.ai/v2/meeting_terminal_notification_delivery_receipt.schema.json",
    "schema_version": "2.0.0",
    "source_hash": "ee88c29276a3e4ee41322239cbba919e7e774047bed3c4c60e30c9147b2127a3",
    "source_schema": "contracts/schemas/meeting_terminal_notification_delivery_receipt.schema.json"
  },
  "OperatorReconciliationReceipt": {
    "schema_id": "https://schemas.axtro.ai/v2/operator_reconciliation_receipt.schema.json",
    "schema_version": "2.0.0",
    "source_hash": "067ab4e15b9317440f7d671f5334952935cc4378e5d870e2dcde4ac269b44422",
    "source_schema": "contracts/schemas/operator_reconciliation_receipt.schema.json"
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
  "PortalPublicDemoActionResult": {
    "schema_id": "https://schemas.axtro.ai/v2/portal_public_demo_action_result.schema.json",
    "schema_version": "2.0.0",
    "source_hash": "ea9d740772cc44291b7261b5b41b4ae897c65a5d68dc228183c862c559ec14c9",
    "source_schema": "contracts/schemas/portal_public_demo_action_result.schema.json"
  },
  "PortalPublicDemoCommand": {
    "schema_id": "https://schemas.axtro.ai/v2/portal_public_demo_command.schema.json",
    "schema_version": "2.0.0",
    "source_hash": "405be3fdf7dc24ceff498225db4dbadf4ef8aaa4206662c4ec0c8ac3e3bf10f3",
    "source_schema": "contracts/schemas/portal_public_demo_command.schema.json"
  },
  "PortalPublicDemoSignedStatePayload": {
    "schema_id": "https://schemas.axtro.ai/v2/portal_public_demo_signed_state_payload.schema.json",
    "schema_version": "2.0.0",
    "source_hash": "6c65cd32935c26d1762e6362133342b310d7b16e631d944b7b7f2c7f90e69be7",
    "source_schema": "contracts/schemas/portal_public_demo_signed_state_payload.schema.json"
  },
  "PortalTextPreviewActionResult": {
    "schema_id": "https://schemas.axtro.ai/v2/portal_text_preview_action_result.schema.json",
    "schema_version": "2.0.0",
    "source_hash": "dbe118fb8d8c6ad9019d74ab22099116060bcefb1d133b78d490402312532ea3",
    "source_schema": "contracts/schemas/portal_text_preview_action_result.schema.json"
  },
  "PortalTextPreviewAdmission": {
    "schema_id": "https://schemas.axtro.ai/v2/portal_text_preview_admission.schema.json",
    "schema_version": "2.0.0",
    "source_hash": "7991b463bd1fd87ba7a8666e0a24ed5658e0eafcb146969d10fe1967a558d885",
    "source_schema": "contracts/schemas/portal_text_preview_admission.schema.json"
  },
  "PortalTextPreviewBrowserCommand": {
    "schema_id": "https://schemas.axtro.ai/v2/portal_text_preview_browser_command.schema.json",
    "schema_version": "2.0.0",
    "source_hash": "6459fab48dd15e3330ec9beaab2dc0e94e7417109eaaea369d170d095e052cba",
    "source_schema": "contracts/schemas/portal_text_preview_browser_command.schema.json"
  },
  "PortalTextPreviewSignedStatePayload": {
    "schema_id": "https://schemas.axtro.ai/v2/portal_text_preview_signed_state_payload.schema.json",
    "schema_version": "2.0.0",
    "source_hash": "c141a591a5fecd850918c5a1af7d8cdf49322cfd038cb2a1a4f2bb717087617a",
    "source_schema": "contracts/schemas/portal_text_preview_signed_state_payload.schema.json"
  },
  "PostCallWorkflowCommand": {
    "schema_id": "https://schemas.axtro.ai/v2/post_call_workflow_command.schema.json",
    "schema_version": "2.0.0",
    "source_hash": "0fdffe812b859616318646996c7f95b219e6bc46aeeee4467f3549a35627aff4",
    "source_schema": "contracts/schemas/post_call_workflow_command.schema.json"
  },
  "PostCallWorkflowResult": {
    "schema_id": "https://schemas.axtro.ai/v2/post_call_workflow_result.schema.json",
    "schema_version": "2.0.0",
    "source_hash": "5a3b803ba9c8e0598c0d6fa545cde750b8db38d9841aa92d5179b630b67a0827",
    "source_schema": "contracts/schemas/post_call_workflow_result.schema.json"
  },
  "PostCallWorkflowStatus": {
    "schema_id": "https://schemas.axtro.ai/v2/post_call_workflow_status.schema.json",
    "schema_version": "2.0.0",
    "source_hash": "b44cb08eb0bb6a6c0f50a2034d5f87d801bfc3882fb870e20521f1153e010a65",
    "source_schema": "contracts/schemas/post_call_workflow_status.schema.json"
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
  "ProviderEffectTerminationResult": {
    "schema_id": "https://schemas.axtro.ai/v2/provider_effect_termination_result.schema.json",
    "schema_version": "2.0.0",
    "source_hash": "237787f98aaad567d64b8a7cd74fa86bc5722295418ae964a2cdc21b82e4f816",
    "source_schema": "contracts/schemas/provider_effect_termination_result.schema.json"
  },
  "ProviderProcessingProfile": {
    "schema_id": "https://schemas.axtro.ai/v2/provider_processing_profile.schema.json",
    "schema_version": "2.0.0",
    "source_hash": "51f53cd19191572db66000ee72cb69440a1e7aa6ca0d5d2acbc8ddb1d8566c9b",
    "source_schema": "contracts/schemas/provider_processing_profile.schema.json"
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
  "RuntimeChannelAdmission": {
    "schema_id": "https://schemas.axtro.ai/v2/runtime_channel_admission.schema.json",
    "schema_version": "2.0.0",
    "source_hash": "2d8798f23a9487f65c3ef7d2ed4639a9a70b45d701e47a1fe628762b2918b75c",
    "source_schema": "contracts/schemas/runtime_channel_admission.schema.json"
  },
  "RuntimeChannelGrant": {
    "schema_id": "https://schemas.axtro.ai/v2/runtime_channel_grant.schema.json",
    "schema_version": "2.0.0",
    "source_hash": "ea37079e1707131cee7750b3bd387a08bfc01defd05752409274f660645f2e84",
    "source_schema": "contracts/schemas/runtime_channel_grant.schema.json"
  },
  "RuntimeConfiguration": {
    "schema_id": "https://schemas.axtro.ai/v2/runtime_configuration.schema.json",
    "schema_version": "2.0.0",
    "source_hash": "437a3e0a5dfba4db44d655ae68cb35a88b91d1347b0d332ebfcf12f54a6b6dc8",
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
  "SceneExecutionReceipt": {
    "schema_id": "https://schemas.axtro.ai/v2/scene_execution_receipt.schema.json",
    "schema_version": "2.0.0",
    "source_hash": "cfafb1dbee4a1f01666d011ffd4eb01f5d34ba5b4dc1aa13ea244350c20b7425",
    "source_schema": "contracts/schemas/scene_execution_receipt.schema.json"
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
  "SessionStateSnapshot": {
    "schema_id": "https://schemas.axtro.ai/v2/session_state_snapshot.schema.json",
    "schema_version": "2.0.0",
    "source_hash": "cd600b47ca54f45587340db37b0db76ae2a885dfef300261cc9613ead203262a",
    "source_schema": "contracts/schemas/session_state_snapshot.schema.json"
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
  "TurnOutcomeRecorded": {
    "schema_id": "https://schemas.axtro.ai/v2/turn_outcome_recorded.schema.json",
    "schema_version": "2.0.0",
    "source_hash": "bc489b0b0b8d853a2025278951d482dc1612410cf4c3e83401809c03c9d4f288",
    "source_schema": "contracts/schemas/turn_outcome_recorded.schema.json"
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
  "WorkflowEnqueueReceipt": {
    "schema_id": "https://schemas.axtro.ai/v2/workflow_enqueue_receipt.schema.json",
    "schema_version": "2.0.0",
    "source_hash": "ba8b21575e77cd39cdd760cbeafadb6d99fc5448456520112342eee6e1038b63",
    "source_schema": "contracts/schemas/workflow_enqueue_receipt.schema.json"
  },
  "WorkflowStatus": {
    "schema_id": "https://schemas.axtro.ai/v2/workflow_status.schema.json",
    "schema_version": "2.0.0",
    "source_hash": "290e0011bbed957d83af4d12a5d720721a41077e9965553f5920bc8e2961599f",
    "source_schema": "contracts/schemas/workflow_status.schema.json"
  },
  "WorkflowStepReceipt": {
    "schema_id": "https://schemas.axtro.ai/v2/workflow_step_receipt.schema.json",
    "schema_version": "2.0.0",
    "source_hash": "558c0cf2aea2ca30e1f24a173575f40bed7e0b4b2b04da9c2bf1e6dc5b88f45d",
    "source_schema": "contracts/schemas/workflow_step_receipt.schema.json"
  }
} as const satisfies Record<string, ContractMetadata>;
