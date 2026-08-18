-- M5-02 portal/runtime bridge. This is an additive, service-only durable
-- constitutional admission boundary; it intentionally does not restore any
-- historical direct provider writer. Apply after 0040-0042.
begin;

create or replace function app.portal_runtime_capabilities_valid(p_capabilities text[])
returns boolean language sql immutable strict set search_path='pg_catalog' as $$
  select cardinality(p_capabilities)<=5
    and p_capabilities <@ array['recording','persistent_transcription','behavioral_analysis','visual_analysis','scene_presentation']::text[]
    and cardinality(p_capabilities)=(select count(distinct value) from unnest(p_capabilities) value)
$$;

create table public.portal_runtime_kill_switches (
  id app.uuid_v7 primary key,
  tenant_id app.uuid_v7 not null references public.tenants(id) on delete restrict,
  agent_id app.uuid_v7,
  channel_kind text,
  capability text,
  enabled boolean not null default false,
  changed_by_actor_id app.uuid_v7 not null,
  reason_code text not null,
  changed_at timestamptz not null default now(),
  foreign key (tenant_id,agent_id) references public.agents(tenant_id,id) on delete restrict,
  foreign key (tenant_id,changed_by_actor_id) references public.user_tenant_memberships(tenant_id,actor_id) on delete restrict,
  constraint portal_runtime_kill_switches_channel_chk check (channel_kind is null or channel_kind in ('tavus_video','recall_meeting')),
  constraint portal_runtime_kill_switches_capability_chk check (capability is null or capability in ('channel_admission','provider_dispatch','scene_publish')),
  constraint portal_runtime_kill_switches_reason_chk check (reason_code ~ '^[a-z][a-z0-9_]{2,79}$')
);
create unique index portal_runtime_kill_switches_scope_uidx
  on public.portal_runtime_kill_switches(tenant_id,coalesce(agent_id::text,''),coalesce(channel_kind,''),coalesce(capability,''));
alter table public.portal_runtime_kill_switches enable row level security;
alter table public.portal_runtime_kill_switches force row level security;
revoke all on table public.portal_runtime_kill_switches from public,anon,authenticated,service_role;

create table public.portal_runtime_kill_switch_events (
  id app.uuid_v7 primary key,
  tenant_id app.uuid_v7 not null references public.tenants(id) on delete restrict,
  kill_switch_id app.uuid_v7 not null references public.portal_runtime_kill_switches(id) on delete restrict,
  actor_id app.uuid_v7 not null,
  enabled boolean not null,
  reason_code text not null,
  recorded_at timestamptz not null default now(),
  foreign key (tenant_id,actor_id) references public.user_tenant_memberships(tenant_id,actor_id) on delete restrict,
  constraint portal_runtime_kill_switch_events_reason_chk check (reason_code ~ '^[a-z][a-z0-9_]{2,79}$')
);
alter table public.portal_runtime_kill_switch_events enable row level security;
alter table public.portal_runtime_kill_switch_events force row level security;
revoke all on table public.portal_runtime_kill_switch_events from public,anon,authenticated,service_role;

