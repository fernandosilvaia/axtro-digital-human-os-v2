-- ADR-039 wave 1b: propose_meeting_slots / confirm_meeting_slot calendar
-- scheduling. Durable proposals+slots (the on-disk shape of the in-memory
-- Map in packages/tool-adapters/calendar/src/index.ts), a Google Calendar
-- reservation in the exact reserved -> provider_in_flight -> committed /
-- unknown -> completed / released vocabulary ADR-036 already uses (see
-- 0040_production_integrity_hardening.sql's provider_effect_reservations,
-- which this table mirrors structurally but never shares -- ADR-039
-- "Alternativas consideradas" #2), Google Calendar OAuth custody via
-- Supabase Vault, and the RPCs listed in ADR-039 "Migração 0051: tabelas e
-- RPCs" that 0051 deliberately left absent (see that file's header comment).
--
-- NUMBERING CAVEAT: ADR-040 (Stripe Connect checkout, not yet implemented)
-- also reserves 0052 for its own migration. This file claims 0052 first
-- because ADR-040's code has not started. If ADR-040's migration merges to
-- main before this one, this file must be renumbered to 0053 -- same
-- situation, same fix, as the 0049 -> 0051 renumbering already recorded as
-- D-V2-145/D-V2-146 in docs/operations/DECISIONS_LOG.md: rename the file,
-- update every version literal below (schema_capabilities version, this
-- comment), and update scripts/supabase-portal-integration.mjs +
-- scripts/validate_database_contract.py accordingly. No action needed now.
--
-- Widens three CHECK constraints 0051 shipped narrowed on purpose (its own
-- header comment: "action_kind is a single-value domain today
-- (register_lead); a 1b migration extends the check when
-- propose_meeting_slots/confirm_meeting_slot land") and re-publishes
-- portal_admit_business_action_service/portal_business_action_status_service
-- with the wider allowlist plus the meeting_scheduling purpose-consent gate.
-- Every function here keeps its 0051 signature exactly, so CREATE OR REPLACE
-- preserves prior grants on its own -- the explicit REVOKE/GRANT block at
-- the bottom re-asserts the final privilege anyway, never trusting that.
begin;

-- Shared bound: a plausible IANA-ish zone name, or the literal 'UTC'. Timezone
-- is always resolved server-side (tenant's calendar connection default, or a
-- proposal's own recorded value), never taken from the model/prospect, but a
-- format guard still belongs at the boundary (Art. 15: don't trust upstream
-- shape even when the immediate caller is our own server).
create or replace function app.is_bounded_timezone(p_timezone text)
returns boolean language sql immutable as $$
  select p_timezone is not null and (p_timezone='UTC' or p_timezone ~ '^[A-Za-z]+(/[A-Za-z0-9_+-]+)+$')
$$;

-- Durable version of calendar/index.ts's `proposals` Map. One row per
-- propose_meeting_slots grant (unique(tenant_id,grant_id) is the replay
-- idempotency anchor, same technique 0051 used for leads via
-- command_fingerprint -- grant_id already carries that fingerprint's
-- identity one hop removed).
create table public.portal_business_action_proposals (
  id app.uuid_v7 primary key,
  tenant_id app.uuid_v7 not null references public.tenants(id) on delete restrict,
  agent_id app.uuid_v7 not null,
  session_id app.uuid_v7 not null,
  presenter_id app.uuid_v7 not null,
  grant_id app.uuid_v7 not null,
  duration_minutes integer not null,
  timezone text not null,
  contact_name text,
  contact_email text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now()+interval '60 minutes'),
  foreign key (tenant_id,agent_id) references public.agents(tenant_id,id) on delete restrict,
  foreign key (tenant_id,session_id) references public.sessions(tenant_id,id) on delete restrict,
  foreign key (tenant_id,session_id,presenter_id) references public.session_participants(tenant_id,session_id,id) on delete restrict,
  foreign key (tenant_id,grant_id) references public.portal_business_action_grants(tenant_id,id) on delete restrict,
  unique (tenant_id,id),
  unique (tenant_id,grant_id),
  constraint portal_business_action_proposals_duration_chk check (duration_minutes in (15,30,45,60)),
  constraint portal_business_action_proposals_timezone_chk check (app.is_bounded_timezone(timezone)),
  constraint portal_business_action_proposals_name_chk check (contact_name is null or char_length(contact_name) between 1 and 200),
  constraint portal_business_action_proposals_email_chk check (contact_email is null or contact_email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  constraint portal_business_action_proposals_expiry_chk check (expires_at>created_at and expires_at<=created_at+interval '60 minutes')
);
alter table public.portal_business_action_proposals enable row level security;
alter table public.portal_business_action_proposals force row level security;
revoke all on table public.portal_business_action_proposals from public,anon,authenticated,service_role;

-- Slots as typed rows, never a JSONB array (ADR-039 explicit, Art. 17): each
-- row is exactly the {startAt,endAt,timezone} shape CalendarSlot already has
-- in packages/tool-adapters/calendar/src/index.ts. slot_index is the stable
-- 0-based handle confirm_meeting_slot's slotIndex argument addresses.
create table public.portal_business_action_proposal_slots (
  id app.uuid_v7 primary key,
  tenant_id app.uuid_v7 not null references public.tenants(id) on delete restrict,
  proposal_id app.uuid_v7 not null,
  slot_index integer not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  timezone text not null,
  foreign key (tenant_id,proposal_id) references public.portal_business_action_proposals(tenant_id,id) on delete restrict,
  unique (tenant_id,id),
  unique (tenant_id,proposal_id,slot_index),
  constraint portal_business_action_proposal_slots_index_chk check (slot_index between 0 and 49),
  constraint portal_business_action_proposal_slots_window_chk check (end_at>start_at),
  constraint portal_business_action_proposal_slots_timezone_chk check (app.is_bounded_timezone(timezone))
);
alter table public.portal_business_action_proposal_slots enable row level security;
alter table public.portal_business_action_proposal_slots force row level security;
revoke all on table public.portal_business_action_proposal_slots from public,anon,authenticated,service_role;

-- One row per tenant (unique(tenant_id)). vault_secret_id is the opaque
-- Supabase Vault reference (plain uuid -- vault.secrets.id is not an
-- app.uuid_v7), never the refresh token itself (Art. 15: no secret in a
-- plaintext column). Non-null exactly while a live credential exists
-- (connected/reauth_required); null once revoked and its Vault row deleted.
create table public.portal_business_action_calendar_connections (
  id app.uuid_v7 primary key,
  tenant_id app.uuid_v7 not null references public.tenants(id) on delete restrict,
  google_account_email text not null,
  calendar_id text not null,
  default_timezone text not null,
  vault_secret_id uuid,
  status text not null default 'connected',
  connected_by_actor_id app.uuid_v7 not null,
  connected_at timestamptz not null default now(),
  revoked_by_actor_id app.uuid_v7,
  revoked_at timestamptz,
  updated_at timestamptz not null default now(),
  foreign key (tenant_id,connected_by_actor_id) references public.user_tenant_memberships(tenant_id,actor_id) on delete restrict,
  foreign key (tenant_id,revoked_by_actor_id) references public.user_tenant_memberships(tenant_id,actor_id) on delete restrict,
  constraint portal_business_action_calendar_connections_tenant_key unique (tenant_id),
  constraint portal_business_action_calendar_connections_status_chk check (status in ('connected','revoked','reauth_required')),
  constraint portal_business_action_calendar_connections_email_chk check (google_account_email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  constraint portal_business_action_calendar_connections_calendar_chk check (char_length(calendar_id) between 1 and 512),
  constraint portal_business_action_calendar_connections_timezone_chk check (app.is_bounded_timezone(default_timezone)),
  constraint portal_business_action_calendar_connections_secret_chk check ((status='revoked' and vault_secret_id is null) or (status<>'revoked' and vault_secret_id is not null)),
  constraint portal_business_action_calendar_connections_revoked_chk check ((status='revoked')=(revoked_at is not null and revoked_by_actor_id is not null))
);
alter table public.portal_business_action_calendar_connections enable row level security;
alter table public.portal_business_action_calendar_connections force row level security;
revoke all on table public.portal_business_action_calendar_connections from public,anon,authenticated,service_role;

-- The reserved -> provider_in_flight -> committed/unknown -> released/
-- completed reservation, structurally paralleling provider_effect_reservations
-- (0040) without sharing it (ADR-039 "Alternativas consideradas" #2: billing
-- columns there are Tavus/Recall-specific; forcing calendar in would be the
-- overload Art. 17 forbids). google_event_id is generated by this migration's
-- own RPC (portal_reserve_business_meeting_slot_service) and written while
-- still 'reserved', before any Google call -- ADR-039's whole point in
-- reusing Events.insert's caller-supplied id. reconciliation_* columns mirror
-- provider_effect_reservations' single-operator worker-lease shape 1:1 (a
-- future wave's sweep extension, out of scope here per the task); the
-- reconciliation_evidence_fingerprint/outcome/settled_at trio is this
-- table's own terminal marker for the dual-operator path (see
-- portal_business_action_meeting_reconcile_approvals below), giving the
-- reconcile RPC idempotent conflict detection without a second receipts
-- table the way 0040/0043 each needed one.
create table public.portal_business_action_calendar_reservations (
  id app.uuid_v7 primary key,
  tenant_id app.uuid_v7 not null references public.tenants(id) on delete restrict,
  agent_id app.uuid_v7 not null,
  session_id app.uuid_v7 not null,
  presenter_id app.uuid_v7 not null,
  grant_id app.uuid_v7 not null,
  proposal_id app.uuid_v7 not null,
  slot_id app.uuid_v7 not null,
  contact_name text,
  contact_email text not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  timezone text not null,
  state text not null default 'reserved',
  google_event_id text not null,
  google_calendar_id text not null,
  google_event_html_link text,
  failure_code text,
  release_evidence text,
  reconciliation_attempts integer not null default 0,
  reconciliation_available_at timestamptz not null default now(),
  reconciliation_lease_token app.uuid_v7,
  reconciliation_lease_until timestamptz,
  reconciliation_last_error_code text,
  reconciliation_dead_lettered_at timestamptz,
  reconciliation_evidence_fingerprint text,
  reconciliation_outcome text,
  reconciliation_settled_at timestamptz,
  created_at timestamptz not null default now(),
  provider_dispatched_at timestamptz,
  committed_at timestamptz,
  released_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  foreign key (tenant_id,agent_id) references public.agents(tenant_id,id) on delete restrict,
  foreign key (tenant_id,session_id) references public.sessions(tenant_id,id) on delete restrict,
  foreign key (tenant_id,session_id,presenter_id) references public.session_participants(tenant_id,session_id,id) on delete restrict,
  foreign key (tenant_id,grant_id) references public.portal_business_action_grants(tenant_id,id) on delete restrict,
  foreign key (tenant_id,proposal_id) references public.portal_business_action_proposals(tenant_id,id) on delete restrict,
  foreign key (tenant_id,slot_id) references public.portal_business_action_proposal_slots(tenant_id,id) on delete restrict,
  unique (tenant_id,id),
  unique (tenant_id,grant_id),
  constraint portal_business_action_calendar_reservations_state_chk check (state in ('reserved','provider_in_flight','committed','unknown','cleanup_pending','completed','released')),
  constraint portal_business_action_calendar_reservations_window_chk check (end_at>start_at),
  constraint portal_business_action_calendar_reservations_timezone_chk check (app.is_bounded_timezone(timezone)),
  constraint portal_business_action_calendar_reservations_email_chk check (contact_email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  constraint portal_business_action_calendar_reservations_name_chk check (contact_name is null or char_length(contact_name) between 1 and 200),
  -- char_length bound kept separate from the charset regex: PostgreSQL's
  -- regex engine caps repetition counts at 255 (DUPMAX), so a literal
  -- {5,1024} bound is itself an invalid regex, not merely a stricter one.
  constraint portal_business_action_calendar_reservations_event_id_chk check (char_length(google_event_id) between 5 and 1024 and google_event_id ~ '^[a-v0-9]+$'),
  constraint portal_business_action_calendar_reservations_calendar_chk check (char_length(google_calendar_id) between 1 and 512),
  constraint portal_business_action_calendar_reservations_html_link_chk check (google_event_html_link is null or (char_length(google_event_html_link)<=2000 and google_event_html_link ~ '^https://')),
  constraint portal_business_action_calendar_reservations_failure_chk check (failure_code is null or char_length(failure_code)<=80),
  constraint portal_business_action_calendar_reservations_dispatch_chk check (
    (state='reserved' and provider_dispatched_at is null)
    or (state in ('provider_in_flight','committed','unknown','cleanup_pending','completed') and provider_dispatched_at is not null)
    or state='released'
  ),
  constraint portal_business_action_calendar_reservations_commit_chk check (
    (state in ('committed','completed') and committed_at is not null)
    or (state not in ('committed','completed') and committed_at is null)
  ),
  constraint portal_business_action_calendar_reservations_release_chk check (
    (state='released' and released_at is not null and release_evidence is not null)
    or (state<>'released' and released_at is null and release_evidence is null)
  ),
  constraint portal_business_action_calendar_reservations_evidence_chk check (release_evidence is null or release_evidence in ('proposal_expired','slot_conflict','operator_reconciliation_absent','operator_compensation_confirmed')),
  constraint portal_business_action_calendar_reservations_recon_attempt_chk check (reconciliation_attempts between 0 and 1000),
  constraint portal_business_action_calendar_reservations_recon_lease_chk check ((reconciliation_lease_token is null)=(reconciliation_lease_until is null)),
  constraint portal_business_action_calendar_reservations_recon_settle_chk check (
    (reconciliation_outcome is null and reconciliation_evidence_fingerprint is null and reconciliation_settled_at is null)
    or (reconciliation_outcome is not null and reconciliation_evidence_fingerprint is not null and reconciliation_settled_at is not null)
  ),
  constraint portal_business_action_calendar_reservations_recon_fp_chk check (reconciliation_evidence_fingerprint is null or reconciliation_evidence_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint portal_business_action_calendar_reservations_recon_out_chk check (reconciliation_outcome is null or reconciliation_outcome in ('committed','released'))
);
-- Google event identifiers are global, the same "two tenants must never
-- claim the same provider resource" property provider_effect_reservations'
-- provider_ref_uidx already enforces for Tavus/Recall (0040). Deterministic
-- generation from the reservation's own id already makes collision
-- astronomically unlikely; this index makes it a database guarantee instead
-- of an assumption.
create unique index portal_business_action_calendar_reservations_event_uidx
  on public.portal_business_action_calendar_reservations(google_event_id);
-- Enforces "a slot has at most one live reservation" atomically at insert
-- time (closes the TOCTOU window an exists-check-then-insert would leave
-- open under real concurrency) and doubles as the lookup index the reserve
-- RPC's conflict path needs on every call.
create unique index portal_business_action_calendar_reservations_slot_active_uidx
  on public.portal_business_action_calendar_reservations(tenant_id,slot_id) where state<>'released';
-- Hot path for status dashboards today and the future ADR-036 worker sweep
-- extension (out of scope here) that will scan this table by state the same
-- way it already scans provider_effect_reservations.
create index portal_business_action_calendar_reservations_state_idx
  on public.portal_business_action_calendar_reservations(tenant_id,state,created_at);
alter table public.portal_business_action_calendar_reservations enable row level security;
alter table public.portal_business_action_calendar_reservations force row level security;
revoke all on table public.portal_business_action_calendar_reservations from public,anon,authenticated,service_role;

-- Dual-operator reconciliation bookkeeping for a reservation stuck 'unknown'
-- or 'cleanup_pending', replicating portal_runtime_operator_approvals'
-- mechanism (0043) exactly: a row per (reservation, evidence, operator),
-- unique so a retry never double-counts, and the reconcile RPC only acts
-- once count(distinct operator_actor_id) for a given (evidence,outcome)
-- reaches 2. Unlike 0043's runtime dual-approval (which only ever
-- *releases* an ambiguous media effect), this table also allows finalizing
-- to 'committed': a Google Calendar event is independently checkable after
-- the fact (Events.get, or a human looking at the calendar) in a way Tavus/
-- Recall media never was, so two operators confirming "yes, this event
-- exists" is legitimate evidence to mark committed, not just to release.
-- outcome is stored per-approval-row (0043 does not do this) specifically so
-- two operators must independently state the *same* conclusion, not merely
-- both touch the same evidence_fingerprint -- a real strengthening over the
-- runtime pattern, documented here because the ADR left this at design
-- level, not literal SQL.
create table public.portal_business_action_meeting_reconcile_approvals (
  id app.uuid_v7 primary key,
  tenant_id app.uuid_v7 not null references public.tenants(id) on delete restrict,
  reservation_id app.uuid_v7 not null,
  evidence_fingerprint text not null,
  outcome text not null,
  operator_actor_id app.uuid_v7 not null,
  recorded_at timestamptz not null default now(),
  foreign key (tenant_id,reservation_id) references public.portal_business_action_calendar_reservations(tenant_id,id) on delete restrict,
  foreign key (tenant_id,operator_actor_id) references public.user_tenant_memberships(tenant_id,actor_id) on delete restrict,
  constraint portal_business_action_meeting_reconcile_approvals_key unique (tenant_id,reservation_id,evidence_fingerprint,operator_actor_id),
  constraint portal_business_action_meeting_reconcile_approvals_fp_chk check (evidence_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint portal_business_action_meeting_reconcile_approvals_out_chk check (outcome in ('committed','released'))
);
alter table public.portal_business_action_meeting_reconcile_approvals enable row level security;
alter table public.portal_business_action_meeting_reconcile_approvals force row level security;
revoke all on table public.portal_business_action_meeting_reconcile_approvals from public,anon,authenticated,service_role;

-- The calendar half of the receipt shape ADR-039 describes ("uma referência
-- opcional ao resultado: leadId ou reservationId"), plus proposal_id so a
-- propose_meeting_slots receipt (which has no lead and no reservation) still
-- points at the thing it actually produced -- otherwise that outcome would
-- carry zero forward reference, a real audit gap the ADR's two-item list
-- did not need to call out because it only had register_lead to consider
-- when it was written.
alter table public.portal_business_action_receipts add column proposal_id app.uuid_v7;
alter table public.portal_business_action_receipts add column reservation_id app.uuid_v7;
alter table public.portal_business_action_receipts add constraint portal_business_action_receipts_proposal_fkey
  foreign key (tenant_id,proposal_id) references public.portal_business_action_proposals(tenant_id,id) on delete restrict;
alter table public.portal_business_action_receipts add constraint portal_business_action_receipts_reservation_fkey
  foreign key (tenant_id,reservation_id) references public.portal_business_action_calendar_reservations(tenant_id,id) on delete restrict;

-- Widen the three action_kind allowlists 0051 shipped narrowed on purpose.
alter table public.portal_business_action_grants drop constraint portal_business_action_grants_action_chk;
alter table public.portal_business_action_grants add constraint portal_business_action_grants_action_chk
  check (action_kind in ('register_lead','propose_meeting_slots','confirm_meeting_slot'));

alter table public.portal_business_action_receipts drop constraint portal_business_action_receipts_action_chk;
alter table public.portal_business_action_receipts add constraint portal_business_action_receipts_action_chk
  check (action_kind in ('register_lead','propose_meeting_slots','confirm_meeting_slot'));

alter table public.portal_business_action_kill_switches drop constraint portal_business_action_kill_switches_action_chk;
alter table public.portal_business_action_kill_switches add constraint portal_business_action_kill_switches_action_chk
  check (action_kind is null or action_kind in ('register_lead','propose_meeting_slots','confirm_meeting_slot'));

-- Re-published with the wider action_kind allowlist and the meeting_scheduling
-- purpose-consent gate ADR-039 requires for confirm_meeting_slot (not for
-- propose_meeting_slots, which has no external effect -- same exemption the
-- ADR already carved out for lead_data_capture vs. register_lead). Otherwise
-- byte-identical to 0051's body. Same signature, so CREATE OR REPLACE keeps
-- existing grants; the REVOKE/GRANT block below re-asserts them anyway.
create or replace function public.portal_admit_business_action_service(
  p_grant_id app.uuid_v7,p_tenant_id app.uuid_v7,p_agent_id app.uuid_v7,p_session_id app.uuid_v7,p_presenter_id app.uuid_v7,
  p_action_kind text,p_command_fingerprint text,p_generation integer default 0
) returns jsonb language plpgsql security definer set search_path='public' as $$
declare v_grant public.portal_business_action_grants%rowtype; v_agent public.agents%rowtype; v_session public.sessions%rowtype;
begin
  if p_action_kind not in ('register_lead','propose_meeting_slots','confirm_meeting_slot') or p_command_fingerprint !~ '^[0-9a-f]{64}$' or p_generation not between 0 and 10000000 then raise exception 'invalid business action admission' using errcode='22023'; end if;
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
  if p_action_kind='confirm_meeting_slot' and not exists(select 1 from public.consent_evidence where tenant_id=p_tenant_id and session_id=p_session_id and purpose='meeting_scheduling' and status='granted') then
    return jsonb_build_object('outcome','denied_purpose_consent');
  end if;
  begin
    insert into public.portal_business_action_grants(id,tenant_id,agent_id,session_id,presenter_id,action_kind,command_fingerprint,generation)
      values(p_grant_id,p_tenant_id,p_agent_id,p_session_id,p_presenter_id,p_action_kind,p_command_fingerprint,p_generation);
  exception when unique_violation then
    select * into v_grant from public.portal_business_action_grants where tenant_id=p_tenant_id and session_id=p_session_id and command_fingerprint=p_command_fingerprint for update;
    if not found then raise; end if;
    if row(v_grant.agent_id,v_grant.presenter_id,v_grant.action_kind,v_grant.generation)
       is distinct from row(p_agent_id,p_presenter_id,p_action_kind,p_generation) then raise exception 'business action admission replay conflict' using errcode='23505'; end if;
    return jsonb_build_object('outcome',case when v_grant.expires_at<=now() then 'expired' else 'replayed' end,'grantId',v_grant.id,'sessionId',v_grant.session_id,'generation',v_grant.generation,'expiresAt',v_grant.expires_at);
  end;
  return jsonb_build_object('outcome','issued','grantId',p_grant_id,'sessionId',p_session_id,'generation',p_generation,'expiresAt',now()+interval '60 minutes');
end $$;

create or replace function public.portal_business_action_status_service(p_tenant_id app.uuid_v7,p_agent_id app.uuid_v7,p_action_kind text)
returns jsonb language plpgsql stable security definer set search_path='public' as $$
begin
  if p_action_kind not in ('register_lead','propose_meeting_slots','confirm_meeting_slot') or not exists(select 1 from public.agents where tenant_id=p_tenant_id and id=p_agent_id) then return jsonb_build_object('enabled',false); end if;
  return jsonb_build_object('enabled',not app.portal_business_action_switch_disabled(p_tenant_id,p_agent_id,p_action_kind),'actionKind',p_action_kind);
end $$;

-- Persists a proposal + its slots exactly as the application already
-- computed them (no availability math, no Google call here -- ADR-039).
-- p_slots is transient JSONB *input* only, unpacked into typed rows before
-- this function returns; nothing is ever stored as a JSONB array (Art. 17).
-- Each slot element carries its own id (this codebase always generates
-- UUIDv7 application-side, D-V2-010; there is no server-side generator to
-- call for an unbounded number of child rows). Idempotent by grant_id, same
-- as every other 0051-pattern write in this domain.
create or replace function public.portal_propose_business_meeting_slots_service(
  p_receipt_id app.uuid_v7,p_proposal_id app.uuid_v7,p_grant_id app.uuid_v7,
  p_tenant_id app.uuid_v7,p_agent_id app.uuid_v7,p_session_id app.uuid_v7,p_presenter_id app.uuid_v7,
  p_duration_minutes integer,p_timezone text,p_slots jsonb,
  p_contact_name text default null,p_contact_email text default null
) returns jsonb language plpgsql security definer set search_path='public' as $$
declare v_grant public.portal_business_action_grants%rowtype; v_receipt public.portal_business_action_receipts%rowtype;
  v_slot record; v_reason text; v_start timestamptz; v_end timestamptz;
begin
  if p_duration_minutes not in (15,30,45,60) then raise exception 'invalid meeting duration' using errcode='22023'; end if;
  if not app.is_bounded_timezone(p_timezone) then raise exception 'invalid proposal timezone' using errcode='22023'; end if;
  if jsonb_typeof(p_slots) is distinct from 'array' or jsonb_array_length(p_slots) not between 1 and 50 then raise exception 'invalid proposed slot list' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(p_slots) x where jsonb_typeof(x)<>'object' or (select count(*) from jsonb_object_keys(x))<>3 or not(x ?& array['id','startAt','endAt'])) then raise exception 'invalid slot shape' using errcode='22023'; end if;
  if (select count(*) from jsonb_array_elements(p_slots)) <> (select count(distinct x->>'id') from jsonb_array_elements(p_slots) x) then raise exception 'duplicate slot id in proposed slot list' using errcode='22023'; end if;
  if p_contact_name is not null and char_length(p_contact_name) not between 1 and 200 then raise exception 'invalid proposal contact name' using errcode='22023'; end if;
  if p_contact_email is not null and p_contact_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'invalid proposal contact email' using errcode='22023'; end if;

  select * into v_grant from public.portal_business_action_grants where tenant_id=p_tenant_id and id=p_grant_id for update;
  if not found or v_grant.action_kind<>'propose_meeting_slots' then raise exception 'business action grant not found for propose_meeting_slots' using errcode='42501'; end if;

  select * into v_receipt from public.portal_business_action_receipts where tenant_id=v_grant.tenant_id and grant_id=v_grant.id;
  if found then return jsonb_build_object('outcome',v_receipt.outcome,'proposalId',v_receipt.proposal_id,'receiptId',v_receipt.id); end if;

  if app.portal_business_action_switch_disabled(v_grant.tenant_id,v_grant.agent_id,v_grant.action_kind) then v_reason:='kill_switch_active';
  elsif v_grant.expires_at<=now() then v_reason:='grant_expired';
  elsif v_grant.state<>'issued' then v_reason:='grant_invalid';
  elsif v_grant.agent_id<>p_agent_id or v_grant.session_id<>p_session_id or v_grant.presenter_id<>p_presenter_id then v_reason:='grant_scope_mismatch';
  else v_reason:=null; end if;
  if v_reason is not null then
    insert into public.portal_business_action_receipts(id,tenant_id,grant_id,session_id,agent_id,presenter_id,action_kind,policy_decision,outcome)
      values(p_receipt_id,v_grant.tenant_id,v_grant.id,v_grant.session_id,v_grant.agent_id,v_grant.presenter_id,v_grant.action_kind,'deny','rejected')
    on conflict (tenant_id,grant_id) do nothing;
    return jsonb_build_object('outcome','rejected','reason',v_reason);
  end if;

  insert into public.portal_business_action_proposals(id,tenant_id,agent_id,session_id,presenter_id,grant_id,duration_minutes,timezone,contact_name,contact_email)
    values(p_proposal_id,v_grant.tenant_id,v_grant.agent_id,v_grant.session_id,v_grant.presenter_id,v_grant.id,p_duration_minutes,p_timezone,p_contact_name,p_contact_email)
  on conflict (tenant_id,grant_id) do nothing;

  for v_slot in select value,ordinality-1 as idx from jsonb_array_elements(p_slots) with ordinality as t(value,ordinality) loop
    v_start:=(v_slot.value->>'startAt')::timestamptz;
    v_end:=(v_slot.value->>'endAt')::timestamptz;
    if v_end<=v_start then raise exception 'proposed slot end must be after start' using errcode='22023'; end if;
    insert into public.portal_business_action_proposal_slots(id,tenant_id,proposal_id,slot_index,start_at,end_at,timezone)
      values((v_slot.value->>'id')::app.uuid_v7,v_grant.tenant_id,p_proposal_id,v_slot.idx,v_start,v_end,p_timezone)
    on conflict (tenant_id,proposal_id,slot_index) do nothing;
  end loop;

  insert into public.portal_business_action_receipts(id,tenant_id,grant_id,session_id,agent_id,presenter_id,action_kind,policy_decision,outcome,proposal_id)
    values(p_receipt_id,v_grant.tenant_id,v_grant.id,v_grant.session_id,v_grant.agent_id,v_grant.presenter_id,v_grant.action_kind,'allow','succeeded',p_proposal_id)
  on conflict (tenant_id,grant_id) do nothing;

  return jsonb_build_object('outcome','succeeded','proposalId',p_proposal_id,'receiptId',p_receipt_id);
end $$;

-- Step 1 of confirm_meeting_slot. Validates the proposal/slot are real, in
-- scope and unexpired, resolves the tenant's live calendar connection, and
-- creates the reservation still 'reserved' with a server-generated
-- google_event_id -- before any Google call, which does not happen in this
-- migration. auto_confirm_scheduling gates here (not in admission): the
-- grant is still legitimately issued even when the switch is off, exactly
-- as ADR-039 describes ("o intent de confirmação ainda é admitido"); this
-- RPC is where the confirmation itself is refused with a declared reason.
create or replace function public.portal_reserve_business_meeting_slot_service(
  p_reservation_id app.uuid_v7,p_receipt_id app.uuid_v7,p_grant_id app.uuid_v7,
  p_tenant_id app.uuid_v7,p_agent_id app.uuid_v7,p_session_id app.uuid_v7,p_presenter_id app.uuid_v7,
  p_proposal_id app.uuid_v7,p_slot_id app.uuid_v7,p_contact_email text,p_contact_name text default null
) returns jsonb language plpgsql security definer set search_path='public' as $$
declare v_grant public.portal_business_action_grants%rowtype; v_existing public.portal_business_action_calendar_reservations%rowtype;
  v_proposal public.portal_business_action_proposals%rowtype; v_slot public.portal_business_action_proposal_slots%rowtype;
  v_connection public.portal_business_action_calendar_connections%rowtype; v_reason text; v_event_id text;
begin
  if p_contact_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'invalid confirm contact email' using errcode='22023'; end if;
  if p_contact_name is not null and char_length(p_contact_name) not between 1 and 200 then raise exception 'invalid confirm contact name' using errcode='22023'; end if;

  select * into v_grant from public.portal_business_action_grants where tenant_id=p_tenant_id and id=p_grant_id for update;
  if not found or v_grant.action_kind<>'confirm_meeting_slot' then raise exception 'business action grant not found for confirm_meeting_slot' using errcode='42501'; end if;

  select * into v_existing from public.portal_business_action_calendar_reservations where tenant_id=v_grant.tenant_id and grant_id=v_grant.id;
  if found then
    return jsonb_build_object('outcome','replayed','reservationId',v_existing.id,'state',v_existing.state,'googleEventId',v_existing.google_event_id);
  end if;

  if app.portal_business_action_switch_disabled(v_grant.tenant_id,v_grant.agent_id,v_grant.action_kind) then v_reason:='kill_switch_active';
  elsif v_grant.expires_at<=now() then v_reason:='grant_expired';
  elsif v_grant.state<>'issued' then v_reason:='grant_invalid';
  elsif v_grant.agent_id<>p_agent_id or v_grant.session_id<>p_session_id or v_grant.presenter_id<>p_presenter_id then v_reason:='grant_scope_mismatch';
  elsif not coalesce((select auto_confirm_scheduling from public.portal_business_action_agent_settings where tenant_id=v_grant.tenant_id and agent_id=v_grant.agent_id),false) then v_reason:='auto_confirm_disabled';
  else v_reason:=null; end if;

  if v_reason is null then
    select * into v_proposal from public.portal_business_action_proposals where tenant_id=v_grant.tenant_id and id=p_proposal_id and session_id=v_grant.session_id;
    if not found then v_reason:='proposal_not_found';
    elsif v_proposal.expires_at<=now() then v_reason:='proposal_expired'; end if;
  end if;

  if v_reason is null then
    select * into v_slot from public.portal_business_action_proposal_slots where tenant_id=v_grant.tenant_id and id=p_slot_id and proposal_id=p_proposal_id;
    if not found then v_reason:='slot_not_offered'; end if;
  end if;

  if v_reason is null then
    select * into v_connection from public.portal_business_action_calendar_connections where tenant_id=v_grant.tenant_id for update;
    if not found or v_connection.status<>'connected' then v_reason:='calendar_not_connected'; end if;
  end if;

  if v_reason is not null then
    insert into public.portal_business_action_receipts(id,tenant_id,grant_id,session_id,agent_id,presenter_id,action_kind,policy_decision,outcome)
      values(p_receipt_id,v_grant.tenant_id,v_grant.id,v_grant.session_id,v_grant.agent_id,v_grant.presenter_id,v_grant.action_kind,'deny','rejected')
    on conflict (tenant_id,grant_id) do nothing;
    return jsonb_build_object('outcome','rejected','reason',v_reason);
  end if;

  -- Deterministic from the reservation's own id: base32hex-compatible
  -- (a-v0-9), well under the 1024-char cap, and traceable back to this row
  -- by any operator re-hyphenating it. A retry that replays this same
  -- p_reservation_id (the grant-id-keyed idempotent path above) never needs
  -- a second value; a genuinely different reservation gets a genuinely
  -- different id because app.uuid_v7 identity already guarantees that.
  v_event_id:=lower(replace(p_reservation_id::text,'-',''));

  begin
    insert into public.portal_business_action_calendar_reservations(
      id,tenant_id,agent_id,session_id,presenter_id,grant_id,proposal_id,slot_id,
      contact_name,contact_email,start_at,end_at,timezone,state,google_event_id,google_calendar_id
    ) values (
      p_reservation_id,v_grant.tenant_id,v_grant.agent_id,v_grant.session_id,v_grant.presenter_id,v_grant.id,p_proposal_id,p_slot_id,
      p_contact_name,p_contact_email,v_slot.start_at,v_slot.end_at,v_slot.timezone,'reserved',v_event_id,v_connection.calendar_id
    );
  exception when unique_violation then
    -- The only unique index this insert can hit that is not already ruled
    -- out above is the partial slot_active_uidx: a concurrent grant reserved
    -- this exact slot first. Treat it as the normal pre-dispatch rejection
    -- it is, never a hard error to the caller.
    insert into public.portal_business_action_receipts(id,tenant_id,grant_id,session_id,agent_id,presenter_id,action_kind,policy_decision,outcome)
      values(p_receipt_id,v_grant.tenant_id,v_grant.id,v_grant.session_id,v_grant.agent_id,v_grant.presenter_id,v_grant.action_kind,'deny','rejected')
    on conflict (tenant_id,grant_id) do nothing;
    return jsonb_build_object('outcome','rejected','reason','slot_conflict');
  end;

  return jsonb_build_object('outcome','reserved','reservationId',p_reservation_id,'state','reserved','googleEventId',v_event_id,'googleCalendarId',v_connection.calendar_id,'startAt',v_slot.start_at,'endAt',v_slot.end_at,'timezone',v_slot.timezone);
end $$;

-- Fence reserved -> provider_in_flight, called immediately before the
-- (out-of-migration) Google call. Idempotent the same way
-- portal_mark_provider_effect_in_flight_service (0040) is: a second call
-- against an already-in-flight row returns acquired:false instead of
-- re-dispatching or raising.
create or replace function public.portal_dispatch_business_meeting_reservation_service(p_tenant_id app.uuid_v7,p_reservation_id app.uuid_v7)
returns jsonb language plpgsql security definer set search_path='public' as $$
declare v_row public.portal_business_action_calendar_reservations%rowtype;
begin
  select * into v_row from public.portal_business_action_calendar_reservations where tenant_id=p_tenant_id and id=p_reservation_id for update;
  if not found then raise exception 'calendar reservation not found for tenant' using errcode='P0002'; end if;
  if v_row.state='reserved' then
    update public.portal_business_action_calendar_reservations set state='provider_in_flight',provider_dispatched_at=now(),updated_at=now() where tenant_id=p_tenant_id and id=p_reservation_id;
    return jsonb_build_object('acquired',true,'state','provider_in_flight','googleEventId',v_row.google_event_id,'googleCalendarId',v_row.google_calendar_id);
  end if;
  return jsonb_build_object('acquired',false,'state',v_row.state,'googleEventId',v_row.google_event_id,'googleCalendarId',v_row.google_calendar_id);
end $$;

-- provider_in_flight -> committed, records the succeeded receipt. Requires
-- provider_in_flight explicitly (a caller trying to commit anything else is
-- a caller bug, not a business outcome worth papering over).
create or replace function public.portal_commit_business_meeting_reservation_service(
  p_tenant_id app.uuid_v7,p_reservation_id app.uuid_v7,p_receipt_id app.uuid_v7,p_google_event_html_link text default null
) returns jsonb language plpgsql security definer set search_path='public' as $$
declare v_row public.portal_business_action_calendar_reservations%rowtype; v_receipt public.portal_business_action_receipts%rowtype;
begin
  if p_google_event_html_link is not null and (char_length(p_google_event_html_link)>2000 or p_google_event_html_link !~ '^https://') then raise exception 'invalid google event html link' using errcode='22023'; end if;
  select * into v_row from public.portal_business_action_calendar_reservations where tenant_id=p_tenant_id and id=p_reservation_id for update;
  if not found then raise exception 'calendar reservation not found for tenant' using errcode='P0002'; end if;

  select * into v_receipt from public.portal_business_action_receipts where tenant_id=p_tenant_id and grant_id=v_row.grant_id;
  if found then return jsonb_build_object('outcome',v_receipt.outcome,'reservationId',v_row.id,'state',v_row.state); end if;

  if v_row.state<>'provider_in_flight' then raise exception 'calendar reservation must be provider_in_flight to commit' using errcode='55000'; end if;

  update public.portal_business_action_calendar_reservations
    set state='committed',committed_at=now(),google_event_html_link=p_google_event_html_link,updated_at=now()
    where tenant_id=p_tenant_id and id=p_reservation_id;

  insert into public.portal_business_action_receipts(id,tenant_id,grant_id,session_id,agent_id,presenter_id,action_kind,policy_decision,outcome,reservation_id,effect_hash)
    values(p_receipt_id,v_row.tenant_id,v_row.grant_id,v_row.session_id,v_row.agent_id,v_row.presenter_id,'confirm_meeting_slot','allow','succeeded',v_row.id,app.sha256_text(v_row.google_event_id))
  on conflict (tenant_id,grant_id) do nothing;

  return jsonb_build_object('outcome','succeeded','reservationId',v_row.id,'state','committed','googleEventId',v_row.google_event_id);
end $$;

-- Releases only a comprehensively pre-dispatch failure (proposal_expired,
-- slot_conflict) -- never after the Google call, which this RPC explicitly
-- refuses to do by requiring state='reserved'. Post-dispatch ambiguity goes
-- through mark-unknown + reconcile instead, never through this function.
create or replace function public.portal_release_business_meeting_reservation_service(
  p_tenant_id app.uuid_v7,p_reservation_id app.uuid_v7,p_receipt_id app.uuid_v7,p_evidence text
) returns jsonb language plpgsql security definer set search_path='public' as $$
declare v_row public.portal_business_action_calendar_reservations%rowtype; v_receipt public.portal_business_action_receipts%rowtype;
begin
  if p_evidence not in ('proposal_expired','slot_conflict') then raise exception 'request-path release requires pre-dispatch evidence' using errcode='22023'; end if;
  select * into v_row from public.portal_business_action_calendar_reservations where tenant_id=p_tenant_id and id=p_reservation_id for update;
  if not found then raise exception 'calendar reservation not found for tenant' using errcode='P0002'; end if;

  select * into v_receipt from public.portal_business_action_receipts where tenant_id=p_tenant_id and grant_id=v_row.grant_id;
  if found then
    -- The grant's one receipt may have been written by this same function on
    -- a prior call (outcome='rejected', the correct Art. 7 vocabulary for a
    -- pre-dispatch release) or by commit()/reconcile() if the reservation
    -- moved on before this replay arrived. Either way, report the current
    -- reservation state's own outcome word, never the receipt's raw column,
    -- so a fresh call and a replayed call are indistinguishable to the caller.
    return jsonb_build_object('outcome',case when v_row.state='committed' then 'succeeded' when v_row.state='released' then 'released' else v_row.state end,'reservationId',v_row.id,'state',v_row.state);
  end if;

  if v_row.state<>'reserved' then return jsonb_build_object('outcome','not_releasable','state',v_row.state); end if;

  update public.portal_business_action_calendar_reservations
    set state='released',release_evidence=p_evidence,released_at=now(),updated_at=now()
    where tenant_id=p_tenant_id and id=p_reservation_id and state='reserved';

  insert into public.portal_business_action_receipts(id,tenant_id,grant_id,session_id,agent_id,presenter_id,action_kind,policy_decision,outcome,reservation_id)
    values(p_receipt_id,v_row.tenant_id,v_row.grant_id,v_row.session_id,v_row.agent_id,v_row.presenter_id,'confirm_meeting_slot','deny','rejected',v_row.id)
  on conflict (tenant_id,grant_id) do nothing;

  return jsonb_build_object('outcome','released','reservationId',v_row.id,'state','released');
end $$;

-- provider_in_flight -> unknown after an ambiguous post-dispatch failure.
-- Mirrors portal_mark_provider_effect_unknown_service (0040) exactly,
-- including writing no receipt: the attempt genuinely has no terminal
-- outcome yet, and portal_business_action_receipts is one row per grant
-- (0051), so writing a receipt here would foreclose the real one that
-- portal_reconcile_business_meeting_reservation_service or
-- portal_commit_business_meeting_reservation_service still has to write
-- once the ambiguity resolves.
create or replace function public.portal_mark_business_meeting_reservation_unknown_service(p_tenant_id app.uuid_v7,p_reservation_id app.uuid_v7,p_failure_code text)
returns boolean language plpgsql security definer set search_path='public' as $$
begin
  update public.portal_business_action_calendar_reservations
    set state='unknown',failure_code=left(coalesce(p_failure_code,'unknown'),80),updated_at=now()
    where tenant_id=p_tenant_id and id=p_reservation_id and state='provider_in_flight';
  return found;
end $$;

-- unknown/cleanup_pending -> committed|released via two distinct tenant_admin
-- operators agreeing on the same (evidence_fingerprint, outcome). Each call
-- records one operator's approval (idempotent no-op on repeat by the same
-- operator, so "the same operator twice" structurally can never finalize --
-- count(distinct operator_actor_id) stays at 1); the second distinct
-- operator's call performs the actual transition and writes the terminal
-- receipt. Already-settled reservations reconciled again are idempotent
-- when the evidence/outcome match, and reported as a conflict when they do
-- not (a settled reservation reconciled with different evidence is a real
-- signal worth surfacing, not a silent overwrite).
create or replace function public.portal_reconcile_business_meeting_reservation_service(
  p_approval_id app.uuid_v7,p_tenant_id app.uuid_v7,p_reservation_id app.uuid_v7,p_operator_actor_id app.uuid_v7,
  p_evidence_fingerprint text,p_outcome text,p_release_evidence_code text default null,p_google_event_html_link text default null
) returns jsonb language plpgsql security definer set search_path='public' as $$
declare v_row public.portal_business_action_calendar_reservations%rowtype; v_agree_count integer;
begin
  if p_evidence_fingerprint !~ '^[0-9a-f]{64}$' or p_outcome not in ('committed','released') then raise exception 'invalid calendar reconciliation request' using errcode='22023'; end if;
  if p_outcome='released' and p_release_evidence_code not in ('operator_reconciliation_absent','operator_compensation_confirmed') then raise exception 'released reconciliation requires a closed release evidence code' using errcode='22023'; end if;
  if p_outcome='committed' and p_google_event_html_link is not null and (char_length(p_google_event_html_link)>2000 or p_google_event_html_link !~ '^https://') then raise exception 'invalid google event html link' using errcode='22023'; end if;
  if not exists(select 1 from public.user_tenant_memberships where tenant_id=p_tenant_id and actor_id=p_operator_actor_id and role='tenant_admin') then raise exception 'calendar reconciliation requires a tenant admin operator' using errcode='42501'; end if;

  select * into v_row from public.portal_business_action_calendar_reservations where tenant_id=p_tenant_id and id=p_reservation_id for update;
  if not found then raise exception 'calendar reservation not found for tenant' using errcode='P0002'; end if;

  if v_row.state in ('committed','released') then
    if v_row.reconciliation_evidence_fingerprint is distinct from p_evidence_fingerprint or v_row.reconciliation_outcome is distinct from p_outcome then
      return jsonb_build_object('outcome','already_settled','state',v_row.state);
    end if;
    return jsonb_build_object('outcome',v_row.state,'reservationId',v_row.id,'state',v_row.state);
  end if;

  if v_row.state not in ('unknown','cleanup_pending') then
    return jsonb_build_object('outcome','not_reconcilable','state',v_row.state);
  end if;

  insert into public.portal_business_action_meeting_reconcile_approvals(id,tenant_id,reservation_id,evidence_fingerprint,outcome,operator_actor_id)
    values(p_approval_id,p_tenant_id,p_reservation_id,p_evidence_fingerprint,p_outcome,p_operator_actor_id)
  on conflict (tenant_id,reservation_id,evidence_fingerprint,operator_actor_id) do nothing;

  select count(distinct operator_actor_id) into v_agree_count
    from public.portal_business_action_meeting_reconcile_approvals
    where tenant_id=p_tenant_id and reservation_id=p_reservation_id and evidence_fingerprint=p_evidence_fingerprint and outcome=p_outcome;

  if v_agree_count<2 then
    return jsonb_build_object('outcome','awaiting_second_operator','approvals',v_agree_count);
  end if;

  update public.portal_business_action_calendar_reservations set
    state=p_outcome,
    reconciliation_evidence_fingerprint=p_evidence_fingerprint,
    reconciliation_outcome=p_outcome,
    reconciliation_settled_at=now(),
    committed_at=case when p_outcome='committed' then now() else committed_at end,
    google_event_html_link=case when p_outcome='committed' then coalesce(p_google_event_html_link,google_event_html_link) else google_event_html_link end,
    released_at=case when p_outcome='released' then now() else released_at end,
    release_evidence=case when p_outcome='released' then p_release_evidence_code else release_evidence end,
    updated_at=now()
    where tenant_id=p_tenant_id and id=p_reservation_id and state in ('unknown','cleanup_pending');
  if not found then raise exception 'calendar reservation reconciliation lost its fence' using errcode='55000'; end if;

  insert into public.portal_business_action_receipts(id,tenant_id,grant_id,session_id,agent_id,presenter_id,action_kind,policy_decision,outcome,reservation_id,effect_hash)
    values(p_approval_id,v_row.tenant_id,v_row.grant_id,v_row.session_id,v_row.agent_id,v_row.presenter_id,'confirm_meeting_slot','allow',
      case when p_outcome='committed' then 'succeeded' else 'failed' end,v_row.id,app.sha256_tuple(v_row.google_event_id,p_evidence_fingerprint,p_outcome))
  on conflict (tenant_id,grant_id) do nothing;

  return jsonb_build_object('outcome',p_outcome,'reservationId',v_row.id,'state',p_outcome,'approvals',v_agree_count);
end $$;

-- Stores the already-obtained OAuth refresh token in Supabase Vault
-- (pgsodium-backed, ADR-039's explicit custody decision) and keeps only the
-- opaque vault_secret_id locally -- never the token itself, in any column,
-- ever (Art. 15). The token exchange itself (authorization code -> refresh
-- token) happens in the application's OAuth callback route, out of scope
-- for this migration. Reconnecting a tenant creates a fresh secret and
-- deletes the prior one so a stale credential never lingers in Vault.
create or replace function public.portal_connect_google_calendar_service(
  p_id app.uuid_v7,p_tenant_id app.uuid_v7,p_actor_id app.uuid_v7,
  p_google_account_email text,p_calendar_id text,p_default_timezone text,p_refresh_token text
) returns jsonb language plpgsql security definer set search_path='public' as $$
declare v_existing public.portal_business_action_calendar_connections%rowtype; v_secret_id uuid; v_old_secret_id uuid;
begin
  if not exists(select 1 from public.user_tenant_memberships where tenant_id=p_tenant_id and actor_id=p_actor_id and role='tenant_admin') then
    raise exception 'google calendar connection requires tenant admin' using errcode='42501';
  end if;
  if p_google_account_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'invalid google account email' using errcode='22023'; end if;
  if p_calendar_id is null or char_length(p_calendar_id) not between 1 and 512 then raise exception 'invalid google calendar id' using errcode='22023'; end if;
  if not app.is_bounded_timezone(p_default_timezone) then raise exception 'invalid default timezone' using errcode='22023'; end if;
  if p_refresh_token is null or char_length(p_refresh_token) not between 8 and 4096 then raise exception 'invalid refresh token payload' using errcode='22023'; end if;

  select * into v_existing from public.portal_business_action_calendar_connections where tenant_id=p_tenant_id for update;
  v_old_secret_id:=v_existing.vault_secret_id;

  select vault.create_secret(p_refresh_token,'business_action_calendar:'||p_tenant_id::text,'ADR-039 Google Calendar OAuth refresh token, tenant-scoped') into v_secret_id;

  insert into public.portal_business_action_calendar_connections(id,tenant_id,google_account_email,calendar_id,default_timezone,vault_secret_id,status,connected_by_actor_id,connected_at,updated_at)
    values(p_id,p_tenant_id,p_google_account_email,p_calendar_id,p_default_timezone,v_secret_id,'connected',p_actor_id,now(),now())
  on conflict (tenant_id) do update set
    google_account_email=excluded.google_account_email,calendar_id=excluded.calendar_id,default_timezone=excluded.default_timezone,
    vault_secret_id=excluded.vault_secret_id,status='connected',connected_by_actor_id=excluded.connected_by_actor_id,connected_at=now(),
    revoked_by_actor_id=null,revoked_at=null,updated_at=now();

  if v_old_secret_id is not null and v_old_secret_id<>v_secret_id then
    delete from vault.secrets where id=v_old_secret_id;
  end if;

  return jsonb_build_object('outcome','connected','tenantId',p_tenant_id,'calendarId',p_calendar_id,'status','connected');
end $$;

-- Marks the connection revoked and deletes its Vault secret. Calling
-- Google's own token-revocation endpoint is the application's job, out of
-- scope here (ADR-039).
create or replace function public.portal_disconnect_google_calendar_service(p_tenant_id app.uuid_v7,p_actor_id app.uuid_v7)
returns jsonb language plpgsql security definer set search_path='public' as $$
declare v_row public.portal_business_action_calendar_connections%rowtype;
begin
  if not exists(select 1 from public.user_tenant_memberships where tenant_id=p_tenant_id and actor_id=p_actor_id and role='tenant_admin') then
    raise exception 'google calendar disconnect requires tenant admin' using errcode='42501';
  end if;
  select * into v_row from public.portal_business_action_calendar_connections where tenant_id=p_tenant_id for update;
  if not found then return jsonb_build_object('outcome','not_connected'); end if;
  if v_row.status='revoked' then return jsonb_build_object('outcome','revoked'); end if;

  update public.portal_business_action_calendar_connections
    set status='revoked',revoked_by_actor_id=p_actor_id,revoked_at=now(),vault_secret_id=null,updated_at=now()
    where tenant_id=p_tenant_id;

  if v_row.vault_secret_id is not null then
    delete from vault.secrets where id=v_row.vault_secret_id;
  end if;

  return jsonb_build_object('outcome','revoked');
end $$;

-- Read-only lookup for the application to fetch vault_secret_id/calendar_id/
-- default_timezone/status before calling Google. Never exposed outside
-- service_role, never selects vault.decrypted_secrets -- the actual secret
-- value never passes through this function at all.
create or replace function public.portal_google_calendar_connection_context_service(p_tenant_id app.uuid_v7)
returns jsonb language sql stable security definer set search_path='public' as $$
  select coalesce(
    (select jsonb_build_object('outcome','found','vaultSecretId',vault_secret_id,'calendarId',calendar_id,'defaultTimezone',default_timezone,'status',status,'googleAccountEmail',google_account_email)
     from public.portal_business_action_calendar_connections where tenant_id=p_tenant_id),
    jsonb_build_object('outcome','not_connected')
  )
$$;

revoke all on function public.portal_admit_business_action_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,integer) from public,anon,authenticated;
revoke all on function public.portal_business_action_status_service(app.uuid_v7,app.uuid_v7,text) from public,anon,authenticated;
revoke all on function public.portal_propose_business_meeting_slots_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,integer,text,jsonb,text,text) from public,anon,authenticated;
revoke all on function public.portal_reserve_business_meeting_slot_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text) from public,anon,authenticated;
revoke all on function public.portal_dispatch_business_meeting_reservation_service(app.uuid_v7,app.uuid_v7) from public,anon,authenticated;
revoke all on function public.portal_commit_business_meeting_reservation_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text) from public,anon,authenticated;
revoke all on function public.portal_release_business_meeting_reservation_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text) from public,anon,authenticated;
revoke all on function public.portal_mark_business_meeting_reservation_unknown_service(app.uuid_v7,app.uuid_v7,text) from public,anon,authenticated;
revoke all on function public.portal_reconcile_business_meeting_reservation_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,text,text) from public,anon,authenticated;
revoke all on function public.portal_connect_google_calendar_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,text,text) from public,anon,authenticated;
revoke all on function public.portal_disconnect_google_calendar_service(app.uuid_v7,app.uuid_v7) from public,anon,authenticated;
revoke all on function public.portal_google_calendar_connection_context_service(app.uuid_v7) from public,anon,authenticated;

