-- ADR-039 wave 1b-iii: closes the one gap 0052 left open on purpose. That
-- migration's portal_google_calendar_connection_context_service (see its own
-- comment, right above the grants block below) deliberately never selects
-- vault.decrypted_secrets -- it hands the application vault_secret_id/
-- calendar_id/default_timezone/status and stops there. Nothing else this
-- codebase has ever shipped reads a decrypted Vault secret back out; every
-- prior write (portal_connect_google_calendar_service, 0052) only ever wrote
-- one in and never had to read it back. Without this migration the
-- application has zero way to obtain the actual refresh token bytes it needs
-- to call Google's freebusy/events APIs -- the OAuth connection flow (wave
-- 1b-ii) is otherwise a write-only vault with no reader.
--
-- Single change: one new RPC, portal_google_calendar_decrypted_refresh_token_service,
-- named so its purpose is unmistakable next to the sibling function it
-- complements (never replaces) -- "_context_service" stays secret-free,
-- "_decrypted_refresh_token_service" is the only place in this schema that
-- is not. service_role-only, same as every RPC in this domain; never logs
-- anything (no RAISE of any kind, at any level, in this function's body);
-- never raises an exception for a missing/inactive connection, only ever
-- returns a declared outcome, so a caller (or an attacker probing through a
-- misconfigured surface) cannot distinguish "tenant has no connection" from
-- "tenant's connection exists but is revoked/reauth_required" from any other
-- not-found shape by error message -- all three collapse to the same
-- {"outcome":"not_connected"} response.
--
-- vault.decrypted_secrets: the real Supabase Vault extension (pgsodium-
-- backed) publishes this view over vault.secrets with a decrypted_secret
-- column holding the plaintext, alongside id/name/description/secret(cipher-
-- text)/key_id/nonce/created_at/updated_at. Confirmed empirically against
-- this project's own real hosted Supabase instance (ovctadcrvnfpgxzplupp),
-- not just Supabase's public documentation shape:
-- `select column_name,data_type from information_schema.columns where
-- table_schema='vault' and table_name='decrypted_secrets'` returned exactly
-- this column set, matching what scripts/supabase-portal-integration.mjs's
-- local stub of this view (added alongside this migration) already assumed.
-- Nothing in this repository referenced vault.decrypted_secrets before this
-- migration (0052 explicitly avoided it).
begin;

create or replace function public.portal_google_calendar_decrypted_refresh_token_service(p_tenant_id app.uuid_v7)
returns jsonb language plpgsql stable security definer set search_path='public' as $$
declare v_vault_secret_id uuid; v_refresh_token text;
begin
  -- Only a 'connected' row's secret is ever eligible. A revoked connection's
  -- vault_secret_id is already null by the table's own CHECK constraint
  -- (0052); a reauth_required connection still has a live vault_secret_id
  -- but its credential is known-stale from Google's side, so it is excluded
  -- here explicitly rather than relying on that CHECK's side effect alone.
  select vault_secret_id into v_vault_secret_id
    from public.portal_business_action_calendar_connections
    where tenant_id=p_tenant_id and status='connected';
  if not found then return jsonb_build_object('outcome','not_connected'); end if;

  -- Defensive, not merely decorative: v_vault_secret_id came from a snapshot
  -- read above, not a row lock, so a concurrent disconnect (which deletes
  -- the Vault row, see portal_disconnect_google_calendar_service) between
  -- these two statements is possible under READ COMMITTED. Treat that race
  -- the same as never having connected -- not_connected, never an error.
  select decrypted_secret into v_refresh_token from vault.decrypted_secrets where id=v_vault_secret_id;
  if not found then return jsonb_build_object('outcome','not_connected'); end if;

  return jsonb_build_object('outcome','found','refreshToken',v_refresh_token);
end $$;

-- The armadilha dos grants from this migration's own operating rules: a bare
-- CREATE OR REPLACE on a brand-new function still defaults EXECUTE to
-- PUBLIC, which includes anon. Revoke explicitly and grant only service_role,
-- every time this file is reapplied, never trusting CREATE OR REPLACE alone.
revoke all on function public.portal_google_calendar_decrypted_refresh_token_service(app.uuid_v7) from public,anon,authenticated;
grant execute on function public.portal_google_calendar_decrypted_refresh_token_service(app.uuid_v7) to service_role;

-- Byte-identical to 0052's body except the version literal and the one new
-- capability key -- every existing key stays exactly as 0052 defined it so
-- no prior capability probe regresses.
create or replace function public.portal_schema_capabilities_service()
returns jsonb language sql stable security definer set search_path='public' as $$
  select jsonb_build_object(
    'version',53,
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
    'businessActionKillSwitches',to_regclass('public.portal_business_action_kill_switches') is not null and to_regclass('public.portal_business_action_kill_switch_events') is not null and to_regprocedure('public.portal_business_action_status_service(app.uuid_v7,app.uuid_v7,text)') is not null,
    'businessActionGrants',to_regclass('public.portal_business_action_grants') is not null and to_regprocedure('public.portal_admit_business_action_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,integer)') is not null and to_regprocedure('public.portal_set_business_action_agent_settings_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,boolean)') is not null,
    'businessActionReceipts',to_regclass('public.portal_business_action_receipts') is not null,
    'businessActionLeads',to_regclass('public.portal_business_action_leads') is not null and to_regprocedure('public.portal_register_business_lead_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,text,text)') is not null,
    'businessActionProposals',to_regclass('public.portal_business_action_proposals') is not null and to_regclass('public.portal_business_action_proposal_slots') is not null and to_regprocedure('public.portal_propose_business_meeting_slots_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,integer,text,jsonb,text,text)') is not null,
    'businessActionCalendarReservations',to_regclass('public.portal_business_action_calendar_reservations') is not null and to_regprocedure('public.portal_reserve_business_meeting_slot_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text)') is not null and to_regprocedure('public.portal_reconcile_business_meeting_reservation_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,text,text)') is not null,
    'businessActionCalendarConnections',to_regclass('public.portal_business_action_calendar_connections') is not null and to_regprocedure('public.portal_connect_google_calendar_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,text,text)') is not null and to_regprocedure('public.portal_disconnect_google_calendar_service(app.uuid_v7,app.uuid_v7)') is not null and to_regprocedure('public.portal_google_calendar_connection_context_service(app.uuid_v7)') is not null,
    'businessActionCalendarCredentialRead',to_regprocedure('public.portal_google_calendar_decrypted_refresh_token_service(app.uuid_v7)') is not null
  )
$$;
revoke all on function public.portal_schema_capabilities_service() from public,anon,authenticated;
grant execute on function public.portal_schema_capabilities_service() to service_role;

commit;
