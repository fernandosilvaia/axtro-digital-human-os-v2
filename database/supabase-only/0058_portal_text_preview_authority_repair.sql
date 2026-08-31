-- M6-02: forward-only authority repair for the Portal text preview.
-- The historical 0049 artifact remains immutable. This migration removes its
-- caller-supplied user authority, caps the preview at ten exchanges, and adds
-- tenant-composite transcript references while preserving transcript deletion.
begin;

-- Never rewrite or delete historical generation evidence to make the narrower
-- cap fit. An operator must reconcile any unexpected row before this migration
-- can apply, and the surrounding transaction guarantees zero partial DDL.
do $generation_preflight$
begin
  if exists(
      select 1 from public.portal_text_preview_turn_claims where generation not between 0 and 9
      union all
      select 1 from public.portal_text_preview_egress_authorizations where generation not between 0 and 9
      union all
      select 1 from public.portal_text_preview_transcript_writes where generation not between 0 and 9
    ) then
    raise exception 'portal text preview historical generation outside 0..9 requires operator reconciliation'
      using errcode='23514';
  end if;
end
$generation_preflight$;

-- The historical admission implementation remains an owner-only primitive.
-- The only externally callable admission boundary below derives identity from
-- the authenticated JWT and accepts neither tenant_id nor user_id.
revoke all on function public.portal_admit_text_preview_service(
  app.uuid_v7,uuid,app.uuid_v7,app.uuid_v7,app.uuid_v7,
  text,text,text,text,text,text,app.uuid_v7,text,text,app.uuid_v7,text,text,
  app.uuid_v7,app.uuid_v7,app.uuid_v7,boolean,boolean,text,app.uuid_v7,
  app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,
  app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7
) from public,anon,authenticated,service_role;

