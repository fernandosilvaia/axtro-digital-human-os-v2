begin;

-- AUD-05 / ADR-048. Stop new false financial evidence; historical receipts
-- remain immutable and need a future approved append-only adjustment path.
create or replace function public.portal_commit_ai_usage_service(p_id app.uuid_v7,p_actual_input_tokens integer,p_actual_output_tokens integer,p_reported_cost_usd numeric default null)
returns jsonb language plpgsql security definer set search_path='public' as $$
declare v public.ai_usage_reservations%rowtype; v_total integer; v_source text; v_ref text; v_unit numeric(20,10); v_amount numeric(20,8);
begin
  select * into v from public.ai_usage_reservations where id=p_id for update; if not found then raise exception 'reservation not found' using errcode='P0002'; end if;
  -- Validate the original provider value before canonicalizing at storage
  -- precision, so tiny negatives or over-envelope fractions cannot round in.
  if p_reported_cost_usd is not null and (p_reported_cost_usd<0 or p_reported_cost_usd>v.max_cost_usd) then raise exception 'reported cost exceeds reservation' using errcode='22023'; end if;
  p_reported_cost_usd:=round(p_reported_cost_usd,8);

  -- Historical commits may have stored 0,0 with a reported cost. Preserve
  -- their exact raw replay without rewriting old reservation or ledger rows.
  if v.state='committed'
    and v.actual_input_tokens is not distinct from p_actual_input_tokens
    and v.actual_output_tokens is not distinct from p_actual_output_tokens
    and v.reported_cost_usd is not distinct from p_reported_cost_usd then
    return jsonb_build_object('committed',true,'replayed',true,'costEventId',v.cost_event_id);
  end if;
  if p_actual_input_tokens=0 and p_actual_output_tokens=0 then
    -- An all-zero tuple cannot establish token usage even with a reported
    -- cost. Account the reserved envelope before commit and raw-tuple replay.
    -- This is conservative quota accounting, not measured provider usage.
    p_actual_input_tokens:=v.max_input_tokens; p_actual_output_tokens:=v.max_output_tokens;
  end if;
  if v.state='committed' then
    if v.actual_input_tokens is distinct from p_actual_input_tokens
      or v.actual_output_tokens is distinct from p_actual_output_tokens
      or v.reported_cost_usd is distinct from p_reported_cost_usd then
      raise exception 'AI usage commit replay conflict' using errcode='23505';
    end if;
    return jsonb_build_object('committed',true,'replayed',true,'costEventId',v.cost_event_id);
  end if;
  if v.state<>'provider_in_flight' or p_actual_input_tokens not between 0 and v.max_input_tokens or p_actual_output_tokens not between 0 and v.max_output_tokens then raise exception 'AI usage exceeds reservation' using errcode='55000'; end if;
  v_total:=p_actual_input_tokens+p_actual_output_tokens; v_source:=case when p_reported_cost_usd is null then 'estimated' else 'provider_reported' end; v_ref:=case when p_reported_cost_usd is null then 'openrouter.reservation.max_cost' else 'openrouter.usage.reported' end;
  -- Preserve reported cost at the reservation's numeric(20,8) precision.
  -- Ledger amount
  -- remains derived from the rounded unit ratio to satisfy its canonical
  -- amount-reconciliation CHECK; it retains the existing mixed precision.
  if v_total=0 then v_unit:=0; v_amount:=0; else v_unit:=round(coalesce(p_reported_cost_usd,v.max_cost_usd)/v_total,10); v_amount:=round(v_total*v_unit,8); end if;
  insert into public.cost_events(tenant_id,id,provider_id,service,unit_type,quantity,unit_cost_usd,amount_usd,source,occurred_at,rate_card_ref,rate_card_as_of,provider_request_ref)
    values(v.tenant_id,v.cost_event_id,'openrouter','portal.'||v.operation,'token',v_total,v_unit,v_amount,v_source,now(),v_ref,'2026-08-13T00:00:00Z',v.provider_request_ref);
  update public.ai_usage_reservations set state='committed',actual_input_tokens=p_actual_input_tokens,actual_output_tokens=p_actual_output_tokens,reported_cost_usd=p_reported_cost_usd,committed_at=now(),updated_at=now() where id=v.id;
  return jsonb_build_object('committed',true,'replayed',false,'costEventId',v.cost_event_id);
