-- Conhecimento REAL: ingestão de chunks + embeddings e busca vetorial (RAG).
-- Embeddings gerados no portal via OpenRouter (`openai/text-embedding-3-small`,
-- 1536 dims) — o banco só recebe vetores prontos; nenhuma chave entra aqui.
-- Escrita restrita a tenant_admin; leitura para qualquer membro do tenant.
-- search_path = 'public' (não ''): os operadores do pgvector vivem em public
-- neste projeto, e é o mesmo requisito do trigger de reconciliação (0008).
-- Re-ingestão substitui a versão anterior da fonte (delete cascade): a busca
-- nunca mistura versões velhas e novas do mesmo documento.

BEGIN;

create or replace function public.portal_ingest_knowledge(
  p_source_id app.uuid_v7,
  p_version_id app.uuid_v7,
  p_version text,
  p_content_hash text,
  p_chunks jsonb
) returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_tenant app.uuid_v7;
  v_role text;
  v_status text;
  v_count integer;
  v_chunk jsonb;
  v_text text;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  select tenant_id, role into v_tenant, v_role
  from public.user_tenant_memberships where user_id = auth.uid();
  if v_tenant is null then
    raise exception 'no tenant provisioned' using errcode = '42501';
  end if;
  if v_role <> 'tenant_admin' then
    raise exception 'only a tenant_admin can ingest knowledge' using errcode = '42501';
  end if;

  select status into v_status
  from public.knowledge_sources
  where tenant_id = v_tenant and id = p_source_id;
  if v_status is null then
    raise exception 'knowledge source not found for this account' using errcode = '42501';
  end if;
  if v_status in ('disabled', 'deleted') then
    raise exception 'knowledge source is not ingestable' using errcode = '22023';
  end if;

  if p_version !~ '^[a-z0-9][a-z0-9.-]{0,30}$' then
    raise exception 'version must match ^[a-z0-9][a-z0-9.-]{0,30}$' using errcode = '22023';
  end if;
  if p_content_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'content_hash must be sha256 hex' using errcode = '22023';
  end if;
  if jsonb_typeof(p_chunks) is distinct from 'array' then
    raise exception 'chunks must be a json array' using errcode = '22023';
  end if;
  v_count := jsonb_array_length(p_chunks);
  if v_count < 1 or v_count > 240 then
    raise exception 'chunks must contain 1..240 entries' using errcode = '22023';
  end if;

  for v_chunk in select * from jsonb_array_elements(p_chunks) loop
    v_text := v_chunk->>'t';
    if v_text is null or char_length(v_text) < 1 or char_length(v_text) > 4000 then
      raise exception 'each chunk text must be 1..4000 chars' using errcode = '22023';
    end if;
    if jsonb_typeof(v_chunk->'i') is distinct from 'number' then
      raise exception 'each chunk needs a numeric index i' using errcode = '22023';
    end if;
    if jsonb_typeof(v_chunk->'e') is distinct from 'array' or jsonb_array_length(v_chunk->'e') <> 1536 then
      raise exception 'each chunk embedding must have 1536 dimensions' using errcode = '22023';
    end if;
  end loop;

  -- Substituição atômica: a versão anterior sai junto com chunks/embeddings
  -- (cascade), então a busca nunca vê duas versões da mesma fonte.
  delete from public.knowledge_versions
  where tenant_id = v_tenant and source_id = p_source_id;

  insert into public.knowledge_versions (tenant_id, id, source_id, version, content_hash, valid_from)
  values (v_tenant, p_version_id, p_source_id, p_version, p_content_hash, now());

  insert into public.knowledge_chunks (tenant_id, id, version_id, chunk_index, content_text)
  select v_tenant, (c->>'cid')::app.uuid_v7, p_version_id, (c->>'i')::integer, c->>'t'
  from jsonb_array_elements(p_chunks) as c;

  insert into public.knowledge_embeddings (tenant_id, id, chunk_id, embedding_model, embedding_dimensions, embedding)
  select v_tenant, (c->>'eid')::app.uuid_v7, (c->>'cid')::app.uuid_v7,
         'openai/text-embedding-3-small', 1536, ((c->'e')::text)::vector
  from jsonb_array_elements(p_chunks) as c;

  update public.knowledge_sources
  set status = 'active'
  where tenant_id = v_tenant and id = p_source_id;

  return jsonb_build_object('ok', true, 'source_id', p_source_id, 'version_id', p_version_id, 'chunks', v_count);
