-- M6-01: durable, tenant-scoped terminal meeting notifications.
-- This migration replaces claim-before-send with a bounded transactional
-- outbox. It does not backfill or resend historical terminal meetings.
begin;

alter table public.meeting_bot_sessions
  add constraint meeting_bot_sessions_tenant_id_id_key unique (tenant_id,id);

alter table public.recall_webhook_deliveries
  add column terminal_resolution text,
  add column terminal_resolved_at timestamptz,
  add constraint recall_webhook_terminal_resolution_chk check (
    terminal_resolution is null or terminal_resolution in (
      'matched_session','orphaned_deadline','matched_late','reservation_mismatch'
    )
  ),
  add constraint recall_webhook_terminal_resolution_pair_chk check (
    (terminal_resolution is null)=(terminal_resolved_at is null)
  ),
  add constraint recall_webhook_terminal_resolution_evidence_chk check (
    terminal_resolution is null
    or (provider_bot_id is not null and terminal_status in ('ended','failed'))
  );

create table public.meeting_terminal_notification_outbox (
  id app.uuid_v7 primary key,
  tenant_id app.uuid_v7 not null,
  meeting_session_id app.uuid_v7 not null,
  terminal_status text not null,
  template_version integer not null default 1,
  provider text not null default 'resend',
  provider_idempotency_key text not null unique,
  status text not null default 'pending',
  attempts integer not null default 0,
  recipient_count integer not null,
  available_at timestamptz not null default now(),
  dispatch_deadline_at timestamptz not null default now()+interval '23 hours',
  lease_token app.uuid_v7,
  lease_until timestamptz,
  dispatch_started_at timestamptz,
  provider_accepted_at timestamptz,
  provider_receipt_digest text,
  ambiguous_at timestamptz,
  dead_lettered_at timestamptz,
  suppressed_at timestamptz,
  last_failure_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id,id),
  unique (tenant_id,meeting_session_id),
  foreign key (tenant_id,meeting_session_id)
    references public.meeting_bot_sessions(tenant_id,id) on delete restrict,
  constraint meeting_terminal_notification_identity_chk check (id=meeting_session_id),
  constraint meeting_terminal_notification_terminal_status_chk check (terminal_status in ('ended','failed')),
  constraint meeting_terminal_notification_template_chk check (template_version=1),
  constraint meeting_terminal_notification_provider_chk check (provider='resend'),
  constraint meeting_terminal_notification_idempotency_chk check (
    provider_idempotency_key='meeting-terminal:v1:'||meeting_session_id::text
    and char_length(provider_idempotency_key)<=256
  ),
  constraint meeting_terminal_notification_status_chk check (
    status in ('pending','delivering','retry_wait','ambiguous','provider_accepted','simulated','dead_letter','suppressed')
  ),
  constraint meeting_terminal_notification_attempts_chk check (attempts between 0 and 8),
  constraint meeting_terminal_notification_recipient_count_chk check (
    recipient_count between 0 and 50
    and (status<>'suppressed' or recipient_count=0)
    and (status not in ('pending','delivering','retry_wait','ambiguous','provider_accepted','simulated') or recipient_count>0)
  ),
  constraint meeting_terminal_notification_lease_chk check (
    (status='delivering')=(lease_token is not null and lease_until is not null)
  ),
  constraint meeting_terminal_notification_acceptance_chk check (
    (status in ('provider_accepted','simulated'))=
      (provider_accepted_at is not null and provider_receipt_digest is not null)
  ),
  constraint meeting_terminal_notification_receipt_digest_chk check (
    provider_receipt_digest is null or provider_receipt_digest ~ '^[0-9a-f]{64}$'
  ),
  constraint meeting_terminal_notification_dead_letter_chk check (
    (status='dead_letter')=(dead_lettered_at is not null)
  ),
  constraint meeting_terminal_notification_suppressed_chk check (
    (status='suppressed')=(suppressed_at is not null)
  ),
  constraint meeting_terminal_notification_deadline_chk check (
    dispatch_deadline_at>created_at and dispatch_deadline_at<=created_at+interval '23 hours'
  ),
  constraint meeting_terminal_notification_failure_code_chk check (
    last_failure_code is null or last_failure_code in (
      'provider_rate_limited','provider_unavailable','provider_timeout','transport_unknown',
      'payload_invalid','recipient_invalid','provider_rejected','provider_not_configured',
      'provider_receipt_invalid','idempotency_conflict','no_recipients',
      'recipient_authority_changed','attempt_budget_exhausted',
      'idempotency_window_expired','lease_expired'
    )
  )
);

create index meeting_terminal_notification_dispatch_idx
  on public.meeting_terminal_notification_outbox(available_at,id)
  where status in ('pending','retry_wait','ambiguous');

create table public.meeting_terminal_notification_payloads (
  tenant_id app.uuid_v7 not null,
  notification_id app.uuid_v7 not null,
  recipient_emails text[] not null,
  workspace_name text not null,
  agent_name text not null,
  subject text,
  html text,
  payload_fingerprint text,
  frozen_at timestamptz,
  purge_after timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id,notification_id),
  foreign key (tenant_id,notification_id)
    references public.meeting_terminal_notification_outbox(tenant_id,id) on delete restrict,
  constraint meeting_terminal_notification_payload_recipients_chk check (
    cardinality(recipient_emails) between 1 and 50
  ),
  constraint meeting_terminal_notification_payload_names_chk check (
    char_length(workspace_name) between 1 and 160
    and char_length(agent_name) between 1 and 160
  ),
  constraint meeting_terminal_notification_payload_size_chk check (
    (subject is null or char_length(subject) between 1 and 200)
    and (html is null or char_length(html) between 1 and 20000)
  ),
  constraint meeting_terminal_notification_payload_fingerprint_chk check (
    payload_fingerprint is null or payload_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  constraint meeting_terminal_notification_payload_frozen_chk check (
    (frozen_at is null and subject is null and html is null and payload_fingerprint is null)
    or (frozen_at is not null and subject is not null and html is not null and payload_fingerprint is not null)
  )
);

