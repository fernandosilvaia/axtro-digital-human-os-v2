-- Fecha o gap de RAG declarado desde D-V2-083 (M4-04): o endpoint
-- /api/brain/[agentId]/chat/completions (o LLM da persona de VÍDEO, chamado
-- pelo Tavus servidor-a-servidor, sem sessão de usuário) nunca conseguia
-- buscar conhecimento autorizado porque `portal_search_knowledge` (0010)
-- exige `auth.uid()`. Resultado prático: um agente citava fontes no chat de
-- teste mas "esquecia" tudo numa call de vídeo real — a mesma pergunta tinha
-- resposta com fonte numa superfície e sem fonte na outra.
--
-- Variante service-role, mesmo padrão de portal_log_ai_usage_service (0019)
-- e portal_get_meeting_bot_agent_service (0028): tenant resolvido por
-- p_tenant_id explícito (validado contra public.tenants) em vez de
-- auth.uid(). Corpo da busca idêntico ao de portal_search_knowledge —
-- mesmo filtro de fonte ativa, mesmo modelo de embedding, mesmo teto de
-- resultados — só a resolução de identidade muda.

BEGIN;

create or replace function public.portal_search_knowledge_service(
  p_tenant_id app.uuid_v7,
  p_embedding jsonb,
  p_limit integer default 6
) returns jsonb
language plpgsql
stable
security definer
set search_path = 'public'
as $$
declare
  v_query vector;
  v_results jsonb;
begin
  if not exists (select 1 from public.tenants where id = p_tenant_id) then
    raise exception 'unknown tenant' using errcode = '42501';
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
    where e.tenant_id = p_tenant_id
      and s.status = 'active'
      and e.embedding_model = 'openai/text-embedding-3-small'
    order by e.embedding <=> v_query
    limit p_limit
  ) as ranked;

  return v_results;
end;
$$;

revoke all on function public.portal_search_knowledge_service from public, anon, authenticated;
grant execute on function public.portal_search_knowledge_service to service_role;

COMMIT;
