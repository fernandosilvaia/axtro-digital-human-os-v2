-- M5-01 ledger contract phase. This migration aligns the hosted cost ledger
-- with the immutable cost_event contract and removes the remaining direct
-- legacy writers. Apply only after 0040 and 0041, while maintenance remains
-- active; readiness requires v42 after this point.
begin;

-- Historical rows receive the only supported contract version through the
-- default. New reservation-backed writers inherit it without duplicating a
-- mutable literal in every INSERT statement.
alter table public.cost_events
  add column schema_version text not null default '2.1.0';

alter table public.cost_events
  add constraint cost_events_schema_version_check
  check (schema_version = '2.1.0');

-- These pre-M5 writers can create ledger rows without an ADR-036 reservation,
-- provider request reference, or durable receipt. There is no compatible
-- caller after the M5 contract; direct execution is denied to every exposed
-- Supabase role, including service_role.
revoke all on function public.portal_log_ai_usage(app.uuid_v7,text,integer,integer,numeric)
  from public,anon,authenticated,service_role;
revoke all on function public.portal_log_video_usage(app.uuid_v7)
  from public,anon,authenticated,service_role;
revoke all on function public.portal_log_video_usage_service(app.uuid_v7,app.uuid_v7)
  from public,anon,authenticated,service_role;
revoke all on function public.portal_log_ai_usage_service(app.uuid_v7,app.uuid_v7,integer,integer)
  from public,anon,authenticated,service_role;