create table public.meeting_terminal_notification_attempt_receipts (
  schema_version text not null default '2.0.0',
  tenant_id app.uuid_v7 not null,
  notification_id app.uuid_v7 not null,
  meeting_session_id app.uuid_v7 not null,
  attempt integer not null,
  recipient_count integer not null,
  outcome text not null,
  failure_code text,
  provider_receipt_digest text,
  observed_at timestamptz not null default now(),
  data_classification text not null default 'internal',
  primary key (tenant_id,notification_id,attempt),
  foreign key (tenant_id,notification_id)
    references public.meeting_terminal_notification_outbox(tenant_id,id) on delete restrict,
  constraint meeting_terminal_notification_receipt_session_chk check (notification_id=meeting_session_id),
  constraint meeting_terminal_notification_receipt_schema_chk check (schema_version='2.0.0'),
  constraint meeting_terminal_notification_receipt_attempt_chk check (attempt between 0 and 8),
  constraint meeting_terminal_notification_receipt_recipient_count_chk check (recipient_count between 0 and 50),
  constraint meeting_terminal_notification_receipt_classification_chk check (data_classification='internal'),
  constraint meeting_terminal_notification_receipt_outcome_chk check (
    outcome in ('provider_accepted','simulated','retry_scheduled','dead_lettered','ambiguous','lease_expired','suppressed')
  ),
  constraint meeting_terminal_notification_receipt_failure_chk check (
    failure_code is null or failure_code in (
      'provider_rate_limited','provider_unavailable','provider_timeout','transport_unknown',
      'payload_invalid','recipient_invalid','provider_rejected','provider_not_configured',
      'provider_receipt_invalid','idempotency_conflict','no_recipients',
      'recipient_authority_changed','attempt_budget_exhausted',
      'idempotency_window_expired','lease_expired'
    )
  ),
  constraint meeting_terminal_notification_receipt_digest_chk check (
    provider_receipt_digest is null or provider_receipt_digest ~ '^[0-9a-f]{64}$'
  ),
  constraint meeting_terminal_notification_receipt_semantics_chk check (
    (outcome in ('provider_accepted','simulated') and attempt between 1 and 8
      and recipient_count between 1 and 50 and failure_code is null and provider_receipt_digest is not null)
    or (outcome='suppressed' and failure_code='no_recipients'
      and attempt between 0 and 8 and recipient_count=0 and provider_receipt_digest is null)
    or (outcome='retry_scheduled' and attempt between 1 and 7
      and recipient_count between 1 and 50
      and failure_code in ('provider_rate_limited','provider_unavailable','provider_not_configured')
      and provider_receipt_digest is null)
    or (outcome='dead_lettered' and attempt between 1 and 8
      and failure_code in (
        'payload_invalid','recipient_invalid','recipient_authority_changed',
        'provider_rejected','idempotency_conflict','attempt_budget_exhausted',
        'idempotency_window_expired'
      ) and provider_receipt_digest is null)
    or (outcome='ambiguous' and attempt between 1 and 7
      and recipient_count between 1 and 50
      and failure_code in ('provider_timeout','transport_unknown','provider_receipt_invalid')
      and provider_receipt_digest is null)
    or (outcome='lease_expired' and attempt between 1 and 7
      and recipient_count between 1 and 50 and failure_code='lease_expired'
      and provider_receipt_digest is null)
  )
);

alter table public.meeting_terminal_notification_outbox enable row level security;
alter table public.meeting_terminal_notification_outbox force row level security;
alter table public.meeting_terminal_notification_payloads enable row level security;
alter table public.meeting_terminal_notification_payloads force row level security;
alter table public.meeting_terminal_notification_attempt_receipts enable row level security;
alter table public.meeting_terminal_notification_attempt_receipts force row level security;
revoke all on table public.meeting_terminal_notification_outbox from public,anon,authenticated,service_role;
revoke all on table public.meeting_terminal_notification_payloads from public,anon,authenticated,service_role;
revoke all on table public.meeting_terminal_notification_attempt_receipts from public,anon,authenticated,service_role;

create or replace function app.meeting_notification_recipients_valid(p_recipients text[])
returns boolean language sql immutable set search_path='' as $$
  select cardinality(p_recipients) between 1 and 50
    and array_ndims(p_recipients)=1
    and array_position(p_recipients,null) is null
    and coalesce((select bool_and(
      value=lower(btrim(value))
      and char_length(value) between 3 and 320
      and value ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    ) from unnest(p_recipients) value),false)
    and cardinality(p_recipients)=cardinality(array(select distinct value from unnest(p_recipients) value))
$$;
revoke all on function app.meeting_notification_recipients_valid(text[]) from public,anon,authenticated,service_role;

alter table public.meeting_terminal_notification_payloads
  add constraint meeting_terminal_notification_payload_email_chk
  check (app.meeting_notification_recipients_valid(recipient_emails));

create or replace function app.prevent_frozen_meeting_notification_payload_mutation()
returns trigger language plpgsql set search_path='' as $$
begin
  if old.frozen_at is not null and (
    new.recipient_emails is distinct from old.recipient_emails
    or new.workspace_name is distinct from old.workspace_name
    or new.agent_name is distinct from old.agent_name
    or new.subject is distinct from old.subject
    or new.html is distinct from old.html
    or new.payload_fingerprint is distinct from old.payload_fingerprint
    or new.frozen_at is distinct from old.frozen_at
  ) then
    raise exception 'frozen meeting notification payload is immutable' using errcode='55000';
  end if;
  return new;
end; $$;
revoke all on function app.prevent_frozen_meeting_notification_payload_mutation() from public,anon,authenticated,service_role;
create trigger meeting_terminal_notification_payload_immutable
  before update on public.meeting_terminal_notification_payloads
  for each row execute function app.prevent_frozen_meeting_notification_payload_mutation();

create or replace function app.prevent_meeting_notification_receipt_mutation()
returns trigger language plpgsql set search_path='' as $$
begin
  raise exception 'meeting notification receipts are append-only' using errcode='55000';
end; $$;
revoke all on function app.prevent_meeting_notification_receipt_mutation() from public,anon,authenticated,service_role;
create trigger meeting_terminal_notification_receipt_append_only
  before update or delete on public.meeting_terminal_notification_attempt_receipts
  for each row execute function app.prevent_meeting_notification_receipt_mutation();

-- Existing terminal sessions have an unknown legacy delivery result. They are
-- deliberately fenced from automatic backfill.
update public.meeting_bot_sessions
set terminal_notification_claimed_at=coalesce(terminal_notification_claimed_at,now())
where status in ('ended','failed');

create or replace function app.portal_enqueue_meeting_terminal_notification(
  p_tenant_id app.uuid_v7,
  p_meeting_session_id app.uuid_v7,
  p_terminal_status text,
  p_occurred_at timestamptz
) returns boolean language plpgsql security definer set search_path='' as $$
declare
  v_session public.meeting_bot_sessions%rowtype;
  v_workspace text;
  v_agent text;
  v_recipients text[];
  v_existing public.meeting_terminal_notification_outbox%rowtype;
  v_inserted boolean;
