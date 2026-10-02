begin;
-- IMP-05 / ADR-049: exact turn content projection within existing M6-04 authority.
-- No new canonical ledgers/outbox or capability promotion. Historical SQL stays immutable.
-- Reject preexisting shape drift before enrolling a projector, not merely after enrollment.
do $known_turn_shape$
declare actual jsonb;
begin
  select jsonb_object_agg(a.attname,jsonb_build_array(format_type(a.atttypid,a.atttypmod),a.attnotnull))
  into actual from pg_attribute a where a.attrelid='public.conversation_turns'::regclass
    and a.attnum>0 and not a.attisdropped;
  if actual is distinct from '{"tenant_id":["app.uuid_v7",true],"id":["app.uuid_v7",true],"session_id":["app.uuid_v7",true],"participant_id":["app.uuid_v7",true],"turn_index":["integer",true],"role":["text",true],"transcript_text":["text",false],"transcript_ciphertext":["bytea",false],"language":["text",true],"started_at":["timestamp with time zone",true],"ended_at":["timestamp with time zone",false],"interrupted":["boolean",true],"created_at":["timestamp with time zone",true]}'::jsonb then
    raise exception 'known conversation turn shape required' using errcode='55000';
  end if;
end;
$known_turn_shape$;
alter table public.data_governance_resource_catalog drop constraint data_governance_resource_catalog_shape_chk;
update public.data_governance_resource_catalog set subject_redaction_strategy='typed_redact',
  projection_version='conversation-turn-redaction@1',verification_method='typed_content_free_scan',
  relation_shape_fingerprint=app.data_governance_relation_shape_fingerprint('public.conversation_turns'::regclass)
where resource_code='db_conversation_turns' and relation_name='public.conversation_turns';
alter table public.data_governance_resource_catalog add constraint data_governance_resource_catalog_shape_chk check (
  (resource_code in ('db_conversation_transcripts','db_conversation_turns') and relation_shape_fingerprint is not null and relation_shape_fingerprint ~ '^[0-9a-f]{64}$')
  or (resource_code not in ('db_conversation_transcripts','db_conversation_turns') and relation_shape_fingerprint is null));


create or replace function app.data_governance_catalog_complete()
returns boolean language sql stable security definer set search_path='' as $$
  with tenant_relations as (
    select 'public.'||c.table_name relation_name
    from information_schema.columns c
    where c.table_schema='public' and c.column_name='tenant_id'
    union all select 'public.tenants'
  ), catalog_relations as (
    select relation_name from public.data_governance_resource_catalog where surface='database'
  )
  select
    (select count(*) from public.data_governance_resource_catalog where catalog_generation='pre_v59')=92
    and (select count(*) from public.data_governance_resource_catalog where catalog_generation='external')=7
    and app.data_governance_cycle_break_complete()
    and not exists(
      (select relation_name from tenant_relations)
      except
      (select relation_name from catalog_relations)
    )
    and not exists(
      (select relation_name from catalog_relations)
      except
      (select relation_name from tenant_relations)
    )
    and not exists(
      select 1 from public.data_governance_resource_catalog c
      where c.surface='database' and to_regclass(c.relation_name) is null
    )
    and not exists(
      select 1 from public.data_governance_resource_catalog c
      where c.surface='database' and c.catalog_generation='pre_v59'
        and c.relation_name<>'public.tenants'
        and not exists(
          select 1 from pg_trigger t
          where t.tgrelid=to_regclass(c.relation_name)
            and t.tgname='data_governance_write_fence' and not t.tgisinternal
            and t.tgfoid=to_regprocedure('app.enforce_data_governance_write_fence()')
            and t.tgenabled in ('O','A') and t.tgtype=31
        )
    )
    and exists(select 1 from pg_trigger t
      where t.tgrelid='public.conversation_turns'::regclass
        and t.tgname='conversation_turns_append_only' and not t.tgisinternal
        and t.tgfoid=to_regprocedure('app.prevent_mutation_or_governed_disposition()')
        and t.tgenabled in ('O','A') and t.tgtype=27)
    and (select count(*) from public.data_governance_resource_catalog c
      where (c.resource_code,c.relation_name,c.projection_version) in (
        ('db_conversation_transcripts','public.conversation_transcripts','conversation-transcript-redaction@1'),
        ('db_conversation_turns','public.conversation_turns','conversation-turn-redaction@1'))
        and c.subject_redaction_strategy='typed_redact'
        and c.locator_strategy='uuid_id'
        and c.relation_shape_fingerprint=app.data_governance_relation_shape_fingerprint(to_regclass(c.relation_name)))=2
    and not exists(
      select 1
      from pg_constraint fk
      join public.data_governance_resource_catalog child
        on fk.conrelid=to_regclass(child.relation_name)
       and child.catalog_generation='pre_v59'
      join public.data_governance_resource_catalog parent
        on fk.confrelid=to_regclass(parent.relation_name)
       and parent.catalog_generation='pre_v59'
      where fk.contype='f' and child.relation_name<>parent.relation_name
        and not (
          fk.conname='sessions_active_presenter_fk'
          and fk.conrelid='public.sessions'::regclass
          and fk.confrelid='public.session_participants'::regclass
        )
        and child.deletion_order>=parent.deletion_order
    )