create table public.portal_runtime_channel_bindings (
  id app.uuid_v7 primary key,
  tenant_id app.uuid_v7 not null references public.tenants(id) on delete restrict,
  session_id app.uuid_v7 not null,
  agent_id app.uuid_v7 not null,
  actor_id app.uuid_v7 not null,
  presenter_id app.uuid_v7 not null,
  channel_kind text not null,
  capabilities text[] not null default '{}',
  command_fingerprint text not null,
  disclosure_id app.uuid_v7 not null,
  essential_consent_id app.uuid_v7 not null,
  generation integer not null default 0,
  state text not null default 'issued',
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null default (now()+interval '5 minutes'),
  foreign key (tenant_id,session_id) references public.sessions(tenant_id,id) on delete restrict,
  foreign key (tenant_id,agent_id) references public.agents(tenant_id,id) on delete restrict,
  foreign key (tenant_id,actor_id) references public.user_tenant_memberships(tenant_id,actor_id) on delete restrict,
  foreign key (tenant_id,session_id,presenter_id) references public.session_participants(tenant_id,session_id,id) on delete restrict,
  foreign key (tenant_id,disclosure_id) references public.disclosure_records(tenant_id,id) on delete restrict,
  foreign key (tenant_id,essential_consent_id) references public.consent_evidence(tenant_id,id) on delete restrict,
  unique (tenant_id,id),
  unique (tenant_id,session_id,command_fingerprint),
  constraint portal_runtime_channel_bindings_channel_chk check (channel_kind in ('tavus_video','recall_meeting')),
  constraint portal_runtime_channel_bindings_capabilities_chk check (app.portal_runtime_capabilities_valid(capabilities)),
  constraint portal_runtime_channel_bindings_command_chk check (command_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint portal_runtime_channel_bindings_generation_chk check (generation between 0 and 10000000),
  constraint portal_runtime_channel_bindings_state_chk check (state in ('issued','blocked','expired')),
  constraint portal_runtime_channel_bindings_expiry_chk check (expires_at>issued_at and expires_at<=issued_at+interval '5 minutes')
);
create index portal_runtime_channel_bindings_lookup_idx on public.portal_runtime_channel_bindings(tenant_id,agent_id,channel_kind,state,expires_at);
alter table public.portal_runtime_channel_bindings enable row level security;
alter table public.portal_runtime_channel_bindings force row level security;
revoke all on table public.portal_runtime_channel_bindings from public,anon,authenticated,service_role;

create table public.portal_runtime_channel_dispatches (
  binding_id app.uuid_v7 not null,
  tenant_id app.uuid_v7 not null,
  consumer_kind text not null,
  state text not null default 'consumed',
  consumed_at timestamptz not null default now(),
  primary key (tenant_id,binding_id,consumer_kind),
  foreign key (tenant_id,binding_id) references public.portal_runtime_channel_bindings(tenant_id,id) on delete restrict,
  constraint portal_runtime_channel_dispatches_consumer_chk check (consumer_kind in ('tavus','recall','scene')),
  constraint portal_runtime_channel_dispatches_state_chk check (state='consumed')
);
alter table public.portal_runtime_channel_dispatches enable row level security;
alter table public.portal_runtime_channel_dispatches force row level security;
revoke all on table public.portal_runtime_channel_dispatches from public,anon,authenticated,service_role;

create table public.portal_runtime_provider_channel_receipts (
  id app.uuid_v7 primary key,
  tenant_id app.uuid_v7 not null references public.tenants(id) on delete restrict,
  binding_id app.uuid_v7 not null,
  reservation_id app.uuid_v7 not null,
  provider_id text not null,
  provider_ref text not null,
  provider_url text,
  recorded_at timestamptz not null default now(),
  foreign key (tenant_id,binding_id) references public.portal_runtime_channel_bindings(tenant_id,id) on delete restrict,
  foreign key (tenant_id,reservation_id) references public.provider_effect_reservations(tenant_id,id) on delete restrict,
  unique (tenant_id,binding_id,provider_id),
  unique (tenant_id,reservation_id),
  constraint portal_runtime_provider_channel_receipts_provider_chk check (provider_id in ('tavus','recall')),
  constraint portal_runtime_provider_channel_receipts_ref_chk check (provider_ref ~ '^[A-Za-z0-9][A-Za-z0-9:._/-]{1,254}$'),
  constraint portal_runtime_provider_channel_receipts_url_chk check (provider_url is null or (char_length(provider_url)<=2000 and provider_url ~ '^https://'))
);
alter table public.portal_runtime_provider_channel_receipts enable row level security;
alter table public.portal_runtime_provider_channel_receipts force row level security;
revoke all on table public.portal_runtime_provider_channel_receipts from public,anon,authenticated,service_role;

create table public.portal_runtime_scene_execution_receipts (
  id app.uuid_v7 primary key,
  tenant_id app.uuid_v7 not null references public.tenants(id) on delete restrict,
  binding_id app.uuid_v7 not null,
  scene_id text not null,
  manifest_id text not null,
  generation integer not null,
  outcome text not null,
  effect_hash text,
  recorded_at timestamptz not null default now(),
  foreign key (tenant_id,binding_id) references public.portal_runtime_channel_bindings(tenant_id,id) on delete restrict,
  unique (tenant_id,binding_id,scene_id,manifest_id,generation),
  constraint portal_runtime_scene_execution_receipts_scene_chk check (scene_id ~ '^[a-z][a-z0-9._-]{2,119}$' and manifest_id ~ '^[a-z][a-z0-9._-]{2,119}$'),
  constraint portal_runtime_scene_execution_receipts_generation_chk check (generation between 0 and 10000000),
  constraint portal_runtime_scene_execution_receipts_outcome_chk check (outcome in ('succeeded','rejected_stale_generation','rejected_policy','failed')),
  constraint portal_runtime_scene_execution_receipts_hash_chk check (effect_hash is null or effect_hash ~ '^[0-9a-f]{64}$')
);
alter table public.portal_runtime_scene_execution_receipts enable row level security;
alter table public.portal_runtime_scene_execution_receipts force row level security;
revoke all on table public.portal_runtime_scene_execution_receipts from public,anon,authenticated,service_role;

create table public.portal_runtime_operator_approvals (
  id app.uuid_v7 primary key,
  tenant_id app.uuid_v7 not null references public.tenants(id) on delete restrict,
  reservation_id app.uuid_v7 not null,
  evidence_fingerprint text not null,
  operator_actor_id app.uuid_v7 not null,
  recorded_at timestamptz not null default now(),
  foreign key (tenant_id,reservation_id) references public.provider_effect_reservations(tenant_id,id) on delete restrict,
  foreign key (tenant_id,operator_actor_id) references public.user_tenant_memberships(tenant_id,actor_id) on delete restrict,
  unique (tenant_id,reservation_id,evidence_fingerprint,operator_actor_id),
  constraint portal_runtime_operator_approvals_evidence_chk check (evidence_fingerprint ~ '^[0-9a-f]{64}$')
);
alter table public.portal_runtime_operator_approvals enable row level security;
alter table public.portal_runtime_operator_approvals force row level security;
revoke all on table public.portal_runtime_operator_approvals from public,anon,authenticated,service_role;

create table public.portal_runtime_operator_reconciliation_receipts (
  id app.uuid_v7 primary key,
  tenant_id app.uuid_v7 not null references public.tenants(id) on delete restrict,
  reservation_id app.uuid_v7 not null,
  evidence_fingerprint text not null,
  outcome text not null,
  recorded_at timestamptz not null default now(),
  foreign key (tenant_id,reservation_id) references public.provider_effect_reservations(tenant_id,id) on delete restrict,
  unique (tenant_id,reservation_id,evidence_fingerprint),
  constraint portal_runtime_operator_reconciliation_receipts_evidence_chk check (evidence_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint portal_runtime_operator_reconciliation_receipts_outcome_chk check (outcome in ('released_after_reconciliation','compensation_confirmed'))
);
alter table public.portal_runtime_operator_reconciliation_receipts enable row level security;
alter table public.portal_runtime_operator_reconciliation_receipts force row level security;
revoke all on table public.portal_runtime_operator_reconciliation_receipts from public,anon,authenticated,service_role;

create or replace function app.portal_runtime_switch_disabled(p_tenant_id app.uuid_v7,p_agent_id app.uuid_v7,p_channel_kind text,p_capability text)
returns boolean language sql stable set search_path='public' as $$
  select exists(
    select 1 from public.portal_runtime_kill_switches s
    where s.tenant_id=p_tenant_id and s.enabled=false
      and (s.agent_id is null or s.agent_id=p_agent_id)
      and (s.channel_kind is null or s.channel_kind=p_channel_kind)
      and (s.capability is null or s.capability=p_capability)
  )
$$;

create or replace function public.portal_set_runtime_kill_switch_service(
  p_id app.uuid_v7,p_tenant_id app.uuid_v7,p_actor_id app.uuid_v7,p_agent_id app.uuid_v7 default null,
  p_channel_kind text default null,p_capability text default null,p_enabled boolean default false,p_reason_code text default null
) returns boolean language plpgsql security definer set search_path='public' as $$
declare v_existing_id app.uuid_v7;
begin
  if p_reason_code is null or p_reason_code !~ '^[a-z][a-z0-9_]{2,79}$' then raise exception 'invalid runtime kill switch reason' using errcode='22023'; end if;
  if exists(select 1 from public.portal_runtime_kill_switch_events where id=p_id) then return true; end if;
  if not exists(select 1 from public.user_tenant_memberships where tenant_id=p_tenant_id and actor_id=p_actor_id and role='tenant_admin') then raise exception 'runtime kill switch requires tenant admin' using errcode='42501'; end if;
  if p_agent_id is not null and not exists(select 1 from public.agents where tenant_id=p_tenant_id and id=p_agent_id) then raise exception 'agent not found for tenant' using errcode='42501'; end if;
  select id into v_existing_id from public.portal_runtime_kill_switches
    where tenant_id=p_tenant_id and agent_id is not distinct from p_agent_id and channel_kind is not distinct from p_channel_kind and capability is not distinct from p_capability
    for update;
  if found then
    update public.portal_runtime_kill_switches set enabled=p_enabled,changed_by_actor_id=p_actor_id,reason_code=p_reason_code,changed_at=now() where id=v_existing_id;
  else
    insert into public.portal_runtime_kill_switches(id,tenant_id,agent_id,channel_kind,capability,enabled,changed_by_actor_id,reason_code)
    values(p_id,p_tenant_id,p_agent_id,p_channel_kind,p_capability,p_enabled,p_actor_id,p_reason_code);
  end if;
  insert into public.portal_runtime_kill_switch_events(id,tenant_id,kill_switch_id,actor_id,enabled,reason_code)
  values(p_id,p_tenant_id,coalesce(v_existing_id,p_id),p_actor_id,p_enabled,p_reason_code);
  return true;
end $$;

create or replace function public.portal_admit_runtime_channel_service(
  p_admission_id app.uuid_v7,p_tenant_id app.uuid_v7,p_actor_id app.uuid_v7,p_agent_id app.uuid_v7,
  p_session_id app.uuid_v7,p_presenter_id app.uuid_v7,p_channel_kind text,p_capabilities text[],p_command_fingerprint text,p_generation integer,
  p_disclosure_id app.uuid_v7,p_disclosure_version text,p_disclosure_hash text,p_disclosure_channel text,p_disclosure_language text,
  p_essential_consent jsonb,p_optional_consents jsonb default '[]'::jsonb
) returns jsonb language plpgsql security definer set search_path='public' as $$
declare v_binding public.portal_runtime_channel_bindings%rowtype; v_agent public.agents%rowtype; v_optional jsonb; v_capability text; v_expected_consent text;
begin
  if p_channel_kind not in ('tavus_video','recall_meeting') or p_command_fingerprint !~ '^[0-9a-f]{64}$' or p_generation not between 0 and 10000000 then raise exception 'invalid runtime admission' using errcode='22023'; end if;
  if p_capabilities is null or cardinality(p_capabilities)>5 or not (p_capabilities <@ array['recording','persistent_transcription','behavioral_analysis','visual_analysis','scene_presentation']::text[]) or cardinality(p_capabilities)<>(select count(distinct value) from unnest(p_capabilities) value) then raise exception 'invalid runtime capabilities' using errcode='22023'; end if;
  if p_disclosure_version is null or char_length(p_disclosure_version) not between 1 and 100 or p_disclosure_hash !~ '^[0-9a-f]{64}$' or p_disclosure_channel not in ('spoken','visual','chat') or p_disclosure_language !~ '^[a-z]{2}(-[A-Z]{2})?$' then raise exception 'invalid disclosure confirmation' using errcode='22023'; end if;
  if jsonb_typeof(p_essential_consent) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_essential_consent))<>5 or not (p_essential_consent ?& array['id','subjectRef','jurisdiction','evidenceHash','method']) or jsonb_typeof(p_optional_consents) is distinct from 'array' then raise exception 'invalid consent confirmation' using errcode='22023'; end if;
  if not exists(select 1 from public.user_tenant_memberships where tenant_id=p_tenant_id and actor_id=p_actor_id) then raise exception 'runtime actor is not a tenant member' using errcode='42501'; end if;
  select * into v_binding from public.portal_runtime_channel_bindings where tenant_id=p_tenant_id and id=p_admission_id for update;
  if found then
    if row(v_binding.actor_id,v_binding.agent_id,v_binding.session_id,v_binding.presenter_id,v_binding.channel_kind,v_binding.capabilities,v_binding.command_fingerprint,v_binding.generation,v_binding.disclosure_id,v_binding.essential_consent_id)
       is distinct from row(p_actor_id,p_agent_id,p_session_id,p_presenter_id,p_channel_kind,p_capabilities,p_command_fingerprint,p_generation,p_disclosure_id,(p_essential_consent->>'id')::app.uuid_v7) then raise exception 'runtime admission replay conflict' using errcode='23505'; end if;
    return jsonb_build_object('outcome',case when v_binding.expires_at<=now() then 'expired' else 'replayed' end,'grantId',v_binding.id,'sessionId',v_binding.session_id,'generation',v_binding.generation,'expiresAt',v_binding.expires_at);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('runtime-admission-session:'||p_session_id::text,0));
  if app.portal_runtime_switch_disabled(p_tenant_id,p_agent_id,p_channel_kind,'channel_admission') then return jsonb_build_object('outcome','blocked_kill_switch'); end if;
  select * into v_agent from public.agents where tenant_id=p_tenant_id and id=p_agent_id; if not found then raise exception 'agent not found for tenant' using errcode='42501'; end if;
  if v_agent.status<>'active' then return jsonb_build_object('outcome','blocked_agent_inactive'); end if;
  if not exists(select 1 from public.sessions where tenant_id=p_tenant_id and id=p_session_id) then
    insert into public.sessions(tenant_id,id,agent_id,role_pack_id,role_pack_version,channel_type,status,active_presenter_id,disclosure_status,consent_status)
    values(p_tenant_id,p_session_id,p_agent_id,v_agent.role_type,'portal-runtime-v43',case when p_channel_kind='tavus_video' then 'web_widget' else 'api' end,'ready',null,'pending','pending');
  elsif not exists(select 1 from public.sessions where tenant_id=p_tenant_id and id=p_session_id and agent_id=p_agent_id and status in ('preparing','ready','active','handoff_pending')) then
    raise exception 'runtime session mismatch or terminal' using errcode='42501';
  end if;
  if not exists(select 1 from public.session_participants where tenant_id=p_tenant_id and session_id=p_session_id and id=p_presenter_id) then
    insert into public.session_participants(tenant_id,id,session_id,participant_type,display_name,joined_at) values(p_tenant_id,p_presenter_id,p_session_id,'digital_presenter',v_agent.name,now());
  elsif not exists(select 1 from public.session_participants where tenant_id=p_tenant_id and session_id=p_session_id and id=p_presenter_id and participant_type='digital_presenter') then
    raise exception 'runtime presenter mismatch' using errcode='42501';
  end if;
  if exists(select 1 from public.sessions where tenant_id=p_tenant_id and id=p_session_id and active_presenter_id is not null and active_presenter_id<>p_presenter_id) then return jsonb_build_object('outcome','one_mouth_conflict'); end if;
  if (p_essential_consent->>'id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' or p_essential_consent->>'subjectRef' is null or char_length(p_essential_consent->>'subjectRef') not between 1 and 300 or p_essential_consent->>'jurisdiction' is null or char_length(p_essential_consent->>'jurisdiction') not between 2 and 120 or p_essential_consent->>'evidenceHash' !~ '^[0-9a-f]{64}$' or p_essential_consent->>'method' not in ('spoken','click','written','signed','system_import') then raise exception 'invalid essential consent evidence' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(p_optional_consents) x where jsonb_typeof(x)<>'object' or (select count(*) from jsonb_object_keys(x))<>6 or not(x ?& array['id','capability','subjectRef','jurisdiction','evidenceHash','method'])) then raise exception 'invalid optional consent evidence' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(p_optional_consents) x where x->>'capability' not in ('recording','persistent_transcription','behavioral_analysis','visual_analysis') or not (x->>'capability'=any(p_capabilities)) or x->>'id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' or x->>'subjectRef' is null or char_length(x->>'subjectRef') not between 1 and 300 or x->>'jurisdiction' is null or char_length(x->>'jurisdiction') not between 2 and 120 or x->>'evidenceHash' !~ '^[0-9a-f]{64}$' or x->>'method' not in ('spoken','click','written','signed','system_import')) then raise exception 'optional consent does not authorize requested capability' using errcode='42501'; end if;
  if (select count(*) from jsonb_array_elements(p_optional_consents)) <> (select count(*) from unnest(p_capabilities) capability where capability<>'scene_presentation') or (select count(distinct x->>'capability') from jsonb_array_elements(p_optional_consents) x) <> (select count(*) from jsonb_array_elements(p_optional_consents)) then raise exception 'required purpose evidence missing or duplicated' using errcode='42501'; end if;
  insert into public.disclosure_records(tenant_id,id,session_id,disclosure_type,version,content_hash,delivery_channel,language,delivered_at,acknowledged) values(p_tenant_id,p_disclosure_id,p_session_id,'ai_identity',p_disclosure_version,p_disclosure_hash,p_disclosure_channel,p_disclosure_language,now(),false);
  insert into public.consent_evidence(tenant_id,id,session_id,subject_ref,consent_type,purpose,status,method,jurisdiction,disclosure_version,evidence_hash,captured_at) values(p_tenant_id,(p_essential_consent->>'id')::app.uuid_v7,p_session_id,p_essential_consent->>'subjectRef','essential_processing','runtime_channel_admission','granted',p_essential_consent->>'method',p_essential_consent->>'jurisdiction',p_disclosure_version,p_essential_consent->>'evidenceHash',now());
  for v_optional in select * from jsonb_array_elements(p_optional_consents) loop
    v_capability:=v_optional->>'capability'; v_expected_consent:=case v_capability when 'recording' then 'recording' when 'persistent_transcription' then 'persistent_transcription' when 'behavioral_analysis' then 'behavioral_analysis' else 'visual_analysis' end;
    insert into public.consent_evidence(tenant_id,id,session_id,subject_ref,consent_type,purpose,status,method,jurisdiction,disclosure_version,evidence_hash,captured_at) values(p_tenant_id,(v_optional->>'id')::app.uuid_v7,p_session_id,v_optional->>'subjectRef',v_expected_consent,v_capability,'granted',v_optional->>'method',v_optional->>'jurisdiction',p_disclosure_version,v_optional->>'evidenceHash',now());
  end loop;
  update public.sessions set active_presenter_id=p_presenter_id,disclosure_status='delivered',consent_status='granted',updated_at=now() where tenant_id=p_tenant_id and id=p_session_id;
  insert into public.portal_runtime_channel_bindings(id,tenant_id,session_id,agent_id,actor_id,presenter_id,channel_kind,capabilities,command_fingerprint,disclosure_id,essential_consent_id,generation) values(p_admission_id,p_tenant_id,p_session_id,p_agent_id,p_actor_id,p_presenter_id,p_channel_kind,p_capabilities,p_command_fingerprint,p_disclosure_id,(p_essential_consent->>'id')::app.uuid_v7,p_generation);
  return jsonb_build_object('outcome','issued','grantId',p_admission_id,'sessionId',p_session_id,'generation',p_generation,'expiresAt',now()+interval '5 minutes');
