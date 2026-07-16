-- Ledger de uso de IA do portal sobre cost_events (tabela de M0, primeiro uso
-- real por código de aplicação) + teto diário consultável. unit_cost 0 e
-- source 'estimated' de propósito: tokens são medidos, o rating em USD por
-- modelo fica para o rate card real (D-V2-064) — nunca inventar custo.

BEGIN;

-- search_path fixo em 'public' (nao vazio): o trigger de reconciliacao de
-- cost_events (migration portavel 0009) referencia a tabela sem qualificar e
-- herda o search_path do chamador.
create or replace function public.portal_log_ai_usage(
  p_id app.uuid_v7,
  p_service text,
  p_input_tokens integer,
  p_output_tokens integer
) returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_tenant app.uuid_v7;
  v_total integer;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  select tenant_id into v_tenant from public.user_tenant_memberships where user_id = auth.uid();
  if v_tenant is null then
    raise exception 'no tenant provisioned' using errcode = '42501';
  end if;
  if p_service !~ '^[a-z][a-z0-9._-]{2,120}$' then
    raise exception 'invalid service label' using errcode = '22023';
  end if;
  if p_input_tokens < 0 or p_input_tokens > 2000000 or p_output_tokens < 0 or p_output_tokens > 2000000 then
    raise exception 'token counts out of range' using errcode = '22023';
  end if;
  v_total := p_input_tokens + p_output_tokens;

  insert into public.cost_events (tenant_id, id, session_id, provider_id, service, unit_type, quantity, unit_cost_usd, amount_usd, source, occurred_at)
  values (v_tenant, p_id, null, 'openrouter', p_service, 'token', v_total, 0, 0, 'estimated', now());

  return jsonb_build_object('ok', true, 'total_tokens', v_total);
end;
$$;

revoke all on function public.portal_log_ai_usage from public, anon;
grant execute on function public.portal_log_ai_usage to authenticated;

create or replace function public.portal_ai_tokens_today()
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant app.uuid_v7;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  select tenant_id into v_tenant from public.user_tenant_memberships where user_id = auth.uid();
  if v_tenant is null then
    return 0;
  end if;
  return coalesce((
    select sum(quantity)::bigint
    from public.cost_events
    where tenant_id = v_tenant
      and provider_id = 'openrouter'
      and unit_type = 'token'
      and occurred_at >= date_trunc('day', now())
  ), 0);
end;
$$;

revoke all on function public.portal_ai_tokens_today from public, anon;
grant execute on function public.portal_ai_tokens_today to authenticated;

COMMIT;
