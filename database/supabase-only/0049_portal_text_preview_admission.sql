-- M6-02B: durable admission and generation fencing for the essential Portal
-- text preview. This migration creates no provider effect and applies no
-- remote configuration.
-- Bounded constants: 60-minute admission TTL, 90-second turn lease,
-- 16 active and 64 daily admissions per actor, and 128 active and 1024 daily
-- admissions per tenant. Daily windows use UTC.
BEGIN;
set local lock_timeout='2s';
set local statement_timeout='15s';
do $migration$
begin
  if not exists(select 1 from pg_constraint
      where conrelid='public.events_outbox'::regclass
        and conname='events_outbox_event_document_canonical_check'
        and contype='c') then
    alter table public.events_outbox
      add constraint events_outbox_event_document_canonical_check check (
    jsonb_typeof(event_document)='object'
    and event_document ?& array[
      'schema_version','event_id','event_type','event_version',
      'aggregate_type','aggregate_id','aggregate_version','tenant_id',
      'session_id','producer','trace_id','correlation_id','causation_id',
      'data_classification','payload_json','occurred_at'
    ]
    and event_document - array[
      'schema_version','event_id','event_type','event_version',
      'aggregate_type','aggregate_id','aggregate_version','tenant_id',
      'session_id','producer','trace_id','correlation_id','causation_id',
      'data_classification','payload_json','occurred_at'
    ]='{}'::jsonb
    and jsonb_typeof(event_document->'schema_version')='string'
    and event_document->>'schema_version'='2.0.0'
    and event_document->>'event_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and (event_document->>'event_id')::app.uuid_v7=event_id
    and jsonb_typeof(event_document->'event_type')='string'
    and event_document->>'event_type'=event_type
    and char_length(event_document->>'event_type') between 3 and 200
    and jsonb_typeof(event_document->'event_version')='number'
    and (event_document->>'event_version')::integer=event_version
    and (event_document->>'event_version')::integer>=1
    and jsonb_typeof(event_document->'aggregate_type')='string'
    and event_document->>'aggregate_type'=aggregate_type
    and char_length(event_document->>'aggregate_type') between 1 and 120
    and event_document->>'aggregate_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and (event_document->>'aggregate_id')::app.uuid_v7=aggregate_id
    and jsonb_typeof(event_document->'aggregate_version')='number'
    and (event_document->>'aggregate_version')::bigint=aggregate_version
    and (event_document->>'aggregate_version')::bigint>=1
    and event_document->>'tenant_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and (event_document->>'tenant_id')::app.uuid_v7=tenant_id
    and (
      jsonb_typeof(event_document->'session_id')='null'
      or (
        jsonb_typeof(event_document->'session_id')='string'
        and event_document->>'session_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        and (event_document->>'session_id')::app.uuid_v7 is not null
      )
    )
    and jsonb_typeof(event_document->'producer')='string'
    and char_length(event_document->>'producer') between 1 and 200
    and jsonb_typeof(event_document->'trace_id')='string'
    and char_length(event_document->>'trace_id') between 16 and 64
    and event_document->>'correlation_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and (event_document->>'correlation_id')::app.uuid_v7 is not null
    and (
      jsonb_typeof(event_document->'causation_id')='null'
      or (
        jsonb_typeof(event_document->'causation_id')='string'
        and event_document->>'causation_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        and (event_document->>'causation_id')::app.uuid_v7 is not null
      )
    )
    and event_document->>'data_classification' in ('public','internal','confidential','restricted')
    and jsonb_typeof(event_document->'payload_json')='string'
    and char_length(event_document->>'payload_json') between 2 and 250000
    and (event_document->>'payload_json')::jsonb is not null
    and jsonb_typeof(event_document->'occurred_at')='string'
    and event_document->>'occurred_at' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$'
    and (event_document->>'occurred_at')::timestamptz is not null
      ) not valid;
  end if;
end
$migration$;
COMMIT;

BEGIN;
set local lock_timeout='2s';
set local statement_timeout='5min';
alter table public.events_outbox
  validate constraint events_outbox_event_document_canonical_check;
COMMIT;

BEGIN;

alter function public.portal_begin_ai_usage_reservation_service(
  app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,
  text,text,integer,integer,numeric
) set lock_timeout='2s';
alter function public.portal_begin_ai_usage_reservation_service(
  app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,
  text,text,integer,integer,numeric
) set statement_timeout='15s';
alter function public.portal_mark_ai_usage_in_flight_service(app.uuid_v7)
  set lock_timeout='2s';
alter function public.portal_mark_ai_usage_in_flight_service(app.uuid_v7)
  set statement_timeout='15s';
alter function public.portal_commit_ai_usage_service(app.uuid_v7,integer,integer,numeric)
  set lock_timeout='2s';
alter function public.portal_commit_ai_usage_service(app.uuid_v7,integer,integer,numeric)
  set statement_timeout='15s';
alter function public.portal_release_ai_usage_service(app.uuid_v7,text)
  set lock_timeout='2s';
alter function public.portal_release_ai_usage_service(app.uuid_v7,text)
  set statement_timeout='15s';
alter function public.portal_mark_ai_usage_unknown_service(app.uuid_v7,text)
  set lock_timeout='2s';
alter function public.portal_mark_ai_usage_unknown_service(app.uuid_v7,text)
  set statement_timeout='15s';

create table public.portal_text_preview_privacy_policies (
  id app.uuid_v7 primary key,
  tenant_id app.uuid_v7 not null references public.tenants(id) on delete restrict,
  jurisdiction text not null,
  policy_version text not null,
  policy_fingerprint text not null,
  effective_at timestamptz not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (tenant_id,id),
  unique (tenant_id,jurisdiction,effective_at),
  constraint portal_text_preview_privacy_policies_jurisdiction_chk check (
    jurisdiction ~ '^[A-Z]{2}(-[A-Z0-9]{1,3})?$'
  ),
  constraint portal_text_preview_privacy_policies_version_chk check (
    policy_version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'
  ),
  constraint portal_text_preview_privacy_policies_fingerprint_chk check (
    policy_fingerprint ~ '^sha256:[0-9a-f]{64}$'
  ),
  constraint portal_text_preview_privacy_policies_window_chk check (
    expires_at>effective_at and expires_at<=effective_at+interval '365 days'
  )
);
alter table public.portal_text_preview_privacy_policies enable row level security;
alter table public.portal_text_preview_privacy_policies force row level security;
revoke all on table public.portal_text_preview_privacy_policies from public,anon,authenticated,service_role;

create trigger portal_text_preview_privacy_policies_append_only
before update or delete on public.portal_text_preview_privacy_policies
for each row execute function app.prevent_mutation();

