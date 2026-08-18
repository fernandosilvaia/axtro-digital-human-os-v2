-- M5-03 forward-only integrity repair for the M5-02 runtime bridge.
-- Apply only after 0043 while the bridge remains fail-closed during the
-- human-controlled rollout. This migration neither creates a provider
-- resource nor re-enables a legacy writer.
BEGIN;

-- The original primary key is global, but the event also carries a tenant.
-- Keep its historical FK and add the composite reference that makes a
-- cross-tenant event structurally impossible.
alter table public.portal_runtime_kill_switches
  add constraint portal_runtime_kill_switches_tenant_id_id_key unique (tenant_id,id);

alter table public.portal_runtime_kill_switch_events
  add constraint portal_runtime_kill_switch_events_tenant_kill_switch_fkey
  foreign key (tenant_id,kill_switch_id)
  references public.portal_runtime_kill_switches(tenant_id,id) on delete restrict;

-- A receipt is evidence for exactly the provider resource that the durable
-- reservation committed. Tenant, agent and provider equality alone could
-- otherwise bind a second same-provider resource to a valid reservation.
create or replace function public.portal_bind_runtime_provider_channel_service(p_receipt_id app.uuid_v7,p_grant_id app.uuid_v7,p_reservation_id app.uuid_v7,p_provider_id text,p_provider_ref text,p_provider_url text default null)
returns boolean language plpgsql security definer set search_path='public' as $$
declare v_binding public.portal_runtime_channel_bindings%rowtype; v_receipt public.portal_runtime_provider_channel_receipts%rowtype;
begin
  if p_provider_id not in ('tavus','recall') or p_provider_ref !~ '^[A-Za-z0-9][A-Za-z0-9:._/-]{1,254}$' then raise exception 'invalid provider channel receipt' using errcode='22023'; end if;
  select * into v_binding from public.portal_runtime_channel_bindings where id=p_grant_id for update; if not found then return false; end if;
  if app.portal_runtime_switch_disabled(v_binding.tenant_id,v_binding.agent_id,v_binding.channel_kind,'provider_dispatch') or not exists(select 1 from public.portal_runtime_channel_dispatches where tenant_id=v_binding.tenant_id and binding_id=v_binding.id and consumer_kind=p_provider_id) then return false; end if;
  if not exists(select 1 from public.provider_effect_reservations where tenant_id=v_binding.tenant_id and id=p_reservation_id and agent_id=v_binding.agent_id and provider_id=p_provider_id and provider_ref=p_provider_ref and provider_url is not distinct from p_provider_url and state in ('committed','completed','cleanup_pending','unknown')) then return false; end if;
  select * into v_receipt from public.portal_runtime_provider_channel_receipts where tenant_id=v_binding.tenant_id and reservation_id=p_reservation_id; if found then return v_receipt.binding_id=v_binding.id and v_receipt.provider_id=p_provider_id and v_receipt.provider_ref=p_provider_ref and v_receipt.provider_url is not distinct from p_provider_url; end if;
  insert into public.portal_runtime_provider_channel_receipts(id,tenant_id,binding_id,reservation_id,provider_id,provider_ref,provider_url) values(p_receipt_id,v_binding.tenant_id,v_binding.id,p_reservation_id,p_provider_id,p_provider_ref,p_provider_url);
  return true;
end $$;

revoke all on function public.portal_bind_runtime_provider_channel_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,text) from public,anon,authenticated;
grant execute on function public.portal_bind_runtime_provider_channel_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,text) to service_role;

create or replace function public.portal_schema_capabilities_service()
returns jsonb language sql stable security definer set search_path='public' as $$
  select jsonb_build_object(
    'version',44,
    'providerEffectReservations',to_regclass('public.provider_effect_reservations') is not null,
    'providerEffectReconciliation',to_regprocedure('public.portal_lease_provider_effect_reconciliation_service(app.uuid_v7,integer,integer)') is not null,
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
    'billingCheckoutIntents',to_regclass('public.billing_checkout_intents') is not null and to_regclass('public.billing_stripe_event_receipts') is not null,
    'strictSubscriptionIdentity',to_regclass('public.billing_checkout_intents_subscription_uidx') is not null,
    'legacySubscriptionWriterRevoked',not has_function_privilege('service_role','public.portal_upsert_tenant_subscription_service(app.uuid_v7,app.uuid_v7,text,text,text,text,timestamp with time zone,timestamp with time zone,timestamp with time zone)','EXECUTE'),
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
    'runtimeChannelAdmission',to_regclass('public.portal_runtime_channel_bindings') is not null and to_regprocedure('public.portal_admit_runtime_channel_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text[],text,integer,app.uuid_v7,text,text,text,text,jsonb,jsonb)') is not null,
    'runtimeChannelGrantFences',to_regclass('public.portal_runtime_channel_dispatches') is not null and to_regprocedure('public.portal_consume_runtime_channel_grant_service(app.uuid_v7,text,text)') is not null,
    'runtimeProviderBindingReceipts',to_regclass('public.portal_runtime_provider_channel_receipts') is not null and to_regprocedure('public.portal_bind_runtime_provider_channel_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,text)') is not null,
    'runtimeSceneReceipts',to_regclass('public.portal_runtime_scene_execution_receipts') is not null and to_regprocedure('public.portal_execute_runtime_scene_service(app.uuid_v7,app.uuid_v7,text,text,integer,text,text)') is not null,
    'runtimeKillSwitches',to_regclass('public.portal_runtime_kill_switches') is not null and to_regclass('public.portal_runtime_kill_switch_events') is not null and to_regprocedure('public.portal_runtime_channel_status_service(app.uuid_v7,app.uuid_v7,text,text)') is not null,
    'runtimeDualOperatorReconciliation',to_regclass('public.portal_runtime_operator_reconciliation_receipts') is not null and to_regprocedure('public.portal_reconcile_runtime_provider_effect_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text)') is not null,
    'runtimeBridgeReceiptIntegrity',
      exists(select 1 from pg_constraint where conrelid='public.portal_runtime_kill_switches'::regclass and conname='portal_runtime_kill_switches_tenant_id_id_key' and contype='u')
      and exists(select 1 from pg_constraint where conrelid='public.portal_runtime_kill_switch_events'::regclass and conname='portal_runtime_kill_switch_events_tenant_kill_switch_fkey' and contype='f')
      and position('provider_ref=p_provider_ref' in regexp_replace(pg_get_functiondef('public.portal_bind_runtime_provider_channel_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,text)'::regprocedure),'\s+','','g'))>0
      and position('provider_urlisnotdistinctfromp_provider_url' in regexp_replace(pg_get_functiondef('public.portal_bind_runtime_provider_channel_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,text)'::regprocedure),'\s+','','g'))>0
  )
$$;
revoke all on function public.portal_schema_capabilities_service() from public,anon,authenticated;
grant execute on function public.portal_schema_capabilities_service() to service_role;

COMMIT;
