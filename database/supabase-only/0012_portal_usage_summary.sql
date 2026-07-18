-- Resumo de uso de IA do tenant para o dashboard: tokens de hoje (contra o
-- teto diário aplicado no app), conversas de vídeo de hoje e o agregado dos
-- últimos 7 dias por serviço. Leitura para qualquer membro do tenant — é o
-- consumo da própria conta, sem valores monetários (unit_cost ainda é 0 até
-- existir rate card; mostrar "R$ 0" seria mentira de precisão).

BEGIN;

create or replace function public.portal_usage_summary()
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_tenant app.uuid_v7;
  v_tokens_today bigint;
  v_conversations_today bigint;
  v_services jsonb;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  select tenant_id into v_tenant
  from public.user_tenant_memberships where user_id = auth.uid();
  if v_tenant is null then
    raise exception 'no tenant provisioned' using errcode = '42501';
  end if;

  select coalesce(sum(quantity), 0)::bigint into v_tokens_today
  from public.cost_events
  where tenant_id = v_tenant
    and unit_type = 'token'
    and occurred_at >= date_trunc('day', now());

  select count(*) into v_conversations_today
  from public.cost_events
  where tenant_id = v_tenant
    and unit_type = 'conversation'
    and occurred_at >= date_trunc('day', now());

  select coalesce(jsonb_agg(jsonb_build_object(
    'service', grouped.service,
    'unit_type', grouped.unit_type,
    'quantity', grouped.quantity
  ) order by grouped.quantity desc), '[]'::jsonb)
  into v_services
  from (
    select service, unit_type, sum(quantity)::bigint as quantity
    from public.cost_events
    where tenant_id = v_tenant
      and occurred_at >= now() - interval '7 days'
    group by service, unit_type
  ) as grouped;

  return jsonb_build_object(
    'tokens_today', v_tokens_today,
    'conversations_today', v_conversations_today,
    'services_7d', v_services
  );
end;
$$;

revoke all on function public.portal_usage_summary from public, anon;
grant execute on function public.portal_usage_summary to authenticated;

COMMIT;
