-- M6-04: durable, fail-closed data disposition and legal-hold control plane.
-- This migration is expand-only. It does not execute a customer disposition.
begin;

create table public.data_governance_resource_catalog (
  resource_code text primary key check (resource_code ~ '^[a-z][a-z0-9_]{2,95}$'),
  surface text not null check (surface in (
    'database','object_storage','cache','embedding_index','provider_copy',
    'auth_identity','vault_secret','backup'
  )),
  relation_name text,
  catalog_generation text not null check (catalog_generation in ('pre_v59','v59_control','external')),
  default_action text not null check (default_action in (
    'redact','irreversible_delete','retain_content_free','external_delete',
    'cache_invalidate','crypto_erase','backup_expiry_wait'
  )),
  subject_link_required boolean not null,
  retained_exception boolean not null default false,
  inventory_order smallint not null check (inventory_order between 1 and 120),
  check (
    (surface='database' and relation_name ~ '^public\.[a-z][a-z0-9_]{1,62}$')
    or (surface<>'database' and relation_name is null)
  ),
  unique (surface,relation_name),
  unique (inventory_order)
);

insert into public.data_governance_resource_catalog(
  resource_code,surface,relation_name,catalog_generation,default_action,
  subject_link_required,retained_exception,inventory_order
) values
  ('db_tenant_settings','database','public.tenant_settings','pre_v59','irreversible_delete',false,false,1),
  ('db_service_identities','database','public.service_identities','pre_v59','irreversible_delete',false,false,2),
  ('db_agents','database','public.agents','pre_v59','irreversible_delete',false,false,3),
  ('db_agent_deployments','database','public.agent_deployments','pre_v59','irreversible_delete',false,false,4),
  ('db_role_pack_installations','database','public.role_pack_installations','pre_v59','irreversible_delete',false,false,5),
  ('db_skill_pack_installations','database','public.skill_pack_installations','pre_v59','irreversible_delete',false,false,6),
  ('db_provider_connections','database','public.provider_connections','pre_v59','crypto_erase',false,false,7),
  ('db_contact_profiles','database','public.contact_profiles','pre_v59','crypto_erase',true,false,8),
  ('db_sessions','database','public.sessions','pre_v59','irreversible_delete',true,false,9),
  ('db_session_participants','database','public.session_participants','pre_v59','irreversible_delete',true,false,10),
  ('db_session_state_snapshots','database','public.session_state_snapshots','pre_v59','irreversible_delete',true,false,11),
  ('db_session_timeline','database','public.session_timeline','pre_v59','redact',true,false,12),
  ('db_conversation_turns','database','public.conversation_turns','pre_v59','irreversible_delete',true,false,13),
  ('db_consent_evidence','database','public.consent_evidence','pre_v59','redact',true,false,14),
  ('db_disclosure_records','database','public.disclosure_records','pre_v59','retain_content_free',true,true,15),
  ('db_session_health','database','public.session_health','pre_v59','irreversible_delete',true,false,16),
  ('db_action_intents','database','public.action_intents','pre_v59','redact',true,false,17),
  ('db_policy_decisions','database','public.policy_decisions','pre_v59','redact',true,false,18),
  ('db_human_approvals','database','public.human_approvals','pre_v59','redact',true,false,19),
  ('db_tool_executions','database','public.tool_executions','pre_v59','redact',true,false,20),
  ('db_tool_receipts','database','public.tool_receipts','pre_v59','retain_content_free',true,true,21),
  ('db_handoffs','database','public.handoffs','pre_v59','redact',true,false,22),
  ('db_knowledge_sources','database','public.knowledge_sources','pre_v59','irreversible_delete',false,false,23),
  ('db_knowledge_versions','database','public.knowledge_versions','pre_v59','irreversible_delete',false,false,24),
  ('db_knowledge_chunks','database','public.knowledge_chunks','pre_v59','irreversible_delete',false,false,25),
  ('db_knowledge_embeddings','database','public.knowledge_embeddings','pre_v59','irreversible_delete',false,false,26),
  ('db_workflow_runs','database','public.workflow_runs','pre_v59','redact',true,false,27),
  ('db_audit_log','database','public.audit_log','pre_v59','retain_content_free',true,true,28),
  ('db_events_outbox','database','public.events_outbox','pre_v59','redact',true,false,29),
  ('db_cost_events','database','public.cost_events','pre_v59','retain_content_free',false,true,30),
  ('db_usage_ledger','database','public.usage_ledger','pre_v59','retain_content_free',false,true,31),
  ('db_evaluation_runs','database','public.evaluation_runs','pre_v59','redact',true,false,32),
  ('db_experiment_candidates','database','public.experiment_candidates','pre_v59','redact',false,false,33),
  ('db_deployment_promotions','database','public.deployment_promotions','pre_v59','retain_content_free',false,true,34),
  ('db_workflow_commands','database','public.workflow_commands','pre_v59','redact',true,false,35),
  ('db_workflow_step_receipts','database','public.workflow_step_receipts','pre_v59','redact',true,false,36),
  ('db_post_call_workflow_results','database','public.post_call_workflow_results','pre_v59','redact',true,false,37),
  ('db_post_call_workflow_result_evidence','database','public.post_call_workflow_result_evidence','pre_v59','redact',true,false,38),
  ('db_user_tenant_memberships','database','public.user_tenant_memberships','pre_v59','irreversible_delete',false,false,39),
  ('db_tenant_invites','database','public.tenant_invites','pre_v59','irreversible_delete',false,false,40),
  ('db_ai_usage_reconciliation_receipts','database','public.ai_usage_reconciliation_receipts','pre_v59','retain_content_free',false,true,41),
  ('db_ai_usage_reservations','database','public.ai_usage_reservations','pre_v59','retain_content_free',false,true,42),
  ('db_billing_checkout_intents','database','public.billing_checkout_intents','pre_v59','retain_content_free',false,true,43),
  ('db_billing_stripe_event_receipts','database','public.billing_stripe_event_receipts','pre_v59','retain_content_free',false,true,44),
  ('db_billing_usage_outbox','database','public.billing_usage_outbox','pre_v59','retain_content_free',false,true,45),
  ('db_recall_webhook_deliveries','database','public.recall_webhook_deliveries','pre_v59','retain_content_free',false,true,46),
  ('db_tavus_customer_delivery_receipts','database','public.tavus_customer_delivery_receipts','pre_v59','retain_content_free',false,true,47),
  ('db_tavus_stage_capabilities','database','public.tavus_stage_capabilities','pre_v59','crypto_erase',false,false,48),
  ('db_tavus_webhook_deliveries','database','public.tavus_webhook_deliveries','pre_v59','retain_content_free',false,true,49),
  ('db_tenant_cost_alerts','database','public.tenant_cost_alerts','pre_v59','retain_content_free',false,true,50),
  ('db_tenant_subscriptions','database','public.tenant_subscriptions','pre_v59','retain_content_free',false,true,51),
  ('db_agent_video_config','database','public.agent_video_config','pre_v59','irreversible_delete',false,false,52),
  ('db_agent_brain_config','database','public.agent_brain_config','pre_v59','irreversible_delete',false,false,53),
  ('db_conversation_transcripts','database','public.conversation_transcripts','pre_v59','irreversible_delete',true,false,54),
  ('db_meeting_bot_sessions','database','public.meeting_bot_sessions','pre_v59','redact',true,false,55),
  ('db_provider_effect_reconciliation_receipts','database','public.provider_effect_reconciliation_receipts','pre_v59','retain_content_free',false,true,56),
  ('db_provider_effect_reservations','database','public.provider_effect_reservations','pre_v59','retain_content_free',false,true,57),
  ('db_provider_effect_termination_receipts','database','public.provider_effect_termination_receipts','pre_v59','retain_content_free',false,true,58),
  ('db_portal_runtime_channel_bindings','database','public.portal_runtime_channel_bindings','pre_v59','redact',true,false,59),
  ('db_portal_runtime_channel_dispatches','database','public.portal_runtime_channel_dispatches','pre_v59','redact',true,false,60),
  ('db_portal_runtime_kill_switch_events','database','public.portal_runtime_kill_switch_events','pre_v59','retain_content_free',false,true,61),
  ('db_portal_runtime_kill_switches','database','public.portal_runtime_kill_switches','pre_v59','irreversible_delete',false,false,62),
  ('db_portal_runtime_operator_approvals','database','public.portal_runtime_operator_approvals','pre_v59','retain_content_free',false,true,63),
  ('db_portal_runtime_operator_reconciliation_receipts','database','public.portal_runtime_operator_reconciliation_receipts','pre_v59','retain_content_free',false,true,64),
  ('db_portal_runtime_provider_channel_receipts','database','public.portal_runtime_provider_channel_receipts','pre_v59','retain_content_free',true,true,65),
  ('db_portal_runtime_scene_execution_receipts','database','public.portal_runtime_scene_execution_receipts','pre_v59','retain_content_free',true,true,66),
  ('db_portal_business_action_agent_settings','database','public.portal_business_action_agent_settings','pre_v59','irreversible_delete',false,false,67),
  ('db_portal_business_action_calendar_connections','database','public.portal_business_action_calendar_connections','pre_v59','crypto_erase',false,false,68),
  ('db_portal_business_action_calendar_reservations','database','public.portal_business_action_calendar_reservations','pre_v59','redact',true,false,69),
  ('db_portal_business_action_grants','database','public.portal_business_action_grants','pre_v59','irreversible_delete',false,false,70),
  ('db_portal_business_action_kill_switch_events','database','public.portal_business_action_kill_switch_events','pre_v59','retain_content_free',false,true,71),
  ('db_portal_business_action_kill_switches','database','public.portal_business_action_kill_switches','pre_v59','irreversible_delete',false,false,72),
  ('db_portal_business_action_leads','database','public.portal_business_action_leads','pre_v59','crypto_erase',true,false,73),
  ('db_portal_business_action_meeting_reconcile_approvals','database','public.portal_business_action_meeting_reconcile_approvals','pre_v59','retain_content_free',true,true,74),
  ('db_portal_business_action_proposal_slots','database','public.portal_business_action_proposal_slots','pre_v59','redact',true,false,75),
  ('db_portal_business_action_proposals','database','public.portal_business_action_proposals','pre_v59','redact',true,false,76),
  ('db_portal_business_action_receipts','database','public.portal_business_action_receipts','pre_v59','retain_content_free',true,true,77),
  ('db_portal_text_preview_admissions','database','public.portal_text_preview_admissions','pre_v59','redact',true,false,78),
  ('db_portal_text_preview_egress_authorizations','database','public.portal_text_preview_egress_authorizations','pre_v59','retain_content_free',true,true,79),
  ('db_portal_text_preview_privacy_policies','database','public.portal_text_preview_privacy_policies','pre_v59','retain_content_free',false,true,80),
  ('db_portal_text_preview_transcript_writes','database','public.portal_text_preview_transcript_writes','pre_v59','redact',true,false,81),
  ('db_portal_text_preview_turn_claims','database','public.portal_text_preview_turn_claims','pre_v59','redact',true,false,82),
  ('db_meeting_terminal_notification_attempt_receipts','database','public.meeting_terminal_notification_attempt_receipts','pre_v59','retain_content_free',false,true,83),
  ('db_meeting_terminal_notification_outbox','database','public.meeting_terminal_notification_outbox','pre_v59','retain_content_free',false,true,84),
  ('db_meeting_terminal_notification_payloads','database','public.meeting_terminal_notification_payloads','pre_v59','crypto_erase',false,false,85),
  ('db_tenants','database','public.tenants','pre_v59','crypto_erase',false,true,86),
  ('external_object_storage','object_storage',null,'external','external_delete',false,false,87),
  ('external_cache','cache',null,'external','cache_invalidate',false,false,88),
  ('external_embedding_index','embedding_index',null,'external','external_delete',false,false,89),
  ('external_provider_copy','provider_copy',null,'external','external_delete',false,false,90),
  ('external_auth_identity','auth_identity',null,'external','external_delete',false,false,91),
  ('external_vault_secret','vault_secret',null,'external','crypto_erase',false,false,92),
  ('external_backup','backup',null,'external','backup_expiry_wait',false,false,93);

-- Locator capabilities are issued inside PostgreSQL. Callers never get the
-- key material and cannot make an arbitrary digest authoritative merely by
-- prefixing it with `hmac-sha256:`.
create table app.data_governance_keyring (
  key_id text primary key check (key_id='locator-v1'),
  key_material bytea not null check (octet_length(key_material)=32),
  created_at timestamptz not null default now()
);
insert into app.data_governance_keyring(key_id,key_material)
values('locator-v1',gen_random_bytes(32));
revoke all on table app.data_governance_keyring from public,anon,authenticated,service_role;

create or replace function app.data_governance_key_fingerprint_matches(
  p_key_material bytea,
  p_key_fingerprint text
) returns boolean language sql immutable strict
set search_path='extensions','public','pg_catalog' as $$
  select p_key_fingerprint=encode(digest(p_key_material,'sha256'),'hex')
$$;