end; $$;

revoke all on function public.portal_commit_ai_usage_service(app.uuid_v7,integer,integer,numeric)
  from public,anon,authenticated,service_role;
grant execute on function public.portal_commit_ai_usage_service(app.uuid_v7,integer,integer,numeric)
  to service_role;

create or replace function public.portal_reconcile_ai_usage_service(
  p_receipt_id app.uuid_v7,p_reservation_id app.uuid_v7,p_evidence text,p_provider_receipt_ref text,
  p_actual_input_tokens integer default null,p_actual_output_tokens integer default null,p_reported_cost_usd numeric default null
) returns jsonb language plpgsql security definer set search_path='public' as $$
declare v public.ai_usage_reservations%rowtype; v_receipt public.ai_usage_reconciliation_receipts%rowtype; v_total integer; v_unit numeric(20,10); v_amount numeric(20,8);
begin
  if p_evidence not in ('provider_invoice_no_charge','provider_invoice_usage_confirmed')
    or p_provider_receipt_ref is null or p_provider_receipt_ref !~ '^[A-Za-z0-9][A-Za-z0-9:._/-]{7,254}$' then
    raise exception 'invalid AI reconciliation evidence' using errcode='22023';
  end if;
  select * into v from public.ai_usage_reservations where id=p_reservation_id for update;
  if not found then raise exception 'AI reservation not found' using errcode='P0002'; end if;
  -- Validate the original provider value before canonicalizing at storage
  -- precision, so tiny negatives or over-envelope fractions cannot round in.
  if p_reported_cost_usd is not null and (p_reported_cost_usd<0 or p_reported_cost_usd>v.max_cost_usd) then raise exception 'reported cost exceeds reservation' using errcode='22023'; end if;
  p_reported_cost_usd:=round(p_reported_cost_usd,8);

  select * into v_receipt from public.ai_usage_reconciliation_receipts where tenant_id=v.tenant_id and reservation_id=v.id;
  if found then
    if v_receipt.id is distinct from p_receipt_id or v_receipt.evidence is distinct from p_evidence
      or v_receipt.provider_receipt_ref is distinct from p_provider_receipt_ref
      or v_receipt.actual_input_tokens is distinct from p_actual_input_tokens
      or v_receipt.actual_output_tokens is distinct from p_actual_output_tokens
      or v_receipt.reported_cost_usd is distinct from p_reported_cost_usd then
      raise exception 'AI reconciliation receipt conflict' using errcode='23505';
    end if;
    return jsonb_build_object('reconciled',true,'replayed',true,'state',v.state,'costEventId',case when v.state='committed' then v.cost_event_id else null end);
  end if;
  if v.state not in ('provider_in_flight','unknown') then raise exception 'AI reconciliation requires ambiguous state' using errcode='55000'; end if;
  if p_evidence='provider_invoice_no_charge' then
    if p_actual_input_tokens is not null or p_actual_output_tokens is not null or p_reported_cost_usd is not null then raise exception 'no-charge receipt cannot carry usage' using errcode='22023'; end if;
    insert into public.ai_usage_reconciliation_receipts(id,tenant_id,reservation_id,evidence,provider_receipt_ref)
      values(p_receipt_id,v.tenant_id,v.id,p_evidence,p_provider_receipt_ref);
    update public.ai_usage_reservations set state='released',release_evidence=p_evidence,released_at=now(),updated_at=now() where id=v.id;
    return jsonb_build_object('reconciled',true,'replayed',false,'state','released','costEventId',null);
  end if;
  if p_actual_input_tokens is null or p_actual_output_tokens is null or p_reported_cost_usd is null
    or p_actual_input_tokens not between 0 and v.max_input_tokens or p_actual_output_tokens not between 0 and v.max_output_tokens
    or p_actual_input_tokens+p_actual_output_tokens<=0 or p_reported_cost_usd<0 or p_reported_cost_usd>v.max_cost_usd then
    raise exception 'confirmed AI invoice usage exceeds reservation' using errcode='22023';
  end if;
  v_total:=p_actual_input_tokens+p_actual_output_tokens;
  v_unit:=round(p_reported_cost_usd/v_total,10); v_amount:=round(v_total*v_unit,8);
  insert into public.ai_usage_reconciliation_receipts(id,tenant_id,reservation_id,evidence,provider_receipt_ref,actual_input_tokens,actual_output_tokens,reported_cost_usd)
    values(p_receipt_id,v.tenant_id,v.id,p_evidence,p_provider_receipt_ref,p_actual_input_tokens,p_actual_output_tokens,p_reported_cost_usd);
  insert into public.cost_events(tenant_id,id,provider_id,service,unit_type,quantity,unit_cost_usd,amount_usd,source,occurred_at,rate_card_ref,rate_card_as_of,provider_request_ref)
    values(v.tenant_id,v.cost_event_id,'openrouter','portal.'||v.operation,'token',v_total,v_unit,v_amount,'provider_reported',now(),'openrouter.invoice.reconciled','2026-08-13T00:00:00Z',v.provider_request_ref);
  update public.ai_usage_reservations set state='committed',actual_input_tokens=p_actual_input_tokens,actual_output_tokens=p_actual_output_tokens,
    reported_cost_usd=p_reported_cost_usd,committed_at=now(),updated_at=now() where id=v.id;
  return jsonb_build_object('reconciled',true,'replayed',false,'state','committed','costEventId',v.cost_event_id);
