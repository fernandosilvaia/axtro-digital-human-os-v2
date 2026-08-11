-- Alertas proativos de custo (D-V2-107, proposta da auditoria 2026-08-11):
-- docs/COST_OPTIMIZATION.md declarava o gap explicitamente — "os tetos
-- cortam, mas não avisam antes". Os 4 tetos diários do produto (vídeo,
-- tokens do brain, tokens do chat de teste, vídeo do lead) checam o uso já
-- lido; esta migration só acrescenta o mecanismo de DEDUP (nunca reenviar o
-- mesmo alerta 2x no mesmo dia, mesmo sob corrida entre requisições
-- concorrentes) — o envio em si é código de aplicação (cost-alerts.ts).
--
-- Mesma disciplina de RLS de toda tabela nova do projeto: FORCE ROW LEVEL
-- SECURITY sem NENHUMA policy — acesso só via RPC SECURITY DEFINER,
-- exclusiva de service_role (quem chama são os 4 pontos de checagem de
-- teto, servidor-a-servidor ou dentro de uma server action, nunca direto do
-- cliente).

BEGIN;

create table if not exists public.tenant_cost_alerts (
  tenant_id app.uuid_v7 not null references public.tenants(id) on delete cascade,
  alert_key text not null,
  alert_date date not null,
  sent_at timestamptz not null default now(),
  primary key (tenant_id, alert_key, alert_date),
  constraint tenant_cost_alerts_alert_key_len_chk check (char_length(alert_key) between 1 and 64)
);

alter table public.tenant_cost_alerts enable row level security;
alter table public.tenant_cost_alerts force row level security;

-- Reivindica o direito de enviar UM alerta (tenant_id, alert_key) no dia UTC
-- corrente — `claimed=true` só pra UMA chamada concorrente; a PRIMARY KEY
-- resolve a corrida entre 2 requisições simultâneas cruzando o mesmo
-- threshold sem lock de aplicação. `alert_date` calculado no próprio SQL
-- (nunca recebido do chamador) — mesmo corte de dia UTC que todo teto
-- diário do projeto já usa (date_trunc('day', now())).
create or replace function public.portal_claim_cost_alert_service(
  p_tenant_id app.uuid_v7,
  p_alert_key text
) returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_row_count integer;
begin
  if char_length(p_alert_key) = 0 or char_length(p_alert_key) > 64 then
    raise exception 'invalid alert_key' using errcode = '22023';
  end if;

  insert into public.tenant_cost_alerts (tenant_id, alert_key, alert_date)
  values (p_tenant_id, p_alert_key, (now() at time zone 'utc')::date)
  on conflict (tenant_id, alert_key, alert_date) do nothing;

  get diagnostics v_row_count = row_count;
  return jsonb_build_object('claimed', v_row_count > 0);
end;
$$;

revoke all on function public.portal_claim_cost_alert_service from public, anon, authenticated;
grant execute on function public.portal_claim_cost_alert_service to service_role;

-- portal_billing_status ganha `tenant_id` no retorno (campo aditivo, nada
-- removido) — checkVideoCap precisa do tenant pra chamar o alerta de custo
-- de vídeo, e hoje a RPC resolve o tenant internamente via auth.uid() mas
-- nunca devolvia o id, obrigando o caller a uma query extra. Corpo idêntico
-- ao de 0026, só o campo novo no jsonb_build_object final.
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
    'tenant_id', v_tenant,
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

COMMIT;