end $$;

create or replace function public.portal_consume_runtime_channel_grant_service(p_grant_id app.uuid_v7,p_command_fingerprint text,p_consumer_kind text)
returns jsonb language plpgsql security definer set search_path='public' as $$
declare v_binding public.portal_runtime_channel_bindings%rowtype; v_capability text;
begin
  if p_command_fingerprint !~ '^[0-9a-f]{64}$' or p_consumer_kind not in ('tavus','recall','scene') then raise exception 'invalid runtime grant consume' using errcode='22023'; end if;
  select * into v_binding from public.portal_runtime_channel_bindings where id=p_grant_id for update; if not found or v_binding.command_fingerprint<>p_command_fingerprint then return jsonb_build_object('outcome','rejected'); end if;
  v_capability:=case when p_consumer_kind='scene' then 'scene_publish' else 'provider_dispatch' end;
  if v_binding.state<>'issued' or v_binding.expires_at<=now() or app.portal_runtime_switch_disabled(v_binding.tenant_id,v_binding.agent_id,v_binding.channel_kind,v_capability) or (p_consumer_kind='scene' and not('scene_presentation'=any(v_binding.capabilities))) then return jsonb_build_object('outcome','blocked','grantId',v_binding.id); end if;
  insert into public.portal_runtime_channel_dispatches(tenant_id,binding_id,consumer_kind) values(v_binding.tenant_id,v_binding.id,p_consumer_kind) on conflict do nothing;
  return jsonb_build_object('outcome',case when found then 'acquired' else 'replayed' end,'grantId',v_binding.id,'sessionId',v_binding.session_id,'generation',v_binding.generation,'consumerKind',p_consumer_kind);