create table public.portal_text_preview_admissions (
  id app.uuid_v7 primary key,
  tenant_id app.uuid_v7 not null references public.tenants(id) on delete restrict,
  actor_id app.uuid_v7 not null,
  agent_id app.uuid_v7 not null,
  session_id app.uuid_v7 not null,
  digital_presenter_id app.uuid_v7 not null,
  client_session_ref_hash text not null,
  profile_id text not null,
  profile_version text not null,
  profile_fingerprint text not null,
  provider_configuration_fingerprint text not null,
  command_fingerprint text not null,
  identity_disclosure_id app.uuid_v7 not null,
  identity_disclosure_version text not null,
  identity_disclosure_hash text not null,
  data_use_disclosure_id app.uuid_v7 not null,
  data_use_disclosure_version text not null,
  data_use_disclosure_hash text not null,
  essential_consent_id app.uuid_v7 not null,
  privacy_policy_id app.uuid_v7 not null,
  jurisdiction text not null,
  privacy_policy_version text not null,
  privacy_policy_fingerprint text not null,
  transcript_consent_id app.uuid_v7,
  transcript_id app.uuid_v7,
  persistence_selection text not null,
  trace_id text not null,
  correlation_id app.uuid_v7 not null,
  session_created_event_id app.uuid_v7 not null,
  session_created_outbox_id app.uuid_v7 not null,
  session_prepared_event_id app.uuid_v7 not null,
  session_prepared_outbox_id app.uuid_v7 not null,
  disclosure_event_id app.uuid_v7 not null,
  disclosure_outbox_id app.uuid_v7 not null,
  consent_event_id app.uuid_v7 not null,
  consent_outbox_id app.uuid_v7 not null,
  activated_event_id app.uuid_v7 not null,
  activated_outbox_id app.uuid_v7 not null,
  cleanup_event_id app.uuid_v7 not null,
  cleanup_outbox_id app.uuid_v7 not null,
  state text not null default 'issued',
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  foreign key (tenant_id,agent_id) references public.agents(tenant_id,id) on delete restrict,
  foreign key (tenant_id,session_id) references public.sessions(tenant_id,id) on delete restrict,
  foreign key (tenant_id,session_id,digital_presenter_id) references public.session_participants(tenant_id,session_id,id) on delete restrict,
  foreign key (tenant_id,identity_disclosure_id) references public.disclosure_records(tenant_id,id) on delete restrict,
  foreign key (tenant_id,data_use_disclosure_id) references public.disclosure_records(tenant_id,id) on delete restrict,
  foreign key (tenant_id,essential_consent_id) references public.consent_evidence(tenant_id,id) on delete restrict,
  foreign key (tenant_id,privacy_policy_id) references public.portal_text_preview_privacy_policies(tenant_id,id) on delete restrict,
  foreign key (tenant_id,transcript_consent_id) references public.consent_evidence(tenant_id,id) on delete restrict,
  unique (tenant_id,id),
  unique (tenant_id,id,actor_id,agent_id),
  unique (tenant_id,session_id),
  unique (tenant_id,actor_id,client_session_ref_hash),
  unique (tenant_id,cleanup_event_id),
  unique (tenant_id,cleanup_outbox_id),
  constraint portal_text_preview_admissions_client_ref_chk check (client_session_ref_hash ~ '^[0-9a-f]{64}$'),
  constraint portal_text_preview_admissions_profile_chk check (profile_id in ('openrouter_portal_text_essential_v1','openrouter_portal_text_persisted_v1')),
  constraint portal_text_preview_admissions_profile_version_chk check (profile_version='1.0.0'),
  constraint portal_text_preview_admissions_profile_fingerprint_chk check (profile_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  constraint portal_text_preview_admissions_provider_configuration_chk check (
    provider_configuration_fingerprint='sha256:70e60ec32d8a29d0f6264a0545e2ea1d215d02fe164d90dadaa63e99e59472de'
  ),
  constraint portal_text_preview_admissions_command_chk check (command_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint portal_text_preview_admissions_trace_chk check (trace_id ~ '^[0-9a-f]{32}$'),
  constraint portal_text_preview_admissions_jurisdiction_chk check (jurisdiction ~ '^[A-Z]{2}(-[A-Z0-9]{1,3})?$'),
  constraint portal_text_preview_admissions_privacy_policy_version_chk check (privacy_policy_version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  constraint portal_text_preview_admissions_privacy_policy_fingerprint_chk check (privacy_policy_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  constraint portal_text_preview_admissions_disclosure_version_chk check (
    identity_disclosure_version ~ '^[a-z][a-z0-9._-]{2,99}$'
    and data_use_disclosure_version ~ '^[a-z][a-z0-9._-]{2,99}$'
  ),
  constraint portal_text_preview_admissions_disclosure_hash_chk check (
    identity_disclosure_hash ~ '^[0-9a-f]{64}$'
    and data_use_disclosure_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint portal_text_preview_admissions_persistence_chk check (
    (persistence_selection='off'
      and profile_id='openrouter_portal_text_essential_v1'
      and profile_fingerprint='sha256:5f07f0bb93393c7fcd4412516db48f30fb3095fb31e9352cd2cf849b260a5173'
      and transcript_consent_id is null
      and transcript_id is null)
    or
    (persistence_selection='opt_in'
      and profile_id='openrouter_portal_text_persisted_v1'
      and profile_fingerprint='sha256:5062dd979ac79778052389f27069a16dfa8f33fb175d38181774415b1ff585b8'
      and transcript_consent_id is not null
      and transcript_id is not null)
  ),
  constraint portal_text_preview_admissions_state_chk check (state='issued'),
  constraint portal_text_preview_admissions_ttl_chk check (expires_at=issued_at+interval '60 minutes')
);
alter table public.portal_text_preview_admissions enable row level security;
alter table public.portal_text_preview_admissions force row level security;
revoke all on table public.portal_text_preview_admissions from public,anon,authenticated,service_role;

create trigger portal_text_preview_admissions_append_only
before update or delete on public.portal_text_preview_admissions
for each row execute function app.prevent_mutation();

create index portal_text_preview_admissions_actor_active_idx
  on public.portal_text_preview_admissions(tenant_id,actor_id,expires_at);
create index portal_text_preview_admissions_tenant_active_idx
  on public.portal_text_preview_admissions(tenant_id,expires_at);
create index portal_text_preview_admissions_actor_daily_idx
  on public.portal_text_preview_admissions(tenant_id,actor_id,issued_at);
create index portal_text_preview_admissions_tenant_daily_idx
  on public.portal_text_preview_admissions(tenant_id,issued_at);

create table public.portal_text_preview_turn_claims (
  id app.uuid_v7 primary key,
  attempt_id app.uuid_v7 not null,
  tenant_id app.uuid_v7 not null references public.tenants(id) on delete restrict,
  admission_id app.uuid_v7 not null,
  actor_id app.uuid_v7 not null,
  agent_id app.uuid_v7 not null,
  generation integer not null,
  command_ref_hash text not null,
  command_fingerprint text not null,
  outcome_event_id app.uuid_v7 not null,
  outcome_outbox_id app.uuid_v7 not null,
  completion_fingerprint text,
  provider_request_id text,
  state text not null default 'acquired',
  reason_code text,
  acquired_at timestamptz not null default now(),
  lease_expires_at timestamptz not null,
  finished_at timestamptz,
  foreign key (tenant_id,admission_id,actor_id,agent_id)
    references public.portal_text_preview_admissions(tenant_id,id,actor_id,agent_id) on delete restrict,
  foreign key (tenant_id,agent_id) references public.agents(tenant_id,id) on delete restrict,
  unique (tenant_id,id),
  unique (tenant_id,attempt_id),
  unique (tenant_id,outcome_event_id),
  unique (tenant_id,outcome_outbox_id),
  constraint portal_text_preview_turn_claims_receipt_identity_key
    unique (tenant_id,admission_id,id,generation),
  constraint portal_text_preview_turn_claims_egress_identity_key
    unique (tenant_id,admission_id,id,attempt_id,generation),
  unique (tenant_id,admission_id,command_ref_hash),
  constraint portal_text_preview_turn_claims_generation_chk check (generation between 0 and 10000000),
  constraint portal_text_preview_turn_claims_command_ref_chk check (command_ref_hash ~ '^[0-9a-f]{64}$'),
  constraint portal_text_preview_turn_claims_command_chk check (command_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint portal_text_preview_turn_claims_completion_chk check (
    completion_fingerprint is null or completion_fingerprint ~ '^hmac-sha256:[0-9a-f]{64}$'
  ),
  constraint portal_text_preview_turn_claims_provider_request_chk check (
    provider_request_id is null or (
      char_length(provider_request_id) between 1 and 128
      and octet_length(provider_request_id)=char_length(provider_request_id)
      and provider_request_id ~ '^[!-~]{1,128}$'
    )
  ),
  constraint portal_text_preview_turn_claims_lease_chk check (
    lease_expires_at=acquired_at+interval '90 seconds'
  ),
  constraint portal_text_preview_turn_claims_state_chk check (state in ('acquired','succeeded','failed')),
  constraint portal_text_preview_turn_claims_reason_chk check (
    (state='acquired' and reason_code is null and completion_fingerprint is null and provider_request_id is null and finished_at is null)
    or (state='succeeded' and reason_code='generation_succeeded' and completion_fingerprint is not null and finished_at is not null)
    or (state='failed'
      and reason_code in ('generation_failed','generated_reply_invalid','state_issue_failed','session_expired','worker_lost')
      and completion_fingerprint is null and provider_request_id is null and finished_at is not null)
    or (state='failed' and reason_code='provider_response_uncommitted'
      and completion_fingerprint is null and provider_request_id is not null and finished_at is not null)
  )
);
create unique index portal_text_preview_turn_claims_generation_fence_uidx
  on public.portal_text_preview_turn_claims(tenant_id,admission_id,generation)
  where state in ('acquired','succeeded');
alter table public.portal_text_preview_turn_claims enable row level security;
alter table public.portal_text_preview_turn_claims force row level security;
revoke all on table public.portal_text_preview_turn_claims from public,anon,authenticated,service_role;

create table public.portal_text_preview_egress_authorizations (
  id app.uuid_v7 primary key,
  tenant_id app.uuid_v7 not null references public.tenants(id) on delete restrict,
  admission_id app.uuid_v7 not null,
  claim_id app.uuid_v7 not null,
  ai_usage_reservation_id app.uuid_v7 not null,
  attempt_id app.uuid_v7 not null,
  generation integer not null,
  kind text not null,
  authorized_at timestamptz not null,
  expires_at timestamptz not null,
  foreign key (tenant_id,admission_id) references public.portal_text_preview_admissions(tenant_id,id) on delete restrict,
  foreign key (tenant_id,admission_id,claim_id,attempt_id,generation)
    references public.portal_text_preview_turn_claims(tenant_id,admission_id,id,attempt_id,generation) on delete restrict,
  foreign key (tenant_id,ai_usage_reservation_id)
    references public.ai_usage_reservations(tenant_id,id) on delete restrict,
  unique (tenant_id,id),
  constraint portal_text_preview_egress_claim_kind_key unique (tenant_id,claim_id,kind),
  constraint portal_text_preview_egress_ai_reservation_key unique (tenant_id,ai_usage_reservation_id),
  constraint portal_text_preview_egress_generation_chk check (generation between 0 and 10000000),
  constraint portal_text_preview_egress_kind_chk check (kind in ('embedding','generation')),
  constraint portal_text_preview_egress_ttl_chk check (
    expires_at>authorized_at and expires_at<=authorized_at+interval '15 seconds'
  )
);
alter table public.portal_text_preview_egress_authorizations enable row level security;
alter table public.portal_text_preview_egress_authorizations force row level security;
revoke all on table public.portal_text_preview_egress_authorizations from public,anon,authenticated,service_role;

create trigger portal_text_preview_egress_authorizations_append_only
before update or delete on public.portal_text_preview_egress_authorizations
for each row execute function app.prevent_mutation();

create table public.portal_text_preview_transcript_writes (
  claim_id app.uuid_v7 primary key,
  tenant_id app.uuid_v7 not null references public.tenants(id) on delete restrict,
  admission_id app.uuid_v7 not null,
  transcript_id app.uuid_v7 not null,
  generation integer not null,
  written_at timestamptz not null default now(),
  foreign key (tenant_id,admission_id) references public.portal_text_preview_admissions(tenant_id,id) on delete restrict,
  constraint portal_text_preview_writes_claim_fkey
    foreign key (tenant_id,admission_id,claim_id,generation)
    references public.portal_text_preview_turn_claims(tenant_id,admission_id,id,generation) on delete restrict,
  unique (tenant_id,claim_id),
  constraint portal_text_preview_transcript_writes_generation_chk check (generation between 0 and 10000000)
);
alter table public.portal_text_preview_transcript_writes enable row level security;
alter table public.portal_text_preview_transcript_writes force row level security;
revoke all on table public.portal_text_preview_transcript_writes from public,anon,authenticated,service_role;

create trigger portal_text_preview_transcript_writes_append_only
before update or delete on public.portal_text_preview_transcript_writes
for each row execute function app.prevent_mutation();

create or replace function app.portal_enqueue_text_preview_event(
  p_outbox_id app.uuid_v7,
  p_event_id app.uuid_v7,
  p_tenant_id app.uuid_v7,
  p_session_id app.uuid_v7,
  p_event_type text,
  p_aggregate_version bigint,
  p_trace_id text,
  p_correlation_id app.uuid_v7,
  p_causation_id app.uuid_v7,
  p_payload jsonb,
  p_occurred_at timestamptz
) returns void
language plpgsql set search_path='public' as $$
declare v_envelope jsonb;
begin
  if p_outbox_id is null
    or p_event_id is null
    or p_tenant_id is null
    or p_session_id is null
    or p_correlation_id is null
    or p_outbox_id=p_event_id
    or p_event_type not in (
      'session.created','session.prepared','disclosure.delivered',
      'consent.recorded','session.activated','turn.outcome_recorded','session.completed'
    )
    or p_aggregate_version not between 1 and 10000000
    or p_trace_id is null
    or p_trace_id !~ '^[0-9a-f]{32}$'
    or p_payload is null
    or jsonb_typeof(p_payload)<>'object'
    or p_occurred_at is null then
    raise exception 'invalid canonical text preview event' using errcode='22023';
  end if;
  v_envelope:=jsonb_build_object(
    'schema_version','2.0.0',
    'event_id',p_event_id,
    'event_type',p_event_type,
    'event_version',1,
    'aggregate_type','interaction_session',
    'aggregate_id',p_session_id,
    'aggregate_version',p_aggregate_version,
    'tenant_id',p_tenant_id,
    'session_id',p_session_id,
    'producer','portal.text_preview',
    'trace_id',p_trace_id,
    'correlation_id',p_correlation_id,
    'causation_id',p_causation_id,
    'data_classification','internal',
    'payload_json',p_payload::text,
    'occurred_at',p_occurred_at
  );
  insert into public.events_outbox(
    tenant_id,id,event_id,aggregate_type,aggregate_id,aggregate_version,
    event_type,event_version,event_document,status,attempts,available_at,created_at
  ) values (
    p_tenant_id,p_outbox_id,p_event_id,'interaction_session',p_session_id,
    p_aggregate_version,p_event_type,1,v_envelope,'pending',0,p_occurred_at,p_occurred_at
  );
end;
$$;
revoke all on function app.portal_enqueue_text_preview_event(
  app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,text,bigint,text,
  app.uuid_v7,app.uuid_v7,jsonb,timestamptz
) from public,anon,authenticated,service_role;

create or replace function app.portal_record_text_preview_failure(
  p_admission_id app.uuid_v7,
  p_claim_id app.uuid_v7,
  p_attempt_id app.uuid_v7,
  p_reason_code text,
  p_provider_request_id text,
  p_failed_at timestamptz
) returns boolean
language plpgsql set search_path='public' as $$
declare
  v_admission public.portal_text_preview_admissions%rowtype;
  v_claim public.portal_text_preview_turn_claims%rowtype;
  v_session public.sessions%rowtype;
  v_causation_id app.uuid_v7;
begin
  if p_reason_code not in (
      'generation_failed','generated_reply_invalid','state_issue_failed','session_expired',
      'worker_lost','provider_response_uncommitted'
    )
    or p_failed_at is null
    or (p_reason_code='provider_response_uncommitted' and (
      p_provider_request_id is null
      or char_length(p_provider_request_id) not between 1 and 128
      or octet_length(p_provider_request_id)<>char_length(p_provider_request_id)
      or p_provider_request_id !~ '^[!-~]{1,128}$'
    ))
    or (p_reason_code<>'provider_response_uncommitted' and p_provider_request_id is not null) then
    return false;
  end if;
  select * into v_admission from public.portal_text_preview_admissions
  where id=p_admission_id;
  if not found then return false; end if;
  select * into v_claim from public.portal_text_preview_turn_claims
  where tenant_id=v_admission.tenant_id and admission_id=v_admission.id and id=p_claim_id
  for update;
  if not found
    or v_claim.state<>'acquired'
    or (p_attempt_id is not null and v_claim.attempt_id<>p_attempt_id) then
    return false;
  end if;
  select * into v_session from public.sessions
  where tenant_id=v_admission.tenant_id and id=v_admission.session_id
  for update;
  if not found
    or v_session.status<>'active'
    or (p_reason_code<>'provider_response_uncommitted'
      and v_session.active_presenter_id is distinct from v_admission.digital_presenter_id)
    or v_session.state_version<5 then
    return false;
  end if;
  select event_id into v_causation_id from public.events_outbox
  where tenant_id=v_admission.tenant_id
    and aggregate_type='interaction_session'
    and aggregate_id=v_admission.session_id
    and aggregate_version=v_session.state_version;
  if not found then return false; end if;
  update public.portal_text_preview_turn_claims
  set state='failed',reason_code=p_reason_code,
      provider_request_id=p_provider_request_id,finished_at=p_failed_at
  where tenant_id=v_claim.tenant_id and id=v_claim.id and state='acquired';
  if not found then return false; end if;
  perform app.portal_enqueue_text_preview_event(
    v_claim.outcome_outbox_id,v_claim.outcome_event_id,v_admission.tenant_id,v_admission.session_id,
    'turn.outcome_recorded',v_session.state_version+1,v_admission.trace_id,
    v_claim.id,v_causation_id,
    jsonb_build_object(
      'schema_version','2.0.0','claim_id',v_claim.id,'generation',v_claim.generation,
      'outcome','failed','reason_code',p_reason_code,'persistence',null,
      'resulting_turn_index',v_claim.generation*2
    ),p_failed_at
  );
  update public.sessions
  set state_version=v_session.state_version+1,updated_at=p_failed_at
  where tenant_id=v_admission.tenant_id and id=v_admission.session_id
    and state_version=v_session.state_version;
  return found;
end;
$$;
revoke all on function app.portal_record_text_preview_failure(
  app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,timestamptz
) from public,anon,authenticated,service_role;

create or replace function app.portal_record_text_preview_success(
  p_admission_id app.uuid_v7,
  p_claim_id app.uuid_v7,
  p_attempt_id app.uuid_v7,
  p_completion_fingerprint text,
  p_provider_request_id text,
  p_persistence text,
  p_succeeded_at timestamptz
) returns boolean
language plpgsql set search_path='public' as $$
declare
  v_admission public.portal_text_preview_admissions%rowtype;
  v_claim public.portal_text_preview_turn_claims%rowtype;
  v_session public.sessions%rowtype;
  v_causation_id app.uuid_v7;
begin
  if p_persistence not in ('disabled','saved','not_saved') or p_succeeded_at is null then
    return false;
  end if;
  select * into v_admission from public.portal_text_preview_admissions
  where id=p_admission_id;
  if not found then return false; end if;
  select * into v_claim from public.portal_text_preview_turn_claims
  where tenant_id=v_admission.tenant_id and admission_id=v_admission.id and id=p_claim_id
  for update;
  if not found
    or v_claim.state<>'acquired'
    or v_claim.attempt_id<>p_attempt_id
    or v_claim.lease_expires_at<=p_succeeded_at then
    return false;
  end if;
  select * into v_session from public.sessions
  where tenant_id=v_admission.tenant_id and id=v_admission.session_id
  for update;
  if not found
    or v_session.status<>'active'
    or v_session.active_presenter_id is distinct from v_admission.digital_presenter_id
    or v_session.state_version<5 then
    return false;
  end if;
  select event_id into v_causation_id from public.events_outbox
  where tenant_id=v_admission.tenant_id
    and aggregate_type='interaction_session'
    and aggregate_id=v_admission.session_id
    and aggregate_version=v_session.state_version;
  if not found then return false; end if;
  update public.portal_text_preview_turn_claims
  set state='succeeded',reason_code='generation_succeeded',
      completion_fingerprint=p_completion_fingerprint,
      provider_request_id=p_provider_request_id,finished_at=p_succeeded_at
  where tenant_id=v_claim.tenant_id and id=v_claim.id and state='acquired'
    and attempt_id=p_attempt_id and lease_expires_at>p_succeeded_at;
  if not found then return false; end if;
  perform app.portal_enqueue_text_preview_event(
    v_claim.outcome_outbox_id,v_claim.outcome_event_id,v_admission.tenant_id,v_admission.session_id,
    'turn.outcome_recorded',v_session.state_version+1,v_admission.trace_id,
    v_claim.id,v_causation_id,
    jsonb_build_object(
      'schema_version','2.0.0','claim_id',v_claim.id,'generation',v_claim.generation,
      'outcome','succeeded','reason_code','generation_succeeded',
      'persistence',case when p_persistence='saved' then 'persisted' else 'disabled' end,
      'resulting_turn_index',(v_claim.generation+1)*2
    ),p_succeeded_at
  );
  update public.sessions
  set state_version=v_session.state_version+1,updated_at=p_succeeded_at
  where tenant_id=v_admission.tenant_id and id=v_admission.session_id
    and state_version=v_session.state_version;
  return found;
end;
$$;
revoke all on function app.portal_record_text_preview_success(
  app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,text,timestamptz
) from public,anon,authenticated,service_role;

create or replace function public.portal_provision_text_preview_privacy_policy_service(
  p_policy_id app.uuid_v7,
  p_tenant_id app.uuid_v7,
  p_jurisdiction text,
  p_policy_version text,
  p_policy_fingerprint text,
  p_effective_at timestamptz,
  p_expires_at timestamptz
) returns jsonb
language plpgsql security definer set search_path='public'
set lock_timeout='2s' set statement_timeout='15s' as $$
declare v_existing public.portal_text_preview_privacy_policies%rowtype;
begin
  if p_jurisdiction !~ '^[A-Z]{2}(-[A-Z0-9]{1,3})?$'
    or p_policy_version !~ '^[0-9]+\.[0-9]+\.[0-9]+$'
    or p_policy_fingerprint !~ '^sha256:[0-9a-f]{64}$'
    or p_effective_at is null
    or p_expires_at is null
    or p_expires_at<=p_effective_at
    or p_expires_at>p_effective_at+interval '365 days' then
    raise exception 'invalid text preview privacy policy' using errcode='22023';
  end if;
  if not exists(select 1 from public.tenants where id=p_tenant_id) then
    raise exception 'text preview privacy policy tenant not found' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('portal-text-policy:'||p_tenant_id::text,0));
  select * into v_existing
  from public.portal_text_preview_privacy_policies
  where tenant_id=p_tenant_id and id=p_policy_id;
  if found then
    if row(v_existing.jurisdiction,v_existing.policy_version,v_existing.policy_fingerprint,
      v_existing.effective_at,v_existing.expires_at) is distinct from
      row(p_jurisdiction,p_policy_version,p_policy_fingerprint,p_effective_at,p_expires_at) then
      raise exception 'text preview privacy policy replay conflict' using errcode='23505';
    end if;
    return jsonb_build_object('outcome','provisioned','policyId',v_existing.id);
  end if;
  if exists(select 1 from public.portal_text_preview_privacy_policies p
      where p.tenant_id=p_tenant_id and p.effective_at>=p_effective_at) then
    raise exception 'text preview privacy policy must advance effective time' using errcode='23505';
  end if;
  insert into public.portal_text_preview_privacy_policies(
    id,tenant_id,jurisdiction,policy_version,policy_fingerprint,effective_at,expires_at
  ) values (
    p_policy_id,p_tenant_id,p_jurisdiction,p_policy_version,p_policy_fingerprint,p_effective_at,p_expires_at
  );
  return jsonb_build_object('outcome','provisioned','policyId',p_policy_id);
end;
$$;

create or replace function public.portal_admit_text_preview_service(
  p_admission_id app.uuid_v7,
  p_user_id uuid,
  p_agent_id app.uuid_v7,
  p_session_id app.uuid_v7,
  p_presenter_id app.uuid_v7,
  p_client_session_ref_hash text,
  p_profile_id text,
  p_profile_version text,
  p_profile_fingerprint text,
  p_provider_configuration_fingerprint text,
  p_command_fingerprint text,
  p_identity_disclosure_id app.uuid_v7,
  p_identity_disclosure_version text,
  p_identity_disclosure_hash text,
  p_data_use_disclosure_id app.uuid_v7,
  p_data_use_disclosure_version text,
  p_data_use_disclosure_hash text,
  p_essential_consent_id app.uuid_v7,
  p_transcript_consent_id app.uuid_v7,
  p_transcript_id app.uuid_v7,
  p_persistent_transcript boolean,
  p_expect_existing boolean,
  p_trace_id text,
  p_correlation_id app.uuid_v7,
  p_session_created_event_id app.uuid_v7,
  p_session_created_outbox_id app.uuid_v7,
  p_session_prepared_event_id app.uuid_v7,
  p_session_prepared_outbox_id app.uuid_v7,
  p_disclosure_event_id app.uuid_v7,
  p_disclosure_outbox_id app.uuid_v7,
  p_consent_event_id app.uuid_v7,
  p_consent_outbox_id app.uuid_v7,
  p_activated_event_id app.uuid_v7,
  p_activated_outbox_id app.uuid_v7,
  p_cleanup_event_id app.uuid_v7,
  p_cleanup_outbox_id app.uuid_v7
) returns jsonb
language plpgsql security definer set search_path='public'
set lock_timeout='2s' set statement_timeout='15s' as $$
declare
  v_membership public.user_tenant_memberships%rowtype;
  v_membership_tenant app.uuid_v7;
  v_membership_actor app.uuid_v7;
  v_agent public.agents%rowtype;
  v_existing public.portal_text_preview_admissions%rowtype;
  v_policy public.portal_text_preview_privacy_policies%rowtype;
  v_now timestamptz;
  v_day_start timestamptz;
  v_subject_ref text;
  v_persistence_selection text;
  v_count bigint;
begin
  if p_user_id is null
    or p_admission_id is null
    or p_agent_id is null
    or p_session_id is null
    or p_presenter_id is null
    or p_client_session_ref_hash is null
    or p_client_session_ref_hash !~ '^[0-9a-f]{64}$'
    or p_profile_id is null
    or p_profile_id not in ('openrouter_portal_text_essential_v1','openrouter_portal_text_persisted_v1')
    or p_profile_version is null
    or p_profile_version<>'1.0.0'
    or p_profile_fingerprint is null
    or p_provider_configuration_fingerprint is null
    or p_provider_configuration_fingerprint<>'sha256:70e60ec32d8a29d0f6264a0545e2ea1d215d02fe164d90dadaa63e99e59472de'
    or p_command_fingerprint is null
    or p_command_fingerprint !~ '^[0-9a-f]{64}$'
    or p_identity_disclosure_id is null
    or p_identity_disclosure_version is null
    or p_identity_disclosure_version !~ '^[a-z][a-z0-9._-]{2,99}$'
    or p_data_use_disclosure_id is null
    or p_data_use_disclosure_version is null
    or p_data_use_disclosure_version !~ '^[a-z][a-z0-9._-]{2,99}$'
    or p_identity_disclosure_hash is null
    or p_identity_disclosure_hash !~ '^[0-9a-f]{64}$'
    or p_data_use_disclosure_hash is null
    or p_data_use_disclosure_hash !~ '^[0-9a-f]{64}$'
    or p_essential_consent_id is null
    or p_persistent_transcript is null
    or p_expect_existing is null
    or p_trace_id is null
    or p_trace_id !~ '^[0-9a-f]{32}$'
    or p_correlation_id is null
    or p_correlation_id<>p_admission_id
    or p_session_created_event_id is null or p_session_created_outbox_id is null
    or p_session_prepared_event_id is null or p_session_prepared_outbox_id is null
    or p_disclosure_event_id is null or p_disclosure_outbox_id is null
    or p_consent_event_id is null or p_consent_outbox_id is null
    or p_activated_event_id is null or p_activated_outbox_id is null
    or p_cleanup_event_id is null or p_cleanup_outbox_id is null then
    raise exception 'invalid text preview admission' using errcode='22023';
  end if;
  if (not p_persistent_transcript and (
      p_profile_id<>'openrouter_portal_text_essential_v1'
      or p_profile_fingerprint<>'sha256:5f07f0bb93393c7fcd4412516db48f30fb3095fb31e9352cd2cf849b260a5173'
      or p_transcript_consent_id is not null
      or p_transcript_id is not null
    )) or (p_persistent_transcript and (
      p_profile_id<>'openrouter_portal_text_persisted_v1'
      or p_profile_fingerprint<>'sha256:5062dd979ac79778052389f27069a16dfa8f33fb175d38181774415b1ff585b8'
      or p_transcript_consent_id is null
      or p_transcript_id is null
    )) then
    raise exception 'text preview persistence selection mismatch' using errcode='22023';
  end if;

  select m.* into v_membership
  from public.user_tenant_memberships m
  join public.tenants t on t.id=m.tenant_id and t.status in ('trial','active')
  join public.agents a on a.tenant_id=m.tenant_id and a.id=p_agent_id and a.status='active'
  where m.user_id=p_user_id;
  if not found then
    raise exception 'text preview user is not authorized' using errcode='42501';
  end if;
  v_membership_tenant:=v_membership.tenant_id;
  v_membership_actor:=v_membership.actor_id;
  perform pg_advisory_xact_lock(hashtextextended(
    'portal-text-admission-tenant:'||v_membership.tenant_id::text,
    0
  ));
  perform pg_advisory_xact_lock(hashtextextended(
    'portal-text-admission-actor:'||v_membership.tenant_id::text||':'||v_membership.actor_id::text,
    0
  ));
  perform pg_advisory_xact_lock(hashtextextended(
    'portal-text-policy:'||v_membership.tenant_id::text,
    0
  ));
  select m.* into v_membership
  from public.user_tenant_memberships m
  join public.tenants t on t.id=m.tenant_id and t.status in ('trial','active')
  join public.agents a on a.tenant_id=m.tenant_id and a.id=p_agent_id and a.status='active'
  where m.user_id=p_user_id
    and m.tenant_id=v_membership_tenant
    and m.actor_id=v_membership_actor
  for key share of m
  for share of t;
  if not found then
    raise exception 'text preview user is not authorized' using errcode='42501';
  end if;

  v_now:=clock_timestamp();
  v_day_start:=date_trunc('day',v_now at time zone 'UTC') at time zone 'UTC';
  select * into v_policy
  from public.portal_text_preview_privacy_policies p
  where p.tenant_id=v_membership.tenant_id
    and p.effective_at<=v_now
    and p.expires_at>v_now
  order by p.effective_at desc,p.created_at desc,p.id desc
  limit 1;
  if not found then
    raise exception 'active text preview privacy policy required' using errcode='42501';
  end if;

  select * into v_existing
  from public.portal_text_preview_admissions
  where tenant_id=v_membership.tenant_id
    and actor_id=v_membership.actor_id
    and client_session_ref_hash=p_client_session_ref_hash
  for update;
  if found then
    if row(
      v_existing.agent_id,
      v_existing.profile_id,
      v_existing.profile_version,
      v_existing.profile_fingerprint,
      v_existing.provider_configuration_fingerprint,
      v_existing.command_fingerprint,
      v_existing.identity_disclosure_version,
      v_existing.identity_disclosure_hash,
      v_existing.data_use_disclosure_version,
      v_existing.data_use_disclosure_hash,
      v_existing.privacy_policy_id,
      v_existing.jurisdiction,
      v_existing.privacy_policy_version,
      v_existing.privacy_policy_fingerprint,
      v_existing.persistence_selection
    ) is distinct from row(
      p_agent_id,
      p_profile_id,
      p_profile_version,
      p_profile_fingerprint,
      p_provider_configuration_fingerprint,
      p_command_fingerprint,
      p_identity_disclosure_version,
      p_identity_disclosure_hash,
      p_data_use_disclosure_version,
      p_data_use_disclosure_hash,
      v_policy.id,
      v_policy.jurisdiction,
      v_policy.policy_version,
      v_policy.policy_fingerprint,
      case when p_persistent_transcript then 'opt_in' else 'off' end
    ) then
      raise exception 'text preview admission replay conflict' using errcode='23505';
    end if;
    return jsonb_build_object(
      'schema_version','2.0.0',
      'admission_id',v_existing.id,
      'tenant_id',v_existing.tenant_id,
      'actor_id',v_existing.actor_id,
      'agent_id',v_existing.agent_id,
      'session_id',v_existing.session_id,
      'presenter_id',v_existing.digital_presenter_id,
      'profile_id',v_existing.profile_id,
      'profile_version',v_existing.profile_version,
      'profile_fingerprint',v_existing.profile_fingerprint,
      'provider_configuration_fingerprint',v_existing.provider_configuration_fingerprint,
      'client_session_ref_hash',v_existing.client_session_ref_hash,
      'command_fingerprint',v_existing.command_fingerprint,
      'identity_disclosure_id',v_existing.identity_disclosure_id,
      'data_use_disclosure_id',v_existing.data_use_disclosure_id,
      'essential_consent_id',v_existing.essential_consent_id,
      'privacy_policy_id',v_existing.privacy_policy_id,
      'jurisdiction',v_existing.jurisdiction,
      'privacy_policy_version',v_existing.privacy_policy_version,
      'privacy_policy_fingerprint',v_existing.privacy_policy_fingerprint,
      'transcript_consent_id',v_existing.transcript_consent_id,
      'transcript_id',v_existing.transcript_id,
      'persistent_transcript',v_existing.persistence_selection='opt_in',
      'status',case when v_existing.expires_at<=now() then 'expired' else 'issued' end,
      'ttl_seconds',3600,
      'issued_at',v_existing.issued_at,
      'expires_at',v_existing.expires_at
    );
  end if;

  if p_expect_existing then
    raise exception 'text preview admission expected but not found' using errcode='42501';
  end if;

  if p_trace_id is null
    or p_trace_id !~ '^[0-9a-f]{32}$'
    or p_correlation_id is null
    or (select count(distinct reserved_id)<>12
      from unnest(array[
        p_session_created_event_id,p_session_created_outbox_id,
        p_session_prepared_event_id,p_session_prepared_outbox_id,
        p_disclosure_event_id,p_disclosure_outbox_id,
        p_consent_event_id,p_consent_outbox_id,
        p_activated_event_id,p_activated_outbox_id,
        p_cleanup_event_id,p_cleanup_outbox_id
      ]) reserved(reserved_id)) then
    raise exception 'invalid text preview event identity reservation' using errcode='22023';
  end if;

  select count(*) into v_count
  from public.portal_text_preview_admissions
  where tenant_id=v_membership.tenant_id
    and actor_id=v_membership.actor_id
    and expires_at>v_now;
  if v_count>=16 then
    raise exception 'text preview actor active admission cap reached' using errcode='54000';
  end if;
  select count(*) into v_count
  from public.portal_text_preview_admissions
  where tenant_id=v_membership.tenant_id
    and expires_at>v_now;
  if v_count>=128 then
    raise exception 'text preview tenant active admission cap reached' using errcode='54000';
  end if;
  select count(*) into v_count
  from public.portal_text_preview_admissions
  where tenant_id=v_membership.tenant_id
    and actor_id=v_membership.actor_id
    and issued_at>=v_day_start
    and issued_at<v_day_start+interval '1 day';
  if v_count>=64 then
    raise exception 'text preview actor daily admission cap reached' using errcode='54000';
  end if;
  select count(*) into v_count
  from public.portal_text_preview_admissions
  where tenant_id=v_membership.tenant_id
    and issued_at>=v_day_start
    and issued_at<v_day_start+interval '1 day';
  if v_count>=1024 then
    raise exception 'text preview tenant daily admission cap reached' using errcode='54000';
  end if;

  select a.* into v_agent
  from public.agents a
  where a.tenant_id=v_membership.tenant_id and a.id=p_agent_id and a.status='active';
  if not found then
    raise exception 'active text preview agent not found for tenant' using errcode='42501';
  end if;
  if exists(select 1 from public.sessions where tenant_id=v_membership.tenant_id and id=p_session_id)
    or exists(select 1 from public.session_participants where tenant_id=v_membership.tenant_id and id=p_presenter_id)
    or exists(select 1 from public.portal_text_preview_admissions where id=p_admission_id) then
    raise exception 'text preview server resource replay conflict' using errcode='23505';
  end if;

  v_subject_ref:='portal-user:sha256:'||app.sha256_tuple(p_user_id::text);
  v_persistence_selection:=case when p_persistent_transcript then 'opt_in' else 'off' end;

  insert into public.sessions(
    tenant_id,id,agent_id,role_pack_id,role_pack_version,channel_type,status,
    active_presenter_id,state_version,disclosure_status,consent_status,started_at,updated_at
  ) values (
    v_membership.tenant_id,p_session_id,p_agent_id,v_agent.role_type,'portal-text-preview-v1',
    'web_widget','preparing',null,0,'pending','pending',v_now,v_now
  );
  insert into public.session_participants(
    tenant_id,id,session_id,participant_type,display_name,joined_at
  ) values (
    v_membership.tenant_id,p_presenter_id,p_session_id,'digital_presenter',v_agent.name,v_now
  );
  if (select count(*) from public.session_participants
      where tenant_id=v_membership.tenant_id
        and session_id=p_session_id
        and participant_type='digital_presenter')<>1 then
    raise exception 'text preview requires exactly one digital presenter' using errcode='23514';
  end if;

  insert into public.disclosure_records(
    tenant_id,id,session_id,disclosure_type,version,content_hash,
    delivery_channel,language,delivered_at,acknowledged,acknowledged_at
  ) values
    (v_membership.tenant_id,p_identity_disclosure_id,p_session_id,'ai_identity',
      p_identity_disclosure_version,p_identity_disclosure_hash,'chat','pt-BR',v_now,true,v_now),
    (v_membership.tenant_id,p_data_use_disclosure_id,p_session_id,'data_use',
      p_data_use_disclosure_version,p_data_use_disclosure_hash,'chat','pt-BR',v_now,true,v_now);

  insert into public.consent_evidence(
    tenant_id,id,session_id,subject_ref,consent_type,purpose,status,method,
    jurisdiction,disclosure_version,evidence_hash,captured_at,expires_at
  ) values (
    v_membership.tenant_id,p_essential_consent_id,p_session_id,v_subject_ref,
    'essential_processing','portal_text_preview','granted','click',v_policy.jurisdiction,
    p_data_use_disclosure_version,
    app.sha256_tuple('essential_processing',p_command_fingerprint,p_data_use_disclosure_hash),
    v_now,v_now+interval '60 minutes'
  );

  if p_persistent_transcript then
    insert into public.consent_evidence(
      tenant_id,id,session_id,subject_ref,consent_type,purpose,status,method,
      jurisdiction,disclosure_version,evidence_hash,captured_at,expires_at
    ) values (
      v_membership.tenant_id,p_transcript_consent_id,p_session_id,v_subject_ref,
      'persistent_transcription','portal_text_preview','granted','click',v_policy.jurisdiction,
      p_data_use_disclosure_version,
      app.sha256_tuple('persistent_transcription',p_command_fingerprint,p_data_use_disclosure_hash),
      v_now,v_now+interval '60 minutes'
    );
    insert into public.conversation_transcripts(
      id,tenant_id,agent_id,surface,external_ref,turns,started_at,created_at,updated_at
    ) values (
      p_transcript_id,v_membership.tenant_id,p_agent_id,'chat',
      'portal-text:'||p_admission_id::text,'[]'::jsonb,v_now,v_now,v_now
    );
  end if;

  insert into public.portal_text_preview_admissions(
    id,tenant_id,actor_id,agent_id,session_id,digital_presenter_id,
    client_session_ref_hash,profile_id,profile_version,profile_fingerprint,
    provider_configuration_fingerprint,command_fingerprint,
    identity_disclosure_id,identity_disclosure_version,identity_disclosure_hash,
    data_use_disclosure_id,data_use_disclosure_version,data_use_disclosure_hash,
    essential_consent_id,privacy_policy_id,jurisdiction,privacy_policy_version,privacy_policy_fingerprint,
    transcript_consent_id,transcript_id,persistence_selection,
    trace_id,correlation_id,
    session_created_event_id,session_created_outbox_id,
    session_prepared_event_id,session_prepared_outbox_id,
    disclosure_event_id,disclosure_outbox_id,consent_event_id,consent_outbox_id,
    activated_event_id,activated_outbox_id,cleanup_event_id,cleanup_outbox_id,
    state,issued_at,expires_at
  ) values (
    p_admission_id,v_membership.tenant_id,v_membership.actor_id,p_agent_id,p_session_id,p_presenter_id,
    p_client_session_ref_hash,p_profile_id,p_profile_version,p_profile_fingerprint,
    p_provider_configuration_fingerprint,p_command_fingerprint,
    p_identity_disclosure_id,p_identity_disclosure_version,p_identity_disclosure_hash,
    p_data_use_disclosure_id,p_data_use_disclosure_version,p_data_use_disclosure_hash,
    p_essential_consent_id,v_policy.id,v_policy.jurisdiction,v_policy.policy_version,v_policy.policy_fingerprint,
    p_transcript_consent_id,p_transcript_id,v_persistence_selection,
    p_trace_id,p_correlation_id,
    p_session_created_event_id,p_session_created_outbox_id,
    p_session_prepared_event_id,p_session_prepared_outbox_id,
    p_disclosure_event_id,p_disclosure_outbox_id,p_consent_event_id,p_consent_outbox_id,
    p_activated_event_id,p_activated_outbox_id,p_cleanup_event_id,p_cleanup_outbox_id,
    'issued',v_now,v_now+interval '60 minutes'
  );

  perform app.portal_enqueue_text_preview_event(
    p_session_created_outbox_id,p_session_created_event_id,v_membership.tenant_id,p_session_id,
    'session.created',1,p_trace_id,p_correlation_id,null,
    jsonb_build_object(
      'agent_id',p_agent_id,
      'channel',jsonb_build_object('type','web_widget','external_session_ref',null,'region','portal'),
      'consent_status','pending','disclosure_status','pending',
      'capabilities',jsonb_build_object(
        'audio',false,'video',false,'avatar',false,'screen_share',false,'tools',false,'handoff',false
      ),
      'role',jsonb_build_object(
        'role_pack_id',v_agent.role_type,'role_pack_version','portal-text-preview-v1',
        'objective','Conduct a disclosed essential text preview.',
        'stage','opening','milestones',jsonb_build_array(),'missing_fields',jsonb_build_array(),
        'next_best_action',jsonb_build_object(
          'action_code','listen','reason','Wait for the participant text.',
          'confidence',1,'expires_at',v_now+interval '60 minutes'
        )
      ),
      'language','pt-BR'
    ),v_now
  );
  perform app.portal_enqueue_text_preview_event(
    p_session_prepared_outbox_id,p_session_prepared_event_id,v_membership.tenant_id,p_session_id,
    'session.prepared',2,p_trace_id,p_correlation_id,p_session_created_event_id,
    jsonb_build_object(),v_now
  );
  perform app.portal_enqueue_text_preview_event(
    p_disclosure_outbox_id,p_disclosure_event_id,v_membership.tenant_id,p_session_id,
    'disclosure.delivered',3,p_trace_id,p_correlation_id,p_session_prepared_event_id,
    jsonb_build_object('status','acknowledged'),v_now
  );
  perform app.portal_enqueue_text_preview_event(
    p_consent_outbox_id,p_consent_event_id,v_membership.tenant_id,p_session_id,
    'consent.recorded',4,p_trace_id,p_correlation_id,p_disclosure_event_id,
    jsonb_build_object('status','granted'),v_now
  );
  perform app.portal_enqueue_text_preview_event(
    p_activated_outbox_id,p_activated_event_id,v_membership.tenant_id,p_session_id,
    'session.activated',5,p_trace_id,p_correlation_id,p_consent_event_id,
    jsonb_build_object('presenter_id',p_presenter_id),v_now
  );
  update public.sessions
  set status='active',active_presenter_id=p_presenter_id,state_version=5,
      disclosure_status='acknowledged',consent_status='granted',updated_at=v_now
  where tenant_id=v_membership.tenant_id and id=p_session_id and state_version=0;
  if not found then
    raise exception 'text preview session projection conflict' using errcode='40001';
  end if;

  return jsonb_build_object(
    'schema_version','2.0.0',
    'admission_id',p_admission_id,
    'tenant_id',v_membership.tenant_id,
    'actor_id',v_membership.actor_id,
    'agent_id',p_agent_id,
    'session_id',p_session_id,
    'presenter_id',p_presenter_id,
    'profile_id',p_profile_id,
    'profile_version',p_profile_version,
    'profile_fingerprint',p_profile_fingerprint,
    'provider_configuration_fingerprint',p_provider_configuration_fingerprint,
    'client_session_ref_hash',p_client_session_ref_hash,
    'command_fingerprint',p_command_fingerprint,
    'identity_disclosure_id',p_identity_disclosure_id,
    'data_use_disclosure_id',p_data_use_disclosure_id,
    'essential_consent_id',p_essential_consent_id,
    'privacy_policy_id',v_policy.id,
    'jurisdiction',v_policy.jurisdiction,
    'privacy_policy_version',v_policy.policy_version,
    'privacy_policy_fingerprint',v_policy.policy_fingerprint,
    'transcript_consent_id',p_transcript_consent_id,
    'transcript_id',p_transcript_id,
    'persistent_transcript',p_persistent_transcript,
    'status','issued',
    'ttl_seconds',3600,
    'issued_at',v_now,
    'expires_at',v_now+interval '60 minutes'
  );
end;
$$;

create or replace function public.portal_acquire_text_preview_turn_service(
  p_claim_id app.uuid_v7,
  p_attempt_id app.uuid_v7,
  p_admission_id app.uuid_v7,
  p_command_ref_hash text,
  p_command_fingerprint text,
  p_expected_generation integer,
  p_outcome_event_id app.uuid_v7,
  p_outcome_outbox_id app.uuid_v7
) returns jsonb
language plpgsql security definer set search_path='public'
set lock_timeout='2s' set statement_timeout='15s' as $$
declare
  v_admission public.portal_text_preview_admissions%rowtype;
  v_claim public.portal_text_preview_turn_claims%rowtype;
  v_essential public.consent_evidence%rowtype;
  v_identity public.disclosure_records%rowtype;
  v_data_use public.disclosure_records%rowtype;
  v_policy public.portal_text_preview_privacy_policies%rowtype;
  v_next_generation integer;
  v_now timestamptz;
begin
  if p_claim_id is null
    or p_attempt_id is null
    or p_admission_id is null
    or p_command_ref_hash is null
    or p_command_ref_hash !~ '^[0-9a-f]{64}$'
    or p_command_fingerprint is null
    or p_command_fingerprint !~ '^[0-9a-f]{64}$'
    or p_expected_generation is null
    or p_expected_generation not between 0 and 10000000
    or p_outcome_event_id is null
    or p_outcome_outbox_id is null
    or p_outcome_event_id=p_outcome_outbox_id then
    return jsonb_build_object('outcome','conflict');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('portal-text-turn:'||p_admission_id::text,0));
  v_now:=clock_timestamp();
  select * into v_admission
  from public.portal_text_preview_admissions
  where id=p_admission_id
  for update;
  if not found then return jsonb_build_object('outcome','not_authorized'); end if;
  if v_admission.expires_at<=v_now then return jsonb_build_object('outcome','expired'); end if;

  select * into v_claim
  from public.portal_text_preview_turn_claims
  where tenant_id=v_admission.tenant_id
    and admission_id=v_admission.id
    and command_ref_hash=p_command_ref_hash
  for update;
  if found then
    if v_claim.generation<>p_expected_generation
      or v_claim.command_fingerprint<>p_command_fingerprint then
      return jsonb_build_object('outcome','conflict');
    end if;
    if v_claim.state='acquired' and v_claim.lease_expires_at<=v_now then
      if not app.portal_record_text_preview_failure(
          v_admission.id,v_claim.id,null,'worker_lost',null,v_now
        ) then
        return jsonb_build_object('outcome','conflict');
      end if;
      return jsonb_build_object('outcome','failed','reasonCode','worker_lost');
    end if;
    if v_claim.state='acquired' and v_claim.attempt_id=p_attempt_id and v_claim.id=p_claim_id then
      return jsonb_build_object(
        'outcome','acquired','claimId',v_claim.id,'attemptId',v_claim.attempt_id,
        'generation',v_claim.generation,'leaseExpiresAt',v_claim.lease_expires_at
      );
    end if;
    return jsonb_build_object('outcome',case v_claim.state
      when 'acquired' then 'in_flight'
      when 'succeeded' then 'already_processed'
      else 'failed' end);
  end if;

  select * into v_claim from public.portal_text_preview_turn_claims
  where tenant_id=v_admission.tenant_id
    and admission_id=v_admission.id
    and state='acquired'
    and lease_expires_at<=v_now
  order by lease_expires_at,id
  limit 1
  for update;
  if found and not app.portal_record_text_preview_failure(
      v_admission.id,v_claim.id,null,'worker_lost',null,v_now
    ) then
    return jsonb_build_object('outcome','conflict');
  end if;

  if not exists(select 1 from public.agents
      where tenant_id=v_admission.tenant_id and id=v_admission.agent_id and status='active')
    or not exists(select 1 from public.sessions
      where tenant_id=v_admission.tenant_id and id=v_admission.session_id
        and agent_id=v_admission.agent_id and active_presenter_id=v_admission.digital_presenter_id
        and status in ('ready','active'))
    or not exists(select 1 from public.session_participants
      where tenant_id=v_admission.tenant_id and session_id=v_admission.session_id
        and id=v_admission.digital_presenter_id and participant_type='digital_presenter'
        and left_at is null) then
    return jsonb_build_object('outcome','not_authorized');
  end if;

  select * into v_policy from public.portal_text_preview_privacy_policies
  where tenant_id=v_admission.tenant_id and id=v_admission.privacy_policy_id;
  if v_policy.id is null
    or v_policy.jurisdiction<>v_admission.jurisdiction
    or v_policy.policy_version<>v_admission.privacy_policy_version
    or v_policy.policy_fingerprint<>v_admission.privacy_policy_fingerprint
    or v_policy.effective_at>v_now
    or v_policy.expires_at<=v_now
    or exists(select 1 from public.portal_text_preview_privacy_policies p
      where p.tenant_id=v_admission.tenant_id
        and p.effective_at<=v_now
        and p.expires_at>v_now
        and (p.effective_at,p.created_at,p.id)>(v_policy.effective_at,v_policy.created_at,v_policy.id)) then
    return jsonb_build_object('outcome','not_authorized');
  end if;

  select * into v_identity from public.disclosure_records
  where tenant_id=v_admission.tenant_id and id=v_admission.identity_disclosure_id;
  select * into v_data_use from public.disclosure_records
  where tenant_id=v_admission.tenant_id and id=v_admission.data_use_disclosure_id;
  if v_identity.id is null
    or v_identity.session_id<>v_admission.session_id
    or v_identity.disclosure_type<>'ai_identity'
    or v_identity.version<>v_admission.identity_disclosure_version
    or v_identity.content_hash<>v_admission.identity_disclosure_hash
    or not v_identity.acknowledged
    or v_data_use.id is null
    or v_data_use.session_id<>v_admission.session_id
    or v_data_use.disclosure_type<>'data_use'
    or v_data_use.version<>v_admission.data_use_disclosure_version
    or v_data_use.content_hash<>v_admission.data_use_disclosure_hash
    or not v_data_use.acknowledged
    or exists(select 1 from public.disclosure_records d
      where d.tenant_id=v_admission.tenant_id and d.session_id=v_admission.session_id
        and d.disclosure_type=v_identity.disclosure_type
        and (d.delivered_at,d.id)>(v_identity.delivered_at,v_identity.id))
    or exists(select 1 from public.disclosure_records d
      where d.tenant_id=v_admission.tenant_id and d.session_id=v_admission.session_id
        and d.disclosure_type=v_data_use.disclosure_type
        and (d.delivered_at,d.id)>(v_data_use.delivered_at,v_data_use.id)) then
    return jsonb_build_object('outcome','not_authorized');
  end if;

  select * into v_essential from public.consent_evidence
  where tenant_id=v_admission.tenant_id and id=v_admission.essential_consent_id;
  if v_essential.id is null
    or v_essential.session_id<>v_admission.session_id
    or v_essential.consent_type<>'essential_processing'
    or v_essential.purpose<>'portal_text_preview'
    or v_essential.status<>'granted'
    or v_essential.revoked_at is not null
    or (v_essential.expires_at is not null and v_essential.expires_at<=v_now)
    or exists(select 1 from public.consent_evidence c
      where c.tenant_id=v_admission.tenant_id
        and c.session_id=v_admission.session_id
        and c.subject_ref=v_essential.subject_ref
        and c.consent_type=v_essential.consent_type
        and c.purpose=v_essential.purpose
        and (c.captured_at,c.id)>(v_essential.captured_at,v_essential.id)) then
    return jsonb_build_object('outcome','not_authorized');
  end if;

  select coalesce(max(generation),-1)+1 into v_next_generation
  from public.portal_text_preview_turn_claims
  where tenant_id=v_admission.tenant_id
    and admission_id=v_admission.id
    and state='succeeded';
  if p_expected_generation<>v_next_generation then
    return jsonb_build_object('outcome','stale_generation');
  end if;
  if exists(select 1 from public.portal_text_preview_turn_claims
      where tenant_id=v_admission.tenant_id
        and admission_id=v_admission.id
        and generation=p_expected_generation
        and state in ('acquired','succeeded'))
    or exists(select 1 from public.portal_text_preview_turn_claims
      where id=p_claim_id or (tenant_id=v_admission.tenant_id and attempt_id=p_attempt_id)) then
    return jsonb_build_object('outcome','conflict');
  end if;

  insert into public.portal_text_preview_turn_claims(
    id,attempt_id,tenant_id,admission_id,actor_id,agent_id,generation,
    command_ref_hash,command_fingerprint,outcome_event_id,outcome_outbox_id,
    state,acquired_at,lease_expires_at
  ) values (
    p_claim_id,p_attempt_id,v_admission.tenant_id,v_admission.id,v_admission.actor_id,
    v_admission.agent_id,p_expected_generation,p_command_ref_hash,
    p_command_fingerprint,p_outcome_event_id,p_outcome_outbox_id,
    'acquired',v_now,v_now+interval '90 seconds'
  );
  return jsonb_build_object(
    'outcome','acquired','claimId',p_claim_id,'attemptId',p_attempt_id,
    'generation',p_expected_generation,'leaseExpiresAt',v_now+interval '90 seconds'
  );
end;
$$;

create or replace function public.portal_authorize_text_preview_egress_service(
  p_egress_id app.uuid_v7,
  p_admission_id app.uuid_v7,
  p_claim_id app.uuid_v7,
  p_attempt_id app.uuid_v7,
  p_expected_generation integer,
  p_kind text,
  p_ai_usage_reservation_id app.uuid_v7
) returns jsonb
language plpgsql security definer set search_path='public'
set lock_timeout='2s' set statement_timeout='15s' as $$
declare
  v_admission public.portal_text_preview_admissions%rowtype;
  v_claim public.portal_text_preview_turn_claims%rowtype;
  v_existing public.portal_text_preview_egress_authorizations%rowtype;
  v_agent public.agents%rowtype;
  v_session public.sessions%rowtype;
  v_presenter public.session_participants%rowtype;
  v_policy public.portal_text_preview_privacy_policies%rowtype;
  v_identity public.disclosure_records%rowtype;
  v_data_use public.disclosure_records%rowtype;
  v_essential public.consent_evidence%rowtype;
  v_ai_usage public.ai_usage_reservations%rowtype;
  v_now timestamptz;
  v_expires_at timestamptz;
begin
  if p_egress_id is null
    or p_admission_id is null
    or p_claim_id is null
    or p_attempt_id is null
    or p_expected_generation is null
    or p_expected_generation not between 0 and 10000000
    or p_kind is null
    or p_kind not in ('embedding','generation')
    or p_ai_usage_reservation_id is null then
    return jsonb_build_object('outcome','conflict');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('portal-text-turn:'||p_admission_id::text,0));
  select * into v_admission
  from public.portal_text_preview_admissions
  where id=p_admission_id
  for update;
  if not found then return jsonb_build_object('outcome','not_authorized'); end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'portal-text-policy:'||v_admission.tenant_id::text,0
  ));
  select * into v_claim
  from public.portal_text_preview_turn_claims
  where tenant_id=v_admission.tenant_id
    and admission_id=v_admission.id
    and id=p_claim_id
  for update;
  if not found then return jsonb_build_object('outcome','not_authorized'); end if;

  v_now:=clock_timestamp();
  if v_claim.attempt_id<>p_attempt_id
    or v_claim.generation<>p_expected_generation then
    return jsonb_build_object('outcome','conflict');
  end if;

  select * into v_existing
  from public.portal_text_preview_egress_authorizations
  where tenant_id=v_admission.tenant_id
    and claim_id=v_claim.id
    and kind=p_kind;
  if found then
    if v_existing.ai_usage_reservation_id<>p_ai_usage_reservation_id
      or v_existing.attempt_id<>p_attempt_id
      or v_existing.generation<>p_expected_generation then
      return jsonb_build_object('outcome','conflict');
    end if;
  end if;
  if v_existing.id is null
    and exists(select 1 from public.portal_text_preview_egress_authorizations where id=p_egress_id) then
    return jsonb_build_object('outcome','conflict');
  end if;
  if v_claim.state<>'acquired'
    or (v_existing.id is null and (
      v_claim.lease_expires_at<=v_now+interval '35 seconds'
      or v_admission.expires_at<=v_now+interval '35 seconds'
    ))
    or (v_existing.id is not null and (
      v_claim.lease_expires_at<=v_now
      or v_admission.expires_at<=v_now
      or v_existing.expires_at<=v_now
    )) then
    return jsonb_build_object('outcome','expired');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_admission.tenant_id::text,0));
  select * into v_ai_usage
  from public.ai_usage_reservations
  where tenant_id=v_admission.tenant_id and id=p_ai_usage_reservation_id
  for update;
  v_now:=clock_timestamp();
  if not found
    or v_claim.state<>'acquired'
    or (v_existing.id is null and (
      v_claim.lease_expires_at<=v_now+interval '35 seconds'
      or v_admission.expires_at<=v_now+interval '35 seconds'
    ))
    or (v_existing.id is not null and (
      v_claim.lease_expires_at<=v_now
      or v_admission.expires_at<=v_now
      or v_existing.expires_at<=v_now
    ))
    or v_ai_usage.agent_id is distinct from v_admission.agent_id
    or v_ai_usage.source_id is not null
    or v_ai_usage.created_at<v_now-interval '10 minutes'
    or v_ai_usage.operation<>(case
      when p_kind='embedding' then 'knowledge_query_embedding'
      else 'chat_generation'
    end)
    or (v_existing.id is null and v_ai_usage.state<>'reserved')
    or (v_existing.id is not null and (
      v_ai_usage.id<>v_existing.ai_usage_reservation_id
      or v_ai_usage.state<>'provider_in_flight'
      or v_ai_usage.provider_dispatched_at is distinct from v_existing.authorized_at
      or v_existing.expires_at<=v_now
    ))
    or exists(select 1 from public.ai_usage_reservations u
      where u.tenant_id=v_admission.tenant_id
        and u.id<>v_ai_usage.id
        and u.state in ('provider_in_flight','unknown')) then
    return jsonb_build_object('outcome','not_authorized');
  end if;

  -- Match the canonical AI reservation lock order: tenant advisory first, then
  -- reservation, agent, session and Presenter rows. This avoids a begin-usage
  -- versus egress authorization deadlock.
  select * into v_agent
  from public.agents
  where tenant_id=v_admission.tenant_id and id=v_admission.agent_id
  for update;
  select * into v_session
  from public.sessions
  where tenant_id=v_admission.tenant_id and id=v_admission.session_id
  for update;
  select * into v_presenter
  from public.session_participants
  where tenant_id=v_admission.tenant_id
    and session_id=v_admission.session_id
    and id=v_admission.digital_presenter_id
  for update;
  v_now:=clock_timestamp();
  if v_claim.state<>'acquired'
    or (v_existing.id is null and (
      v_claim.lease_expires_at<=v_now+interval '35 seconds'
      or v_admission.expires_at<=v_now+interval '35 seconds'
    ))
    or (v_existing.id is not null and (
      v_claim.lease_expires_at<=v_now
      or v_admission.expires_at<=v_now
      or v_existing.expires_at<=v_now
    ))
    or v_ai_usage.state<>(case when v_existing.id is null then 'reserved' else 'provider_in_flight' end) then
    return jsonb_build_object('outcome','expired');
  end if;

  if v_agent.id is null
    or v_agent.status<>'active'
    or v_session.id is null
    or v_session.agent_id<>v_admission.agent_id
    or v_session.status not in ('ready','active')
    or v_session.active_presenter_id is distinct from v_admission.digital_presenter_id
    or v_presenter.id is null
    or v_presenter.participant_type<>'digital_presenter'
    or v_presenter.left_at is not null
    or (select count(*) from public.session_participants
      where tenant_id=v_admission.tenant_id
        and session_id=v_admission.session_id
        and participant_type='digital_presenter'
        and left_at is null)<>1 then
    return jsonb_build_object('outcome','not_authorized');
  end if;

  select * into v_policy
  from public.portal_text_preview_privacy_policies
  where tenant_id=v_admission.tenant_id
    and effective_at<=v_now
    and expires_at>v_now
  order by effective_at desc,created_at desc,id desc
  limit 1
  for key share;
  if v_policy.id is null
    or v_policy.id<>v_admission.privacy_policy_id
    or v_policy.jurisdiction<>v_admission.jurisdiction
    or v_policy.policy_version<>v_admission.privacy_policy_version
    or v_policy.policy_fingerprint<>v_admission.privacy_policy_fingerprint then
    return jsonb_build_object('outcome','not_authorized');
  end if;

  select * into v_identity
  from public.disclosure_records
  where tenant_id=v_admission.tenant_id
    and session_id=v_admission.session_id
    and disclosure_type='ai_identity'
  order by delivered_at desc,id desc
  limit 1
  for key share;
  select * into v_data_use
  from public.disclosure_records
  where tenant_id=v_admission.tenant_id
    and session_id=v_admission.session_id
    and disclosure_type='data_use'
  order by delivered_at desc,id desc
  limit 1
  for key share;
  if v_identity.id is null
    or v_identity.id<>v_admission.identity_disclosure_id
    or v_identity.version<>v_admission.identity_disclosure_version
    or v_identity.content_hash<>v_admission.identity_disclosure_hash
    or not v_identity.acknowledged
    or v_data_use.id is null
    or v_data_use.id<>v_admission.data_use_disclosure_id
    or v_data_use.version<>v_admission.data_use_disclosure_version
    or v_data_use.content_hash<>v_admission.data_use_disclosure_hash
    or not v_data_use.acknowledged then
    return jsonb_build_object('outcome','not_authorized');
  end if;

  select * into v_essential
  from public.consent_evidence
  where tenant_id=v_admission.tenant_id and id=v_admission.essential_consent_id
  for key share;
  if v_essential.id is null
    or v_essential.session_id<>v_admission.session_id
    or v_essential.consent_type<>'essential_processing'
    or v_essential.purpose<>'portal_text_preview'
    or v_essential.status<>'granted'
    or v_essential.revoked_at is not null
    or (v_essential.expires_at is not null and v_essential.expires_at<=v_now)
    or exists(select 1 from public.consent_evidence c
      where c.tenant_id=v_admission.tenant_id
        and c.session_id=v_admission.session_id
        and c.subject_ref=v_essential.subject_ref
        and c.consent_type=v_essential.consent_type
        and c.purpose=v_essential.purpose
        and (c.captured_at,c.id)>(v_essential.captured_at,v_essential.id)) then
    return jsonb_build_object('outcome','not_authorized');
  end if;

  perform 1
  from public.user_tenant_memberships m
  join public.tenants t
    on t.id=m.tenant_id and t.status in ('trial','active')
  where m.tenant_id=v_admission.tenant_id and m.actor_id=v_admission.actor_id
  for key share of m
  for share of t;
  if not found then
    return jsonb_build_object('outcome','not_authorized');
  end if;

  -- Membership and tenant authority are the final blocking locks. Decisions
  -- below use a fresh PostgreSQL clock so legal evidence cannot expire while
  -- this call waits and still authorize provider dispatch.
  v_now:=clock_timestamp();
  if v_claim.state<>'acquired'
    or (v_existing.id is null and (
      v_claim.lease_expires_at<=v_now+interval '35 seconds'
      or v_admission.expires_at<=v_now+interval '35 seconds'
    ))
    or (v_existing.id is not null and (
      v_claim.lease_expires_at<=v_now
      or v_admission.expires_at<=v_now
      or v_existing.expires_at<=v_now
    )) then
    return jsonb_build_object('outcome','expired');
  end if;
  if v_policy.id is null
    or v_policy.id<>v_admission.privacy_policy_id
    or v_policy.jurisdiction<>v_admission.jurisdiction
    or v_policy.policy_version<>v_admission.privacy_policy_version
    or v_policy.policy_fingerprint<>v_admission.privacy_policy_fingerprint
    or v_policy.effective_at>v_now
    or v_policy.expires_at<=v_now
    or exists(select 1 from public.portal_text_preview_privacy_policies p
      where p.tenant_id=v_admission.tenant_id
        and p.effective_at<=v_now
        and p.expires_at>v_now
        and (p.effective_at,p.created_at,p.id)>(v_policy.effective_at,v_policy.created_at,v_policy.id)) then
    return jsonb_build_object('outcome','not_authorized');
  end if;
  if v_essential.id is null
    or v_essential.session_id<>v_admission.session_id
    or v_essential.consent_type<>'essential_processing'
    or v_essential.purpose<>'portal_text_preview'
    or v_essential.status<>'granted'
    or v_essential.revoked_at is not null
    or (v_essential.expires_at is not null and v_essential.expires_at<=v_now)
    or exists(select 1 from public.consent_evidence c
      where c.tenant_id=v_admission.tenant_id
        and c.session_id=v_admission.session_id
        and c.subject_ref=v_essential.subject_ref
        and c.consent_type=v_essential.consent_type
        and c.purpose=v_essential.purpose
        and (c.captured_at,c.id)>(v_essential.captured_at,v_essential.id)) then
    return jsonb_build_object('outcome','not_authorized');
  end if;

  if v_existing.id is not null then
    return jsonb_build_object(
      'outcome','already_authorized',
      'egressId',v_existing.id,
      'kind',v_existing.kind,
      'authorizedAt',v_existing.authorized_at,
      'expiresAt',v_existing.expires_at
    );
  end if;

  v_expires_at:=least(v_now+interval '15 seconds',v_claim.lease_expires_at,v_admission.expires_at);
  if v_expires_at<=v_now then
    return jsonb_build_object('outcome','expired');
  end if;
  update public.ai_usage_reservations
  set state='provider_in_flight',provider_dispatched_at=v_now,updated_at=v_now
  where tenant_id=v_admission.tenant_id
    and id=v_ai_usage.id
    and state='reserved';
  if not found then return jsonb_build_object('outcome','not_authorized'); end if;
  insert into public.portal_text_preview_egress_authorizations(
    id,tenant_id,admission_id,claim_id,ai_usage_reservation_id,
    attempt_id,generation,kind,authorized_at,expires_at
  ) values (
    p_egress_id,v_admission.tenant_id,v_admission.id,v_claim.id,v_ai_usage.id,
    v_claim.attempt_id,v_claim.generation,p_kind,v_now,v_expires_at
  );
  return jsonb_build_object(
    'outcome','authorized',
    'egressId',p_egress_id,
    'kind',p_kind,
    'authorizedAt',v_now,
    'expiresAt',v_expires_at
  );
