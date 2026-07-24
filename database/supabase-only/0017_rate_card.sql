-- Rate card de custos (T8, execução autônoma 2026-07-22): preenche
-- unit_cost_usd/amount_usd com preços PÚBLICOS de tabela (list price, não
-- taxa negociada) em vez de 0. source permanece 'estimated' — honestidade
-- estrutural (Art. 16): isto é uma estimativa datada e citável, nunca
-- 'measured'/'provider_reported' (essas exigiriam o valor faturado real).
--
-- Fontes consultadas em 2026-07-22 (rate_card_ref/rate_card_as_of citam a
-- mesma data; revisar quando o Fernando tiver a taxa negociada real):
--   openrouter.chat.haiku-4.5  — https://openrouter.ai/anthropic/claude-haiku-4.5
--     USD 1.00 / 1M tokens de entrada · USD 5.00 / 1M tokens de saída
--   openrouter.embedding.3-small — https://openrouter.ai/openai/text-embedding-3-small/pricing
--     USD 0.02 / 1M tokens de entrada (sem custo de saída)
--   tavus.conversation.floor — https://www.tavus.io/blog/conversational-ai-pricing
--     USD 0.32-0.37/min de overage conforme plano; usamos USD 0.35/min como
--     ponto médio, aplicado ao mínimo de cobrança de 30s (USD 0.175/conversa)
--     como um PISO — a duração real de cada chamada não é capturada hoje,
--     então o valor por conversa é sempre um mínimo, nunca o custo exato.

BEGIN;

-- portal_log_ai_usage: agora recebe já o input/output reais (a assinatura
-- não muda — os dois parâmetros já existiam) e grava o custo exato daquele
-- evento, nunca 0. amount_usd é SEMPRE derivado de unit_cost_usd*quantity
-- com o mesmo round() do CHECK da 0009 (cost_events_amount_reconciliation_check),
-- por isso nunca viola a constraint.
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
  v_price_in numeric(20,10);
  v_price_out numeric(20,10);
  v_unit_cost numeric(20,10);
  v_amount numeric(20,8);
  v_rate_card_ref text;
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

  if p_service like 'portal.knowledge%' then
    -- Embeddings (text-embedding-3-small): só entrada tem custo.
    v_price_in := 0.02 / 1000000;
    v_price_out := 0;
    v_rate_card_ref := 'openrouter.embedding.3-small';
  else
    -- Chat (portal.agent_preview e futuros serviços de texto): Haiku 4.5.
    v_price_in := 1.00 / 1000000;
    v_price_out := 5.00 / 1000000;
    v_rate_card_ref := 'openrouter.chat.haiku-4.5';
  end if;

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
    v_tenant, p_id, null, 'openrouter', p_service, 'token', v_total,
    v_unit_cost, v_amount, 'estimated', now(), v_rate_card_ref, '2026-07-22T00:00:00Z'
  );

  return jsonb_build_object('ok', true, 'total_tokens', v_total, 'amount_usd', v_amount);
end;
$$;

revoke all on function public.portal_log_ai_usage from public, anon;
grant execute on function public.portal_log_ai_usage to authenticated;

-- portal_log_video_usage: a duração real da chamada não é capturada hoje
-- (a conversa é registrada na criação, antes de saber quanto vai durar), e
-- Tavus cobra por minuto — cravar um valor "exato" aqui seria inventar um
-- dado. Mantém quantity=1/unit_cost=0/amount=0 no EVENTO; o piso estimado
-- por conversa entra só na leitura (portal_usage_summary), claramente
-- rotulado como mínimo. Corrige source de 'measured' (afirmava saber o
-- custo real) para 'estimated' (honesto: é 0 porque não medimos, não
-- porque o custo é zero) — nada mais depende do valor 'measured' aqui.
create or replace function public.portal_log_video_usage(
  p_id app.uuid_v7
) returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_tenant app.uuid_v7;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  select tenant_id into v_tenant
  from public.user_tenant_memberships where user_id = auth.uid();
  if v_tenant is null then
    raise exception 'no tenant provisioned' using errcode = '42501';
  end if;

  insert into public.cost_events (
    tenant_id, id, provider_id, service, unit_type, quantity,
    unit_cost_usd, amount_usd, source, occurred_at
  ) values (
    v_tenant, p_id, 'tavus', 'portal.video_conversation', 'conversation', 1,
    0, 0, 'estimated', now()
  );

  return jsonb_build_object('ok', true, 'id', p_id);