end $$;

create or replace function public.portal_bind_runtime_provider_channel_service(p_receipt_id app.uuid_v7,p_grant_id app.uuid_v7,p_reservation_id app.uuid_v7,p_provider_id text,p_provider_ref text,p_provider_url text default null)
returns boolean language plpgsql security definer set search_path='public' as $$
declare v_binding public.portal_runtime_channel_bindings%rowtype; v_receipt public.portal_runtime_provider_channel_receipts%rowtype;
begin
  if p_provider_id not in ('tavus','recall') or p_provider_ref !~ '^[A-Za-z0-9][A-Za-z0-9:._/-]{1,254}$' then raise exception 'invalid provider channel receipt' using errcode='22023'; end if;
  select * into v_binding from public.portal_runtime_channel_bindings where id=p_grant_id for update; if not found then return false; end if;
  if app.portal_runtime_switch_disabled(v_binding.tenant_id,v_binding.agent_id,v_binding.channel_kind,'provider_dispatch') or not exists(select 1 from public.portal_runtime_channel_dispatches where tenant_id=v_binding.tenant_id and binding_id=v_binding.id and consumer_kind=p_provider_id) then return false; end if;
  if not exists(select 1 from public.provider_effect_reservations where tenant_id=v_binding.tenant_id and id=p_reservation_id and agent_id=v_binding.agent_id and provider_id=p_provider_id and state in ('committed','completed','cleanup_pending','unknown')) then return false; end if;
  select * into v_receipt from public.portal_runtime_provider_channel_receipts where tenant_id=v_binding.tenant_id and reservation_id=p_reservation_id; if found then return v_receipt.binding_id=v_binding.id and v_receipt.provider_id=p_provider_id and v_receipt.provider_ref=p_provider_ref and v_receipt.provider_url is not distinct from p_provider_url; end if;
  insert into public.portal_runtime_provider_channel_receipts(id,tenant_id,binding_id,reservation_id,provider_id,provider_ref,provider_url) values(p_receipt_id,v_binding.tenant_id,v_binding.id,p_reservation_id,p_provider_id,p_provider_ref,p_provider_url);
  return true;