create or replace function public.portal_schema_capabilities_service()
returns jsonb language sql stable security definer set search_path='public' as $$
  select jsonb_build_object(
    'version',42,
    'providerEffectReservations',to_regclass('public.provider_effect_reservations') is not null,
    'providerEffectReconciliation',to_regprocedure('public.portal_lease_provider_effect_reconciliation_service(app.uuid_v7,integer,integer)') is not null,
    'billingUsageOutbox',to_regclass('public.billing_usage_outbox') is not null,
    'recallWebhookDedupe',to_regclass('public.recall_webhook_deliveries') is not null,
    'recallTenantBinding',to_regprocedure('public.portal_record_meeting_bot_session_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,text,app.uuid_v7,app.uuid_v7)') is not null,
    'tavusWebhookCapabilities',to_regclass('public.tavus_webhook_deliveries') is not null,
    'tavusWebhookCapabilityLifecycle',
      exists(select 1 from information_schema.columns where table_schema='public' and table_name='provider_effect_reservations' and column_name='tavus_webhook_capability_expires_at')
      and exists(select 1 from information_schema.columns where table_schema='public' and table_name='provider_effect_reservations' and column_name='tavus_webhook_capability_revoked_at')
      and exists(select 1 from information_schema.columns where table_schema='public' and table_name='tavus_webhook_deliveries' and column_name='observed_at')
      and to_regprocedure('public.portal_preflight_tavus_webhook_service(app.uuid_v7,text)') is not null
      and to_regprocedure('public.portal_claim_tavus_webhook_service(app.uuid_v7,text,text,text,app.uuid_v7,timestamp with time zone)') is not null,
    'tavusCustomerDeliveryReceipts',to_regclass('public.tavus_customer_delivery_receipts') is not null
      and to_regprocedure('public.portal_record_tavus_customer_delivery_service(app.uuid_v7,text,text,text,timestamp with time zone)') is not null
      and to_regprocedure('public.portal_record_tavus_no_delivery_service(app.uuid_v7,text,text,text,timestamp with time zone)') is not null,
    'tavusStageCapabilities',to_regclass('public.tavus_stage_capabilities') is not null
      and to_regprocedure('public.portal_create_tavus_stage_capability_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text)') is not null
      and to_regprocedure('public.portal_resolve_tavus_stage_capability_service(text)') is not null
      and to_regprocedure('public.portal_revoke_tavus_stage_capability_service(app.uuid_v7)') is not null,
    'aiUsageReservations',to_regclass('public.ai_usage_reservations') is not null,
    'aiUsageReconciliation',to_regclass('public.ai_usage_reconciliation_receipts') is not null
      and to_regprocedure('public.portal_reconcile_ai_usage_service(app.uuid_v7,app.uuid_v7,text,text,integer,integer,numeric)') is not null
      and to_regprocedure('public.portal_ai_usage_reconciliation_backlog_service()') is not null,
    'workerHeartbeats',to_regclass('public.worker_heartbeats') is not null
      and to_regprocedure('public.portal_record_worker_heartbeat_service(text,app.uuid_v7,text,text,text,text,jsonb)') is not null
      and to_regprocedure('public.portal_worker_readiness_service()') is not null,
    'providerTranscriptService',to_regprocedure('public.portal_register_provider_transcript_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text)') is not null,
    'billingCheckoutIntents',to_regclass('public.billing_checkout_intents') is not null
      and to_regclass('public.billing_stripe_event_receipts') is not null
      and to_regprocedure('public.portal_begin_billing_checkout_intent_service(app.uuid_v7,app.uuid_v7,uuid,text,text,text,boolean,integer,integer,text,text,text,text,timestamp with time zone)') is not null
      and to_regprocedure('public.portal_mark_billing_checkout_dispatched_service(app.uuid_v7)') is not null
      and to_regprocedure('public.portal_bind_billing_checkout_session_service(app.uuid_v7,text,text,timestamp with time zone)') is not null
      and to_regprocedure('public.portal_release_billing_checkout_intent_service(app.uuid_v7,text)') is not null
      and to_regprocedure('public.portal_apply_billing_checkout_event_service(text,text,timestamp with time zone,app.uuid_v7,text,app.uuid_v7,text,text,text,text)') is not null
      and to_regprocedure('public.portal_apply_tenant_subscription_event_service(text,text,timestamp with time zone,app.uuid_v7,text,text,text,text,timestamp with time zone,timestamp with time zone,app.uuid_v7)') is not null,
    'strictSubscriptionIdentity',to_regclass('public.billing_checkout_intents_subscription_uidx') is not null
      and exists(select 1 from information_schema.columns where table_schema='public' and table_name='tenant_subscriptions' and column_name='checkout_intent_id')
      and exists(select 1 from information_schema.columns where table_schema='public' and table_name='tenant_subscriptions' and column_name='last_event_id')
      and to_regprocedure('public.portal_apply_billing_checkout_event_service(text,text,timestamp with time zone,app.uuid_v7,text,app.uuid_v7,text,text,text,text)') is not null
      and to_regprocedure('public.portal_apply_tenant_subscription_event_service(text,text,timestamp with time zone,app.uuid_v7,text,text,text,text,timestamp with time zone,timestamp with time zone,app.uuid_v7)') is not null,
    'legacySubscriptionWriterRevoked',not has_function_privilege(
      'service_role',
      'public.portal_upsert_tenant_subscription_service(app.uuid_v7,app.uuid_v7,text,text,text,text,timestamp with time zone,timestamp with time zone,timestamp with time zone)',
      'EXECUTE'
    ),
    'costEventSchemaVersion',
      exists(select 1 from information_schema.columns where table_schema='public' and table_name='cost_events' and column_name='schema_version' and data_type='text' and is_nullable='NO' and column_default is not null)
      and exists(select 1 from pg_constraint where conrelid='public.cost_events'::regclass and conname='cost_events_schema_version_check' and contype='c'),
    'legacyCostWritersRevoked',
      not has_function_privilege('service_role','public.portal_log_ai_usage(app.uuid_v7,text,integer,integer,numeric)','EXECUTE')
      and not has_function_privilege('authenticated','public.portal_log_ai_usage(app.uuid_v7,text,integer,integer,numeric)','EXECUTE')
      and not has_function_privilege('service_role','public.portal_log_video_usage(app.uuid_v7)','EXECUTE')
      and not has_function_privilege('authenticated','public.portal_log_video_usage(app.uuid_v7)','EXECUTE')
      and not has_function_privilege('service_role','public.portal_log_video_usage_service(app.uuid_v7,app.uuid_v7)','EXECUTE')
      and not has_function_privilege('authenticated','public.portal_log_video_usage_service(app.uuid_v7,app.uuid_v7)','EXECUTE')
      and not has_function_privilege('service_role','public.portal_log_ai_usage_service(app.uuid_v7,app.uuid_v7,integer,integer)','EXECUTE')
      and not has_function_privilege('authenticated','public.portal_log_ai_usage_service(app.uuid_v7,app.uuid_v7,integer,integer)','EXECUTE'),
    'authenticatedProviderTranscriptPreclaimBlocked',true,
    'authenticatedMeetingBotPreclaimBlocked',true
  )
$$;
revoke all on function public.portal_schema_capabilities_service() from public,anon,authenticated;
grant execute on function public.portal_schema_capabilities_service() to service_role;

commit;
