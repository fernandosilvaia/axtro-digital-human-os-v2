-- ADR-039 wave 1a: business-action admission foundation. Kill switches,
-- per-agent auto_confirm_scheduling storage, the BusinessActionIntent grant
-- and register_lead only. propose_meeting_slots/confirm_meeting_slot, the
-- calendar proposal/reservation/connection tables and every Google Calendar
-- RPC listed in ADR-039 "Migração 0051" (renumbered: production reached v50 via an unrelated concurrent migration before this one merged) are wave 1b and deliberately absent
-- from this file. Structurally independent of 0043/0044: no table or
-- function here references portal_runtime_* (ADR-039 "PORTAL_BUSINESS_ACTION_BRIDGE_ENABLED,
-- um flag novo e independente").
begin;

create table public.portal_business_action_kill_switches (
  id app.uuid_v7 primary key,
  tenant_id app.uuid_v7 not null references public.tenants(id) on delete restrict,
  agent_id app.uuid_v7,
  action_kind text,
  enabled boolean not null default false,
  changed_by_actor_id app.uuid_v7 not null,
  reason_code text not null,
  changed_at timestamptz not null default now(),
  foreign key (tenant_id,agent_id) references public.agents(tenant_id,id) on delete restrict,
  foreign key (tenant_id,changed_by_actor_id) references public.user_tenant_memberships(tenant_id,actor_id) on delete restrict,
  unique (tenant_id,id),
  constraint portal_business_action_kill_switches_action_chk check (action_kind is null or action_kind in ('register_lead')),
  constraint portal_business_action_kill_switches_reason_chk check (reason_code ~ '^[a-z][a-z0-9_]{2,79}$')
);
create unique index portal_business_action_kill_switches_scope_uidx
  on public.portal_business_action_kill_switches(tenant_id,coalesce(agent_id::text,''),coalesce(action_kind,''));
alter table public.portal_business_action_kill_switches enable row level security;
alter table public.portal_business_action_kill_switches force row level security;
revoke all on table public.portal_business_action_kill_switches from public,anon,authenticated,service_role;

-- Composite tenant FK from the start (0043 shipped without it and needed the
-- forward-only 0044 repair; no reason to repeat that gap here).
create table public.portal_business_action_kill_switch_events (
  id app.uuid_v7 primary key,
  tenant_id app.uuid_v7 not null references public.tenants(id) on delete restrict,
  kill_switch_id app.uuid_v7 not null,
  actor_id app.uuid_v7 not null,
  enabled boolean not null,
  reason_code text not null,
  recorded_at timestamptz not null default now(),
  foreign key (tenant_id,kill_switch_id) references public.portal_business_action_kill_switches(tenant_id,id) on delete restrict,
  foreign key (tenant_id,actor_id) references public.user_tenant_memberships(tenant_id,actor_id) on delete restrict,
  constraint portal_business_action_kill_switch_events_reason_chk check (reason_code ~ '^[a-z][a-z0-9_]{2,79}$')
);
alter table public.portal_business_action_kill_switch_events enable row level security;
alter table public.portal_business_action_kill_switch_events force row level security;
revoke all on table public.portal_business_action_kill_switch_events from public,anon,authenticated,service_role;

create table public.portal_business_action_agent_settings (
  tenant_id app.uuid_v7 not null references public.tenants(id) on delete restrict,
  agent_id app.uuid_v7 not null,
  auto_confirm_scheduling boolean not null default false,
  changed_by_actor_id app.uuid_v7 not null,
  changed_at timestamptz not null default now(),
  primary key (tenant_id,agent_id),
  foreign key (tenant_id,agent_id) references public.agents(tenant_id,id) on delete restrict,
  foreign key (tenant_id,changed_by_actor_id) references public.user_tenant_memberships(tenant_id,actor_id) on delete restrict
);
alter table public.portal_business_action_agent_settings enable row level security;
alter table public.portal_business_action_agent_settings force row level security;
revoke all on table public.portal_business_action_agent_settings from public,anon,authenticated,service_role;

-- Admission of a BusinessActionIntent. Unlike portal_runtime_channel_bindings
-- (0043), this does not create the session, disclosure or essential-consent
-- evidence it checks: ADR-039 reuses that evidence read-only from whatever
-- already admitted the runtime channel (ADR-038). action_kind is a
-- single-value domain today (register_lead); a 1b migration extends the
-- check when propose_meeting_slots/confirm_meeting_slot land.
create table public.portal_business_action_grants (
  id app.uuid_v7 primary key,
  tenant_id app.uuid_v7 not null references public.tenants(id) on delete restrict,
  agent_id app.uuid_v7 not null,
  session_id app.uuid_v7 not null,
  presenter_id app.uuid_v7 not null,
  action_kind text not null,
  command_fingerprint text not null,
  generation integer not null default 0,
  state text not null default 'issued',
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null default (now()+interval '60 minutes'),
  foreign key (tenant_id,agent_id) references public.agents(tenant_id,id) on delete restrict,
  foreign key (tenant_id,session_id) references public.sessions(tenant_id,id) on delete restrict,
  foreign key (tenant_id,session_id,presenter_id) references public.session_participants(tenant_id,session_id,id) on delete restrict,
  unique (tenant_id,id),
  unique (tenant_id,session_id,command_fingerprint),
  constraint portal_business_action_grants_action_chk check (action_kind in ('register_lead')),
  constraint portal_business_action_grants_command_chk check (command_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint portal_business_action_grants_generation_chk check (generation between 0 and 10000000),
  constraint portal_business_action_grants_state_chk check (state in ('issued','blocked','expired')),
  constraint portal_business_action_grants_expiry_chk check (expires_at>issued_at and expires_at<=issued_at+interval '60 minutes')
);
create index portal_business_action_grants_lookup_idx on public.portal_business_action_grants(tenant_id,agent_id,action_kind,state,expires_at);
alter table public.portal_business_action_grants enable row level security;
alter table public.portal_business_action_grants force row level security;
revoke all on table public.portal_business_action_grants from public,anon,authenticated,service_role;

-- One row per grant (Art. 7's tool_execution_receipt for this domain). A
-- grant that is admitted but never executed (client abandoned the call, the
-- process crashed) never gets a receipt; a rejected admission never creates
-- a grant either (portal_admit_business_action_service returns a rejection
-- code without persisting anything, same as the kill-switch/one-mouth
-- branches of 0043's portal_admit_runtime_channel_service), so "every
-- attempt gets a receipt" holds for every attempt that reaches execution.
-- reservation_id (the calendar half of ADR-039's receipt shape) is
-- wave 1b -- no calendar reservation table exists yet in this migration for
-- it to reference, so it is not added here.
create table public.portal_business_action_receipts (
  id app.uuid_v7 primary key,
  tenant_id app.uuid_v7 not null references public.tenants(id) on delete restrict,
  grant_id app.uuid_v7 not null,
  session_id app.uuid_v7 not null,
  agent_id app.uuid_v7 not null,
  presenter_id app.uuid_v7 not null,
  action_kind text not null,
  policy_decision text not null,
  outcome text not null,
  lead_id app.uuid_v7,
  effect_hash text,
  recorded_at timestamptz not null default now(),
  foreign key (tenant_id,grant_id) references public.portal_business_action_grants(tenant_id,id) on delete restrict,
  foreign key (tenant_id,session_id) references public.sessions(tenant_id,id) on delete restrict,
  foreign key (tenant_id,agent_id) references public.agents(tenant_id,id) on delete restrict,
  foreign key (tenant_id,session_id,presenter_id) references public.session_participants(tenant_id,session_id,id) on delete restrict,
  unique (tenant_id,grant_id),
  constraint portal_business_action_receipts_action_chk check (action_kind in ('register_lead')),
  constraint portal_business_action_receipts_policy_chk check (policy_decision in ('allow','deny','require_approval')),
  constraint portal_business_action_receipts_outcome_chk check (outcome in ('succeeded','rejected','failed','unknown')),
  constraint portal_business_action_receipts_hash_chk check (effect_hash is null or effect_hash ~ '^[0-9a-f]{64}$')
);
alter table public.portal_business_action_receipts enable row level security;
alter table public.portal_business_action_receipts force row level security;
revoke all on table public.portal_business_action_receipts from public,anon,authenticated,service_role;

create table public.portal_business_action_leads (
  id app.uuid_v7 primary key,
  tenant_id app.uuid_v7 not null references public.tenants(id) on delete restrict,
  agent_id app.uuid_v7 not null,
  session_id app.uuid_v7 not null,
  contact_name text not null,
  contact_email text,
  contact_phone text,
  qualification_summary text not null default '',
  source text not null default 'video_call',
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  foreign key (tenant_id,agent_id) references public.agents(tenant_id,id) on delete restrict,
  foreign key (tenant_id,session_id) references public.sessions(tenant_id,id) on delete restrict,
  unique (tenant_id,id),
  unique (tenant_id,idempotency_key),
  constraint portal_business_action_leads_name_chk check (char_length(contact_name) between 1 and 200),
  constraint portal_business_action_leads_contact_chk check (contact_email is not null or contact_phone is not null),
  constraint portal_business_action_leads_email_chk check (contact_email is null or contact_email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  constraint portal_business_action_leads_phone_chk check (contact_phone is null or contact_phone ~ '^[0-9+()\-. ]{6,32}$'),
  constraint portal_business_action_leads_summary_chk check (char_length(qualification_summary) <= 2000),
  constraint portal_business_action_leads_source_chk check (source = 'video_call')
);
alter table public.portal_business_action_leads enable row level security;
alter table public.portal_business_action_leads force row level security;
revoke all on table public.portal_business_action_leads from public,anon,authenticated,service_role;

-- LANGUAGE SQL, not SECURITY DEFINER: it runs with the caller's own
-- privileges against portal_business_action_kill_switches, which already
-- revokes anon/authenticated/service_role directly -- same shape as
-- app.portal_runtime_switch_disabled (0043).
create or replace function app.portal_business_action_switch_disabled(p_tenant_id app.uuid_v7,p_agent_id app.uuid_v7,p_action_kind text)
returns boolean language sql stable set search_path='public' as $$
  select exists(
    select 1 from public.portal_business_action_kill_switches s
    where s.tenant_id=p_tenant_id and s.enabled=false
      and (s.agent_id is null or s.agent_id=p_agent_id)
      and (s.action_kind is null or s.action_kind=p_action_kind)
  )
$$;

create or replace function public.portal_set_business_action_kill_switch_service(
  p_id app.uuid_v7,p_tenant_id app.uuid_v7,p_actor_id app.uuid_v7,p_agent_id app.uuid_v7 default null,
  p_action_kind text default null,p_enabled boolean default false,p_reason_code text default null
) returns boolean language plpgsql security definer set search_path='public' as $$
declare v_existing_id app.uuid_v7;
begin
  if p_reason_code is null or p_reason_code !~ '^[a-z][a-z0-9_]{2,79}$' then raise exception 'invalid business action kill switch reason' using errcode='22023'; end if;
  if p_action_kind is not null and p_action_kind not in ('register_lead') then raise exception 'invalid business action kind' using errcode='22023'; end if;
  if exists(select 1 from public.portal_business_action_kill_switch_events where id=p_id) then return true; end if;
  if not exists(select 1 from public.user_tenant_memberships where tenant_id=p_tenant_id and actor_id=p_actor_id and role='tenant_admin') then raise exception 'business action kill switch requires tenant admin' using errcode='42501'; end if;
  if p_agent_id is not null and not exists(select 1 from public.agents where tenant_id=p_tenant_id and id=p_agent_id) then raise exception 'agent not found for tenant' using errcode='42501'; end if;
  select id into v_existing_id from public.portal_business_action_kill_switches
    where tenant_id=p_tenant_id and agent_id is not distinct from p_agent_id and action_kind is not distinct from p_action_kind
    for update;
  if found then
    update public.portal_business_action_kill_switches set enabled=p_enabled,changed_by_actor_id=p_actor_id,reason_code=p_reason_code,changed_at=now() where id=v_existing_id;
  else
    insert into public.portal_business_action_kill_switches(id,tenant_id,agent_id,action_kind,enabled,changed_by_actor_id,reason_code)
    values(p_id,p_tenant_id,p_agent_id,p_action_kind,p_enabled,p_actor_id,p_reason_code);
  end if;
  insert into public.portal_business_action_kill_switch_events(id,tenant_id,kill_switch_id,actor_id,enabled,reason_code)
  values(p_id,p_tenant_id,coalesce(v_existing_id,p_id),p_actor_id,p_enabled,p_reason_code);
  return true;
end $$;

create or replace function public.portal_business_action_status_service(p_tenant_id app.uuid_v7,p_agent_id app.uuid_v7,p_action_kind text)
returns jsonb language plpgsql stable security definer set search_path='public' as $$
begin
  if p_action_kind not in ('register_lead') or not exists(select 1 from public.agents where tenant_id=p_tenant_id and id=p_agent_id) then return jsonb_build_object('enabled',false); end if;
  return jsonb_build_object('enabled',not app.portal_business_action_switch_disabled(p_tenant_id,p_agent_id,p_action_kind),'actionKind',p_action_kind);
end $$;

create or replace function public.portal_set_business_action_agent_settings_service(
  p_tenant_id app.uuid_v7,p_actor_id app.uuid_v7,p_agent_id app.uuid_v7,p_auto_confirm_scheduling boolean
) returns boolean language plpgsql security definer set search_path='public' as $$
begin
  if not exists(select 1 from public.user_tenant_memberships where tenant_id=p_tenant_id and actor_id=p_actor_id and role='tenant_admin') then raise exception 'business action agent settings requires tenant admin' using errcode='42501'; end if;
  if not exists(select 1 from public.agents where tenant_id=p_tenant_id and id=p_agent_id) then raise exception 'agent not found for tenant' using errcode='42501'; end if;
  insert into public.portal_business_action_agent_settings(tenant_id,agent_id,auto_confirm_scheduling,changed_by_actor_id,changed_at)
    values(p_tenant_id,p_agent_id,p_auto_confirm_scheduling,p_actor_id,now())
  on conflict (tenant_id,agent_id) do update set auto_confirm_scheduling=excluded.auto_confirm_scheduling,changed_by_actor_id=excluded.changed_by_actor_id,changed_at=excluded.changed_at;
  return true;
end $$;

-- Reads sessions.disclosure_status/consent_status and the session's
-- lead_data_capture consent_evidence row read-only; it never writes either.
-- Both are established by whatever already admitted the runtime channel for
-- this session (ADR-038's portal_admit_runtime_channel_service) or, for
-- lead_data_capture specifically, by the pre-call consent checkbox this ADR
-- describes -- that checkbox UI lives in presentation-room.tsx, out of scope
-- for this migration.
create or replace function public.portal_admit_business_action_service(
  p_grant_id app.uuid_v7,p_tenant_id app.uuid_v7,p_agent_id app.uuid_v7,p_session_id app.uuid_v7,p_presenter_id app.uuid_v7,
  p_action_kind text,p_command_fingerprint text,p_generation integer default 0
) returns jsonb language plpgsql security definer set search_path='public' as $$
declare v_grant public.portal_business_action_grants%rowtype; v_agent public.agents%rowtype; v_session public.sessions%rowtype;
begin
  if p_action_kind not in ('register_lead') or p_command_fingerprint !~ '^[0-9a-f]{64}$' or p_generation not between 0 and 10000000 then raise exception 'invalid business action admission' using errcode='22023'; end if;
  select * into v_grant from public.portal_business_action_grants where tenant_id=p_tenant_id and id=p_grant_id for update;
  if found then
    if row(v_grant.agent_id,v_grant.session_id,v_grant.presenter_id,v_grant.action_kind,v_grant.command_fingerprint,v_grant.generation)
       is distinct from row(p_agent_id,p_session_id,p_presenter_id,p_action_kind,p_command_fingerprint,p_generation) then raise exception 'business action admission replay conflict' using errcode='23505'; end if;
    return jsonb_build_object('outcome',case when v_grant.expires_at<=now() then 'expired' else 'replayed' end,'grantId',v_grant.id,'sessionId',v_grant.session_id,'generation',v_grant.generation,'expiresAt',v_grant.expires_at);
  end if;
  select * into v_agent from public.agents where tenant_id=p_tenant_id and id=p_agent_id; if not found then raise exception 'agent not found for tenant' using errcode='42501'; end if;
  if v_agent.status<>'active' then return jsonb_build_object('outcome','agent_inactive'); end if;
  select * into v_session from public.sessions where tenant_id=p_tenant_id and id=p_session_id and agent_id=p_agent_id; if not found then raise exception 'business action session not found for tenant/agent' using errcode='42501'; end if;
  if app.portal_business_action_switch_disabled(p_tenant_id,p_agent_id,p_action_kind) then return jsonb_build_object('outcome','blocked_kill_switch'); end if;
  if v_session.active_presenter_id is distinct from p_presenter_id then return jsonb_build_object('outcome','presenter_mismatch'); end if;
  if v_session.disclosure_status<>'delivered' then return jsonb_build_object('outcome','denied_disclosure'); end if;
  if v_session.consent_status<>'granted' then return jsonb_build_object('outcome','denied_essential_consent'); end if;
  if p_action_kind='register_lead' and not exists(select 1 from public.consent_evidence where tenant_id=p_tenant_id and session_id=p_session_id and purpose='lead_data_capture' and status='granted') then
    return jsonb_build_object('outcome','denied_purpose_consent');
  end if;
  begin
    insert into public.portal_business_action_grants(id,tenant_id,agent_id,session_id,presenter_id,action_kind,command_fingerprint,generation)
      values(p_grant_id,p_tenant_id,p_agent_id,p_session_id,p_presenter_id,p_action_kind,p_command_fingerprint,p_generation);
  exception when unique_violation then
    -- A retry that (correctly or not) generates a fresh p_grant_id instead of
    -- reusing the one from its first attempt still lands on the same
    -- (tenant_id, session_id, command_fingerprint) row via that table's own
    -- unique constraint. Falling back to a lookup here makes idempotent
    -- replay a property of the schema, not something every future caller of
    -- this RPC has to get right on its own -- the same reasoning that keeps
    -- id-based replay (the "if found" branch above) from being the only path.
    select * into v_grant from public.portal_business_action_grants where tenant_id=p_tenant_id and session_id=p_session_id and command_fingerprint=p_command_fingerprint for update;
    if not found then raise; end if;
    if row(v_grant.agent_id,v_grant.presenter_id,v_grant.action_kind,v_grant.generation)
       is distinct from row(p_agent_id,p_presenter_id,p_action_kind,p_generation) then raise exception 'business action admission replay conflict' using errcode='23505'; end if;
    return jsonb_build_object('outcome',case when v_grant.expires_at<=now() then 'expired' else 'replayed' end,'grantId',v_grant.id,'sessionId',v_grant.session_id,'generation',v_grant.generation,'expiresAt',v_grant.expires_at);
  end;
  return jsonb_build_object('outcome','issued','grantId',p_grant_id,'sessionId',p_session_id,'generation',p_generation,'expiresAt',now()+interval '60 minutes');
end $$;

-- Idempotency key is the grant's own command_fingerprint (ADR-039: "chave
-- única (tenant_id, idempotency_key), derivada do commandFingerprint do
-- intent"), so a caller retrying with the same grant_id always resolves to
-- the same lead row and the same receipt row, never a second insert of
-- either.
create or replace function public.portal_register_business_lead_service(
  p_lead_id app.uuid_v7,p_receipt_id app.uuid_v7,p_grant_id app.uuid_v7,
  p_contact_name text,p_contact_email text default null,p_contact_phone text default null,p_qualification_summary text default ''
) returns jsonb language plpgsql security definer set search_path='public' as $$
declare v_grant public.portal_business_action_grants%rowtype; v_receipt public.portal_business_action_receipts%rowtype; v_lead_id app.uuid_v7; v_outcome text; v_reason text;
begin
  if char_length(coalesce(p_contact_name,'')) not between 1 and 200
     or (p_contact_email is null and p_contact_phone is null)
     or (p_contact_email is not null and p_contact_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
     or (p_contact_phone is not null and p_contact_phone !~ '^[0-9+()\-. ]{6,32}$')
     or char_length(coalesce(p_qualification_summary,'')) > 2000
  then raise exception 'invalid business lead contact data' using errcode='22023'; end if;

  select * into v_grant from public.portal_business_action_grants where id=p_grant_id for update;
  if not found or v_grant.action_kind<>'register_lead' then raise exception 'business action grant not found for register_lead' using errcode='42501'; end if;

  select * into v_receipt from public.portal_business_action_receipts where tenant_id=v_grant.tenant_id and grant_id=v_grant.id;
  if found then return jsonb_build_object('outcome',v_receipt.outcome,'leadId',v_receipt.lead_id,'receiptId',v_receipt.id); end if;

  -- reason is returned only to the caller, never persisted: the receipt's
  -- outcome/policy_decision vocabulary stays the closed Art. 7 set, but the
  -- application layer still needs to tell a flipped kill switch apart from a
  -- grant that simply outlived its 60-minute window.
  if app.portal_business_action_switch_disabled(v_grant.tenant_id,v_grant.agent_id,v_grant.action_kind) then v_reason:='kill_switch_active';
  elsif v_grant.expires_at<=now() then v_reason:='grant_expired';
  elsif v_grant.state<>'issued' then v_reason:='grant_invalid';
  else v_reason:=null; end if;
  if v_reason is not null then
    insert into public.portal_business_action_receipts(id,tenant_id,grant_id,session_id,agent_id,presenter_id,action_kind,policy_decision,outcome)
      values(p_receipt_id,v_grant.tenant_id,v_grant.id,v_grant.session_id,v_grant.agent_id,v_grant.presenter_id,v_grant.action_kind,'deny','rejected')
    on conflict (tenant_id,grant_id) do nothing;
    select outcome,lead_id into v_outcome,v_lead_id from public.portal_business_action_receipts where tenant_id=v_grant.tenant_id and grant_id=v_grant.id;
    return jsonb_build_object('outcome',v_outcome,'leadId',v_lead_id,'reason',v_reason);
  end if;

  insert into public.portal_business_action_leads(id,tenant_id,agent_id,session_id,contact_name,contact_email,contact_phone,qualification_summary,source,idempotency_key)
    values(p_lead_id,v_grant.tenant_id,v_grant.agent_id,v_grant.session_id,p_contact_name,p_contact_email,p_contact_phone,coalesce(p_qualification_summary,''),'video_call',v_grant.command_fingerprint)
  on conflict (tenant_id,idempotency_key) do nothing;
  select id into v_lead_id from public.portal_business_action_leads where tenant_id=v_grant.tenant_id and idempotency_key=v_grant.command_fingerprint;

  insert into public.portal_business_action_receipts(id,tenant_id,grant_id,session_id,agent_id,presenter_id,action_kind,policy_decision,outcome,lead_id)
    values(p_receipt_id,v_grant.tenant_id,v_grant.id,v_grant.session_id,v_grant.agent_id,v_grant.presenter_id,v_grant.action_kind,'allow','succeeded',v_lead_id)
  on conflict (tenant_id,grant_id) do nothing;

  return jsonb_build_object('outcome','succeeded','leadId',v_lead_id,'receiptId',p_receipt_id);
end $$;

revoke all on function public.portal_set_business_action_kill_switch_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,text,boolean,text) from public,anon,authenticated;
revoke all on function public.portal_business_action_status_service(app.uuid_v7,app.uuid_v7,text) from public,anon,authenticated;
revoke all on function public.portal_set_business_action_agent_settings_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,boolean) from public,anon,authenticated;
revoke all on function public.portal_admit_business_action_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,integer) from public,anon,authenticated;
revoke all on function public.portal_register_business_lead_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,text,text) from public,anon,authenticated;
grant execute on function public.portal_set_business_action_kill_switch_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,text,boolean,text) to service_role;
grant execute on function public.portal_business_action_status_service(app.uuid_v7,app.uuid_v7,text) to service_role;
grant execute on function public.portal_set_business_action_agent_settings_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,boolean) to service_role;
grant execute on function public.portal_admit_business_action_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,integer) to service_role;
grant execute on function public.portal_register_business_lead_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,text,text) to service_role;

create or replace function public.portal_schema_capabilities_service()
returns jsonb language sql stable security definer set search_path='public' as $$
  select jsonb_build_object(
    'version',51,
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
    'businessActionLeads',to_regclass('public.portal_business_action_leads') is not null and to_regprocedure('public.portal_register_business_lead_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,text,text)') is not null
  )
$$;
revoke all on function public.portal_schema_capabilities_service() from public,anon,authenticated;
grant execute on function public.portal_schema_capabilities_service() to service_role;

commit;