end;
$$;

create or replace function public.portal_complete_text_preview_turn_service(
  p_admission_id app.uuid_v7,
  p_claim_id app.uuid_v7,
  p_attempt_id app.uuid_v7,
  p_expected_generation integer,
  p_command_fingerprint text,
  p_completion_fingerprint text,
  p_provider_request_id text,
  p_user_turn text,
  p_assistant_turn text
) returns jsonb
language plpgsql security definer set search_path='public'
set lock_timeout='2s' set statement_timeout='15s' as $$
declare
  v_admission public.portal_text_preview_admissions%rowtype;
  v_claim public.portal_text_preview_turn_claims%rowtype;
  v_agent public.agents%rowtype;
  v_session public.sessions%rowtype;
  v_presenter public.session_participants%rowtype;
  v_identity public.disclosure_records%rowtype;
  v_data_use public.disclosure_records%rowtype;
  v_essential public.consent_evidence%rowtype;
  v_transcript_consent public.consent_evidence%rowtype;
  v_transcript public.conversation_transcripts%rowtype;
  v_write public.portal_text_preview_transcript_writes%rowtype;
  v_generation_egress public.portal_text_preview_egress_authorizations%rowtype;
  v_policy public.portal_text_preview_privacy_policies%rowtype;
  v_pair jsonb;
  v_persistence text;
  v_now timestamptz;
