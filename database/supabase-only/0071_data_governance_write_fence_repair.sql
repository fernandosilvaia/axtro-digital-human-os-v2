begin;

-- M6-04, ADR-046: preserve historical migrations and canonical readiness.
-- Compare relation OIDs, verify live trigger authority, and drain open effects.
create or replace function app.enforce_data_governance_write_fence()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_row jsonb; v_tenant app.uuid_v7; v_state text; v_row_id uuid; v_resource_code text;
begin
  if tg_op='UPDATE'
     and (to_jsonb(old)->>'tenant_id') is distinct from (to_jsonb(new)->>'tenant_id') then
    raise exception 'tenant relocation is forbidden by data governance' using errcode='42501';
  end if;
  if tg_op='UPDATE' and to_jsonb(old)?'id'
     and (to_jsonb(old)->>'id') is distinct from (to_jsonb(new)->>'id') then
    raise exception 'artifact identity relocation is forbidden by data governance' using errcode='42501';
  end if;
  v_row:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_tenant:=(v_row->>'tenant_id')::app.uuid_v7;
  select data_governance_state into v_state from public.tenants where id=v_tenant for share;
  if v_state is null then raise exception 'tenant authority missing' using errcode='42501'; end if;
  if v_state='open' then
    begin v_row_id:=coalesce(v_row->>'id',v_row->>'tenant_id')::uuid; exception when others then v_row_id:=null; end;
    select resource_code into v_resource_code from public.data_governance_resource_catalog
    where surface='database' and to_regclass(relation_name)=tg_relid;
    if v_row_id is not null and exists(
      select 1 from public.data_governance_work_items i
      join public.data_governance_requests r on r.tenant_id=i.tenant_id and r.id=i.request_id
      where i.tenant_id=v_tenant and i.resource_code=v_resource_code
        and coalesce(i.database_row_id,i.verification_database_row_id)=v_row_id
        and r.scope='data_subject' and r.state in (
          'authorized','inventorying','ready','blocked_by_legal_hold','executing_redaction',
          'executing_irreversible_deletion','retry_wait','effect_unknown','verifying','operator_required'
        )
        and not app.data_governance_disposition_allowed(tg_relid,v_row,tg_op)
    ) then raise exception 'artifact writes fenced by data-subject governance' using errcode='55000'; end if;
    return case when tg_op='DELETE' then old else new end;
  end if;
  if tg_op<>'INSERT' and app.data_governance_disposition_allowed(tg_relid,v_row,tg_op) then
    return case when tg_op='DELETE' then old else new end;
  end if;
  raise exception 'tenant writes fenced by data governance' using errcode='55000';
end;
$$;

do $install_v71_fences$
declare r record;
begin
  for r in select relation_name from public.data_governance_resource_catalog
    where surface='database' and catalog_generation='pre_v59'
      and relation_name<>'public.tenants'
      and not exists(select 1 from pg_trigger t
        where t.tgrelid=to_regclass(relation_name)
          and t.tgname='data_governance_write_fence' and not t.tgisinternal)
  loop
    execute format('create trigger data_governance_write_fence before insert or update or delete on %s for each row execute function app.enforce_data_governance_write_fence()',to_regclass(r.relation_name));
  end loop;
end
$install_v71_fences$;

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
    and exists(
      select 1 from public.data_governance_resource_catalog c
      where c.resource_code='db_conversation_transcripts'
        and c.projection_version='conversation-transcript-redaction@1'
        and c.relation_shape_fingerprint=app.data_governance_relation_shape_fingerprint(
          'public.conversation_transcripts'::regclass
        )
    )
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