begin
  if p_terminal_status not in ('ended','failed') or p_occurred_at is null then
    raise exception 'invalid terminal notification command' using errcode='22023';
  end if;
  select * into v_session from public.meeting_bot_sessions
    where tenant_id=p_tenant_id and id=p_meeting_session_id for update;
  if not found or v_session.status is distinct from p_terminal_status then
    raise exception 'terminal meeting session required' using errcode='23514';
  end if;
  if v_session.terminal_notification_claimed_at is not null
    and not exists(select 1 from public.meeting_terminal_notification_outbox where tenant_id=p_tenant_id and id=p_meeting_session_id) then
    return false;
  end if;

  select left(coalesce(nullif(btrim(t.legal_name),''),'Workspace'),160),
         left(coalesce(nullif(btrim(a.name),''),'Agente'),160)
    into v_workspace,v_agent
  from public.tenants t
  join public.agents a on a.tenant_id=t.id and a.id=v_session.agent_id
  where t.id=p_tenant_id;
  if not found then raise exception 'tenant agent context missing' using errcode='23514'; end if;

  select coalesce(array_agg(email order by email),'{}'::text[]) into v_recipients
  from (
    select distinct lower(btrim(u.email)) as email
    from public.user_tenant_memberships m
    join auth.users u on u.id=m.user_id
    where m.tenant_id=p_tenant_id and m.role='tenant_admin'
      and u.email is not null and char_length(lower(btrim(u.email))) between 3 and 320
      and lower(btrim(u.email)) ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    order by email
    limit 50
  ) recipients;

  insert into public.meeting_terminal_notification_outbox(
    id,tenant_id,meeting_session_id,terminal_status,provider_idempotency_key,
    status,recipient_count,suppressed_at,last_failure_code,
    created_at,updated_at,available_at,dispatch_deadline_at
  ) values(
    p_meeting_session_id,p_tenant_id,p_meeting_session_id,p_terminal_status,
    'meeting-terminal:v1:'||p_meeting_session_id::text,
    case when cardinality(v_recipients)=0 then 'suppressed' else 'pending' end,
    cardinality(v_recipients),
    case when cardinality(v_recipients)=0 then p_occurred_at else null end,
    case when cardinality(v_recipients)=0 then 'no_recipients' else null end,
    p_occurred_at,p_occurred_at,p_occurred_at,p_occurred_at+interval '23 hours'
  ) on conflict (id) do nothing;
  get diagnostics v_inserted=row_count;

  if not v_inserted then
    select * into v_existing from public.meeting_terminal_notification_outbox
      where tenant_id=p_tenant_id and id=p_meeting_session_id;
    if not found or v_existing.meeting_session_id is distinct from p_meeting_session_id
      or v_existing.terminal_status is distinct from p_terminal_status
      or v_existing.template_version<>1 or v_existing.provider<>'resend'
      or v_existing.provider_idempotency_key is distinct from 'meeting-terminal:v1:'||p_meeting_session_id::text then
      raise exception 'terminal notification replay conflict' using errcode='23505';
    end if;
    return false;
  end if;

  if cardinality(v_recipients)=0 then
    insert into public.meeting_terminal_notification_attempt_receipts(
      tenant_id,notification_id,meeting_session_id,attempt,recipient_count,
      outcome,failure_code,observed_at
    ) values(
      p_tenant_id,p_meeting_session_id,p_meeting_session_id,0,0,
      'suppressed','no_recipients',p_occurred_at
    );
  else
    insert into public.meeting_terminal_notification_payloads(
      tenant_id,notification_id,recipient_emails,workspace_name,agent_name,created_at,updated_at
    ) values(p_tenant_id,p_meeting_session_id,v_recipients,v_workspace,v_agent,p_occurred_at,p_occurred_at);
  end if;
  update public.meeting_bot_sessions set terminal_notification_claimed_at=p_occurred_at
    where tenant_id=p_tenant_id and id=p_meeting_session_id and terminal_notification_claimed_at is null;
  return true;
end; $$;
revoke all on function app.portal_enqueue_meeting_terminal_notification(app.uuid_v7,app.uuid_v7,text,timestamp with time zone) from public,anon,authenticated,service_role;