begin
  if p_admission_id is null
    or p_claim_id is null
    or p_attempt_id is null
    or p_expected_generation is null
    or p_expected_generation not between 0 and 10000000
    or p_command_fingerprint is null
    or p_command_fingerprint !~ '^[0-9a-f]{64}$'
    or p_completion_fingerprint is null
    or p_completion_fingerprint !~ '^hmac-sha256:[0-9a-f]{64}$'
    or (p_provider_request_id is not null and (
      char_length(p_provider_request_id) not between 1 and 128
      or octet_length(p_provider_request_id)<>char_length(p_provider_request_id)
      or p_provider_request_id !~ '^[!-~]{1,128}$'
    )) then
    return jsonb_build_object('outcome','conflict');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('portal-text-turn:'||p_admission_id::text,0));
  v_now:=clock_timestamp();
  select * into v_admission
  from public.portal_text_preview_admissions
  where id=p_admission_id
  for update;
  if not found then return jsonb_build_object('outcome','not_authorized'); end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'portal-text-policy:'||v_admission.tenant_id::text,0
  ));

  if (v_admission.persistence_selection='off' and (p_user_turn is not null or p_assistant_turn is not null))
    or (v_admission.persistence_selection='opt_in' and (
      p_user_turn is null or char_length(p_user_turn) not between 1 and 2000
      or p_assistant_turn is null or char_length(p_assistant_turn) not between 1 and 4000
    )) then
    return jsonb_build_object('outcome','conflict');
  end if;

  select * into v_claim
  from public.portal_text_preview_turn_claims
  where tenant_id=v_admission.tenant_id
    and admission_id=v_admission.id
    and id=p_claim_id
  for update;
  if not found then return jsonb_build_object('outcome','not_authorized'); end if;
  if v_claim.generation<>p_expected_generation
    or v_claim.command_fingerprint<>p_command_fingerprint
    or v_claim.attempt_id<>p_attempt_id then
    return jsonb_build_object('outcome','conflict');
  end if;
  v_now:=clock_timestamp();
  if v_claim.state='succeeded' then
    if v_claim.completion_fingerprint<>p_completion_fingerprint
      or v_claim.provider_request_id is distinct from p_provider_request_id then
      return jsonb_build_object('outcome','conflict');
    end if;
    select * into v_write from public.portal_text_preview_transcript_writes
    where tenant_id=v_claim.tenant_id
      and admission_id=v_claim.admission_id
      and claim_id=v_claim.id
      and generation=v_claim.generation;
    v_persistence:=case
      when v_admission.persistence_selection='off' then 'disabled'
      when v_write.claim_id is not null then 'saved'
      else 'not_saved'
    end;
    return jsonb_build_object(
      'outcome','succeeded','persistence',v_persistence,
      'providerRequestId',v_claim.provider_request_id
    );
  end if;
  if v_claim.state='failed'
    and v_claim.reason_code='provider_response_uncommitted'
    and v_claim.provider_request_id is not distinct from p_provider_request_id then
    return jsonb_build_object(
      'outcome','failed','reasonCode','provider_response_uncommitted',
      'providerRequestId',v_claim.provider_request_id
    );
  end if;
  if v_claim.state<>'acquired' then return jsonb_build_object('outcome','conflict'); end if;
  if p_provider_request_id is not null then
    select * into v_generation_egress
    from public.portal_text_preview_egress_authorizations
    where tenant_id=v_claim.tenant_id
      and admission_id=v_claim.admission_id
      and claim_id=v_claim.id
      and attempt_id=v_claim.attempt_id
      and generation=v_claim.generation
      and kind='generation';
    if not found then return jsonb_build_object('outcome','conflict'); end if;
  end if;
  if v_claim.lease_expires_at<=v_now then
    if not app.portal_record_text_preview_failure(
        v_admission.id,v_claim.id,p_attempt_id,
        case when p_provider_request_id is null then 'worker_lost' else 'provider_response_uncommitted' end,
        p_provider_request_id,v_now
      ) then
      return jsonb_build_object('outcome','conflict');
    end if;
    if p_provider_request_id is null then
      return jsonb_build_object('outcome','failed','reasonCode','worker_lost');
    end if;
    return jsonb_build_object(
      'outcome','failed','reasonCode','provider_response_uncommitted',
      'providerRequestId',p_provider_request_id
    );
  end if;
  if v_admission.expires_at<=v_now then
    if p_provider_request_id is null then return jsonb_build_object('outcome','not_authorized'); end if;
    if not app.portal_record_text_preview_failure(
        v_admission.id,v_claim.id,p_attempt_id,'provider_response_uncommitted',p_provider_request_id,v_now
      ) then return jsonb_build_object('outcome','conflict'); end if;
    return jsonb_build_object('outcome','failed','reasonCode','provider_response_uncommitted','providerRequestId',p_provider_request_id);
  end if;

  select * into v_agent from public.agents
  where tenant_id=v_admission.tenant_id and id=v_admission.agent_id and status='active'
  for update;
  if not found then
    if p_provider_request_id is null then return jsonb_build_object('outcome','not_authorized'); end if;
    if not app.portal_record_text_preview_failure(
        v_admission.id,v_claim.id,p_attempt_id,'provider_response_uncommitted',p_provider_request_id,v_now
      ) then return jsonb_build_object('outcome','conflict'); end if;
    return jsonb_build_object('outcome','failed','reasonCode','provider_response_uncommitted','providerRequestId',p_provider_request_id);
  end if;
  select * into v_session from public.sessions
  where tenant_id=v_admission.tenant_id and id=v_admission.session_id
  for update;
  if not found
    or v_session.agent_id<>v_admission.agent_id
    or v_session.status not in ('ready','active')
    or v_session.active_presenter_id is distinct from v_admission.digital_presenter_id then
    if p_provider_request_id is null then return jsonb_build_object('outcome','not_authorized'); end if;
    if not app.portal_record_text_preview_failure(
        v_admission.id,v_claim.id,p_attempt_id,'provider_response_uncommitted',p_provider_request_id,v_now
      ) then return jsonb_build_object('outcome','conflict'); end if;
    return jsonb_build_object('outcome','failed','reasonCode','provider_response_uncommitted','providerRequestId',p_provider_request_id);
  end if;

  select * into v_presenter from public.session_participants
  where tenant_id=v_admission.tenant_id
    and session_id=v_admission.session_id
    and id=v_admission.digital_presenter_id
  for update;
  if not found
    or v_presenter.participant_type<>'digital_presenter'
    or v_presenter.left_at is not null
    or (select count(*) from public.session_participants
      where tenant_id=v_admission.tenant_id
        and session_id=v_admission.session_id
        and participant_type='digital_presenter'
        and left_at is null)<>1 then
    if p_provider_request_id is null then return jsonb_build_object('outcome','not_authorized'); end if;
    if not app.portal_record_text_preview_failure(
        v_admission.id,v_claim.id,p_attempt_id,'provider_response_uncommitted',p_provider_request_id,v_now
      ) then return jsonb_build_object('outcome','conflict'); end if;
    return jsonb_build_object('outcome','failed','reasonCode','provider_response_uncommitted','providerRequestId',p_provider_request_id);
  end if;

  -- Authority locks above may wait. Refresh the database clock after the final
  -- blocking lock, then revalidate both expiry boundaries before any success.
  v_now:=clock_timestamp();
  if v_claim.lease_expires_at<=v_now then
    if not app.portal_record_text_preview_failure(
        v_admission.id,v_claim.id,p_attempt_id,
        case when p_provider_request_id is null then 'worker_lost' else 'provider_response_uncommitted' end,
        p_provider_request_id,v_now
      ) then return jsonb_build_object('outcome','conflict'); end if;
    if p_provider_request_id is null then
      return jsonb_build_object('outcome','failed','reasonCode','worker_lost');
    end if;
    return jsonb_build_object(
      'outcome','failed','reasonCode','provider_response_uncommitted',
      'providerRequestId',p_provider_request_id
    );
  end if;
  if v_admission.expires_at<=v_now then
    if p_provider_request_id is null then return jsonb_build_object('outcome','not_authorized'); end if;
    if not app.portal_record_text_preview_failure(
        v_admission.id,v_claim.id,p_attempt_id,'provider_response_uncommitted',p_provider_request_id,v_now
      ) then return jsonb_build_object('outcome','conflict'); end if;
    return jsonb_build_object(
      'outcome','failed','reasonCode','provider_response_uncommitted',
      'providerRequestId',p_provider_request_id
    );
  end if;

  select * into v_identity from public.disclosure_records
  where tenant_id=v_admission.tenant_id
    and session_id=v_admission.session_id
    and disclosure_type='ai_identity'
  order by delivered_at desc,id desc
  limit 1
  for key share;
  select * into v_data_use from public.disclosure_records
  where tenant_id=v_admission.tenant_id
    and session_id=v_admission.session_id
    and disclosure_type='data_use'
  order by delivered_at desc,id desc
  limit 1
  for key share;
  if v_identity.id is null
    or v_identity.id<>v_admission.identity_disclosure_id
    or v_identity.session_id<>v_admission.session_id
    or v_identity.disclosure_type<>'ai_identity'
    or v_identity.version<>v_admission.identity_disclosure_version
    or v_identity.content_hash<>v_admission.identity_disclosure_hash
    or not v_identity.acknowledged
    or v_data_use.id is null
    or v_data_use.id<>v_admission.data_use_disclosure_id
    or v_data_use.session_id<>v_admission.session_id
    or v_data_use.disclosure_type<>'data_use'
    or v_data_use.version<>v_admission.data_use_disclosure_version
    or v_data_use.content_hash<>v_admission.data_use_disclosure_hash
    or not v_data_use.acknowledged then
    if p_provider_request_id is null then return jsonb_build_object('outcome','not_authorized'); end if;
    if not app.portal_record_text_preview_failure(
        v_admission.id,v_claim.id,p_attempt_id,'provider_response_uncommitted',p_provider_request_id,v_now
      ) then return jsonb_build_object('outcome','conflict'); end if;
    return jsonb_build_object('outcome','failed','reasonCode','provider_response_uncommitted','providerRequestId',p_provider_request_id);
  end if;

  select * into v_policy from public.portal_text_preview_privacy_policies
  where tenant_id=v_admission.tenant_id
    and effective_at<=v_now
    and expires_at>v_now
  order by effective_at desc,created_at desc,id desc
  limit 1
  for key share;
  if v_policy.id is null
    or v_policy.id<>v_admission.privacy_policy_id
    or v_policy.jurisdiction<>v_admission.jurisdiction
    or v_policy.policy_version<>v_admission.privacy_policy_version
    or v_policy.policy_fingerprint<>v_admission.privacy_policy_fingerprint
    or v_policy.effective_at>v_now
    or v_policy.expires_at<=v_now then
    if p_provider_request_id is null then return jsonb_build_object('outcome','not_authorized'); end if;
    if not app.portal_record_text_preview_failure(
        v_admission.id,v_claim.id,p_attempt_id,'provider_response_uncommitted',p_provider_request_id,v_now
      ) then return jsonb_build_object('outcome','conflict'); end if;
    return jsonb_build_object('outcome','failed','reasonCode','provider_response_uncommitted','providerRequestId',p_provider_request_id);
  end if;

  select * into v_essential from public.consent_evidence
  where tenant_id=v_admission.tenant_id and id=v_admission.essential_consent_id
  for key share;
  if v_essential.id is null
    or v_essential.session_id<>v_admission.session_id
    or v_essential.consent_type<>'essential_processing'
    or v_essential.purpose<>'portal_text_preview'
    or v_essential.status<>'granted'
    or v_essential.revoked_at is not null
    or (v_essential.expires_at is not null and v_essential.expires_at<=v_now)
    or exists(select 1 from public.consent_evidence c
      where c.tenant_id=v_admission.tenant_id
        and c.session_id=v_admission.session_id
        and c.subject_ref=v_essential.subject_ref
        and c.consent_type=v_essential.consent_type
        and c.purpose=v_essential.purpose
        and (c.captured_at,c.id)>(v_essential.captured_at,v_essential.id)) then
    if p_provider_request_id is null then return jsonb_build_object('outcome','not_authorized'); end if;
    if not app.portal_record_text_preview_failure(
        v_admission.id,v_claim.id,p_attempt_id,'provider_response_uncommitted',p_provider_request_id,v_now
      ) then return jsonb_build_object('outcome','conflict'); end if;
    return jsonb_build_object(
      'outcome','failed','reasonCode','provider_response_uncommitted',
      'providerRequestId',p_provider_request_id
    );
  end if;

  if v_admission.persistence_selection='off' then
    v_persistence:='disabled';
  else
    select * into v_transcript_consent from public.consent_evidence
    where tenant_id=v_admission.tenant_id and id=v_admission.transcript_consent_id
    for key share;
    if v_transcript_consent.id is null
      or v_transcript_consent.session_id<>v_admission.session_id
      or v_transcript_consent.subject_ref<>v_essential.subject_ref
      or v_transcript_consent.consent_type<>'persistent_transcription'
      or v_transcript_consent.purpose<>'portal_text_preview'
      or v_transcript_consent.status<>'granted'
      or v_transcript_consent.revoked_at is not null
      or (v_transcript_consent.expires_at is not null and v_transcript_consent.expires_at<=v_now)
      or exists(select 1 from public.consent_evidence c
        where c.tenant_id=v_admission.tenant_id
          and c.session_id=v_admission.session_id
          and c.subject_ref=v_transcript_consent.subject_ref
          and c.consent_type=v_transcript_consent.consent_type
          and c.purpose=v_transcript_consent.purpose
          and (c.captured_at,c.id)>(v_transcript_consent.captured_at,v_transcript_consent.id)) then
      v_persistence:='not_saved';
    else
      select * into v_transcript
      from public.conversation_transcripts
      where tenant_id=v_admission.tenant_id and id=v_admission.transcript_id
      for update;
      v_now:=clock_timestamp();
      if v_claim.lease_expires_at<=v_now then
        if not app.portal_record_text_preview_failure(
            v_admission.id,v_claim.id,p_attempt_id,
            case when p_provider_request_id is null then 'worker_lost' else 'provider_response_uncommitted' end,
            p_provider_request_id,v_now
          ) then return jsonb_build_object('outcome','conflict'); end if;
        if p_provider_request_id is null then
          return jsonb_build_object('outcome','failed','reasonCode','worker_lost');
        end if;
        return jsonb_build_object(
          'outcome','failed','reasonCode','provider_response_uncommitted',
          'providerRequestId',p_provider_request_id
        );
      end if;
      if v_admission.expires_at<=v_now then
        if p_provider_request_id is null then return jsonb_build_object('outcome','not_authorized'); end if;
        if not app.portal_record_text_preview_failure(
            v_admission.id,v_claim.id,p_attempt_id,'provider_response_uncommitted',p_provider_request_id,v_now
          ) then return jsonb_build_object('outcome','conflict'); end if;
        return jsonb_build_object(
          'outcome','failed','reasonCode','provider_response_uncommitted',
          'providerRequestId',p_provider_request_id
        );
      end if;
      if not found
        or v_transcript.agent_id<>v_admission.agent_id
        or v_transcript.surface<>'chat'
        or v_transcript.external_ref<>'portal-text:'||v_admission.id::text then
        v_persistence:='not_saved';
      else
        v_pair:=jsonb_build_array(
          jsonb_build_object('role','user','content',p_user_turn),
          jsonb_build_object('role','assistant','content',p_assistant_turn)
        );
        perform app.validate_transcript_turns(v_transcript.turns||v_pair);
        v_persistence:='saved';
      end if;
    end if;
  end if;
  v_now:=clock_timestamp();
  if v_claim.lease_expires_at<=v_now then
    if not app.portal_record_text_preview_failure(
        v_admission.id,v_claim.id,p_attempt_id,
        case when p_provider_request_id is null then 'worker_lost' else 'provider_response_uncommitted' end,
        p_provider_request_id,v_now
      ) then return jsonb_build_object('outcome','conflict'); end if;
    if p_provider_request_id is null then
      return jsonb_build_object('outcome','failed','reasonCode','worker_lost');
    end if;
    return jsonb_build_object(
      'outcome','failed','reasonCode','provider_response_uncommitted',
      'providerRequestId',p_provider_request_id
    );
  end if;
  if v_admission.expires_at<=v_now then
    if p_provider_request_id is null then return jsonb_build_object('outcome','not_authorized'); end if;
    if not app.portal_record_text_preview_failure(
        v_admission.id,v_claim.id,p_attempt_id,'provider_response_uncommitted',p_provider_request_id,v_now
      ) then return jsonb_build_object('outcome','conflict'); end if;
    return jsonb_build_object(
      'outcome','failed','reasonCode','provider_response_uncommitted',
      'providerRequestId',p_provider_request_id
    );
  end if;
  if v_policy.id is null
    or v_policy.id<>v_admission.privacy_policy_id
    or v_policy.jurisdiction<>v_admission.jurisdiction
    or v_policy.policy_version<>v_admission.privacy_policy_version
    or v_policy.policy_fingerprint<>v_admission.privacy_policy_fingerprint
    or v_policy.effective_at>v_now
    or v_policy.expires_at<=v_now
    or exists(select 1 from public.portal_text_preview_privacy_policies p
      where p.tenant_id=v_admission.tenant_id
        and p.effective_at<=v_now
        and p.expires_at>v_now
        and (p.effective_at,p.created_at,p.id)>(v_policy.effective_at,v_policy.created_at,v_policy.id)) then
    if p_provider_request_id is null then return jsonb_build_object('outcome','not_authorized'); end if;
    if not app.portal_record_text_preview_failure(
        v_admission.id,v_claim.id,p_attempt_id,'provider_response_uncommitted',p_provider_request_id,v_now
      ) then return jsonb_build_object('outcome','conflict'); end if;
    return jsonb_build_object(
      'outcome','failed','reasonCode','provider_response_uncommitted',
      'providerRequestId',p_provider_request_id
    );
  end if;
  if v_essential.id is null
    or v_essential.session_id<>v_admission.session_id
    or v_essential.consent_type<>'essential_processing'
    or v_essential.purpose<>'portal_text_preview'
    or v_essential.status<>'granted'
    or v_essential.revoked_at is not null
    or (v_essential.expires_at is not null and v_essential.expires_at<=v_now)
    or exists(select 1 from public.consent_evidence c
      where c.tenant_id=v_admission.tenant_id
        and c.session_id=v_admission.session_id
        and c.subject_ref=v_essential.subject_ref
        and c.consent_type=v_essential.consent_type
        and c.purpose=v_essential.purpose
        and (c.captured_at,c.id)>(v_essential.captured_at,v_essential.id)) then
    if p_provider_request_id is null then return jsonb_build_object('outcome','not_authorized'); end if;
    if not app.portal_record_text_preview_failure(
        v_admission.id,v_claim.id,p_attempt_id,'provider_response_uncommitted',p_provider_request_id,v_now
      ) then return jsonb_build_object('outcome','conflict'); end if;
    return jsonb_build_object(
      'outcome','failed','reasonCode','provider_response_uncommitted',
      'providerRequestId',p_provider_request_id
    );
  end if;
  if v_admission.persistence_selection='opt_in'
    and v_persistence='saved'
    and (
      v_transcript_consent.id is null
      or v_transcript_consent.session_id<>v_admission.session_id
      or v_transcript_consent.subject_ref<>v_essential.subject_ref
      or v_transcript_consent.consent_type<>'persistent_transcription'
      or v_transcript_consent.purpose<>'portal_text_preview'
      or v_transcript_consent.status<>'granted'
      or v_transcript_consent.revoked_at is not null
      or (v_transcript_consent.expires_at is not null and v_transcript_consent.expires_at<=v_now)
      or exists(select 1 from public.consent_evidence c
        where c.tenant_id=v_admission.tenant_id
          and c.session_id=v_admission.session_id
          and c.subject_ref=v_transcript_consent.subject_ref
          and c.consent_type=v_transcript_consent.consent_type
          and c.purpose=v_transcript_consent.purpose
          and (c.captured_at,c.id)>(v_transcript_consent.captured_at,v_transcript_consent.id))
    ) then
    v_persistence:='not_saved';
  end if;
  if not app.portal_record_text_preview_success(
      v_admission.id,v_claim.id,p_attempt_id,p_completion_fingerprint,
      p_provider_request_id,v_persistence,v_now
  ) then
    return jsonb_build_object('outcome','conflict');
  end if;
  if v_persistence='saved' then
    update public.conversation_transcripts
    set turns=v_transcript.turns||v_pair,updated_at=v_now
    where tenant_id=v_admission.tenant_id and id=v_admission.transcript_id;
    insert into public.portal_text_preview_transcript_writes(
      claim_id,tenant_id,admission_id,transcript_id,generation
    ) values (
      v_claim.id,v_admission.tenant_id,v_admission.id,v_admission.transcript_id,
      v_claim.generation
    );
  end if;
  return jsonb_build_object(
    'outcome','succeeded','persistence',v_persistence,'providerRequestId',p_provider_request_id
  );
