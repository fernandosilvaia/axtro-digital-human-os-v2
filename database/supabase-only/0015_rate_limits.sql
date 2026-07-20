-- Rate limiting por tenant nas RPCs mais caras (T6, docs/PROJECT_AUDIT.md
-- risco #4). Mesmo padrão do teto diário de tokens (0008): contador por
-- `occurred_at`/`created_at >= date_trunc('day', now())`, falha fechada com
-- mensagem clara. `create or replace` preserva 100% do comportamento
-- existente das duas RPCs — só adiciona a guarda de limite.

BEGIN;

-- Convites: no máximo 20 convites criados por dia por tenant. Revogados e
-- aceitos contam (é o dia de CRIAÇÃO que limita, não o estado atual).
create or replace function public.portal_invite_member(p_email text, p_role text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant app.uuid_v7;
  v_role text;
  v_email text;
  v_existing_member uuid;
  v_invites_today integer;
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
    raise exception 'only a tenant_admin can invite members' using errcode = '42501';
  end if;
  if p_role not in ('tenant_admin', 'tenant_operator') then
    raise exception 'invalid role' using errcode = '22023';
  end if;
  v_email := lower(trim(p_email));
  if v_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'invalid email' using errcode = '22023';
  end if;
  if v_email = lower((select u.email from auth.users u where u.id = auth.uid())) then
    raise exception 'you cannot invite yourself' using errcode = '22023';
  end if;

  select count(*) into v_invites_today
  from public.tenant_invites
  where tenant_id = v_tenant and created_at >= date_trunc('day', now());
  if v_invites_today >= 20 then
    raise exception 'daily invite limit reached for this account' using errcode = '54000';
  end if;

  select m.user_id into v_existing_member
  from public.user_tenant_memberships m
  join auth.users u on u.id = m.user_id
  where lower(u.email) = v_email;
  if v_existing_member is not null then
    raise exception 'this email already belongs to an account with a workspace' using errcode = '23505';
  end if;

  insert into public.tenant_invites (tenant_id, email, role, invited_by)
  values (v_tenant, v_email, p_role, auth.uid());

  return jsonb_build_object('ok', true);
exception
  when unique_violation then
    raise exception 'there is already a pending invite for this email' using errcode = '23505';
end;
$$;

revoke all on function public.portal_invite_member from public, anon;
grant execute on function public.portal_invite_member to authenticated;

-- Ingestão de conhecimento: no máximo 30 ingestões (criação ou re-ingestão)
-- por dia por tenant — o custo real é o embedding, mas o volume de escrita
-- em si já merece um teto contra abuso/erro em loop.
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

COMMIT;