end $$;

create or replace function public.portal_execute_runtime_scene_service(p_receipt_id app.uuid_v7,p_grant_id app.uuid_v7,p_scene_id text,p_manifest_id text,p_generation integer,p_outcome text,p_effect_hash text default null)
returns boolean language plpgsql security definer set search_path='public' as $$
declare v_binding public.portal_runtime_channel_bindings%rowtype;
begin
  select * into v_binding from public.portal_runtime_channel_bindings where id=p_grant_id for update; if not found then return false; end if;
  if not exists(select 1 from public.portal_runtime_channel_dispatches where tenant_id=v_binding.tenant_id and binding_id=v_binding.id and consumer_kind='scene') or app.portal_runtime_switch_disabled(v_binding.tenant_id,v_binding.agent_id,v_binding.channel_kind,'scene_publish') then return false; end if;
  if p_generation<>v_binding.generation then p_outcome:='rejected_stale_generation'; p_effect_hash:=null; end if;
  if p_outcome not in ('succeeded','rejected_stale_generation','rejected_policy','failed') or (p_outcome='succeeded' and p_effect_hash !~ '^[0-9a-f]{64}$') or (p_outcome<>'succeeded' and p_effect_hash is not null) then raise exception 'invalid scene execution receipt' using errcode='22023'; end if;
  insert into public.portal_runtime_scene_execution_receipts(id,tenant_id,binding_id,scene_id,manifest_id,generation,outcome,effect_hash) values(p_receipt_id,v_binding.tenant_id,v_binding.id,p_scene_id,p_manifest_id,p_generation,p_outcome,p_effect_hash) on conflict(tenant_id,binding_id,scene_id,manifest_id,generation) do nothing;
  return found;
