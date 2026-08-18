-- D-V2-136: PostgREST resolves app.uuid_v7 while executing service-only RPCs.
-- Grant only schema/type visibility to service_role; table/function access stays
-- exclusively behind the existing SECURITY DEFINER RPC boundary.
BEGIN;

grant usage on schema app to service_role;
grant usage on type app.uuid_v7 to service_role;

create or replace function public.portal_schema_capabilities_service()
returns jsonb language sql stable security definer set search_path='public' as $$
  select jsonb_build_object(
    'version',47,
    'providerEffectReservations',to_regclass('public.provider_effect_reservations') is not null,
    'providerEffectReconciliation',to_regprocedure('public.portal_lease_provider_effect_reconciliation_service(app.uuid_v7,integer,integer)') is not null,
    'providerEffectTerminationFence',to_regclass('public.provider_effect_termination_receipts') is not null and to_regprocedure('public.portal_begin_provider_effect_termination_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,uuid,app.uuid_v7,app.uuid_v7,text,text,integer)') is not null and to_regprocedure('public.portal_settle_provider_effect_termination_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text)') is not null,
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
    'serviceRoleAppSchemaUsage',has_schema_privilege('service_role','app','USAGE') and has_type_privilege('service_role','app.uuid_v7','USAGE')
  )
$$;
revoke all on function public.portal_schema_capabilities_service() from public,anon,authenticated;
grant execute on function public.portal_schema_capabilities_service() to service_role;

COMMIT;
