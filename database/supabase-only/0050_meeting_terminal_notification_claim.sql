-- Corrige o achado D-V2-145/149: o e-mail de "reunião encerrada" nunca
-- dispara em reentrega de webhook do Recall depois de uma falha transitória
-- na limpeza da conversa Tavus na entrega que fez a transição terminal,
-- porque notifyMeetingEnded() era gated em `applied`, que a RPC
-- portal_update_meeting_bot_session_status_service (0040) só retorna true
-- na PRIMEIRA entrega que muda o status — toda reentrega seguinte encontra
-- a sessão já terminal e retorna applied:false, mesmo que a limpeza
-- (reexecutada, idempotente) finalmente tenha sucesso.
--
-- Em vez de remendar a RPC de status (grande, já testada, toca billing),
-- uma RPC nova e pequena faz um claim atômico de "já notifiquei essa
-- sessão" — o próprio UPDATE com WHERE ... AND coluna IS NULL é a seção
-- crítica (Postgres serializa via lock de linha), sem precisar de FOR
-- UPDATE explícito. A aplicação chama essa RPC no ponto onde já sabe que a
-- limpeza está satisfeita (não precisa mais dela, ou ela acabou de
-- suceder), substituindo o gate `applied &&` por só "é status terminal".
begin;

alter table public.meeting_bot_sessions
  add column if not exists terminal_notification_claimed_at timestamptz;

create or replace function public.portal_claim_meeting_terminal_notification_service(p_recall_bot_id text)
returns boolean language plpgsql security definer set search_path='public' as $$
begin
  if p_recall_bot_id is null or char_length(p_recall_bot_id) = 0 then
    raise exception 'invalid recall bot id' using errcode='22023';
  end if;
  update public.meeting_bot_sessions
    set terminal_notification_claimed_at = now()
    where recall_bot_id = p_recall_bot_id
      and status in ('ended','failed')
      and terminal_notification_claimed_at is null;
  return found;
end; $$;

revoke all on function public.portal_claim_meeting_terminal_notification_service(text) from public, anon, authenticated;
grant execute on function public.portal_claim_meeting_terminal_notification_service(text) to service_role;

