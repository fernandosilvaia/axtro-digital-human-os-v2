-- Criação de agentes (draft) e fontes de conhecimento (pending) pelo portal.
-- Estados iniciais honestos: ativação de agente exige provedores conectados e
-- perfil de disclosure validado; ingestão de fonte exige provedor de
-- embedding. Ambos fora do escopo do portal por enquanto (D-V2-062).
-- Escrita restrita a tenant_admin; limites por tenant contra abuso.

BEGIN;

create or replace function public.portal_create_agent(
  p_id app.uuid_v7,
  p_name text,
  p_role_type text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant app.uuid_v7;
  v_role text;
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
    raise exception 'only a tenant_admin can create agents' using errcode = '42501';
  end if;
  if char_length(coalesce(trim(p_name), '')) between 2 and 120 = false then
    raise exception 'agent name must be 2..120 chars' using errcode = '22023';
  end if;
  if p_role_type not in ('sales') then
    raise exception 'unsupported role_type' using errcode = '22023';
  end if;
  if (select count(*) from public.agents where tenant_id = v_tenant) >= 20 then
    raise exception 'agent limit reached for this account' using errcode = '54000';
  end if;

  -- Sempre nasce draft: ativação exige provedores conectados e perfil de
  -- disclosure validado, fronteiras que ficam fora do portal por enquanto.
  insert into public.agents (tenant_id, id, name, role_type, status, disclosure_profile_id)
  values (v_tenant, p_id, trim(p_name), p_role_type, 'draft', 'disclosure-standard-v1');

  return jsonb_build_object('ok', true, 'id', p_id);
exception
  when unique_violation then
    raise exception 'an agent with this name already exists' using errcode = '23505';
end;
$$;

revoke all on function public.portal_create_agent from public, anon;
grant execute on function public.portal_create_agent to authenticated;

create or replace function public.portal_create_knowledge_source(
  p_id app.uuid_v7,
  p_display_name text,
  p_source_type text,
  p_data_classification text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant app.uuid_v7;
  v_role text;
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
    raise exception 'only a tenant_admin can register knowledge sources' using errcode = '42501';
  end if;
  if char_length(coalesce(trim(p_display_name), '')) between 2 and 160 = false then
    raise exception 'display_name must be 2..160 chars' using errcode = '22023';
  end if;
  if p_source_type not in ('document', 'faq', 'url') then
    raise exception 'unsupported source_type' using errcode = '22023';
  end if;
  if p_data_classification not in ('internal', 'confidential', 'restricted') then
    raise exception 'unsupported data_classification' using errcode = '22023';
  end if;
  if (select count(*) from public.knowledge_sources where tenant_id = v_tenant) >= 50 then
    raise exception 'knowledge source limit reached for this account' using errcode = '54000';
  end if;

  -- Sempre nasce pending: ingestão de conteúdo/embeddings exige provedor de
  -- embedding real, fora do escopo do portal por enquanto.
  insert into public.knowledge_sources (tenant_id, id, source_type, display_name, data_classification, status)
  values (v_tenant, p_id, p_source_type, trim(p_display_name), p_data_classification, 'pending');

  return jsonb_build_object('ok', true, 'id', p_id);
end;
$$;

revoke all on function public.portal_create_knowledge_source from public, anon;
grant execute on function public.portal_create_knowledge_source to authenticated;

COMMIT;
