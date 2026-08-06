-- Fecho do backlog da auditoria 2026-08-02 que dependia de SQL (W4):
--
-- 1) portal_knowledge_digest: a versão de 0010 percorria `order by
--    s.created_at, s.id, chunk_index` e parava no teto — com 2+ fontes o
--    digest inteiro era o COMEÇO da fonte mais ANTIGA, e o prompt de vídeo
--    trata esse recorte como "sua única fonte de fatos": a closer ficava
--    proibida de citar preço/condição que vive em qualquer outra fonte.
--    Agora: orçamento dividido por fonte (mínimo 600 chars pra não virar
--    confete com muitas fontes), fontes mais RECENTES primeiro.
--
-- 2) portal_log_ai_usage: ganha p_reported_cost_usd opcional — quando o
--    OpenRouter reporta o custo faturado real (usage.cost, pedido via
--    usage.include no adapter), o evento vira source='provider_reported'
--    com o valor exato, em vez de estimativa por tabela do Haiku. Isso
--    também neutraliza o achado "rate card cravado no Haiku com
--    OPENROUTER_MODEL configurável": com custo reportado, o preço do
--    modelo real é o que entra no ledger. Sem o parâmetro, comportamento
--    idêntico ao de 0017.
--
-- 3) portal_record_meeting_bot_session: reunião externa agora deixa
--    TAMBÉM um cost_event do bot ('recall', flat, source estimated, custo
--    0 no evento — mesma convenção da conversa Tavus: precificação na
--    leitura; rate_card_ref pronto pro summary precificar depois). Antes,
--    o provider mais caro por sessão não existia no ledger.

BEGIN;

create or replace function public.portal_knowledge_digest(
  p_max_chars integer default 3500
) returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_tenant app.uuid_v7;
  v_content text := '';
  v_sources jsonb := '[]'::jsonb;
  v_source_count integer;
  v_source_budget integer;
  v_source_content text;
  v_piece text;
  r_source record;
  r_chunk record;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  select tenant_id into v_tenant
  from public.user_tenant_memberships where user_id = auth.uid();
  if v_tenant is null then
    raise exception 'no tenant provisioned' using errcode = '42501';
  end if;
  if p_max_chars is null or p_max_chars < 200 or p_max_chars > 6000 then
    raise exception 'max_chars must be 200..6000' using errcode = '22023';
  end if;

  select count(*) into v_source_count
  from public.knowledge_sources s
  where s.tenant_id = v_tenant and s.status = 'active';
  if v_source_count = 0 then
    return jsonb_build_object('content', null, 'sources', '[]'::jsonb);
  end if;

  -- Orçamento por fonte: divide o teto entre as fontes, com piso de 600
  -- chars — com muitas fontes entram só as ~(teto/600) mais recentes, cada
  -- uma com conteúdo suficiente pra ser utilizável (não confete).
  v_source_budget := greatest(600, p_max_chars / v_source_count);

  for r_source in
    select s.id, s.display_name
    from public.knowledge_sources s
    where s.tenant_id = v_tenant and s.status = 'active'
    order by s.created_at desc, s.id desc
  loop
    v_source_content := '';
    for r_chunk in
      select ch.content_text
      from public.knowledge_chunks ch
      join public.knowledge_versions v on v.tenant_id = ch.tenant_id and v.id = ch.version_id
      where ch.tenant_id = v_tenant and v.source_id = r_source.id
      order by ch.chunk_index
    loop
      exit when char_length(v_source_content) + char_length(r_chunk.content_text) + 1 > v_source_budget;
      v_source_content := v_source_content || E'\n' || r_chunk.content_text;
    end loop;

    continue when v_source_content = '';
    v_piece := E'\n\n### Fonte: ' || r_source.display_name || v_source_content;
    exit when char_length(v_content) + char_length(v_piece) > p_max_chars;
    v_content := v_content || v_piece;
    v_sources := v_sources || to_jsonb(r_source.display_name);
  end loop;

  if v_content = '' then
    return jsonb_build_object('content', null, 'sources', '[]'::jsonb);
  end if;
  return jsonb_build_object('content', ltrim(v_content, E'\n'), 'sources', v_sources);
end;
$$;

-- DROP da assinatura antiga (4 params) antes de criar a nova: `create or
-- replace` com lista de parâmetros diferente cria um OVERLOAD, o revoke
-- vira ambíguo e chamadas RPC nomeadas com 4 params casariam com as duas
-- versões (o param novo tem default).
drop function if exists public.portal_log_ai_usage(app.uuid_v7, text, integer, integer);