create or replace function public.portal_lease_meeting_terminal_notifications_service(
  p_lease_token app.uuid_v7,
  p_limit integer default 20,
  p_lease_seconds integer default 60
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_expired record;
  v_candidate record;
  v_recipients text[];
  v_attempt integer;
  v_terminal boolean;
  v_outcome text;
  v_failure text;
  v_rows jsonb:='[]'::jsonb;
begin
  if p_limit not between 1 and 50 or p_lease_seconds not between 15 and 300 then
    raise exception 'invalid lease parameters' using errcode='22023';
  end if;

  for v_expired in
    select o.* from public.meeting_terminal_notification_outbox o
    where o.status='delivering' and o.lease_until<=now()
    order by o.lease_until,o.id limit p_limit for update skip locked
  loop
    v_terminal:=v_expired.attempts>=8 or v_expired.dispatch_deadline_at<=now();
    v_failure:=case
      when v_expired.dispatch_deadline_at<=now() then 'idempotency_window_expired'
      when v_expired.attempts>=8 then 'attempt_budget_exhausted'
      when v_expired.dispatch_started_at is not null then 'transport_unknown'
      else 'lease_expired'
    end;
    v_outcome:=case
      when v_terminal then 'dead_lettered'
      when v_expired.dispatch_started_at is not null then 'ambiguous'
      else 'lease_expired'
    end;
    insert into public.meeting_terminal_notification_attempt_receipts(
      tenant_id,notification_id,meeting_session_id,attempt,recipient_count,
      outcome,failure_code,observed_at
    ) values(
      v_expired.tenant_id,v_expired.id,v_expired.meeting_session_id,v_expired.attempts,
      v_expired.recipient_count,v_outcome,v_failure,now()
    ) on conflict do nothing;
    update public.meeting_terminal_notification_outbox set
      status=case when v_terminal then 'dead_letter'
        when dispatch_started_at is not null then 'ambiguous' else 'retry_wait' end,
      available_at=now(),lease_token=null,lease_until=null,
      ambiguous_at=case when dispatch_started_at is not null then coalesce(ambiguous_at,now()) else ambiguous_at end,
      dead_lettered_at=case when v_terminal then now() else null end,
      last_failure_code=v_failure,dispatch_started_at=null,updated_at=now()
    where tenant_id=v_expired.tenant_id and id=v_expired.id;
    if v_terminal then
      update public.meeting_terminal_notification_payloads set purge_after=coalesce(purge_after,now()+interval '30 days'),updated_at=now()
        where tenant_id=v_expired.tenant_id and notification_id=v_expired.id;
    end if;
  end loop;

  for v_expired in
    select o.* from public.meeting_terminal_notification_outbox o
    where o.status in ('pending','retry_wait','ambiguous') and o.dispatch_deadline_at<=now()
    order by o.dispatch_deadline_at,o.id limit p_limit for update skip locked
  loop
    v_attempt:=least(v_expired.attempts+1,8);
    insert into public.meeting_terminal_notification_attempt_receipts(
      tenant_id,notification_id,meeting_session_id,attempt,recipient_count,
      outcome,failure_code,observed_at
    ) values(
      v_expired.tenant_id,v_expired.id,v_expired.meeting_session_id,v_attempt,
      v_expired.recipient_count,'dead_lettered','idempotency_window_expired',now()
    ) on conflict do nothing;
    update public.meeting_terminal_notification_outbox set
      status='dead_letter',attempts=v_attempt,dead_lettered_at=now(),
      last_failure_code='idempotency_window_expired',updated_at=now()
    where tenant_id=v_expired.tenant_id and id=v_expired.id;
    update public.meeting_terminal_notification_payloads set purge_after=coalesce(purge_after,now()+interval '30 days'),updated_at=now()
      where tenant_id=v_expired.tenant_id and notification_id=v_expired.id;
  end loop;

  for v_candidate in
    select
      o.id,o.tenant_id,o.meeting_session_id,o.terminal_status,o.template_version,
      o.provider,o.provider_idempotency_key,o.attempts,o.dispatch_deadline_at,
      p.recipient_emails,p.workspace_name,p.agent_name,p.subject,p.html,
      p.payload_fingerprint,p.frozen_at
    from public.meeting_terminal_notification_outbox o
    join public.meeting_terminal_notification_payloads p
      on p.tenant_id=o.tenant_id and p.notification_id=o.id
    where o.status in ('pending','retry_wait','ambiguous')
      and o.available_at<=now() and o.dispatch_deadline_at>now() and o.attempts<8
    order by o.available_at,o.id limit p_limit for update of o skip locked
  loop
    select coalesce(array_agg(email order by email),'{}'::text[]) into v_recipients
    from (
      select distinct lower(btrim(u.email)) as email
      from public.user_tenant_memberships m
      join auth.users u on u.id=m.user_id
      where m.tenant_id=v_candidate.tenant_id and m.role='tenant_admin'
        and u.email is not null and char_length(lower(btrim(u.email))) between 3 and 320
        and lower(btrim(u.email)) ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
      order by email
      limit 50
    ) recipients;

    if v_candidate.frozen_at is not null
      and v_recipients is distinct from v_candidate.recipient_emails then
      v_attempt:=v_candidate.attempts+1;
      update public.meeting_terminal_notification_outbox set
        status='dead_letter',attempts=v_attempt,recipient_count=cardinality(v_recipients),
        dead_lettered_at=now(),last_failure_code='recipient_authority_changed',updated_at=now()
      where tenant_id=v_candidate.tenant_id and id=v_candidate.id;
      insert into public.meeting_terminal_notification_attempt_receipts(
        tenant_id,notification_id,meeting_session_id,attempt,recipient_count,
        outcome,failure_code,observed_at
      ) values(
        v_candidate.tenant_id,v_candidate.id,v_candidate.meeting_session_id,v_attempt,
        cardinality(v_recipients),'dead_lettered','recipient_authority_changed',now()
      );
      update public.meeting_terminal_notification_payloads set
        purge_after=coalesce(purge_after,now()+interval '30 days'),updated_at=now()
      where tenant_id=v_candidate.tenant_id and notification_id=v_candidate.id;
      continue;
    end if;

    if v_candidate.frozen_at is null then
      if cardinality(v_recipients)=0 then
        v_attempt:=v_candidate.attempts+1;
        update public.meeting_terminal_notification_outbox set
          status='suppressed',attempts=v_attempt,recipient_count=0,suppressed_at=now(),
          last_failure_code='no_recipients',updated_at=now()
        where tenant_id=v_candidate.tenant_id and id=v_candidate.id;
        insert into public.meeting_terminal_notification_attempt_receipts(
          tenant_id,notification_id,meeting_session_id,attempt,recipient_count,
          outcome,failure_code,observed_at
        ) values(
          v_candidate.tenant_id,v_candidate.id,v_candidate.meeting_session_id,v_attempt,0,
          'suppressed','no_recipients',now()
        );
        update public.meeting_terminal_notification_payloads set purge_after=now(),updated_at=now()
          where tenant_id=v_candidate.tenant_id and notification_id=v_candidate.id;
        continue;
      end if;
      update public.meeting_terminal_notification_payloads set
        recipient_emails=v_recipients,updated_at=now()
      where tenant_id=v_candidate.tenant_id and notification_id=v_candidate.id;
    else
      v_recipients:=v_candidate.recipient_emails;
    end if;

    v_attempt:=v_candidate.attempts+1;
    update public.meeting_terminal_notification_outbox set
      status='delivering',attempts=v_attempt,recipient_count=cardinality(v_recipients),
      lease_token=p_lease_token,
      lease_until=now()+make_interval(secs=>p_lease_seconds),
      dispatch_started_at=null,updated_at=now()
    where tenant_id=v_candidate.tenant_id and id=v_candidate.id;

    v_rows:=v_rows||jsonb_build_array(jsonb_build_object(
      'schema_version','2.0.0',
      'command_id',v_candidate.id,
      'tenant_id',v_candidate.tenant_id,
      'meeting_session_id',v_candidate.meeting_session_id,
      'terminal_status',v_candidate.terminal_status,
      'template_version',v_candidate.template_version,
      'provider',v_candidate.provider,
      'provider_idempotency_key',v_candidate.provider_idempotency_key,
      'attempt',v_attempt,
      'dispatch_deadline_at',to_char(v_candidate.dispatch_deadline_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'recipient_emails',to_jsonb(v_recipients),
      'workspace_name',v_candidate.workspace_name,
      'agent_name',v_candidate.agent_name,
      'payload_frozen',v_candidate.frozen_at is not null,
      'subject',v_candidate.subject,
      'html',v_candidate.html,
      'payload_fingerprint',v_candidate.payload_fingerprint,
      'data_classification','restricted'
    ));
  end loop;
  return v_rows;
end; $$;

create or replace function public.portal_begin_meeting_terminal_notification_dispatch_service(
  p_tenant_id app.uuid_v7,
  p_notification_id app.uuid_v7,
  p_lease_token app.uuid_v7,
  p_subject text,
  p_html text,
  p_payload_fingerprint text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_outbox public.meeting_terminal_notification_outbox%rowtype;
  v_payload public.meeting_terminal_notification_payloads%rowtype;
  v_recipients text[];
  v_expected text;
begin
  if char_length(p_subject) not between 1 and 200 or char_length(p_html) not between 1 and 20000
    or p_payload_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid frozen provider payload' using errcode='22023';
  end if;
  select o.* into v_outbox from public.meeting_terminal_notification_outbox o
    where o.tenant_id=p_tenant_id and o.id=p_notification_id
      and o.status='delivering' and o.lease_token=p_lease_token and o.lease_until>now()
    for update;
  if not found then
    return jsonb_build_object('begun',false,'terminal',false,'failureCode',null);
  end if;
  select * into v_payload from public.meeting_terminal_notification_payloads
    where tenant_id=p_tenant_id and notification_id=p_notification_id for update;
  if not found then raise exception 'notification payload missing' using errcode='23514'; end if;

  select coalesce(array_agg(email order by email),'{}'::text[]) into v_recipients
  from (
    select distinct lower(btrim(u.email)) as email
    from public.user_tenant_memberships m
    join auth.users u on u.id=m.user_id
    where m.tenant_id=p_tenant_id and m.role='tenant_admin'
      and u.email is not null and char_length(lower(btrim(u.email))) between 3 and 320
      and lower(btrim(u.email)) ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    order by email
    limit 50
  ) recipients;
  if v_recipients is distinct from v_payload.recipient_emails then
    update public.meeting_terminal_notification_outbox set
      status='dead_letter',recipient_count=cardinality(v_recipients),
      lease_token=null,lease_until=null,dispatch_started_at=null,
      dead_lettered_at=now(),last_failure_code='recipient_authority_changed',updated_at=now()
    where tenant_id=p_tenant_id and id=p_notification_id;
    insert into public.meeting_terminal_notification_attempt_receipts(
      tenant_id,notification_id,meeting_session_id,attempt,recipient_count,
      outcome,failure_code,observed_at
    ) values(
      v_outbox.tenant_id,v_outbox.id,v_outbox.meeting_session_id,v_outbox.attempts,
      cardinality(v_recipients),'dead_lettered','recipient_authority_changed',now()
    );
    update public.meeting_terminal_notification_payloads set
      purge_after=coalesce(purge_after,now()+interval '30 days'),updated_at=now()
    where tenant_id=p_tenant_id and notification_id=p_notification_id;
    return jsonb_build_object(
      'begun',false,'terminal',true,'failureCode','recipient_authority_changed'
    );
  end if;
  v_expected:=app.sha256_tuple(
    array_to_string(v_payload.recipient_emails,E'\n'),p_subject,p_html,v_outbox.provider_idempotency_key
  );
  if v_expected is distinct from p_payload_fingerprint then
    raise exception 'provider payload fingerprint mismatch' using errcode='23514';
  end if;
  if v_payload.frozen_at is not null then
    if v_payload.subject is distinct from p_subject or v_payload.html is distinct from p_html
      or v_payload.payload_fingerprint is distinct from p_payload_fingerprint then
      raise exception 'frozen provider payload conflict' using errcode='23505';
    end if;
  else
    update public.meeting_terminal_notification_payloads set
      subject=p_subject,html=p_html,payload_fingerprint=p_payload_fingerprint,
      frozen_at=now(),updated_at=now()
    where tenant_id=p_tenant_id and notification_id=p_notification_id;
  end if;
  update public.meeting_terminal_notification_outbox set dispatch_started_at=now(),updated_at=now()
    where tenant_id=p_tenant_id and id=p_notification_id;
  return jsonb_build_object('begun',true,'terminal',false,'failureCode',null);
end; $$;

create or replace function public.portal_ack_meeting_terminal_notification_service(
  p_tenant_id app.uuid_v7,
  p_notification_id app.uuid_v7,
  p_lease_token app.uuid_v7,
  p_provider_receipt_digest text,
  p_simulated boolean default false
) returns boolean language plpgsql security definer set search_path='' as $$
declare v_outbox public.meeting_terminal_notification_outbox%rowtype; v_outcome text;
begin
  if p_simulated is null or p_provider_receipt_digest !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid provider receipt digest' using errcode='22023';
  end if;
  select * into v_outbox from public.meeting_terminal_notification_outbox
    where tenant_id=p_tenant_id and id=p_notification_id and status='delivering'
      and lease_token=p_lease_token and lease_until>now() for update;
  if not found or v_outbox.dispatch_started_at is null then return false; end if;
  v_outcome:=case when p_simulated then 'simulated' else 'provider_accepted' end;
  update public.meeting_terminal_notification_outbox set
    status=v_outcome,lease_token=null,lease_until=null,provider_accepted_at=now(),
    provider_receipt_digest=p_provider_receipt_digest,last_failure_code=null,updated_at=now()
  where tenant_id=p_tenant_id and id=p_notification_id;
  insert into public.meeting_terminal_notification_attempt_receipts(
    tenant_id,notification_id,meeting_session_id,attempt,recipient_count,
    outcome,failure_code,provider_receipt_digest,observed_at
  ) values(
    v_outbox.tenant_id,v_outbox.id,v_outbox.meeting_session_id,v_outbox.attempts,
    v_outbox.recipient_count,v_outcome,null,p_provider_receipt_digest,now()
  );
  update public.meeting_terminal_notification_payloads set purge_after=now()+interval '1 day',updated_at=now()
    where tenant_id=p_tenant_id and notification_id=p_notification_id;
  return true;
end; $$;

create or replace function public.portal_fail_meeting_terminal_notification_service(
  p_tenant_id app.uuid_v7,
  p_notification_id app.uuid_v7,
  p_lease_token app.uuid_v7,
  p_failure_code text,
  p_retry_seconds integer default 60
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_outbox public.meeting_terminal_notification_outbox%rowtype;
  v_status text;
  v_outcome text;
  v_failure text;
  v_terminal boolean;
begin
  if p_failure_code not in (
    'provider_rate_limited','provider_unavailable','provider_timeout','transport_unknown',
    'payload_invalid','recipient_invalid','provider_rejected','provider_not_configured',
    'provider_receipt_invalid','idempotency_conflict'
  ) or p_retry_seconds not between 0 and 3600 then
    raise exception 'invalid notification failure' using errcode='22023';
  end if;
  select * into v_outbox from public.meeting_terminal_notification_outbox
    where tenant_id=p_tenant_id and id=p_notification_id and status='delivering'
      and lease_token=p_lease_token and lease_until>now() for update;
  if not found then return jsonb_build_object('settled',false); end if;

  v_terminal:=p_failure_code in (
    'payload_invalid','recipient_invalid','provider_rejected','idempotency_conflict'
  ) or v_outbox.attempts>=8 or v_outbox.dispatch_deadline_at<=now();
  v_failure:=case
    when v_outbox.dispatch_deadline_at<=now() then 'idempotency_window_expired'
    when v_outbox.attempts>=8 then 'attempt_budget_exhausted'
    else p_failure_code
  end;
  if v_terminal then
    v_status:='dead_letter'; v_outcome:='dead_lettered';
  elsif p_failure_code in ('provider_timeout','transport_unknown','provider_receipt_invalid') then
    v_status:='ambiguous'; v_outcome:='ambiguous';
  else
    v_status:='retry_wait'; v_outcome:='retry_scheduled';
  end if;

  update public.meeting_terminal_notification_outbox set
    status=v_status,available_at=now()+make_interval(secs=>p_retry_seconds),
    lease_token=null,lease_until=null,dispatch_started_at=null,
    ambiguous_at=case when v_status='ambiguous' then coalesce(ambiguous_at,now()) else ambiguous_at end,
    dead_lettered_at=case when v_status='dead_letter' then now() else null end,
    last_failure_code=v_failure,updated_at=now()
  where tenant_id=p_tenant_id and id=p_notification_id;
  insert into public.meeting_terminal_notification_attempt_receipts(
    tenant_id,notification_id,meeting_session_id,attempt,recipient_count,
    outcome,failure_code,observed_at
  ) values(
    v_outbox.tenant_id,v_outbox.id,v_outbox.meeting_session_id,v_outbox.attempts,
    v_outbox.recipient_count,v_outcome,v_failure,now()
  );
  if v_status='dead_letter' then
    update public.meeting_terminal_notification_payloads set purge_after=coalesce(purge_after,now()+interval '30 days'),updated_at=now()
      where tenant_id=p_tenant_id and notification_id=p_notification_id;
  end if;
  return jsonb_build_object('settled',true,'status',v_status,'terminal',v_status='dead_letter');
end; $$;

create or replace function public.portal_meeting_terminal_notification_backlog_service()
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'pending',count(*) filter(where status='pending'),
    'delivering',count(*) filter(where status='delivering'),
    'retryWait',count(*) filter(where status='retry_wait'),
    'ambiguous',count(*) filter(where status='ambiguous'),
    'providerAccepted',count(*) filter(where status='provider_accepted'),
    'simulated',count(*) filter(where status='simulated'),
    'deadLetter',count(*) filter(where status='dead_letter'),
    'suppressed',count(*) filter(where status='suppressed'),
    'oldestDispatchableAgeSeconds',coalesce(floor(extract(epoch from now()-min(created_at) filter(
      where status in ('pending','retry_wait','ambiguous')
    )))::bigint,0)
  ) from public.meeting_terminal_notification_outbox
$$;

create or replace function public.portal_cleanup_meeting_terminal_notifications_service(p_limit integer default 500)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_deleted integer;
begin
  if p_limit not between 1 and 500 then raise exception 'invalid cleanup limit' using errcode='22023'; end if;
  with due as (
    select tenant_id,notification_id from public.meeting_terminal_notification_payloads
    where purge_after is not null and purge_after<=now()
    order by purge_after,notification_id limit p_limit for update skip locked
  )
  delete from public.meeting_terminal_notification_payloads p using due
    where p.tenant_id=due.tenant_id and p.notification_id=due.notification_id;
  get diagnostics v_deleted=row_count;
  return jsonb_build_object('deletedPayloads',v_deleted);
end; $$;

create or replace function public.portal_claim_meeting_terminal_notification_service(p_recall_bot_id text)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  if p_recall_bot_id is null or char_length(p_recall_bot_id)=0 then
    raise exception 'invalid recall bot id' using errcode='22023';
  end if;
  return false;
end; $$;

revoke all on function public.portal_lease_meeting_terminal_notifications_service(app.uuid_v7,integer,integer) from public,anon,authenticated,service_role;
revoke all on function public.portal_begin_meeting_terminal_notification_dispatch_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,text) from public,anon,authenticated,service_role;
revoke all on function public.portal_ack_meeting_terminal_notification_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text,boolean) from public,anon,authenticated,service_role;
revoke all on function public.portal_fail_meeting_terminal_notification_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text,integer) from public,anon,authenticated,service_role;
revoke all on function public.portal_meeting_terminal_notification_backlog_service() from public,anon,authenticated,service_role;
revoke all on function public.portal_cleanup_meeting_terminal_notifications_service(integer) from public,anon,authenticated,service_role;
revoke all on function public.portal_claim_meeting_terminal_notification_service(text) from public,anon,authenticated,service_role;
grant execute on function public.portal_lease_meeting_terminal_notifications_service(app.uuid_v7,integer,integer) to service_role;
grant execute on function public.portal_begin_meeting_terminal_notification_dispatch_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,text) to service_role;
grant execute on function public.portal_ack_meeting_terminal_notification_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text,boolean) to service_role;
grant execute on function public.portal_fail_meeting_terminal_notification_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text,integer) to service_role;
grant execute on function public.portal_meeting_terminal_notification_backlog_service() to service_role;
grant execute on function public.portal_cleanup_meeting_terminal_notifications_service(integer) to service_role;
grant execute on function public.portal_claim_meeting_terminal_notification_service(text) to service_role;