end;
$$;

revoke all on function public.portal_ingest_knowledge from public, anon;
grant execute on function public.portal_ingest_knowledge to authenticated;

create or replace function public.portal_search_knowledge(
  p_embedding jsonb,
  p_limit integer default 6
) returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_tenant app.uuid_v7;
  v_query vector;
  v_results jsonb;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  select tenant_id into v_tenant
  from public.user_tenant_memberships where user_id = auth.uid();
  if v_tenant is null then
    raise exception 'no tenant provisioned' using errcode = '42501';
  end if;
  if jsonb_typeof(p_embedding) is distinct from 'array' or jsonb_array_length(p_embedding) <> 1536 then
    raise exception 'embedding must be a 1536-dim array' using errcode = '22023';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 12 then
    raise exception 'limit must be 1..12' using errcode = '22023';
  end if;

  v_query := (p_embedding::text)::vector;

  select coalesce(jsonb_agg(jsonb_build_object(
    'source_name', ranked.display_name,
    'chunk_text', ranked.content_text,
    'similarity', ranked.similarity
  ) order by ranked.similarity desc), '[]'::jsonb)
  into v_results
  from (
    select s.display_name, ch.content_text,
           round((1 - (e.embedding <=> v_query))::numeric, 4) as similarity
    from public.knowledge_embeddings e
    join public.knowledge_chunks ch on ch.tenant_id = e.tenant_id and ch.id = e.chunk_id
    join public.knowledge_versions v on v.tenant_id = ch.tenant_id and v.id = ch.version_id
    join public.knowledge_sources s on s.tenant_id = v.tenant_id and s.id = v.source_id
    where e.tenant_id = v_tenant
      and s.status = 'active'
      and e.embedding_model = 'openai/text-embedding-3-small'
    order by e.embedding <=> v_query
    limit p_limit
  ) as ranked;

  return v_results;
end;
$$;

revoke all on function public.portal_search_knowledge from public, anon;
grant execute on function public.portal_search_knowledge to authenticated;

-- Digesto ordenado do conhecimento ativo do tenant, para injetar como
-- contexto de conversas de vídeo (Tavus conversational_context). Corta por
-- caracteres, nunca no meio de um chunk.
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
  v_current_source text := null;
  r record;
  v_piece text;
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

  for r in
    select s.display_name, ch.content_text
    from public.knowledge_chunks ch
    join public.knowledge_versions v on v.tenant_id = ch.tenant_id and v.id = ch.version_id
    join public.knowledge_sources s on s.tenant_id = v.tenant_id and s.id = v.source_id
    where ch.tenant_id = v_tenant and s.status = 'active'
    order by s.created_at, s.id, ch.chunk_index
  loop
    v_piece := case when v_current_source is distinct from r.display_name
      then E'\n\n### Fonte: ' || r.display_name || E'\n' || r.content_text
      else E'\n' || r.content_text end;
    exit when char_length(v_content) + char_length(v_piece) > p_max_chars;
    v_content := v_content || v_piece;
    if v_current_source is distinct from r.display_name then
      v_sources := v_sources || to_jsonb(r.display_name);
      v_current_source := r.display_name;
    end if;
  end loop;

  if v_content = '' then
    return jsonb_build_object('content', null, 'sources', '[]'::jsonb);
  end if;
  return jsonb_build_object('content', ltrim(v_content, E'\n'), 'sources', v_sources);
end;
$$;

revoke all on function public.portal_knowledge_digest from public, anon;
grant execute on function public.portal_knowledge_digest to authenticated;

COMMIT;