end;
$$;

create or replace function public.portal_reconcile_text_preview_provider_response_service(
  p_admission_id app.uuid_v7,
  p_claim_id app.uuid_v7,
  p_attempt_id app.uuid_v7,
  p_expected_generation integer,
  p_command_fingerprint text,
  p_provider_request_id text
) returns jsonb
language plpgsql security definer set search_path='public'
set lock_timeout='2s' set statement_timeout='15s' as $$
declare
  v_admission public.portal_text_preview_admissions%rowtype;
  v_claim public.portal_text_preview_turn_claims%rowtype;
  v_now timestamptz;
begin
  if p_admission_id is null
    or p_claim_id is null
    or p_attempt_id is null
    or p_expected_generation is null
    or p_expected_generation not between 0 and 10000000
    or p_command_fingerprint is null
    or p_command_fingerprint !~ '^[0-9a-f]{64}$'
    or p_provider_request_id is null
    or char_length(p_provider_request_id) not between 1 and 128
    or octet_length(p_provider_request_id)<>char_length(p_provider_request_id)
    or p_provider_request_id !~ '^[!-~]{1,128}$' then
    return jsonb_build_object('outcome','conflict');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('portal-text-turn:'||p_admission_id::text,0));
  select * into v_admission
  from public.portal_text_preview_admissions
  where id=p_admission_id
  for update;
  if not found then return jsonb_build_object('outcome','conflict'); end if;
  select * into v_claim
  from public.portal_text_preview_turn_claims
  where tenant_id=v_admission.tenant_id
    and admission_id=v_admission.id
    and id=p_claim_id
  for update;
  if not found
    or v_claim.attempt_id<>p_attempt_id
    or v_claim.generation<>p_expected_generation
    or v_claim.command_fingerprint<>p_command_fingerprint then
    return jsonb_build_object('outcome','conflict');
  end if;
  if v_claim.state='succeeded' then
    if v_claim.provider_request_id is distinct from p_provider_request_id then
      return jsonb_build_object('outcome','conflict');
    end if;
    return jsonb_build_object('outcome','succeeded','providerRequestId',v_claim.provider_request_id);
  end if;
  if v_claim.state='failed' then
    if v_claim.reason_code<>'provider_response_uncommitted'
      or v_claim.provider_request_id is distinct from p_provider_request_id then
      return jsonb_build_object('outcome','conflict');
    end if;
    return jsonb_build_object(
      'outcome','failed','reasonCode','provider_response_uncommitted',
      'providerRequestId',v_claim.provider_request_id
    );
  end if;
  if v_claim.state<>'acquired'
    or not exists(select 1 from public.portal_text_preview_egress_authorizations e
      where e.tenant_id=v_claim.tenant_id
        and e.admission_id=v_claim.admission_id
        and e.claim_id=v_claim.id
        and e.attempt_id=v_claim.attempt_id
        and e.generation=v_claim.generation
        and e.kind='generation') then
    return jsonb_build_object('outcome','conflict');
  end if;
  v_now:=clock_timestamp();
  if not app.portal_record_text_preview_failure(
      v_admission.id,v_claim.id,p_attempt_id,'provider_response_uncommitted',p_provider_request_id,v_now
    ) then
    return jsonb_build_object('outcome','conflict');
  end if;
  return jsonb_build_object(
    'outcome','failed','reasonCode','provider_response_uncommitted',
    'providerRequestId',p_provider_request_id
  );