grant execute on function public.portal_admit_business_action_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,integer) to service_role;
grant execute on function public.portal_business_action_status_service(app.uuid_v7,app.uuid_v7,text) to service_role;
grant execute on function public.portal_propose_business_meeting_slots_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,integer,text,jsonb,text,text) to service_role;
grant execute on function public.portal_reserve_business_meeting_slot_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text) to service_role;
grant execute on function public.portal_dispatch_business_meeting_reservation_service(app.uuid_v7,app.uuid_v7) to service_role;
grant execute on function public.portal_commit_business_meeting_reservation_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text) to service_role;
grant execute on function public.portal_release_business_meeting_reservation_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text) to service_role;
grant execute on function public.portal_mark_business_meeting_reservation_unknown_service(app.uuid_v7,app.uuid_v7,text) to service_role;
grant execute on function public.portal_reconcile_business_meeting_reservation_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,text,text) to service_role;
grant execute on function public.portal_connect_google_calendar_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,text,text) to service_role;
grant execute on function public.portal_disconnect_google_calendar_service(app.uuid_v7,app.uuid_v7) to service_role;
grant execute on function public.portal_google_calendar_connection_context_service(app.uuid_v7) to service_role;

create or replace function public.portal_schema_capabilities_service()
returns jsonb language sql stable security definer set search_path='public' as $$
  select jsonb_build_object(
    'version',52,
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
    'businessActionCalendarConnections',to_regclass('public.portal_business_action_calendar_connections') is not null and to_regprocedure('public.portal_connect_google_calendar_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,text,text)') is not null and to_regprocedure('public.portal_disconnect_google_calendar_service(app.uuid_v7,app.uuid_v7)') is not null and to_regprocedure('public.portal_google_calendar_connection_context_service(app.uuid_v7)') is not null
  )
$$;
revoke all on function public.portal_schema_capabilities_service() from public,anon,authenticated;
grant execute on function public.portal_schema_capabilities_service() to service_role;

commit;