$$;

create or replace function app.prevent_mutation_or_governed_disposition()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_row jsonb; v_allowed boolean;
begin
  v_row:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
  if tg_relid='public.conversation_turns'::regclass and tg_op='UPDATE' then
    -- Replay may clear already-NULL fields, but cannot restore content or alter
    -- ANY other column, including identity, chronology, language and role.
    if new.transcript_text is not null or new.transcript_ciphertext is not null
       or (to_jsonb(old)-'transcript_text'-'transcript_ciphertext')
          is distinct from (to_jsonb(new)-'transcript_text'-'transcript_ciphertext') then
      raise exception 'conversation turn projection is not exact' using errcode='55000';
    end if;
    select exists(select 1 from public.data_governance_work_items i
      join public.data_governance_requests r on r.tenant_id=i.tenant_id and r.id=i.request_id
      join public.tenants t on t.id=i.tenant_id
      join public.data_governance_resource_catalog c on c.resource_code=i.resource_code
      where i.tenant_id=old.tenant_id and i.database_row_id=old.id
        and c.resource_code='db_conversation_turns' and c.relation_name='public.conversation_turns'
        and c.locator_strategy='uuid_id' and c.subject_redaction_strategy='typed_redact'
        and c.projection_version='conversation-turn-redaction@1'
        and c.relation_shape_fingerprint=app.data_governance_relation_shape_fingerprint(tg_relid)
        and r.inventory_fingerprint=app.data_governance_catalog_fingerprint()
        and i.action='redact' and i.state='applying' and i.current_operation='apply'
        and i.lease_owner is not null and i.lease_token is not null
        and i.lease_expires_at>clock_timestamp() and i.fencing_token>0
        and r.scope='data_subject' and r.subject_id=i.subject_id
        and r.requested_action='redact' and r.state='executing_redaction'
        and r.write_epoch=t.data_write_epoch and t.data_governance_state='open'
        and not app.data_governance_has_active_hold(i.tenant_id,i.resource_code,i.subject_id,
          coalesce(i.resource_locator_hmac,i.verification_locator_hmac))) into v_allowed;
    if not coalesce(v_allowed,false) then
      raise exception 'verified turn redaction authority required' using errcode='55000';
    end if;
    return new;
  end if;
  if app.data_governance_disposition_allowed(tg_relid,v_row,tg_op) then
    return case when tg_op='DELETE' then old else new end;
  end if;
  raise exception 'table % is append-only',tg_table_name using errcode='55000';
end;
$$;

