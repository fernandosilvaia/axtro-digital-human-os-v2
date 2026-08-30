-- ADR-039/ADR-041 defense-in-depth: bound e-mail length at the database
-- boundary, not only in the application layer.
--
-- An adversarial security review of the business-action tool-call funnel
-- (ADR-041) found that contactEmail/google_account_email was the only
-- contact field in the portal_business_action_* domain with no explicit
-- SIZE bound anywhere in the check chain -- every CHECK constraint and every
-- SECURITY DEFINER RPC in 0051/0052 validated e-mail shape only via the
-- format regex '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$', which a
-- Postgres regex engine will happily match against an input of unbounded
-- length. contact_name, contact_phone, qualification_summary, calendar_id,
-- google_event_html_link and failure_code all already carry an explicit
-- char_length(...) bound; contact_email/google_account_email did not. The
-- application-layer half of this fix (apps/portal/src/lib/google-calendar/
-- id-token.ts's MAX_EMAIL_CHARS = 320) already shipped separately; this
-- migration closes the same gap at the database boundary. Defense in depth
-- matters here specifically because every RPC touched below is
-- service_role-only (see the REVOKE/GRANT block at the bottom) and could in
-- the future be reached by a code path that never passes through today's
-- application-layer validation.
--
-- 320 is RFC 5321 sec. 4.5.3.1.3's own maximum total length for an e-mail
-- address (64 local-part + 1 '@' + 255 domain = 320), the same bound the
-- application layer already uses. This is intentionally the one number
-- every touched constraint/RPC below uses -- no field-specific tuning.
--
-- Widen-aditivo pattern for the four CHECK constraints (drop the 0051/0052
-- constraint, add it back under the SAME name with the extra char_length
-- clause AND-ed onto the pre-existing null/format checks), exactly the
-- technique 0052 already used to widen the three action_kind allowlists it
-- inherited from 0051 (see 0052's own "Widen the three action_kind
-- allowlists" section) -- never edit the original 0051/0052 files, which are
-- already merged. Never DROP COLUMN, never DROP TABLE, no data touched: this
-- migration only tightens future writes; it does not retroactively reject
-- any e-mail already stored (none in this codebase's history could exceed
-- 320 chars in practice, but this migration makes no assertion either way
-- about existing rows -- a narrower ALTER ... VALIDATE step is deliberately
-- out of scope for this ticket).
begin;

-- portal_business_action_leads.contact_email (0051): nullable field, keep
-- the "null is fine" branch untouched, AND the new length bound into the
-- non-null branch alongside the pre-existing format check.
alter table public.portal_business_action_leads drop constraint portal_business_action_leads_email_chk;
alter table public.portal_business_action_leads add constraint portal_business_action_leads_email_chk
  check (contact_email is null or (char_length(contact_email) <= 320 and contact_email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'));

-- portal_business_action_proposals.contact_email (0052): same nullable shape.
alter table public.portal_business_action_proposals drop constraint portal_business_action_proposals_email_chk;
alter table public.portal_business_action_proposals add constraint portal_business_action_proposals_email_chk
  check (contact_email is null or (char_length(contact_email) <= 320 and contact_email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'));

-- portal_business_action_calendar_connections.google_account_email (0052):
-- this column is `not null` (the tenant's own connected Google account), so
-- there is no null branch to preserve here.
alter table public.portal_business_action_calendar_connections drop constraint portal_business_action_calendar_connections_email_chk;
alter table public.portal_business_action_calendar_connections add constraint portal_business_action_calendar_connections_email_chk
  check (char_length(google_account_email) <= 320 and google_account_email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$');

-- portal_business_action_calendar_reservations.contact_email (0052): also
-- `not null` (confirm_meeting_slot always requires a prospect contact email).
alter table public.portal_business_action_calendar_reservations drop constraint portal_business_action_calendar_reservations_email_chk;
alter table public.portal_business_action_calendar_reservations add constraint portal_business_action_calendar_reservations_email_chk
  check (char_length(contact_email) <= 320 and contact_email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$');

-- Re-published byte-identical to 0051 except the one new char_length branch
-- ANDed into the existing p_contact_email validation. Same signature, so
-- CREATE OR REPLACE keeps existing grants; the REVOKE/GRANT block below
-- re-asserts them anyway, never trusting that alone (the recreate-drops-
-- grants trap this migration must not fall into).
create or replace function public.portal_register_business_lead_service(
  p_lead_id app.uuid_v7,p_receipt_id app.uuid_v7,p_grant_id app.uuid_v7,
  p_contact_name text,p_contact_email text default null,p_contact_phone text default null,p_qualification_summary text default ''
) returns jsonb language plpgsql security definer set search_path='public' as $$
declare v_grant public.portal_business_action_grants%rowtype; v_receipt public.portal_business_action_receipts%rowtype; v_lead_id app.uuid_v7; v_outcome text; v_reason text;
begin
  if char_length(coalesce(p_contact_name,'')) not between 1 and 200
     or (p_contact_email is null and p_contact_phone is null)
     or (p_contact_email is not null and char_length(p_contact_email) > 320)
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

-- Re-published byte-identical to 0052 except the one new char_length line,
-- added as its own `if` (matching this function's existing one-field-per-if
-- style) immediately before the pre-existing format check.
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
  if p_contact_email is not null and char_length(p_contact_email) > 320 then raise exception 'invalid proposal contact email' using errcode='22023'; end if;
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

-- Re-published byte-identical to 0052 except p_contact_email's validation
-- line, which now ANDs the length bound into the same single `if` the
-- format check already used (this function's own pre-existing style for
-- that field, unlike propose_meeting_slots' separate-if style above).
create or replace function public.portal_reserve_business_meeting_slot_service(
  p_reservation_id app.uuid_v7,p_receipt_id app.uuid_v7,p_grant_id app.uuid_v7,
  p_tenant_id app.uuid_v7,p_agent_id app.uuid_v7,p_session_id app.uuid_v7,p_presenter_id app.uuid_v7,
  p_proposal_id app.uuid_v7,p_slot_id app.uuid_v7,p_contact_email text,p_contact_name text default null
) returns jsonb language plpgsql security definer set search_path='public' as $$
declare v_grant public.portal_business_action_grants%rowtype; v_existing public.portal_business_action_calendar_reservations%rowtype;
  v_proposal public.portal_business_action_proposals%rowtype; v_slot public.portal_business_action_proposal_slots%rowtype;
  v_connection public.portal_business_action_calendar_connections%rowtype; v_reason text; v_event_id text;
begin
  if p_contact_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or char_length(p_contact_email) > 320 then raise exception 'invalid confirm contact email' using errcode='22023'; end if;
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

-- Re-published byte-identical to 0052 except p_google_account_email's
-- validation line. This function was NOT called out by name in the task's
-- required list, but its own p_google_account_email check has the exact
-- same shape as the four fixed above (format regex only, no char_length) --
-- same domain, same gap, so it gets the same fix here rather than being
-- left as a known-but-unfixed instance of the same bug.
create or replace function public.portal_connect_google_calendar_service(
  p_id app.uuid_v7,p_tenant_id app.uuid_v7,p_actor_id app.uuid_v7,
  p_google_account_email text,p_calendar_id text,p_default_timezone text,p_refresh_token text
) returns jsonb language plpgsql security definer set search_path='public' as $$
declare v_existing public.portal_business_action_calendar_connections%rowtype; v_secret_id uuid; v_old_secret_id uuid;
begin
  if not exists(select 1 from public.user_tenant_memberships where tenant_id=p_tenant_id and actor_id=p_actor_id and role='tenant_admin') then
    raise exception 'google calendar connection requires tenant admin' using errcode='42501';
  end if;
  if p_google_account_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or char_length(p_google_account_email) > 320 then raise exception 'invalid google account email' using errcode='22023'; end if;
  if p_calendar_id is null or char_length(p_calendar_id) not between 1 and 512 then raise exception 'invalid google calendar id' using errcode='22023'; end if;
  if not app.is_bounded_timezone(p_default_timezone) then raise exception 'invalid default timezone' using errcode='22023'; end if;
  if p_refresh_token is null or char_length(p_refresh_token) not between 8 and 4096 then raise exception 'invalid refresh token payload' using errcode='22023'; end if;

  select * into v_existing from public.portal_business_action_calendar_connections where tenant_id=p_tenant_id for update;
  v_old_secret_id:=v_existing.vault_secret_id;

  if v_old_secret_id is not null then
    delete from vault.secrets where id=v_old_secret_id;
  end if;

  select vault.create_secret(p_refresh_token,'business_action_calendar:'||p_tenant_id::text,'ADR-039 Google Calendar OAuth refresh token, tenant-scoped') into v_secret_id;

  insert into public.portal_business_action_calendar_connections(id,tenant_id,google_account_email,calendar_id,default_timezone,vault_secret_id,status,connected_by_actor_id,connected_at,updated_at)
    values(p_id,p_tenant_id,p_google_account_email,p_calendar_id,p_default_timezone,v_secret_id,'connected',p_actor_id,now(),now())
  on conflict (tenant_id) do update set
    google_account_email=excluded.google_account_email,calendar_id=excluded.calendar_id,default_timezone=excluded.default_timezone,
    vault_secret_id=excluded.vault_secret_id,status='connected',connected_by_actor_id=excluded.connected_by_actor_id,connected_at=now(),
    revoked_by_actor_id=null,revoked_at=null,updated_at=now();

  return jsonb_build_object('outcome','connected','tenantId',p_tenant_id,'calendarId',p_calendar_id,'status','connected');
end $$;

-- The "recreate drops grants" trap this migration must not fall into
-- (DROP+CREATE would; CREATE OR REPLACE with an unchanged signature keeps
-- the prior grants on its own -- but this REVOKE/GRANT block re-asserts the
-- final privilege explicitly anyway, exactly like 0051/0052 already do,
-- never trusting CREATE OR REPLACE's grant-preservation behavior alone).
revoke all on function public.portal_register_business_lead_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,text,text) from public,anon,authenticated;
revoke all on function public.portal_propose_business_meeting_slots_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,integer,text,jsonb,text,text) from public,anon,authenticated;
revoke all on function public.portal_reserve_business_meeting_slot_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text) from public,anon,authenticated;
revoke all on function public.portal_connect_google_calendar_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,text,text) from public,anon,authenticated;

grant execute on function public.portal_register_business_lead_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,text,text) to service_role;
grant execute on function public.portal_propose_business_meeting_slots_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,integer,text,jsonb,text,text) to service_role;
grant execute on function public.portal_reserve_business_meeting_slot_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text) to service_role;
grant execute on function public.portal_connect_google_calendar_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,text,text) to service_role;

-- portal_schema_capabilities_service() is deliberately left untouched (no
-- version bump, no new capability key). This migration is a narrow
-- constraint/validation correction, the same shape as 0033/0035/0036/0037/
-- 0038 (cost reconciliation, ingest concurrency, source-name uniqueness,
-- agent-status concurrency, checkBudget aggregation) -- none of which bumped
-- the capability version either. The version WAS bumped for 0044/0045/0046/
-- 0048 (and 0043/0047 before them), but those all closed a gap where a
-- caller genuinely needs to detect at runtime whether the fix is live (an
-- ambiguous RPC overload, a stuck timestamp fence, a termination race) --
-- there is no such caller here. No code path branches on "is the e-mail
-- length bound applied yet"; the RPCs simply reject a small class of inputs
-- they previously accepted. Bumping the version for every constraint
-- tightening would also cheapen the signal the version number gives for the
-- cases that actually need it.
commit;
