-- D-V2-136: durable, operator-authorized termination receipt.  A stop request
-- never uses the create reservation RPC (which could create a billable effect)
-- and never exposes a reservation/provider reference to the browser.
BEGIN;

create table public.provider_effect_termination_receipts (
  id app.uuid_v7 primary key,
  tenant_id app.uuid_v7 not null references public.tenants(id) on delete restrict,
  reservation_id app.uuid_v7 not null,
  provider_id text not null,
  actor_id app.uuid_v7 not null,
  attempt integer not null,
  state text not null,
  lease_token app.uuid_v7,
  lease_until timestamptz,
  requested_at timestamptz not null default now(),
  dispatched_at timestamptz,
  settled_at timestamptz,
  retry_after timestamptz,
  provider_receipt_ref text,
  error_code text,
  foreign key (tenant_id,reservation_id) references public.provider_effect_reservations(tenant_id,id) on delete restrict,
  foreign key (tenant_id,actor_id) references public.user_tenant_memberships(tenant_id,actor_id) on delete restrict,
  unique (tenant_id,reservation_id,attempt),
  constraint provider_effect_termination_receipts_provider_chk check (provider_id in ('tavus','recall')),
  constraint provider_effect_termination_receipts_attempt_chk check (attempt between 1 and 8),
  constraint provider_effect_termination_receipts_state_chk check (state in ('dispatching','provider_accepted','retryable_failure','operator_required')),
  constraint provider_effect_termination_receipts_lease_chk check (
    (state='dispatching' and lease_token is not null and lease_until is not null and dispatched_at is not null and settled_at is null and retry_after is null and provider_receipt_ref is null and error_code is null)
    or (state='provider_accepted' and lease_token is null and lease_until is null and settled_at is not null and provider_receipt_ref is not null and retry_after is null and error_code is null)
    or (state='retryable_failure' and lease_token is null and lease_until is null and settled_at is not null and retry_after is not null and provider_receipt_ref is null and error_code is not null)
    or (state='operator_required' and lease_token is null and lease_until is null and settled_at is not null and retry_after is null and provider_receipt_ref is null and error_code is not null)
  ),
  constraint provider_effect_termination_receipts_error_chk check (error_code is null or error_code ~ '^[a-z][a-z0-9_]{2,79}$'),
  constraint provider_effect_termination_receipts_provider_receipt_chk check (provider_receipt_ref is null or provider_receipt_ref ~ '^termination:(tavus|recall):sha256:[0-9a-f]{64}$')
);
alter table public.provider_effect_termination_receipts enable row level security;
alter table public.provider_effect_termination_receipts force row level security;
revoke all on table public.provider_effect_termination_receipts from public,anon,authenticated,service_role;

create or replace function public.portal_begin_provider_effect_termination_service(
  p_receipt_id app.uuid_v7,p_lease_token app.uuid_v7,p_tenant_id app.uuid_v7,p_user_id uuid,p_actor_id app.uuid_v7,
  p_agent_id app.uuid_v7,p_idempotency_key text,p_expected_provider text,p_lease_seconds integer default 60
) returns jsonb language plpgsql security definer set search_path='public' as $$
declare v_reservation public.provider_effect_reservations%rowtype; v_receipt public.provider_effect_termination_receipts%rowtype;
  v_next_attempt integer; v_retry_seconds integer;
begin
  if p_expected_provider not in ('tavus','recall') or p_lease_seconds not between 15 and 120
    or p_idempotency_key !~ '^[a-z0-9][a-z0-9:._/-]{7,199}$' then raise exception 'invalid termination request' using errcode='22023'; end if;
  if not exists(select 1 from public.user_tenant_memberships m where m.tenant_id=p_tenant_id and m.user_id=p_user_id and m.actor_id=p_actor_id and m.role='tenant_admin') then
    raise exception 'tenant admin membership required' using errcode='42501';
  end if;
  select * into v_reservation from public.provider_effect_reservations r
    where r.tenant_id=p_tenant_id and r.idempotency_key=p_idempotency_key for update;
  if not found then return jsonb_build_object('outcome','not_started'); end if;
  if v_reservation.agent_id is distinct from p_agent_id or v_reservation.provider_id is distinct from p_expected_provider then return jsonb_build_object('outcome','not_stoppable'); end if;
  if v_reservation.provider_ref is null then
    return jsonb_build_object('outcome','not_stoppable');
  end if;
  select * into v_receipt from public.provider_effect_termination_receipts r
    where r.tenant_id=p_tenant_id and r.reservation_id=v_reservation.id order by r.attempt desc limit 1 for update;
  if found then
    if v_receipt.state='provider_accepted' then return jsonb_build_object('outcome','accepted'); end if;
    if v_receipt.state='operator_required' then return jsonb_build_object('outcome','operator_required'); end if;
    if v_receipt.state='dispatching' and v_receipt.lease_until>now() then return jsonb_build_object('outcome','in_progress'); end if;
    if v_receipt.state='retryable_failure' and v_receipt.retry_after>now() then return jsonb_build_object('outcome','retry_after'); end if;
    if v_receipt.attempt>=8 then
      update public.provider_effect_termination_receipts set state='operator_required',lease_token=null,lease_until=null,settled_at=now(),retry_after=null,error_code=coalesce(error_code,'termination_attempt_limit') where id=v_receipt.id;
      return jsonb_build_object('outcome','operator_required');
    end if;
    v_next_attempt:=v_receipt.attempt+1;
  else
    v_next_attempt:=1;
  end if;
  if v_reservation.state<>'committed' then return jsonb_build_object('outcome','not_stoppable'); end if;
  insert into public.provider_effect_termination_receipts(id,tenant_id,reservation_id,provider_id,actor_id,attempt,state,lease_token,lease_until,dispatched_at)
    values(p_receipt_id,p_tenant_id,v_reservation.id,p_expected_provider,p_actor_id,v_next_attempt,'dispatching',p_lease_token,now()+make_interval(secs=>p_lease_seconds),now());
  return jsonb_build_object('outcome','dispatch_granted','providerRef',v_reservation.provider_ref);
