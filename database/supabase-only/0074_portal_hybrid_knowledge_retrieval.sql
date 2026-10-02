-- IMP-02: exact pgvector + multilingual simple FTS, tenant scoped and bounded.
-- Existing vector-only RPCs remain historical compatibility surfaces.
-- Null historical validity endpoints are explicitly unbounded. This Portal
-- schema has no canonical role/product visibility columns: no such claim.
BEGIN;

CREATE INDEX knowledge_chunks_simple_fts ON public.knowledge_chunks
  USING gin (to_tsvector('simple'::regconfig, content_text));

create or replace function public.portal_search_knowledge_hybrid_service(
  p_tenant_id app.uuid_v7, p_query_text text, p_embedding jsonb default null,
  p_limit integer default 6
) returns jsonb language plpgsql stable security definer
set search_path = public, pg_temp as $$
declare v_query vector; v_lex tsquery; v_results jsonb; v_candidates integer; v_norm numeric; v_relaxed tsquery; v_token text;
begin
  if not exists(select 1 from public.tenants where id=p_tenant_id) then
    raise exception 'unknown tenant' using errcode='42501';
  end if;
  if p_query_text is null or length(btrim(p_query_text))=0 or octet_length(p_query_text)>2000
    or p_limit is null or p_limit not between 1 and 12 then
    raise exception 'invalid hybrid query bounds' using errcode='22023';
  end if;
  if p_embedding is not null and p_embedding <> 'null'::jsonb then
    if jsonb_typeof(p_embedding) is distinct from 'array' then
      raise exception 'embedding must be a 1536-dim numeric array' using errcode='22023';
    end if;
    if jsonb_array_length(p_embedding)<>1536 then
      raise exception 'embedding must be a 1536-dim numeric array' using errcode='22023';
    end if;
    if exists(select 1 from jsonb_array_elements(p_embedding) x where jsonb_typeof(x)<>'number') then
      raise exception 'embedding components must be finite numbers' using errcode='22023';
    end if;
    if exists(select 1 from jsonb_array_elements(p_embedding) x where abs(x::text::numeric)>3.402823466e38) then
      raise exception 'embedding components exceed finite float bounds' using errcode='22023';
    end if;
    -- Normalize in numeric arithmetic BEFORE conversion to float4. Finite
    -- 1e30 inputs overflow pgvector's raw cosine accumulation in v0.8.5.
    select sqrt(sum(power(x::text::numeric,2))) into v_norm from jsonb_array_elements(p_embedding) x;
    if v_norm=0 then
      raise exception 'embedding must be nonzero' using errcode='22023';
    end if;
    select array_agg((x::text::numeric/v_norm)::real order by ord)::vector into v_query
      from jsonb_array_elements(p_embedding) with ordinality q(x,ord);
  end if;
  v_lex:=websearch_to_tsquery('simple'::regconfig,p_query_text);
  v_relaxed:=''::tsquery;
  -- Bounded, parser-derived lexemes; never interpolate query text as SQL or
  -- tsquery operators. Natural PT/EN/ES questions need not repeat every word
  -- in a catalog chunk. Preserve strict conjunction when it has a match.
  for v_token in select token from unnest(tsvector_to_array(to_tsvector('simple'::regconfig,p_query_text))) token
    where token<>all(array['quanto','cuanto','cuánto','custa','cuesta','qual','cual','cuál','how','much','what','is','the','a','o','de','do','da','el','la','e','and','no','preço','precio','price','cost'])
    order by token limit 24
  loop
    v_relaxed:=v_relaxed || plainto_tsquery('simple'::regconfig,v_token);
  end loop;
  v_candidates:=least(p_limit*4,48);
  with eligible as not materialized (
    select s.id source_id,v.id version_id,ch.id chunk_id,ch.chunk_index,
      v.content_hash,s.display_name source_name,ch.content_text chunk_text,
      to_tsvector('simple'::regconfig,ch.content_text) document
    from public.knowledge_chunks ch
    join public.knowledge_versions v on v.tenant_id=ch.tenant_id and v.id=ch.version_id
    join public.knowledge_sources s on s.tenant_id=v.tenant_id and s.id=v.source_id
    where ch.tenant_id=p_tenant_id and s.status='active'
      -- Opaque policies cannot be interpreted as an unrestricted grant.
      and s.access_policy='{}'::jsonb
      and (v.valid_from is null or v.valid_from<=now())
      and (v.valid_to is null or now()<v.valid_to)
      and length(s.display_name) between 1 and 300
      and length(ch.content_text) between 1 and 20000
  ), query_choice as materialized (
    select case when exists(select 1 from eligible where document @@ v_lex) then v_lex else v_relaxed end query
  ), lexical as (
    select chunk_id,row_number() over(order by ts_rank_cd(document,choice.query) desc,chunk_id) rank
    from eligible cross join query_choice choice where document @@ choice.query
    order by ts_rank_cd(document,choice.query) desc,chunk_id limit v_candidates
  ), vector_scores as materialized (
    select el.chunk_id, 1-(normal.embedding <=> v_query) similarity
    from eligible el join public.knowledge_embeddings e
      on e.tenant_id=p_tenant_id and e.chunk_id=el.chunk_id
    cross join lateral (
      select sqrt(sum(power(component::float8,2))) norm
      from unnest(e.embedding::real[]) component
    ) magnitude
    cross join lateral (
      select array_agg((component::float8/nullif(magnitude.norm,0))::real order by ord)::vector embedding
      from unnest(e.embedding::real[]) with ordinality q(component,ord)
    ) normal
    where v_query is not null and e.embedding_model='openai/text-embedding-3-small'
      and e.embedding_dimensions=1536 and vector_dims(e.embedding)=1536
      and magnitude.norm>0

  ), semantic as (
    select chunk_id,similarity,row_number() over(order by similarity desc,chunk_id) rank
    from vector_scores where similarity>=0.25 and similarity<=1
    order by similarity desc,chunk_id limit v_candidates
  ), fused as (
    select el.*,se.similarity,
      coalesce(1.0/(60+lx.rank),0)+coalesce(1.0/(60+se.rank),0) score,
      case when lx.rank is not null and se.rank is not null then 'hybrid'
        when lx.rank is not null then 'lexical' else 'vector' end match_kind
    from eligible el left join lexical lx using(chunk_id) left join semantic se using(chunk_id)
    where lx.rank is not null or se.rank is not null
    order by score desc,el.chunk_id limit p_limit
  ) select coalesce(jsonb_agg(jsonb_build_object(
    'source_id',source_id,'version_id',version_id,'chunk_id',chunk_id,'chunk_index',chunk_index,
    'content_hash',content_hash,'source_name',source_name,'chunk_text',chunk_text,
    'score',score,'similarity',similarity,'match_kind',match_kind,'trusted',false
  ) order by score desc,chunk_id),'[]'::jsonb) into v_results from fused;
  return jsonb_build_object('schema_version','2.0.0','tenant_id',p_tenant_id,'matches',v_results);
