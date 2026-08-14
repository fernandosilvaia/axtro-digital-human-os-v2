-- M5-01 contract phase. Apply with the 0040-aware application artifact
-- present but unready and receiving no traffic; readiness requires v41.
-- Application rollback to a legacy provider-transcript writer is safe only
-- before this migration. Provider refs are service-owned after this point.
begin;

-- Contract phase only: v40 remains compatible with the historical shape,
-- while v41 rejects hidden provider instructions and unknown keys.
create or replace function app.validate_transcript_turns(p_turns jsonb) returns void language plpgsql as $$
begin
  if jsonb_typeof(p_turns) is distinct from 'array' or jsonb_array_length(p_turns)>1000 then raise exception 'turns must be a bounded jsonb array' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(p_turns) e where jsonb_typeof(e) is distinct from 'object' or not(e?'role' and e?'content') or (select count(*) from jsonb_object_keys(e))<>2 or jsonb_typeof(e->'role') is distinct from 'string' or jsonb_typeof(e->'content') is distinct from 'string' or e->>'role' not in ('user','assistant') or char_length(e->>'content') not between 1 and 8000) then raise exception 'malformed transcript turn' using errcode='22023'; end if;
end; $$;

create or replace function public.portal_upsert_conversation_transcript(
  p_id app.uuid_v7,
  p_agent_id app.uuid_v7,
  p_surface text,
  p_external_ref text,
  p_turns jsonb,
  p_ended_at timestamptz default null
) returns jsonb
language plpgsql security definer set search_path='public'
as $$
declare v_tenant app.uuid_v7;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode='28000'; end if;
  if p_surface is distinct from 'chat' then raise exception 'provider transcript references are service-owned' using errcode='42501'; end if;
  if p_external_ref is null or char_length(p_external_ref) not between 1 and 255 then raise exception 'invalid external_ref' using errcode='22023'; end if;
  perform app.validate_transcript_turns(p_turns);
  select tenant_id into v_tenant from public.user_tenant_memberships where user_id=auth.uid();
  if v_tenant is null then raise exception 'no tenant provisioned' using errcode='42501'; end if;
  if not exists(select 1 from public.agents where tenant_id=v_tenant and id=p_agent_id) then raise exception 'agent not found for account' using errcode='42501'; end if;
  insert into public.conversation_transcripts(id,tenant_id,agent_id,surface,external_ref,turns,ended_at)
  values(p_id,v_tenant,p_agent_id,'chat',p_external_ref,p_turns,p_ended_at)
  on conflict(tenant_id,surface,external_ref) do update set turns=excluded.turns,ended_at=coalesce(excluded.ended_at,conversation_transcripts.ended_at),updated_at=now();
  return jsonb_build_object('ok',true);
end; $$;
revoke all on function public.portal_upsert_conversation_transcript(app.uuid_v7,app.uuid_v7,text,text,jsonb,timestamptz) from public,anon;
grant execute on function public.portal_upsert_conversation_transcript(app.uuid_v7,app.uuid_v7,text,text,jsonb,timestamptz) to authenticated;

-- The historical browser writer accepted a caller-selected Recall bot UUID.
-- Once provider effects are service-owned it must not remain as a second,
-- preclaimable ownership path alongside portal_record_*_service.
revoke all on function public.portal_record_meeting_bot_session(app.uuid_v7,app.uuid_v7,text,text,text,app.uuid_v7) from public,anon,authenticated;

-- Contract phase: after v41 every subscription mutation must carry one signed
-- Stripe event identity through the strict writer. The historical writer has
-- no event-id replay ledger or checkout-intent identity and is revoked by its
-- exact catalog signature, including service_role.
revoke all on function public.portal_upsert_tenant_subscription_service(
  app.uuid_v7,app.uuid_v7,text,text,text,text,timestamp with time zone,timestamp with time zone,timestamp with time zone
) from public,anon,authenticated,service_role;

create or replace function public.portal_schema_capabilities_service()
returns jsonb language sql stable security definer set search_path='public' as $$
  select jsonb_build_object(
    'version',41,
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
    'authenticatedProviderTranscriptPreclaimBlocked',true,
    'authenticatedMeetingBotPreclaimBlocked',true
  )
$$;
revoke all on function public.portal_schema_capabilities_service() from public,anon,authenticated;
grant execute on function public.portal_schema_capabilities_service() to service_role;

commit;