end $$;

create or replace function public.portal_runtime_channel_status_service(p_tenant_id app.uuid_v7,p_agent_id app.uuid_v7,p_channel_kind text,p_capability text)
returns jsonb language plpgsql stable security definer set search_path='public' as $$
begin
  if p_channel_kind not in ('tavus_video','recall_meeting') or p_capability not in ('channel_admission','provider_dispatch','scene_publish') or not exists(select 1 from public.agents where tenant_id=p_tenant_id and id=p_agent_id) then return jsonb_build_object('enabled',false); end if;
  return jsonb_build_object('enabled',not app.portal_runtime_switch_disabled(p_tenant_id,p_agent_id,p_channel_kind,p_capability),'capability',p_capability);
end $$;

-- A signed Recall callback is allowed to create the delayed Tavus camera only
-- when the Recall bot is already durably bound to a runtime session. The
-- complete grant shape is returned solely to the service-role webhook so it
-- can claim the separate `tavus` consumer fence immediately before dispatch.
create or replace function public.portal_get_sentinel_attach_service(p_recall_bot_id text)
returns jsonb language sql stable security definer set search_path='public' as $$
  select case when s.recall_bot_id is null then jsonb_build_object('outcome','not_found')
    when s.status in ('ended','failed') then jsonb_build_object('outcome','terminal')
    else jsonb_strip_nulls(jsonb_build_object(
      'outcome','ready','tenantId',s.tenant_id,'agentId',s.agent_id,'state',s.sentinel_camera_state,
      'reservationId',s.tavus_reservation_id,'conversationId',s.tavus_conversation_id,'conversationUrl',r.provider_url,
      'billableOverage',coalesce(r.billable_overage,false),'customerDeliveryState',coalesce(r.customer_delivery_state,'held'),
      'recallReservationId',s.recall_reservation_id,'recallCustomerDeliveryState',coalesce(rr.customer_delivery_state,'held'),
      'runtimeGrantId',b.id,'runtimeSessionId',b.session_id,'runtimePresenterId',b.presenter_id,'runtimeGeneration',b.generation,
      'runtimeCommandFingerprint',b.command_fingerprint,'runtimeCapabilities',b.capabilities,'runtimeChannel',b.channel_kind
    )) end
  from (values(1)) seed(n)
  left join public.meeting_bot_sessions s on s.recall_bot_id=p_recall_bot_id
  left join public.provider_effect_reservations r on r.tenant_id=s.tenant_id and r.id=s.tavus_reservation_id
  left join public.provider_effect_reservations rr on rr.tenant_id=s.tenant_id and rr.id=s.recall_reservation_id
  left join public.portal_runtime_provider_channel_receipts pr on pr.tenant_id=s.tenant_id and pr.provider_id='recall' and pr.provider_ref=s.recall_bot_id
  left join public.portal_runtime_channel_bindings b on b.tenant_id=pr.tenant_id and b.id=pr.binding_id