end; $$;

revoke all on function public.portal_reconcile_ai_usage_service(app.uuid_v7,app.uuid_v7,text,text,integer,integer,numeric)
  from public,anon,authenticated,service_role;
grant execute on function public.portal_reconcile_ai_usage_service(app.uuid_v7,app.uuid_v7,text,text,integer,integer,numeric)
  to service_role;

-- Elapsed time is neither an invoice nor a no-charge receipt. Keep the
-- caller/signature and age validation compatible, with no state transitions,
-- timestamp writes, financial receipts or ledger rows at any valid age.
create or replace function public.portal_sweep_stale_ai_usage_unknown_service(
  p_tenant_id app.uuid_v7,
  p_max_age_seconds integer default 1800
) returns integer
language plpgsql volatile security definer set search_path='' as $$
begin
  if p_max_age_seconds is null or p_max_age_seconds < 900 or p_max_age_seconds > 86400 then
    raise exception 'sweep age must be 900..86400 seconds' using errcode='22023';
  end if;
  return 0;
end;
$$;
revoke all on function public.portal_sweep_stale_ai_usage_unknown_service(app.uuid_v7,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.portal_sweep_stale_ai_usage_unknown_service(app.uuid_v7,integer)
  to service_role;

alter function public.portal_schema_capabilities_service() set schema app;
alter function app.portal_schema_capabilities_service() rename to portal_schema_capabilities_v72;
revoke all on function app.portal_schema_capabilities_v72() from public,anon,authenticated,service_role;
create or replace function public.portal_schema_capabilities_service()
returns jsonb language sql stable security definer set search_path='' as $$
  select (app.portal_schema_capabilities_v72()-'version')||jsonb_build_object(
    'version',73,'aiUsageTimeoutSettlementEnabled',false,'aiUsageFinancialEvidenceRepair',true
  )
$$;
revoke all on function public.portal_schema_capabilities_service() from public,anon,authenticated;
grant execute on function public.portal_schema_capabilities_service() to service_role;

commit;