create or replace function public.portal_lease_data_governance_work_items_service(
  p_tenant_id app.uuid_v7,
  p_request_id app.uuid_v7,
  p_worker_id app.uuid_v7,
  p_lease_token app.uuid_v7,
  p_limit integer,
  p_lease_seconds integer
) returns jsonb language plpgsql security definer set search_path=''
set lock_timeout='2s' set statement_timeout='15s' as $$
declare v_tenant_id app.uuid_v7; v_request public.data_governance_requests; v_result jsonb; v_tenant public.tenants; v_epoch bigint;
begin
  if p_limit is null or p_limit not between 1 and 50 or p_lease_seconds is null or p_lease_seconds not between 5 and 300 then
    raise exception 'bounded lease parameters required' using errcode='22023';
  end if;
  select r.tenant_id into v_tenant_id
  from public.data_governance_requests r
  where r.tenant_id=p_tenant_id and r.id=p_request_id;
  if not found then raise exception 'request is not executable' using errcode='55000'; end if;
  perform pg_advisory_xact_lock(app.data_governance_tenant_lock_key(v_tenant_id));
  select * into v_request from public.data_governance_requests
  where tenant_id=v_tenant_id and id=p_request_id for update;
  if v_request.state not in (
    'ready','blocked_by_legal_hold','executing_redaction','executing_irreversible_deletion','retry_wait','effect_unknown','verifying'
  ) then raise exception 'request is not executable' using errcode='55000'; end if;
  if v_request.authorization_expires_at is null
     or (
       v_request.irreversible_started_at is null
       and (v_request.authorization_expires_at<=now() or v_request.expires_at<=now())
     ) then
    raise exception 'governance authorization expired before execution' using errcode='42501';
  end if;
  if not exists(
    select 1 from public.data_governance_policy_decisions d
    where d.tenant_id=v_request.tenant_id and d.request_id=v_request.id
      and d.decision='allow' and d.policy_fingerprint=v_request.policy_fingerprint
      and d.command_fingerprint=v_request.command_fingerprint
      and d.authorization_expires_at=v_request.authorization_expires_at
      and (v_request.irreversible_started_at is not null or d.authorization_expires_at>now())
  ) then
    raise exception 'live policy-bound execution authority required' using errcode='42501';
  end if;
  if v_request.scope='tenant' then
    select * into v_tenant from public.tenants where id=v_request.tenant_id for update;
    if v_tenant.data_governance_state='open' then
      if not app.data_governance_inventory_complete(v_request.tenant_id,v_request.id) then
        raise exception 'complete inventory required before tenant fence' using errcode='55000';
      end if;
      if (
        select count(distinct a.actor_id)
        from public.data_governance_approvals a
        join public.user_tenant_memberships m
          on m.user_id=a.actor_user_id and m.tenant_id=a.tenant_id and m.actor_id=a.actor_id and m.role='tenant_admin'
        where a.tenant_id=v_request.tenant_id and a.request_id=v_request.id and a.decision='approve'
          and a.command_fingerprint=v_request.command_fingerprint
          and a.id=any(v_request.authorized_approval_ids)
      )<>2 or cardinality(v_request.authorized_approval_ids)<>2 then
        raise exception 'two exact current tenant_admin approvals required at closing fence' using errcode='42501';
      end if;
      if exists(
        select 1 from public.provider_effect_reservations p
        where tenant_id=v_request.tenant_id and (
          state not in ('released','completed')
          or (state='completed' and completed_at is null)
          or (failure_code='cleanup_unknown' and not exists(
            select 1 from public.provider_effect_termination_receipts t
            where t.tenant_id=p.tenant_id and t.reservation_id=p.id
              and t.state='provider_accepted' and t.settled_at is not null
              and t.provider_receipt_ref is not null
          ))
        )
      ) or exists(
        select 1 from public.portal_business_action_calendar_reservations
        where tenant_id=v_request.tenant_id and (
          state not in ('released','completed')
          or (state='completed' and completed_at is null)
        )
      ) or exists(
        select 1 from public.portal_business_action_checkout_reservations
        where tenant_id=v_request.tenant_id and state not in (
          'released','rejected','approval_expired','expired','payment_completed','payment_failed'
        )
      ) or exists(
        select 1 from public.ai_usage_reservations
        where tenant_id=v_request.tenant_id and state in ('reserved','provider_in_flight','unknown')
      ) or exists(
        select 1 from public.meeting_terminal_notification_outbox
        where tenant_id=v_request.tenant_id and status in ('pending','delivering','retry_wait','ambiguous')
      ) or exists(
        select 1 from public.billing_usage_outbox
        where tenant_id=v_request.tenant_id and status in ('pending','delivering','failed')
      ) or exists(
        select 1 from public.billing_checkout_intents
        where tenant_id=v_request.tenant_id and state in ('reserved','dispatched','bound','unknown','conflict')
      ) or exists(
        select 1 from public.workflow_runs
        where tenant_id=v_request.tenant_id and status in ('queued','running','waiting')
      ) then raise exception 'tenant has unsettled provider effects' using errcode='55000'; end if;
      v_epoch:=v_tenant.data_write_epoch+1;
      update public.tenants set data_governance_state='fenced',data_write_epoch=v_epoch,status='closing',updated_at=now()
      where id=v_request.tenant_id;
      update public.data_governance_requests set write_epoch=v_epoch,updated_at=now()
      where tenant_id=v_request.tenant_id and id=v_request.id;
      v_request.write_epoch:=v_epoch;
    elsif v_tenant.data_governance_state<>'fenced' or v_tenant.data_write_epoch<>v_request.write_epoch then
      raise exception 'tenant fence is stale' using errcode='55000';
    end if;
  else
    if cardinality(v_request.authorized_approval_ids)<>1 or (
      select count(*)
      from public.data_governance_approvals a
      join public.user_tenant_memberships m
        on m.user_id=a.actor_user_id and m.tenant_id=a.tenant_id
        and m.actor_id=a.actor_id and m.role='tenant_admin'
      where a.tenant_id=v_request.tenant_id and a.request_id=v_request.id
        and a.decision='approve' and a.command_fingerprint=v_request.command_fingerprint
        and a.id=any(v_request.authorized_approval_ids)
    )<>1 then
      raise exception 'current subject disposition approval required at execution fence' using errcode='42501';
    end if;
    select * into v_tenant from public.tenants where id=v_request.tenant_id for share;
    if v_tenant.data_governance_state<>'open' or v_tenant.data_write_epoch<>v_request.write_epoch then
      raise exception 'subject disposition generation is stale' using errcode='55000';
    end if;
  end if;
  insert into public.data_governance_attempt_receipts(
    tenant_id,id,request_id,work_item_id,attempt_number,operation,fencing_token,
    outcome_code,result_fingerprint
  )
  select
    i.tenant_id,app.data_governance_new_uuid_v7(),i.request_id,i.id,i.attempt_count,i.current_operation,
    i.fencing_token,
    case
      when i.attempt_count>=i.max_attempts then 'permanent_failure'
      when i.current_operation in ('apply','reconcile') and i.dispatch_fenced_at is not null then 'effect_unknown'
      else 'retryable_failure'
    end,
    app.sha256_tuple(
      i.request_id::text,i.id::text,i.current_operation,i.fencing_token::text,
      case
        when i.attempt_count>=i.max_attempts then 'lease_expired_budget_exhausted'
        when i.current_operation in ('apply','reconcile') and i.dispatch_fenced_at is not null then 'lease_expired_after_dispatch'
        else 'lease_expired_before_external_dispatch'
      end
    )
  from public.data_governance_work_items i
  where i.tenant_id=v_request.tenant_id and i.request_id=v_request.id
    and i.state in ('leased','applying') and i.lease_expires_at<=now()
  on conflict (tenant_id,work_item_id,attempt_number) do nothing;
  update public.data_governance_work_items
  set state=case
        when attempt_count>=max_attempts then 'operator_required'
        when current_operation='verify' then 'verification_pending'
        when current_operation in ('apply','reconcile') and dispatch_fenced_at is not null then 'effect_unknown'
        else 'retry_wait'
      end,
      outcome_code=case
        when attempt_count>=max_attempts then 'permanent_failure'
        when current_operation in ('apply','reconcile') and dispatch_fenced_at is not null then 'effect_unknown'
        else 'retryable_failure'
      end,
      resume_operation=case
        when attempt_count>=max_attempts then null
        when current_operation='verify' then null
        when current_operation in ('apply','reconcile') and dispatch_fenced_at is not null then null
        else current_operation
      end,
      current_operation=null,lease_owner=null,lease_token=null,lease_expires_at=null,
      operation_identity=null,dispatch_fenced_at=null,verification_challenge_hmac=null,
      next_attempt_at=case
        when attempt_count<max_attempts
         and current_operation<>'verify'
         and not (current_operation in ('apply','reconcile') and dispatch_fenced_at is not null)
        then now()
        else null
      end,
      updated_at=now()
  where tenant_id=v_request.tenant_id and request_id=v_request.id
    and state in ('leased','applying') and lease_expires_at<=now();
  if exists(
    select 1 from public.data_governance_work_items i
    where i.tenant_id=v_request.tenant_id and i.request_id=v_request.id and i.state='operator_required'
  ) then
    update public.data_governance_requests set state='operator_required',updated_at=now()
    where tenant_id=v_request.tenant_id and id=v_request.id;
    return '[]'::jsonb;
  elsif exists(
    select 1 from public.data_governance_work_items i
    where i.tenant_id=v_request.tenant_id and i.request_id=v_request.id and i.state='effect_unknown'
  ) then
    update public.data_governance_requests set state='effect_unknown',updated_at=now()
    where tenant_id=v_request.tenant_id and id=v_request.id;
  elsif exists(
    select 1 from public.data_governance_work_items i
    where i.tenant_id=v_request.tenant_id and i.request_id=v_request.id and i.state='retry_wait'
  ) then
    update public.data_governance_requests set state='retry_wait',updated_at=now()
    where tenant_id=v_request.tenant_id and id=v_request.id;
  end if;
  with candidates as (
    select i.tenant_id,i.id,c.surface
    from public.data_governance_work_items i
    join public.data_governance_resource_catalog c on c.resource_code=i.resource_code
    where i.tenant_id=v_request.tenant_id and i.request_id=v_request.id
      and (
        (i.state='retry_wait' and i.next_attempt_at<=now() and i.resume_operation is not null)
        or (i.state in ('pending','verification_pending','effect_unknown') and i.next_attempt_at is null)
      )
      and i.attempt_count<i.max_attempts
      and not (i.resource_code='db_tenants' and i.state='verification_pending')
      and not app.data_governance_has_active_hold(i.tenant_id,i.resource_code,i.subject_id,coalesce(i.resource_locator_hmac,i.verification_locator_hmac))
      and not (
        v_request.scope='tenant'
        and i.resource_code in ('db_user_tenant_memberships','db_tenants')
        and exists(
          select 1 from public.data_legal_holds h
          where h.tenant_id=i.tenant_id and h.state='active'
        )
      )
      and (
        c.surface<>'database'
        or not exists(
          select 1
          from public.data_governance_work_items external_item
          join public.data_governance_resource_catalog external_catalog
            on external_catalog.resource_code=external_item.resource_code
          where external_item.tenant_id=i.tenant_id
            and external_item.request_id=i.request_id
            and external_catalog.surface<>'database'
            and external_item.state not in ('verified','retained_exception')
        )
      )
      and (
        c.surface<>'database'
        or c.deletion_order=(
          select min(c2.deletion_order)
          from public.data_governance_work_items i2
          join public.data_governance_resource_catalog c2 on c2.resource_code=i2.resource_code
          where i2.tenant_id=i.tenant_id and i2.request_id=i.request_id
            and c2.surface='database'
            and i2.state not in ('verified','retained_exception')
        )
      )
    order by c.deletion_order,i.created_at,i.id
    for update of i skip locked limit p_limit
  ), leased as (
    update public.data_governance_work_items i
    set state='leased',attempt_count=i.attempt_count+1,lease_owner=p_worker_id,
        lease_token=p_lease_token,lease_expires_at=now()+make_interval(secs=>p_lease_seconds),
        fencing_token=i.fencing_token+1,
        current_operation=case i.state
          when 'effect_unknown' then 'reconcile'
          when 'verification_pending' then 'verify'
          when 'retry_wait' then i.resume_operation
          else 'apply'
        end,
        resume_operation=null,
        operation_identity=app.sha256_tuple(
          i.request_id::text,i.id::text,
          case i.state
            when 'effect_unknown' then 'reconcile'
            when 'verification_pending' then 'verify'
            when 'retry_wait' then i.resume_operation
            else 'apply'
          end
        ),
        dispatch_fenced_at=null,
        verification_challenge_hmac=case when c.surface='database' then null else app.data_governance_hmac(
          'external-attestation',i.tenant_id::text,coalesce(i.subject_id::text,''),i.resource_code,
          app.sha256_tuple(
            i.request_id::text,i.id::text,
            case i.state
              when 'effect_unknown' then 'reconcile'
              when 'verification_pending' then 'verify'
              when 'retry_wait' then i.resume_operation
              else 'apply'
            end,
            (i.fencing_token+1)::text,p_lease_token::text
          )
        ) end,
        next_attempt_at=null,
        updated_at=now()
    from candidates c where i.tenant_id=c.tenant_id and i.id=c.id
    returning i.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'tenantId',l.tenant_id,
    'workItemId',l.id,'requestId',l.request_id,'resourceCode',l.resource_code,
    'surface',c.surface,'resourceClass',c.resource_class,
    'scope',v_request.scope,'subjectId',l.subject_id,
    'resourceLocatorHmac',l.resource_locator_hmac,'action',l.action,'state',l.state,
    'resourceCount',l.resource_count,
    'operation',l.current_operation,
    'operationIdentity',l.operation_identity,
    'attestationChallengeHmac',l.verification_challenge_hmac,
    'attemptCount',l.attempt_count,'maxAttempts',l.max_attempts,'leaseToken',l.lease_token,
    'leaseExpiresAt',l.lease_expires_at,'fencingToken',l.fencing_token
  ) order by l.created_at,l.id),'[]'::jsonb) into v_result
  from leased l
  join public.data_governance_resource_catalog c on c.resource_code=l.resource_code;
  if jsonb_array_length(v_result)>0 then
    update public.data_governance_requests
    set state=case when requested_action='redact' then 'executing_redaction' else 'executing_irreversible_deletion' end,
        irreversible_started_at=coalesce(irreversible_started_at,now()),
        updated_at=now()
    where tenant_id=v_request.tenant_id and id=v_request.id;
  end if;
  return v_result;
end;
$$;

revoke all on function app.enforce_data_governance_write_fence() from public,anon,authenticated,service_role;
revoke all on function app.data_governance_catalog_complete() from public,anon,authenticated,service_role;
revoke all on function public.portal_lease_data_governance_work_items_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,integer,integer) from public,anon,authenticated;
grant execute on function public.portal_lease_data_governance_work_items_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,integer,integer) to service_role;

alter function public.portal_schema_capabilities_service() set schema app;
alter function app.portal_schema_capabilities_service() rename to portal_schema_capabilities_v70;
revoke all on function app.portal_schema_capabilities_v70() from public,anon,authenticated,service_role;
create or replace function public.portal_schema_capabilities_service()
returns jsonb language sql stable security definer set search_path='' as $$
  select (app.portal_schema_capabilities_v70()-'version')||jsonb_build_object(
    'version',71,'dataGovernanceWriteFenceRepaired',app.data_governance_catalog_complete()
  )
$$;
revoke all on function public.portal_schema_capabilities_service() from public,anon,authenticated;
grant execute on function public.portal_schema_capabilities_service() to service_role;

commit;