$$;

create or replace function public.portal_record_runtime_operator_approval_service(p_approval_id app.uuid_v7,p_tenant_id app.uuid_v7,p_reservation_id app.uuid_v7,p_evidence_fingerprint text,p_operator_actor_id app.uuid_v7)
returns integer language plpgsql security definer set search_path='public' as $$
declare v_count integer;
begin
  if p_evidence_fingerprint !~ '^[0-9a-f]{64}$' or not exists(select 1 from public.user_tenant_memberships where tenant_id=p_tenant_id and actor_id=p_operator_actor_id and role='tenant_admin') then raise exception 'invalid operator approval' using errcode='42501'; end if;
  if not exists(select 1 from public.provider_effect_reservations where tenant_id=p_tenant_id and id=p_reservation_id and state in ('unknown','cleanup_pending','provider_in_flight')) then return 0; end if;
  insert into public.portal_runtime_operator_approvals(id,tenant_id,reservation_id,evidence_fingerprint,operator_actor_id) values(p_approval_id,p_tenant_id,p_reservation_id,p_evidence_fingerprint,p_operator_actor_id) on conflict do nothing;
  select count(*) into v_count from public.portal_runtime_operator_approvals where tenant_id=p_tenant_id and reservation_id=p_reservation_id and evidence_fingerprint=p_evidence_fingerprint;
  return v_count;