-- Preserve the proven v56 transition implementations behind private wrappers.
-- The public signatures remain unchanged and add the atomic enqueue contract.
alter function public.portal_update_meeting_bot_session_status_service(text,text,text,app.uuid_v7) set schema app;
alter function app.portal_update_meeting_bot_session_status_service(text,text,text,app.uuid_v7)
  rename to portal_update_meeting_bot_session_status_v56;
revoke all on function app.portal_update_meeting_bot_session_status_v56(text,text,text,app.uuid_v7) from public,anon,authenticated,service_role;

create or replace function public.portal_update_meeting_bot_session_status_service(
  p_recall_bot_id text,
  p_status text,
  p_delivery_id text default null,
  p_claim_token app.uuid_v7 default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_result jsonb;
  v_session public.meeting_bot_sessions%rowtype;
  v_session_found boolean:=false;
  v_delivery public.recall_webhook_deliveries%rowtype;
  v_enqueued boolean:=false;
  v_finalized boolean:=false;
begin
  if p_status in ('ended','failed') then
    perform pg_advisory_xact_lock(hashtextextended('recall-bot:'||p_recall_bot_id,0));
    select * into v_session from public.meeting_bot_sessions
      where recall_bot_id=p_recall_bot_id for update;
    v_session_found:=found;
    if v_session_found and not exists(
      select 1 from public.provider_effect_reservations r
      where r.tenant_id=v_session.tenant_id and r.id=v_session.recall_reservation_id
        and r.agent_id=v_session.agent_id and r.provider_id='recall'
        and r.provider_ref=p_recall_bot_id
        and r.state in ('committed','completed','cleanup_pending')
    ) then
      update public.recall_webhook_deliveries set
        provider_bot_id=p_recall_bot_id,terminal_status=p_status,
        terminal_resolution='reservation_mismatch',terminal_resolved_at=now(),updated_at=now()
      where delivery_id=p_delivery_id and claim_token=p_claim_token
        and status='processing' and lease_until>now() and tenant_id is null
        and (provider_bot_id is null or (provider_bot_id=p_recall_bot_id and terminal_status=p_status));
      if not found then
        raise exception 'terminal delivery claim receipt required' using errcode='55000';
      end if;
      return jsonb_build_object(
        'found',false,'applied',false,'terminalRetained',true,
        'notificationOutboxEnqueued',false,'terminalFinalized',true
      );
    end if;
  end if;
  v_result:=app.portal_update_meeting_bot_session_status_v56(
    p_recall_bot_id,p_status,p_delivery_id,p_claim_token
  );
  if p_status not in ('ended','failed') then return v_result; end if;

  select * into v_session from public.meeting_bot_sessions
    where recall_bot_id=p_recall_bot_id for update;
  if found then
    v_enqueued:=app.portal_enqueue_meeting_terminal_notification(
      v_session.tenant_id,v_session.id,v_session.status,coalesce(v_session.ended_at,now())
    );
    update public.recall_webhook_deliveries set
      tenant_id=coalesce(tenant_id,v_session.tenant_id),
      terminal_resolution=case
        when terminal_resolution in ('matched_late','orphaned_deadline') then 'matched_late'
        else coalesce(terminal_resolution,'matched_session')
      end,
      terminal_resolved_at=coalesce(terminal_resolved_at,now()),updated_at=now()
    where delivery_id=p_delivery_id and claim_token=p_claim_token and status='processing';
    return v_result||jsonb_build_object(
      'notificationOutboxEnqueued',v_enqueued,'terminalFinalized',true
    );
  end if;

  select * into v_delivery from public.recall_webhook_deliveries
    where delivery_id=p_delivery_id and claim_token=p_claim_token
      and status='processing' and lease_until>now() for update;
  if found and (v_delivery.attempts>=8 or v_delivery.created_at<=now()-interval '15 minutes') then
    update public.recall_webhook_deliveries set
      terminal_resolution='orphaned_deadline',terminal_resolved_at=now(),updated_at=now()
    where delivery_id=p_delivery_id and claim_token=p_claim_token
      and status='processing' and lease_until>now();
    v_finalized:=true;
  end if;
  return v_result||jsonb_build_object(
    'notificationOutboxEnqueued',false,'terminalFinalized',v_finalized
  );
end; $$;
revoke all on function public.portal_update_meeting_bot_session_status_service(text,text,text,app.uuid_v7) from public,anon,authenticated,service_role;
grant execute on function public.portal_update_meeting_bot_session_status_service(text,text,text,app.uuid_v7) to service_role;

alter function public.portal_record_meeting_bot_session_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,text,app.uuid_v7,app.uuid_v7) set schema app;
alter function app.portal_record_meeting_bot_session_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,text,app.uuid_v7,app.uuid_v7)
  rename to portal_record_meeting_bot_session_v56;