create trigger conversation_turns_append_only before update or delete on public.conversation_turns
for each row execute function app.prevent_mutation_or_governed_disposition();

create or replace function public.portal_apply_data_governance_database_item_service(
  p_tenant_id app.uuid_v7,
  p_request_id app.uuid_v7,
  p_item_id app.uuid_v7,
  p_lease_token app.uuid_v7,
  p_fencing_token bigint
) returns jsonb language plpgsql security definer set search_path=''
set lock_timeout='2s' set statement_timeout='30s' as $$
declare
  v_tenant_id app.uuid_v7;
  v_request public.data_governance_requests;
  v_item public.data_governance_work_items;
  v_catalog public.data_governance_resource_catalog;
  v_rows bigint;
  v_outcome text;
  v_target_state text;
  v_absent boolean;
  v_verification_digest text;
begin
  select r.tenant_id into v_tenant_id
  from public.data_governance_requests r
  where r.tenant_id=p_tenant_id and r.id=p_request_id;
  if not found then raise exception 'request is not executing' using errcode='55000'; end if;
  perform pg_advisory_xact_lock(app.data_governance_tenant_lock_key(v_tenant_id));
  select * into v_request from public.data_governance_requests
  where tenant_id=v_tenant_id and id=p_request_id for update;
  if v_request.state not in (
    'executing_redaction','executing_irreversible_deletion','retry_wait','verifying'
  ) then
    raise exception 'request is not executing' using errcode='55000';
  end if;
  -- Tenant closure requires the global catalog fence. A data-subject request
  -- keeps the tenant open and relies on the exact subject/artifact item fence.
  if v_request.scope='tenant' then
    perform 1 from public.tenants
    where id=v_request.tenant_id and data_governance_state='fenced' and data_write_epoch=v_request.write_epoch
    for key share;
  else
    perform 1 from public.tenants
    where id=v_request.tenant_id and data_governance_state='open' and data_write_epoch=v_request.write_epoch
    for key share;
  end if;
  if not found then raise exception 'data governance write fence is stale' using errcode='55000'; end if;
  select * into v_item from public.data_governance_work_items
  where tenant_id=v_request.tenant_id and id=p_item_id and request_id=v_request.id for update;
  if not found or v_item.state<>'leased' or v_item.lease_token is distinct from p_lease_token
     or v_item.fencing_token is distinct from p_fencing_token or v_item.current_operation not in ('apply','verify')
     or v_item.lease_expires_at<=clock_timestamp() then
    raise exception 'valid work item lease required' using errcode='55000';
  end if;
  select * into v_catalog from public.data_governance_resource_catalog where resource_code=v_item.resource_code;
  if not found or v_catalog.surface<>'database' then raise exception 'database item required' using errcode='22023'; end if;
  if v_item.action='redact' and (v_request.inventory_fingerprint<>app.data_governance_catalog_fingerprint()
      or not app.data_governance_catalog_complete()
      or v_catalog.subject_redaction_strategy<>'typed_redact') then
    raise exception 'typed redaction catalog drift' using errcode='55000';
  end if;
  if app.data_governance_has_active_hold(v_item.tenant_id,v_item.resource_code,v_item.subject_id,coalesce(v_item.resource_locator_hmac,v_item.verification_locator_hmac)) then
    update public.data_governance_work_items
    set state='held',outcome_code='legal_hold',current_operation=null,lease_owner=null,
        lease_token=null,lease_expires_at=null,operation_identity=null,
        dispatch_fenced_at=null,verification_challenge_hmac=null,resume_operation=null,
        next_attempt_at=null,updated_at=now()
    where tenant_id=v_item.tenant_id and id=v_item.id;
    update public.data_governance_requests set state='blocked_by_legal_hold',updated_at=now()
    where tenant_id=v_request.tenant_id and id=v_request.id;
    return jsonb_build_object(
      'tenantId',v_item.tenant_id,'workItemId',v_item.id,
      'state','held','outcomeCode','legal_hold'
    );
  end if;
  if v_catalog.relation_name='public.tenants' then
    if v_item.current_operation<>'apply' or v_item.action<>'irreversible_delete' then
      raise exception 'tenant root only accepts irreversible apply' using errcode='42501';
    end if;
    update public.data_governance_work_items
    set state='verification_pending',outcome_code='applied',current_operation=null,
        lease_owner=null,lease_token=null,lease_expires_at=null,operation_identity=null,
        dispatch_fenced_at=null,verification_challenge_hmac=null,resume_operation=null,
        next_attempt_at=null,updated_at=now()
    where tenant_id=v_item.tenant_id and id=v_item.id;
    insert into public.data_governance_attempt_receipts(
      tenant_id,id,request_id,work_item_id,attempt_number,operation,fencing_token,outcome_code,result_fingerprint
    ) values(v_item.tenant_id,app.data_governance_new_uuid_v7(),v_request.id,v_item.id,v_item.attempt_count,'apply',v_item.fencing_token,'applied',app.sha256_tuple(v_request.id::text,v_item.id::text,'apply',v_item.fencing_token::text,'tenant_tombstone_pending'));
    return jsonb_build_object(
      'tenantId',v_item.tenant_id,'workItemId',v_item.id,
      'state','verification_pending','outcomeCode','applied'
    );
  end if;
  if v_catalog.locator_strategy not in ('uuid_id','tenant_relation')
     or v_item.database_row_id is null
     or (v_catalog.locator_strategy='tenant_relation' and (v_request.scope<>'tenant' or v_item.database_row_id<>v_item.tenant_id)) then
    update public.data_governance_work_items
    set state='operator_required',outcome_code='permanent_failure',current_operation=null,lease_owner=null,lease_token=null,lease_expires_at=null,updated_at=now()
    where tenant_id=v_item.tenant_id and id=v_item.id;
    insert into public.data_governance_attempt_receipts(
      tenant_id,id,request_id,work_item_id,attempt_number,operation,fencing_token,outcome_code,result_fingerprint
    ) values(v_item.tenant_id,app.data_governance_new_uuid_v7(),v_request.id,v_item.id,v_item.attempt_count,'apply',v_item.fencing_token,'permanent_failure',app.sha256_tuple(v_request.id::text,v_item.id::text,'apply',v_item.fencing_token::text,'typed_locator_required'));
    update public.data_governance_requests set state='operator_required',updated_at=now()
    where tenant_id=v_request.tenant_id and id=v_request.id;
    return jsonb_build_object(
      'tenantId',v_item.tenant_id,'workItemId',v_item.id,
      'state','operator_required','outcomeCode','permanent_failure'
    );
  end if;

  if v_item.current_operation='verify' then
    if v_item.action='redact' then
      if v_catalog.relation_name='public.conversation_transcripts'
         and v_catalog.locator_strategy='uuid_id' then
        execute format(
          'select not exists(select 1 from %s where tenant_id=$1 and id=$2 and (turns<>''[]''::jsonb or external_ref<>$3))',
          v_catalog.relation_name
        ) into v_absent using v_item.tenant_id,v_item.database_row_id,'redacted-'||replace(v_item.id::text,'-','');
      elsif v_catalog.relation_name='public.conversation_turns'
         and v_catalog.projection_version='conversation-turn-redaction@1'
         and v_catalog.locator_strategy='uuid_id' then
        select exists(select 1 from public.conversation_turns
          where tenant_id=v_item.tenant_id and id=v_item.database_row_id
            and transcript_text is null and transcript_ciphertext is null) into v_absent;
      else
        raise exception 'typed redaction verifier is not registered for resource' using errcode='0A000';
      end if;
      v_target_state:='verified';
      v_outcome:='verified_content_free';
    else
      if v_catalog.locator_strategy='uuid_id' then
        execute format('select not exists(select 1 from %s where tenant_id=$1 and id=$2)',v_catalog.relation_name)
          into v_absent using v_item.tenant_id,v_item.database_row_id;
      else
        execute format('select not exists(select 1 from %s where tenant_id=$1)',v_catalog.relation_name)
          into v_absent using v_item.tenant_id;
      end if;
      v_target_state:=case when v_item.action='retain_content_free' then 'retained_exception' else 'verified' end;
      v_outcome:=case when v_item.action='retain_content_free' then 'verified_content_free' else 'verified_absent' end;
    end if;
    if not coalesce(v_absent,false) then
      raise exception 'independent database verification failed' using errcode='55000';
    end if;
    v_verification_digest:=app.sha256_tuple(
      v_request.id::text,v_item.id::text,'verify',v_item.fencing_token::text,
      v_catalog.verification_method,v_outcome
    );
    update public.data_governance_work_items
    set state=v_target_state,outcome_code=v_outcome,resource_locator_hmac=null,
        verification_locator_hmac=resource_locator_hmac,
        verification_database_row_id=database_row_id,
        database_row_id=null,current_operation=null,lease_owner=null,lease_token=null,
        lease_expires_at=null,operation_identity=null,dispatch_fenced_at=null,
        verification_challenge_hmac=null,verification_digest=v_verification_digest,
        next_attempt_at=null,updated_at=now()
    where tenant_id=v_item.tenant_id and id=v_item.id;
    insert into public.data_governance_attempt_receipts(
      tenant_id,id,request_id,work_item_id,attempt_number,operation,fencing_token,
      outcome_code,result_fingerprint
    ) values(
      v_item.tenant_id,app.data_governance_new_uuid_v7(),v_request.id,v_item.id,v_item.attempt_count,
      'verify',v_item.fencing_token,v_outcome,v_verification_digest
    );
    update public.data_governance_requests set state='verifying',updated_at=now()
    where tenant_id=v_request.tenant_id and id=v_request.id;
    return jsonb_build_object(
      'tenantId',v_item.tenant_id,'workItemId',v_item.id,
      'state',v_target_state,'outcomeCode',v_outcome
    );
  end if;

  if v_item.action not in ('irreversible_delete','retain_content_free','redact')
     or (v_item.action='redact' and v_catalog.relation_name not in ('public.conversation_transcripts','public.conversation_turns')) then
    update public.data_governance_work_items
    set state='operator_required',outcome_code='permanent_failure',current_operation=null,
        lease_owner=null,lease_token=null,lease_expires_at=null,operation_identity=null,
        dispatch_fenced_at=null,verification_challenge_hmac=null,updated_at=now()
    where tenant_id=v_item.tenant_id and id=v_item.id;
    insert into public.data_governance_attempt_receipts(
      tenant_id,id,request_id,work_item_id,attempt_number,operation,fencing_token,outcome_code,result_fingerprint
    ) values(v_item.tenant_id,app.data_governance_new_uuid_v7(),v_request.id,v_item.id,v_item.attempt_count,'apply',v_item.fencing_token,'permanent_failure',app.sha256_tuple(v_request.id::text,v_item.id::text,'apply',v_item.fencing_token::text,'typed_action_required'));
    update public.data_governance_requests set state='operator_required',updated_at=now()
    where tenant_id=v_request.tenant_id and id=v_request.id;
    return jsonb_build_object(
      'tenantId',v_item.tenant_id,'workItemId',v_item.id,
      'state','operator_required','outcomeCode','permanent_failure'
    );
  end if;

  update public.data_governance_work_items set state='applying',updated_at=now()
  where tenant_id=v_item.tenant_id and id=v_item.id;
  begin
    if v_catalog.relation_name='public.session_participants'
       and v_item.action='irreversible_delete' then
      update public.sessions
      set active_presenter_id=null
      where tenant_id=v_item.tenant_id and active_presenter_id=v_item.database_row_id;
    end if;
    if v_item.action='redact' then
      if v_catalog.relation_name='public.conversation_transcripts'
         and v_catalog.locator_strategy='uuid_id' then
        execute format(
          'update %s set external_ref=$3,turns=''[]''::jsonb,ended_at=coalesce(ended_at,now()),updated_at=now() where tenant_id=$1 and id=$2',
          v_catalog.relation_name
        ) using v_item.tenant_id,v_item.database_row_id,'redacted-'||replace(v_item.id::text,'-','');
      elsif v_catalog.relation_name='public.conversation_turns'
         and v_catalog.projection_version='conversation-turn-redaction@1'
         and v_catalog.locator_strategy='uuid_id' then
        update public.conversation_turns set transcript_text=null,transcript_ciphertext=null
        where tenant_id=v_item.tenant_id and id=v_item.database_row_id;
      else
        raise exception 'typed redaction projector is not registered for resource' using errcode='0A000';
      end if;
    elsif v_catalog.locator_strategy='uuid_id' then
      execute format('delete from %s where tenant_id=$1 and id=$2',v_catalog.relation_name)
        using v_item.tenant_id,v_item.database_row_id;
    else
      execute format('delete from %s where tenant_id=$1',v_catalog.relation_name)
        using v_item.tenant_id;
    end if;
    get diagnostics v_rows=row_count;
    v_outcome:='applied';
    update public.data_governance_work_items
    set state='verification_pending',outcome_code=v_outcome,current_operation=null,
        lease_owner=null,lease_token=null,lease_expires_at=null,operation_identity=null,
        dispatch_fenced_at=null,verification_challenge_hmac=null,resume_operation=null,
        next_attempt_at=null,updated_at=now()
    where tenant_id=v_item.tenant_id and id=v_item.id;
    insert into public.data_governance_attempt_receipts(
      tenant_id,id,request_id,work_item_id,attempt_number,operation,fencing_token,outcome_code,result_fingerprint
    ) values(v_item.tenant_id,app.data_governance_new_uuid_v7(),v_request.id,v_item.id,v_item.attempt_count,'apply',v_item.fencing_token,v_outcome,
      app.sha256_tuple(v_request.id::text,v_item.id::text,'apply',v_item.fencing_token::text,v_outcome,v_rows::text,v_item.action));
  exception when foreign_key_violation or lock_not_available then
    update public.data_governance_work_items
    set state=case when attempt_count>=max_attempts then 'operator_required' else 'retry_wait' end,
        outcome_code=case when attempt_count>=max_attempts then 'permanent_failure' else 'retryable_failure' end,
        next_attempt_at=case when attempt_count>=max_attempts then null else now()+make_interval(secs=>least(300,attempt_count*attempt_count*5)) end,
        resume_operation=case when attempt_count>=max_attempts then null else 'apply' end,
        current_operation=null,lease_owner=null,lease_token=null,lease_expires_at=null,
        operation_identity=null,dispatch_fenced_at=null,verification_challenge_hmac=null,updated_at=now()
    where tenant_id=v_item.tenant_id and id=v_item.id;
    insert into public.data_governance_attempt_receipts(
      tenant_id,id,request_id,work_item_id,attempt_number,operation,fencing_token,outcome_code,result_fingerprint
    ) values(v_item.tenant_id,app.data_governance_new_uuid_v7(),v_request.id,v_item.id,v_item.attempt_count,'apply',v_item.fencing_token,'retryable_failure',
      app.sha256_tuple(v_request.id::text,v_item.id::text,'apply',v_item.fencing_token::text,'retryable_database_conflict'));
    update public.data_governance_requests set state='retry_wait',updated_at=now()
    where tenant_id=v_request.tenant_id and id=v_request.id;
    return jsonb_build_object(
      'tenantId',v_item.tenant_id,'workItemId',v_item.id,
      'state',case when v_item.attempt_count>=v_item.max_attempts then 'operator_required' else 'retry_wait' end,
      'outcomeCode',case when v_item.attempt_count>=v_item.max_attempts then 'permanent_failure' else 'retryable_failure' end
    );
  end;
  update public.data_governance_requests set state='verifying',updated_at=now()
  where tenant_id=v_request.tenant_id and id=v_request.id;
  return jsonb_build_object(
    'tenantId',v_item.tenant_id,'workItemId',v_item.id,
    'state','verification_pending','outcomeCode',v_outcome
  );