end $$;

create or replace function public.portal_reconcile_runtime_provider_effect_service(p_receipt_id app.uuid_v7,p_tenant_id app.uuid_v7,p_reservation_id app.uuid_v7,p_evidence_fingerprint text,p_outcome text)
returns boolean language plpgsql security definer set search_path='public' as $$
declare v_count integer; v_evidence text;
begin
  if p_evidence_fingerprint !~ '^[0-9a-f]{64}$' or p_outcome not in ('released_after_reconciliation','compensation_confirmed') then raise exception 'invalid runtime reconciliation receipt' using errcode='22023'; end if;
  select count(distinct operator_actor_id) into v_count from public.portal_runtime_operator_approvals where tenant_id=p_tenant_id and reservation_id=p_reservation_id and evidence_fingerprint=p_evidence_fingerprint;
  if v_count<2 then return false; end if;
  if exists(select 1 from public.portal_runtime_operator_reconciliation_receipts where tenant_id=p_tenant_id and reservation_id=p_reservation_id and evidence_fingerprint=p_evidence_fingerprint) then return true; end if;
  v_evidence:=case when p_outcome='compensation_confirmed' then 'compensation_confirmed' else 'reconciliation_absent' end;
  if not public.portal_reconcile_provider_effect_service(p_receipt_id,p_reservation_id,v_evidence,'operator:'||p_evidence_fingerprint) then return false; end if;
  insert into public.portal_runtime_operator_reconciliation_receipts(id,tenant_id,reservation_id,evidence_fingerprint,outcome) values(p_receipt_id,p_tenant_id,p_reservation_id,p_evidence_fingerprint,p_outcome);
  return true;
end $$;

revoke all on function public.portal_set_runtime_kill_switch_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,boolean,text) from public,anon,authenticated;
revoke all on function public.portal_admit_runtime_channel_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text[],text,integer,app.uuid_v7,text,text,text,text,jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.portal_consume_runtime_channel_grant_service(app.uuid_v7,text,text) from public,anon,authenticated;
revoke all on function public.portal_bind_runtime_provider_channel_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,text) from public,anon,authenticated;
revoke all on function public.portal_execute_runtime_scene_service(app.uuid_v7,app.uuid_v7,text,text,integer,text,text) from public,anon,authenticated;
revoke all on function public.portal_runtime_channel_status_service(app.uuid_v7,app.uuid_v7,text,text) from public,anon,authenticated;
revoke all on function public.portal_record_runtime_operator_approval_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text,app.uuid_v7) from public,anon,authenticated;
revoke all on function public.portal_reconcile_runtime_provider_effect_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text) from public,anon,authenticated;
grant execute on function public.portal_set_runtime_kill_switch_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,boolean,text) to service_role;
grant execute on function public.portal_admit_runtime_channel_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text[],text,integer,app.uuid_v7,text,text,text,text,jsonb,jsonb) to service_role;
grant execute on function public.portal_consume_runtime_channel_grant_service(app.uuid_v7,text,text) to service_role;
grant execute on function public.portal_bind_runtime_provider_channel_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,text) to service_role;
grant execute on function public.portal_execute_runtime_scene_service(app.uuid_v7,app.uuid_v7,text,text,integer,text,text) to service_role;
grant execute on function public.portal_runtime_channel_status_service(app.uuid_v7,app.uuid_v7,text,text) to service_role;
grant execute on function public.portal_record_runtime_operator_approval_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text,app.uuid_v7) to service_role;
grant execute on function public.portal_reconcile_runtime_provider_effect_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text) to service_role;

create or replace function public.portal_schema_capabilities_service()
returns jsonb language sql stable security definer set search_path='public' as $$
  select jsonb_build_object(
    'version',43,
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
    'runtimeDualOperatorReconciliation',to_regclass('public.portal_runtime_operator_reconciliation_receipts') is not null and to_regprocedure('public.portal_reconcile_runtime_provider_effect_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text)') is not null
  )
$$;
revoke all on function public.portal_schema_capabilities_service() from public,anon,authenticated;
grant execute on function public.portal_schema_capabilities_service() to service_role;

commit;
