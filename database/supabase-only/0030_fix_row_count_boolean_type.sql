-- Achado menor durante o trabalho de histórico de conversa (D-V2-106):
-- portal_upsert_tenant_subscription_service (0026, JÁ APLICADA em
-- produção) declara `v_applied boolean` e faz
-- `get diagnostics v_applied = row_count` — ROW_COUNT é bigint, e Postgres
-- só aceita atribuir isso numa variável boolean via cast de TEXTO ('0'/'1'
-- viram false/true). Funciona por acidente pro caso de uso real (upsert
-- por tenant_id, único, sempre afeta 0 ou 1 linha) — mas QUALQUER row_count
-- >= 2 (ex.: se a lógica do upsert mudar um dia) quebra com
-- "22P02: invalid input syntax for type boolean" (confirmado ao vivo com
-- um teste isolado). Corrigido pro tipo certo (integer) antes que a
-- primeira chamada real do webhook da Stripe dependa disso.

BEGIN;

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
  v_row_count integer;
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

  get diagnostics v_row_count = row_count;
  return jsonb_build_object('ok', true, 'tenant_id', p_tenant_id, 'applied', v_row_count > 0);
end;
$$;

COMMIT;