end;
$$;

create or replace function app.data_governance_database_absent(
  p_tenant_id app.uuid_v7,
  p_request_id app.uuid_v7
) returns boolean language plpgsql stable security definer set search_path='' as $$
declare v_request public.data_governance_requests; r record; v_count bigint; v_exists boolean; v_projected boolean;
begin
  select * into v_request from public.data_governance_requests
  where tenant_id=p_tenant_id and id=p_request_id;
  if not found then return false; end if;
  if v_request.scope='tenant' then
    for r in
      select relation_name
      from public.data_governance_resource_catalog
      where catalog_generation='pre_v59' and surface='database'
        and relation_name<>'public.tenants' and retained_exception=false
    loop
      execute format('select count(*) from %s where tenant_id=$1',r.relation_name) into v_count using p_tenant_id;
      if v_count<>0 then return false; end if;
    end loop;
    return true;
  end if;
  for r in
    select l.resource_code,l.database_row_id,c.relation_name,i.action,i.id work_item_id
    from public.data_governance_subject_artifact_links l
    join public.data_governance_resource_catalog c on c.resource_code=l.resource_code
    join public.data_governance_work_items i
      on i.tenant_id=l.tenant_id and i.request_id=p_request_id
      and i.resource_code=l.resource_code
      and i.verification_locator_hmac=l.resource_locator_hmac
    where l.tenant_id=p_tenant_id and l.subject_id=v_request.subject_id and c.locator_strategy='uuid_id'
  loop
    if r.action='redact' and r.relation_name='public.conversation_transcripts' then
      execute format(
        'select not exists(select 1 from %s where tenant_id=$1 and id=$2 and (turns<>''[]''::jsonb or external_ref<>$3))',
        r.relation_name
      ) into v_projected using p_tenant_id,r.database_row_id,'redacted-'||replace(r.work_item_id::text,'-','');
      if not coalesce(v_projected,false) then return false; end if;
    elsif r.action='redact' and r.relation_name='public.conversation_turns' then
      if not app.data_governance_catalog_complete() then return false; end if;
      select exists(select 1 from public.conversation_turns
        where tenant_id=p_tenant_id and id=r.database_row_id
          and transcript_text is null and transcript_ciphertext is null) into v_projected;
      if not coalesce(v_projected,false) then return false; end if;
    else
      execute format('select exists(select 1 from %s where tenant_id=$1 and id=$2)',r.relation_name)
        into v_exists using p_tenant_id,r.database_row_id;
      if v_exists then return false; end if;
    end if;
  end loop;
  return not exists(
    select 1
    from (
      select resource_code,count(*) link_count
      from public.data_governance_subject_artifact_links
      where tenant_id=p_tenant_id and subject_id=v_request.subject_id
      group by resource_code
    ) l
    left join (
      select resource_code,count(*) item_count
      from public.data_governance_work_items
      where tenant_id=p_tenant_id and request_id=p_request_id and state in ('verified','retained_exception')
      group by resource_code
    ) i using(resource_code)
    where l.link_count<>coalesce(i.item_count,0)
  );
end;
$$;
revoke all on function app.prevent_mutation_or_governed_disposition(),
  app.data_governance_catalog_complete(),
  app.data_governance_database_absent(app.uuid_v7,app.uuid_v7) from public,anon,authenticated,service_role;
revoke all on function public.portal_apply_data_governance_database_item_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,bigint) from public,anon,authenticated,service_role;
grant execute on function public.portal_apply_data_governance_database_item_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,bigint) to service_role;
commit;
