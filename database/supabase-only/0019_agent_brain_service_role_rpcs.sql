-- M4-04: RPCs "_service" — variantes das RPCs existentes que recebem o
-- tenant/agente EXPLICITAMENTE em vez de resolver por auth.uid(), porque o
-- Tavus chamando nosso endpoint de LLM (layers.llm.base_url) é uma chamada
-- servidor-a-servidor sem sessão de Supabase Auth. Concedidas SOMENTE a
-- service_role — nunca a authenticated/anon — e chamadas de dentro do route
-- handler com o service-role client (apps/portal/src/lib/supabase/service.ts),
-- nunca expostas ao navegador.
--
-- IMPORTANTE: o rate card (preços do 0017_rate_card.sql) está DUPLICADO
-- aqui de propósito, não compartilhado por refatoração — preferi não tocar
-- a portal_log_ai_usage já validada em produção com dólares reais
-- (D-V2-078) para adicionar esta variante. Atualizar preço aqui exige
-- atualizar as DUAS funções (portal_log_ai_usage em 0017 e esta).

BEGIN;

-- Resolve tenant + agente + config a partir do hash do segredo (M4-03).
-- Sem auth.uid(): a única credencial é o hash em si.
create or replace function public.portal_resolve_agent_brain_config_service(p_secret_hash text)
returns jsonb
language plpgsql
stable
security definer
set search_path = 'public'
as $$
declare
  v_row public.agent_brain_config%rowtype;
  v_agent_name text;
  v_tenant_legal_name text;
begin
  if p_secret_hash !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('found', false);
  end if;
  select * into v_row from public.agent_brain_config where secret_hash = p_secret_hash;
  if not found or not v_row.enabled then
    return jsonb_build_object('found', false);
  end if;
  select name into v_agent_name from public.agents where tenant_id = v_row.tenant_id and id = v_row.agent_id;
  select legal_name into v_tenant_legal_name from public.tenants where id = v_row.tenant_id;
  if v_agent_name is null or v_tenant_legal_name is null then
    return jsonb_build_object('found', false);
  end if;
  return jsonb_build_object(
    'found', true,
    'tenant_id', v_row.tenant_id,
    'agent_id', v_row.agent_id,
    'agent_name', v_agent_name,
    'tenant_name', v_tenant_legal_name
  );
end;
$$;

revoke all on function public.portal_resolve_agent_brain_config_service from public, anon, authenticated;
grant execute on function public.portal_resolve_agent_brain_config_service to service_role;

-- Log de custo de geração para o caminho Tavus. Preço de tabela duplicado
-- de 0017 (ver nota no topo do arquivo) — sempre serviço 'portal.agent_brain'.
create or replace function public.portal_log_ai_usage_service(
  p_tenant_id app.uuid_v7,
  p_id app.uuid_v7,
  p_input_tokens integer,
  p_output_tokens integer
) returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_total integer;
  v_unit_cost numeric(20,10);
  v_amount numeric(20,8);
  v_price_in constant numeric(20,10) := 1.00 / 1000000;
  v_price_out constant numeric(20,10) := 5.00 / 1000000;
begin
  if p_input_tokens < 0 or p_input_tokens > 2000000 or p_output_tokens < 0 or p_output_tokens > 2000000 then
    raise exception 'token counts out of range' using errcode = '22023';
  end if;
  if not exists (select 1 from public.tenants where id = p_tenant_id) then
    raise exception 'unknown tenant' using errcode = '42501';
  end if;
  v_total := p_input_tokens + p_output_tokens;

  if v_total = 0 then
    v_unit_cost := 0;
    v_amount := 0;
  else
    v_unit_cost := round((p_input_tokens * v_price_in + p_output_tokens * v_price_out) / v_total, 10);
    v_amount := round(v_total * v_unit_cost, 8);
  end if;

  insert into public.cost_events (
    tenant_id, id, session_id, provider_id, service, unit_type, quantity,
    unit_cost_usd, amount_usd, source, occurred_at, rate_card_ref, rate_card_as_of
  )
  values (
    p_tenant_id, p_id, null, 'openrouter', 'portal.agent_brain', 'token', v_total,
    v_unit_cost, v_amount, 'estimated', now(), 'openrouter.chat.haiku-4.5', '2026-07-22T00:00:00Z'
  );

  return jsonb_build_object('ok', true, 'total_tokens', v_total, 'amount_usd', v_amount);
end;
$$;

revoke all on function public.portal_log_ai_usage_service from public, anon, authenticated;
grant execute on function public.portal_log_ai_usage_service to service_role;

COMMIT;