create table app.data_governance_attestation_authorities (
  authority_id app.uuid_v7 not null,
  authority_kind text not null check (authority_kind in ('coverage_producer','external_verifier')),
  resource_code text not null references public.data_governance_resource_catalog(resource_code),
  key_material bytea not null check (octet_length(key_material)=32),
  key_fingerprint text not null check (key_fingerprint ~ '^[0-9a-f]{64}$'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key (authority_kind,resource_code,authority_id),
  unique (resource_code,authority_id),
  check (app.data_governance_key_fingerprint_matches(key_material,key_fingerprint)),
  check ((active and revoked_at is null) or (not active and revoked_at is not null))
);
create unique index data_governance_one_active_attestation_authority_idx
  on app.data_governance_attestation_authorities(authority_kind,resource_code)
  where active;
revoke all on table app.data_governance_attestation_authorities from public,anon,authenticated,service_role;

create table app.data_legal_hold_authority_keys (
  key_id app.uuid_v7 primary key,
  authority_code text not null check (authority_code in (
    'court_order','regulator_request','statutory_duty','counsel_instruction','contractual_preservation'
  )),
  key_material bytea not null check (octet_length(key_material)=32),
  key_fingerprint text not null check (key_fingerprint ~ '^[0-9a-f]{64}$'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (authority_code,key_id),
  unique (authority_code,key_id,key_fingerprint),
  check (app.data_governance_key_fingerprint_matches(key_material,key_fingerprint)),
  check ((active and revoked_at is null) or (not active and revoked_at is not null))
);
create unique index data_legal_hold_one_active_authority_key_idx
  on app.data_legal_hold_authority_keys(authority_code) where active;
revoke all on table app.data_legal_hold_authority_keys from public,anon,authenticated,service_role;

create or replace function app.data_governance_verify_authority_hmac(
  p_authority_kind text,
  p_resource_code text,
  p_authority_id app.uuid_v7,
  p_payload text,
  p_attestation_hmac text
) returns boolean language sql stable security definer
set search_path='app','extensions','public','pg_catalog' as $$
  select exists(
    select 1
    from app.data_governance_attestation_authorities a
    where a.authority_kind=p_authority_kind and a.resource_code=p_resource_code
      and a.authority_id=p_authority_id and a.active
      and p_attestation_hmac='hmac-sha256:'||encode(
        hmac(convert_to(p_payload,'utf8'),a.key_material,'sha256'),'hex'
      )
  )
$$;

create or replace function app.data_legal_hold_verify_authority_hmac(
  p_authority_code text,
  p_key_id app.uuid_v7,
  p_payload text,
  p_attestation_hmac text
) returns boolean language sql stable security definer
set search_path='app','extensions','public','pg_catalog' as $$
  select exists(
    select 1
    from app.data_legal_hold_authority_keys k
    where k.authority_code=p_authority_code and k.key_id=p_key_id and k.active
      and p_attestation_hmac='hmac-sha256:'||encode(
        hmac(convert_to(p_payload,'utf8'),k.key_material,'sha256'),'hex'
      )
  )
$$;

create or replace function app.data_legal_hold_authorities_ready()
returns boolean language sql stable security definer set search_path='' as $$
  select not exists(
    select 1
    from unnest(array[
      'court_order','regulator_request','statutory_duty','counsel_instruction','contractual_preservation'
    ]) as expected(authority_code)
    where 1<>(
      select count(*) from app.data_legal_hold_authority_keys k
      where k.authority_code=expected.authority_code and k.active
    )
  )
$$;

create or replace function app.data_governance_canonical_timestamp(p_value timestamptz)
returns text language sql immutable strict set search_path='pg_catalog' as $$
  select to_char(p_value at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
$$;

create or replace function app.data_legal_hold_create_authority_payload(
  p_tenant_id app.uuid_v7,
  p_hold_id app.uuid_v7,
  p_scope_item_id app.uuid_v7,
  p_purpose_code text,
  p_authority_code text,
  p_authorization_id app.uuid_v7,
  p_expires_at timestamptz,
  p_resource_code text,
  p_subject_id app.uuid_v7,
  p_resource_locator_hmac text,
  p_authority_key_id app.uuid_v7
) returns text language sql immutable set search_path='app','pg_catalog' as $$
  select app.sha256_tuple(
    'legal-hold-create@1',p_tenant_id::text,p_hold_id::text,p_scope_item_id::text,
    p_purpose_code,p_authority_code,p_authorization_id::text,
    app.data_governance_canonical_timestamp(p_expires_at),p_resource_code,
    coalesce(p_subject_id::text,''),coalesce(p_resource_locator_hmac,''),
    p_authority_key_id::text
  )
$$;

create or replace function app.data_legal_hold_release_authority_payload(
  p_tenant_id app.uuid_v7,
  p_hold_id app.uuid_v7,
  p_authority_code text,
  p_authorization_id app.uuid_v7,
  p_authority_key_id app.uuid_v7
) returns text language sql immutable set search_path='app','pg_catalog' as $$
  select app.sha256_tuple(
    'legal-hold-release@1',p_tenant_id::text,p_hold_id::text,
    p_authority_code,p_authorization_id::text,p_authority_key_id::text
  )
$$;

create or replace function app.data_legal_hold_receipt_fingerprint(
  p_tenant_id app.uuid_v7,
  p_receipt_id app.uuid_v7,
  p_hold_id app.uuid_v7,
  p_event_type text,
  p_purpose_code text,
  p_scope_item_count integer,
  p_authority_code text,
  p_authorization_fingerprint text,
  p_authority_key_id app.uuid_v7,
  p_authority_key_fingerprint text,
  p_issuer_actor_fingerprint text,
  p_release_actor_fingerprint text,
  p_hold_started_at timestamptz,
  p_hold_expires_at timestamptz,
  p_authority_attestation_hmac text
) returns text language sql immutable set search_path='app','pg_catalog' as $$
  select app.sha256_tuple(
    'legal-hold-receipt@1',p_tenant_id::text,p_receipt_id::text,p_hold_id::text,
    p_event_type,p_purpose_code,p_scope_item_count::text,p_authority_code,
    p_authorization_fingerprint,p_authority_key_id::text,p_authority_key_fingerprint,
    p_issuer_actor_fingerprint,coalesce(p_release_actor_fingerprint,''),
    app.data_governance_canonical_timestamp(p_hold_started_at),
    app.data_governance_canonical_timestamp(p_hold_expires_at),
    coalesce(p_authority_attestation_hmac,'')
  )
$$;

create or replace function app.data_governance_external_attempt_fingerprint(
  p_tenant_id app.uuid_v7,
  p_receipt_id app.uuid_v7,
  p_request_id app.uuid_v7,
  p_work_item_id app.uuid_v7,
  p_attempt_number integer,
  p_lease_token app.uuid_v7,
  p_operation text,
  p_fencing_token bigint,
  p_outcome_code text,
  p_resulting_state text,
  p_operation_identity text,
  p_verification_challenge_hmac text,
  p_evidence_kind text,
  p_evidence_fingerprint text,
  p_evidence_attestation_hmac text,
  p_verifier_authority_id app.uuid_v7,
  p_verifier_key_fingerprint text,
  p_verifier_attestation_hmac text,
  p_recoverable_until timestamptz
) returns text language sql immutable set search_path='app','pg_catalog' as $$
  select app.sha256_tuple(
    'data-governance-external-attempt@1',p_tenant_id::text,p_receipt_id::text,
    p_request_id::text,p_work_item_id::text,p_attempt_number::text,p_lease_token::text,
    p_operation,p_fencing_token::text,p_outcome_code,p_resulting_state,
    p_operation_identity,p_verification_challenge_hmac,p_evidence_kind,
    p_evidence_fingerprint,p_evidence_attestation_hmac,
    coalesce(p_verifier_authority_id::text,''),coalesce(p_verifier_key_fingerprint,''),
    coalesce(p_verifier_attestation_hmac,''),
    coalesce(app.data_governance_canonical_timestamp(p_recoverable_until),'')
  )
$$;

create or replace function app.data_governance_external_evidence_fingerprint(
  p_tenant_id app.uuid_v7,
  p_request_id app.uuid_v7,
  p_work_item_id app.uuid_v7,
  p_attempt_number integer,
  p_receipt_id app.uuid_v7,
  p_operation text,
  p_fencing_token bigint,
  p_outcome_code text,
  p_evidence_kind text,
  p_operation_identity text,
  p_verification_challenge_hmac text,
  p_recoverable_until timestamptz
) returns text language sql immutable set search_path='app','pg_catalog' as $$
  select app.sha256_tuple(
    'data-governance-external-evidence@1',p_tenant_id::text,p_request_id::text,
    p_work_item_id::text,p_attempt_number::text,p_receipt_id::text,p_operation,
    p_fencing_token::text,p_outcome_code,p_evidence_kind,p_operation_identity,
    p_verification_challenge_hmac,
    coalesce(to_char(p_recoverable_until at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'')
  )
$$;

create or replace function app.data_governance_hmac(
  p_purpose text,
  p_tenant_id text,
  p_subject_id text,
  p_resource_code text,
  p_locator text
) returns text language sql stable security definer
set search_path='app','extensions','public','pg_catalog' as $$
  select 'hmac-sha256:'||encode(
    hmac(
      convert_to(app.sha256_tuple(
        p_purpose,p_tenant_id,p_subject_id,p_resource_code,p_locator
      ),'UTF8'),
      k.key_material,
      'sha256'
    ),
    'hex'
  )
  from app.data_governance_keyring k
  where k.key_id='locator-v1'
$$;

create or replace function app.data_governance_new_uuid_v7()
returns app.uuid_v7 language plpgsql volatile security definer
set search_path='extensions','public','app','pg_catalog' as $$
declare
  v_millis bigint:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
  v_time_hex text;
  v_random_hex text:=encode(gen_random_bytes(9),'hex');
begin
  v_time_hex:=lpad(to_hex(v_millis),12,'0');
  return (
    substr(v_time_hex,1,8)||'-'||substr(v_time_hex,9,4)||'-7'||substr(v_random_hex,1,3)||
    '-8'||substr(v_random_hex,4,3)||'-'||substr(v_random_hex,7,12)
  )::app.uuid_v7;
end;
$$;

alter table public.tenants
  add column data_governance_state text not null default 'open'
    check (data_governance_state in ('open','fenced','tombstoned')),
  add column data_write_epoch bigint not null default 1 check (data_write_epoch > 0),
  add column tombstoned_at timestamptz,
  add column tombstone_request_id app.uuid_v7,
  add constraint tenant_data_governance_tombstone_chk check (
    (data_governance_state='tombstoned' and status='deleted' and tombstoned_at is not null and tombstone_request_id is not null)
    or (data_governance_state<>'tombstoned' and tombstoned_at is null and tombstone_request_id is null)
  );

create table public.data_governance_subjects (
  tenant_id app.uuid_v7 not null,
  id app.uuid_v7 not null,
  subject_ref_hmac text check (subject_ref_hmac ~ '^hmac-sha256:[0-9a-f]{64}$'),
  state text not null check (state in ('active','disposition_requested','tombstoned')),
  created_at timestamptz not null default now(),
  primary key (tenant_id,id),
  unique (tenant_id,subject_ref_hmac),
  foreign key (tenant_id) references public.tenants(id) on delete restrict
  ,check ((state='tombstoned' and subject_ref_hmac is null) or (state<>'tombstoned' and subject_ref_hmac is not null))
);

create table public.data_governance_subject_artifact_links (
  tenant_id app.uuid_v7 not null,
  subject_id app.uuid_v7 not null,
  resource_code text not null references public.data_governance_resource_catalog(resource_code),
  resource_locator_hmac text not null check (resource_locator_hmac ~ '^hmac-sha256:[0-9a-f]{64}$'),
  database_row_id uuid,
  linked_at timestamptz not null default now(),
  primary key (tenant_id,subject_id,resource_code,resource_locator_hmac),
  foreign key (tenant_id,subject_id) references public.data_governance_subjects(tenant_id,id) on delete restrict
);

create table public.data_governance_subject_coverage_attestations (
  tenant_id app.uuid_v7 not null,
  subject_id app.uuid_v7 not null,
  resource_code text not null references public.data_governance_resource_catalog(resource_code),
  manifest_version text not null check (manifest_version='1.0.0'),
  catalog_fingerprint text not null check (catalog_fingerprint ~ '^[0-9a-f]{64}$'),
  linked_count integer not null check (linked_count between 0 and 10000),
  observation_fingerprint text not null check (observation_fingerprint ~ '^[0-9a-f]{64}$'),
  authority_id app.uuid_v7 not null,
  authority_key_fingerprint text not null check (authority_key_fingerprint ~ '^[0-9a-f]{64}$'),
  record_fingerprint text not null check (record_fingerprint ~ '^hmac-sha256:[0-9a-f]{64}$'),
  attested_at timestamptz not null default now(),
  primary key (tenant_id,subject_id,resource_code),
  foreign key (tenant_id,subject_id) references public.data_governance_subjects(tenant_id,id) on delete restrict,
  foreign key (resource_code,authority_id) references app.data_governance_attestation_authorities(resource_code,authority_id) on delete restrict
);

create table public.data_governance_requests (
  tenant_id app.uuid_v7 not null,
  id app.uuid_v7 not null,
  scope text not null check (scope in ('tenant','data_subject')),
  subject_id app.uuid_v7,
  requested_action text not null check (requested_action in ('redact','irreversible_delete')),
  purpose_code text not null check (purpose_code in ('contract_termination','data_subject_request','retention_expiry','operator_correction')),
  state text not null check (state in (
    'requested','approval_pending','authorized','inventorying','ready','blocked_by_legal_hold',
    'executing_redaction','executing_irreversible_deletion','retry_wait','effect_unknown',
    'verifying','operator_required','completed','denied','expired','cancelled'
  )),
  requested_by_user_id uuid,
  requested_by_actor_id app.uuid_v7,
  policy_version text not null check (policy_version ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  policy_fingerprint text not null check (policy_fingerprint ~ '^[0-9a-f]{64}$'),
  inventory_version text not null check (inventory_version ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  inventory_fingerprint text not null check (inventory_fingerprint ~ '^[0-9a-f]{64}$'),
  inventory_completed_at timestamptz,
  inventory_item_count integer check (inventory_item_count between 0 and 4096),
  inventory_resource_count bigint check (inventory_resource_count between 0 and 10000000),
  command_fingerprint text not null check (command_fingerprint ~ '^[0-9a-f]{64}$'),
  write_epoch bigint not null check (write_epoch > 0),
  authorized_at timestamptz,
  authorization_expires_at timestamptz,
  authorized_approval_ids app.uuid_v7[],
  irreversible_started_at timestamptz,
  completed_at timestamptz,
  expires_at timestamptz not null default now()+interval '30 days',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id,id),
  unique (id),
  foreign key (tenant_id) references public.tenants(id) on delete restrict,
  foreign key (tenant_id,subject_id) references public.data_governance_subjects(tenant_id,id) on delete restrict,
  check (
    (scope='tenant' and subject_id is null)
    or (scope='data_subject' and (subject_id is not null or state in ('completed','denied','expired','cancelled')))
  ),
  check (completed_at is null or state='completed'),
  check (expires_at>created_at and expires_at<=created_at+interval '30 days'),
  check (authorization_expires_at is null or (authorization_expires_at>created_at and authorization_expires_at<=expires_at)),
  check (authorized_approval_ids is null or cardinality(authorized_approval_ids) between 1 and 2),
  check (irreversible_started_at is null or authorized_at is not null),
  check (
    (inventory_completed_at is null and inventory_item_count is null and inventory_resource_count is null)
    or (inventory_completed_at is not null and inventory_item_count is not null and inventory_resource_count is not null)
  )
);

alter table public.tenants add constraint tenant_tombstone_request_fk
  foreign key (id,tombstone_request_id) references public.data_governance_requests(tenant_id,id) on delete restrict;

create table public.data_governance_policy_decisions (
  tenant_id app.uuid_v7 not null,
  id app.uuid_v7 not null,
  request_id app.uuid_v7 not null,
  decision text not null check (decision in ('pending','allow','deny','operator_required')),
  reason_code text not null check (reason_code in ('awaiting_approval','policy_allowed','policy_denied','ambiguous_subject_lineage','active_legal_hold','catalog_drift')),
  policy_version text not null,
  policy_fingerprint text not null check (policy_fingerprint ~ '^[0-9a-f]{64}$'),
  command_fingerprint text not null check (command_fingerprint ~ '^[0-9a-f]{64}$'),
  authorization_expires_at timestamptz,
  decided_at timestamptz not null default now(),
  primary key (tenant_id,id),
  unique (tenant_id,request_id),
  foreign key (tenant_id,request_id) references public.data_governance_requests(tenant_id,id) on delete restrict
);

create table public.data_governance_approvals (
  tenant_id app.uuid_v7 not null,
  id app.uuid_v7 not null,
  request_id app.uuid_v7 not null,
  actor_user_id uuid,
  actor_id app.uuid_v7,
  actor_fingerprint text not null check (actor_fingerprint ~ '^hmac-sha256:[0-9a-f]{64}$'),
  decision text not null check (decision in ('approve','deny')),
  command_fingerprint text not null check (command_fingerprint ~ '^[0-9a-f]{64}$'),
  decided_at timestamptz not null default now(),
  primary key (tenant_id,id),
  unique (tenant_id,request_id,actor_id),
  foreign key (tenant_id,request_id) references public.data_governance_requests(tenant_id,id) on delete restrict
);

create table public.data_legal_holds (
  tenant_id app.uuid_v7 not null,
  id app.uuid_v7 not null,
  purpose_code text not null check (purpose_code in ('litigation','regulatory_inquiry','tax_audit','billing_dispute','contractual_claim','security_investigation')),
  authority_code text not null check (authority_code in ('court_order','regulator_request','statutory_duty','counsel_instruction','contractual_preservation')),
  authorization_id app.uuid_v7,
  authorization_fingerprint text not null check (authorization_fingerprint ~ '^[0-9a-f]{64}$'),
  authority_key_id app.uuid_v7 not null,
  authority_key_fingerprint text not null check (authority_key_fingerprint ~ '^[0-9a-f]{64}$'),
  issuer_actor_fingerprint text not null check (issuer_actor_fingerprint ~ '^[0-9a-f]{64}$'),
  release_actor_fingerprint text check (release_actor_fingerprint ~ '^[0-9a-f]{64}$'),
  state text not null check (state in ('active','released','expired')),
  created_by_user_id uuid,
  created_by_actor_id app.uuid_v7,
  expires_at timestamptz not null,
  released_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (tenant_id,id),
  unique (id),
  foreign key (tenant_id) references public.tenants(id) on delete restrict,
  foreign key (authority_code,authority_key_id,authority_key_fingerprint)
    references app.data_legal_hold_authority_keys(authority_code,key_id,key_fingerprint) on delete restrict,
  check (expires_at > created_at),
  check ((state='released' and released_at is not null) or (state<>'released' and released_at is null)),
  check (
    (state='released' and release_actor_fingerprint is not null)
    or (state<>'released' and release_actor_fingerprint is null)
  ),
  check ((state='active' and authorization_id is not null) or state<>'active')
);

create table public.data_legal_hold_scope_items (
  tenant_id app.uuid_v7 not null,
  hold_id app.uuid_v7 not null,
  id app.uuid_v7 not null,
  resource_code text not null references public.data_governance_resource_catalog(resource_code),
  subject_id app.uuid_v7,
  resource_locator_hmac text check (resource_locator_hmac ~ '^hmac-sha256:[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  primary key (tenant_id,hold_id,id),
  unique (tenant_id,hold_id,resource_code,subject_id,resource_locator_hmac),
  foreign key (tenant_id,hold_id) references public.data_legal_holds(tenant_id,id) on delete restrict,
  foreign key (tenant_id,subject_id) references public.data_governance_subjects(tenant_id,id) on delete restrict,
  check (subject_id is not null or resource_locator_hmac is not null)
);

create table public.data_legal_hold_receipts (
  tenant_id app.uuid_v7 not null,
  id app.uuid_v7 not null,
  hold_id app.uuid_v7 not null,
  event_type text not null check (event_type in ('created','released','expired')),
  purpose_code text not null,
  scope_item_count integer not null check (scope_item_count between 1 and 1000),
  authority_code text not null check (authority_code in ('court_order','regulator_request','statutory_duty','counsel_instruction','contractual_preservation')),
  authorization_fingerprint text not null check (authorization_fingerprint ~ '^[0-9a-f]{64}$'),
  authority_key_id app.uuid_v7 not null,
  authority_key_fingerprint text not null check (authority_key_fingerprint ~ '^[0-9a-f]{64}$'),
  issuer_actor_fingerprint text not null check (issuer_actor_fingerprint ~ '^[0-9a-f]{64}$'),
  release_actor_fingerprint text check (release_actor_fingerprint ~ '^[0-9a-f]{64}$'),
  authority_attestation_hmac text check (authority_attestation_hmac ~ '^hmac-sha256:[0-9a-f]{64}$'),
  hold_started_at timestamptz not null,
  hold_expires_at timestamptz not null,
  record_fingerprint text not null check (record_fingerprint ~ '^[0-9a-f]{64}$'),
  authority_actor_id app.uuid_v7,
  occurred_at timestamptz not null default now(),
  primary key (tenant_id,id),
  unique (tenant_id,hold_id,event_type),
  foreign key (tenant_id,hold_id) references public.data_legal_holds(tenant_id,id) on delete restrict,
  foreign key (authority_code,authority_key_id,authority_key_fingerprint)
    references app.data_legal_hold_authority_keys(authority_code,key_id,key_fingerprint) on delete restrict,
  check (hold_expires_at>hold_started_at),
  check (
    (event_type='released' and release_actor_fingerprint is not null)
    or (event_type<>'released' and release_actor_fingerprint is null)
  ),
  check (
    (event_type in ('created','released') and authority_attestation_hmac is not null)
    or (event_type='expired' and authority_attestation_hmac is null)
  )
);

create table public.data_governance_work_items (
  tenant_id app.uuid_v7 not null,
  id app.uuid_v7 not null,
  request_id app.uuid_v7 not null,
  subject_id app.uuid_v7,
  resource_code text not null references public.data_governance_resource_catalog(resource_code),
  resource_locator_hmac text check (resource_locator_hmac ~ '^hmac-sha256:[0-9a-f]{64}$'),
  database_row_id uuid,
  verification_locator_hmac text check (verification_locator_hmac ~ '^hmac-sha256:[0-9a-f]{64}$'),
  verification_database_row_id uuid,
  resource_count integer not null default 1 check (resource_count between 1 and 10000),
  action text not null check (action in (
    'redact','irreversible_delete','retain_content_free','external_delete',
    'cache_invalidate','crypto_erase','backup_expiry_wait'
  )),
  state text not null check (state in (
    'pending','held','leased','applying','retry_wait','effect_unknown',
    'verification_pending','verified','operator_required','retained_exception'
  )),
  attempt_count integer not null default 0 check (attempt_count between 0 and 16),
  max_attempts integer not null default 5 check (max_attempts between 1 and 16),
  next_attempt_at timestamptz,
  lease_owner app.uuid_v7,
  lease_token app.uuid_v7,
  lease_expires_at timestamptz,
  fencing_token bigint not null default 0 check (fencing_token between 0 and 10000000),
  recoverable_until timestamptz,
  outcome_code text check (outcome_code in (
    'applied','verified_absent','verified_content_free','retryable_failure','effect_unknown',
    'legal_hold','backup_recoverable','subject_lineage_ambiguous','permanent_failure'
  )),
  current_operation text check (current_operation in ('apply','reconcile','verify')),
  resume_operation text check (resume_operation in ('apply','reconcile','verify')),
  operation_identity text check (operation_identity ~ '^[0-9a-f]{64}$'),
  dispatch_fenced_at timestamptz,
  verification_challenge_hmac text check (verification_challenge_hmac ~ '^hmac-sha256:[0-9a-f]{64}$'),
  verification_digest text check (verification_digest ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id,id),
  unique (tenant_id,request_id,resource_code,resource_locator_hmac),
  unique (tenant_id,id,request_id),
  foreign key (tenant_id,request_id) references public.data_governance_requests(tenant_id,id) on delete restrict,
  foreign key (tenant_id,subject_id) references public.data_governance_subjects(tenant_id,id) on delete restrict,
  check ((lease_owner is null and lease_token is null and lease_expires_at is null) or (lease_owner is not null and lease_token is not null and lease_expires_at is not null)),
  check ((state in ('leased','applying') and current_operation is not null) or (state not in ('leased','applying') and current_operation is null)),
  check ((state='retry_wait' and resume_operation is not null and next_attempt_at is not null) or (state<>'retry_wait' and resume_operation is null and next_attempt_at is null)),
  check ((dispatch_fenced_at is null and verification_challenge_hmac is null) or operation_identity is not null),
  check (recoverable_until is null or action='backup_expiry_wait'),
  check (
    (state in ('verified','retained_exception') and resource_locator_hmac is null and database_row_id is null)
    or (state not in ('verified','retained_exception') and resource_locator_hmac is not null)
  ),
  check (
    (state in ('verified','retained_exception') and next_attempt_at is null and verification_digest is not null)
    or (state not in ('verified','retained_exception') and verification_digest is null)
  )
);

create table public.data_governance_attempt_receipts (
  tenant_id app.uuid_v7 not null,
  id app.uuid_v7 not null,
  request_id app.uuid_v7 not null,
  work_item_id app.uuid_v7 not null,
  attempt_number integer not null check (attempt_number between 1 and 16),
  operation text not null check (operation in ('apply','reconcile','verify')),
  fencing_token bigint not null check (fencing_token between 1 and 10000000),
  outcome_code text not null check (outcome_code in (
    'applied','verified_absent','verified_content_free','retryable_failure','effect_unknown',
    'legal_hold','backup_recoverable','subject_lineage_ambiguous','permanent_failure'
  )),
  evidence_kind text check (evidence_kind in (
    'effect_receipt','transport_unknown','transport_failure','provider_denied',
    'object_absence','cache_absence','index_absence','provider_absence',
    'auth_absence','vault_absence','recovery_window','backup_window_elapsed'
  )),
  external_lease_token app.uuid_v7,
  resulting_state text check (resulting_state in (
    'retry_wait','effect_unknown','verification_pending','verified','operator_required'
  )),
  external_operation_identity text check (external_operation_identity ~ '^[0-9a-f]{64}$'),
  external_verification_challenge_hmac text check (external_verification_challenge_hmac ~ '^hmac-sha256:[0-9a-f]{64}$'),
  evidence_fingerprint text check (evidence_fingerprint ~ '^[0-9a-f]{64}$'),
  evidence_attestation_hmac text check (evidence_attestation_hmac ~ '^hmac-sha256:[0-9a-f]{64}$'),
  verifier_authority_id app.uuid_v7,
  verifier_attestation_hmac text check (verifier_attestation_hmac ~ '^hmac-sha256:[0-9a-f]{64}$'),
  verification_authority_fingerprint text check (verification_authority_fingerprint ~ '^[0-9a-f]{64}$'),
  result_fingerprint text not null check (result_fingerprint ~ '^[0-9a-f]{64}$'),
  recoverable_until timestamptz,
  occurred_at timestamptz not null default now(),
  primary key (tenant_id,id,work_item_id),
  unique (tenant_id,id),
  unique (tenant_id,work_item_id,attempt_number),
  foreign key (tenant_id,request_id) references public.data_governance_requests(tenant_id,id) on delete restrict,
  foreign key (tenant_id,work_item_id,request_id) references public.data_governance_work_items(tenant_id,id,request_id) on delete restrict,
  check (
    (
      evidence_kind is null and external_lease_token is null and resulting_state is null
      and external_operation_identity is null and external_verification_challenge_hmac is null
      and evidence_fingerprint is null and evidence_attestation_hmac is null
      and verifier_authority_id is null and verifier_attestation_hmac is null
    )
    or (
      evidence_kind is not null and external_lease_token is not null and resulting_state is not null
      and external_operation_identity is not null and external_verification_challenge_hmac is not null
      and evidence_fingerprint is not null and evidence_attestation_hmac is not null
      and (
        (verification_authority_fingerprint is null and verifier_authority_id is null and verifier_attestation_hmac is null)
        or (verification_authority_fingerprint is not null and verifier_authority_id is not null and verifier_attestation_hmac is not null)
      )
    )
  )
);
create table public.data_governance_final_receipts (
  tenant_id app.uuid_v7 not null,
  id app.uuid_v7 not null,
  request_id app.uuid_v7 not null,
  scope text not null check (scope in ('tenant','data_subject')),
  terminal_state text not null check (terminal_state in ('completed','denied','expired','cancelled','operator_required')),
  policy_version text not null,
  policy_fingerprint text not null check (policy_fingerprint ~ '^[0-9a-f]{64}$'),
  inventory_version text not null,
  inventory_fingerprint text not null check (inventory_fingerprint ~ '^[0-9a-f]{64}$'),
  verified_item_count integer not null check (verified_item_count between 0 and 1000000),
  retained_exception_count integer not null check (retained_exception_count between 0 and 1000000),
  held_item_count integer not null check (held_item_count between 0 and 1000000),
  result_code text not null check (result_code in ('verified_complete','policy_denied','approval_denied','request_expired','request_cancelled','operator_required')),
  completed_at timestamptz not null default now(),
  receipt_fingerprint text generated always as (app.sha256_tuple(
    'data-governance-final-receipt@1',tenant_id::text,id::text,request_id::text,
    scope,terminal_state,policy_version,policy_fingerprint,inventory_version,
    inventory_fingerprint,verified_item_count::text,retained_exception_count::text,
    held_item_count::text,result_code,app.data_governance_canonical_timestamp(completed_at)
  )) stored,
  primary key (tenant_id,id),
  unique (tenant_id,request_id),
  foreign key (tenant_id,request_id) references public.data_governance_requests(tenant_id,id) on delete restrict
);

create index data_governance_requests_state_idx on public.data_governance_requests(state,updated_at,tenant_id);
create index data_governance_work_items_lease_idx on public.data_governance_work_items(state,next_attempt_at,lease_expires_at,tenant_id);
create unique index data_governance_work_items_database_row_uidx
  on public.data_governance_work_items(tenant_id,request_id,resource_code,database_row_id)
  where database_row_id is not null;
create index data_legal_holds_active_idx on public.data_legal_holds(tenant_id,state,expires_at);
create index data_legal_hold_scope_lookup_idx on public.data_legal_hold_scope_items(tenant_id,resource_code,subject_id,resource_locator_hmac);

create unique index data_governance_one_active_request_per_tenant_idx
  on public.data_governance_requests(tenant_id)
  where state in (
    'requested','approval_pending','authorized','inventorying','ready','blocked_by_legal_hold',
    'executing_redaction','executing_irreversible_deletion','retry_wait','effect_unknown',
    'verifying','operator_required'
  );

insert into public.data_governance_resource_catalog(
  resource_code,surface,relation_name,catalog_generation,default_action,
  subject_link_required,retained_exception,inventory_order
) values
  ('control_data_governance_subjects','database','public.data_governance_subjects','v59_control','irreversible_delete',false,false,94),
  ('control_data_governance_subject_artifact_links','database','public.data_governance_subject_artifact_links','v59_control','irreversible_delete',false,false,95),
  ('control_data_governance_requests','database','public.data_governance_requests','v59_control','retain_content_free',false,true,96),
  ('control_data_governance_policy_decisions','database','public.data_governance_policy_decisions','v59_control','retain_content_free',false,true,97),
  ('control_data_governance_approvals','database','public.data_governance_approvals','v59_control','retain_content_free',false,true,98),
  ('control_data_legal_holds','database','public.data_legal_holds','v59_control','retain_content_free',false,true,99),
  ('control_data_legal_hold_scope_items','database','public.data_legal_hold_scope_items','v59_control','retain_content_free',false,true,100),
  ('control_data_legal_hold_receipts','database','public.data_legal_hold_receipts','v59_control','retain_content_free',false,true,101),
  ('control_data_governance_work_items','database','public.data_governance_work_items','v59_control','retain_content_free',false,true,102),
  ('control_data_governance_attempt_receipts','database','public.data_governance_attempt_receipts','v59_control','retain_content_free',false,true,103),
  ('control_data_governance_final_receipts','database','public.data_governance_final_receipts','v59_control','retain_content_free',false,true,104),
  ('control_data_governance_subject_coverage_attestations','database','public.data_governance_subject_coverage_attestations','v59_control','irreversible_delete',false,false,105);

alter table public.data_governance_resource_catalog
  add column deletion_order smallint,
  add column locator_strategy text,
  add column resource_class text,
  add column verification_method text,
  add column subject_redaction_strategy text,
  add column projection_version text,
  add column relation_shape_fingerprint text,
  add column legal_hold_applicable boolean not null default true;

create or replace function app.data_governance_relation_shape_fingerprint(p_relation regclass)
returns text language sql stable security definer set search_path='' as $$
  select app.sha256_text(string_agg(
    a.attnum::text||'|'||a.attname||'|'||pg_catalog.format_type(a.atttypid,a.atttypmod)||'|'||
    a.attnotnull::text||'|'||a.attidentity::text||'|'||a.attgenerated::text,
    E'\n' order by a.attnum
  ))
  from pg_attribute a
  where a.attrelid=p_relation and a.attnum>0 and not a.attisdropped
$$;

update public.data_governance_resource_catalog
set deletion_order=case
      when catalog_generation='external' then inventory_order-86
      when catalog_generation='v59_control' then 100+(inventory_order-94)
      else 20
    end,
    locator_strategy=case
      when surface<>'database' then 'external_fixed_target'
      when relation_name='public.tenants' then 'tenant_singleton'
      when exists(
        select 1 from information_schema.columns c
        where c.table_schema='public' and c.table_name=split_part(relation_name,'.',2)
          and c.column_name='id' and c.udt_name='uuid'
      ) then 'uuid_id'
      else 'tenant_relation'
    end,
    resource_class=case
      when surface='object_storage' then 'object_blob'
      when surface='cache' then 'cache_entry'
      when surface='embedding_index' then 'embedding'
      when surface='provider_copy' then 'provider_copy'
      when surface='auth_identity' then 'authentication_identity'
      when surface='vault_secret' then 'vault_secret'
      when surface='backup' then 'backup_snapshot'
      when resource_code='db_tenants' then 'tenant_profile'
      when resource_code like '%membership%' or resource_code like '%invite%' then 'membership'
      when resource_code like '%contact_profiles%' or resource_code like '%leads%' then 'contact_profile'
      when resource_code like '%transcript%' or resource_code like '%conversation_turn%' then 'transcript'
      when resource_code like '%consent%' then 'consent_evidence'
      when resource_code like '%disclosure%' then 'disclosure_evidence'
      when resource_code like '%knowledge_embedding%' then 'embedding'
      when resource_code like '%knowledge_%' then 'knowledge_content'
      when resource_code like '%workflow%' then 'workflow_evidence'
      when resource_code like '%billing%' or resource_code like '%cost%' or resource_code like '%usage%' then 'billing_evidence'
      when resource_code like '%provider_effect%' or resource_code like '%meeting_bot%' or resource_code like '%tavus%' or resource_code like '%recall%' then 'provider_effect'
      when resource_code like '%notification%' then 'notification_payload'
      when resource_code like '%runtime%' then 'runtime_evidence'
      when resource_code like '%audit%' then 'audit_evidence'
      when resource_code like '%session%' or resource_code like '%handoff%' then 'session_content'
      when resource_code like '%action%' or resource_code like '%approval%' or resource_code like '%receipt%' then 'action_evidence'
      else 'configuration'
    end,
    verification_method=case
      when surface='backup' then 'recovery_window'
      when surface<>'database' then 'adapter_absence'
      when retained_exception then 'typed_content_free_scan'
      else 'sql_absence'
    end,
    subject_redaction_strategy=case
      when resource_code='db_conversation_transcripts' then 'typed_redact'
      when surface<>'database' then 'external_redact'
      else 'none'
    end,
    projection_version=case
      when resource_code='db_conversation_transcripts' then 'conversation-transcript-redaction@1'
      else 'row-absence@1'
    end,
    relation_shape_fingerprint=case
      when resource_code='db_conversation_transcripts'
      then app.data_governance_relation_shape_fingerprint('public.conversation_transcripts'::regclass)
      else null
    end;

-- Derive the destructive database order from the live FK graph. Hand-maintained
-- reverse creation order is not a dependency proof and had multiple RESTRICT
-- children scheduled after their parents. Every child must sort before every
-- parent, and any future cycle fails migration rather than burning retry budget.
do $derive_data_governance_deletion_order$
declare v_cycle text;
begin
  with recursive fk_edges as (
      select child.relation_name child_relation,parent.relation_name parent_relation
      from pg_constraint fk
      join public.data_governance_resource_catalog child
        on fk.conrelid=to_regclass(child.relation_name)
       and child.catalog_generation='pre_v59'
      join public.data_governance_resource_catalog parent
        on fk.confrelid=to_regclass(parent.relation_name)
       and parent.catalog_generation='pre_v59'
      where fk.contype='f' and child.relation_name<>parent.relation_name
        and not (
          fk.conname='sessions_active_presenter_fk'
          and fk.conrelid='public.sessions'::regclass
          and fk.confrelid='public.session_participants'::regclass
        )
    ), walk(start_relation,current_relation,path,cycle) as (
      select e.child_relation,e.parent_relation,
             array[e.child_relation,e.parent_relation]::text[],false
      from fk_edges e
      union all
      select w.start_relation,e.parent_relation,w.path||e.parent_relation,
             e.parent_relation=any(w.path)
      from walk w
      join fk_edges e on e.child_relation=w.current_relation
      where not w.cycle
    )
  select array_to_string(path,' -> ') into v_cycle
  from walk where cycle limit 1;
  if v_cycle is not null then
    raise exception 'data governance deletion graph contains a foreign-key cycle: %',v_cycle using errcode='55000';
  end if;

  with recursive fk_edges as (
    select child.relation_name child_relation,parent.relation_name parent_relation
    from pg_constraint fk
    join public.data_governance_resource_catalog child
      on fk.conrelid=to_regclass(child.relation_name)
     and child.catalog_generation='pre_v59'
    join public.data_governance_resource_catalog parent
      on fk.confrelid=to_regclass(parent.relation_name)
     and parent.catalog_generation='pre_v59'
    where fk.contype='f' and child.relation_name<>parent.relation_name
      and not (
        fk.conname='sessions_active_presenter_fk'
        and fk.conrelid='public.sessions'::regclass
        and fk.confrelid='public.session_participants'::regclass
      )
  ), descendants(root_relation,current_relation,depth,path) as (
    select c.relation_name,c.relation_name,0,array[c.relation_name]::text[]
    from public.data_governance_resource_catalog c
    where c.catalog_generation='pre_v59' and c.surface='database'
    union all
    select d.root_relation,e.child_relation,d.depth+1,d.path||e.child_relation
    from descendants d
    join fk_edges e on e.parent_relation=d.current_relation
    where not e.child_relation=any(d.path)
  ), ranks as (
    select root_relation,max(depth) deletion_depth
    from descendants
    group by root_relation
  )
  update public.data_governance_resource_catalog c
  set deletion_order=20+r.deletion_depth
  from ranks r
  where c.catalog_generation='pre_v59' and c.relation_name=r.root_relation;

  if exists(
    select 1
    from pg_constraint fk
    join public.data_governance_resource_catalog child
      on fk.conrelid=to_regclass(child.relation_name)
     and child.catalog_generation='pre_v59'
    join public.data_governance_resource_catalog parent
      on fk.confrelid=to_regclass(parent.relation_name)
     and parent.catalog_generation='pre_v59'
    where fk.contype='f' and child.relation_name<>parent.relation_name
      and not (
        fk.conname='sessions_active_presenter_fk'
        and fk.conrelid='public.sessions'::regclass
        and fk.confrelid='public.session_participants'::regclass
      )
      and child.deletion_order>=parent.deletion_order
  ) then
    raise exception 'data governance deletion order is not foreign-key topological' using errcode='55000';
  end if;
end
$derive_data_governance_deletion_order$;

alter table public.data_governance_resource_catalog
  alter column deletion_order set not null,
  alter column locator_strategy set not null,
  alter column resource_class set not null,
  alter column verification_method set not null,
  alter column subject_redaction_strategy set not null,
  alter column projection_version set not null,
  add constraint data_governance_resource_catalog_deletion_order_chk check (deletion_order between 1 and 120),
  add constraint data_governance_resource_catalog_locator_strategy_chk check (locator_strategy in ('uuid_id','tenant_singleton','tenant_relation','external_fixed_target')),
  add constraint data_governance_resource_catalog_resource_class_chk check (resource_class in (
    'tenant_profile','authentication_identity','membership','configuration','contact_profile',
    'session_content','transcript','consent_evidence','disclosure_evidence','action_evidence',
    'workflow_evidence','knowledge_content','embedding','provider_effect','billing_evidence',
    'audit_evidence','notification_payload','runtime_evidence','object_blob','cache_entry',
    'provider_copy','vault_secret','backup_snapshot'
  )),
  add constraint data_governance_resource_catalog_verification_method_chk check (verification_method in ('sql_absence','typed_content_free_scan','adapter_absence','recovery_window')),
  add constraint data_governance_resource_catalog_subject_redaction_chk check (subject_redaction_strategy in ('none','typed_redact','external_redact')),
  add constraint data_governance_resource_catalog_projection_version_chk check (projection_version ~ '^[a-z0-9][a-z0-9@._-]{2,95}$'),
  add constraint data_governance_resource_catalog_shape_chk check (
    (resource_code='db_conversation_transcripts' and relation_shape_fingerprint ~ '^[0-9a-f]{64}$')
    or (resource_code<>'db_conversation_transcripts' and relation_shape_fingerprint is null)
  );

create or replace function app.data_governance_catalog_fingerprint()
returns text language sql stable security definer set search_path='' as $$
  select app.sha256_text(string_agg(
    resource_code||'|'||surface||'|'||coalesce(relation_name,'')||'|'||catalog_generation||'|'||
    default_action||'|'||subject_link_required::text||'|'||retained_exception::text||'|'||locator_strategy||'|'||
    resource_class||'|'||verification_method||'|'||subject_redaction_strategy||'|'||projection_version||'|'||
    coalesce(relation_shape_fingerprint,'')||'|'||legal_hold_applicable::text||'|'||deletion_order::text,
    E'\n' order by inventory_order
  ))
  from public.data_governance_resource_catalog
$$;

create or replace function app.data_governance_cycle_break_complete()
returns boolean language sql stable security definer set search_path='' as $$
  select exists(
    select 1
    from pg_constraint fk
    join pg_attribute tenant_column
      on tenant_column.attrelid=fk.conrelid and tenant_column.attname='tenant_id'
    join pg_attribute session_column
      on session_column.attrelid=fk.conrelid and session_column.attname='id'
    join pg_attribute presenter_column
      on presenter_column.attrelid=fk.conrelid and presenter_column.attname='active_presenter_id'
    join pg_attribute participant_tenant_column
      on participant_tenant_column.attrelid=fk.confrelid and participant_tenant_column.attname='tenant_id'
    join pg_attribute participant_session_column
      on participant_session_column.attrelid=fk.confrelid and participant_session_column.attname='session_id'
    join pg_attribute participant_id_column
      on participant_id_column.attrelid=fk.confrelid and participant_id_column.attname='id'
    where fk.conname='sessions_active_presenter_fk'
      and fk.conrelid='public.sessions'::regclass
      and fk.confrelid='public.session_participants'::regclass
      and fk.contype='f' and fk.convalidated and fk.condeferrable and fk.condeferred
      and fk.confdeltype='a' and not presenter_column.attnotnull
      and fk.conkey=array[tenant_column.attnum,session_column.attnum,presenter_column.attnum]::smallint[]
      and fk.confkey=array[participant_tenant_column.attnum,participant_session_column.attnum,participant_id_column.attnum]::smallint[]
  )
$$;

create or replace function app.data_governance_catalog_complete()
returns boolean language sql stable security definer set search_path='' as $$
  with tenant_relations as (
    select 'public.'||c.table_name relation_name
    from information_schema.columns c
    where c.table_schema='public' and c.column_name='tenant_id'
    union all select 'public.tenants'
  ), catalog_relations as (
    select relation_name from public.data_governance_resource_catalog where surface='database'
  )
  select
    (select count(*) from public.data_governance_resource_catalog where catalog_generation='pre_v59')=86
    and (select count(*) from public.data_governance_resource_catalog where catalog_generation='external')=7
    and app.data_governance_cycle_break_complete()
    and not exists(
      (select relation_name from tenant_relations)
      except
      (select relation_name from catalog_relations)
    )
    and not exists(
      (select relation_name from catalog_relations)
      except
      (select relation_name from tenant_relations)
    )
    and not exists(
      select 1 from public.data_governance_resource_catalog c
      where c.surface='database' and to_regclass(c.relation_name) is null
    )
    and exists(
      select 1 from public.data_governance_resource_catalog c
      where c.resource_code='db_conversation_transcripts'
        and c.projection_version='conversation-transcript-redaction@1'
        and c.relation_shape_fingerprint=app.data_governance_relation_shape_fingerprint(
          'public.conversation_transcripts'::regclass
        )
    )
    and not exists(
      select 1
      from pg_constraint fk
      join public.data_governance_resource_catalog child
        on fk.conrelid=to_regclass(child.relation_name)
       and child.catalog_generation='pre_v59'
      join public.data_governance_resource_catalog parent
        on fk.confrelid=to_regclass(parent.relation_name)
       and parent.catalog_generation='pre_v59'
      where fk.contype='f' and child.relation_name<>parent.relation_name
        and not (
          fk.conname='sessions_active_presenter_fk'
          and fk.conrelid='public.sessions'::regclass
          and fk.confrelid='public.session_participants'::regclass
        )
        and child.deletion_order>=parent.deletion_order
    )
$$;

create or replace function app.data_governance_attestation_authorities_ready(
  p_require_subject_coverage boolean
) returns boolean language sql stable security definer set search_path='' as $$
  select
    not exists(
      select 1
      from public.data_governance_resource_catalog c
      where c.catalog_generation='external'
        and 1<>(
          select count(*)
          from app.data_governance_attestation_authorities a
          where a.authority_kind='external_verifier'
            and a.resource_code=c.resource_code and a.active
        )
    )
    and (
      not p_require_subject_coverage
      or not exists(
        select 1
        from public.data_governance_resource_catalog c
        where c.catalog_generation='pre_v59' and c.subject_link_required
          and 1<>(
            select count(*)
            from app.data_governance_attestation_authorities a
            where a.authority_kind='coverage_producer'
              and a.resource_code=c.resource_code and a.active
          )
      )
    )
$$;

create or replace function app.data_governance_expected_policy_fingerprint(
  p_tenant_id app.uuid_v7,
  p_scope text,
  p_subject_id app.uuid_v7,
  p_requested_action text,
  p_purpose_code text
) returns text language sql immutable set search_path='app','pg_catalog' as $$
  select app.sha256_tuple(
    'data-governance-policy@1.0.0',p_tenant_id::text,p_scope,
    coalesce(p_subject_id::text,''),p_requested_action,p_purpose_code
  )
$$;

create or replace function app.data_governance_expected_command_fingerprint(
  p_request_id app.uuid_v7,
  p_tenant_id app.uuid_v7,
  p_scope text,
  p_subject_id app.uuid_v7,
  p_requested_action text,
  p_purpose_code text,
  p_policy_fingerprint text,
  p_inventory_fingerprint text
) returns text language sql immutable set search_path='app','pg_catalog' as $$
  select app.sha256_tuple(
    'data-governance-command@1.0.0',p_request_id::text,p_tenant_id::text,
    p_scope,coalesce(p_subject_id::text,''),p_requested_action,p_purpose_code,
    p_policy_fingerprint,p_inventory_fingerprint
  )
$$;

create or replace function app.data_governance_tenant_lock_key(p_tenant_id app.uuid_v7)
returns bigint language sql immutable strict set search_path='' as $$
  select hashtextextended(p_tenant_id::text,59004)
$$;

create or replace function app.data_governance_external_roles_revoked(p_relation regclass)
returns boolean language sql stable security definer set search_path='' as $$
  select p_relation is not null
    and not has_table_privilege('anon',p_relation,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    and not has_table_privilege('authenticated',p_relation,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    and not has_table_privilege('service_role',p_relation,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
$$;

create or replace function app.data_governance_has_active_hold(
  p_tenant_id app.uuid_v7,
  p_resource_code text,
  p_subject_id app.uuid_v7,
  p_resource_locator_hmac text
) returns boolean language sql stable security definer set search_path='' as $$
  select exists(
    select 1
    from public.data_legal_holds h
    join public.data_legal_hold_scope_items s
      on s.tenant_id=h.tenant_id and s.hold_id=h.id
    where h.tenant_id=p_tenant_id and h.state='active'
      and s.resource_code=p_resource_code
      and (s.subject_id is null or s.subject_id=p_subject_id)
      and (s.resource_locator_hmac is null or s.resource_locator_hmac=p_resource_locator_hmac)
  )
$$;

create or replace function app.data_governance_disposition_allowed(
  p_relation regclass,
  p_row jsonb,
  p_operation text
) returns boolean language plpgsql stable security definer set search_path='' as $$
declare
  v_tenant app.uuid_v7;
  v_resource_code text;
  v_row_id uuid;
  v_locator_strategy text;
  v_old_presenter_id app.uuid_v7;
  v_cycle_break_exact boolean;
begin
  v_tenant:=(p_row->>'tenant_id')::app.uuid_v7;
  -- The only registered FK cycle is sessions.active_presenter_id back to a
  -- participant whose owning session cascades to participants. Permit exactly
  -- the nullable back-reference projection while that participant's leased
  -- deletion item is applying. No other session field may change.
  if p_relation='public.sessions'::regclass and p_operation='UPDATE'
     and p_row->>'active_presenter_id' is null then
    v_row_id:=(p_row->>'id')::uuid;
    select s.active_presenter_id,
           (to_jsonb(s)-'active_presenter_id')=(p_row-'active_presenter_id')
    into v_old_presenter_id,v_cycle_break_exact
    from public.sessions s
    where s.tenant_id=v_tenant and s.id=v_row_id;
    if v_old_presenter_id is not null and coalesce(v_cycle_break_exact,false) then
      return exists(
        select 1
        from public.data_governance_work_items i
        join public.data_governance_requests r
          on r.tenant_id=i.tenant_id and r.id=i.request_id
        join public.tenants t on t.id=i.tenant_id
        where i.tenant_id=v_tenant and i.resource_code='db_session_participants'
          and i.database_row_id=v_old_presenter_id and i.state='applying'
          and i.action='irreversible_delete' and i.lease_token is not null
          and i.lease_expires_at>clock_timestamp() and i.fencing_token>0
          and r.write_epoch=t.data_write_epoch
          and r.state='executing_irreversible_deletion'
          and not app.data_governance_has_active_hold(
            i.tenant_id,i.resource_code,i.subject_id,coalesce(i.resource_locator_hmac,i.verification_locator_hmac)
          )
      );
    end if;
    return false;
  end if;
  select resource_code,locator_strategy into v_resource_code,v_locator_strategy
  from public.data_governance_resource_catalog
  where surface='database' and relation_name=p_relation::text;
  if v_tenant is null or v_resource_code is null then return false; end if;
  begin
    v_row_id:=case when v_locator_strategy='tenant_relation' then p_row->>'tenant_id' else coalesce(p_row->>'id',p_row->>'tenant_id') end::uuid;
  exception when others then
    return false;
  end;
  return exists(
    select 1
    from public.data_governance_work_items i
    join public.data_governance_requests r
      on r.tenant_id=i.tenant_id and r.id=i.request_id
    join public.tenants t on t.id=i.tenant_id
    where i.tenant_id=v_tenant and i.resource_code=v_resource_code
      and i.database_row_id=v_row_id and i.state='applying'
      and i.lease_token is not null and i.lease_expires_at>clock_timestamp()
      and i.fencing_token>0 and r.write_epoch=t.data_write_epoch
      and r.state in ('executing_redaction','executing_irreversible_deletion')
      and ((p_operation='DELETE' and i.action='irreversible_delete')
        or (p_operation='DELETE' and i.action='retain_content_free')
        or (p_operation='UPDATE' and i.action in ('redact','crypto_erase')))
      and not app.data_governance_has_active_hold(i.tenant_id,i.resource_code,i.subject_id,coalesce(i.resource_locator_hmac,i.verification_locator_hmac))
  );
exception when others then
  return false;
end;
$$;

create or replace function app.enforce_data_governance_write_fence()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_row jsonb; v_tenant app.uuid_v7; v_state text; v_row_id uuid; v_resource_code text;
begin
  if tg_op='UPDATE'
     and (to_jsonb(old)->>'tenant_id') is distinct from (to_jsonb(new)->>'tenant_id') then
    raise exception 'tenant relocation is forbidden by data governance' using errcode='42501';
  end if;
  v_row:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_tenant:=(v_row->>'tenant_id')::app.uuid_v7;
  select data_governance_state into v_state from public.tenants where id=v_tenant for share;
  if v_state is null then raise exception 'tenant authority missing' using errcode='42501'; end if;
  if v_state='open' then
    begin v_row_id:=coalesce(v_row->>'id',v_row->>'tenant_id')::uuid; exception when others then v_row_id:=null; end;
    select resource_code into v_resource_code from public.data_governance_resource_catalog
    where surface='database' and relation_name=tg_relid::text;
    if v_row_id is not null and exists(
      select 1 from public.data_governance_work_items i
      join public.data_governance_requests r on r.tenant_id=i.tenant_id and r.id=i.request_id
      where i.tenant_id=v_tenant and i.resource_code=v_resource_code
        and coalesce(i.database_row_id,i.verification_database_row_id)=v_row_id
        and r.scope='data_subject' and r.state in (
          'authorized','inventorying','ready','blocked_by_legal_hold','executing_redaction',
          'executing_irreversible_deletion','retry_wait','effect_unknown','verifying','operator_required'
        )
        and not app.data_governance_disposition_allowed(tg_relid,v_row,tg_op)
    ) then raise exception 'artifact writes fenced by data-subject governance' using errcode='55000'; end if;
    return case when tg_op='DELETE' then old else new end;
  end if;
  if tg_op<>'INSERT' and app.data_governance_disposition_allowed(tg_relid,v_row,tg_op) then
    return case when tg_op='DELETE' then old else new end;
  end if;
  raise exception 'tenant writes fenced by data governance' using errcode='55000';
end;
$$;

create or replace function app.prevent_mutation_or_governed_disposition()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_row jsonb;
begin
  v_row:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
  if app.data_governance_disposition_allowed(tg_relid,v_row,tg_op) then
    return case when tg_op='DELETE' then old else new end;
  end if;
  raise exception 'table % is append-only',tg_table_name using errcode='55000';
end;
$$;

-- Replace only triggers that called the constitutional append-only guard.
-- The original guard is untouched; this wrapper opens one exact, leased,
-- tenant and row-fenced terminal disposition path.
do $replace_append_only_triggers$
declare r record; v_definition text;
begin
  for r in
    select t.oid,t.tgname,t.tgrelid
    from pg_trigger t
    where not t.tgisinternal and t.tgfoid=to_regprocedure('app.prevent_mutation()')
  loop
    v_definition:=pg_get_triggerdef(r.oid,true);
    v_definition:=replace(v_definition,'EXECUTE FUNCTION app.prevent_mutation()','EXECUTE FUNCTION app.prevent_mutation_or_governed_disposition()');
    execute format('drop trigger %I on %s',r.tgname,r.tgrelid::regclass);
    execute v_definition;
  end loop;
end
$replace_append_only_triggers$;

-- Preserve the v58 trigger identities while extending their bodies with the
-- same exact request, item, lease, row and hold fence. This avoids weakening
-- their normal append-only behavior and keeps historical capability proofs
-- truthful after v59.
create or replace function app.prevent_text_preview_reference_mutation()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_row jsonb;
begin
  v_row:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
  if app.data_governance_disposition_allowed(tg_relid,v_row,tg_op) then
    return case when tg_op='DELETE' then old else new end;
  end if;
  if tg_op='UPDATE'
    and old.transcript_id is not null
    and new.transcript_id is null
    and (to_jsonb(new)-'transcript_id')=(to_jsonb(old)-'transcript_id')
    and not exists(
      select 1 from public.conversation_transcripts
      where tenant_id=old.tenant_id and id=old.transcript_id
    ) then
    return new;
  end if;
  raise exception '% is append-only',tg_table_name using errcode='55000';
end;
$$;

create or replace function app.prevent_meeting_notification_receipt_mutation()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_row jsonb;
begin
  v_row:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
  if app.data_governance_disposition_allowed(tg_relid,v_row,tg_op) then
    return case when tg_op='DELETE' then old else new end;
  end if;
  raise exception 'meeting notification receipts are append-only' using errcode='55000';
end;
$$;
revoke all on function app.prevent_text_preview_reference_mutation()
  from public,anon,authenticated,service_role;
revoke all on function app.prevent_meeting_notification_receipt_mutation()
  from public,anon,authenticated,service_role;

do $install_write_fences$
declare r record;
begin
  for r in
    select relation_name
    from public.data_governance_resource_catalog
    where catalog_generation='pre_v59' and surface='database' and relation_name<>'public.tenants'
    order by inventory_order
  loop
    execute format(
      'create trigger data_governance_write_fence before insert or update or delete on %s for each row execute function app.enforce_data_governance_write_fence()',
      r.relation_name
    );
  end loop;
end
$install_write_fences$;

create or replace function app.prevent_data_governance_receipt_mutation()
returns trigger language plpgsql set search_path='' as $$
begin
  raise exception 'data governance evidence is append-only' using errcode='55000';
end;
$$;

create trigger data_legal_hold_receipt_append_only before update or delete on public.data_legal_hold_receipts for each row execute function app.prevent_data_governance_receipt_mutation();
create trigger data_governance_attempt_receipt_append_only before update or delete on public.data_governance_attempt_receipts for each row execute function app.prevent_data_governance_receipt_mutation();
create trigger data_governance_final_receipt_append_only before update or delete on public.data_governance_final_receipts for each row execute function app.prevent_data_governance_receipt_mutation();

create or replace function app.data_governance_authenticated_admin()
returns public.user_tenant_memberships language plpgsql stable security definer set search_path='' as $$
declare v_membership public.user_tenant_memberships;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode='28000'; end if;
  select * into v_membership
  from public.user_tenant_memberships
  where user_id=auth.uid();
  if v_membership.tenant_id is null or v_membership.role<>'tenant_admin' then
    raise exception 'tenant_admin authority required' using errcode='42501';
  end if;
  return v_membership;
end;
$$;

create or replace function public.portal_request_data_governance_authenticated(
  p_request_id app.uuid_v7,
  p_policy_decision_id app.uuid_v7,
  p_scope text,
  p_subject_id app.uuid_v7,
  p_requested_action text,
  p_purpose_code text,
  p_policy_version text,
  p_policy_fingerprint text,
  p_inventory_version text,
  p_inventory_fingerprint text,
  p_command_fingerprint text
) returns jsonb language plpgsql security definer set search_path=''
set lock_timeout='2s' set statement_timeout='15s' as $$
declare
  v_member public.user_tenant_memberships;
  v_tenant public.tenants;
  v_existing public.data_governance_requests;
  v_expected_policy text;
  v_expected_command text;
begin
  v_member:=app.data_governance_authenticated_admin();
  perform pg_advisory_xact_lock(app.data_governance_tenant_lock_key(v_member.tenant_id));
  select * into v_tenant from public.tenants where id=v_member.tenant_id for update;
  if v_tenant.status not in ('trial','active','suspended') or v_tenant.data_governance_state<>'open' then
    raise exception 'tenant does not admit a governance request' using errcode='55000';
  end if;
  if p_policy_version<>'1.0.0' or p_inventory_version<>'1.0.0' then
    raise exception 'unsupported data governance version' using errcode='22023';
  end if;
  if p_scope not in ('tenant','data_subject')
     or p_requested_action not in ('redact','irreversible_delete')
     or p_purpose_code not in ('contract_termination','data_subject_request','retention_expiry','operator_correction')
     or (p_scope='tenant' and p_subject_id is not null)
     or (p_scope='data_subject' and p_subject_id is null)
     or (p_scope='tenant' and p_requested_action='redact')
     or (p_scope='tenant' and p_purpose_code='data_subject_request')
     or (p_scope='data_subject' and p_purpose_code not in ('data_subject_request','operator_correction')) then
    raise exception 'invalid data governance request scope' using errcode='22023';
  end if;
  if p_scope='data_subject' and not exists(
    select 1 from public.data_governance_subjects s
    where s.tenant_id=v_member.tenant_id and s.id=p_subject_id and s.state='active'
  ) then raise exception 'active same-tenant subject lineage required' using errcode='42501'; end if;
  if p_scope='data_subject' and p_requested_action='redact' and exists(
    select 1
    from public.data_governance_subject_artifact_links l
    join public.data_governance_resource_catalog c on c.resource_code=l.resource_code
    where l.tenant_id=v_member.tenant_id and l.subject_id=p_subject_id
      and c.subject_redaction_strategy='none'
  ) then
    raise exception 'subject has resources without a registered redaction projector' using errcode='0A000';
  end if;
  if p_inventory_fingerprint<>app.data_governance_catalog_fingerprint() or not app.data_governance_catalog_complete() then
    raise exception 'data governance catalog drift' using errcode='55000';
  end if;
  if not app.data_governance_attestation_authorities_ready(p_scope='data_subject') then
    raise exception 'independent governance attestation authorities are not ready' using errcode='55000';
  end if;
  v_expected_policy:=app.data_governance_expected_policy_fingerprint(
    v_member.tenant_id,p_scope,p_subject_id,p_requested_action,p_purpose_code
  );
  v_expected_command:=app.data_governance_expected_command_fingerprint(
    p_request_id,v_member.tenant_id,p_scope,p_subject_id,p_requested_action,
    p_purpose_code,v_expected_policy,p_inventory_fingerprint
  );
  if p_policy_fingerprint<>v_expected_policy or p_command_fingerprint<>v_expected_command then
    raise exception 'canonical governance fingerprint mismatch' using errcode='22023';
  end if;
  select * into v_existing from public.data_governance_requests where id=p_request_id;
  if found then
    if v_existing.tenant_id<>v_member.tenant_id or v_existing.command_fingerprint<>p_command_fingerprint then
      raise exception 'data governance request idempotency conflict' using errcode='23505';
    end if;
    return jsonb_build_object('requestId',v_existing.id,'state',v_existing.state,'replayed',true);
  end if;
  insert into public.data_governance_requests(
    tenant_id,id,scope,subject_id,requested_action,purpose_code,state,requested_by_user_id,requested_by_actor_id,
    policy_version,policy_fingerprint,inventory_version,inventory_fingerprint,command_fingerprint,write_epoch
  ) values (
    v_member.tenant_id,p_request_id,p_scope,p_subject_id,p_requested_action,p_purpose_code,'requested',auth.uid(),v_member.actor_id,
    p_policy_version,p_policy_fingerprint,p_inventory_version,p_inventory_fingerprint,p_command_fingerprint,v_tenant.data_write_epoch
  );
  insert into public.data_governance_policy_decisions(
    tenant_id,id,request_id,decision,reason_code,policy_version,policy_fingerprint,
    command_fingerprint,authorization_expires_at
  ) values(
    v_member.tenant_id,p_policy_decision_id,p_request_id,'pending','awaiting_approval',
    p_policy_version,p_policy_fingerprint,p_command_fingerprint,null
  );
  return jsonb_build_object('requestId',p_request_id,'state','requested','replayed',false);
end;
$$;

create or replace function public.portal_decide_data_governance_policy_service(
  p_tenant_id app.uuid_v7,
  p_request_id app.uuid_v7,
  p_policy_decision_id app.uuid_v7,
  p_decision text,
  p_reason_code text,
  p_policy_fingerprint text,
  p_authorization_expires_at timestamptz
) returns jsonb language plpgsql security definer set search_path=''
set lock_timeout='2s' set statement_timeout='15s' as $$
declare
  v_tenant_id app.uuid_v7;
  v_request public.data_governance_requests;
  v_decision public.data_governance_policy_decisions;
begin
  select r.tenant_id into v_tenant_id
  from public.data_governance_requests r
  where r.tenant_id=p_tenant_id and r.id=p_request_id;
  if not found then raise exception 'governance request not found' using errcode='55000'; end if;
  perform pg_advisory_xact_lock(app.data_governance_tenant_lock_key(v_tenant_id));
  select * into v_request from public.data_governance_requests
  where tenant_id=v_tenant_id and id=p_request_id for update;
  select * into v_decision from public.data_governance_policy_decisions
  where tenant_id=v_request.tenant_id and id=p_policy_decision_id and request_id=v_request.id for update;
  if not found then raise exception 'policy decision does not belong to request' using errcode='42501'; end if;
  if v_decision.decision<>'pending' then
    if v_decision.decision<>p_decision or v_decision.reason_code<>p_reason_code
       or v_decision.policy_fingerprint<>p_policy_fingerprint
       or v_decision.authorization_expires_at is distinct from p_authorization_expires_at then
      raise exception 'policy decision idempotency conflict' using errcode='23505';
    end if;
    return jsonb_build_object(
      'tenantId',v_request.tenant_id,'requestId',v_request.id,
      'state',v_request.state,'replayed',true
    );
  end if;
  if v_request.state<>'requested' or p_policy_fingerprint<>v_request.policy_fingerprint
     or v_decision.command_fingerprint<>v_request.command_fingerprint
     or v_request.expires_at<=now() then
    raise exception 'request is not policy-decidable' using errcode='55000';
  end if;
  if p_decision='allow' then
    if p_reason_code<>'policy_allowed' or p_authorization_expires_at is null
       or p_authorization_expires_at<=now()
       or p_authorization_expires_at>least(v_request.expires_at,now()+interval '24 hours') then
      raise exception 'bounded policy authorization required' using errcode='22023';
    end if;
    update public.data_governance_policy_decisions
    set decision='allow',reason_code='policy_allowed',authorization_expires_at=p_authorization_expires_at,decided_at=now()
    where tenant_id=v_request.tenant_id and id=v_decision.id;
    update public.data_governance_requests
    set state='approval_pending',authorization_expires_at=p_authorization_expires_at,updated_at=now()
    where tenant_id=v_request.tenant_id and id=v_request.id;
    return jsonb_build_object(
      'tenantId',v_request.tenant_id,'requestId',v_request.id,
      'state','approval_pending','replayed',false
    );
  elsif p_decision='deny' then
    if p_reason_code<>'policy_denied' or p_authorization_expires_at is not null then
      raise exception 'closed policy denial required' using errcode='22023';
    end if;
    update public.data_governance_policy_decisions
    set decision='deny',reason_code='policy_denied',authorization_expires_at=null,decided_at=now()
    where tenant_id=v_request.tenant_id and id=v_decision.id;
    insert into public.data_governance_final_receipts(
      tenant_id,id,request_id,scope,terminal_state,policy_version,policy_fingerprint,
      inventory_version,inventory_fingerprint,verified_item_count,retained_exception_count,
      held_item_count,result_code
    ) values(
      v_request.tenant_id,p_policy_decision_id,v_request.id,v_request.scope,'denied',
      v_request.policy_version,v_request.policy_fingerprint,v_request.inventory_version,
      v_request.inventory_fingerprint,0,0,0,'policy_denied'
    );
    update public.data_governance_requests
    set state='denied',requested_by_user_id=null,requested_by_actor_id=null,subject_id=null,updated_at=now()
    where tenant_id=v_request.tenant_id and id=v_request.id;
    if v_request.subject_id is not null then
      update public.data_governance_subjects set state='active'
      where tenant_id=v_request.tenant_id and id=v_request.subject_id and state='disposition_requested';
    end if;
    return jsonb_build_object(
      'tenantId',v_request.tenant_id,'requestId',v_request.id,
      'state','denied','replayed',false
    );
  end if;
  raise exception 'unsupported policy decision' using errcode='22023';
end;
$$;

create or replace function public.portal_approve_data_governance_authenticated(
  p_request_id app.uuid_v7,
  p_approval_id app.uuid_v7,
  p_decision text,
  p_command_fingerprint text
) returns jsonb language plpgsql security definer set search_path=''
set lock_timeout='2s' set statement_timeout='15s' as $$
declare
  v_member public.user_tenant_memberships;
  v_request public.data_governance_requests;
  v_existing public.data_governance_approvals;
  v_actor_fingerprint text;
begin
  v_member:=app.data_governance_authenticated_admin();
  v_actor_fingerprint:=app.data_governance_hmac(
    'approval-actor',v_member.tenant_id::text,v_member.actor_id::text,'auth-user',auth.uid()::text
  );
  perform pg_advisory_xact_lock(app.data_governance_tenant_lock_key(v_member.tenant_id));
  select * into v_request from public.data_governance_requests
  where tenant_id=v_member.tenant_id and id=p_request_id for update;
  if not found then
    raise exception 'request is not approval pending' using errcode='55000';
  end if;
  select * into v_existing from public.data_governance_approvals
  where tenant_id=v_member.tenant_id and request_id=p_request_id and id=p_approval_id;
  if found then
    if v_existing.decision<>p_decision
       or v_existing.command_fingerprint<>p_command_fingerprint
       or v_existing.actor_fingerprint<>v_actor_fingerprint then
      raise exception 'approval idempotency conflict' using errcode='23505';
    end if;
    return jsonb_build_object(
      'requestId',p_request_id,'state',v_request.state,'replayed',true
    );
  end if;
  if v_request.state<>'approval_pending' then
    raise exception 'request is not approval pending' using errcode='55000';
  end if;
  if v_request.authorization_expires_at is null or v_request.authorization_expires_at<=now()
     or p_command_fingerprint<>v_request.command_fingerprint
     or not exists(
       select 1 from public.data_governance_policy_decisions d
       where d.tenant_id=v_request.tenant_id and d.request_id=v_request.id
         and d.decision='allow' and d.policy_fingerprint=v_request.policy_fingerprint
         and d.command_fingerprint=v_request.command_fingerprint
         and d.authorization_expires_at=v_request.authorization_expires_at
     ) then raise exception 'live policy-bound command required' using errcode='42501'; end if;
  if p_decision not in ('approve','deny') then raise exception 'invalid approval decision' using errcode='22023'; end if;
  select * into v_existing from public.data_governance_approvals
  where tenant_id=v_member.tenant_id and request_id=p_request_id and actor_id=v_member.actor_id;
  if found then
    if v_existing.id<>p_approval_id or v_existing.decision<>p_decision
       or v_existing.command_fingerprint<>p_command_fingerprint then
      raise exception 'approval idempotency conflict' using errcode='23505';
    end if;
    return jsonb_build_object('requestId',p_request_id,'state',v_request.state,'replayed',true);
  end if;
  if p_decision='approve' and (
    select count(*) from public.data_governance_approvals a
    where a.tenant_id=v_request.tenant_id and a.request_id=v_request.id and a.decision='approve'
  ) >= (case when v_request.scope='tenant' then 2 else 1 end) then
    raise exception 'approval quorum is already complete' using errcode='23505';
  end if;
  insert into public.data_governance_approvals(
    tenant_id,id,request_id,actor_user_id,actor_id,actor_fingerprint,decision,command_fingerprint
  ) values(
    v_member.tenant_id,p_approval_id,p_request_id,auth.uid(),v_member.actor_id,
    v_actor_fingerprint,p_decision,p_command_fingerprint
  )
  ;
  if p_decision='deny' then
    update public.data_governance_requests
    set state='denied',updated_at=now(),requested_by_user_id=null,requested_by_actor_id=null,subject_id=null
    where tenant_id=v_member.tenant_id and id=p_request_id;
    insert into public.data_governance_final_receipts(
      tenant_id,id,request_id,scope,terminal_state,policy_version,policy_fingerprint,
      inventory_version,inventory_fingerprint,verified_item_count,retained_exception_count,
      held_item_count,result_code
    ) values(
      v_member.tenant_id,p_approval_id,p_request_id,v_request.scope,'denied',v_request.policy_version,
      v_request.policy_fingerprint,v_request.inventory_version,v_request.inventory_fingerprint,0,0,0,'approval_denied'
    );
    update public.data_governance_approvals set actor_user_id=null,actor_id=null
    where tenant_id=v_member.tenant_id and request_id=p_request_id;
    if v_request.subject_id is not null then
      update public.data_governance_subjects set state='active'
      where tenant_id=v_member.tenant_id and id=v_request.subject_id and state='disposition_requested';
    end if;
  end if;
  return jsonb_build_object('requestId',p_request_id,'state',case when p_decision='deny' then 'denied' else 'approval_pending' end,'replayed',false);
end;
$$;

create or replace function public.portal_create_data_legal_hold_authenticated(
  p_hold_id app.uuid_v7,
  p_scope_item_id app.uuid_v7,
  p_receipt_id app.uuid_v7,
  p_purpose_code text,
  p_authority_code text,
  p_authorization_id app.uuid_v7,
  p_expires_at timestamptz,
  p_resource_code text,
  p_subject_id app.uuid_v7,
  p_resource_locator_hmac text,
  p_authority_key_id app.uuid_v7,
  p_authority_attestation_hmac text
) returns jsonb language plpgsql security definer set search_path=''
set lock_timeout='2s' set statement_timeout='15s' as $$
declare
  v_member public.user_tenant_memberships;
  v_existing_receipt public.data_legal_hold_receipts;
  v_existing_state text;
  v_authority_payload text;
  v_authority_key_fingerprint text;
  v_authorization_fingerprint text;
  v_issuer_actor_fingerprint text;
  v_record_fingerprint text;
  v_started_at timestamptz:=clock_timestamp();
begin
  v_member:=app.data_governance_authenticated_admin();
  perform pg_advisory_xact_lock(app.data_governance_tenant_lock_key(v_member.tenant_id));
  if p_expires_at is null or p_expires_at<=now() or p_expires_at>now()+interval '10 years' then
    raise exception 'legal hold expiry is required and bounded' using errcode='22023';
  end if;
  if p_subject_id is null and p_resource_locator_hmac is null then
    raise exception 'legal hold must be artifact or subject scoped' using errcode='22023';
  end if;
  select key_fingerprint into v_authority_key_fingerprint
  from app.data_legal_hold_authority_keys
  where authority_code=p_authority_code and key_id=p_authority_key_id;
  if not found then
    raise exception 'legal hold authority key is required' using errcode='42501';
  end if;
  v_authority_payload:=app.data_legal_hold_create_authority_payload(
    v_member.tenant_id,p_hold_id,p_scope_item_id,p_purpose_code,
    p_authority_code,p_authorization_id,p_expires_at,p_resource_code,p_subject_id,
    p_resource_locator_hmac,p_authority_key_id
  );
  v_authorization_fingerprint:=app.sha256_tuple(
    'legal-hold-authorization@1',v_member.tenant_id::text,p_authority_code,p_authorization_id::text
  );
  v_issuer_actor_fingerprint:=app.sha256_tuple(
    'legal-hold-issuer@1',v_member.tenant_id::text,v_member.actor_id::text
  );
  select * into v_existing_receipt
  from public.data_legal_hold_receipts
  where tenant_id=v_member.tenant_id and hold_id=p_hold_id and event_type='created';
  if found then
    if v_existing_receipt.hold_id<>p_hold_id
       or v_existing_receipt.event_type<>'created'
       or v_existing_receipt.purpose_code<>p_purpose_code
       or v_existing_receipt.scope_item_count<>1
       or v_existing_receipt.authority_code<>p_authority_code
       or v_existing_receipt.authorization_fingerprint<>v_authorization_fingerprint
       or v_existing_receipt.authority_key_id<>p_authority_key_id
       or v_existing_receipt.authority_key_fingerprint<>v_authority_key_fingerprint
       or v_existing_receipt.issuer_actor_fingerprint<>v_issuer_actor_fingerprint
       or v_existing_receipt.hold_expires_at<>p_expires_at
       or v_existing_receipt.authority_attestation_hmac is distinct from p_authority_attestation_hmac
       or v_existing_receipt.record_fingerprint<>app.data_legal_hold_receipt_fingerprint(
         v_existing_receipt.tenant_id,v_existing_receipt.id,v_existing_receipt.hold_id,
         v_existing_receipt.event_type,v_existing_receipt.purpose_code,
         v_existing_receipt.scope_item_count,v_existing_receipt.authority_code,
         v_existing_receipt.authorization_fingerprint,v_existing_receipt.authority_key_id,
         v_existing_receipt.authority_key_fingerprint,v_existing_receipt.issuer_actor_fingerprint,
         v_existing_receipt.release_actor_fingerprint,
         v_existing_receipt.hold_started_at,v_existing_receipt.hold_expires_at,
         v_existing_receipt.authority_attestation_hmac
       ) then
      raise exception 'legal hold create idempotency conflict' using errcode='23505';
    end if;
    select state into v_existing_state from public.data_legal_holds
    where tenant_id=v_member.tenant_id and id=p_hold_id;
    if not found then raise exception 'legal hold receipt is orphaned' using errcode='55000'; end if;
    return jsonb_build_object(
      'holdId',p_hold_id,'state',v_existing_state,'receiptId',v_existing_receipt.id,'replayed',true
    );
  end if;
  if not app.data_legal_hold_verify_authority_hmac(
    p_authority_code,p_authority_key_id,v_authority_payload,p_authority_attestation_hmac
  ) then
    raise exception 'active legal hold authority attestation is invalid' using errcode='42501';
  end if;
  if exists(select 1 from public.data_legal_holds where id=p_hold_id) then
    raise exception 'legal hold create idempotency conflict' using errcode='23505';
  end if;
  if 100<=(
    select count(*) from public.data_legal_holds
    where tenant_id=v_member.tenant_id and state='active'
  ) then
    raise exception 'active legal hold capacity exhausted' using errcode='54000';
  end if;
  if exists(
    select 1
    from public.data_governance_work_items i
    join public.data_governance_requests r on r.tenant_id=i.tenant_id and r.id=i.request_id
    join public.data_governance_resource_catalog c on c.resource_code=i.resource_code
    where i.tenant_id=v_member.tenant_id and i.resource_code=p_resource_code
      and (p_subject_id is null or i.subject_id=p_subject_id)
      and (p_resource_locator_hmac is null or coalesce(i.resource_locator_hmac,i.verification_locator_hmac)=p_resource_locator_hmac)
      and (
        i.state in ('applying','retry_wait','effect_unknown','verification_pending','verified','retained_exception')
        or (i.state='leased' and i.dispatch_fenced_at is not null)
      )
  ) then raise exception 'legal hold arrived after the irreversible fence' using errcode='55000'; end if;
  insert into public.data_legal_holds(
    tenant_id,id,purpose_code,authority_code,authorization_id,authorization_fingerprint,
    authority_key_id,authority_key_fingerprint,issuer_actor_fingerprint,state,
    created_by_user_id,created_by_actor_id,expires_at,created_at
  ) values(
    v_member.tenant_id,p_hold_id,p_purpose_code,p_authority_code,p_authorization_id,
    v_authorization_fingerprint,p_authority_key_id,v_authority_key_fingerprint,
    v_issuer_actor_fingerprint,'active',auth.uid(),v_member.actor_id,p_expires_at,v_started_at
  );
  insert into public.data_legal_hold_scope_items(tenant_id,hold_id,id,resource_code,subject_id,resource_locator_hmac)
  values(v_member.tenant_id,p_hold_id,p_scope_item_id,p_resource_code,p_subject_id,p_resource_locator_hmac);
  v_record_fingerprint:=app.data_legal_hold_receipt_fingerprint(
    v_member.tenant_id,p_receipt_id,p_hold_id,'created',p_purpose_code,1,p_authority_code,
    v_authorization_fingerprint,p_authority_key_id,v_authority_key_fingerprint,
    v_issuer_actor_fingerprint,null,v_started_at,p_expires_at,p_authority_attestation_hmac
  );
  insert into public.data_legal_hold_receipts(
    tenant_id,id,hold_id,event_type,purpose_code,scope_item_count,authority_code,
    authorization_fingerprint,authority_key_id,authority_key_fingerprint,
    issuer_actor_fingerprint,release_actor_fingerprint,authority_attestation_hmac,hold_started_at,hold_expires_at,
    record_fingerprint,authority_actor_id,occurred_at
  ) values(
    v_member.tenant_id,p_receipt_id,p_hold_id,'created',p_purpose_code,1,p_authority_code,
    v_authorization_fingerprint,p_authority_key_id,v_authority_key_fingerprint,
    v_issuer_actor_fingerprint,null,p_authority_attestation_hmac,v_started_at,p_expires_at,
    v_record_fingerprint,null,v_started_at
  );
  update public.data_governance_work_items i
  set state='held',outcome_code='legal_hold',resume_operation=null,next_attempt_at=null,
      attempt_count=case when i.state='leased' then greatest(i.attempt_count-1,0) else i.attempt_count end,
      current_operation=null,lease_owner=null,lease_token=null,lease_expires_at=null,
      operation_identity=null,dispatch_fenced_at=null,verification_challenge_hmac=null,updated_at=now()
  where i.tenant_id=v_member.tenant_id and i.resource_code=p_resource_code
    and (p_subject_id is null or i.subject_id=p_subject_id)
    and (p_resource_locator_hmac is null or coalesce(i.resource_locator_hmac,i.verification_locator_hmac)=p_resource_locator_hmac)
    and (
      i.state='pending'
      or (i.state='leased' and i.dispatch_fenced_at is null)
    );
  update public.data_governance_requests r set state='blocked_by_legal_hold',updated_at=now()
  where r.tenant_id=v_member.tenant_id and r.state not in ('completed','denied','expired','cancelled')
    and exists(
      select 1 from public.data_governance_work_items i
      where i.tenant_id=r.tenant_id and i.request_id=r.id and i.state='held'
        and i.resource_code=p_resource_code
        and (p_subject_id is null or i.subject_id=p_subject_id)
        and (p_resource_locator_hmac is null or i.resource_locator_hmac=p_resource_locator_hmac)
    );
  return jsonb_build_object(
    'holdId',p_hold_id,'state','active','receiptId',p_receipt_id,'replayed',false
  );
end;
$$;

create or replace function public.portal_release_data_legal_hold_authenticated(
  p_hold_id app.uuid_v7,
  p_receipt_id app.uuid_v7,
  p_authorization_id app.uuid_v7,
  p_authority_key_id app.uuid_v7,
  p_authority_attestation_hmac text
) returns jsonb language plpgsql security definer set search_path=''
set lock_timeout='2s' set statement_timeout='15s' as $$
declare
  v_member public.user_tenant_memberships;
  v_hold public.data_legal_holds;
  v_existing_receipt public.data_legal_hold_receipts;
  v_count integer;
  v_authority_payload text;
  v_release_key_fingerprint text;
  v_authorization_fingerprint text;
  v_release_actor_fingerprint text;
  v_record_fingerprint text;
  v_released_at timestamptz:=clock_timestamp();
begin
  v_member:=app.data_governance_authenticated_admin();
  perform pg_advisory_xact_lock(app.data_governance_tenant_lock_key(v_member.tenant_id));
  select * into v_hold from public.data_legal_holds where tenant_id=v_member.tenant_id and id=p_hold_id for update;
  if not found then raise exception 'active legal hold not found' using errcode='55000'; end if;
  v_authorization_fingerprint:=app.sha256_tuple(
    'legal-hold-authorization@1',v_member.tenant_id::text,v_hold.authority_code,p_authorization_id::text
  );
  v_release_actor_fingerprint:=app.sha256_tuple(
    'legal-hold-releaser@1',v_member.tenant_id::text,v_member.actor_id::text
  );
  select key_fingerprint into v_release_key_fingerprint
  from app.data_legal_hold_authority_keys
  where authority_code=v_hold.authority_code and key_id=p_authority_key_id;
  if not found then
    raise exception 'legal hold release authority key is invalid' using errcode='42501';
  end if;
  v_authority_payload:=app.data_legal_hold_release_authority_payload(
    v_member.tenant_id,p_hold_id,v_hold.authority_code,p_authorization_id,
    p_authority_key_id
  );
  select * into v_existing_receipt
  from public.data_legal_hold_receipts
  where tenant_id=v_member.tenant_id and hold_id=p_hold_id and event_type='released';
  if found then
    if v_hold.state<>'released'
       or v_existing_receipt.hold_id<>p_hold_id
       or v_existing_receipt.event_type<>'released'
       or v_existing_receipt.purpose_code<>v_hold.purpose_code
       or v_existing_receipt.authority_code<>v_hold.authority_code
       or v_existing_receipt.authorization_fingerprint<>v_authorization_fingerprint
       or v_existing_receipt.authority_key_id<>p_authority_key_id
       or v_existing_receipt.authority_key_fingerprint<>v_release_key_fingerprint
       or v_existing_receipt.issuer_actor_fingerprint<>v_hold.issuer_actor_fingerprint
       or v_existing_receipt.release_actor_fingerprint<>v_release_actor_fingerprint
       or v_existing_receipt.hold_started_at<>v_hold.created_at
       or v_existing_receipt.hold_expires_at<>v_hold.expires_at
       or v_existing_receipt.authority_attestation_hmac is distinct from p_authority_attestation_hmac
       or v_existing_receipt.record_fingerprint<>app.data_legal_hold_receipt_fingerprint(
         v_existing_receipt.tenant_id,v_existing_receipt.id,v_existing_receipt.hold_id,
         v_existing_receipt.event_type,v_existing_receipt.purpose_code,
         v_existing_receipt.scope_item_count,v_existing_receipt.authority_code,
         v_existing_receipt.authorization_fingerprint,v_existing_receipt.authority_key_id,
         v_existing_receipt.authority_key_fingerprint,v_existing_receipt.issuer_actor_fingerprint,
         v_existing_receipt.release_actor_fingerprint,
         v_existing_receipt.hold_started_at,v_existing_receipt.hold_expires_at,
         v_existing_receipt.authority_attestation_hmac
       ) then
      raise exception 'legal hold release idempotency conflict' using errcode='23505';
    end if;
    return jsonb_build_object(
      'holdId',p_hold_id,'state','released','receiptId',v_existing_receipt.id,'replayed',true
    );
  end if;
  if v_hold.created_by_user_id=auth.uid()
     or v_hold.created_by_actor_id=v_member.actor_id then
    raise exception 'independent legal hold release admin required' using errcode='42501';
  end if;
  if p_authorization_id=v_hold.authorization_id then
    raise exception 'distinct legal hold release authorization required' using errcode='42501';
  end if;
  if not app.data_legal_hold_verify_authority_hmac(
    v_hold.authority_code,p_authority_key_id,v_authority_payload,p_authority_attestation_hmac
  ) then
    raise exception 'active legal hold release authority attestation is invalid' using errcode='42501';
  end if;
  if v_hold.state<>'active' then raise exception 'active legal hold not found' using errcode='55000'; end if;
  select count(*) into v_count from public.data_legal_hold_scope_items
  where tenant_id=v_member.tenant_id and hold_id=p_hold_id;
  if v_count<1 then raise exception 'active legal hold scope is missing' using errcode='55000'; end if;
  v_record_fingerprint:=app.data_legal_hold_receipt_fingerprint(
    v_member.tenant_id,p_receipt_id,p_hold_id,'released',v_hold.purpose_code,v_count,
    v_hold.authority_code,v_authorization_fingerprint,p_authority_key_id,
    v_release_key_fingerprint,v_hold.issuer_actor_fingerprint,v_release_actor_fingerprint,v_hold.created_at,
    v_hold.expires_at,p_authority_attestation_hmac
  );
  update public.data_legal_holds
  set state='released',released_at=v_released_at,created_by_user_id=null,
      created_by_actor_id=null,authorization_id=null,
      release_actor_fingerprint=v_release_actor_fingerprint
  where tenant_id=v_member.tenant_id and id=p_hold_id;
  insert into public.data_legal_hold_receipts(
    tenant_id,id,hold_id,event_type,purpose_code,scope_item_count,authority_code,
    authorization_fingerprint,authority_key_id,authority_key_fingerprint,
    issuer_actor_fingerprint,release_actor_fingerprint,authority_attestation_hmac,hold_started_at,hold_expires_at,
    record_fingerprint,authority_actor_id,occurred_at
  ) values(
    v_member.tenant_id,p_receipt_id,p_hold_id,'released',v_hold.purpose_code,v_count,
    v_hold.authority_code,v_authorization_fingerprint,p_authority_key_id,
    v_release_key_fingerprint,v_hold.issuer_actor_fingerprint,v_release_actor_fingerprint,
    p_authority_attestation_hmac,v_hold.created_at,v_hold.expires_at,
    v_record_fingerprint,null,v_released_at
  );
  delete from public.data_legal_hold_scope_items where tenant_id=v_member.tenant_id and hold_id=p_hold_id;
  update public.data_governance_work_items i set state='pending',outcome_code=null,next_attempt_at=null,updated_at=now()
  where i.tenant_id=v_member.tenant_id and i.state='held'
    and not app.data_governance_has_active_hold(i.tenant_id,i.resource_code,i.subject_id,coalesce(i.resource_locator_hmac,i.verification_locator_hmac));
  update public.data_governance_requests r set state='ready',updated_at=now()
  where r.tenant_id=v_member.tenant_id and r.state='blocked_by_legal_hold'
    and not exists(select 1 from public.data_governance_work_items i where i.tenant_id=r.tenant_id and i.request_id=r.id and i.state='held');
  return jsonb_build_object(
    'holdId',p_hold_id,'state','released','receiptId',p_receipt_id,'replayed',false
  );
end;
$$;

create or replace function public.portal_expire_data_legal_hold_service(
  p_tenant_id app.uuid_v7,
  p_hold_id app.uuid_v7,
  p_receipt_id app.uuid_v7
) returns jsonb language plpgsql security definer set search_path=''
set lock_timeout='2s' set statement_timeout='15s' as $$
declare
  v_hold public.data_legal_holds;
  v_existing_receipt public.data_legal_hold_receipts;
  v_count integer;
  v_record_fingerprint text;
  v_expired_at timestamptz:=clock_timestamp();
begin
  perform 1 from public.data_legal_holds where tenant_id=p_tenant_id and id=p_hold_id;
  if not found then raise exception 'active legal hold not found' using errcode='55000'; end if;
  perform pg_advisory_xact_lock(app.data_governance_tenant_lock_key(p_tenant_id));
  select * into v_hold from public.data_legal_holds
  where tenant_id=p_tenant_id and id=p_hold_id for update;
  select * into v_existing_receipt
  from public.data_legal_hold_receipts
  where tenant_id=p_tenant_id and hold_id=p_hold_id and event_type='expired';
  if found then
    if v_hold.state<>'expired'
       or v_existing_receipt.hold_id<>p_hold_id
       or v_existing_receipt.event_type<>'expired'
       or v_existing_receipt.purpose_code<>v_hold.purpose_code
       or v_existing_receipt.authority_code<>v_hold.authority_code
       or v_existing_receipt.authorization_fingerprint<>v_hold.authorization_fingerprint
       or v_existing_receipt.authority_key_id<>v_hold.authority_key_id
       or v_existing_receipt.authority_key_fingerprint<>v_hold.authority_key_fingerprint
       or v_existing_receipt.issuer_actor_fingerprint<>v_hold.issuer_actor_fingerprint
       or v_existing_receipt.authority_attestation_hmac is not null
       or v_existing_receipt.hold_started_at<>v_hold.created_at
       or v_existing_receipt.hold_expires_at<>v_hold.expires_at
       or v_existing_receipt.record_fingerprint<>app.data_legal_hold_receipt_fingerprint(
         v_existing_receipt.tenant_id,v_existing_receipt.id,v_existing_receipt.hold_id,
         v_existing_receipt.event_type,v_existing_receipt.purpose_code,
         v_existing_receipt.scope_item_count,v_existing_receipt.authority_code,
         v_existing_receipt.authorization_fingerprint,v_existing_receipt.authority_key_id,
         v_existing_receipt.authority_key_fingerprint,v_existing_receipt.issuer_actor_fingerprint,
         v_existing_receipt.release_actor_fingerprint,
         v_existing_receipt.hold_started_at,v_existing_receipt.hold_expires_at,null
       ) then
      raise exception 'legal hold expiry idempotency conflict' using errcode='23505';
    end if;
    return jsonb_build_object(
      'holdId',p_hold_id,'state','expired','receiptId',v_existing_receipt.id,'replayed',true
    );
  end if;
  if v_hold.state<>'active' then raise exception 'active legal hold not found' using errcode='55000'; end if;
  if v_hold.expires_at>now() then raise exception 'legal hold is not due' using errcode='55000'; end if;
  select count(*) into v_count from public.data_legal_hold_scope_items
  where tenant_id=v_hold.tenant_id and hold_id=v_hold.id;
  if v_count<1 then raise exception 'active legal hold scope is missing' using errcode='55000'; end if;
  v_record_fingerprint:=app.data_legal_hold_receipt_fingerprint(
    v_hold.tenant_id,p_receipt_id,v_hold.id,'expired',v_hold.purpose_code,v_count,
    v_hold.authority_code,v_hold.authorization_fingerprint,v_hold.authority_key_id,
    v_hold.authority_key_fingerprint,v_hold.issuer_actor_fingerprint,null,v_hold.created_at,
    v_hold.expires_at,null
  );
  update public.data_legal_holds
  set state='expired',created_by_user_id=null,created_by_actor_id=null,authorization_id=null
  where tenant_id=v_hold.tenant_id and id=v_hold.id;
  insert into public.data_legal_hold_receipts(
    tenant_id,id,hold_id,event_type,purpose_code,scope_item_count,authority_code,
    authorization_fingerprint,authority_key_id,authority_key_fingerprint,
    issuer_actor_fingerprint,release_actor_fingerprint,authority_attestation_hmac,hold_started_at,hold_expires_at,
    record_fingerprint,authority_actor_id,occurred_at
  ) values(
    v_hold.tenant_id,p_receipt_id,v_hold.id,'expired',v_hold.purpose_code,v_count,
    v_hold.authority_code,v_hold.authorization_fingerprint,v_hold.authority_key_id,
    v_hold.authority_key_fingerprint,v_hold.issuer_actor_fingerprint,null,null,
    v_hold.created_at,v_hold.expires_at,v_record_fingerprint,null,v_expired_at
  );
  delete from public.data_legal_hold_scope_items where tenant_id=v_hold.tenant_id and hold_id=v_hold.id;
  update public.data_governance_work_items i
  set state='pending',outcome_code=null,next_attempt_at=null,updated_at=now()
  where i.tenant_id=v_hold.tenant_id and i.state='held'
    and not app.data_governance_has_active_hold(i.tenant_id,i.resource_code,i.subject_id,coalesce(i.resource_locator_hmac,i.verification_locator_hmac));
  update public.data_governance_requests r set state='ready',updated_at=now()
  where r.tenant_id=v_hold.tenant_id and r.state='blocked_by_legal_hold'
    and not exists(select 1 from public.data_governance_work_items i where i.tenant_id=r.tenant_id and i.request_id=r.id and i.state='held');
  return jsonb_build_object(
    'holdId',v_hold.id,'state','expired','receiptId',p_receipt_id,'replayed',false
  );
end;
$$;

create or replace function public.portal_authorize_data_governance_request_service(
  p_tenant_id app.uuid_v7,
  p_request_id app.uuid_v7
) returns jsonb language plpgsql security definer set search_path=''
set lock_timeout='2s' set statement_timeout='15s' as $$
declare
  v_tenant_id app.uuid_v7;
  v_request public.data_governance_requests;
  v_tenant public.tenants;
  v_required_approvals integer;
  v_approval_ids app.uuid_v7[];
begin
  select tenant_id into v_tenant_id
  from public.data_governance_requests
  where tenant_id=p_tenant_id and id=p_request_id;
  if not found then raise exception 'request is not approval pending' using errcode='55000'; end if;
  perform pg_advisory_xact_lock(app.data_governance_tenant_lock_key(v_tenant_id));
  select * into v_tenant from public.tenants where id=v_tenant_id for update;
  select * into v_request from public.data_governance_requests
  where tenant_id=v_tenant_id and id=p_request_id for update;
  if v_request.state not in ('approval_pending','authorized') then
    raise exception 'request is not approval pending' using errcode='55000';
  end if;
  if v_tenant.data_governance_state<>'open' then raise exception 'tenant already fenced' using errcode='55000'; end if;
  if v_request.authorization_expires_at is null or v_request.authorization_expires_at<=now()
     or v_request.expires_at<=now() then
    raise exception 'governance authorization expired' using errcode='42501';
  end if;
  v_required_approvals:=case when v_request.scope='tenant' then 2 else 1 end;
  select array_agg(a.id order by a.id) into v_approval_ids
    from public.data_governance_approvals a
    join public.user_tenant_memberships m
      on m.user_id=a.actor_user_id and m.tenant_id=a.tenant_id and m.actor_id=a.actor_id and m.role='tenant_admin'
    where a.tenant_id=v_request.tenant_id and a.request_id=v_request.id and a.decision='approve'
      and a.command_fingerprint=v_request.command_fingerprint
  ;
  if coalesce(cardinality(v_approval_ids),0)<>v_required_approvals or exists(
    select 1 from public.data_governance_approvals a
    where a.tenant_id=v_request.tenant_id and a.request_id=v_request.id and a.decision='deny'
  ) then
    raise exception 'exact current human tenant_admin approval quorum is required' using errcode='42501';
  end if;
  if not exists(
    select 1 from public.data_governance_policy_decisions d
    where d.tenant_id=v_request.tenant_id and d.request_id=v_request.id and d.decision='allow'
      and d.policy_fingerprint=v_request.policy_fingerprint
      and d.command_fingerprint=v_request.command_fingerprint
      and d.authorization_expires_at=v_request.authorization_expires_at
  ) then raise exception 'allowing policy decision is required' using errcode='42501'; end if;
  if not app.data_governance_catalog_complete()
     or v_request.inventory_fingerprint<>app.data_governance_catalog_fingerprint() then
    raise exception 'data governance catalog drift' using errcode='55000';
  end if;
  if v_request.state='authorized' then
    if v_request.authorized_at is null
       or v_request.authorized_approval_ids is distinct from v_approval_ids
       or v_request.write_epoch<>v_tenant.data_write_epoch then
      raise exception 'authorization replay integrity conflict' using errcode='55000';
    end if;
    return jsonb_build_object(
      'tenantId',v_request.tenant_id,'requestId',v_request.id,
      'state','authorized','writeEpoch',v_request.write_epoch,'replayed',true
    );
  end if;
  update public.data_governance_requests
  set state='authorized',authorized_at=now(),authorized_approval_ids=v_approval_ids,
      write_epoch=v_tenant.data_write_epoch,updated_at=now()
  where tenant_id=v_request.tenant_id and id=v_request.id;
  if v_request.subject_id is not null then
    update public.data_governance_subjects set state='disposition_requested'
    where tenant_id=v_request.tenant_id and id=v_request.subject_id;
  end if;
  return jsonb_build_object(
    'tenantId',v_request.tenant_id,'requestId',v_request.id,
    'state','authorized','writeEpoch',v_tenant.data_write_epoch,'replayed',false
  );
end;
$$;

create or replace function public.portal_register_data_governance_subject_link_service(
  p_tenant_id app.uuid_v7,
  p_subject_id app.uuid_v7,
  p_subject_ref_hmac text,
  p_resource_code text,
  p_resource_locator_hmac text,
  p_database_row_id uuid
) returns jsonb language plpgsql security definer set search_path=''
set lock_timeout='2s' set statement_timeout='15s' as $$
declare
  v_catalog public.data_governance_resource_catalog;
  v_exists boolean;
  v_subject_ref_hmac text;
  v_locator_hmac text;
begin
  perform pg_advisory_xact_lock(app.data_governance_tenant_lock_key(p_tenant_id));
  perform 1 from public.tenants where id=p_tenant_id and data_governance_state='open' for share;
  if not found then raise exception 'tenant does not admit subject linkage' using errcode='55000'; end if;
  select * into v_catalog from public.data_governance_resource_catalog
  where resource_code=p_resource_code and catalog_generation in ('pre_v59','external');
  if not found then raise exception 'subject resource is not cataloged' using errcode='22023'; end if;
  if p_subject_ref_hmac is null or p_subject_ref_hmac!~'^hmac-sha256:[0-9a-f]{64}$'
     or (p_resource_locator_hmac is not null and p_resource_locator_hmac!~'^hmac-sha256:[0-9a-f]{64}$') then
    raise exception 'closed subject manifest input required' using errcode='22023';
  end if;
  if v_catalog.surface='database' then
    if v_catalog.locator_strategy<>'uuid_id' or p_database_row_id is null then
      raise exception 'database subject links require an exact typed UUID row locator' using errcode='22023';
    end if;
    execute format('select exists(select 1 from %s where tenant_id=$1 and id=$2)',v_catalog.relation_name)
      into v_exists using p_tenant_id,p_database_row_id;
    if not v_exists then raise exception 'subject artifact is outside tenant authority' using errcode='42501'; end if;
  elsif p_database_row_id is not null then
    raise exception 'external subject manifest cannot carry a database locator' using errcode='22023';
  end if;
  v_subject_ref_hmac:=app.data_governance_hmac(
    'subject-ref',p_tenant_id::text,p_subject_id::text,'subject',p_subject_ref_hmac
  );
  v_locator_hmac:=app.data_governance_hmac(
    'subject-artifact',p_tenant_id::text,p_subject_id::text,p_resource_code,
    coalesce(p_database_row_id::text,'external-namespace')
  );
  insert into public.data_governance_subjects(tenant_id,id,subject_ref_hmac,state)
  values(p_tenant_id,p_subject_id,v_subject_ref_hmac,'active')
  on conflict (tenant_id,id) do update set subject_ref_hmac=excluded.subject_ref_hmac
  where public.data_governance_subjects.state='active'
    and public.data_governance_subjects.subject_ref_hmac=excluded.subject_ref_hmac;
  if not exists(
    select 1 from public.data_governance_subjects s
    where s.tenant_id=p_tenant_id and s.id=p_subject_id and s.state='active'
      and s.subject_ref_hmac=v_subject_ref_hmac
  ) then raise exception 'subject lineage idempotency conflict' using errcode='23505'; end if;
  insert into public.data_governance_subject_artifact_links(
    tenant_id,subject_id,resource_code,resource_locator_hmac,database_row_id
  ) values(p_tenant_id,p_subject_id,p_resource_code,v_locator_hmac,p_database_row_id)
  on conflict (tenant_id,subject_id,resource_code,resource_locator_hmac) do nothing;
  delete from public.data_governance_subject_coverage_attestations
  where tenant_id=p_tenant_id and subject_id=p_subject_id and resource_code=p_resource_code;
  return jsonb_build_object(
    'subjectId',p_subject_id,'resourceCode',p_resource_code,
    'resourceLocatorHmac',v_locator_hmac,'linked',true
  );
end;
$$;

create or replace function public.portal_attest_data_governance_subject_coverage_service(
  p_tenant_id app.uuid_v7,
  p_subject_id app.uuid_v7,
  p_resource_code text,
  p_manifest_version text,
  p_linked_count integer,
  p_observation_fingerprint text,
  p_authority_id app.uuid_v7,
  p_attestation_hmac text
) returns jsonb language plpgsql security definer set search_path=''
set lock_timeout='2s' set statement_timeout='15s' as $$
declare
  v_actual_count integer;
  v_catalog_fingerprint text;
  v_record_fingerprint text;
  v_authority_key_fingerprint text;
  v_authority_payload text;
begin
  perform pg_advisory_xact_lock(app.data_governance_tenant_lock_key(p_tenant_id));
  perform 1 from public.tenants t
  join public.data_governance_subjects s on s.tenant_id=t.id
  where t.id=p_tenant_id and t.data_governance_state='open'
    and s.id=p_subject_id and s.state='active'
  for share of t,s;
  if not found then
    raise exception 'active same-tenant subject required for coverage attestation' using errcode='42501';
  end if;
  if p_manifest_version<>'1.0.0' or p_linked_count is null or p_linked_count not between 0 and 10000
     or p_observation_fingerprint is null or p_observation_fingerprint!~'^[0-9a-f]{64}$'
     or not exists(
       select 1 from public.data_governance_resource_catalog c
       where c.resource_code=p_resource_code and c.catalog_generation='pre_v59'
         and c.subject_link_required
     ) then
    raise exception 'closed subject coverage attestation required' using errcode='22023';
  end if;
  select count(*) into v_actual_count
  from public.data_governance_subject_artifact_links l
  where l.tenant_id=p_tenant_id and l.subject_id=p_subject_id
    and l.resource_code=p_resource_code;
  if v_actual_count<>p_linked_count then
    raise exception 'coverage count does not match the durable subject lineage' using errcode='55000';
  end if;
  v_catalog_fingerprint:=app.data_governance_catalog_fingerprint();
  v_authority_payload:=app.sha256_tuple(
    'coverage-producer@1',p_tenant_id::text,p_subject_id::text,p_resource_code,
    p_manifest_version,p_linked_count::text,p_observation_fingerprint,v_catalog_fingerprint
  );
  if not app.data_governance_verify_authority_hmac(
    'coverage_producer',p_resource_code,p_authority_id,v_authority_payload,p_attestation_hmac
  ) then
    raise exception 'independent producer coverage authority required' using errcode='42501';
  end if;
  select key_fingerprint into v_authority_key_fingerprint
  from app.data_governance_attestation_authorities
  where authority_kind='coverage_producer' and resource_code=p_resource_code
    and authority_id=p_authority_id and active;
  v_record_fingerprint:=app.data_governance_hmac(
    'subject-coverage',p_tenant_id::text,p_subject_id::text,p_resource_code,
    p_manifest_version||'|'||p_linked_count::text||'|'||p_observation_fingerprint||'|'||v_catalog_fingerprint
  );
  insert into public.data_governance_subject_coverage_attestations(
    tenant_id,subject_id,resource_code,manifest_version,catalog_fingerprint,
    linked_count,observation_fingerprint,authority_id,authority_key_fingerprint,record_fingerprint
  ) values(
    p_tenant_id,p_subject_id,p_resource_code,p_manifest_version,v_catalog_fingerprint,
    p_linked_count,p_observation_fingerprint,p_authority_id,v_authority_key_fingerprint,v_record_fingerprint
  ) on conflict (tenant_id,subject_id,resource_code) do update
    set manifest_version=excluded.manifest_version,
        catalog_fingerprint=excluded.catalog_fingerprint,
        linked_count=excluded.linked_count,
        observation_fingerprint=excluded.observation_fingerprint,
        authority_id=excluded.authority_id,
        authority_key_fingerprint=excluded.authority_key_fingerprint,
        record_fingerprint=excluded.record_fingerprint,
        attested_at=now()
    where public.data_governance_subject_coverage_attestations.manifest_version=excluded.manifest_version;
  return jsonb_build_object(
    'subjectId',p_subject_id,'resourceCode',p_resource_code,
    'linkedCount',p_linked_count,'authorityId',p_authority_id,
    'recordFingerprint',v_record_fingerprint
  );
end;
$$;

create or replace function app.data_governance_inventory_complete(
  p_tenant_id app.uuid_v7,
  p_request_id app.uuid_v7
) returns boolean language plpgsql stable security definer set search_path='' as $$
declare v_request public.data_governance_requests; r record; v_row_count bigint; v_item_count bigint; v_expected_items bigint;
begin
  select * into v_request from public.data_governance_requests
  where tenant_id=p_tenant_id and id=p_request_id;
  if not found or not app.data_governance_catalog_complete() then return false; end if;
  if v_request.scope='data_subject' then
    if not exists(
      select 1 from public.data_governance_subject_artifact_links l
      where l.tenant_id=p_tenant_id and l.subject_id=v_request.subject_id
    ) then return false; end if;
    if exists(
      select 1
      from public.data_governance_resource_catalog c
      where c.catalog_generation='pre_v59' and c.subject_link_required
        and not exists(
          select 1
          from public.data_governance_subject_coverage_attestations a
          where a.tenant_id=p_tenant_id and a.subject_id=v_request.subject_id
            and a.resource_code=c.resource_code
            and a.manifest_version=v_request.inventory_version
            and a.catalog_fingerprint=v_request.inventory_fingerprint
            and exists(
              select 1 from app.data_governance_attestation_authorities authority
              where authority.authority_kind='coverage_producer'
                and authority.resource_code=a.resource_code
                and authority.authority_id=a.authority_id and authority.active
                and authority.key_fingerprint=a.authority_key_fingerprint
            )
            and a.linked_count=(
              select count(*)
              from public.data_governance_subject_artifact_links l
              where l.tenant_id=p_tenant_id and l.subject_id=v_request.subject_id
                and l.resource_code=c.resource_code
            )
        )
    ) then return false; end if;
    if exists(
      select 1 from public.data_governance_resource_catalog c
      where c.catalog_generation='external'
        and not exists(
          select 1 from public.data_governance_subject_artifact_links l
          where l.tenant_id=p_tenant_id and l.subject_id=v_request.subject_id and l.resource_code=c.resource_code
        )
    ) then return false; end if;
    if exists(
      select 1 from public.data_governance_work_items i
      where i.tenant_id=p_tenant_id and i.request_id=p_request_id
        and i.state not in ('verified','retained_exception')
    ) then
      return not exists(
        select 1 from public.data_governance_subject_artifact_links l
        where l.tenant_id=p_tenant_id and l.subject_id=v_request.subject_id
          and not exists(
            select 1 from public.data_governance_work_items i
            where i.tenant_id=l.tenant_id and i.request_id=p_request_id
              and i.resource_code=l.resource_code
              and i.resource_locator_hmac=l.resource_locator_hmac
              and i.database_row_id is not distinct from l.database_row_id
          )
      );
    end if;
    return not exists(
      select 1
      from (
        select resource_code,count(*) link_count
        from public.data_governance_subject_artifact_links
        where tenant_id=p_tenant_id and subject_id=v_request.subject_id
        group by resource_code
      ) l
      left join (
        select resource_code,count(*) item_count
        from public.data_governance_work_items
        where tenant_id=p_tenant_id and request_id=p_request_id and state in ('verified','retained_exception')
        group by resource_code
      ) i using(resource_code)
      where l.link_count<>coalesce(i.item_count,0)
    );
  end if;
  for r in
    select resource_code,relation_name,locator_strategy
    from public.data_governance_resource_catalog
    where catalog_generation='pre_v59' and surface='database' and relation_name<>'public.tenants'
  loop
    execute format('select count(*) from %s where tenant_id=$1',r.relation_name)
      into v_row_count using p_tenant_id;
    select count(*) into v_item_count from public.data_governance_work_items i
    where i.tenant_id=p_tenant_id and i.request_id=p_request_id and i.resource_code=r.resource_code;
    v_expected_items:=case when r.locator_strategy='uuid_id' then v_row_count when v_row_count=0 then 0 else 1 end;
    if v_expected_items<>v_item_count then return false; end if;
  end loop;
  if not exists(
    select 1 from public.data_governance_work_items i
    where i.tenant_id=p_tenant_id and i.request_id=p_request_id and i.resource_code='db_tenants'
  ) then return false; end if;
  if exists(
    select 1 from public.data_governance_resource_catalog c
    where c.catalog_generation='external'
      and not exists(
        select 1 from public.data_governance_work_items i
        where i.tenant_id=p_tenant_id and i.request_id=p_request_id and i.resource_code=c.resource_code
      )
  ) then return false; end if;
  return true;
end;
$$;

create or replace function public.portal_inventory_data_governance_request_service(
  p_tenant_id app.uuid_v7,
  p_request_id app.uuid_v7,
  p_item_id app.uuid_v7,
  p_resource_code text,
  p_resource_locator_hmac text,
  p_database_row_id uuid,
  p_subject_id app.uuid_v7,
  p_finish boolean
) returns jsonb language plpgsql security definer set search_path=''
set lock_timeout='2s' set statement_timeout='30s' as $$
declare
  v_tenant_id app.uuid_v7;
  v_request public.data_governance_requests;
  v_catalog public.data_governance_resource_catalog;
  v_action text;
  v_exists boolean;
  v_state text;
  v_resource_count integer:=1;
  v_locator_hmac text;
begin
  select tenant_id into v_tenant_id from public.data_governance_requests
  where tenant_id=p_tenant_id and id=p_request_id;
  if not found then raise exception 'request is not inventoryable' using errcode='55000'; end if;
  perform pg_advisory_xact_lock(app.data_governance_tenant_lock_key(v_tenant_id));
  select * into v_request from public.data_governance_requests
  where tenant_id=v_tenant_id and id=p_request_id for update;
  if v_request.state not in ('authorized','inventorying') then
    raise exception 'request is not inventoryable' using errcode='55000';
  end if;
  if v_request.inventory_fingerprint<>app.data_governance_catalog_fingerprint()
     or not app.data_governance_catalog_complete() then
    raise exception 'data governance catalog drift' using errcode='55000';
  end if;
  update public.data_governance_requests set state='inventorying',updated_at=now()
  where tenant_id=v_request.tenant_id and id=v_request.id;
  if p_item_id is not null then
    if (
      select count(*) from public.data_governance_work_items i
      where i.tenant_id=v_request.tenant_id and i.request_id=v_request.id
    )>=4096 then
      update public.data_governance_requests set state='operator_required',updated_at=now()
      where tenant_id=v_request.tenant_id and id=v_request.id;
      return jsonb_build_object('tenantId',v_request.tenant_id,'requestId',v_request.id,'state','operator_required');
    end if;
    select * into v_catalog from public.data_governance_resource_catalog
    where resource_code=p_resource_code and catalog_generation in ('pre_v59','external');
    if not found then raise exception 'resource code is not inventoryable' using errcode='22023'; end if;
    if v_catalog.surface='database' then
      if p_database_row_id is null then raise exception 'database row id required' using errcode='22023'; end if;
      if v_catalog.relation_name='public.tenants' then
        v_exists:=p_database_row_id=v_request.tenant_id;
      elsif v_catalog.locator_strategy='uuid_id' then
        execute format('select exists(select 1 from %s where tenant_id=$1 and id=$2)',v_catalog.relation_name)
          into v_exists using v_request.tenant_id,p_database_row_id;
      else
        if p_database_row_id<>v_request.tenant_id then
          raise exception 'tenant relation locator must equal the exact tenant' using errcode='22023';
        end if;
        execute format('select exists(select 1 from %s where tenant_id=$1)',v_catalog.relation_name)
          into v_exists using v_request.tenant_id;
        execute format('select count(*) from %s where tenant_id=$1',v_catalog.relation_name)
          into v_resource_count using v_request.tenant_id;
        if v_resource_count>10000 then
          update public.data_governance_requests set state='operator_required',updated_at=now()
          where tenant_id=v_request.tenant_id and id=v_request.id;
          return jsonb_build_object('tenantId',v_request.tenant_id,'requestId',v_request.id,'state','operator_required');
        end if;
      end if;
      if not v_exists then raise exception 'database inventory row missing' using errcode='55000'; end if;
    elsif p_database_row_id is not null then
      raise exception 'external target cannot carry database row id' using errcode='22023';
    end if;
    v_locator_hmac:=app.data_governance_hmac(
      case when v_request.scope='data_subject' then 'subject-artifact' else 'tenant-artifact' end,
      v_request.tenant_id::text,coalesce(v_request.subject_id::text,''),p_resource_code,
      coalesce(p_database_row_id::text,'external-namespace')
    );
    if v_request.scope='data_subject' then
      if (v_catalog.surface='database' and v_catalog.locator_strategy<>'uuid_id')
         or (v_catalog.surface<>'database' and v_catalog.locator_strategy<>'external_fixed_target')
         or p_subject_id is distinct from v_request.subject_id or not exists(
        select 1 from public.data_governance_subject_artifact_links l
        where l.tenant_id=v_request.tenant_id and l.subject_id=v_request.subject_id
          and l.resource_code=p_resource_code and l.resource_locator_hmac=v_locator_hmac
          and l.database_row_id is not distinct from p_database_row_id
      ) then
        update public.data_governance_requests set state='operator_required',updated_at=now()
        where tenant_id=v_request.tenant_id and id=v_request.id;
        return jsonb_build_object('tenantId',v_request.tenant_id,'requestId',v_request.id,'state','operator_required');
      end if;
    elsif p_subject_id is not null then
      raise exception 'tenant inventory item cannot claim a subject' using errcode='22023';
    end if;
    v_action:=case
      when v_request.requested_action='redact' and v_catalog.surface='backup' then 'backup_expiry_wait'
      when v_request.requested_action='redact' then 'redact'
      when v_catalog.surface='database' and v_catalog.default_action in ('redact','crypto_erase') then 'irreversible_delete'
      else v_catalog.default_action
    end;
    insert into public.data_governance_work_items(
      tenant_id,id,request_id,subject_id,resource_code,resource_locator_hmac,database_row_id,resource_count,action,state
    ) values(
      v_request.tenant_id,p_item_id,v_request.id,p_subject_id,p_resource_code,v_locator_hmac,p_database_row_id,v_resource_count,v_action,'pending'
    ) on conflict (tenant_id,request_id,resource_code,resource_locator_hmac) do nothing;
    if not exists(
      select 1 from public.data_governance_work_items i
      where i.tenant_id=v_request.tenant_id and i.id=p_item_id and i.request_id=v_request.id
        and i.resource_code=p_resource_code and i.resource_locator_hmac=v_locator_hmac
        and i.database_row_id is not distinct from p_database_row_id and i.action=v_action
    ) then raise exception 'inventory item idempotency conflict' using errcode='23505'; end if;
  end if;
  if coalesce(p_finish,false) then
    if not app.data_governance_inventory_complete(v_request.tenant_id,v_request.id) then
      update public.data_governance_requests set state='operator_required',updated_at=now()
      where tenant_id=v_request.tenant_id and id=v_request.id;
      return jsonb_build_object('tenantId',v_request.tenant_id,'requestId',v_request.id,'state','operator_required');
    end if;
    update public.data_governance_work_items i
    set state='held',outcome_code='legal_hold',updated_at=now()
    where i.tenant_id=v_request.tenant_id and i.request_id=v_request.id
      and app.data_governance_has_active_hold(i.tenant_id,i.resource_code,i.subject_id,coalesce(i.resource_locator_hmac,i.verification_locator_hmac));
    if exists(
      select 1 from public.data_governance_work_items i
      where i.tenant_id=v_request.tenant_id and i.request_id=v_request.id and i.state='held'
    ) then v_state:='blocked_by_legal_hold'; else v_state:='ready'; end if;
    update public.data_governance_requests
    set state=v_state,inventory_completed_at=now(),
        inventory_item_count=(
          select count(*) from public.data_governance_work_items i
          where i.tenant_id=v_request.tenant_id and i.request_id=v_request.id
        ),
        inventory_resource_count=(
          select coalesce(sum(i.resource_count),0) from public.data_governance_work_items i
          where i.tenant_id=v_request.tenant_id and i.request_id=v_request.id
        ),
        updated_at=now()
    where tenant_id=v_request.tenant_id and id=v_request.id;
  else v_state:='inventorying'; end if;
  return jsonb_build_object('tenantId',v_request.tenant_id,'requestId',v_request.id,'state',v_state);
end;
$$;

create or replace function public.portal_lease_data_governance_work_items_service(
  p_tenant_id app.uuid_v7,
  p_request_id app.uuid_v7,
  p_worker_id app.uuid_v7,
  p_lease_token app.uuid_v7,
  p_limit integer,
  p_lease_seconds integer
) returns jsonb language plpgsql security definer set search_path=''
set lock_timeout='2s' set statement_timeout='15s' as $$
declare v_tenant_id app.uuid_v7; v_request public.data_governance_requests; v_result jsonb; v_tenant public.tenants; v_epoch bigint;
begin
  if p_limit is null or p_limit not between 1 and 50 or p_lease_seconds is null or p_lease_seconds not between 5 and 300 then
    raise exception 'bounded lease parameters required' using errcode='22023';
  end if;
  select r.tenant_id into v_tenant_id
  from public.data_governance_requests r
  where r.tenant_id=p_tenant_id and r.id=p_request_id;
  if not found then raise exception 'request is not executable' using errcode='55000'; end if;
  perform pg_advisory_xact_lock(app.data_governance_tenant_lock_key(v_tenant_id));
  select * into v_request from public.data_governance_requests
  where tenant_id=v_tenant_id and id=p_request_id for update;
  if v_request.state not in (
    'ready','blocked_by_legal_hold','executing_redaction','executing_irreversible_deletion','retry_wait','effect_unknown','verifying'
  ) then raise exception 'request is not executable' using errcode='55000'; end if;
  if v_request.authorization_expires_at is null
     or (
       v_request.irreversible_started_at is null
       and (v_request.authorization_expires_at<=now() or v_request.expires_at<=now())
     ) then
    raise exception 'governance authorization expired before execution' using errcode='42501';
  end if;
  if not exists(
    select 1 from public.data_governance_policy_decisions d
    where d.tenant_id=v_request.tenant_id and d.request_id=v_request.id
      and d.decision='allow' and d.policy_fingerprint=v_request.policy_fingerprint
      and d.command_fingerprint=v_request.command_fingerprint
      and d.authorization_expires_at=v_request.authorization_expires_at
      and (v_request.irreversible_started_at is not null or d.authorization_expires_at>now())
  ) then
    raise exception 'live policy-bound execution authority required' using errcode='42501';
  end if;
  if v_request.scope='tenant' then
    select * into v_tenant from public.tenants where id=v_request.tenant_id for update;
    if v_tenant.data_governance_state='open' then
      if not app.data_governance_inventory_complete(v_request.tenant_id,v_request.id) then
        raise exception 'complete inventory required before tenant fence' using errcode='55000';
      end if;
      if (
        select count(distinct a.actor_id)
        from public.data_governance_approvals a
        join public.user_tenant_memberships m
          on m.user_id=a.actor_user_id and m.tenant_id=a.tenant_id and m.actor_id=a.actor_id and m.role='tenant_admin'
        where a.tenant_id=v_request.tenant_id and a.request_id=v_request.id and a.decision='approve'
          and a.command_fingerprint=v_request.command_fingerprint
          and a.id=any(v_request.authorized_approval_ids)
      )<>2 or cardinality(v_request.authorized_approval_ids)<>2 then
        raise exception 'two exact current tenant_admin approvals required at closing fence' using errcode='42501';
      end if;
      if exists(
        select 1 from public.provider_effect_reservations
        where tenant_id=v_request.tenant_id and state in ('reserved','provider_in_flight','unknown','cleanup_pending')
      ) or exists(
        select 1 from public.ai_usage_reservations
        where tenant_id=v_request.tenant_id and state in ('reserved','provider_in_flight','unknown')
      ) or exists(
        select 1 from public.meeting_terminal_notification_outbox
        where tenant_id=v_request.tenant_id and status in ('pending','delivering','retry_wait','ambiguous')
      ) or exists(
        select 1 from public.billing_usage_outbox
        where tenant_id=v_request.tenant_id and status in ('pending','delivering','failed')
      ) or exists(
        select 1 from public.billing_checkout_intents
        where tenant_id=v_request.tenant_id and state in ('reserved','dispatched','bound','unknown','conflict')
      ) or exists(
        select 1 from public.workflow_runs
        where tenant_id=v_request.tenant_id and status in ('queued','running','waiting')
      ) then raise exception 'tenant has unsettled provider effects' using errcode='55000'; end if;
      v_epoch:=v_tenant.data_write_epoch+1;
      update public.tenants set data_governance_state='fenced',data_write_epoch=v_epoch,status='closing',updated_at=now()
      where id=v_request.tenant_id;
      update public.data_governance_requests set write_epoch=v_epoch,updated_at=now()
      where tenant_id=v_request.tenant_id and id=v_request.id;
      v_request.write_epoch:=v_epoch;
    elsif v_tenant.data_governance_state<>'fenced' or v_tenant.data_write_epoch<>v_request.write_epoch then
      raise exception 'tenant fence is stale' using errcode='55000';
    end if;
  else
    if cardinality(v_request.authorized_approval_ids)<>1 or (
      select count(*)
      from public.data_governance_approvals a
      join public.user_tenant_memberships m
        on m.user_id=a.actor_user_id and m.tenant_id=a.tenant_id
        and m.actor_id=a.actor_id and m.role='tenant_admin'
      where a.tenant_id=v_request.tenant_id and a.request_id=v_request.id
        and a.decision='approve' and a.command_fingerprint=v_request.command_fingerprint
        and a.id=any(v_request.authorized_approval_ids)
    )<>1 then
      raise exception 'current subject disposition approval required at execution fence' using errcode='42501';
    end if;
    select * into v_tenant from public.tenants where id=v_request.tenant_id for share;
    if v_tenant.data_governance_state<>'open' or v_tenant.data_write_epoch<>v_request.write_epoch then
      raise exception 'subject disposition generation is stale' using errcode='55000';
    end if;
  end if;
  insert into public.data_governance_attempt_receipts(
    tenant_id,id,request_id,work_item_id,attempt_number,operation,fencing_token,
    outcome_code,result_fingerprint
  )
  select
    i.tenant_id,app.data_governance_new_uuid_v7(),i.request_id,i.id,i.attempt_count,i.current_operation,
    i.fencing_token,
    case
      when i.attempt_count>=i.max_attempts then 'permanent_failure'
      when i.current_operation in ('apply','reconcile') and i.dispatch_fenced_at is not null then 'effect_unknown'
      else 'retryable_failure'
    end,
    app.sha256_tuple(
      i.request_id::text,i.id::text,i.current_operation,i.fencing_token::text,
      case
        when i.attempt_count>=i.max_attempts then 'lease_expired_budget_exhausted'
        when i.current_operation in ('apply','reconcile') and i.dispatch_fenced_at is not null then 'lease_expired_after_dispatch'
        else 'lease_expired_before_external_dispatch'
      end
    )
  from public.data_governance_work_items i
  where i.tenant_id=v_request.tenant_id and i.request_id=v_request.id
    and i.state in ('leased','applying') and i.lease_expires_at<=now()
  on conflict (tenant_id,work_item_id,attempt_number) do nothing;
  update public.data_governance_work_items
  set state=case
        when attempt_count>=max_attempts then 'operator_required'
        when current_operation='verify' then 'verification_pending'
        when current_operation in ('apply','reconcile') and dispatch_fenced_at is not null then 'effect_unknown'
        else 'retry_wait'
      end,
      outcome_code=case
        when attempt_count>=max_attempts then 'permanent_failure'
        when current_operation in ('apply','reconcile') and dispatch_fenced_at is not null then 'effect_unknown'
        else 'retryable_failure'
      end,
      resume_operation=case
        when attempt_count>=max_attempts then null
        when current_operation='verify' then null
        when current_operation in ('apply','reconcile') and dispatch_fenced_at is not null then null
        else current_operation
      end,
      current_operation=null,lease_owner=null,lease_token=null,lease_expires_at=null,
      operation_identity=null,dispatch_fenced_at=null,verification_challenge_hmac=null,
      next_attempt_at=case
        when attempt_count<max_attempts
         and current_operation<>'verify'
         and not (current_operation in ('apply','reconcile') and dispatch_fenced_at is not null)
        then now()
        else null
      end,
      updated_at=now()
  where tenant_id=v_request.tenant_id and request_id=v_request.id
    and state in ('leased','applying') and lease_expires_at<=now();
  if exists(
    select 1 from public.data_governance_work_items i
    where i.tenant_id=v_request.tenant_id and i.request_id=v_request.id and i.state='operator_required'
  ) then
    update public.data_governance_requests set state='operator_required',updated_at=now()
    where tenant_id=v_request.tenant_id and id=v_request.id;
    return '[]'::jsonb;
  elsif exists(
    select 1 from public.data_governance_work_items i
    where i.tenant_id=v_request.tenant_id and i.request_id=v_request.id and i.state='effect_unknown'
  ) then
    update public.data_governance_requests set state='effect_unknown',updated_at=now()
    where tenant_id=v_request.tenant_id and id=v_request.id;
  elsif exists(
    select 1 from public.data_governance_work_items i
    where i.tenant_id=v_request.tenant_id and i.request_id=v_request.id and i.state='retry_wait'
  ) then
    update public.data_governance_requests set state='retry_wait',updated_at=now()
    where tenant_id=v_request.tenant_id and id=v_request.id;
  end if;
  with candidates as (
    select i.tenant_id,i.id,c.surface
    from public.data_governance_work_items i
    join public.data_governance_resource_catalog c on c.resource_code=i.resource_code
    where i.tenant_id=v_request.tenant_id and i.request_id=v_request.id
      and (
        (i.state='retry_wait' and i.next_attempt_at<=now() and i.resume_operation is not null)
        or (i.state in ('pending','verification_pending','effect_unknown') and i.next_attempt_at is null)
      )
      and i.attempt_count<i.max_attempts
      and not (i.resource_code='db_tenants' and i.state='verification_pending')
      and not app.data_governance_has_active_hold(i.tenant_id,i.resource_code,i.subject_id,coalesce(i.resource_locator_hmac,i.verification_locator_hmac))
      and not (
        v_request.scope='tenant'
        and i.resource_code in ('db_user_tenant_memberships','db_tenants')
        and exists(
          select 1 from public.data_legal_holds h
          where h.tenant_id=i.tenant_id and h.state='active'
        )
      )
      and (
        c.surface<>'database'
        or not exists(
          select 1
          from public.data_governance_work_items external_item
          join public.data_governance_resource_catalog external_catalog
            on external_catalog.resource_code=external_item.resource_code
          where external_item.tenant_id=i.tenant_id
            and external_item.request_id=i.request_id
            and external_catalog.surface<>'database'
            and external_item.state not in ('verified','retained_exception')
        )
      )
      and (
        c.surface<>'database'
        or c.deletion_order=(
          select min(c2.deletion_order)
          from public.data_governance_work_items i2
          join public.data_governance_resource_catalog c2 on c2.resource_code=i2.resource_code
          where i2.tenant_id=i.tenant_id and i2.request_id=i.request_id
            and c2.surface='database'
            and i2.state not in ('verified','retained_exception')
        )
      )
    order by c.deletion_order,i.created_at,i.id
    for update of i skip locked limit p_limit
  ), leased as (
    update public.data_governance_work_items i
    set state='leased',attempt_count=i.attempt_count+1,lease_owner=p_worker_id,
        lease_token=p_lease_token,lease_expires_at=now()+make_interval(secs=>p_lease_seconds),
        fencing_token=i.fencing_token+1,
        current_operation=case i.state
          when 'effect_unknown' then 'reconcile'
          when 'verification_pending' then 'verify'
          when 'retry_wait' then i.resume_operation
          else 'apply'
        end,
        resume_operation=null,
        operation_identity=app.sha256_tuple(
          i.request_id::text,i.id::text,
          case i.state
            when 'effect_unknown' then 'reconcile'
            when 'verification_pending' then 'verify'
            when 'retry_wait' then i.resume_operation
            else 'apply'
          end
        ),
        dispatch_fenced_at=null,
        verification_challenge_hmac=case when c.surface='database' then null else app.data_governance_hmac(
          'external-attestation',i.tenant_id::text,coalesce(i.subject_id::text,''),i.resource_code,
          app.sha256_tuple(
            i.request_id::text,i.id::text,
            case i.state
              when 'effect_unknown' then 'reconcile'
              when 'verification_pending' then 'verify'
              when 'retry_wait' then i.resume_operation
              else 'apply'
            end,
            (i.fencing_token+1)::text,p_lease_token::text
          )
        ) end,
        next_attempt_at=null,
        updated_at=now()
    from candidates c where i.tenant_id=c.tenant_id and i.id=c.id
    returning i.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'tenantId',l.tenant_id,
    'workItemId',l.id,'requestId',l.request_id,'resourceCode',l.resource_code,
    'surface',c.surface,'resourceClass',c.resource_class,
    'scope',v_request.scope,'subjectId',l.subject_id,
    'resourceLocatorHmac',l.resource_locator_hmac,'action',l.action,'state',l.state,
    'resourceCount',l.resource_count,
    'operation',l.current_operation,
    'operationIdentity',l.operation_identity,
    'attestationChallengeHmac',l.verification_challenge_hmac,
    'attemptCount',l.attempt_count,'maxAttempts',l.max_attempts,'leaseToken',l.lease_token,
    'leaseExpiresAt',l.lease_expires_at,'fencingToken',l.fencing_token
  ) order by l.created_at,l.id),'[]'::jsonb) into v_result
  from leased l
  join public.data_governance_resource_catalog c on c.resource_code=l.resource_code;
  if jsonb_array_length(v_result)>0 then
    update public.data_governance_requests
    set state=case when requested_action='redact' then 'executing_redaction' else 'executing_irreversible_deletion' end,
        irreversible_started_at=coalesce(irreversible_started_at,now()),
        updated_at=now()
    where tenant_id=v_request.tenant_id and id=v_request.id;
  end if;
  return v_result;
end;
$$;

create or replace function public.portal_begin_data_governance_external_operation_service(
  p_tenant_id app.uuid_v7,
  p_request_id app.uuid_v7,
  p_item_id app.uuid_v7,
  p_lease_token app.uuid_v7,
  p_fencing_token bigint,
  p_operation text
) returns jsonb language plpgsql security definer set search_path=''
set lock_timeout='2s' set statement_timeout='15s' as $$
declare
  v_request public.data_governance_requests;
  v_item public.data_governance_work_items;
  v_catalog public.data_governance_resource_catalog;
begin
  perform 1 from public.data_governance_requests r
  where r.tenant_id=p_tenant_id and r.id=p_request_id;
  if not found then raise exception 'request is not executable' using errcode='55000'; end if;
  perform pg_advisory_xact_lock(app.data_governance_tenant_lock_key(p_tenant_id));
  select * into v_request from public.data_governance_requests r
  where r.tenant_id=p_tenant_id and r.id=p_request_id for update;
  if v_request.state not in (
    'executing_redaction','executing_irreversible_deletion','retry_wait','effect_unknown','verifying'
  ) then raise exception 'request is not executable' using errcode='55000'; end if;
  select * into v_item from public.data_governance_work_items i
  where i.tenant_id=p_tenant_id and i.request_id=p_request_id and i.id=p_item_id
  for update;
  if not found
     or v_item.state not in ('leased','applying')
     or v_item.lease_token is distinct from p_lease_token
     or v_item.lease_expires_at<=now()
     or v_item.fencing_token<>p_fencing_token
     or v_item.current_operation<>p_operation
     or v_item.operation_identity is null
     or v_item.verification_challenge_hmac is null then
    raise exception 'valid external work item lease required' using errcode='55000';
  end if;
  select * into v_catalog from public.data_governance_resource_catalog c
  where c.resource_code=v_item.resource_code;
  if not found or v_catalog.surface='database' then
    raise exception 'external work item required' using errcode='22023';
  end if;
  if v_item.state='applying' then
    if v_item.dispatch_fenced_at is null then
      raise exception 'external dispatch fence integrity conflict' using errcode='55000';
    end if;
    return jsonb_build_object(
      'tenantId',v_item.tenant_id,'workItemId',v_item.id,'state','applying',
      'operation',v_item.current_operation,'operationIdentity',v_item.operation_identity,
      'fencingToken',v_item.fencing_token,'leaseToken',v_item.lease_token,'replayed',true
    );
  end if;
  if v_item.dispatch_fenced_at is not null then
    raise exception 'external dispatch fence integrity conflict' using errcode='55000';
  end if;
  if app.data_governance_has_active_hold(
    v_item.tenant_id,v_item.resource_code,v_item.subject_id,
    coalesce(v_item.resource_locator_hmac,v_item.verification_locator_hmac)
  ) then
    raise exception 'active legal hold blocks external operation' using errcode='55000';
  end if;
  update public.data_governance_work_items
  set state='applying',dispatch_fenced_at=clock_timestamp(),updated_at=now()
  where tenant_id=v_item.tenant_id and id=v_item.id;
  return jsonb_build_object(
    'tenantId',v_item.tenant_id,'workItemId',v_item.id,'state','applying',
    'operation',v_item.current_operation,'operationIdentity',v_item.operation_identity,
    'fencingToken',v_item.fencing_token,'leaseToken',v_item.lease_token,'replayed',false
  );
end;
$$;

create or replace function public.portal_apply_data_governance_database_item_service(
  p_tenant_id app.uuid_v7,
  p_request_id app.uuid_v7,
  p_item_id app.uuid_v7,
  p_lease_token app.uuid_v7,
  p_fencing_token bigint
) returns jsonb language plpgsql security definer set search_path=''
set lock_timeout='2s' set statement_timeout='30s' as $$
declare
  v_tenant_id app.uuid_v7;
  v_request public.data_governance_requests;
  v_item public.data_governance_work_items;
  v_catalog public.data_governance_resource_catalog;
  v_rows bigint;
  v_outcome text;
  v_target_state text;
  v_absent boolean;
  v_verification_digest text;
begin
  select r.tenant_id into v_tenant_id
  from public.data_governance_requests r
  where r.tenant_id=p_tenant_id and r.id=p_request_id;
  if not found then raise exception 'request is not executing' using errcode='55000'; end if;
  perform pg_advisory_xact_lock(app.data_governance_tenant_lock_key(v_tenant_id));
  select * into v_request from public.data_governance_requests
  where tenant_id=v_tenant_id and id=p_request_id for update;
  if v_request.state not in (
    'executing_redaction','executing_irreversible_deletion','retry_wait','verifying'
  ) then
    raise exception 'request is not executing' using errcode='55000';
  end if;
  -- Tenant closure requires the global catalog fence. A data-subject request
  -- keeps the tenant open and relies on the exact subject/artifact item fence.
  if v_request.scope='tenant' then
    perform 1 from public.tenants
    where id=v_request.tenant_id and data_governance_state='fenced' and data_write_epoch=v_request.write_epoch
    for key share;
  else
    perform 1 from public.tenants
    where id=v_request.tenant_id and data_governance_state='open' and data_write_epoch=v_request.write_epoch
    for key share;
  end if;
  if not found then raise exception 'data governance write fence is stale' using errcode='55000'; end if;
  select * into v_item from public.data_governance_work_items
  where tenant_id=v_request.tenant_id and id=p_item_id and request_id=v_request.id for update;
  if not found or v_item.state<>'leased' or v_item.lease_token<>p_lease_token
     or v_item.fencing_token<>p_fencing_token or v_item.current_operation not in ('apply','verify')
     or v_item.lease_expires_at<=now() then
    raise exception 'valid work item lease required' using errcode='55000';
  end if;
  select * into v_catalog from public.data_governance_resource_catalog where resource_code=v_item.resource_code;
  if not found or v_catalog.surface<>'database' then raise exception 'database item required' using errcode='22023'; end if;
  if app.data_governance_has_active_hold(v_item.tenant_id,v_item.resource_code,v_item.subject_id,coalesce(v_item.resource_locator_hmac,v_item.verification_locator_hmac)) then
    update public.data_governance_work_items
    set state='held',outcome_code='legal_hold',current_operation=null,lease_owner=null,
        lease_token=null,lease_expires_at=null,operation_identity=null,
        dispatch_fenced_at=null,verification_challenge_hmac=null,resume_operation=null,
        next_attempt_at=null,updated_at=now()
    where tenant_id=v_item.tenant_id and id=v_item.id;
    update public.data_governance_requests set state='blocked_by_legal_hold',updated_at=now()
    where tenant_id=v_request.tenant_id and id=v_request.id;
    return jsonb_build_object(
      'tenantId',v_item.tenant_id,'workItemId',v_item.id,
      'state','held','outcomeCode','legal_hold'
    );
  end if;
  if v_catalog.relation_name='public.tenants' then
    if v_item.current_operation<>'apply' or v_item.action<>'irreversible_delete' then
      raise exception 'tenant root only accepts irreversible apply' using errcode='42501';
    end if;
    update public.data_governance_work_items
    set state='verification_pending',outcome_code='applied',current_operation=null,
        lease_owner=null,lease_token=null,lease_expires_at=null,operation_identity=null,
        dispatch_fenced_at=null,verification_challenge_hmac=null,resume_operation=null,
        next_attempt_at=null,updated_at=now()
    where tenant_id=v_item.tenant_id and id=v_item.id;
    insert into public.data_governance_attempt_receipts(
      tenant_id,id,request_id,work_item_id,attempt_number,operation,fencing_token,outcome_code,result_fingerprint
    ) values(v_item.tenant_id,app.data_governance_new_uuid_v7(),v_request.id,v_item.id,v_item.attempt_count,'apply',v_item.fencing_token,'applied',app.sha256_tuple(v_request.id::text,v_item.id::text,'apply',v_item.fencing_token::text,'tenant_tombstone_pending'));
    return jsonb_build_object(
      'tenantId',v_item.tenant_id,'workItemId',v_item.id,
      'state','verification_pending','outcomeCode','applied'
    );
  end if;
  if v_catalog.locator_strategy not in ('uuid_id','tenant_relation')
     or v_item.database_row_id is null
     or (v_catalog.locator_strategy='tenant_relation' and (v_request.scope<>'tenant' or v_item.database_row_id<>v_item.tenant_id)) then
    update public.data_governance_work_items
    set state='operator_required',outcome_code='permanent_failure',current_operation=null,lease_owner=null,lease_token=null,lease_expires_at=null,updated_at=now()
    where tenant_id=v_item.tenant_id and id=v_item.id;
    insert into public.data_governance_attempt_receipts(
      tenant_id,id,request_id,work_item_id,attempt_number,operation,fencing_token,outcome_code,result_fingerprint
    ) values(v_item.tenant_id,app.data_governance_new_uuid_v7(),v_request.id,v_item.id,v_item.attempt_count,'apply',v_item.fencing_token,'permanent_failure',app.sha256_tuple(v_request.id::text,v_item.id::text,'apply',v_item.fencing_token::text,'typed_locator_required'));
    update public.data_governance_requests set state='operator_required',updated_at=now()
    where tenant_id=v_request.tenant_id and id=v_request.id;
    return jsonb_build_object(
      'tenantId',v_item.tenant_id,'workItemId',v_item.id,
      'state','operator_required','outcomeCode','permanent_failure'
    );
  end if;

  if v_item.current_operation='verify' then
    if v_item.action='redact' then
      if v_catalog.relation_name='public.conversation_transcripts'
         and v_catalog.locator_strategy='uuid_id' then
        execute format(
          'select not exists(select 1 from %s where tenant_id=$1 and id=$2 and (turns<>''[]''::jsonb or external_ref<>$3))',
          v_catalog.relation_name
        ) into v_absent using v_item.tenant_id,v_item.database_row_id,'redacted-'||replace(v_item.id::text,'-','');
      else
        raise exception 'typed redaction verifier is not registered for resource' using errcode='0A000';
      end if;
      v_target_state:='verified';
      v_outcome:='verified_content_free';
    else
      if v_catalog.locator_strategy='uuid_id' then
        execute format('select not exists(select 1 from %s where tenant_id=$1 and id=$2)',v_catalog.relation_name)
          into v_absent using v_item.tenant_id,v_item.database_row_id;
      else
        execute format('select not exists(select 1 from %s where tenant_id=$1)',v_catalog.relation_name)
          into v_absent using v_item.tenant_id;
      end if;
      v_target_state:=case when v_item.action='retain_content_free' then 'retained_exception' else 'verified' end;
      v_outcome:=case when v_item.action='retain_content_free' then 'verified_content_free' else 'verified_absent' end;
    end if;
    if not coalesce(v_absent,false) then
      raise exception 'independent database verification failed' using errcode='55000';
    end if;
    v_verification_digest:=app.sha256_tuple(
      v_request.id::text,v_item.id::text,'verify',v_item.fencing_token::text,
      v_catalog.verification_method,v_outcome
    );
    update public.data_governance_work_items
    set state=v_target_state,outcome_code=v_outcome,resource_locator_hmac=null,
        verification_locator_hmac=resource_locator_hmac,
        verification_database_row_id=database_row_id,
        database_row_id=null,current_operation=null,lease_owner=null,lease_token=null,
        lease_expires_at=null,operation_identity=null,dispatch_fenced_at=null,
        verification_challenge_hmac=null,verification_digest=v_verification_digest,
        next_attempt_at=null,updated_at=now()
    where tenant_id=v_item.tenant_id and id=v_item.id;
    insert into public.data_governance_attempt_receipts(
      tenant_id,id,request_id,work_item_id,attempt_number,operation,fencing_token,
      outcome_code,result_fingerprint
    ) values(
      v_item.tenant_id,app.data_governance_new_uuid_v7(),v_request.id,v_item.id,v_item.attempt_count,
      'verify',v_item.fencing_token,v_outcome,v_verification_digest
    );
    update public.data_governance_requests set state='verifying',updated_at=now()
    where tenant_id=v_request.tenant_id and id=v_request.id;
    return jsonb_build_object(
      'tenantId',v_item.tenant_id,'workItemId',v_item.id,
      'state',v_target_state,'outcomeCode',v_outcome
    );
  end if;

  if v_item.action not in ('irreversible_delete','retain_content_free','redact')
     or (v_item.action='redact' and v_catalog.relation_name<>'public.conversation_transcripts') then
    update public.data_governance_work_items
    set state='operator_required',outcome_code='permanent_failure',current_operation=null,
        lease_owner=null,lease_token=null,lease_expires_at=null,operation_identity=null,
        dispatch_fenced_at=null,verification_challenge_hmac=null,updated_at=now()
    where tenant_id=v_item.tenant_id and id=v_item.id;
    insert into public.data_governance_attempt_receipts(
      tenant_id,id,request_id,work_item_id,attempt_number,operation,fencing_token,outcome_code,result_fingerprint
    ) values(v_item.tenant_id,app.data_governance_new_uuid_v7(),v_request.id,v_item.id,v_item.attempt_count,'apply',v_item.fencing_token,'permanent_failure',app.sha256_tuple(v_request.id::text,v_item.id::text,'apply',v_item.fencing_token::text,'typed_action_required'));
    update public.data_governance_requests set state='operator_required',updated_at=now()
    where tenant_id=v_request.tenant_id and id=v_request.id;
    return jsonb_build_object(
      'tenantId',v_item.tenant_id,'workItemId',v_item.id,
      'state','operator_required','outcomeCode','permanent_failure'
    );
  end if;

  update public.data_governance_work_items set state='applying',updated_at=now()
  where tenant_id=v_item.tenant_id and id=v_item.id;
  begin
    if v_catalog.relation_name='public.session_participants'
       and v_item.action='irreversible_delete' then
      update public.sessions
      set active_presenter_id=null
      where tenant_id=v_item.tenant_id and active_presenter_id=v_item.database_row_id;
    end if;
    if v_item.action='redact' then
      if v_catalog.relation_name='public.conversation_transcripts'
         and v_catalog.locator_strategy='uuid_id' then
        execute format(
          'update %s set external_ref=$3,turns=''[]''::jsonb,ended_at=coalesce(ended_at,now()),updated_at=now() where tenant_id=$1 and id=$2',
          v_catalog.relation_name
        ) using v_item.tenant_id,v_item.database_row_id,'redacted-'||replace(v_item.id::text,'-','');
      else
        raise exception 'typed redaction projector is not registered for resource' using errcode='0A000';
      end if;
    elsif v_catalog.locator_strategy='uuid_id' then
      execute format('delete from %s where tenant_id=$1 and id=$2',v_catalog.relation_name)
        using v_item.tenant_id,v_item.database_row_id;
    else
      execute format('delete from %s where tenant_id=$1',v_catalog.relation_name)
        using v_item.tenant_id;
    end if;
    get diagnostics v_rows=row_count;
    v_outcome:='applied';
    update public.data_governance_work_items
    set state='verification_pending',outcome_code=v_outcome,current_operation=null,
        lease_owner=null,lease_token=null,lease_expires_at=null,operation_identity=null,
        dispatch_fenced_at=null,verification_challenge_hmac=null,resume_operation=null,
        next_attempt_at=null,updated_at=now()
    where tenant_id=v_item.tenant_id and id=v_item.id;
    insert into public.data_governance_attempt_receipts(
      tenant_id,id,request_id,work_item_id,attempt_number,operation,fencing_token,outcome_code,result_fingerprint
    ) values(v_item.tenant_id,app.data_governance_new_uuid_v7(),v_request.id,v_item.id,v_item.attempt_count,'apply',v_item.fencing_token,v_outcome,
      app.sha256_tuple(v_request.id::text,v_item.id::text,'apply',v_item.fencing_token::text,v_outcome,v_rows::text,v_item.action));
  exception when foreign_key_violation or lock_not_available then
    update public.data_governance_work_items
    set state=case when attempt_count>=max_attempts then 'operator_required' else 'retry_wait' end,
        outcome_code=case when attempt_count>=max_attempts then 'permanent_failure' else 'retryable_failure' end,
        next_attempt_at=case when attempt_count>=max_attempts then null else now()+make_interval(secs=>least(300,attempt_count*attempt_count*5)) end,
        resume_operation=case when attempt_count>=max_attempts then null else 'apply' end,
        current_operation=null,lease_owner=null,lease_token=null,lease_expires_at=null,
        operation_identity=null,dispatch_fenced_at=null,verification_challenge_hmac=null,updated_at=now()
    where tenant_id=v_item.tenant_id and id=v_item.id;
    insert into public.data_governance_attempt_receipts(
      tenant_id,id,request_id,work_item_id,attempt_number,operation,fencing_token,outcome_code,result_fingerprint
    ) values(v_item.tenant_id,app.data_governance_new_uuid_v7(),v_request.id,v_item.id,v_item.attempt_count,'apply',v_item.fencing_token,'retryable_failure',
      app.sha256_tuple(v_request.id::text,v_item.id::text,'apply',v_item.fencing_token::text,'retryable_database_conflict'));
    update public.data_governance_requests set state='retry_wait',updated_at=now()
    where tenant_id=v_request.tenant_id and id=v_request.id;
    return jsonb_build_object(
      'tenantId',v_item.tenant_id,'workItemId',v_item.id,
      'state',case when v_item.attempt_count>=v_item.max_attempts then 'operator_required' else 'retry_wait' end,
      'outcomeCode',case when v_item.attempt_count>=v_item.max_attempts then 'permanent_failure' else 'retryable_failure' end
    );
  end;
  update public.data_governance_requests set state='verifying',updated_at=now()
  where tenant_id=v_request.tenant_id and id=v_request.id;
  return jsonb_build_object(
    'tenantId',v_item.tenant_id,'workItemId',v_item.id,
    'state','verification_pending','outcomeCode',v_outcome
  );
end;
$$;

create or replace function public.portal_record_data_governance_item_outcome_service(
  p_tenant_id app.uuid_v7,
  p_request_id app.uuid_v7,
  p_item_id app.uuid_v7,
  p_lease_token app.uuid_v7,
  p_receipt_id app.uuid_v7,
  p_operation text,
  p_fencing_token bigint,
  p_outcome_code text,
  p_evidence_kind text,
  p_evidence_fingerprint text,
  p_verifier_authority_id app.uuid_v7,
  p_verifier_attestation_hmac text,
  p_recoverable_until timestamptz
) returns jsonb language plpgsql security definer set search_path=''
set lock_timeout='2s' set statement_timeout='15s' as $$
declare
  v_tenant_id app.uuid_v7;
  v_request public.data_governance_requests;
  v_item public.data_governance_work_items;
  v_existing_receipt public.data_governance_attempt_receipts;
  v_catalog public.data_governance_resource_catalog;
  v_state text;
  v_next timestamptz;
  v_expected_evidence_kind text;
  v_expected_evidence_fingerprint text;
  v_evidence_attestation_hmac text;
  v_result_fingerprint text;
  v_verifier_payload text;
  v_verifier_key_fingerprint text;
begin
  select r.tenant_id into v_tenant_id
  from public.data_governance_requests r
  where r.tenant_id=p_tenant_id and r.id=p_request_id;
  if not found then raise exception 'request is not accepting outcomes' using errcode='55000'; end if;
  perform pg_advisory_xact_lock(app.data_governance_tenant_lock_key(v_tenant_id));
  select * into v_request from public.data_governance_requests
  where tenant_id=v_tenant_id and id=p_request_id for update;
  select * into v_existing_receipt
  from public.data_governance_attempt_receipts
  where tenant_id=v_tenant_id and work_item_id=p_item_id
    and operation=p_operation and fencing_token=p_fencing_token
    and evidence_kind is not null;
  if found then
    if v_existing_receipt.id<>p_receipt_id
       or v_existing_receipt.request_id<>p_request_id
       or v_existing_receipt.external_lease_token is distinct from p_lease_token
       or v_existing_receipt.outcome_code<>p_outcome_code
       or v_existing_receipt.evidence_kind is distinct from p_evidence_kind
       or v_existing_receipt.evidence_fingerprint is distinct from p_evidence_fingerprint
       or v_existing_receipt.verifier_authority_id is distinct from p_verifier_authority_id
       or v_existing_receipt.verifier_attestation_hmac is distinct from p_verifier_attestation_hmac
       or v_existing_receipt.recoverable_until is distinct from p_recoverable_until
       or v_existing_receipt.result_fingerprint<>app.data_governance_external_attempt_fingerprint(
         v_existing_receipt.tenant_id,v_existing_receipt.id,v_existing_receipt.request_id,
         v_existing_receipt.work_item_id,v_existing_receipt.attempt_number,
         v_existing_receipt.external_lease_token,v_existing_receipt.operation,
         v_existing_receipt.fencing_token,v_existing_receipt.outcome_code,
         v_existing_receipt.resulting_state,v_existing_receipt.external_operation_identity,
         v_existing_receipt.external_verification_challenge_hmac,
         v_existing_receipt.evidence_kind,v_existing_receipt.evidence_fingerprint,
         v_existing_receipt.evidence_attestation_hmac,
         v_existing_receipt.verifier_authority_id,
         v_existing_receipt.verification_authority_fingerprint,
         v_existing_receipt.verifier_attestation_hmac,v_existing_receipt.recoverable_until
       ) then
      raise exception 'external outcome idempotency conflict' using errcode='23505';
    end if;
    return jsonb_build_object(
      'tenantId',v_existing_receipt.tenant_id,
      'workItemId',p_item_id,'state',v_existing_receipt.resulting_state,
      'outcomeCode',v_existing_receipt.outcome_code,'receiptId',v_existing_receipt.id,
      'replayed',true
    );
  end if;
  if v_request.state not in (
    'executing_redaction','executing_irreversible_deletion','retry_wait','effect_unknown','verifying'
  ) then raise exception 'request is not accepting outcomes' using errcode='55000'; end if;
  select * into v_item from public.data_governance_work_items
  where tenant_id=v_request.tenant_id and id=p_item_id and request_id=v_request.id for update;
  if not found or v_item.state<>'applying'
     or v_item.lease_token is distinct from p_lease_token or v_item.lease_expires_at<=now()
     or v_item.fencing_token<>p_fencing_token or v_item.current_operation<>p_operation then
    raise exception 'valid work item lease required' using errcode='55000';
  end if;
  select * into v_catalog from public.data_governance_resource_catalog where resource_code=v_item.resource_code;
  if v_catalog.surface='database' then
    raise exception 'database outcomes require the database apply RPC' using errcode='42501';
  end if;
  v_expected_evidence_kind:=case
    when p_outcome_code in ('verified_absent','verified_content_free') then case v_catalog.surface
      when 'object_storage' then 'object_absence'
      when 'cache' then 'cache_absence'
      when 'embedding_index' then 'index_absence'
      when 'provider_copy' then 'provider_absence'
      when 'auth_identity' then 'auth_absence'
      when 'vault_secret' then 'vault_absence'
      when 'backup' then 'backup_window_elapsed'
    end
    when p_outcome_code='applied' then 'effect_receipt'
    when p_outcome_code='effect_unknown' then 'transport_unknown'
    when p_outcome_code='retryable_failure' then 'transport_failure'
    when p_outcome_code='permanent_failure' then 'provider_denied'
    when p_outcome_code='backup_recoverable' then 'recovery_window'
  end;
  if v_expected_evidence_kind is null or p_evidence_kind<>v_expected_evidence_kind
     or p_evidence_fingerprint is null or p_evidence_fingerprint!~'^[0-9a-f]{64}$'
     or v_item.operation_identity is null or v_item.verification_challenge_hmac is null then
    raise exception 'typed external attestation required' using errcode='22023';
  end if;
  v_expected_evidence_fingerprint:=app.data_governance_external_evidence_fingerprint(
    v_item.tenant_id,v_request.id,v_item.id,v_item.attempt_count,p_receipt_id,
    p_operation,p_fencing_token,p_outcome_code,p_evidence_kind,
    v_item.operation_identity,v_item.verification_challenge_hmac,p_recoverable_until
  );
  if p_evidence_fingerprint<>v_expected_evidence_fingerprint then
    raise exception 'external evidence fingerprint is not the closed content-free projection' using errcode='22023';
  end if;
  if p_outcome_code in ('verified_absent','verified_content_free') then
    v_verifier_payload:=app.sha256_tuple(
      'external-verifier@1',v_item.tenant_id::text,v_request.id::text,v_item.id::text,
      v_item.resource_code,p_operation,p_fencing_token::text,v_item.operation_identity,
      v_item.verification_challenge_hmac,p_evidence_kind,p_evidence_fingerprint,
      coalesce(p_recoverable_until::text,'')
    );
    if not app.data_governance_verify_authority_hmac(
      'external_verifier',v_item.resource_code,p_verifier_authority_id,
      v_verifier_payload,p_verifier_attestation_hmac
    ) then
      raise exception 'independent external verifier attestation required' using errcode='42501';
    end if;
    select key_fingerprint into v_verifier_key_fingerprint
    from app.data_governance_attestation_authorities
    where authority_kind='external_verifier' and resource_code=v_item.resource_code
      and authority_id=p_verifier_authority_id and active;
  elsif p_verifier_authority_id is not null or p_verifier_attestation_hmac is not null then
    raise exception 'verifier authority is only valid for terminal verification' using errcode='22023';
  end if;
  v_evidence_attestation_hmac:=app.data_governance_hmac(
    'external-evidence',v_item.tenant_id::text,coalesce(v_item.subject_id::text,''),
    v_item.operation_identity,
    p_evidence_kind||'|'||p_evidence_fingerprint||'|'||v_item.verification_challenge_hmac
  );
  if app.data_governance_has_active_hold(v_item.tenant_id,v_item.resource_code,v_item.subject_id,coalesce(v_item.resource_locator_hmac,v_item.verification_locator_hmac)) then
    raise exception 'active legal hold blocks external operation' using errcode='55000';
  elsif p_outcome_code in ('verified_absent','verified_content_free') then
    if p_operation<>'verify' then raise exception 'only verify may assert absence' using errcode='42501'; end if;
    if (v_item.action='redact' and p_outcome_code<>'verified_content_free')
       or (v_item.action<>'redact' and p_outcome_code='verified_content_free') then
      raise exception 'verification outcome does not match disposition action' using errcode='22023';
    end if;
    if v_catalog.surface='backup' and (p_recoverable_until is null or p_recoverable_until>now()) then
      raise exception 'backup remains recoverable' using errcode='55000';
    end if;
    v_state:='verified';
  elsif p_outcome_code='applied' then
    if p_operation not in ('apply','reconcile') then raise exception 'verify cannot apply an effect' using errcode='42501'; end if;
    v_state:='verification_pending';
  elsif p_outcome_code='backup_recoverable' and v_catalog.surface='backup' then
    if p_recoverable_until is null or p_recoverable_until<=now() or p_recoverable_until>now()+interval '10 years' then
      raise exception 'bounded future backup recovery window required' using errcode='22023';
    end if;
    if v_item.attempt_count>=v_item.max_attempts then
      v_state:='operator_required';
    else
      v_state:='retry_wait'; v_next:=p_recoverable_until;
    end if;
  elsif p_outcome_code='effect_unknown' then
    v_state:=case when v_item.attempt_count>=v_item.max_attempts then 'operator_required' else 'effect_unknown' end;
  elsif p_outcome_code='retryable_failure' then
    v_state:=case when v_item.attempt_count>=v_item.max_attempts then 'operator_required' else 'retry_wait' end;
    v_next:=now()+make_interval(secs=>least(300,v_item.attempt_count*v_item.attempt_count*5));
  elsif p_outcome_code='permanent_failure' then
    v_state:='operator_required';
  else
    raise exception 'unsupported external outcome' using errcode='22023';
  end if;
  v_result_fingerprint:=app.data_governance_external_attempt_fingerprint(
    v_item.tenant_id,p_receipt_id,v_request.id,v_item.id,v_item.attempt_count,
    p_lease_token,p_operation,p_fencing_token,p_outcome_code,v_state,
    v_item.operation_identity,v_item.verification_challenge_hmac,p_evidence_kind,
    p_evidence_fingerprint,v_evidence_attestation_hmac,p_verifier_authority_id,
    v_verifier_key_fingerprint,p_verifier_attestation_hmac,p_recoverable_until
  );
  insert into public.data_governance_attempt_receipts(
    tenant_id,id,request_id,work_item_id,attempt_number,operation,fencing_token,
    outcome_code,evidence_kind,external_lease_token,resulting_state,
    external_operation_identity,external_verification_challenge_hmac,
    evidence_fingerprint,evidence_attestation_hmac,verifier_authority_id,
    verifier_attestation_hmac,verification_authority_fingerprint,
    result_fingerprint,recoverable_until
  ) values(
    v_item.tenant_id,p_receipt_id,v_request.id,v_item.id,v_item.attempt_count,
    p_operation,p_fencing_token,p_outcome_code,p_evidence_kind,p_lease_token,v_state,
    v_item.operation_identity,v_item.verification_challenge_hmac,p_evidence_fingerprint,
    v_evidence_attestation_hmac,p_verifier_authority_id,p_verifier_attestation_hmac,
    v_verifier_key_fingerprint,v_result_fingerprint,p_recoverable_until
  );
  update public.data_governance_work_items
  set state=v_state,outcome_code=p_outcome_code,recoverable_until=p_recoverable_until,
      verification_locator_hmac=case when v_state='verified' then resource_locator_hmac else null end,
      verification_database_row_id=case when v_state='verified' then database_row_id else null end,
      resource_locator_hmac=case when v_state='verified' then null else resource_locator_hmac end,
      database_row_id=case when v_state='verified' then null else database_row_id end,
      next_attempt_at=case when v_state='retry_wait' then v_next else null end,
      resume_operation=case
        when v_state='retry_wait' and p_outcome_code='backup_recoverable' then 'verify'
        when v_state='retry_wait' then p_operation
        else null
      end,
      verification_digest=case when v_state='verified' then v_result_fingerprint else null end,
      current_operation=null,operation_identity=null,dispatch_fenced_at=null,
      verification_challenge_hmac=null,lease_owner=null,lease_token=null,lease_expires_at=null,
      updated_at=now()
  where tenant_id=v_item.tenant_id and id=v_item.id;
  if v_state='effect_unknown' then
    update public.data_governance_requests set state='effect_unknown',updated_at=now()
    where tenant_id=v_request.tenant_id and id=v_request.id;
  elsif v_state='operator_required' then
    update public.data_governance_requests set state='operator_required',updated_at=now()
    where tenant_id=v_request.tenant_id and id=v_request.id;
  elsif v_state='retry_wait' then
    update public.data_governance_requests set state='retry_wait',updated_at=now()
    where tenant_id=v_request.tenant_id and id=v_request.id;
  elsif v_state in ('verification_pending','verified') then
    update public.data_governance_requests set state='verifying',updated_at=now()
    where tenant_id=v_request.tenant_id and id=v_request.id;
  end if;
  return jsonb_build_object(
    'tenantId',v_item.tenant_id,'workItemId',v_item.id,
    'state',v_state,'outcomeCode',p_outcome_code,
    'receiptId',p_receipt_id,'replayed',false
  );
end;
$$;

create or replace function app.data_governance_database_absent(
  p_tenant_id app.uuid_v7,
  p_request_id app.uuid_v7
) returns boolean language plpgsql stable security definer set search_path='' as $$
declare v_request public.data_governance_requests; r record; v_count bigint; v_exists boolean; v_projected boolean;
begin
  select * into v_request from public.data_governance_requests
  where tenant_id=p_tenant_id and id=p_request_id;
  if not found then return false; end if;
  if v_request.scope='tenant' then
    for r in
      select relation_name
      from public.data_governance_resource_catalog
      where catalog_generation='pre_v59' and surface='database'
        and relation_name<>'public.tenants' and retained_exception=false
    loop
      execute format('select count(*) from %s where tenant_id=$1',r.relation_name) into v_count using p_tenant_id;
      if v_count<>0 then return false; end if;
    end loop;
    return true;
  end if;
  for r in
    select l.resource_code,l.database_row_id,c.relation_name,i.action,i.id work_item_id
    from public.data_governance_subject_artifact_links l
    join public.data_governance_resource_catalog c on c.resource_code=l.resource_code
    join public.data_governance_work_items i
      on i.tenant_id=l.tenant_id and i.request_id=p_request_id
      and i.resource_code=l.resource_code
      and i.verification_locator_hmac=l.resource_locator_hmac
    where l.tenant_id=p_tenant_id and l.subject_id=v_request.subject_id and c.locator_strategy='uuid_id'
  loop
    if r.action='redact' and r.relation_name='public.conversation_transcripts' then
      execute format(
        'select not exists(select 1 from %s where tenant_id=$1 and id=$2 and (turns<>''[]''::jsonb or external_ref<>$3))',
        r.relation_name
      ) into v_projected using p_tenant_id,r.database_row_id,'redacted-'||replace(r.work_item_id::text,'-','');
      if not coalesce(v_projected,false) then return false; end if;
    else
      execute format('select exists(select 1 from %s where tenant_id=$1 and id=$2)',r.relation_name)
        into v_exists using p_tenant_id,r.database_row_id;
      if v_exists then return false; end if;
    end if;
  end loop;
  return not exists(
    select 1
    from (
      select resource_code,count(*) link_count
      from public.data_governance_subject_artifact_links
      where tenant_id=p_tenant_id and subject_id=v_request.subject_id
      group by resource_code
    ) l
    left join (
      select resource_code,count(*) item_count
      from public.data_governance_work_items
      where tenant_id=p_tenant_id and request_id=p_request_id and state in ('verified','retained_exception')
      group by resource_code
    ) i using(resource_code)
    where l.link_count<>coalesce(i.item_count,0)
  );
end;
$$;

create or replace function app.data_governance_controls_projected(
  p_tenant_id app.uuid_v7,
  p_request_id app.uuid_v7,
  p_scope text,
  p_subject_id app.uuid_v7
) returns boolean language sql stable security definer set search_path='' as $$
  select
    exists(
      select 1 from public.data_governance_requests r
      where r.tenant_id=p_tenant_id and r.id=p_request_id and r.scope=p_scope
        and r.state='completed' and r.requested_by_user_id is null
        and r.requested_by_actor_id is null and r.subject_id is null
    )
    and exists(
      select 1 from public.data_governance_final_receipts f
      where f.tenant_id=p_tenant_id and f.request_id=p_request_id
        and f.scope=p_scope and f.terminal_state='completed'
    )
    and not exists(
      select 1 from public.data_governance_approvals a
      where a.tenant_id=p_tenant_id and a.request_id=p_request_id
        and (a.actor_user_id is not null or a.actor_id is not null)
    )
    and not exists(
      select 1 from public.data_governance_work_items i
      where i.tenant_id=p_tenant_id and i.request_id=p_request_id
        and (
          i.state not in ('verified','retained_exception')
          or i.subject_id is not null or i.resource_locator_hmac is not null
          or i.database_row_id is not null or i.current_operation is not null
          or i.verification_locator_hmac is not null
          or i.verification_database_row_id is not null
          or i.operation_identity is not null or i.dispatch_fenced_at is not null
          or i.verification_challenge_hmac is not null or i.lease_owner is not null
          or i.lease_token is not null or i.lease_expires_at is not null
          or i.next_attempt_at is not null or i.verification_digest is null
        )
    )
    and not exists(
      select 1 from public.data_legal_hold_receipts h
      where h.tenant_id=p_tenant_id and h.authority_actor_id is not null
    )
    and case when p_scope='tenant' then
      not exists(select 1 from public.data_governance_subjects s where s.tenant_id=p_tenant_id)
      and not exists(select 1 from public.data_governance_subject_artifact_links l where l.tenant_id=p_tenant_id)
      and not exists(select 1 from public.data_governance_subject_coverage_attestations a where a.tenant_id=p_tenant_id)
      and not exists(select 1 from public.data_legal_hold_scope_items l where l.tenant_id=p_tenant_id)
      and not exists(
        select 1 from public.data_legal_holds h
        where h.tenant_id=p_tenant_id
          and (
            h.state='active' or h.created_by_user_id is not null
            or h.created_by_actor_id is not null or h.authorization_id is not null
          )
      )
    else
      p_subject_id is not null
      and not exists(
        select 1 from public.data_governance_subjects s
        where s.tenant_id=p_tenant_id and s.id=p_subject_id
      )
      and not exists(
        select 1 from public.data_governance_subject_artifact_links l
        where l.tenant_id=p_tenant_id and l.subject_id=p_subject_id
      )
      and not exists(
        select 1 from public.data_governance_subject_coverage_attestations a
        where a.tenant_id=p_tenant_id and a.subject_id=p_subject_id
      )
    end
$$;

create or replace function public.portal_complete_data_governance_request_service(
  p_tenant_id app.uuid_v7,
  p_request_id app.uuid_v7,
  p_receipt_id app.uuid_v7
) returns jsonb language plpgsql security definer set search_path=''
set lock_timeout='2s' set statement_timeout='30s' as $$
declare
  v_tenant_id app.uuid_v7;
  v_request public.data_governance_requests;
  v_existing_receipt public.data_governance_final_receipts;
  v_verified integer;
  v_retained integer;
  v_held integer;
  v_root_item app.uuid_v7;
begin
  select r.tenant_id into v_tenant_id
  from public.data_governance_requests r
  where r.tenant_id=p_tenant_id and r.id=p_request_id;
  if not found then raise exception 'request is not completable' using errcode='55000'; end if;
  perform pg_advisory_xact_lock(app.data_governance_tenant_lock_key(v_tenant_id));
  select * into v_request from public.data_governance_requests
  where tenant_id=v_tenant_id and id=p_request_id for update;
  select * into v_existing_receipt
  from public.data_governance_final_receipts
  where tenant_id=v_tenant_id and request_id=p_request_id;
  if found then
    select count(*) filter(where state='verified'),
           count(*) filter(where state='retained_exception'),
           count(*) filter(where state='held')
    into v_verified,v_retained,v_held
    from public.data_governance_work_items
    where tenant_id=v_tenant_id and request_id=p_request_id;
    if v_request.state<>'completed'
       or v_existing_receipt.terminal_state<>'completed'
       or v_existing_receipt.scope<>v_request.scope
       or v_existing_receipt.policy_version<>v_request.policy_version
       or v_existing_receipt.policy_fingerprint<>v_request.policy_fingerprint
       or v_existing_receipt.inventory_version<>v_request.inventory_version
       or v_existing_receipt.inventory_fingerprint<>v_request.inventory_fingerprint
       or v_existing_receipt.verified_item_count<>v_verified
       or v_existing_receipt.retained_exception_count<>v_retained
       or v_existing_receipt.held_item_count<>v_held
       or v_existing_receipt.result_code<>'verified_complete'
       or v_existing_receipt.completed_at is distinct from v_request.completed_at
       or v_existing_receipt.receipt_fingerprint!~'^[0-9a-f]{64}$' then
      raise exception 'completion receipt integrity conflict' using errcode='55000';
    end if;
    return jsonb_build_object(
      'tenantId',v_tenant_id,'requestId',p_request_id,'state','completed','receiptId',v_existing_receipt.id,
      'replayed',true
    );
  end if;
  if v_request.state not in (
    'ready','executing_redaction','executing_irreversible_deletion','verifying'
  ) then raise exception 'request is not completable' using errcode='55000'; end if;
  update public.data_governance_requests set state='verifying',updated_at=now()
  where tenant_id=v_request.tenant_id and id=v_request.id;
  if not app.data_governance_catalog_complete()
     or v_request.inventory_fingerprint<>app.data_governance_catalog_fingerprint()
     or v_request.inventory_completed_at is null
     or v_request.inventory_item_count is distinct from (
       select count(*) from public.data_governance_work_items i
       where i.tenant_id=v_request.tenant_id and i.request_id=v_request.id
     )
     or v_request.inventory_resource_count is distinct from (
       select coalesce(sum(i.resource_count),0) from public.data_governance_work_items i
       where i.tenant_id=v_request.tenant_id and i.request_id=v_request.id
     ) then
    raise exception 'independent inventory verification failed' using errcode='55000';
  end if;
  if exists(
    select 1 from public.data_governance_work_items i
    where i.tenant_id=v_request.tenant_id and i.request_id=v_request.id
      and i.state not in ('verified','retained_exception','verification_pending')
  ) or exists(
    select 1 from public.data_governance_work_items i
    join public.data_governance_resource_catalog c on c.resource_code=i.resource_code
    where i.tenant_id=v_request.tenant_id and i.request_id=v_request.id
      and i.state='verification_pending' and c.relation_name<>'public.tenants'
  ) then raise exception 'work items are not independently verified' using errcode='55000'; end if;
  if exists(
    select 1 from public.data_governance_work_items i
    where i.tenant_id=v_request.tenant_id and i.request_id=v_request.id
      and app.data_governance_has_active_hold(i.tenant_id,i.resource_code,i.subject_id,coalesce(i.resource_locator_hmac,i.verification_locator_hmac))
  ) then raise exception 'active legal hold blocks completion' using errcode='55000'; end if;
  if v_request.scope='tenant' and exists(
    select 1 from public.data_legal_holds h
    where h.tenant_id=v_request.tenant_id and h.state='active'
  ) then raise exception 'tenant completion requires explicit disposition of every legal hold' using errcode='55000'; end if;
  if not app.data_governance_database_absent(v_request.tenant_id,v_request.id) then
    raise exception 'database verification found surviving governed content' using errcode='55000';
  end if;
  if v_request.scope='tenant' then
    perform 1 from public.tenants
    where id=v_request.tenant_id and data_governance_state='fenced' and data_write_epoch=v_request.write_epoch
    for update;
    if not found then raise exception 'exact tenant fence required' using errcode='55000'; end if;
    select id into v_root_item from public.data_governance_work_items
    where tenant_id=v_request.tenant_id and request_id=v_request.id and resource_code='db_tenants'
      and state='verification_pending' for update;
    if v_root_item is null then raise exception 'tenant tombstone work item missing' using errcode='55000'; end if;
    update public.tenants
    set slug='deleted-'||replace(v_request.id::text,'-',''),legal_name='Deleted tenant',
        home_region='deleted',default_language='und',default_timezone='UTC',status='deleted',
        data_governance_state='tombstoned',tombstoned_at=now(),tombstone_request_id=v_request.id,updated_at=now()
    where id=v_request.tenant_id;
    update public.data_governance_work_items
    set state='verified',outcome_code='verified_content_free',
        verification_locator_hmac=resource_locator_hmac,
        verification_database_row_id=database_row_id,
        resource_locator_hmac=null,database_row_id=null,
        attempt_count=attempt_count+1,next_attempt_at=null,
        verification_digest=app.sha256_tuple(
          request_id::text,id::text,'verify',greatest(fencing_token,1)::text,'tenant_tombstoned'
        ),updated_at=now()
    where tenant_id=v_request.tenant_id and id=v_root_item;
    insert into public.data_governance_attempt_receipts(
      tenant_id,id,request_id,work_item_id,attempt_number,operation,fencing_token,outcome_code,result_fingerprint
    ) select
      i.tenant_id,p_receipt_id,i.request_id,i.id,i.attempt_count,'verify',greatest(i.fencing_token,1),
      'verified_content_free',app.sha256_tuple(i.request_id::text,i.id::text,'verify',greatest(i.fencing_token,1)::text,'tenant_tombstoned')
    from public.data_governance_work_items i where i.tenant_id=v_request.tenant_id and i.id=v_root_item;
  else
    delete from public.data_governance_subject_coverage_attestations
    where tenant_id=v_request.tenant_id and subject_id=v_request.subject_id;
    delete from public.data_governance_subject_artifact_links
    where tenant_id=v_request.tenant_id and subject_id=v_request.subject_id;
    update public.data_governance_work_items set subject_id=null
    where tenant_id=v_request.tenant_id and subject_id=v_request.subject_id
      and state in ('verified','retained_exception');
  end if;
  if v_request.scope='tenant' then
    if exists(
      select 1 from public.data_governance_work_items i
      where i.tenant_id=v_request.tenant_id
        and (i.state not in ('verified','retained_exception') or i.resource_locator_hmac is not null or i.database_row_id is not null)
    ) then raise exception 'v59 operational locators are not terminally projected' using errcode='55000'; end if;
    update public.data_governance_requests
    set requested_by_user_id=null,requested_by_actor_id=null,subject_id=null
    where tenant_id=v_request.tenant_id and id<>v_request.id
      and state in ('completed','denied','expired','cancelled');
    update public.data_governance_approvals set actor_user_id=null,actor_id=null
    where tenant_id=v_request.tenant_id;
    update public.data_legal_holds
    set created_by_user_id=null,created_by_actor_id=null,authorization_id=null
    where tenant_id=v_request.tenant_id and state in ('released','expired');
    update public.data_governance_work_items set subject_id=null
    where tenant_id=v_request.tenant_id and state in ('verified','retained_exception');
    delete from public.data_governance_subject_coverage_attestations where tenant_id=v_request.tenant_id;
    delete from public.data_governance_subject_artifact_links where tenant_id=v_request.tenant_id;
    delete from public.data_governance_subjects where tenant_id=v_request.tenant_id;
  end if;
  update public.data_governance_work_items
  set verification_locator_hmac=null,verification_database_row_id=null
  where tenant_id=v_request.tenant_id and request_id=v_request.id
    and state in ('verified','retained_exception');
  select count(*) filter(where state='verified'),count(*) filter(where state='retained_exception'),count(*) filter(where state='held')
  into v_verified,v_retained,v_held
  from public.data_governance_work_items where tenant_id=v_request.tenant_id and request_id=v_request.id;
  insert into public.data_governance_final_receipts(
    tenant_id,id,request_id,scope,terminal_state,policy_version,policy_fingerprint,
    inventory_version,inventory_fingerprint,verified_item_count,retained_exception_count,
    held_item_count,result_code
  ) values(
    v_request.tenant_id,p_receipt_id,v_request.id,v_request.scope,'completed',v_request.policy_version,
    v_request.policy_fingerprint,v_request.inventory_version,v_request.inventory_fingerprint,
    v_verified,v_retained,v_held,'verified_complete'
  );
  update public.data_governance_requests
  set state='completed',completed_at=now(),updated_at=now(),requested_by_user_id=null,
      requested_by_actor_id=null,subject_id=null
  where tenant_id=v_request.tenant_id and id=v_request.id;
  update public.data_governance_approvals set actor_user_id=null,actor_id=null
  where tenant_id=v_request.tenant_id and request_id=v_request.id;
  if v_request.scope='data_subject' then
    delete from public.data_governance_subjects
    where tenant_id=v_request.tenant_id and id=v_request.subject_id;
  end if;
  if not app.data_governance_controls_projected(
    v_request.tenant_id,v_request.id,v_request.scope,v_request.subject_id
  ) then
    raise exception 'v59 governance controls are not terminally projected' using errcode='55000';
  end if;
  return jsonb_build_object(
    'tenantId',v_request.tenant_id,'requestId',v_request.id,'state','completed',
    'receiptId',p_receipt_id,'replayed',false
  );
end;
$$;

create or replace function public.portal_data_governance_status_authenticated(
  p_request_id app.uuid_v7
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_member public.user_tenant_memberships; v_request public.data_governance_requests;
begin
  v_member:=app.data_governance_authenticated_admin();
  select * into v_request from public.data_governance_requests
  where tenant_id=v_member.tenant_id and id=p_request_id;
  if not found then raise exception 'request not found for tenant' using errcode='42501'; end if;
  return jsonb_build_object(
    'requestId',v_request.id,'scope',v_request.scope,'state',v_request.state,
    'requestedAction',v_request.requested_action,'policyVersion',v_request.policy_version,
    'inventoryVersion',v_request.inventory_version,'writeEpoch',v_request.write_epoch,
    'authorizedAt',v_request.authorized_at,'completedAt',v_request.completed_at
  );
end;
$$;

create or replace function public.portal_cancel_data_governance_request_authenticated(
  p_request_id app.uuid_v7,
  p_receipt_id app.uuid_v7
) returns jsonb language plpgsql security definer set search_path=''
set lock_timeout='2s' set statement_timeout='15s' as $$
declare
  v_member public.user_tenant_memberships;
  v_request public.data_governance_requests;
  v_existing_receipt public.data_governance_final_receipts;
begin
  v_member:=app.data_governance_authenticated_admin();
  perform pg_advisory_xact_lock(app.data_governance_tenant_lock_key(v_member.tenant_id));
  select * into v_request from public.data_governance_requests
  where tenant_id=v_member.tenant_id and id=p_request_id for update;
  if not found then
    raise exception 'request can no longer be cancelled' using errcode='55000';
  end if;
  select * into v_existing_receipt
  from public.data_governance_final_receipts
  where tenant_id=v_member.tenant_id and request_id=v_request.id;
  if found then
    if v_request.state<>'cancelled'
       or v_existing_receipt.terminal_state<>'cancelled'
       or v_existing_receipt.result_code<>'request_cancelled'
       or v_existing_receipt.scope<>v_request.scope
       or v_existing_receipt.policy_fingerprint<>v_request.policy_fingerprint
       or v_existing_receipt.inventory_fingerprint<>v_request.inventory_fingerprint then
      raise exception 'cancellation receipt integrity conflict' using errcode='55000';
    end if;
    return jsonb_build_object(
      'tenantId',v_member.tenant_id,'requestId',v_request.id,'state','cancelled',
      'receiptId',v_existing_receipt.id,'replayed',true
    );
  end if;
  if v_request.state not in ('requested','approval_pending','authorized','inventorying','ready','blocked_by_legal_hold')
     or v_request.irreversible_started_at is not null then
    raise exception 'request can no longer be cancelled' using errcode='55000';
  end if;
  delete from public.data_governance_work_items
  where tenant_id=v_member.tenant_id and request_id=v_request.id and attempt_count=0;
  insert into public.data_governance_final_receipts(
    tenant_id,id,request_id,scope,terminal_state,policy_version,policy_fingerprint,
    inventory_version,inventory_fingerprint,verified_item_count,retained_exception_count,
    held_item_count,result_code
  ) values(
    v_member.tenant_id,p_receipt_id,v_request.id,v_request.scope,'cancelled',v_request.policy_version,
    v_request.policy_fingerprint,v_request.inventory_version,v_request.inventory_fingerprint,0,0,0,'request_cancelled'
  );
  update public.data_governance_requests
  set state='cancelled',updated_at=now(),requested_by_user_id=null,requested_by_actor_id=null,subject_id=null,
      inventory_completed_at=null,inventory_item_count=null,inventory_resource_count=null
  where tenant_id=v_member.tenant_id and id=v_request.id;
  update public.data_governance_approvals set actor_user_id=null,actor_id=null
  where tenant_id=v_member.tenant_id and request_id=v_request.id;
  if v_request.subject_id is not null then
    update public.data_governance_subjects set state='active'
    where tenant_id=v_member.tenant_id and id=v_request.subject_id and state='disposition_requested';
  end if;
  return jsonb_build_object(
    'tenantId',v_member.tenant_id,'requestId',v_request.id,'state','cancelled',
    'receiptId',p_receipt_id,'replayed',false
  );
end;
$$;

create or replace function public.portal_expire_data_governance_request_service(
  p_tenant_id app.uuid_v7,
  p_request_id app.uuid_v7,
  p_receipt_id app.uuid_v7
) returns jsonb language plpgsql security definer set search_path=''
set lock_timeout='2s' set statement_timeout='15s' as $$
declare
  v_tenant_id app.uuid_v7;
  v_request public.data_governance_requests;
  v_existing_receipt public.data_governance_final_receipts;
begin
  select tenant_id into v_tenant_id
  from public.data_governance_requests
  where tenant_id=p_tenant_id and id=p_request_id;
  if not found then raise exception 'request is not due for expiry' using errcode='55000'; end if;
  perform pg_advisory_xact_lock(app.data_governance_tenant_lock_key(v_tenant_id));
  select * into v_request from public.data_governance_requests
  where tenant_id=v_tenant_id and id=p_request_id for update;
  select * into v_existing_receipt
  from public.data_governance_final_receipts
  where tenant_id=v_tenant_id and request_id=v_request.id;
  if found then
    if v_request.state<>'expired'
       or v_existing_receipt.terminal_state<>'expired'
       or v_existing_receipt.result_code<>'request_expired'
       or v_existing_receipt.scope<>v_request.scope
       or v_existing_receipt.policy_fingerprint<>v_request.policy_fingerprint
       or v_existing_receipt.inventory_fingerprint<>v_request.inventory_fingerprint then
      raise exception 'expiry receipt integrity conflict' using errcode='55000';
    end if;
    return jsonb_build_object(
      'tenantId',v_tenant_id,'requestId',v_request.id,'state','expired',
      'receiptId',v_existing_receipt.id,'replayed',true
    );
  end if;
  if v_request.expires_at>now()
     or v_request.state not in ('approval_pending','blocked_by_legal_hold')
     or v_request.irreversible_started_at is not null then
    raise exception 'request is not due for expiry' using errcode='55000';
  end if;
  delete from public.data_governance_work_items
  where tenant_id=v_request.tenant_id and request_id=v_request.id and attempt_count=0;
  insert into public.data_governance_final_receipts(
    tenant_id,id,request_id,scope,terminal_state,policy_version,policy_fingerprint,
    inventory_version,inventory_fingerprint,verified_item_count,retained_exception_count,
    held_item_count,result_code
  ) values(
    v_request.tenant_id,p_receipt_id,v_request.id,v_request.scope,'expired',v_request.policy_version,
    v_request.policy_fingerprint,v_request.inventory_version,v_request.inventory_fingerprint,0,0,0,'request_expired'
  );
  update public.data_governance_requests
  set state='expired',updated_at=now(),requested_by_user_id=null,requested_by_actor_id=null,subject_id=null,
      inventory_completed_at=null,inventory_item_count=null,inventory_resource_count=null
  where tenant_id=v_request.tenant_id and id=v_request.id;
  update public.data_governance_approvals set actor_user_id=null,actor_id=null
  where tenant_id=v_request.tenant_id and request_id=v_request.id;
  if v_request.subject_id is not null then
    update public.data_governance_subjects set state='active'
    where tenant_id=v_request.tenant_id and id=v_request.subject_id and state='disposition_requested';
  end if;
  return jsonb_build_object(
    'tenantId',v_request.tenant_id,'requestId',v_request.id,
    'state','expired','receiptId',p_receipt_id,'replayed',false
  );
end;
$$;

-- Historical point and global purge boundaries no longer execute deletion.
-- Callers must create an app-supplied UUIDv7 governance request and follow its
-- approval, inventory, apply and verify receipts.
create or replace function public.portal_delete_draft_agent(p_agent_id app.uuid_v7)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform app.data_governance_authenticated_admin();
  raise exception 'direct deletion disabled; submit a governed data disposition request' using errcode='0A000';
end;
$$;

create or replace function public.portal_delete_knowledge_source(p_source_id app.uuid_v7)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform app.data_governance_authenticated_admin();
  raise exception 'direct deletion disabled; submit a governed data disposition request' using errcode='0A000';
end;
$$;

create or replace function public.portal_delete_conversation_transcript(p_id app.uuid_v7)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform app.data_governance_authenticated_admin();
  raise exception 'direct deletion disabled; submit a governed data disposition request' using errcode='0A000';
end;
$$;

create or replace function public.portal_delete_conversation_transcript_service(
  p_tenant_id app.uuid_v7,p_id app.uuid_v7
) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  raise exception 'service point deletion disabled; lease an authorized governance work item' using errcode='0A000';
end;
$$;

create or replace function public.portal_purge_old_conversation_transcripts_service(
  p_older_than_days integer
) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  raise exception 'global transcript purge disabled; inventory tenant-scoped governance requests' using errcode='0A000';
end;
$$;

do $lock_down_governance_tables$
declare r record;
begin
  for r in
    select unnest(array[
      'data_governance_resource_catalog','data_governance_subjects',
      'data_governance_subject_artifact_links','data_governance_subject_coverage_attestations',
      'data_governance_requests',
      'data_governance_policy_decisions','data_governance_approvals',
      'data_legal_holds','data_legal_hold_scope_items','data_legal_hold_receipts',
      'data_governance_work_items','data_governance_attempt_receipts',
      'data_governance_final_receipts'
    ]) table_name
  loop
    execute format('alter table public.%I enable row level security',r.table_name);
    execute format('alter table public.%I force row level security',r.table_name);
    execute format('revoke all on table public.%I from public,anon,authenticated,service_role',r.table_name);
  end loop;
end
$lock_down_governance_tables$;

revoke all on function public.portal_request_data_governance_authenticated(
  app.uuid_v7,app.uuid_v7,text,app.uuid_v7,text,text,text,text,text,text,text
) from public,anon,authenticated,service_role;
revoke all on function public.portal_decide_data_governance_policy_service(
  app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,text,timestamp with time zone
) from public,anon,authenticated,service_role;
revoke all on function public.portal_approve_data_governance_authenticated(app.uuid_v7,app.uuid_v7,text,text)
  from public,anon,authenticated,service_role;
revoke all on function public.portal_create_data_legal_hold_authenticated(
  app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,app.uuid_v7,timestamp with time zone,text,app.uuid_v7,text,app.uuid_v7,text
) from public,anon,authenticated,service_role;
revoke all on function public.portal_release_data_legal_hold_authenticated(
  app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,text
)
  from public,anon,authenticated,service_role;
revoke all on function public.portal_data_governance_status_authenticated(app.uuid_v7)
  from public,anon,authenticated,service_role;
revoke all on function public.portal_cancel_data_governance_request_authenticated(app.uuid_v7,app.uuid_v7)
  from public,anon,authenticated,service_role;

grant execute on function public.portal_request_data_governance_authenticated(
  app.uuid_v7,app.uuid_v7,text,app.uuid_v7,text,text,text,text,text,text,text
) to authenticated;
grant execute on function public.portal_approve_data_governance_authenticated(app.uuid_v7,app.uuid_v7,text,text)
  to authenticated;
grant execute on function public.portal_create_data_legal_hold_authenticated(
  app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,app.uuid_v7,timestamp with time zone,text,app.uuid_v7,text,app.uuid_v7,text
) to authenticated;
grant execute on function public.portal_release_data_legal_hold_authenticated(
  app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,text
)
  to authenticated;
grant execute on function public.portal_data_governance_status_authenticated(app.uuid_v7)
  to authenticated;
grant execute on function public.portal_cancel_data_governance_request_authenticated(app.uuid_v7,app.uuid_v7)
  to authenticated;

revoke all on function public.portal_authorize_data_governance_request_service(app.uuid_v7,app.uuid_v7)
  from public,anon,authenticated,service_role;
revoke all on function public.portal_expire_data_legal_hold_service(app.uuid_v7,app.uuid_v7,app.uuid_v7)
  from public,anon,authenticated,service_role;
revoke all on function public.portal_expire_data_governance_request_service(app.uuid_v7,app.uuid_v7,app.uuid_v7)
  from public,anon,authenticated,service_role;
revoke all on function public.portal_register_data_governance_subject_link_service(
  app.uuid_v7,app.uuid_v7,text,text,text,uuid
) from public,anon,authenticated,service_role;
revoke all on function public.portal_attest_data_governance_subject_coverage_service(
  app.uuid_v7,app.uuid_v7,text,text,integer,text,app.uuid_v7,text
) from public,anon,authenticated,service_role;
revoke all on function public.portal_inventory_data_governance_request_service(
  app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,uuid,app.uuid_v7,boolean
) from public,anon,authenticated,service_role;
revoke all on function public.portal_lease_data_governance_work_items_service(
  app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,integer,integer
) from public,anon,authenticated,service_role;
revoke all on function public.portal_begin_data_governance_external_operation_service(
  app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,bigint,text
) from public,anon,authenticated,service_role;
revoke all on function public.portal_apply_data_governance_database_item_service(
  app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,bigint
) from public,anon,authenticated,service_role;
revoke all on function public.portal_record_data_governance_item_outcome_service(
  app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,text,bigint,text,text,text,app.uuid_v7,text,timestamp with time zone
) from public,anon,authenticated,service_role;
revoke all on function public.portal_complete_data_governance_request_service(app.uuid_v7,app.uuid_v7,app.uuid_v7)
  from public,anon,authenticated,service_role;

grant execute on function public.portal_authorize_data_governance_request_service(app.uuid_v7,app.uuid_v7) to service_role;
grant execute on function public.portal_decide_data_governance_policy_service(
  app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,text,timestamp with time zone
) to service_role;
grant execute on function public.portal_expire_data_legal_hold_service(app.uuid_v7,app.uuid_v7,app.uuid_v7) to service_role;
grant execute on function public.portal_expire_data_governance_request_service(app.uuid_v7,app.uuid_v7,app.uuid_v7) to service_role;
grant execute on function public.portal_register_data_governance_subject_link_service(
  app.uuid_v7,app.uuid_v7,text,text,text,uuid
) to service_role;
grant execute on function public.portal_attest_data_governance_subject_coverage_service(
  app.uuid_v7,app.uuid_v7,text,text,integer,text,app.uuid_v7,text
) to service_role;
grant execute on function public.portal_inventory_data_governance_request_service(
  app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,uuid,app.uuid_v7,boolean
) to service_role;
grant execute on function public.portal_lease_data_governance_work_items_service(
  app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,integer,integer
) to service_role;
grant execute on function public.portal_begin_data_governance_external_operation_service(
  app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,bigint,text
) to service_role;
grant execute on function public.portal_apply_data_governance_database_item_service(
  app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,bigint
) to service_role;
grant execute on function public.portal_record_data_governance_item_outcome_service(
  app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,text,bigint,text,text,text,app.uuid_v7,text,timestamp with time zone
) to service_role;
grant execute on function public.portal_complete_data_governance_request_service(app.uuid_v7,app.uuid_v7,app.uuid_v7)
  to service_role;

revoke all on function public.portal_delete_conversation_transcript_service(app.uuid_v7,app.uuid_v7)
  from public,anon,authenticated,service_role;
revoke all on function public.portal_purge_old_conversation_transcripts_service(integer)
  from public,anon,authenticated,service_role;
revoke all on function public.portal_delete_draft_agent(app.uuid_v7) from public,anon,service_role;
revoke all on function public.portal_delete_knowledge_source(app.uuid_v7) from public,anon,service_role;
revoke all on function public.portal_delete_conversation_transcript(app.uuid_v7) from public,anon,service_role;
grant execute on function public.portal_delete_draft_agent(app.uuid_v7) to authenticated;
grant execute on function public.portal_delete_knowledge_source(app.uuid_v7) to authenticated;
grant execute on function public.portal_delete_conversation_transcript(app.uuid_v7) to authenticated;

do $revoke_internal_governance_functions$
declare r record;
begin
  for r in
    select p.oid::regprocedure signature
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='app' and (p.proname like 'data_governance_%' or p.proname like 'data_legal_hold_%')
       or (n.nspname='app' and p.proname in ('enforce_data_governance_write_fence','prevent_mutation_or_governed_disposition','prevent_data_governance_receipt_mutation'))
  loop execute format('revoke all on function %s from public,anon,authenticated,service_role',r.signature); end loop;
end
$revoke_internal_governance_functions$;

alter function public.portal_schema_capabilities_service() set schema app;
alter function app.portal_schema_capabilities_service() rename to portal_schema_capabilities_v58;
revoke all on function app.portal_schema_capabilities_v58() from public,anon,authenticated,service_role;

create or replace function public.portal_schema_capabilities_service()
returns jsonb language sql stable security definer set search_path='' as $$
  select (app.portal_schema_capabilities_v58()-'version')||jsonb_build_object(
    'version',59,
    'dataGovernanceProfile','data_governance_disposition@1.0.0',
    'dataGovernanceCatalogComplete',app.data_governance_catalog_complete(),
    'dataGovernanceCatalogFingerprint',app.data_governance_catalog_fingerprint(),
    'dataGovernanceHistoricalTenantRelations',(
      select count(*) from public.data_governance_resource_catalog where catalog_generation='pre_v59' and relation_name<>'public.tenants'
    )=85,
    'dataGovernanceExternalSurfaces',(
      select count(*) from public.data_governance_resource_catalog where catalog_generation='external'
    )=7 and app.data_governance_attestation_authorities_ready(false),
    'dataGovernanceSubjectCoverageAuthorities',app.data_governance_attestation_authorities_ready(true),
    'dataGovernanceLegalHoldAuthorityReady',app.data_legal_hold_authorities_ready(),
    'dataGovernanceCanonicalContractsReady',false,
    'dataGovernanceControlProjection',
      to_regprocedure('app.data_governance_controls_projected(app.uuid_v7,app.uuid_v7,text,app.uuid_v7)') is not null
      and not has_function_privilege(
        'service_role',
        'app.data_governance_controls_projected(app.uuid_v7,app.uuid_v7,text,app.uuid_v7)',
        'EXECUTE'
      ),
    'dataGovernanceSecurityBoundary',
      app.data_governance_external_roles_revoked('public.data_governance_requests'::regclass)
      and app.data_governance_external_roles_revoked('public.data_governance_work_items'::regclass)
      and app.data_governance_external_roles_revoked('public.data_governance_attempt_receipts'::regclass)
      and app.data_governance_external_roles_revoked('public.data_governance_final_receipts'::regclass)
      and app.portal_service_role_only('public.portal_authorize_data_governance_request_service(app.uuid_v7,app.uuid_v7)')
      and app.portal_service_role_only('public.portal_decide_data_governance_policy_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,text,timestamp with time zone)')
      and app.portal_service_role_only('public.portal_expire_data_governance_request_service(app.uuid_v7,app.uuid_v7,app.uuid_v7)')
      and app.portal_service_role_only('public.portal_attest_data_governance_subject_coverage_service(app.uuid_v7,app.uuid_v7,text,text,integer,text,app.uuid_v7,text)')
      and app.portal_service_role_only('public.portal_inventory_data_governance_request_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,uuid,app.uuid_v7,boolean)')
      and app.portal_service_role_only('public.portal_lease_data_governance_work_items_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,integer,integer)')
      and app.portal_service_role_only('public.portal_begin_data_governance_external_operation_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,bigint,text)')
      and app.portal_service_role_only('public.portal_apply_data_governance_database_item_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,bigint)')
      and app.portal_service_role_only('public.portal_record_data_governance_item_outcome_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,text,bigint,text,text,text,app.uuid_v7,text,timestamp with time zone)')
      and app.portal_service_role_only('public.portal_complete_data_governance_request_service(app.uuid_v7,app.uuid_v7,app.uuid_v7)'),
    'dataGovernanceLegacyDeletionClosed',
      not has_function_privilege('service_role','public.portal_delete_conversation_transcript_service(app.uuid_v7,app.uuid_v7)','EXECUTE')
      and not has_function_privilege('service_role','public.portal_purge_old_conversation_transcripts_service(integer)','EXECUTE')
      and position('direct deletion disabled' in lower(pg_get_functiondef('public.portal_delete_conversation_transcript(app.uuid_v7)'::regprocedure)))>0,
    'dataGovernanceAppendOnlyTerminalFence',
      to_regprocedure('app.prevent_mutation()') is not null
      and to_regprocedure('app.prevent_mutation_or_governed_disposition()') is not null
      and not has_function_privilege('service_role','app.prevent_mutation_or_governed_disposition()','EXECUTE')
  )
$$;
revoke all on function public.portal_schema_capabilities_service() from public,anon,authenticated,service_role;
grant execute on function public.portal_schema_capabilities_service() to service_role;

commit;
