-- ADR-041 "Resolver sessão, presenter e geração de uma chamada já viva sem
-- recriar o acoplamento que ADR-039 já proíbe". A tool call de negócio
-- (register_lead/propose_meeting_slots/confirm_meeting_slot) chega numa
-- requisição HTTP separada, minutos depois de admitPortalChannel ter
-- resolvido sessionId/presenterId em memória (video-conversation.ts) e
-- devolvido a URL da chamada. Sem esta RPC, o único jeito óbvio de
-- redescobrir esses valores seria chamar admitPortalChannel de novo com o
-- mesmo commandId -- o que recriaria exatamente a dependência de
-- PORTAL_RUNTIME_BRIDGE_ENABLED que ADR-039 construiu
-- portal-business-action-bridge.ts inteiro para evitar (esse módulo nunca
-- importa nem chama nada de portal-channel-runtime-bridge.ts).
--
-- Mesmo formato de portal_get_sentinel_attach_service (0043): leitura pura,
-- STABLE, SECURITY DEFINER, junção sobre dado que a admissão do canal já
-- deixou gravado (0043), nunca chamando a própria RPC de admissão. Ancorada
-- não num provider ref (o que a Server Action de tool call ainda não tem
-- motivo de conhecer) e sim na mesma chave de idempotência que
-- startVideoConversation/stopVideoConversation já usam para reencontrar a
-- chamada viva a partir de um commandId
-- (paidEffectIntentKey(commandId,discriminator), paid-effects/index.ts).
--
-- NUMBERING NOTE: database/supabase-only/ termina em 0052 na main. 0053 está
-- reservada pela onda 1b-iii (portal_google_calendar_decrypted_refresh_token_service),
-- ainda não mergeada na main quando este arquivo foi escrito; 0054 é o
-- próximo número livre (ADR-041 já documenta essa numeração explicitamente).
-- Se a ordem de merge inverter, renumerar seguindo o mesmo padrão já
-- registrado em D-V2-145/146/149 em docs/operations/DECISIONS_LOG.md: mudar
-- o nome do arquivo, todo literal de versão abaixo (schema_capabilities,
-- este comentário) e scripts/supabase-portal-integration.mjs +
-- scripts/validate_database_contract.py.
begin;

-- Mesma disciplina anti-oráculo de portal_get_sentinel_attach_service (0043)
-- e de portal_google_calendar_decrypted_refresh_token_service (0053, onda
-- 1b-iii): toda forma de "não encontrado" -- idempotency_key desconhecida,
-- reserva sem receipt de canal ainda vinculado, receipt apontando pra um
-- binding cujo agent_id não bate com o do chamador, ou (defensivamente) um
-- binding cuja sessão já não existe -- colapsa no mesmo outcome 'not_found'.
-- Nenhum branch aqui deixa o chamador distinguir "essa reserva não existe"
-- de "existe mas pertence a outro agente" por mensagem, código de erro ou
-- formato de resposta (Art. 15).
--
-- presenterId é lido de sessions.active_presenter_id, nunca de
-- portal_runtime_channel_bindings.presenter_id: a coluna do binding é o
-- presenter que venceu o floor no instante da admissão e nunca é atualizada
-- depois; sessions.active_presenter_id é o floor vivo e pode se mover por
-- handoff (Art. 2) depois da admissão. Ler a coluna do binding aqui
-- entregaria, silenciosamente, uma identidade de presenter obsoleta pra uma
-- tool call que chega minutos depois de um handoff já ter acontecido.
--
-- Status terminal é 'completed'/'failed' -- confirmado contra o próprio
-- CHECK de public.sessions
-- (database/migrations/0003_interaction_and_actions.sql:
-- `status text NOT NULL CHECK (status IN ('preparing','ready','active','handoff_pending','completed','failed'))`),
-- nunca o vocabulário ('ended','failed') que meeting_bot_sessions (0021) usa
-- para o próprio status, que é uma tabela e um domínio diferentes.
create or replace function public.portal_business_action_call_context_service(
  p_tenant_id app.uuid_v7,p_agent_id app.uuid_v7,p_idempotency_key text
) returns jsonb language sql stable security definer set search_path='public' as $$
  select case
    when b.id is null then jsonb_build_object('outcome','not_found')
    when b.agent_id is distinct from p_agent_id then jsonb_build_object('outcome','not_found')
    when s.id is null then jsonb_build_object('outcome','not_found')
    when s.status in ('completed','failed') then jsonb_build_object('outcome','session_terminal')
    else jsonb_build_object('outcome','found','sessionId',s.id,'presenterId',s.active_presenter_id,'generation',b.generation)
  end
  from (values(1)) seed(n)
  left join public.provider_effect_reservations r on r.tenant_id=p_tenant_id and r.idempotency_key=p_idempotency_key
  left join public.portal_runtime_provider_channel_receipts pr on pr.tenant_id=r.tenant_id and pr.reservation_id=r.id
  left join public.portal_runtime_channel_bindings b on b.tenant_id=pr.tenant_id and b.id=pr.binding_id
  left join public.sessions s on s.tenant_id=b.tenant_id and s.id=b.session_id
$$;

revoke all on function public.portal_business_action_call_context_service(app.uuid_v7,app.uuid_v7,text) from public,anon,authenticated;
grant execute on function public.portal_business_action_call_context_service(app.uuid_v7,app.uuid_v7,text) to service_role;

create or replace function public.portal_schema_capabilities_service()
returns jsonb language sql stable security definer set search_path='public' as $$
  select jsonb_build_object(
    'version',54,
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
    'businessActionCalendarCredentialRead',to_regprocedure('public.portal_google_calendar_decrypted_refresh_token_service(app.uuid_v7)') is not null,
    'businessActionLiveCallContext',to_regprocedure('public.portal_business_action_call_context_service(app.uuid_v7,app.uuid_v7,text)') is not null
  )
$$;
revoke all on function public.portal_schema_capabilities_service() from public,anon,authenticated;
grant execute on function public.portal_schema_capabilities_service() to service_role;

commit;
