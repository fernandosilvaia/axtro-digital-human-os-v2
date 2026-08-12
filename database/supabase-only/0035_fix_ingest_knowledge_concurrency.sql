-- Corrige achado P1 confirmado (3/3 verificadores) da onda 5 de auditoria
-- autônoma (2026-08-12, dimensão concurrency-idempotency-audit):
-- `portal_ingest_knowledge` (0015) repete o mesmo padrão check-then-act sem
-- lock do achado JÁ CONHECIDO (não corrigido, aguardando migration própria)
-- em `provision_self_serve_tenant` — lê `knowledge_sources.status` sem
-- `FOR UPDATE`, depois faz `DELETE + INSERT` em `knowledge_versions` sem
-- nenhum lock entre a leitura e a escrita.
--
-- Cenário real: usuário clica "Reingerir" em duas abas, ou o form reenvia
-- após timeout de rede (source-actions.tsx). Cada submissão gera um
-- `p_version` com granularidade de 1 SEGUNDO (`v${Math.floor(Date.now()/1000)}`,
-- resources.ts) e um `p_version_id` sempre novo — então nenhuma colide no
-- `UNIQUE(tenant_id, source_id, version)`. Sob READ COMMITTED (default),
-- reconstruído passo a passo pelos verificadores: TxA deleta a versão
-- anterior (se houver) e insere a nova; o DELETE de TxB, que via a MESMA
-- linha antes de TxA committar, é reavaliado via EvalPlanQual e afeta 0
-- linhas (a linha já sumiu, deletada por TxA) — TxB NÃO revarre a tabela
-- pra achar a linha nova de TxA (fora do snapshot do statement). TxB segue
-- pro INSERT com sua própria versão. Resultado: DUAS `knowledge_versions`
-- "ativas" pra mesma fonte, cada uma com seus chunks/embeddings via cascade.
--
-- `portal_search_knowledge`/`portal_search_knowledge_service` (0010/0032) e
-- `portal_knowledge_digest` (0027) juntam por `source_id` filtrado só por
-- `knowledge_sources.status = 'active'`, sem filtro de "versão mais
-- recente" (`valid_to` nunca é setado em nenhuma RPC de ingestão) — as DUAS
-- versões entram na busca/digest, quebrando o invariante já documentado no
-- comentário original da própria função ("a busca nunca vê duas versões da
-- mesma fonte") e fazendo o agente citar conteúdo duplicado/desatualizado.
-- Efeito colateral: `embedChunks` (custo real OpenRouter) roda no server
-- action ANTES da RPC — duas submissões concorrentes pagam por embeddings
-- duas vezes, independente de qual "vence" no banco.
--
-- Correção: `SELECT ... FOR UPDATE` na leitura do status da fonte, mesmo
-- padrão já usado em `database/supabase-only/0004_provision_self_serve_tenant.sql`
-- pra `tenant_invites` (o único outro lugar do schema com esse lock). Como a
-- própria função faz um `UPDATE knowledge_sources SET status = 'active'`
-- nessa MESMA linha no final, o lock serializa corretamente chamadas
-- concorrentes: a segunda transação bloqueia até a primeira commitar, e
-- então lê o estado já atualizado — sem mudar nenhum outro comportamento da
-- função (mesmos limites, mesma validação, mesma substituição atômica
-- dentro de uma única transação).

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
  v_ingestions_today integer;
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

  select count(*) into v_ingestions_today
  from public.knowledge_versions
  where tenant_id = v_tenant and valid_from >= date_trunc('day', now());
  if v_ingestions_today >= 30 then
    raise exception 'daily knowledge ingestion limit reached for this account' using errcode = '54000';
  end if;

  -- FIX (achado P1 da auditoria 2026-08-12): FOR UPDATE serializa
  -- re-ingestões concorrentes da MESMA fonte — sem isso, duas chamadas
  -- simultâneas liam o mesmo status e cada uma fazia seu próprio
  -- DELETE+INSERT em knowledge_versions, produzindo duas versões "ativas".
  select status into v_status
  from public.knowledge_sources
  where tenant_id = v_tenant and id = p_source_id
  for update;
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
  -- (cascade), então a busca nunca vê duas versões da mesma fonte. Agora
  -- genuinamente garantido entre transações concorrentes pelo FOR UPDATE
  -- acima, não só dentro de uma única chamada.
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

COMMIT;