create function public.portal_log_ai_usage(
  p_id app.uuid_v7,
  p_service text,
  p_input_tokens integer,
  p_output_tokens integer,
  p_reported_cost_usd numeric default null
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
  v_source text := 'estimated';
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

  if p_reported_cost_usd is not null then
    -- Custo faturado reportado pelo próprio provider (usage.cost do
    -- OpenRouter): fonte mais forte que estimativa de tabela. Teto de
    -- sanidade: uma única chamada de chat nunca custa USD 10 — valor acima
    -- disso é bug do caller, não fato.
    if p_reported_cost_usd < 0 or p_reported_cost_usd > 10 then
      raise exception 'reported cost out of range' using errcode = '22023';
    end if;
    v_source := 'provider_reported';
    v_amount := round(p_reported_cost_usd, 8);
    v_unit_cost := case when v_total = 0 then 0 else round(p_reported_cost_usd / v_total, 10) end;
    v_rate_card_ref := 'openrouter.usage.reported';
  elsif p_service like 'portal.knowledge%' then
    v_price_in := 0.02 / 1000000;
    v_price_out := 0;
    v_rate_card_ref := 'openrouter.embedding.3-small';
    if v_total = 0 then
      v_unit_cost := 0; v_amount := 0;
    else
      v_unit_cost := round((p_input_tokens * v_price_in + p_output_tokens * v_price_out) / v_total, 10);
      v_amount := round(v_total * v_unit_cost, 8);
    end if;
  else
    v_price_in := 1.00 / 1000000;
    v_price_out := 5.00 / 1000000;
    v_rate_card_ref := 'openrouter.chat.haiku-4.5';
    if v_total = 0 then
      v_unit_cost := 0; v_amount := 0;
    else
      v_unit_cost := round((p_input_tokens * v_price_in + p_output_tokens * v_price_out) / v_total, 10);
      v_amount := round(v_total * v_unit_cost, 8);
    end if;
  end if;

  insert into public.cost_events (
    tenant_id, id, session_id, provider_id, service, unit_type, quantity,
    unit_cost_usd, amount_usd, source, occurred_at, rate_card_ref, rate_card_as_of
  )
  values (
    v_tenant, p_id, null, 'openrouter', p_service, 'token', v_total,
    v_unit_cost, v_amount, v_source, now(), v_rate_card_ref, '2026-08-05T00:00:00Z'
  );

  return jsonb_build_object('ok', true, 'total_tokens', v_total, 'amount_usd', v_amount, 'source', v_source);
end;
$$;

revoke all on function public.portal_log_ai_usage from public, anon;
grant execute on function public.portal_log_ai_usage to authenticated;

-- DROP antes de recriar com parâmetro novo: `create or replace` com lista
-- de parâmetros diferente cria um OVERLOAD, e a chamada RPC por parâmetros
-- nomeados ficaria ambígua entre as duas versões (o parâmetro novo tem
-- default). Só uma versão pode existir.
drop function if exists public.portal_record_meeting_bot_session(app.uuid_v7, app.uuid_v7, text, text, text);

create function public.portal_record_meeting_bot_session(
  p_id app.uuid_v7,
  p_agent_id app.uuid_v7,
  p_recall_bot_id text,
  p_meeting_url text,
  p_tavus_conversation_id text,
  -- id do cost_event do bot, gerado pela APLICAÇÃO (app.uuid_v7 é domain,
  -- não função — D-V2-010: UUID nasce no app). null = não registra custo
  -- (compat com caller antigo durante a janela de deploy).
  p_cost_event_id app.uuid_v7 default null
) returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_tenant app.uuid_v7;
  v_agent_exists boolean;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  select tenant_id into v_tenant from public.user_tenant_memberships where user_id = auth.uid();
  if v_tenant is null then
    raise exception 'no tenant provisioned' using errcode = '42501';
  end if;
  if p_recall_bot_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'recall_bot_id must be a plain UUID' using errcode = '22023';
  end if;
  if p_meeting_url !~ '^https://' then
    raise exception 'meeting_url must be https' using errcode = '22023';
  end if;

  select exists(select 1 from public.agents where tenant_id = v_tenant and id = p_agent_id) into v_agent_exists;
  if not v_agent_exists then
    raise exception 'agent not found for this account' using errcode = '42501';
  end if;

  insert into public.meeting_bot_sessions (id, tenant_id, agent_id, recall_bot_id, meeting_url, tavus_conversation_id, status)
  values (p_id, v_tenant, p_agent_id, p_recall_bot_id, p_meeting_url, p_tavus_conversation_id, 'created');

  -- Rastro de custo do bot (o provider mais caro por sessão): mesma
  -- convenção da conversa Tavus — evento com custo 0 e source 'estimated'
  -- (duração real não medida na criação), precificação na leitura via
  -- rate_card_ref.
  if p_cost_event_id is not null then
    insert into public.cost_events (
      tenant_id, id, provider_id, service, unit_type, quantity,
      unit_cost_usd, amount_usd, source, occurred_at, rate_card_ref, rate_card_as_of
    )
    values (
      v_tenant, p_cost_event_id, 'recall', 'portal.meeting_bot_session', 'flat', 1,
      0, 0, 'estimated', now(), 'recall.bot.web_4_core', '2026-08-05T00:00:00Z'
    );
  end if;

  return jsonb_build_object('ok', true, 'id', p_id);
end;
$$;

revoke all on function public.portal_record_meeting_bot_session from public, anon;
grant execute on function public.portal_record_meeting_bot_session to authenticated;

COMMIT;