end;
$$;

revoke all on function public.portal_log_video_usage from public, anon;
grant execute on function public.portal_log_video_usage to authenticated;

-- portal_usage_summary: soma amount_usd real (AI, exato) + piso estimado de
-- vídeo (conversas × USD 0,175/conversa, o mínimo de cobrança do Tavus) —
-- os dois FICAM SEPARADOS na resposta para a UI nunca somar um número exato
-- com um piso e apresentar como se fosse tudo preciso.
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
  v_ai_cost_usd_today numeric(20,8);
  v_video_cost_floor_usd_today numeric(20,8);
  v_ai_cost_usd_7d numeric(20,8);
  v_video_cost_floor_usd_7d numeric(20,8);
  v_conversations_7d bigint;
  v_services jsonb;
  v_video_floor_per_conversation constant numeric(20,10) := 0.175;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  select tenant_id into v_tenant
  from public.user_tenant_memberships where user_id = auth.uid();
  if v_tenant is null then
    raise exception 'no tenant provisioned' using errcode = '42501';
  end if;

  select coalesce(sum(quantity), 0)::bigint, coalesce(sum(amount_usd), 0)
  into v_tokens_today, v_ai_cost_usd_today
  from public.cost_events
  where tenant_id = v_tenant
    and unit_type = 'token'
    and occurred_at >= date_trunc('day', now());

  select count(*) into v_conversations_today
  from public.cost_events
  where tenant_id = v_tenant
    and unit_type = 'conversation'
    and occurred_at >= date_trunc('day', now());
  v_video_cost_floor_usd_today := v_conversations_today * v_video_floor_per_conversation;

  select coalesce(sum(amount_usd), 0) into v_ai_cost_usd_7d
  from public.cost_events
  where tenant_id = v_tenant
    and unit_type = 'token'
    and occurred_at >= now() - interval '7 days';

  select count(*) into v_conversations_7d
  from public.cost_events
  where tenant_id = v_tenant
    and unit_type = 'conversation'
    and occurred_at >= now() - interval '7 days';
  v_video_cost_floor_usd_7d := v_conversations_7d * v_video_floor_per_conversation;

  select coalesce(jsonb_agg(jsonb_build_object(
    'service', grouped.service,
    'unit_type', grouped.unit_type,
    'quantity', grouped.quantity,
    'amount_usd', grouped.amount_usd
  ) order by grouped.quantity desc), '[]'::jsonb)
  into v_services
  from (
    select service, unit_type, sum(quantity)::bigint as quantity, sum(amount_usd) as amount_usd
    from public.cost_events
    where tenant_id = v_tenant
      and occurred_at >= now() - interval '7 days'
    group by service, unit_type
  ) as grouped;

  return jsonb_build_object(
    'tokens_today', v_tokens_today,
    'conversations_today', v_conversations_today,
    'ai_cost_usd_today', v_ai_cost_usd_today,
    'video_cost_floor_usd_today', v_video_cost_floor_usd_today,
    'ai_cost_usd_7d', v_ai_cost_usd_7d,
    'video_cost_floor_usd_7d', v_video_cost_floor_usd_7d,
    'cost_estimate_note', 'estimativa via preço público de tabela (2026-07-22); vídeo é PISO mínimo por conversa, duração real não medida',
    'services_7d', v_services
  );
end;
$$;

revoke all on function public.portal_usage_summary from public, anon;
grant execute on function public.portal_usage_summary to authenticated;

COMMIT;