end; $$;
revoke all on function public.portal_search_knowledge_hybrid_service(app.uuid_v7,text,jsonb,integer) from public,anon,authenticated,service_role;
grant execute on function public.portal_search_knowledge_hybrid_service(app.uuid_v7,text,jsonb,integer) to service_role;

create or replace function public.portal_search_knowledge_hybrid(
  p_query_text text,p_embedding jsonb default null,p_limit integer default 6
) returns jsonb language plpgsql stable security definer
set search_path=public,pg_temp as $$
declare v_tenant app.uuid_v7;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode='28000'; end if;
  select tenant_id into v_tenant from public.user_tenant_memberships where user_id=auth.uid();
  if v_tenant is null then raise exception 'no tenant provisioned' using errcode='42501'; end if;
  return public.portal_search_knowledge_hybrid_service(v_tenant,p_query_text,p_embedding,p_limit);
end; $$;
revoke all on function public.portal_search_knowledge_hybrid(text,jsonb,integer) from public,anon,authenticated,service_role;
grant execute on function public.portal_search_knowledge_hybrid(text,jsonb,integer) to authenticated;

-- Forward-only replacement of the current v67 reservation body. Preserve
-- financial receipts and committed replay, including after source revocation.
create or replace function public.portal_begin_ai_usage_reservation_service(
  p_id app.uuid_v7,p_cost_event_id app.uuid_v7,p_tenant_id app.uuid_v7,p_agent_id app.uuid_v7,p_source_id app.uuid_v7,
  p_idempotency_key text,p_operation text,p_max_input_tokens integer,p_max_output_tokens integer,p_max_cost_usd numeric
) returns jsonb language plpgsql security definer set search_path='public' as $$
declare v_existing public.ai_usage_reservations%rowtype; v_tokens bigint; v_ingestions bigint; v_ref text; v_source_status text;
begin
  if p_idempotency_key !~ '^[a-z0-9][a-z0-9:._/-]{7,199}$' or not (
    (p_operation='chat_generation' and p_max_input_tokens=20000 and p_max_output_tokens=512 and p_max_cost_usd=0.05)
    or (p_operation='brain_generation' and p_max_input_tokens=20000 and p_max_output_tokens=512 and p_max_cost_usd=0.05)
    or (p_operation='knowledge_query_embedding' and p_max_input_tokens=1000 and p_max_output_tokens=0 and p_max_cost_usd=0.001)
    or (p_operation='knowledge_ingestion_embedding' and p_max_input_tokens=20000 and p_max_output_tokens=0 and p_max_cost_usd=0.01)
  ) then raise exception 'AI reservation envelope does not match operation contract' using errcode='22023'; end if;
  if p_agent_id is not null and not exists(select 1 from public.agents where tenant_id=p_tenant_id and id=p_agent_id) then raise exception 'agent not found for tenant' using errcode='42501'; end if;
  if p_operation in ('chat_generation','brain_generation') and p_agent_id is null then raise exception 'agent is required' using errcode='22023'; end if;
  if p_operation='knowledge_ingestion_embedding' and p_source_id is null then raise exception 'source is required' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text,0));
  select * into v_existing from public.ai_usage_reservations where tenant_id=p_tenant_id and idempotency_key=p_idempotency_key for update;
  if found then
    if v_existing.agent_id is distinct from p_agent_id or v_existing.source_id is distinct from p_source_id or v_existing.operation is distinct from p_operation
      or v_existing.max_input_tokens is distinct from p_max_input_tokens or v_existing.max_output_tokens is distinct from p_max_output_tokens or v_existing.max_cost_usd is distinct from p_max_cost_usd then raise exception 'AI reservation replay conflict' using errcode='23505'; end if;
    if v_existing.state='reserved' and p_source_id is not null then
      select status into v_source_status from public.knowledge_sources where tenant_id=p_tenant_id and id=p_source_id for update;
      if not found or v_source_status not in ('pending','active','stale') then
        perform public.portal_release_ai_usage_service(v_existing.id,'not_dispatched');
        return jsonb_build_object('outcome','unavailable','state','released');
      end if;
    end if;
    return jsonb_build_object('outcome',case when v_existing.state in ('provider_in_flight','unknown') then 'blocked_unknown' else 'replayed' end,'reservationId',v_existing.id,'state',v_existing.state,'providerRequestRef',v_existing.provider_request_ref);
  end if;
  if p_source_id is not null then
    select status into v_source_status from public.knowledge_sources where tenant_id=p_tenant_id and id=p_source_id for update;
    if not found then raise exception 'source not found for tenant' using errcode='42501'; end if;
    if v_source_status not in ('pending','active','stale') then
      return jsonb_build_object('outcome','unavailable','reason','source_unavailable');
    end if;
  end if;
  -- Uma resposta ambigua fecha TODO o budget de IA do tenant. Contar apenas
  -- o envelope ate o fim do dia permitiria novo gasto no dia seguinte sem
  -- evidencia de que a chamada anterior nao foi faturada.
  -- v73 deliberately makes the historical sweep a no-op. An elapsed
  -- deadline is never a provider invoice or evidence authorizing a release.
  perform public.portal_sweep_stale_ai_usage_unknown_service(p_tenant_id);
  if exists(select 1 from public.ai_usage_reservations where tenant_id=p_tenant_id and state in ('provider_in_flight','unknown')) then
    return jsonb_build_object('outcome','blocked_unknown','bucket','ai_unknown_outcome');
  end if;
  select coalesce(sum(quantity),0)::bigint into v_tokens from public.cost_events c where c.tenant_id=p_tenant_id and c.unit_type='token' and c.occurred_at>=date_trunc('day',now(),'UTC')
    and not exists(select 1 from public.ai_usage_reservations r where r.tenant_id=c.tenant_id and r.cost_event_id=c.id);
  -- Reserved rows consume their envelope in the creation bucket. Committed
  -- rows consume the linked ledger quantity in the occurred_at bucket, so a
  -- dispatch before midnight and commit after midnight cannot disappear from
  -- either day. Ambiguous rows are already blocked tenant-wide above.
  select v_tokens+coalesce(sum(case
    when r.state='committed' then c.quantity
    else r.max_input_tokens+r.max_output_tokens
  end),0)::bigint into v_tokens
  from public.ai_usage_reservations r
  left join public.cost_events c on c.tenant_id=r.tenant_id and c.id=r.cost_event_id
  where r.tenant_id=p_tenant_id and r.state<>'released'
    and (
      (r.state='reserved' and r.created_at>=date_trunc('day',now(),'UTC'))
      or (r.state='committed' and c.occurred_at>=date_trunc('day',now(),'UTC'))
      or r.state in ('provider_in_flight','unknown')
    );
  if v_tokens+p_max_input_tokens+p_max_output_tokens>500000 then return jsonb_build_object('outcome','capped','bucket','ai_tokens_daily','usage',v_tokens,'cap',500000); end if;
  if p_operation='knowledge_ingestion_embedding' then
    select count(*) into v_ingestions from public.ai_usage_reservations where tenant_id=p_tenant_id and operation='knowledge_ingestion_embedding' and created_at>=date_trunc('day',now(),'UTC') and state<>'released';
    if v_ingestions>=30 then return jsonb_build_object('outcome','capped','bucket','knowledge_ingestions_daily','usage',v_ingestions,'cap',30); end if;
  end if;
  v_ref:='ppr_'||replace(p_id::text,'-','');
  insert into public.ai_usage_reservations(id,cost_event_id,tenant_id,agent_id,source_id,idempotency_key,operation,max_input_tokens,max_output_tokens,max_cost_usd,provider_request_ref)
    values(p_id,p_cost_event_id,p_tenant_id,p_agent_id,p_source_id,p_idempotency_key,p_operation,p_max_input_tokens,p_max_output_tokens,p_max_cost_usd,v_ref);
  return jsonb_build_object('outcome','reserved','reservationId',p_id,'state','reserved','providerRequestRef',v_ref);