revoke all on function app.portal_record_meeting_bot_session_v56(app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,text,app.uuid_v7,app.uuid_v7) from public,anon,authenticated,service_role;

create or replace function public.portal_record_meeting_bot_session_service(
  p_id app.uuid_v7,
  p_tenant_id app.uuid_v7,
  p_agent_id app.uuid_v7,
  p_recall_bot_id text,
  p_meeting_ref text,
  p_tavus_conversation_id text,
  p_recall_reservation_id app.uuid_v7,
  p_tavus_reservation_id app.uuid_v7 default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_result jsonb;
  v_session public.meeting_bot_sessions%rowtype;
  v_enqueued boolean:=false;
begin
  perform pg_advisory_xact_lock(hashtextextended('recall-bot:'||p_recall_bot_id,0));
  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text,0));
  if not exists(
    select 1 from public.meeting_bot_sessions where recall_bot_id=p_recall_bot_id
  ) and not exists(
    select 1 from public.provider_effect_reservations
    where tenant_id=p_tenant_id and id=p_recall_reservation_id
      and agent_id=p_agent_id and provider_id='recall'
      and state='committed' and provider_ref=p_recall_bot_id
  ) then
    raise exception 'committed Recall reservation mismatch' using errcode='23514';
  end if;
  v_result:=app.portal_record_meeting_bot_session_v56(
    p_id,p_tenant_id,p_agent_id,p_recall_bot_id,p_meeting_ref,
    p_tavus_conversation_id,p_recall_reservation_id,p_tavus_reservation_id
  );
  select * into v_session from public.meeting_bot_sessions
    where tenant_id=p_tenant_id and id=p_id for update;
  if found and v_session.status in ('ended','failed') then
    v_enqueued:=app.portal_enqueue_meeting_terminal_notification(
      v_session.tenant_id,v_session.id,v_session.status,coalesce(v_session.ended_at,now())
    );
    update public.recall_webhook_deliveries set
      tenant_id=p_tenant_id,
      terminal_resolution=case
        when terminal_resolution='orphaned_deadline' then 'matched_late'
        else coalesce(terminal_resolution,'matched_session')
      end,
      terminal_resolved_at=case
        when terminal_resolution is null or terminal_resolution='orphaned_deadline' then now()
        else terminal_resolved_at
      end,
      updated_at=now()
    where provider_bot_id=p_recall_bot_id and terminal_status is not null;
  end if;
  return v_result||jsonb_build_object('notificationOutboxEnqueued',v_enqueued);
