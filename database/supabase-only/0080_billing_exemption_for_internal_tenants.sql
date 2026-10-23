begin;

-- ADR-051 etapa 3: isencao de cobranca para tenant interno da plataforma.
--
-- A reserva de sala de video (portal_begin_provider_effect_service, 0040) exige assinatura ativa da
-- Stripe e aplica um teto mensal de "trial". Um tenant do proprio dono do produto (a closer da Billion
-- Leads Pro) nao paga a si mesmo, e uma linha em tenant_subscriptions exigiria ids reais da Stripe
-- (cus_..., sub_...) e um recibo de checkout, entao nao da para conceder uma assinatura de mentira.
--
-- Esta migration cria uma lista de isencoes e muda SO duas regras da reserva: a exigencia de
-- assinatura e o teto mensal de trial. Continuam valendo o teto diario de 20 salas, o teto de salas
-- sem entrega por periodo e a concorrencia. A ativacao de cobranca ja trata tenant sem assinatura
-- (sem cliente Stripe nao existe excedente cobravel). O corpo abaixo e o da 0040 com tres trechos
-- mudados (declaracao, portao de assinatura, teto mensal de trial). A tabela nao tem tenant_id pelo
-- mesmo motivo da 0079: o catalogo de governanca de dados conta tabelas com essa coluna.
-- Concessao: so o operador, com service_role, e nunca por aplicacao. Autorizada pelo dono em 2026-10-19.
create table if not exists public.portal_billing_exemptions (
  exempt_tenant app.uuid_v7 primary key references public.tenants(id) on delete cascade,
  reason text not null,
  granted_at timestamptz not null default now(),
  constraint portal_billing_exemptions_reason_chk check (char_length(reason) between 8 and 300)
);
alter table public.portal_billing_exemptions enable row level security;
alter table public.portal_billing_exemptions force row level security;
revoke all on table public.portal_billing_exemptions from public, anon, authenticated, service_role;

create or replace function public.portal_begin_provider_effect_service(
  p_reservation_id app.uuid_v7,
  p_cost_event_id app.uuid_v7,
  p_tenant_id app.uuid_v7,
  p_agent_id app.uuid_v7,
  p_idempotency_key text,
  p_provider_id text,
  p_effect_kind text,
  p_cap_bucket text,
  p_related_ref text default null,
  p_meter_event_name text default 'axtro_conversation_overage',
  p_max_duration_seconds integer default null
) returns jsonb
language plpgsql security definer set search_path = 'public'
as $$
declare
  v_existing public.provider_effect_reservations%rowtype;
  v_sub public.tenant_subscriptions%rowtype;
  v_count bigint;
  v_month_count bigint;
  v_pending_delivery_count bigint;
  v_no_delivery_count bigint;
  v_included integer := 0;
  v_trial_period_start timestamptz;
  v_max_duration integer;
  v_estimated_cost numeric(20,8);
  v_rate_card_ref text;
  v_request_ref text;
  v_exempt boolean;