end;
$$;

create or replace function public.portal_fail_text_preview_turn_service(
  p_admission_id app.uuid_v7,
  p_claim_id app.uuid_v7,
  p_attempt_id app.uuid_v7,
  p_expected_generation integer,
  p_command_fingerprint text,
  p_reason_code text,
  p_provider_request_id text
) returns jsonb
language plpgsql security definer set search_path='public'
set lock_timeout='2s' set statement_timeout='15s' as $$
declare
  v_admission public.portal_text_preview_admissions%rowtype;
  v_claim public.portal_text_preview_turn_claims%rowtype;
  v_now timestamptz;
begin
  if p_admission_id is null
    or p_claim_id is null
    or p_attempt_id is null
    or p_expected_generation is null
    or p_expected_generation not between 0 and 10000000
    or p_command_fingerprint is null
    or p_command_fingerprint !~ '^[0-9a-f]{64}$'
    or p_reason_code is null
    or p_reason_code not in (
      'generation_failed','generated_reply_invalid','state_issue_failed','provider_response_uncommitted'
    )
    or (p_reason_code='provider_response_uncommitted' and (
      p_provider_request_id is null
      or char_length(p_provider_request_id) not between 1 and 128
      or octet_length(p_provider_request_id)<>char_length(p_provider_request_id)
      or p_provider_request_id !~ '^[!-~]{1,128}$'
    ))
    or (p_reason_code<>'provider_response_uncommitted' and p_provider_request_id is not null) then
    return jsonb_build_object('outcome','conflict');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('portal-text-turn:'||p_admission_id::text,0));
  v_now:=clock_timestamp();
  select * into v_admission
  from public.portal_text_preview_admissions
  where id=p_admission_id
  for update;
  if not found then return jsonb_build_object('outcome','not_authorized'); end if;
  select * into v_claim
  from public.portal_text_preview_turn_claims
  where tenant_id=v_admission.tenant_id
    and admission_id=v_admission.id
    and id=p_claim_id
  for update;
  if not found then return jsonb_build_object('outcome','not_authorized'); end if;
  if v_claim.attempt_id<>p_attempt_id
    or v_claim.generation<>p_expected_generation
    or v_claim.command_fingerprint<>p_command_fingerprint then
    return jsonb_build_object('outcome','conflict');
  end if;
  if v_claim.state='failed'
    and v_claim.reason_code=p_reason_code
    and v_claim.provider_request_id is not distinct from p_provider_request_id then
    return jsonb_build_object('outcome','failed');
  end if;
  if v_claim.state<>'acquired' then return jsonb_build_object('outcome','conflict'); end if;
  if p_reason_code='provider_response_uncommitted'
    and not exists(select 1 from public.portal_text_preview_egress_authorizations e
      where e.tenant_id=v_claim.tenant_id
        and e.admission_id=v_claim.admission_id
        and e.claim_id=v_claim.id
        and e.attempt_id=v_claim.attempt_id
        and e.generation=v_claim.generation
        and e.kind='generation') then
    return jsonb_build_object('outcome','conflict');
  end if;
  if v_claim.lease_expires_at<=v_now then
    if not app.portal_record_text_preview_failure(
        v_admission.id,v_claim.id,p_attempt_id,
        case when p_reason_code='provider_response_uncommitted' then p_reason_code else 'worker_lost' end,
        case when p_reason_code='provider_response_uncommitted' then p_provider_request_id else null end,
        v_now
      ) then
      return jsonb_build_object('outcome','conflict');
    end if;
    if p_reason_code='provider_response_uncommitted' then
      return jsonb_build_object(
        'outcome','failed','reasonCode',p_reason_code,'providerRequestId',p_provider_request_id
      );
    end if;
    return jsonb_build_object('outcome','failed','reasonCode','worker_lost');
  end if;
  if not app.portal_record_text_preview_failure(
      v_admission.id,v_claim.id,p_attempt_id,p_reason_code,p_provider_request_id,v_now
    ) then
    return jsonb_build_object('outcome','conflict');
  end if;
  return jsonb_build_object('outcome','failed');