end; $$;
revoke all on function public.portal_record_meeting_bot_session_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,text,app.uuid_v7,app.uuid_v7) from public,anon,authenticated,service_role;
grant execute on function public.portal_record_meeting_bot_session_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,text,app.uuid_v7,app.uuid_v7) to service_role;

alter table public.worker_heartbeats drop constraint worker_heartbeat_name_chk;
alter table public.worker_heartbeats add constraint worker_heartbeat_name_chk
  check (worker_name in ('billing_usage','provider_effect_reconciler','meeting_terminal_notification'));

create or replace function public.portal_record_worker_heartbeat_service(
  p_worker_kind text,
  p_run_id app.uuid_v7,
  p_phase text,
  p_version text,
  p_deployment_id text,
  p_config_fingerprint text,
  p_counters jsonb default '{}'::jsonb
) returns boolean language plpgsql security definer set search_path='public' as $$
declare v public.worker_heartbeats%rowtype;
begin
  if p_worker_kind not in ('billing_usage','provider_effect_reconciler','meeting_terminal_notification')
    or p_phase not in ('started','succeeded','failed')
    or p_version !~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,79}$'
    or jsonb_typeof(p_counters) is distinct from 'object'
    or p_deployment_id !~ '^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$'
    or p_config_fingerprint !~ '^sha256:[0-9a-f]{64}$'
    or pg_column_size(p_counters)>4096
    or (p_phase<>'succeeded' and p_counters<>'{}'::jsonb) then
    raise exception 'invalid worker heartbeat' using errcode='22023';
  end if;
  select * into v from public.worker_heartbeats where worker_name=p_worker_kind for update;
  if found and v.run_id=p_run_id and v.status=p_phase and v.version=p_version
    and v.deployment_id=p_deployment_id and v.config_fingerprint=p_config_fingerprint
    and v.counters=p_counters then return true; end if;
  if found and v.run_id=p_run_id and not (
    v.status='started' and p_phase in ('succeeded','failed') and v.version=p_version
      and v.deployment_id=p_deployment_id and v.config_fingerprint=p_config_fingerprint
  ) then raise exception 'worker heartbeat replay conflict' using errcode='23505'; end if;
  if p_phase='started' then
    if found and p_run_id::text<=v.run_id::text then
      raise exception 'worker heartbeat run is stale' using errcode='23505';
    end if;
    insert into public.worker_heartbeats(
      worker_name,run_id,version,deployment_id,config_fingerprint,status,started_at,succeeded_at,counters
    ) values(
      p_worker_kind,p_run_id,p_version,p_deployment_id,p_config_fingerprint,'started',now(),null,p_counters
    ) on conflict(worker_name) do update set
      run_id=excluded.run_id,version=excluded.version,deployment_id=excluded.deployment_id,
      config_fingerprint=excluded.config_fingerprint,status='started',started_at=now(),
      succeeded_at=null,counters=excluded.counters,updated_at=now();
  elsif p_phase='succeeded' then
    if not found or v.run_id<>p_run_id or v.status<>'started' then
      raise exception 'worker success has no matching run' using errcode='55000';
    end if;
    update public.worker_heartbeats set
      status='succeeded',succeeded_at=now(),last_succeeded_at=now(),
      last_succeeded_version=p_version,last_succeeded_deployment_id=p_deployment_id,
      last_succeeded_config_fingerprint=p_config_fingerprint,counters=p_counters,updated_at=now()
    where worker_name=p_worker_kind;
  else
    if not found or v.run_id<>p_run_id or v.status<>'started' then
      raise exception 'worker failure has no matching run' using errcode='55000';
    end if;
    update public.worker_heartbeats set status='failed',succeeded_at=null,counters=p_counters,updated_at=now()
      where worker_name=p_worker_kind;
  end if;
  return true;
end; $$;