end; $$;

create or replace function public.portal_settle_provider_effect_termination_service(
  p_tenant_id app.uuid_v7,p_receipt_id app.uuid_v7,p_lease_token app.uuid_v7,p_outcome text,p_error_code text default null
) returns jsonb language plpgsql security definer set search_path='public' as $$
declare v_receipt public.provider_effect_termination_receipts%rowtype; v_reservation public.provider_effect_reservations%rowtype;
  v_error text; v_retry_seconds integer;
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
      update public.tavus_stage_capabilities
        set revoked_at=coalesce(revoked_at,now()),updated_at=now()
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

-- A completed reservation may be a terminal operator termination. Never let
-- the older stage-capability creator rotate a revoked room back into service.
create or replace function public.portal_create_tavus_stage_capability_service(
  p_tenant_id app.uuid_v7,p_agent_id app.uuid_v7,p_reservation_id app.uuid_v7,p_token_hash text,p_room_url text
) returns jsonb language plpgsql security definer set search_path='public' as $$
declare c public.tavus_stage_capabilities%rowtype; v_reservation public.provider_effect_reservations%rowtype; v_expiry timestamptz:=now()+interval '45 minutes';
begin
  if p_token_hash !~ '^[0-9a-f]{64}$' or p_room_url !~ '^https://tavus[.]daily[.]co/' or char_length(p_room_url)>2000 then raise exception 'invalid stage capability' using errcode='22023'; end if;
  select * into v_reservation from public.provider_effect_reservations
    where tenant_id=p_tenant_id and agent_id=p_agent_id and id=p_reservation_id and provider_id='tavus' for update;
  if not found or v_reservation.state<>'committed' then raise exception 'committed Tavus reservation required' using errcode='23514'; end if;
  select * into c from public.tavus_stage_capabilities where reservation_id=p_reservation_id for update;
  if found then
    if c.tenant_id is distinct from p_tenant_id or c.agent_id is distinct from p_agent_id or c.room_url is distinct from p_room_url then raise exception 'stage capability replay conflict' using errcode='23505'; end if;
    if c.token_hash=p_token_hash and c.revoked_at is null and c.expires_at>now() and c.resolve_count<8 then return jsonb_build_object('created',true,'replayed',true,'expiresAt',c.expires_at); end if;
    update public.tavus_stage_capabilities set token_hash=p_token_hash,expires_at=v_expiry,revoked_at=null,resolve_count=0,updated_at=now() where reservation_id=p_reservation_id;
    return jsonb_build_object('created',true,'replayed',false,'rotated',true,'expiresAt',v_expiry);
  end if;
  insert into public.tavus_stage_capabilities(reservation_id,tenant_id,agent_id,token_hash,room_url,expires_at) values(p_reservation_id,p_tenant_id,p_agent_id,p_token_hash,p_room_url,v_expiry);
  return jsonb_build_object('created',true,'replayed',false,'expiresAt',v_expiry);
end; $$;

revoke all on function public.portal_begin_provider_effect_termination_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,uuid,app.uuid_v7,app.uuid_v7,text,text,integer) from public,anon,authenticated;
revoke all on function public.portal_settle_provider_effect_termination_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text) from public,anon,authenticated;
grant execute on function public.portal_begin_provider_effect_termination_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,uuid,app.uuid_v7,app.uuid_v7,text,text,integer) to service_role;
grant execute on function public.portal_settle_provider_effect_termination_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text) to service_role;

create or replace function public.portal_schema_capabilities_service()
returns jsonb language sql stable security definer set search_path='public' as $$
  select jsonb_build_object(
    'version',46,
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
    'meetingBotStatusUpdateUnambiguous',(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='portal_update_meeting_bot_session_status_service')=1
  )
$$;
revoke all on function public.portal_schema_capabilities_service() from public,anon,authenticated;
grant execute on function public.portal_schema_capabilities_service() to service_role;

COMMIT;
