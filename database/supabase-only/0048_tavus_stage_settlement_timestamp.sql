-- D-V2-138: retain tavus_stage_expiry_chk when an older transaction settles
-- after a concurrent creator has established a 45-minute stage capability.
BEGIN;

create or replace function public.portal_settle_provider_effect_termination_service(
  p_tenant_id app.uuid_v7,p_receipt_id app.uuid_v7,p_lease_token app.uuid_v7,p_outcome text,p_error_code text default null
) returns jsonb language plpgsql security definer set search_path='public' as $$
declare v_receipt public.provider_effect_termination_receipts%rowtype; v_reservation public.provider_effect_reservations%rowtype;
  v_error text; v_retry_seconds integer; v_stage_mutation_at timestamptz;
begin
  if p_outcome not in ('provider_accepted','retryable_failure') then raise exception 'invalid termination outcome' using errcode='22023'; end if;
  select * into v_receipt from public.provider_effect_termination_receipts where tenant_id=p_tenant_id and id=p_receipt_id for update;
  if not found or v_receipt.state<>'dispatching' or v_receipt.lease_token is distinct from p_lease_token or v_receipt.lease_until<=now() then
    return jsonb_build_object('outcome','stale');
  end if;
  select * into v_reservation from public.provider_effect_reservations where tenant_id=p_tenant_id and id=v_receipt.reservation_id for update;
  if not found then return jsonb_build_object('outcome','stale'); end if;
  if p_outcome='provider_accepted' then
    if v_receipt.provider_id='tavus' then
      v_stage_mutation_at:=clock_timestamp();
      update public.tavus_stage_capabilities
        set revoked_at=coalesce(revoked_at,v_stage_mutation_at),updated_at=greatest(updated_at,v_stage_mutation_at,expires_at-interval '45 minutes')
        where tenant_id=p_tenant_id and reservation_id=v_reservation.id;
    end if;
    if v_reservation.state='committed' then
      update public.provider_effect_reservations set state='completed',completed_at=coalesce(completed_at,now()),updated_at=now() where tenant_id=p_tenant_id and id=v_reservation.id and state='committed';
      if not found then return jsonb_build_object('outcome','stale'); end if;
    elsif v_reservation.state<>'completed' then
      return jsonb_build_object('outcome','stale');
    end if;
    update public.provider_effect_termination_receipts set state='provider_accepted',lease_token=null,lease_until=null,settled_at=now(),provider_receipt_ref='termination:'||v_receipt.provider_id||':sha256:'||app.sha256_tuple(v_reservation.provider_ref) where id=v_receipt.id;
    return jsonb_build_object('outcome','accepted');
  end if;
  v_error:=case when p_error_code ~ '^[a-z][a-z0-9_]{2,79}$' then p_error_code else 'provider_termination_unavailable' end;
  if v_receipt.attempt>=8 then
    update public.provider_effect_termination_receipts set state='operator_required',lease_token=null,lease_until=null,settled_at=now(),error_code=v_error where id=v_receipt.id;
    return jsonb_build_object('outcome','operator_required');
  end if;
  v_retry_seconds:=least(300,15*(2 ^ least(v_receipt.attempt-1,4))::integer);
  update public.provider_effect_termination_receipts set state='retryable_failure',lease_token=null,lease_until=null,settled_at=now(),retry_after=now()+make_interval(secs=>v_retry_seconds),error_code=v_error where id=v_receipt.id;
  return jsonb_build_object('outcome','retry_after');
end; $$;
revoke all on function public.portal_settle_provider_effect_termination_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text) from public,anon,authenticated;
grant execute on function public.portal_settle_provider_effect_termination_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text) to service_role;

create or replace function public.portal_resolve_tavus_stage_capability_service(p_token_hash text)
returns jsonb language plpgsql security definer set search_path='public' as $$
declare c public.tavus_stage_capabilities%rowtype; v_stage_mutation_at timestamptz;
begin
  if p_token_hash !~ '^[0-9a-f]{64}$' then return jsonb_build_object('found',false); end if;
  select * into c from public.tavus_stage_capabilities where token_hash=p_token_hash for update;
  if not found or c.revoked_at is not null or c.resolve_count>=8 then return jsonb_build_object('found',false); end if;
  v_stage_mutation_at:=clock_timestamp();
  if c.expires_at<=v_stage_mutation_at then return jsonb_build_object('found',false); end if;
  update public.tavus_stage_capabilities
    set resolve_count=resolve_count+1,updated_at=greatest(updated_at,v_stage_mutation_at,expires_at-interval '45 minutes')
    where reservation_id=c.reservation_id;
  return jsonb_build_object('found',true,'roomUrl',c.room_url,'expiresAt',c.expires_at);
end; $$;
revoke all on function public.portal_resolve_tavus_stage_capability_service(text) from public,anon,authenticated;
grant execute on function public.portal_resolve_tavus_stage_capability_service(text) to service_role;

create or replace function public.portal_revoke_tavus_stage_capability_service(p_reservation_id app.uuid_v7)
returns jsonb language plpgsql security definer set search_path='public' as $$
declare c public.tavus_stage_capabilities%rowtype; v_stage_mutation_at timestamptz;
begin
  select * into c from public.tavus_stage_capabilities where reservation_id=p_reservation_id for update;
  if not found then return jsonb_build_object('revoked',false); end if;
  v_stage_mutation_at:=clock_timestamp();
  update public.tavus_stage_capabilities
    set revoked_at=coalesce(revoked_at,v_stage_mutation_at),updated_at=greatest(updated_at,v_stage_mutation_at,expires_at-interval '45 minutes')
    where reservation_id=c.reservation_id;
  return jsonb_build_object('revoked',true);
end; $$;
revoke all on function public.portal_revoke_tavus_stage_capability_service(app.uuid_v7) from public,anon,authenticated;
grant execute on function public.portal_revoke_tavus_stage_capability_service(app.uuid_v7) to service_role;

create or replace function public.portal_schema_capabilities_service()
returns jsonb language sql stable security definer set search_path='public' as $$
  select jsonb_build_object(
    'version',48,
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
    'serviceRoleAppSchemaUsage',has_schema_privilege('service_role','app','USAGE') and has_type_privilege('service_role','app.uuid_v7','USAGE')
  )
$$;
revoke all on function public.portal_schema_capabilities_service() from public,anon,authenticated;
grant execute on function public.portal_schema_capabilities_service() to service_role;

COMMIT;