end; $$;

-- Tenant lock precedes reservation and source row locks. Service admission
-- has no human actor; human membership revocation is NOT solved by this fence.
create or replace function public.portal_mark_ai_usage_in_flight_service(p_id app.uuid_v7)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.ai_usage_reservations%rowtype; v_tenant app.uuid_v7; v_source_status text; v_acquired boolean;
begin
  select tenant_id into v_tenant from public.ai_usage_reservations where id=p_id;
  if not found then raise exception 'reservation not found' using errcode='P0002'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_tenant::text,0));
  select * into v from public.ai_usage_reservations where id=p_id for update;
  if v.state='reserved' and v.source_id is not null then
    select status into v_source_status from public.knowledge_sources
      where tenant_id=v.tenant_id and id=v.source_id for update;
    if not found or v_source_status not in ('pending','active','stale') then
      perform public.portal_release_ai_usage_service(v.id,'not_dispatched');
      return jsonb_build_object('acquired',false,'state','released');
    end if;
  end if;
  update public.ai_usage_reservations r set state='provider_in_flight',provider_dispatched_at=now(),updated_at=now()
  where r.id=p_id and r.state='reserved' and r.created_at>=now()-interval '10 minutes'
    and not exists(select 1 from public.ai_usage_reservations u where u.tenant_id=r.tenant_id and u.id<>r.id and u.state in ('provider_in_flight','unknown'));
  v_acquired:=found;
  select state into v.state from public.ai_usage_reservations where id=p_id;
  return jsonb_build_object('acquired',v_acquired,'state',v.state);
