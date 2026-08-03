-- Cobrança real dos planos do Digital Human OS (D-V2-101). Uma assinatura
-- Stripe por tenant (upgrade/downgrade troca a linha via upsert — a troca
-- de plano em si acontece no Customer Portal da Stripe, não aqui: preço
-- combinado fixo+metered não é algo que a UI própria deva reimplementar
-- quando a Stripe já resolve isso nativamente no Portal).
--
-- Unidade cobrada é CONVERSA de vídeo (não minuto): o produto não mede
-- duração real de chamada hoje (gap já declarado em
-- docs/COST_OPTIMIZATION.md) — cobrar por minuto seria prometer uma
-- precisão que o sistema não entrega (Art. 16).
--
-- Mesmo padrão de RLS de todo o projeto: FORCE ROW LEVEL SECURITY sem
-- nenhuma policy — a tabela fica ilegível/inescrevível direto; todo acesso
-- passa por RPC SECURITY DEFINER que resolve o tenant via auth.uid() (leitura,
-- authenticated) ou é exclusivo de service_role (escrita, chamada pelo
-- webhook da Stripe — sem sessão de usuário).
--
-- last_event_created_at é a guarda contra entrega fora de ordem: a Stripe
-- não garante ordem de entrega de webhook, e retry de um evento MAIS VELHO
-- não pode regredir o status/plano por cima de um evento mais novo já
-- aplicado (achado da revisão adversarial 2026-08-03) — o upsert só aplica
-- quando o evento recebido é igual ou mais novo que o último já gravado.

BEGIN;

create table if not exists public.tenant_subscriptions (
  id app.uuid_v7 primary key,
  tenant_id app.uuid_v7 not null unique references public.tenants(id) on delete cascade,
  plan_id text not null,
  status text not null,
  stripe_customer_id text not null,
  stripe_subscription_id text not null unique,
  current_period_start timestamptz,
  current_period_end timestamptz,
  last_event_created_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenant_subscriptions_plan_id_chk check (plan_id in ('piloto', 'crescimento', 'escala')),
  constraint tenant_subscriptions_status_chk
    check (status in ('incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused')),
  constraint tenant_subscriptions_stripe_customer_id_fmt check (stripe_customer_id ~ '^cus_[A-Za-z0-9]{1,255}$'),
  constraint tenant_subscriptions_stripe_subscription_id_fmt check (stripe_subscription_id ~ '^sub_[A-Za-z0-9]{1,255}$')
);

create index if not exists tenant_subscriptions_stripe_customer_id_idx
  on public.tenant_subscriptions (stripe_customer_id);

alter table public.tenant_subscriptions enable row level security;
alter table public.tenant_subscriptions force row level security;

-- Leitura: o próprio tenant vê o próprio estado de cobrança + contagem de
-- conversas do dia (segurança) e do período de faturamento (plano). Sem
-- assinatura ativa, current_period_start cai pro início do mês corrente —
-- mesma semântica de "período" pra quem ainda não assinou ou já cancelou
-- (usada só se BILLING_TRIAL_LIMIT_ENABLED estiver ligado no app; nunca
-- herda o período congelado de uma assinatura cancelada).
create or replace function public.portal_billing_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = 'public'
as $$
declare
  v_tenant app.uuid_v7;
  v_sub record;
  v_period_start timestamptz;
  v_conversations_today bigint;
  v_conversations_period bigint;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  select tenant_id into v_tenant from public.user_tenant_memberships where user_id = auth.uid();
  if v_tenant is null then
    raise exception 'no tenant provisioned' using errcode = '42501';
  end if;

  select * into v_sub from public.tenant_subscriptions where tenant_id = v_tenant;
  v_period_start := case
    when v_sub.status in ('active', 'trialing', 'past_due') then coalesce(v_sub.current_period_start, date_trunc('month', now()))
    else date_trunc('month', now())
  end;

  select coalesce(count(*), 0) into v_conversations_today
  from public.cost_events
  where tenant_id = v_tenant and unit_type = 'conversation' and occurred_at >= date_trunc('day', now());

  select coalesce(count(*), 0) into v_conversations_period
  from public.cost_events
  where tenant_id = v_tenant and unit_type = 'conversation' and occurred_at >= v_period_start;

  return jsonb_build_object(
    'plan_id', v_sub.plan_id,
    'status', v_sub.status,
    'stripe_customer_id', v_sub.stripe_customer_id,
    'current_period_start', v_sub.current_period_start,
    'current_period_end', v_sub.current_period_end,
    'conversations_today', v_conversations_today,
    'conversations_this_period', v_conversations_period
  );