end;
$$;

create or replace function public.portal_cleanup_expired_text_preview_sessions_service(
  p_limit integer
) returns jsonb
language plpgsql security definer set search_path='public'
set lock_timeout='2s' set statement_timeout='15s' as $$
declare
  v_admission record;
  v_candidate record;
  v_claim record;
  v_session public.sessions%rowtype;
  v_causation_id app.uuid_v7;
  v_now timestamptz:=clock_timestamp();
  v_sessions_closed integer:=0;
  v_participants_closed integer:=0;
  v_claims_failed integer:=0;
  v_operator_required integer:=0;
  v_busy_skipped integer:=0;
  v_rows integer;
begin
  if p_limit is null or p_limit not between 1 and 1000 then
    raise exception 'text preview cleanup limit must be between 1 and 1000' using errcode='22023';
  end if;

  for v_candidate in
    select c.admission_id,c.id as claim_id
    from public.portal_text_preview_turn_claims c
    join public.portal_text_preview_admissions a
      on a.tenant_id=c.tenant_id and a.id=c.admission_id
    where c.state='acquired'
      and c.lease_expires_at<=v_now
      and a.expires_at>v_now
      and not exists(select 1 from public.portal_text_preview_egress_authorizations e
        where e.tenant_id=c.tenant_id and e.admission_id=c.admission_id
          and e.claim_id=c.id and e.attempt_id=c.attempt_id
          and e.generation=c.generation and e.kind='generation')
    order by c.lease_expires_at,c.id
    limit p_limit
  loop
    if not pg_try_advisory_xact_lock(hashtextextended(
        'portal-text-turn:'||v_candidate.admission_id::text,0
      )) then
      v_busy_skipped:=least(p_limit,v_busy_skipped+1);
      continue;
    end if;
    v_now:=clock_timestamp();
    if exists(select 1
        from public.portal_text_preview_turn_claims c
        join public.portal_text_preview_admissions a
          on a.tenant_id=c.tenant_id and a.id=c.admission_id
        where c.admission_id=v_candidate.admission_id
          and c.id=v_candidate.claim_id
          and c.state='acquired'
          and c.lease_expires_at<=v_now
          and a.expires_at>v_now
          and not exists(select 1 from public.portal_text_preview_egress_authorizations e
            where e.tenant_id=c.tenant_id and e.admission_id=c.admission_id
              and e.claim_id=c.id and e.attempt_id=c.attempt_id
              and e.generation=c.generation and e.kind='generation'))
      and app.portal_record_text_preview_failure(
        v_candidate.admission_id,v_candidate.claim_id,null,'worker_lost',null,v_now
      ) then
      v_claims_failed:=v_claims_failed+1;
    end if;
  end loop;

  select count(*) into v_operator_required
  from (
    select a.expires_at as sort_at,a.id as sort_id
    from public.portal_text_preview_admissions a
    left join public.sessions s
      on s.tenant_id=a.tenant_id and s.id=a.session_id
    where a.expires_at<=v_now
      and (
        s.id is null
        or s.status in ('completed','failed')
        or s.status not in ('ready','active')
        or s.active_presenter_id is distinct from a.digital_presenter_id
        or not exists(select 1 from public.session_participants p
          where p.tenant_id=a.tenant_id
            and p.session_id=a.session_id
            and p.id=a.digital_presenter_id
            and p.participant_type='digital_presenter'
            and p.left_at is null)
        or (select count(*) from public.session_participants p
          where p.tenant_id=a.tenant_id
            and p.session_id=a.session_id
            and p.participant_type='digital_presenter'
            and p.left_at is null)<>1
      )
      and (
        s.ended_at is null
        or s.active_presenter_id is not null
        or exists(select 1 from public.session_participants p
          where p.tenant_id=a.tenant_id and p.id=a.digital_presenter_id and p.left_at is null)
        or exists(select 1 from public.portal_text_preview_turn_claims c
          where c.tenant_id=a.tenant_id and c.admission_id=a.id and c.state='acquired')
      )
    union all
    select c.finished_at as sort_at,c.id as sort_id
    from public.portal_text_preview_turn_claims c
    where c.state='failed'
      and c.reason_code='provider_response_uncommitted'
    union all
    select e.authorized_at as sort_at,c.id as sort_id
    from public.portal_text_preview_turn_claims c
    join public.portal_text_preview_egress_authorizations e
      on e.tenant_id=c.tenant_id and e.admission_id=c.admission_id
      and e.claim_id=c.id and e.attempt_id=c.attempt_id
      and e.generation=c.generation and e.kind='generation'
    where c.state='acquired'
    order by sort_at,sort_id
    limit p_limit
  ) bounded_operator_rows;

  for v_candidate in
    select a.id
    from public.portal_text_preview_admissions a
    where a.expires_at<=v_now
      and exists(select 1 from public.sessions s
        where s.tenant_id=a.tenant_id
          and s.id=a.session_id
          and s.status in ('ready','active')
          and s.active_presenter_id=a.digital_presenter_id)
      and exists(select 1 from public.session_participants p
        where p.tenant_id=a.tenant_id
          and p.session_id=a.session_id
          and p.id=a.digital_presenter_id
          and p.participant_type='digital_presenter'
          and p.left_at is null)
      and (select count(*) from public.session_participants p
        where p.tenant_id=a.tenant_id
          and p.session_id=a.session_id
          and p.participant_type='digital_presenter'
          and p.left_at is null)=1
      and not exists(select 1
        from public.portal_text_preview_turn_claims c
        join public.portal_text_preview_egress_authorizations e
          on e.tenant_id=c.tenant_id and e.admission_id=c.admission_id
          and e.claim_id=c.id and e.attempt_id=c.attempt_id
          and e.generation=c.generation and e.kind='generation'
        where c.tenant_id=a.tenant_id and c.admission_id=a.id and c.state='acquired')
    order by a.expires_at,a.id
    limit p_limit
  loop
    if not pg_try_advisory_xact_lock(hashtextextended(
        'portal-text-turn:'||v_candidate.id::text,0
      )) then
      v_busy_skipped:=least(p_limit,v_busy_skipped+1);
      continue;
    end if;
    v_now:=clock_timestamp();
    select a.* into v_admission
    from public.portal_text_preview_admissions a
    where a.id=v_candidate.id and a.expires_at<=v_now
    for update;
    v_now:=clock_timestamp();
    if not found then continue; end if;
    if v_admission.expires_at>v_now then continue; end if;
    if exists(select 1
        from public.portal_text_preview_turn_claims c
        join public.portal_text_preview_egress_authorizations e
          on e.tenant_id=c.tenant_id and e.admission_id=c.admission_id
          and e.claim_id=c.id and e.attempt_id=c.attempt_id
          and e.generation=c.generation and e.kind='generation'
        where c.tenant_id=v_admission.tenant_id
          and c.admission_id=v_admission.id and c.state='acquired') then
      continue;
    end if;
    for v_claim in
      select c.id from public.portal_text_preview_turn_claims c
      where c.tenant_id=v_admission.tenant_id
        and c.admission_id=v_admission.id
        and c.state='acquired'
      order by c.generation,c.id
    loop
      if app.portal_record_text_preview_failure(
          v_admission.id,v_claim.id,null,'session_expired',null,v_now
        ) then
        v_claims_failed:=v_claims_failed+1;
      end if;
    end loop;
    select * into v_session from public.sessions
    where tenant_id=v_admission.tenant_id and id=v_admission.session_id
    for update;
    v_now:=greatest(clock_timestamp(),v_session.updated_at);
    if not found
      or v_admission.expires_at>v_now
      or v_session.status not in ('ready','active')
      or v_session.active_presenter_id is distinct from v_admission.digital_presenter_id then
      continue;
    end if;
    select event_id into v_causation_id from public.events_outbox
    where tenant_id=v_admission.tenant_id
      and aggregate_type='interaction_session'
      and aggregate_id=v_admission.session_id
      and aggregate_version=v_session.state_version;
    if not found then
      raise exception 'text preview cleanup causation event missing' using errcode='40001';
    end if;
    perform app.portal_enqueue_text_preview_event(
      v_admission.cleanup_outbox_id,v_admission.cleanup_event_id,
      v_admission.tenant_id,v_admission.session_id,'session.completed',
      v_session.state_version+1,v_admission.trace_id,v_admission.id,
      v_causation_id,jsonb_build_object(),v_now
    );
    update public.session_participants
    set left_at=coalesce(left_at,v_now)
    where tenant_id=v_admission.tenant_id and id=v_admission.digital_presenter_id and left_at is null;
    get diagnostics v_rows=row_count;
    v_participants_closed:=v_participants_closed+v_rows;
    update public.sessions
    set status=case when status='failed' then 'failed' else 'completed' end,
        active_presenter_id=null,
        state_version=v_session.state_version+1,
        ended_at=coalesce(ended_at,v_now),
        updated_at=v_now
    where tenant_id=v_admission.tenant_id and id=v_admission.session_id
      and state_version=v_session.state_version;
    get diagnostics v_rows=row_count;
    v_sessions_closed:=v_sessions_closed+v_rows;
  end loop;
  v_operator_required:=least(p_limit,v_operator_required+v_busy_skipped);
  return jsonb_build_object(
    'outcome','completed',
    'sessionsClosed',v_sessions_closed,
    'participantsClosed',v_participants_closed,
    'claimsFailed',v_claims_failed,
    'operatorRequired',v_operator_required,
    'busySkipped',v_busy_skipped
  );