end; $$;
revoke all on function public.portal_begin_ai_usage_reservation_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,integer,integer,numeric) from public,anon,authenticated,service_role;
grant execute on function public.portal_begin_ai_usage_reservation_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,integer,integer,numeric) to service_role;
revoke all on function public.portal_mark_ai_usage_in_flight_service(app.uuid_v7) from public,anon,authenticated,service_role;
grant execute on function public.portal_mark_ai_usage_in_flight_service(app.uuid_v7) to service_role;

-- Keep legacy signatures and array shape, but close every callable read path.
-- An empty tsquery selects only the vector lane; safe normalization is shared.
create or replace function public.portal_search_knowledge_service(
  p_tenant_id app.uuid_v7,p_embedding jsonb,p_limit integer default 6
) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_result jsonb;
begin
  if p_embedding is null or p_embedding='null'::jsonb then
    raise exception 'embedding required' using errcode='22023';
  end if;
  v_result:=public.portal_search_knowledge_hybrid_service(p_tenant_id,'()',p_embedding,p_limit);
  return (select coalesce(jsonb_agg(jsonb_build_object('source_name',item->'source_name',
    'chunk_text',item->'chunk_text','similarity',item->'similarity') order by ord),'[]'::jsonb)
    from jsonb_array_elements(v_result->'matches') with ordinality q(item,ord));
end; $$;
revoke all on function public.portal_search_knowledge_service(app.uuid_v7,jsonb,integer) from public,anon,authenticated,service_role;
grant execute on function public.portal_search_knowledge_service(app.uuid_v7,jsonb,integer) to service_role;
create or replace function public.portal_search_knowledge(p_embedding jsonb,p_limit integer default 6)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_tenant app.uuid_v7;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode='28000'; end if;
  select tenant_id into v_tenant from public.user_tenant_memberships where user_id=auth.uid();
  if v_tenant is null then raise exception 'no tenant provisioned' using errcode='42501'; end if;
  return public.portal_search_knowledge_service(v_tenant,p_embedding,p_limit);