end;
$$;

revoke all on function public.portal_billing_status from public, anon;
grant execute on function public.portal_billing_status to authenticated;

-- Escrita: só o webhook da Stripe (service_role, sem auth.uid()). Upsert por
-- tenant_id — uma linha por tenant; trocar de plano substitui a linha (o
-- Customer Portal da Stripe já resolve pró-rata e period boundaries).
-- p_event_created_at é a guarda monotônica: NULL sempre aplica (compat com
-- caller sem essa informação); quando presente, só aplica se for >= o
-- último evento já gravado — retry/entrega fora de ordem de um evento mais
-- velho vira no-op silencioso (found=true, applied=false).
create or replace function public.portal_upsert_tenant_subscription_service(
  p_id app.uuid_v7,
  p_tenant_id app.uuid_v7,
  p_plan_id text,
  p_status text,
  p_stripe_customer_id text,
  p_stripe_subscription_id text,
  p_current_period_start timestamptz,
  p_current_period_end timestamptz,
  p_event_created_at timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_applied boolean;
begin
  if p_plan_id not in ('piloto', 'crescimento', 'escala') then
    raise exception 'invalid plan_id' using errcode = '22023';
  end if;
  if p_status not in ('incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused') then
    raise exception 'invalid status' using errcode = '22023';
  end if;
  if p_stripe_customer_id !~ '^cus_[A-Za-z0-9]{1,255}$' then
    raise exception 'invalid stripe_customer_id' using errcode = '22023';
  end if;
  if p_stripe_subscription_id !~ '^sub_[A-Za-z0-9]{1,255}$' then
    raise exception 'invalid stripe_subscription_id' using errcode = '22023';
  end if;
  if not exists (select 1 from public.tenants where id = p_tenant_id) then
    raise exception 'unknown tenant' using errcode = '42501';
  end if;

  insert into public.tenant_subscriptions (
    id, tenant_id, plan_id, status, stripe_customer_id, stripe_subscription_id,
    current_period_start, current_period_end, last_event_created_at
  ) values (
    p_id, p_tenant_id, p_plan_id, p_status, p_stripe_customer_id, p_stripe_subscription_id,
    p_current_period_start, p_current_period_end, p_event_created_at
  )
  on conflict (tenant_id) do update set
    plan_id = excluded.plan_id,
    status = excluded.status,
    stripe_customer_id = excluded.stripe_customer_id,
    stripe_subscription_id = excluded.stripe_subscription_id,
    current_period_start = excluded.current_period_start,
    current_period_end = excluded.current_period_end,
    last_event_created_at = excluded.last_event_created_at,
    updated_at = now()
  where
    excluded.last_event_created_at is null
    or tenant_subscriptions.last_event_created_at is null
    or excluded.last_event_created_at >= tenant_subscriptions.last_event_created_at;

  get diagnostics v_applied = row_count;
  return jsonb_build_object('ok', true, 'tenant_id', p_tenant_id, 'applied', v_applied > 0);
end;
$$;

revoke all on function public.portal_upsert_tenant_subscription_service from public, anon, authenticated;
grant execute on function public.portal_upsert_tenant_subscription_service to service_role;

COMMIT;