create or replace function public.portal_worker_readiness_service()
returns jsonb language sql stable security definer set search_path='public' as $$
  select jsonb_build_object(
    'billingUsage',coalesce((select jsonb_build_object(
      'lastSucceededAt',last_succeeded_at,
      'ageSeconds',case when last_succeeded_at is null then null else floor(extract(epoch from now()-last_succeeded_at))::bigint end,
      'version',last_succeeded_version,'deploymentId',last_succeeded_deployment_id,
      'configFingerprint',last_succeeded_config_fingerprint
    ) from public.worker_heartbeats where worker_name='billing_usage'),'null'::jsonb),
    'providerEffectReconciler',coalesce((select jsonb_build_object(
      'lastSucceededAt',last_succeeded_at,
      'ageSeconds',case when last_succeeded_at is null then null else floor(extract(epoch from now()-last_succeeded_at))::bigint end,
      'version',last_succeeded_version,'deploymentId',last_succeeded_deployment_id,
      'configFingerprint',last_succeeded_config_fingerprint
    ) from public.worker_heartbeats where worker_name='provider_effect_reconciler'),'null'::jsonb),
    'meetingTerminalNotification',coalesce((select jsonb_build_object(
      'lastSucceededAt',last_succeeded_at,
      'ageSeconds',case when last_succeeded_at is null then null else floor(extract(epoch from now()-last_succeeded_at))::bigint end,
      'version',last_succeeded_version,'deploymentId',last_succeeded_deployment_id,
      'configFingerprint',last_succeeded_config_fingerprint
    ) from public.worker_heartbeats where worker_name='meeting_terminal_notification'),'null'::jsonb)
  )
$$;
revoke all on function public.portal_record_worker_heartbeat_service(text,app.uuid_v7,text,text,text,text,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.portal_worker_readiness_service() from public,anon,authenticated,service_role;
grant execute on function public.portal_record_worker_heartbeat_service(text,app.uuid_v7,text,text,text,text,jsonb) to service_role;
grant execute on function public.portal_worker_readiness_service() to service_role;

-- Extend the v56 capability document without copying its large immutable body.
alter function public.portal_schema_capabilities_service() set schema app;
alter function app.portal_schema_capabilities_service() rename to portal_schema_capabilities_v56;
revoke all on function app.portal_schema_capabilities_v56() from public,anon,authenticated,service_role;

create or replace function public.portal_schema_capabilities_service()
returns jsonb language sql stable security definer set search_path='' as $$
  select (app.portal_schema_capabilities_v56()-'version'-'meetingTerminalNotificationClaim')
    || jsonb_build_object(
      'version',57,
      'meetingTerminalNotificationClaim',false,
      'meetingTerminalNotificationOutbox',
        to_regclass('public.meeting_terminal_notification_outbox') is not null
        and to_regclass('public.meeting_terminal_notification_payloads') is not null
        and to_regclass('public.meeting_terminal_notification_attempt_receipts') is not null
        and app.portal_table_locked_down(to_regclass('public.meeting_terminal_notification_outbox'))
        and app.portal_table_locked_down(to_regclass('public.meeting_terminal_notification_payloads'))
        and app.portal_table_locked_down(to_regclass('public.meeting_terminal_notification_attempt_receipts'))
        and app.portal_service_role_only('public.portal_lease_meeting_terminal_notifications_service(app.uuid_v7,integer,integer)')
        and app.portal_service_role_only('public.portal_begin_meeting_terminal_notification_dispatch_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,text)')
        and app.portal_service_role_only('public.portal_ack_meeting_terminal_notification_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text,boolean)')
        and app.portal_service_role_only('public.portal_fail_meeting_terminal_notification_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text,integer)')
        and app.portal_service_role_only('public.portal_meeting_terminal_notification_backlog_service()')
        and app.portal_service_role_only('public.portal_cleanup_meeting_terminal_notifications_service(integer)')
        and exists(
          select 1 from pg_trigger
          where tgrelid='public.meeting_terminal_notification_payloads'::regclass
            and tgname='meeting_terminal_notification_payload_immutable'
            and not tgisinternal and tgenabled in ('O','A')
            and tgfoid=to_regprocedure('app.prevent_frozen_meeting_notification_payload_mutation()')
        )
        and exists(
          select 1 from pg_trigger
          where tgrelid='public.meeting_terminal_notification_attempt_receipts'::regclass
            and tgname='meeting_terminal_notification_receipt_append_only'
            and not tgisinternal and tgenabled in ('O','A')
            and tgfoid=to_regprocedure('app.prevent_meeting_notification_receipt_mutation()')
            and position(' update ' in ' '||lower(pg_get_triggerdef(oid))||' ')>0
            and position(' delete ' in ' '||lower(pg_get_triggerdef(oid))||' ')>0
        )
        and exists(
          select 1 from information_schema.columns
          where table_schema='public' and table_name='meeting_terminal_notification_attempt_receipts'
            and column_name='recipient_count' and data_type='integer' and is_nullable='NO'
        ),
      'meetingTerminalNotificationAtomicEnqueue',
        to_regprocedure('app.portal_enqueue_meeting_terminal_notification(app.uuid_v7,app.uuid_v7,text,timestamp with time zone)') is not null
        and not has_function_privilege('service_role','app.portal_enqueue_meeting_terminal_notification(app.uuid_v7,app.uuid_v7,text,timestamp with time zone)','EXECUTE')
        and position('portal_enqueue_meeting_terminal_notification' in lower(pg_get_functiondef(
          'public.portal_update_meeting_bot_session_status_service(text,text,text,app.uuid_v7)'::regprocedure
        )))>0
        and position('portal_enqueue_meeting_terminal_notification' in lower(pg_get_functiondef(
          'public.portal_record_meeting_bot_session_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,text,app.uuid_v7,app.uuid_v7)'::regprocedure
        )))>0
        and position('provider_ref=p_recall_bot_id' in regexp_replace(lower(pg_get_functiondef(
          'public.portal_record_meeting_bot_session_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,text,app.uuid_v7,app.uuid_v7)'::regprocedure
        )),'\s+','','g'))>0
        and position('r.provider_ref=p_recall_bot_id' in regexp_replace(lower(pg_get_functiondef(
          'public.portal_update_meeting_bot_session_status_service(text,text,text,app.uuid_v7)'::regprocedure
        )),'\s+','','g'))>0,
      'meetingTerminalNotificationLegacyClaimDisabled',
        position('returnfalse' in regexp_replace(lower(pg_get_functiondef(
          'public.portal_claim_meeting_terminal_notification_service(text)'::regprocedure
        )),'\s+','','g'))>0,
      'meetingTerminalNotificationBoundedUnknown',
        position('orphaned_deadline' in lower(pg_get_functiondef(
          'public.portal_update_meeting_bot_session_status_service(text,text,text,app.uuid_v7)'::regprocedure
        )))>0,
      'meetingTerminalNotificationWorkerHeartbeat',
        position('meeting_terminal_notification' in lower(pg_get_constraintdef((
          select oid from pg_constraint where conrelid='public.worker_heartbeats'::regclass
            and conname='worker_heartbeat_name_chk'
        ))))>0
        and position('meetingTerminalNotification' in pg_get_functiondef(
          'public.portal_worker_readiness_service()'::regprocedure
        ))>0
    )
$$;
revoke all on function public.portal_schema_capabilities_service() from public,anon,authenticated,service_role;
grant execute on function public.portal_schema_capabilities_service() to service_role;

commit;