end; $$;
revoke all on function public.portal_search_knowledge(jsonb,integer) from public,anon,authenticated,service_role;
grant execute on function public.portal_search_knowledge(jsonb,integer) to authenticated;

-- Preserve v62 digest truncation and output contract, applying the same
-- eligibility filters to sources and versions before any content is read.
create or replace function public.portal_knowledge_digest(
  p_max_chars integer default 3500
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant app.uuid_v7;
  v_content text := '';
  v_sources jsonb := '[]'::jsonb;
  v_source_count integer;
  v_source_budget integer;
  v_source_content text;
  v_piece text;
  v_room integer;
  v_slice text;
  v_cut text;
  r_source record;
  r_chunk record;
  -- Marcador de continuação, contado DENTRO do orçamento.
  c_ellipsis constant text := ' [...]';
  -- Abaixo disto um prefixo vira confete e não ajuda o modelo: melhor não
  -- cortar do que entregar meia frase solta.
  c_min_slice constant integer := 160;
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
  where s.tenant_id = v_tenant and s.status = 'active' and s.access_policy='{}'::jsonb
      and exists(select 1 from public.knowledge_versions eligible where eligible.tenant_id=s.tenant_id and eligible.source_id=s.id
        and (eligible.valid_from is null or eligible.valid_from<=now())
        and (eligible.valid_to is null or now()<eligible.valid_to));
  if v_source_count = 0 then
    return jsonb_build_object('content', null, 'sources', '[]'::jsonb);
  end if;

  -- Orçamento por fonte: divide o teto entre as fontes, com piso de 600
  -- chars. Com muitas fontes entram só as ~(teto/600) mais recentes, cada
  -- uma com conteúdo suficiente pra ser utilizável (não confete).
  v_source_budget := greatest(600, p_max_chars / v_source_count);

  for r_source in
    select s.id, s.display_name
    from public.knowledge_sources s
    where s.tenant_id = v_tenant and s.status = 'active' and s.access_policy='{}'::jsonb
      and exists(select 1 from public.knowledge_versions eligible where eligible.tenant_id=s.tenant_id and eligible.source_id=s.id
        and (eligible.valid_from is null or eligible.valid_from<=now())
        and (eligible.valid_to is null or now()<eligible.valid_to))
    order by s.created_at desc, s.id desc
  loop
    v_source_content := '';
    for r_chunk in
      select ch.content_text
      from public.knowledge_chunks ch
      join public.knowledge_versions v on v.tenant_id = ch.tenant_id and v.id = ch.version_id
      where ch.tenant_id = v_tenant and v.source_id = r_source.id
        and (v.valid_from is null or v.valid_from<=now())
        and (v.valid_to is null or now()<v.valid_to)
      order by ch.chunk_index
    loop
      -- O +1 reserva o \n que separa este chunk do anterior.
      v_room := v_source_budget - char_length(v_source_content) - 1;
      if char_length(r_chunk.content_text) <= v_room then
        v_source_content := v_source_content || E'\n' || r_chunk.content_text;
        continue;
      end if;

      -- Não cabe inteiro. Antes daqui saía sem acumular nada e a fonte era
      -- descartada; agora entra o maior prefixo legível que couber.
      v_room := v_room - char_length(c_ellipsis);
      exit when v_room < c_min_slice;

      v_slice := left(r_chunk.content_text, v_room);
      -- 1) até o fim da última frase completa do prefixo. O \s depois do
      -- terminador é obrigatório de propósito: sem ele, "R$ 18.900" casaria
      -- no ponto decimal e o corte entregaria "custa R$ 18." como se fosse o
      -- preço. Preço cortado no meio é pior que texto faltando.
      v_cut := rtrim(substring(v_slice from '^.*[.!?]\s'));
      -- 2) senão, até a última fronteira de palavra.
      if v_cut is null or char_length(v_cut) < c_min_slice then
        v_cut := regexp_replace(v_slice, '\s+\S*$', '');
      end if;
      -- 3) senão, corte seco (chunk sem espaço nenhum no trecho).
      if v_cut is null or char_length(v_cut) < c_min_slice then
        v_cut := v_slice;
      end if;

      v_source_content := v_source_content || E'\n' || v_cut || c_ellipsis;
      exit;
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

revoke all on function public.portal_knowledge_digest(integer) from public, anon;
grant execute on function public.portal_knowledge_digest(integer) to authenticated;


COMMIT;