begin
  if not exists (select 1 from public.agents where tenant_id=p_tenant_id and id=p_agent_id) then
    raise exception 'agent not found for tenant' using errcode='42501';
  end if;
  if p_provider_id not in ('tavus','recall')
    or p_effect_kind not in ('tavus_conversation','recall_bot')
    or p_cap_bucket not in ('tavus_video_daily','recall_bot_active')
    or (p_provider_id='tavus') is distinct from (p_effect_kind='tavus_conversation')
    or (p_provider_id='tavus') is distinct from (p_cap_bucket='tavus_video_daily') then
    raise exception 'invalid provider effect tuple' using errcode='22023';
  end if;
  if p_idempotency_key !~ '^[a-z0-9][a-z0-9:._/-]{7,199}$' then
    raise exception 'invalid idempotency key' using errcode='22023';
  end if;
  if p_related_ref is not null and (
    char_length(p_related_ref) not between 1 and 255
    or p_related_ref !~ '^[a-z0-9][a-z0-9:._/-]{0,254}$'
    or p_related_ref ~ '://'
  ) then
    raise exception 'related_ref must be a bounded opaque reference' using errcode='22023';
  end if;
  if p_meter_event_name is null or p_meter_event_name !~ '^[a-z][a-z0-9_]{2,99}$' then
    raise exception 'invalid meter event name' using errcode='22023';
  end if;
  if p_provider_id='tavus' then
    if p_max_duration_seconds is null or p_max_duration_seconds not between 60 and 1800 then
      raise exception 'Tavus max duration must be 60..1800 seconds' using errcode='22023';
    end if;
    v_max_duration := p_max_duration_seconds;
    -- Conservative published CVI overage as of 2026-08-13: USD .37/min.
    -- Tavus' public pricing page is internally inconsistent; the actual
    -- account rate remains pending dashboard/invoice reconciliation.
    v_estimated_cost := round(ceil(v_max_duration / 60.0) * 0.37, 8);
    v_rate_card_ref := 'tavus.cvi_overage.max_published_0_37_per_minute_2026_08_13';
  else
    if p_max_duration_seconds is not null then
      raise exception 'Recall duration is fixed server-side' using errcode='22023';
    end if;
    v_max_duration := 2400;
    -- Public PAYG reference as of 2026-08-13: web_4_core total USD .60/h
    -- plus Recall transcription USD .15/h, reserved for the hard 40m cap.
    v_estimated_cost := round((0.75 / 60.0) * 40, 8);
    v_rate_card_ref := 'recall.web_4_core_plus_transcript.max_40m';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text, 0));
  select * into v_existing from public.provider_effect_reservations
    where tenant_id=p_tenant_id and idempotency_key=p_idempotency_key for update;
  if found then
    if v_existing.agent_id is distinct from p_agent_id
      or v_existing.provider_id is distinct from p_provider_id
      or v_existing.effect_kind is distinct from p_effect_kind
      or v_existing.cap_bucket is distinct from p_cap_bucket
      or v_existing.related_ref is distinct from p_related_ref
      or v_existing.meter_event_name is distinct from p_meter_event_name
      or v_existing.max_duration_seconds is distinct from v_max_duration then
      raise exception 'provider effect replay tuple conflict' using errcode='23505';
    end if;
    if v_existing.state in ('unknown','cleanup_pending','provider_in_flight') then
      return jsonb_build_object('outcome','blocked_unknown','reservationId',v_existing.id,'state',v_existing.state);
    end if;
    return jsonb_build_object('outcome','replayed','reservationId',v_existing.id,'state',v_existing.state,
      'costEventId',v_existing.cost_event_id,'providerRequestRef',v_existing.provider_request_ref,
      'providerRef',v_existing.provider_ref,'providerUrl',v_existing.provider_url,'billableOverage',v_existing.billable_overage,
      'customerDeliveryState',v_existing.customer_delivery_state,'retryGeneration',v_existing.retry_generation,
      'maxDurationSeconds',v_existing.max_duration_seconds,'estimatedCostUsd',v_existing.estimated_cost_usd);
  end if;

  if exists (
    select 1 from public.provider_effect_reservations r
    where r.tenant_id=p_tenant_id and r.agent_id=p_agent_id
      and r.provider_id=p_provider_id and r.effect_kind=p_effect_kind
      and r.related_ref is not distinct from p_related_ref
      and r.state in ('provider_in_flight','unknown','cleanup_pending')
  ) then
    return jsonb_build_object('outcome','blocked_unknown');
  end if;

  -- 0080: um tenant interno da plataforma (dono do produto, sem cobranca) nao precisa de assinatura da
  -- Stripe. Continuam valendo o teto diario de 20 salas, o teto de salas sem entrega e a concorrencia.
  select exists(select 1 from public.portal_billing_exemptions where exempt_tenant=p_tenant_id) into v_exempt;
  select * into v_sub from public.tenant_subscriptions where tenant_id=p_tenant_id;
  if not v_exempt then
    if not found then return jsonb_build_object('outcome','capped','bucket','billing_status','status','no_subscription'); end if;
    if v_sub.status not in ('active','trialing') then return jsonb_build_object('outcome','capped','bucket','billing_status','status',v_sub.status); end if;
  end if;

  if p_cap_bucket='tavus_video_daily' then
    select count(*) into v_count from public.cost_events c
      where c.tenant_id=p_tenant_id and c.unit_type='conversation' and c.occurred_at>=date_trunc('day',now(),'UTC')
      and not exists (select 1 from public.provider_effect_reservations r where r.tenant_id=c.tenant_id and r.cost_event_id=c.id);
    select v_count + count(*) into v_count from public.provider_effect_reservations r
      where r.tenant_id=p_tenant_id and r.cap_bucket=p_cap_bucket and r.state<>'released'
        and (
          r.state in ('provider_in_flight','unknown','cleanup_pending')
          or (r.state='reserved' and r.created_at>=date_trunc('day',now(),'UTC'))
          or (r.state in ('committed','completed') and exists (
            select 1 from public.cost_events c where c.tenant_id=r.tenant_id and c.id=r.cost_event_id
              and c.occurred_at>=date_trunc('day',now(),'UTC')
          ))
        );
    if v_count>=20 then return jsonb_build_object('outcome','capped','bucket',p_cap_bucket,'usage',v_count,'cap',20); end if;
  else
    select count(*) into v_count from public.meeting_bot_sessions s where s.tenant_id=p_tenant_id and s.status not in ('ended','failed')
      and not exists (select 1 from public.provider_effect_reservations r where r.id=s.recall_reservation_id);
    select v_count + count(*) into v_count from public.provider_effect_reservations r
      where r.tenant_id=p_tenant_id and r.cap_bucket=p_cap_bucket and r.state not in ('released','completed');
    if v_count>=20 then return jsonb_build_object('outcome','capped','bucket',p_cap_bucket,'usage',v_count,'cap',20); end if;

    -- Active concurrency is not a financial budget: short or compensated
    -- bots would otherwise leave that bucket and permit unbounded sequential
    -- Recall spend. Count committed evidence by ledger time and retain only
    -- uncommitted envelopes that can still represent spend.
    select count(*) into v_month_count from public.cost_events c
      where c.tenant_id=p_tenant_id and c.provider_id='recall'
        and c.service='portal.meeting_bot_session'
        and c.occurred_at>=date_trunc('day',now(),'UTC')
        and not exists (
          select 1 from public.provider_effect_reservations r
          where r.tenant_id=c.tenant_id and r.cost_event_id=c.id
        );
    select v_month_count + count(*) into v_month_count
    from public.provider_effect_reservations r
    left join public.cost_events c on c.tenant_id=r.tenant_id and c.id=r.cost_event_id
    where r.tenant_id=p_tenant_id and r.provider_id='recall'
      and (
        (c.id is not null and c.occurred_at>=date_trunc('day',now(),'UTC'))
        or (c.id is null and r.state='reserved' and r.created_at>=date_trunc('day',now(),'UTC'))
        or (c.id is null and r.state in ('provider_in_flight','unknown','cleanup_pending'))
      );
    if v_month_count>=20 then
      return jsonb_build_object('outcome','capped','bucket','recall_bot_daily','usage',v_month_count,'cap',20);
    end if;
  end if;

  v_trial_period_start := case when v_sub.status in ('active','trialing') then coalesce(v_sub.current_period_start,date_trunc('month',now())) else date_trunc('month',now()) end;
  if p_provider_id='tavus' then
    -- A room starts accruing Tavus cost at creation, before customer delivery
    -- is proven. Bound both the concurrent unproven exposure and the number of
    -- provider-paid conversations that ended without delivery in one billing
    -- period. Activated overage remains unaffected.
    select count(*) into v_pending_delivery_count
    from public.provider_effect_reservations r
    where r.tenant_id=p_tenant_id and r.provider_id='tavus'
      and r.customer_delivery_state='held'
      and r.state in ('reserved','provider_in_flight','committed','unknown','cleanup_pending','completed');
    select count(*) into v_no_delivery_count
    from public.provider_effect_reservations r
    where r.tenant_id=p_tenant_id and r.provider_id='tavus'
      and r.provider_dispatched_at is not null
      and r.provider_dispatched_at>=v_trial_period_start
      and (v_sub.current_period_end is null or r.provider_dispatched_at<v_sub.current_period_end)
      and (r.customer_delivery_state='voided' or (r.state='released' and r.customer_delivery_state<>'activated'));
    if v_pending_delivery_count+v_no_delivery_count>=3 then
      return jsonb_build_object(
        'outcome','capped','bucket','tavus_no_delivery_period',
        'usage',v_pending_delivery_count+v_no_delivery_count,'cap',3,
        'pending',v_pending_delivery_count,'noDelivery',v_no_delivery_count
      );
    end if;
  end if;
  if p_cap_bucket='tavus_video_daily' then
    v_included := case v_sub.plan_id when 'piloto' then 7 when 'crescimento' then 30 when 'escala' then 85 else 5 end;
    select count(*) into v_month_count from public.cost_events c where c.tenant_id=p_tenant_id and c.unit_type='conversation' and c.occurred_at>=v_trial_period_start
      and not exists (select 1 from public.provider_effect_reservations r where r.tenant_id=c.tenant_id and r.cost_event_id=c.id);
    select v_month_count + count(*) into v_month_count from public.provider_effect_reservations r
      where r.tenant_id=p_tenant_id and r.cap_bucket='tavus_video_daily' and r.state<>'released'
        and (
          r.state in ('provider_in_flight','unknown','cleanup_pending')
          or (r.state='reserved' and r.created_at>=v_trial_period_start)
          or (r.state in ('committed','completed') and exists (
            select 1 from public.cost_events c where c.tenant_id=r.tenant_id and c.id=r.cost_event_id
              and c.occurred_at>=v_trial_period_start
              and (v_sub.current_period_end is null or c.occurred_at<v_sub.current_period_end)
          ))
        );
    if v_month_count>=v_included and v_sub.status is distinct from 'active' and not v_exempt then
      return jsonb_build_object('outcome','capped','bucket','tavus_monthly_trial','usage',v_month_count,'cap',v_included);
    end if;
  end if;
  v_request_ref := 'ppr_'||replace(p_reservation_id::text,'-','');
  insert into public.provider_effect_reservations(id,tenant_id,agent_id,idempotency_key,provider_id,effect_kind,cap_bucket,cost_event_id,provider_request_ref,related_ref,meter_event_name,max_duration_seconds,estimated_cost_usd,cost_rate_card_ref,cost_rate_card_as_of)
  values(p_reservation_id,p_tenant_id,p_agent_id,p_idempotency_key,p_provider_id,p_effect_kind,p_cap_bucket,p_cost_event_id,v_request_ref,p_related_ref,p_meter_event_name,v_max_duration,v_estimated_cost,v_rate_card_ref,'2026-08-13T00:00:00Z');
  return jsonb_build_object('outcome','reserved','reservationId',p_reservation_id,'state','reserved','providerRequestRef',v_request_ref,'billableOverage',false,'customerDeliveryState','held','retryGeneration',0,'maxDurationSeconds',v_max_duration,'estimatedCostUsd',v_estimated_cost);
end; $$;

revoke all on function public.portal_begin_provider_effect_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,text,text,text,text,integer) from public, anon, authenticated;
grant execute on function public.portal_begin_provider_effect_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,text,text,text,text,integer) to service_role;

commit;