create or replace function public.portal_admit_text_preview_authenticated(
  p_admission_id app.uuid_v7,
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
declare v_user_id uuid;
begin
  v_user_id:=auth.uid();
  if v_user_id is null then
    raise exception 'authentication required' using errcode='28000';
  end if;
  if p_persistent_transcript is true then
    raise exception 'persistent text preview admission remains closed until M6-04'
      using errcode='0A000';
  end if;
  return public.portal_admit_text_preview_service(
    p_admission_id,v_user_id,p_agent_id,p_session_id,p_presenter_id,
    p_client_session_ref_hash,p_profile_id,p_profile_version,p_profile_fingerprint,
    p_provider_configuration_fingerprint,p_command_fingerprint,
    p_identity_disclosure_id,p_identity_disclosure_version,p_identity_disclosure_hash,
    p_data_use_disclosure_id,p_data_use_disclosure_version,p_data_use_disclosure_hash,
    p_essential_consent_id,p_transcript_consent_id,p_transcript_id,
    p_persistent_transcript,p_expect_existing,p_trace_id,p_correlation_id,
    p_session_created_event_id,p_session_created_outbox_id,
    p_session_prepared_event_id,p_session_prepared_outbox_id,
    p_disclosure_event_id,p_disclosure_outbox_id,p_consent_event_id,p_consent_outbox_id,
    p_activated_event_id,p_activated_outbox_id,p_cleanup_event_id,p_cleanup_outbox_id
  );
end;
$$;
revoke all on function public.portal_admit_text_preview_authenticated(
  app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,
  text,text,text,text,text,text,app.uuid_v7,text,text,app.uuid_v7,text,text,
  app.uuid_v7,app.uuid_v7,app.uuid_v7,boolean,boolean,text,app.uuid_v7,
  app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,
  app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7
) from public,anon,authenticated,service_role;

-- Preserve the audited v49 implementations as private owner-only functions.
-- Public wrappers retain the exact RPC signatures and reject generation 10
-- before any claim, usage reservation, egress, transcript or outbox mutation.
alter function public.portal_acquire_text_preview_turn_service(
  app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,integer,app.uuid_v7,app.uuid_v7
) set schema app;
alter function app.portal_acquire_text_preview_turn_service(
  app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,integer,app.uuid_v7,app.uuid_v7
) rename to portal_acquire_text_preview_turn_v49;
revoke all on function app.portal_acquire_text_preview_turn_v49(
  app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,integer,app.uuid_v7,app.uuid_v7
) from public,anon,authenticated,service_role;

create function public.portal_acquire_text_preview_turn_service(
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
begin
  if p_expected_generation is null or p_expected_generation not between 0 and 9 then
    return jsonb_build_object('outcome','conflict');
  end if;
  return app.portal_acquire_text_preview_turn_v49(
    p_claim_id,p_attempt_id,p_admission_id,p_command_ref_hash,p_command_fingerprint,
    p_expected_generation,p_outcome_event_id,p_outcome_outbox_id
  );
end;
$$;

alter function public.portal_authorize_text_preview_egress_service(
  app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,integer,text,app.uuid_v7
) set schema app;
alter function app.portal_authorize_text_preview_egress_service(
  app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,integer,text,app.uuid_v7
) rename to portal_authorize_text_preview_egress_v49;
revoke all on function app.portal_authorize_text_preview_egress_v49(
  app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,integer,text,app.uuid_v7
) from public,anon,authenticated,service_role;

create function public.portal_authorize_text_preview_egress_service(
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
begin
  if p_expected_generation is null or p_expected_generation not between 0 and 9 then
    return jsonb_build_object('outcome','conflict');
  end if;
  return app.portal_authorize_text_preview_egress_v49(
    p_egress_id,p_admission_id,p_claim_id,p_attempt_id,p_expected_generation,
    p_kind,p_ai_usage_reservation_id
  );
end;
$$;

alter function public.portal_complete_text_preview_turn_service(
  app.uuid_v7,app.uuid_v7,app.uuid_v7,integer,text,text,text,text,text
) set schema app;
alter function app.portal_complete_text_preview_turn_service(
  app.uuid_v7,app.uuid_v7,app.uuid_v7,integer,text,text,text,text,text
) rename to portal_complete_text_preview_turn_v49;
revoke all on function app.portal_complete_text_preview_turn_v49(
  app.uuid_v7,app.uuid_v7,app.uuid_v7,integer,text,text,text,text,text
) from public,anon,authenticated,service_role;

create function public.portal_complete_text_preview_turn_service(
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
begin
  if p_expected_generation is null or p_expected_generation not between 0 and 9 then
    return jsonb_build_object('outcome','conflict');
  end if;
  return app.portal_complete_text_preview_turn_v49(
    p_admission_id,p_claim_id,p_attempt_id,p_expected_generation,p_command_fingerprint,
    p_completion_fingerprint,p_provider_request_id,p_user_turn,p_assistant_turn
  );
end;
$$;

alter function public.portal_reconcile_text_preview_provider_response_service(
  app.uuid_v7,app.uuid_v7,app.uuid_v7,integer,text,text
) set schema app;
alter function app.portal_reconcile_text_preview_provider_response_service(
  app.uuid_v7,app.uuid_v7,app.uuid_v7,integer,text,text
) rename to portal_reconcile_text_preview_provider_response_v49;
revoke all on function app.portal_reconcile_text_preview_provider_response_v49(
  app.uuid_v7,app.uuid_v7,app.uuid_v7,integer,text,text
) from public,anon,authenticated,service_role;

create function public.portal_reconcile_text_preview_provider_response_service(
  p_admission_id app.uuid_v7,
  p_claim_id app.uuid_v7,
  p_attempt_id app.uuid_v7,
  p_expected_generation integer,
  p_command_fingerprint text,
  p_provider_request_id text
) returns jsonb
language plpgsql security definer set search_path='public'
set lock_timeout='2s' set statement_timeout='15s' as $$
begin
  if p_expected_generation is null or p_expected_generation not between 0 and 9 then
    return jsonb_build_object('outcome','conflict');
  end if;
  return app.portal_reconcile_text_preview_provider_response_v49(
    p_admission_id,p_claim_id,p_attempt_id,p_expected_generation,
    p_command_fingerprint,p_provider_request_id
  );
end;
$$;

alter function public.portal_fail_text_preview_turn_service(
  app.uuid_v7,app.uuid_v7,app.uuid_v7,integer,text,text,text
) set schema app;
alter function app.portal_fail_text_preview_turn_service(
  app.uuid_v7,app.uuid_v7,app.uuid_v7,integer,text,text,text
) rename to portal_fail_text_preview_turn_v49;
revoke all on function app.portal_fail_text_preview_turn_v49(
  app.uuid_v7,app.uuid_v7,app.uuid_v7,integer,text,text,text
) from public,anon,authenticated,service_role;

create function public.portal_fail_text_preview_turn_service(
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
begin
  if p_expected_generation is null or p_expected_generation not between 0 and 9 then
    return jsonb_build_object('outcome','conflict');
  end if;
  return app.portal_fail_text_preview_turn_v49(
    p_admission_id,p_claim_id,p_attempt_id,p_expected_generation,
    p_command_fingerprint,p_reason_code,p_provider_request_id
  );
end;
$$;

revoke all on function public.portal_acquire_text_preview_turn_service(
  app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,integer,app.uuid_v7,app.uuid_v7
) from public,anon,authenticated,service_role;
revoke all on function public.portal_authorize_text_preview_egress_service(
  app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,integer,text,app.uuid_v7
) from public,anon,authenticated,service_role;
revoke all on function public.portal_complete_text_preview_turn_service(
  app.uuid_v7,app.uuid_v7,app.uuid_v7,integer,text,text,text,text,text
) from public,anon,authenticated,service_role;
revoke all on function public.portal_reconcile_text_preview_provider_response_service(
  app.uuid_v7,app.uuid_v7,app.uuid_v7,integer,text,text
) from public,anon,authenticated,service_role;
revoke all on function public.portal_fail_text_preview_turn_service(
  app.uuid_v7,app.uuid_v7,app.uuid_v7,integer,text,text,text
) from public,anon,authenticated,service_role;
grant execute on function public.portal_acquire_text_preview_turn_service(
  app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,integer,app.uuid_v7,app.uuid_v7
) to service_role;
grant execute on function public.portal_authorize_text_preview_egress_service(
  app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,integer,text,app.uuid_v7
) to service_role;
grant execute on function public.portal_complete_text_preview_turn_service(
  app.uuid_v7,app.uuid_v7,app.uuid_v7,integer,text,text,text,text,text
) to service_role;
grant execute on function public.portal_reconcile_text_preview_provider_response_service(
  app.uuid_v7,app.uuid_v7,app.uuid_v7,integer,text,text
) to service_role;
grant execute on function public.portal_fail_text_preview_turn_service(
  app.uuid_v7,app.uuid_v7,app.uuid_v7,integer,text,text,text
) to service_role;

alter table public.portal_text_preview_turn_claims
  drop constraint portal_text_preview_turn_claims_generation_chk,
  add constraint portal_text_preview_turn_claims_generation_chk
    check (generation between 0 and 9) not valid;
alter table public.portal_text_preview_egress_authorizations
  drop constraint portal_text_preview_egress_generation_chk,
  add constraint portal_text_preview_egress_generation_chk
    check (generation between 0 and 9) not valid;
alter table public.portal_text_preview_transcript_writes
  drop constraint portal_text_preview_transcript_writes_generation_chk,
  add constraint portal_text_preview_transcript_writes_generation_chk
    check (generation between 0 and 9) not valid;

alter table public.portal_text_preview_turn_claims
  validate constraint portal_text_preview_turn_claims_generation_chk;
alter table public.portal_text_preview_egress_authorizations
  validate constraint portal_text_preview_egress_generation_chk;
alter table public.portal_text_preview_transcript_writes
  validate constraint portal_text_preview_transcript_writes_generation_chk;

-- Composite references prevent a transcript from another tenant satisfying a
-- preview receipt. SET NULL removes the PII link while keeping append-only,
-- content-free evidence when the documented deletion and purge RPCs run.
alter table public.conversation_transcripts
  add constraint conversation_transcripts_tenant_id_id_key unique (tenant_id,id);

alter table public.portal_text_preview_admissions
  drop constraint portal_text_preview_admissions_persistence_chk,
  add constraint portal_text_preview_admissions_persistence_chk check (
    (persistence_selection='off'
      and profile_id='openrouter_portal_text_essential_v1'
      and profile_fingerprint='sha256:5f07f0bb93393c7fcd4412516db48f30fb3095fb31e9352cd2cf849b260a5173'
      and transcript_consent_id is null
      and transcript_id is null)
    or
    (persistence_selection='opt_in'
      and profile_id='openrouter_portal_text_persisted_v1'
      and profile_fingerprint='sha256:5062dd979ac79778052389f27069a16dfa8f33fb175d38181774415b1ff585b8'
      and transcript_consent_id is not null)
  );

alter table public.portal_text_preview_transcript_writes
  alter column transcript_id drop not null;

create or replace function app.prevent_text_preview_reference_mutation()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='UPDATE'
    and old.transcript_id is not null
    and new.transcript_id is null
    and (to_jsonb(new)-'transcript_id')=(to_jsonb(old)-'transcript_id')
    and not exists(
      select 1 from public.conversation_transcripts
      where tenant_id=old.tenant_id and id=old.transcript_id
    ) then
    return new;
  end if;
  raise exception '% is append-only',tg_table_name using errcode='55000';
end;
$$;
revoke all on function app.prevent_text_preview_reference_mutation()
  from public,anon,authenticated,service_role;

drop trigger portal_text_preview_admissions_append_only
  on public.portal_text_preview_admissions;
create trigger portal_text_preview_admissions_append_only
before update or delete on public.portal_text_preview_admissions
for each row execute function app.prevent_text_preview_reference_mutation();

drop trigger portal_text_preview_transcript_writes_append_only
  on public.portal_text_preview_transcript_writes;
create trigger portal_text_preview_transcript_writes_append_only
before update or delete on public.portal_text_preview_transcript_writes
for each row execute function app.prevent_text_preview_reference_mutation();

-- v57 allowed a transcript to be deleted while its content-free admission and
-- write receipt retained the old identifier. Normalize only those proven
-- orphans through the narrow trigger before validating the new references.
update public.portal_text_preview_admissions a
set transcript_id=null
where a.transcript_id is not null
  and not exists(
    select 1 from public.conversation_transcripts t
    where t.tenant_id=a.tenant_id and t.id=a.transcript_id
  );

update public.portal_text_preview_transcript_writes w
set transcript_id=null
where w.transcript_id is not null
  and not exists(
    select 1 from public.conversation_transcripts t
    where t.tenant_id=w.tenant_id and t.id=w.transcript_id
  );

alter table public.portal_text_preview_admissions
  add constraint portal_text_preview_admissions_transcript_fkey
    foreign key (tenant_id,transcript_id)
    references public.conversation_transcripts(tenant_id,id)
    on delete set null (transcript_id) not valid;

alter table public.portal_text_preview_transcript_writes
  add constraint portal_text_preview_writes_transcript_fkey
    foreign key (tenant_id,transcript_id)
    references public.conversation_transcripts(tenant_id,id)
    on delete set null (transcript_id) not valid;

alter table public.portal_text_preview_admissions
  validate constraint portal_text_preview_admissions_transcript_fkey;
alter table public.portal_text_preview_transcript_writes
  validate constraint portal_text_preview_writes_transcript_fkey;

create or replace function app.portal_external_roles_revoked(p_signature text)
returns boolean language sql stable set search_path='' as $$
  select case
    when to_regprocedure(p_signature) is null then false
    else not has_function_privilege('anon',p_signature,'EXECUTE')
      and not has_function_privilege('authenticated',p_signature,'EXECUTE')
      and not has_function_privilege('service_role',p_signature,'EXECUTE')
      and not exists(
        select 1
        from pg_proc p
        cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
        where p.oid=to_regprocedure(p_signature)
          and acl.grantee=0
          and acl.privilege_type='EXECUTE'
      )
  end
$$;
revoke all on function app.portal_external_roles_revoked(text)
  from public,anon,authenticated,service_role;

-- Extend the v57 capability union without copying or reinterpreting it.
alter function public.portal_schema_capabilities_service() set schema app;
alter function app.portal_schema_capabilities_service()
  rename to portal_schema_capabilities_v57;
revoke all on function app.portal_schema_capabilities_v57()
  from public,anon,authenticated,service_role;

create or replace function public.portal_schema_capabilities_service()
returns jsonb language sql stable security definer set search_path='' as $$
  select (app.portal_schema_capabilities_v57()
      -'version'
      -'portalTextPreviewAdmission'
      -'portalTextPreviewSecurityBoundary'
      -'portalTextTranscriptOptIn')
    || jsonb_build_object(
      'version',58,
      'portalTextPreviewAdmission',
        to_regprocedure('public.portal_admit_text_preview_authenticated(app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,text,text,text,text,app.uuid_v7,text,text,app.uuid_v7,text,text,app.uuid_v7,app.uuid_v7,app.uuid_v7,boolean,boolean,text,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7)') is not null
        and app.portal_external_roles_revoked('public.portal_admit_text_preview_authenticated(app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,text,text,text,text,app.uuid_v7,text,text,app.uuid_v7,text,text,app.uuid_v7,app.uuid_v7,app.uuid_v7,boolean,boolean,text,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7)')
        and app.portal_external_roles_revoked('public.portal_admit_text_preview_service(app.uuid_v7,uuid,app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,text,text,text,text,app.uuid_v7,text,text,app.uuid_v7,text,text,app.uuid_v7,app.uuid_v7,app.uuid_v7,boolean,boolean,text,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7)')
        and position('v_user_id:=auth.uid()' in regexp_replace(lower(pg_get_functiondef(
          'public.portal_admit_text_preview_authenticated(app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,text,text,text,text,app.uuid_v7,text,text,app.uuid_v7,text,text,app.uuid_v7,app.uuid_v7,app.uuid_v7,boolean,boolean,text,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7)'::regprocedure
        )),'\s+','','g'))>0
        and position('ifp_persistent_transcriptistruethenraiseexception''persistenttextpreviewadmissionremainscloseduntilm6-04''' in regexp_replace(lower(pg_get_functiondef(
          'public.portal_admit_text_preview_authenticated(app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,text,text,text,text,app.uuid_v7,text,text,app.uuid_v7,text,text,app.uuid_v7,app.uuid_v7,app.uuid_v7,boolean,boolean,text,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7)'::regprocedure
        )),'\s+','','g'))>0
        and position('ifp_persistent_transcriptistrue' in regexp_replace(lower(pg_get_functiondef(
          'public.portal_admit_text_preview_authenticated(app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,text,text,text,text,app.uuid_v7,text,text,app.uuid_v7,text,text,app.uuid_v7,app.uuid_v7,app.uuid_v7,boolean,boolean,text,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7)'::regprocedure
        )),'\s+','','g'))
          < position('returnpublic.portal_admit_text_preview_service' in regexp_replace(lower(pg_get_functiondef(
          'public.portal_admit_text_preview_authenticated(app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,text,text,text,text,app.uuid_v7,text,text,app.uuid_v7,text,text,app.uuid_v7,app.uuid_v7,app.uuid_v7,boolean,boolean,text,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7)'::regprocedure
        )),'\s+','','g')),
      'portalTextPreviewAuthorityRepair',
        app.portal_external_roles_revoked('public.portal_admit_text_preview_service(app.uuid_v7,uuid,app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,text,text,text,text,app.uuid_v7,text,text,app.uuid_v7,text,text,app.uuid_v7,app.uuid_v7,app.uuid_v7,boolean,boolean,text,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7)')
        and position('notbetween0and9' in regexp_replace(lower(pg_get_functiondef(
          'public.portal_acquire_text_preview_turn_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,integer,app.uuid_v7,app.uuid_v7)'::regprocedure
        )),'[\s()]','','g'))>0
        and position('notbetween0and9' in regexp_replace(lower(pg_get_functiondef(
          'public.portal_authorize_text_preview_egress_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,integer,text,app.uuid_v7)'::regprocedure
        )),'[\s()]','','g'))>0
        and position('notbetween0and9' in regexp_replace(lower(pg_get_functiondef(
          'public.portal_complete_text_preview_turn_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,integer,text,text,text,text,text)'::regprocedure
        )),'[\s()]','','g'))>0
        and position('notbetween0and9' in regexp_replace(lower(pg_get_functiondef(
          'public.portal_reconcile_text_preview_provider_response_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,integer,text,text)'::regprocedure
        )),'[\s()]','','g'))>0
        and position('notbetween0and9' in regexp_replace(lower(pg_get_functiondef(
          'public.portal_fail_text_preview_turn_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,integer,text,text,text)'::regprocedure
        )),'[\s()]','','g'))>0
        and exists(select 1 from pg_constraint where conrelid='public.portal_text_preview_turn_claims'::regclass and conname='portal_text_preview_turn_claims_generation_chk' and convalidated and regexp_replace(lower(pg_get_constraintdef(oid)),'[\s()]','','g')='checkgeneration>=0andgeneration<=9')
        and exists(select 1 from pg_constraint where conrelid='public.portal_text_preview_egress_authorizations'::regclass and conname='portal_text_preview_egress_generation_chk' and convalidated and regexp_replace(lower(pg_get_constraintdef(oid)),'[\s()]','','g')='checkgeneration>=0andgeneration<=9')
        and exists(select 1 from pg_constraint where conrelid='public.portal_text_preview_transcript_writes'::regclass and conname='portal_text_preview_transcript_writes_generation_chk' and convalidated and regexp_replace(lower(pg_get_constraintdef(oid)),'[\s()]','','g')='checkgeneration>=0andgeneration<=9'),
      'portalTextTranscriptOptIn',
        exists(select 1 from pg_constraint c where c.conrelid='public.portal_text_preview_admissions'::regclass and c.conname='portal_text_preview_admissions_transcript_fkey' and c.contype='f' and c.convalidated and c.confrelid='public.conversation_transcripts'::regclass and c.confdeltype='n'
          and c.conkey=array[(select attnum from pg_attribute where attrelid=c.conrelid and attname='tenant_id'),(select attnum from pg_attribute where attrelid=c.conrelid and attname='transcript_id')]::smallint[]
          and c.confkey=array[(select attnum from pg_attribute where attrelid=c.confrelid and attname='tenant_id'),(select attnum from pg_attribute where attrelid=c.confrelid and attname='id')]::smallint[]
          and c.confdelsetcols=array[(select attnum from pg_attribute where attrelid=c.conrelid and attname='transcript_id')]::smallint[])
        and exists(select 1 from pg_constraint c where c.conrelid='public.portal_text_preview_transcript_writes'::regclass and c.conname='portal_text_preview_writes_transcript_fkey' and c.contype='f' and c.convalidated and c.confrelid='public.conversation_transcripts'::regclass and c.confdeltype='n'
          and c.conkey=array[(select attnum from pg_attribute where attrelid=c.conrelid and attname='tenant_id'),(select attnum from pg_attribute where attrelid=c.conrelid and attname='transcript_id')]::smallint[]
          and c.confkey=array[(select attnum from pg_attribute where attrelid=c.confrelid and attname='tenant_id'),(select attnum from pg_attribute where attrelid=c.confrelid and attname='id')]::smallint[]
          and c.confdelsetcols=array[(select attnum from pg_attribute where attrelid=c.conrelid and attname='transcript_id')]::smallint[])
        and exists(select 1 from pg_attribute where attrelid='public.portal_text_preview_transcript_writes'::regclass and attname='transcript_id' and not attnotnull and not attisdropped)
        and (select count(*) from pg_trigger t where t.tgrelid in ('public.portal_text_preview_admissions'::regclass,'public.portal_text_preview_transcript_writes'::regclass) and t.tgname in ('portal_text_preview_admissions_append_only','portal_text_preview_transcript_writes_append_only') and not t.tgisinternal and t.tgenabled in ('O','A') and t.tgtype=27 and t.tgfoid='app.prevent_text_preview_reference_mutation()'::regprocedure)=2
        and position('iftg_op=''update''andold.transcript_idisnotnullandnew.transcript_idisnull' in regexp_replace(lower(pg_get_functiondef('app.prevent_text_preview_reference_mutation()'::regprocedure)),'\s+','','g'))>0
        and position('(to_jsonb(new)-''transcript_id'')=(to_jsonb(old)-''transcript_id'')' in regexp_replace(lower(pg_get_functiondef('app.prevent_text_preview_reference_mutation()'::regprocedure)),'\s+','','g'))>0
        and position('notexists(select1frompublic.conversation_transcriptswheretenant_id=old.tenant_idandid=old.transcript_id)' in regexp_replace(lower(pg_get_functiondef('app.prevent_text_preview_reference_mutation()'::regprocedure)),'\s+','','g'))>0,
      'portalTextPreviewSecurityBoundary',
        app.portal_table_locked_down(to_regclass('public.portal_text_preview_privacy_policies'))
        and app.portal_table_locked_down(to_regclass('public.portal_text_preview_admissions'))
        and app.portal_table_locked_down(to_regclass('public.portal_text_preview_turn_claims'))
        and app.portal_table_locked_down(to_regclass('public.portal_text_preview_egress_authorizations'))
        and app.portal_table_locked_down(to_regclass('public.portal_text_preview_transcript_writes'))
        and app.portal_external_roles_revoked('public.portal_admit_text_preview_authenticated(app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,text,text,text,text,app.uuid_v7,text,text,app.uuid_v7,text,text,app.uuid_v7,app.uuid_v7,app.uuid_v7,boolean,boolean,text,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7)')
        and app.portal_external_roles_revoked('public.portal_admit_text_preview_service(app.uuid_v7,uuid,app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,text,text,text,text,app.uuid_v7,text,text,app.uuid_v7,text,text,app.uuid_v7,app.uuid_v7,app.uuid_v7,boolean,boolean,text,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7)')
        and app.portal_service_role_only('public.portal_acquire_text_preview_turn_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,integer,app.uuid_v7,app.uuid_v7)')
        and app.portal_service_role_only('public.portal_authorize_text_preview_egress_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,integer,text,app.uuid_v7)')
        and app.portal_service_role_only('public.portal_complete_text_preview_turn_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,integer,text,text,text,text,text)')
        and app.portal_service_role_only('public.portal_reconcile_text_preview_provider_response_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,integer,text,text)')
        and app.portal_service_role_only('public.portal_fail_text_preview_turn_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,integer,text,text,text)')
    )
$$;
revoke all on function public.portal_schema_capabilities_service()
  from public,anon,authenticated,service_role;
grant execute on function public.portal_schema_capabilities_service()
  to service_role;

commit;