create or replace function public.portal_schema_capabilities_service()
returns jsonb language sql stable security definer set search_path='public' as $$
  select jsonb_build_object(
    'version',50,
    'providerEffectReservations',to_regclass('public.provider_effect_reservations') is not null,
    'providerEffectReconciliation',to_regprocedure('public.portal_lease_provider_effect_reconciliation_service(app.uuid_v7,integer,integer)') is not null,
    'providerEffectTerminationFence',to_regclass('public.provider_effect_termination_receipts') is not null and to_regprocedure('public.portal_begin_provider_effect_termination_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,uuid,app.uuid_v7,app.uuid_v7,text,text,integer)') is not null and to_regprocedure('public.portal_settle_provider_effect_termination_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text)') is not null,
    'tavusStageExpiryConcurrencyFence',
      position('v_stage_mutation_at:=clock_timestamp()' in regexp_replace(pg_get_functiondef('public.portal_settle_provider_effect_termination_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text)'::regprocedure),'\s+','','g'))>0
      and position('updated_at=greatest(updated_at,v_stage_mutation_at,expires_at-interval''45minutes'')' in regexp_replace(pg_get_functiondef('public.portal_settle_provider_effect_termination_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text)'::regprocedure),'\s+','','g'))>0
      and position('v_stage_mutation_at:=clock_timestamp()' in regexp_replace(pg_get_functiondef('public.portal_resolve_tavus_stage_capability_service(text)'::regprocedure),'\s+','','g'))>0
      and position('c.expires_at<=v_stage_mutation_at' in regexp_replace(pg_get_functiondef('public.portal_resolve_tavus_stage_capability_service(text)'::regprocedure),'\s+','','g'))>0
      and position('updated_at=greatest(updated_at,v_stage_mutation_at,expires_at-interval''45minutes'')' in regexp_replace(pg_get_functiondef('public.portal_resolve_tavus_stage_capability_service(text)'::regprocedure),'\s+','','g'))>0
      and position('v_stage_mutation_at:=clock_timestamp()' in regexp_replace(pg_get_functiondef('public.portal_revoke_tavus_stage_capability_service(app.uuid_v7)'::regprocedure),'\s+','','g'))>0
      and position('updated_at=greatest(updated_at,v_stage_mutation_at,expires_at-interval''45minutes'')' in regexp_replace(pg_get_functiondef('public.portal_revoke_tavus_stage_capability_service(app.uuid_v7)'::regprocedure),'\s+','','g'))>0,
    'billingUsageOutbox',to_regclass('public.billing_usage_outbox') is not null,
    'recallWebhookDedupe',to_regclass('public.recall_webhook_deliveries') is not null,
    'recallTenantBinding',to_regprocedure('public.portal_record_meeting_bot_session_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,text,app.uuid_v7,app.uuid_v7)') is not null,
    'tavusWebhookCapabilities',to_regclass('public.tavus_webhook_deliveries') is not null,
    'tavusWebhookCapabilityLifecycle',to_regprocedure('public.portal_preflight_tavus_webhook_service(app.uuid_v7,text)') is not null and to_regprocedure('public.portal_claim_tavus_webhook_service(app.uuid_v7,text,text,text,app.uuid_v7,timestamp with time zone)') is not null,
    'tavusCustomerDeliveryReceipts',to_regclass('public.tavus_customer_delivery_receipts') is not null and to_regprocedure('public.portal_record_tavus_customer_delivery_service(app.uuid_v7,text,text,text,timestamp with time zone)') is not null,
    'tavusStageCapabilities',to_regclass('public.tavus_stage_capabilities') is not null and to_regprocedure('public.portal_create_tavus_stage_capability_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text)') is not null,
    'aiUsageReservations',to_regclass('public.ai_usage_reservations') is not null,
    'aiUsageReconciliation',to_regclass('public.ai_usage_reconciliation_receipts') is not null and to_regprocedure('public.portal_reconcile_ai_usage_service(app.uuid_v7,app.uuid_v7,text,text,integer,integer,numeric)') is not null,
    'workerHeartbeats',to_regclass('public.worker_heartbeats') is not null and to_regprocedure('public.portal_record_worker_heartbeat_service(text,app.uuid_v7,text,text,text,text,jsonb)') is not null,
    'providerTranscriptService',to_regprocedure('public.portal_register_provider_transcript_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text)') is not null,
    'authenticatedProviderTranscriptPreclaimBlocked',true,'authenticatedMeetingBotPreclaimBlocked',true,
    'billingCheckoutIntents',to_regclass('public.billing_checkout_intents') is not null,'strictSubscriptionIdentity',to_regclass('public.billing_checkout_intents_subscription_uidx') is not null,
    'legacySubscriptionWriterRevoked',not has_function_privilege('service_role','public.portal_upsert_tenant_subscription_service(app.uuid_v7,app.uuid_v7,text,text,text,text,timestamp with time zone,timestamp with time zone,timestamp with time zone)','EXECUTE'),
    'costEventSchemaVersion',exists(select 1 from information_schema.columns where table_schema='public' and table_name='cost_events' and column_name='schema_version' and data_type='text' and is_nullable='NO' and column_default is not null) and exists(select 1 from pg_constraint where conrelid='public.cost_events'::regclass and conname='cost_events_schema_version_check' and contype='c'),
    'legacyCostWritersRevoked',not has_function_privilege('service_role','public.portal_log_ai_usage(app.uuid_v7,text,integer,integer,numeric)','EXECUTE') and not has_function_privilege('authenticated','public.portal_log_ai_usage(app.uuid_v7,text,integer,integer,numeric)','EXECUTE') and not has_function_privilege('service_role','public.portal_log_video_usage(app.uuid_v7)','EXECUTE') and not has_function_privilege('authenticated','public.portal_log_video_usage(app.uuid_v7)','EXECUTE') and not has_function_privilege('service_role','public.portal_log_video_usage_service(app.uuid_v7,app.uuid_v7)','EXECUTE') and not has_function_privilege('authenticated','public.portal_log_video_usage_service(app.uuid_v7,app.uuid_v7)','EXECUTE') and not has_function_privilege('service_role','public.portal_log_ai_usage_service(app.uuid_v7,app.uuid_v7,integer,integer)','EXECUTE') and not has_function_privilege('authenticated','public.portal_log_ai_usage_service(app.uuid_v7,app.uuid_v7,integer,integer)','EXECUTE'),
    'runtimeChannelAdmission',to_regclass('public.portal_runtime_channel_bindings') is not null and to_regprocedure('public.portal_admit_runtime_channel_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text[],text,integer,app.uuid_v7,text,text,text,text,jsonb,jsonb)') is not null,
    'runtimeChannelGrantFences',to_regclass('public.portal_runtime_channel_dispatches') is not null and to_regprocedure('public.portal_consume_runtime_channel_grant_service(app.uuid_v7,text,text)') is not null,
    'runtimeProviderBindingReceipts',to_regclass('public.portal_runtime_provider_channel_receipts') is not null and to_regprocedure('public.portal_bind_runtime_provider_channel_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,text)') is not null,
    'runtimeSceneReceipts',to_regclass('public.portal_runtime_scene_execution_receipts') is not null and to_regprocedure('public.portal_execute_runtime_scene_service(app.uuid_v7,app.uuid_v7,text,text,integer,text,text)') is not null,
    'runtimeKillSwitches',to_regclass('public.portal_runtime_kill_switches') is not null and to_regclass('public.portal_runtime_kill_switch_events') is not null and to_regprocedure('public.portal_runtime_channel_status_service(app.uuid_v7,app.uuid_v7,text,text)') is not null,
    'runtimeDualOperatorReconciliation',to_regclass('public.portal_runtime_operator_reconciliation_receipts') is not null and to_regprocedure('public.portal_reconcile_runtime_provider_effect_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text)') is not null,
    'runtimeBridgeReceiptIntegrity',exists(select 1 from pg_constraint where conrelid='public.portal_runtime_kill_switches'::regclass and conname='portal_runtime_kill_switches_tenant_id_id_key' and contype='u') and exists(select 1 from pg_constraint where conrelid='public.portal_runtime_kill_switch_events'::regclass and conname='portal_runtime_kill_switch_events_tenant_kill_switch_fkey' and contype='f') and position('provider_ref=p_provider_ref' in regexp_replace(pg_get_functiondef('public.portal_bind_runtime_provider_channel_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,text)'::regprocedure),'\s+','','g'))>0 and position('provider_urlisnotdistinctfromp_provider_url' in regexp_replace(pg_get_functiondef('public.portal_bind_runtime_provider_channel_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,text)'::regprocedure),'\s+','','g'))>0,
    'meetingBotStatusUpdateUnambiguous',(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='portal_update_meeting_bot_session_status_service')=1,
    'serviceRoleAppSchemaUsage',has_schema_privilege('service_role','app','USAGE') and has_type_privilege('service_role','app.uuid_v7','USAGE'),
    'portalTextPreviewAdmission',
      to_regclass('public.portal_text_preview_privacy_policies') is not null
      and to_regclass('public.portal_text_preview_admissions') is not null
      and to_regprocedure('public.portal_provision_text_preview_privacy_policy_service(app.uuid_v7,app.uuid_v7,text,text,text,timestamp with time zone,timestamp with time zone)') is not null
      and to_regprocedure('public.portal_admit_text_preview_service(app.uuid_v7,uuid,app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,text,text,text,text,app.uuid_v7,text,text,app.uuid_v7,text,text,app.uuid_v7,app.uuid_v7,app.uuid_v7,boolean,boolean,text,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7)') is not null,
    'portalTextPreviewTurnFence',
      to_regclass('public.portal_text_preview_turn_claims') is not null
      and to_regclass('public.portal_text_preview_turn_claims_generation_fence_uidx') is not null
      and exists(select 1 from pg_index i
        where i.indexrelid=to_regclass('public.portal_text_preview_turn_claims_generation_fence_uidx')
          and i.indisunique and i.indnkeyatts=3
          and position('onpublic.portal_text_preview_turn_claimsusingbtree(tenant_id,admission_id,generation)'
            in regexp_replace(lower(pg_get_indexdef(i.indexrelid)),'\s+','','g'))>0
          and regexp_replace(pg_get_expr(i.indpred,i.indrelid),'[\s()]','','g')=
            'state=ANYARRAY[''acquired''::text,''succeeded''::text]')
      and exists(select 1 from pg_constraint c
        where c.conrelid='public.portal_text_preview_transcript_writes'::regclass
          and c.conname='portal_text_preview_writes_claim_fkey'
          and regexp_replace(pg_get_constraintdef(c.oid),'\s+','','g')=
            'FOREIGNKEY(tenant_id,admission_id,claim_id,generation)REFERENCESportal_text_preview_turn_claims(tenant_id,admission_id,id,generation)ONDELETERESTRICT')
      and to_regprocedure('public.portal_acquire_text_preview_turn_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,integer,app.uuid_v7,app.uuid_v7)') is not null
      and to_regprocedure('public.portal_complete_text_preview_turn_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,integer,text,text,text,text,text)') is not null
      and to_regprocedure('public.portal_fail_text_preview_turn_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,integer,text,text,text)') is not null,
    'portalTextPreviewEgressAuthorization',
      to_regclass('public.portal_text_preview_egress_authorizations') is not null
      and to_regprocedure('public.portal_authorize_text_preview_egress_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,integer,text,app.uuid_v7)') is not null
      and exists(select 1 from pg_constraint c
        where c.conrelid='public.portal_text_preview_egress_authorizations'::regclass
          and c.conname='portal_text_preview_egress_claim_kind_key'
          and c.contype='u')
      and has_function_privilege('service_role','public.portal_authorize_text_preview_egress_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,integer,text,app.uuid_v7)','EXECUTE')
      and not has_function_privilege('anon','public.portal_authorize_text_preview_egress_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,integer,text,app.uuid_v7)','EXECUTE')
      and not has_function_privilege('authenticated','public.portal_authorize_text_preview_egress_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,integer,text,app.uuid_v7)','EXECUTE'),
    'portalTextPreviewProviderFailureReceipt',
      to_regprocedure('app.portal_record_text_preview_failure(app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,timestamp with time zone)') is not null
      and to_regprocedure('public.portal_fail_text_preview_turn_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,integer,text,text,text)') is not null
      and to_regprocedure('public.portal_reconcile_text_preview_provider_response_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,integer,text,text)') is not null,
    'portalTextTranscriptOptIn',
      to_regclass('public.portal_text_preview_transcript_writes') is not null
      and to_regprocedure('public.portal_complete_text_preview_turn_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,integer,text,text,text,text,text)') is not null
      and not exists(select 1 from pg_constraint c
        where c.conrelid in ('public.portal_text_preview_admissions'::regclass,'public.portal_text_preview_transcript_writes'::regclass)
          and c.confrelid='public.conversation_transcripts'::regclass),
    'portalTextPreviewCleanup',to_regprocedure('public.portal_cleanup_expired_text_preview_sessions_service(integer)') is not null,
    'portalTextPreviewCanonicalOutbox',
      exists(select 1 from pg_constraint c
        where c.conrelid='public.events_outbox'::regclass
          and c.conname='events_outbox_event_document_canonical_check'
          and c.contype='c'
          and c.convalidated
          and md5(regexp_replace(lower(pg_get_constraintdef(c.oid)),'\s+','','g'))=
            'd9b3dba3ee3f690c55df3d1001446d9b')
      and to_regprocedure('app.portal_enqueue_text_preview_event(app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,text,bigint,text,app.uuid_v7,app.uuid_v7,jsonb,timestamp with time zone)') is not null
      and to_regprocedure('app.portal_record_text_preview_failure(app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,timestamp with time zone)') is not null
      and to_regprocedure('app.portal_record_text_preview_success(app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,text,timestamp with time zone)') is not null
      and position('insertintopublic.events_outbox' in regexp_replace(lower(pg_get_functiondef(
        'app.portal_enqueue_text_preview_event(app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,text,bigint,text,app.uuid_v7,app.uuid_v7,jsonb,timestamp with time zone)'::regprocedure
      )),'\s+','','g'))>0
      and position('insertintopublic.session_timeline' in regexp_replace(lower(pg_get_functiondef(
        'app.portal_enqueue_text_preview_event(app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,text,bigint,text,app.uuid_v7,app.uuid_v7,jsonb,timestamp with time zone)'::regprocedure
      )),'\s+','','g'))=0
      and not has_function_privilege('service_role','app.portal_enqueue_text_preview_event(app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,text,bigint,text,app.uuid_v7,app.uuid_v7,jsonb,timestamp with time zone)','EXECUTE')
      and not has_function_privilege('anon','app.portal_enqueue_text_preview_event(app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,text,bigint,text,app.uuid_v7,app.uuid_v7,jsonb,timestamp with time zone)','EXECUTE')
      and not has_function_privilege('authenticated','app.portal_enqueue_text_preview_event(app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,text,bigint,text,app.uuid_v7,app.uuid_v7,jsonb,timestamp with time zone)','EXECUTE'),
    'portalTextPreviewSecurityBoundary',
      not exists(select 1
        from (values
          ('public.portal_text_preview_privacy_policies'::regclass),
          ('public.portal_text_preview_admissions'::regclass),
          ('public.portal_text_preview_turn_claims'::regclass),
          ('public.portal_text_preview_egress_authorizations'::regclass),
          ('public.portal_text_preview_transcript_writes'::regclass)
        ) as expected(table_oid)
        join pg_class c on c.oid=expected.table_oid
        where not c.relrowsecurity or not c.relforcerowsecurity)
      and not exists(select 1
        from (values
          ('public.portal_text_preview_privacy_policies'::regclass),
          ('public.portal_text_preview_admissions'::regclass),
          ('public.portal_text_preview_turn_claims'::regclass),
          ('public.portal_text_preview_egress_authorizations'::regclass),
          ('public.portal_text_preview_transcript_writes'::regclass)
        ) as expected(table_oid)
        join pg_class c on c.oid=expected.table_oid
        cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl
        left join pg_roles grantee on grantee.oid=acl.grantee
        where (acl.grantee=0 or grantee.rolname in ('anon','authenticated','service_role'))
          and acl.privilege_type in ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'))
      and has_function_privilege('service_role','public.portal_provision_text_preview_privacy_policy_service(app.uuid_v7,app.uuid_v7,text,text,text,timestamp with time zone,timestamp with time zone)','EXECUTE')
      and has_function_privilege('service_role','public.portal_admit_text_preview_service(app.uuid_v7,uuid,app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,text,text,text,text,app.uuid_v7,text,text,app.uuid_v7,text,text,app.uuid_v7,app.uuid_v7,app.uuid_v7,boolean,boolean,text,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7)','EXECUTE')
      and has_function_privilege('service_role','public.portal_acquire_text_preview_turn_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,integer,app.uuid_v7,app.uuid_v7)','EXECUTE')
      and has_function_privilege('service_role','public.portal_authorize_text_preview_egress_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,integer,text,app.uuid_v7)','EXECUTE')
      and has_function_privilege('service_role','public.portal_complete_text_preview_turn_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,integer,text,text,text,text,text)','EXECUTE')
      and has_function_privilege('service_role','public.portal_reconcile_text_preview_provider_response_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,integer,text,text)','EXECUTE')
      and has_function_privilege('service_role','public.portal_fail_text_preview_turn_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,integer,text,text,text)','EXECUTE')
      and has_function_privilege('service_role','public.portal_cleanup_expired_text_preview_sessions_service(integer)','EXECUTE')
      and not has_function_privilege('anon','public.portal_provision_text_preview_privacy_policy_service(app.uuid_v7,app.uuid_v7,text,text,text,timestamp with time zone,timestamp with time zone)','EXECUTE')
      and not has_function_privilege('authenticated','public.portal_provision_text_preview_privacy_policy_service(app.uuid_v7,app.uuid_v7,text,text,text,timestamp with time zone,timestamp with time zone)','EXECUTE')
      and not has_function_privilege('anon','public.portal_admit_text_preview_service(app.uuid_v7,uuid,app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,text,text,text,text,app.uuid_v7,text,text,app.uuid_v7,text,text,app.uuid_v7,app.uuid_v7,app.uuid_v7,boolean,boolean,text,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7)','EXECUTE')
      and not has_function_privilege('authenticated','public.portal_admit_text_preview_service(app.uuid_v7,uuid,app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,text,text,text,text,app.uuid_v7,text,text,app.uuid_v7,text,text,app.uuid_v7,app.uuid_v7,app.uuid_v7,boolean,boolean,text,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7)','EXECUTE')
      and not has_function_privilege('anon','public.portal_acquire_text_preview_turn_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,integer,app.uuid_v7,app.uuid_v7)','EXECUTE')
      and not has_function_privilege('authenticated','public.portal_acquire_text_preview_turn_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,integer,app.uuid_v7,app.uuid_v7)','EXECUTE')
      and not has_function_privilege('anon','public.portal_authorize_text_preview_egress_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,integer,text,app.uuid_v7)','EXECUTE')
      and not has_function_privilege('authenticated','public.portal_authorize_text_preview_egress_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,integer,text,app.uuid_v7)','EXECUTE')
      and not has_function_privilege('anon','public.portal_complete_text_preview_turn_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,integer,text,text,text,text,text)','EXECUTE')
      and not has_function_privilege('authenticated','public.portal_complete_text_preview_turn_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,integer,text,text,text,text,text)','EXECUTE')
      and not has_function_privilege('anon','public.portal_reconcile_text_preview_provider_response_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,integer,text,text)','EXECUTE')
      and not has_function_privilege('authenticated','public.portal_reconcile_text_preview_provider_response_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,integer,text,text)','EXECUTE')
      and not has_function_privilege('anon','public.portal_fail_text_preview_turn_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,integer,text,text,text)','EXECUTE')
      and not has_function_privilege('authenticated','public.portal_fail_text_preview_turn_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,integer,text,text,text)','EXECUTE')
      and not has_function_privilege('anon','public.portal_cleanup_expired_text_preview_sessions_service(integer)','EXECUTE')
      and not has_function_privilege('authenticated','public.portal_cleanup_expired_text_preview_sessions_service(integer)','EXECUTE'),
    'legacyAuthenticatedChatTranscriptWriterAvailable',not has_function_privilege('anon','public.portal_upsert_conversation_transcript(app.uuid_v7,app.uuid_v7,text,text,jsonb,timestamp with time zone)','EXECUTE') and has_function_privilege('authenticated','public.portal_upsert_conversation_transcript(app.uuid_v7,app.uuid_v7,text,text,jsonb,timestamp with time zone)','EXECUTE') and not has_function_privilege('service_role','public.portal_upsert_conversation_transcript(app.uuid_v7,app.uuid_v7,text,text,jsonb,timestamp with time zone)','EXECUTE'),
    'meetingTerminalNotificationClaim',
      exists(select 1 from information_schema.columns where table_schema='public' and table_name='meeting_bot_sessions' and column_name='terminal_notification_claimed_at')
      and to_regprocedure('public.portal_claim_meeting_terminal_notification_service(text)') is not null
      and not has_function_privilege('anon','public.portal_claim_meeting_terminal_notification_service(text)','EXECUTE')
      and not has_function_privilege('authenticated','public.portal_claim_meeting_terminal_notification_service(text)','EXECUTE')
  )
$$;
revoke all on function public.portal_schema_capabilities_service() from public,anon,authenticated;
grant execute on function public.portal_schema_capabilities_service() to service_role;

commit;