end;
$$;

revoke all on function public.portal_provision_text_preview_privacy_policy_service(app.uuid_v7,app.uuid_v7,text,text,text,timestamptz,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.portal_admit_text_preview_service(app.uuid_v7,uuid,app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,text,text,text,text,app.uuid_v7,text,text,app.uuid_v7,text,text,app.uuid_v7,app.uuid_v7,app.uuid_v7,boolean,boolean,text,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7) from public,anon,authenticated,service_role;
revoke all on function public.portal_acquire_text_preview_turn_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,integer,app.uuid_v7,app.uuid_v7) from public,anon,authenticated,service_role;
revoke all on function public.portal_authorize_text_preview_egress_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,integer,text,app.uuid_v7) from public,anon,authenticated,service_role;
revoke all on function public.portal_complete_text_preview_turn_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,integer,text,text,text,text,text) from public,anon,authenticated,service_role;
revoke all on function public.portal_reconcile_text_preview_provider_response_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,integer,text,text) from public,anon,authenticated,service_role;
revoke all on function public.portal_fail_text_preview_turn_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,integer,text,text,text) from public,anon,authenticated,service_role;
revoke all on function public.portal_cleanup_expired_text_preview_sessions_service(integer) from public,anon,authenticated,service_role;
grant execute on function public.portal_provision_text_preview_privacy_policy_service(app.uuid_v7,app.uuid_v7,text,text,text,timestamptz,timestamptz) to service_role;
grant execute on function public.portal_admit_text_preview_service(app.uuid_v7,uuid,app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,text,text,text,text,app.uuid_v7,text,text,app.uuid_v7,text,text,app.uuid_v7,app.uuid_v7,app.uuid_v7,boolean,boolean,text,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7) to service_role;
grant execute on function public.portal_acquire_text_preview_turn_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,integer,app.uuid_v7,app.uuid_v7) to service_role;
grant execute on function public.portal_authorize_text_preview_egress_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,integer,text,app.uuid_v7) to service_role;
grant execute on function public.portal_complete_text_preview_turn_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,integer,text,text,text,text,text) to service_role;
grant execute on function public.portal_reconcile_text_preview_provider_response_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,integer,text,text) to service_role;
grant execute on function public.portal_fail_text_preview_turn_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,integer,text,text,text) to service_role;
grant execute on function public.portal_cleanup_expired_text_preview_sessions_service(integer) to service_role;

revoke all on function public.portal_upsert_conversation_transcript(app.uuid_v7,app.uuid_v7,text,text,jsonb,timestamptz) from public,anon,service_role;
grant execute on function public.portal_upsert_conversation_transcript(app.uuid_v7,app.uuid_v7,text,text,jsonb,timestamptz) to authenticated;

create or replace function public.portal_schema_capabilities_service()
returns jsonb language sql stable security definer set search_path='public' as $$
  select jsonb_build_object(
    'version',49,
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
    'portalTextPreviewAdmission',
      to_regclass('public.portal_text_preview_privacy_policies') is not null
      and to_regclass('public.portal_text_preview_admissions') is not null
      and to_regprocedure('public.portal_provision_text_preview_privacy_policy_service(app.uuid_v7,app.uuid_v7,text,text,text,timestamp with time zone,timestamp with time zone)') is not null
      and to_regprocedure('public.portal_admit_text_preview_service(app.uuid_v7,uuid,app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,text,text,text,text,app.uuid_v7,text,text,app.uuid_v7,text,text,app.uuid_v7,app.uuid_v7,app.uuid_v7,boolean,boolean,text,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7)') is not null,
    'portalTextPreviewTurnFence',
      to_regclass('public.portal_text_preview_turn_claims') is not null
      and to_regclass('public.portal_text_preview_turn_claims_generation_fence_uidx') is not null
      and exists(select 1 from pg_index i
        where i.indexrelid=to_regclass('public.portal_text_preview_turn_claims_generation_fence_uidx')
          and i.indisunique and i.indnkeyatts=3
          and position('onpublic.portal_text_preview_turn_claimsusingbtree(tenant_id,admission_id,generation)'
            in regexp_replace(lower(pg_get_indexdef(i.indexrelid)),'\s+','','g'))>0
          and regexp_replace(pg_get_expr(i.indpred,i.indrelid),'[\s()]','','g')=
            'state=ANYARRAY[''acquired''::text,''succeeded''::text]')
      and exists(select 1 from pg_constraint c
        where c.conrelid='public.portal_text_preview_transcript_writes'::regclass
          and c.conname='portal_text_preview_writes_claim_fkey'
          and regexp_replace(pg_get_constraintdef(c.oid),'\s+','','g')=
            'FOREIGNKEY(tenant_id,admission_id,claim_id,generation)REFERENCESportal_text_preview_turn_claims(tenant_id,admission_id,id,generation)ONDELETERESTRICT')
      and to_regprocedure('public.portal_acquire_text_preview_turn_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,integer,app.uuid_v7,app.uuid_v7)') is not null
      and to_regprocedure('public.portal_complete_text_preview_turn_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,integer,text,text,text,text,text)') is not null
      and to_regprocedure('public.portal_fail_text_preview_turn_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,integer,text,text,text)') is not null,
    'portalTextPreviewEgressAuthorization',
      to_regclass('public.portal_text_preview_egress_authorizations') is not null
      and to_regprocedure('public.portal_authorize_text_preview_egress_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,integer,text,app.uuid_v7)') is not null
      and exists(select 1 from pg_constraint c
        where c.conrelid='public.portal_text_preview_egress_authorizations'::regclass
          and c.conname='portal_text_preview_egress_claim_kind_key'
          and c.contype='u')
      and has_function_privilege('service_role','public.portal_authorize_text_preview_egress_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,integer,text,app.uuid_v7)','EXECUTE')
      and not has_function_privilege('anon','public.portal_authorize_text_preview_egress_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,integer,text,app.uuid_v7)','EXECUTE')
      and not has_function_privilege('authenticated','public.portal_authorize_text_preview_egress_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,integer,text,app.uuid_v7)','EXECUTE'),
    'portalTextPreviewProviderFailureReceipt',
      to_regprocedure('app.portal_record_text_preview_failure(app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,timestamp with time zone)') is not null
      and to_regprocedure('public.portal_fail_text_preview_turn_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,integer,text,text,text)') is not null
      and to_regprocedure('public.portal_reconcile_text_preview_provider_response_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,integer,text,text)') is not null,
    'portalTextTranscriptOptIn',
      to_regclass('public.portal_text_preview_transcript_writes') is not null
      and to_regprocedure('public.portal_complete_text_preview_turn_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,integer,text,text,text,text,text)') is not null
      and not exists(select 1 from pg_constraint c
        where c.conrelid in ('public.portal_text_preview_admissions'::regclass,'public.portal_text_preview_transcript_writes'::regclass)
          and c.confrelid='public.conversation_transcripts'::regclass),
    'portalTextPreviewCleanup',to_regprocedure('public.portal_cleanup_expired_text_preview_sessions_service(integer)') is not null,
    'portalTextPreviewCanonicalOutbox',
      exists(select 1 from pg_constraint c
        where c.conrelid='public.events_outbox'::regclass
          and c.conname='events_outbox_event_document_canonical_check'
          and c.contype='c'
          and c.convalidated
          and md5(regexp_replace(lower(pg_get_constraintdef(c.oid)),'\s+','','g'))=
            'd9b3dba3ee3f690c55df3d1001446d9b')
      and to_regprocedure('app.portal_enqueue_text_preview_event(app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,text,bigint,text,app.uuid_v7,app.uuid_v7,jsonb,timestamp with time zone)') is not null
      and to_regprocedure('app.portal_record_text_preview_failure(app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,timestamp with time zone)') is not null
      and to_regprocedure('app.portal_record_text_preview_success(app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,text,timestamp with time zone)') is not null
      and position('insertintopublic.events_outbox' in regexp_replace(lower(pg_get_functiondef(
        'app.portal_enqueue_text_preview_event(app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,text,bigint,text,app.uuid_v7,app.uuid_v7,jsonb,timestamp with time zone)'::regprocedure
      )),'\s+','','g'))>0
      and position('insertintopublic.session_timeline' in regexp_replace(lower(pg_get_functiondef(
        'app.portal_enqueue_text_preview_event(app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,text,bigint,text,app.uuid_v7,app.uuid_v7,jsonb,timestamp with time zone)'::regprocedure
      )),'\s+','','g'))=0
      and not has_function_privilege('service_role','app.portal_enqueue_text_preview_event(app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,text,bigint,text,app.uuid_v7,app.uuid_v7,jsonb,timestamp with time zone)','EXECUTE')
      and not has_function_privilege('anon','app.portal_enqueue_text_preview_event(app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,text,bigint,text,app.uuid_v7,app.uuid_v7,jsonb,timestamp with time zone)','EXECUTE')
      and not has_function_privilege('authenticated','app.portal_enqueue_text_preview_event(app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,text,bigint,text,app.uuid_v7,app.uuid_v7,jsonb,timestamp with time zone)','EXECUTE'),
    'portalTextPreviewSecurityBoundary',
      not exists(select 1
        from (values
          ('public.portal_text_preview_privacy_policies'::regclass),
          ('public.portal_text_preview_admissions'::regclass),
          ('public.portal_text_preview_turn_claims'::regclass),
          ('public.portal_text_preview_egress_authorizations'::regclass),
          ('public.portal_text_preview_transcript_writes'::regclass)
        ) as expected(table_oid)
        join pg_class c on c.oid=expected.table_oid
        where not c.relrowsecurity or not c.relforcerowsecurity)
      and not exists(select 1
        from (values
          ('public.portal_text_preview_privacy_policies'::regclass),
          ('public.portal_text_preview_admissions'::regclass),
          ('public.portal_text_preview_turn_claims'::regclass),
          ('public.portal_text_preview_egress_authorizations'::regclass),
          ('public.portal_text_preview_transcript_writes'::regclass)
        ) as expected(table_oid)
        join pg_class c on c.oid=expected.table_oid
        cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl
        left join pg_roles grantee on grantee.oid=acl.grantee
        where (acl.grantee=0 or grantee.rolname in ('anon','authenticated','service_role'))
          and acl.privilege_type in ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'))
      and has_function_privilege('service_role','public.portal_provision_text_preview_privacy_policy_service(app.uuid_v7,app.uuid_v7,text,text,text,timestamp with time zone,timestamp with time zone)','EXECUTE')
      and has_function_privilege('service_role','public.portal_admit_text_preview_service(app.uuid_v7,uuid,app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,text,text,text,text,app.uuid_v7,text,text,app.uuid_v7,text,text,app.uuid_v7,app.uuid_v7,app.uuid_v7,boolean,boolean,text,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7)','EXECUTE')
      and has_function_privilege('service_role','public.portal_acquire_text_preview_turn_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,integer,app.uuid_v7,app.uuid_v7)','EXECUTE')
      and has_function_privilege('service_role','public.portal_authorize_text_preview_egress_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,integer,text,app.uuid_v7)','EXECUTE')
      and has_function_privilege('service_role','public.portal_complete_text_preview_turn_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,integer,text,text,text,text,text)','EXECUTE')
      and has_function_privilege('service_role','public.portal_reconcile_text_preview_provider_response_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,integer,text,text)','EXECUTE')
      and has_function_privilege('service_role','public.portal_fail_text_preview_turn_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,integer,text,text,text)','EXECUTE')
      and has_function_privilege('service_role','public.portal_cleanup_expired_text_preview_sessions_service(integer)','EXECUTE')
      and not has_function_privilege('anon','public.portal_provision_text_preview_privacy_policy_service(app.uuid_v7,app.uuid_v7,text,text,text,timestamp with time zone,timestamp with time zone)','EXECUTE')
      and not has_function_privilege('authenticated','public.portal_provision_text_preview_privacy_policy_service(app.uuid_v7,app.uuid_v7,text,text,text,timestamp with time zone,timestamp with time zone)','EXECUTE')
      and not has_function_privilege('anon','public.portal_admit_text_preview_service(app.uuid_v7,uuid,app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,text,text,text,text,app.uuid_v7,text,text,app.uuid_v7,text,text,app.uuid_v7,app.uuid_v7,app.uuid_v7,boolean,boolean,text,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7)','EXECUTE')
      and not has_function_privilege('authenticated','public.portal_admit_text_preview_service(app.uuid_v7,uuid,app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,text,text,text,text,app.uuid_v7,text,text,app.uuid_v7,text,text,app.uuid_v7,app.uuid_v7,app.uuid_v7,boolean,boolean,text,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7)','EXECUTE')
      and not has_function_privilege('anon','public.portal_acquire_text_preview_turn_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,integer,app.uuid_v7,app.uuid_v7)','EXECUTE')
      and not has_function_privilege('authenticated','public.portal_acquire_text_preview_turn_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,integer,app.uuid_v7,app.uuid_v7)','EXECUTE')
      and not has_function_privilege('anon','public.portal_authorize_text_preview_egress_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,integer,text,app.uuid_v7)','EXECUTE')
      and not has_function_privilege('authenticated','public.portal_authorize_text_preview_egress_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,integer,text,app.uuid_v7)','EXECUTE')
      and not has_function_privilege('anon','public.portal_complete_text_preview_turn_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,integer,text,text,text,text,text)','EXECUTE')
      and not has_function_privilege('authenticated','public.portal_complete_text_preview_turn_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,integer,text,text,text,text,text)','EXECUTE')
      and not has_function_privilege('anon','public.portal_reconcile_text_preview_provider_response_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,integer,text,text)','EXECUTE')
      and not has_function_privilege('authenticated','public.portal_reconcile_text_preview_provider_response_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,integer,text,text)','EXECUTE')
      and not has_function_privilege('anon','public.portal_fail_text_preview_turn_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,integer,text,text,text)','EXECUTE')
      and not has_function_privilege('authenticated','public.portal_fail_text_preview_turn_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,integer,text,text,text)','EXECUTE')
      and not has_function_privilege('anon','public.portal_cleanup_expired_text_preview_sessions_service(integer)','EXECUTE')
      and not has_function_privilege('authenticated','public.portal_cleanup_expired_text_preview_sessions_service(integer)','EXECUTE'),
    'legacyAuthenticatedChatTranscriptWriterAvailable',not has_function_privilege('anon','public.portal_upsert_conversation_transcript(app.uuid_v7,app.uuid_v7,text,text,jsonb,timestamp with time zone)','EXECUTE') and has_function_privilege('authenticated','public.portal_upsert_conversation_transcript(app.uuid_v7,app.uuid_v7,text,text,jsonb,timestamp with time zone)','EXECUTE') and not has_function_privilege('service_role','public.portal_upsert_conversation_transcript(app.uuid_v7,app.uuid_v7,text,text,jsonb,timestamp with time zone)','EXECUTE')
  )
$$;
revoke all on function public.portal_schema_capabilities_service() from public,anon,authenticated;
grant execute on function public.portal_schema_capabilities_service() to service_role;

COMMIT;
