-- Limpeza pelo operador (onda de produção 2): usuários criam agentes e
-- fontes mas não tinham como remover NADA — os limites (20/50) entopem sem
-- saída. Exclusão real (não soft): libera o limite naturalmente e é a
-- operação LGPD-amigável para conteúdo de fonte. Guardas de segurança:
-- agente só se ainda for rascunho E sem sessões; fonte só se já estiver
-- revogada (disabled) ou nunca ingerida (pending) — excluir fonte ativa
-- exigiria revogar antes, mantendo a promessa de revogação explícita.

BEGIN;

create or replace function public.portal_delete_draft_agent(
  p_agent_id app.uuid_v7
) returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_tenant app.uuid_v7;
  v_role text;
  v_status text;
  v_has_sessions boolean;
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
    raise exception 'only a tenant_admin can delete agents' using errcode = '42501';
  end if;

  select status into v_status from public.agents where tenant_id = v_tenant and id = p_agent_id;
  if v_status is null then
    raise exception 'agent not found for this account' using errcode = '42501';
  end if;
  if v_status <> 'draft' then
    raise exception 'only draft agents can be deleted' using errcode = '22023';
  end if;
  select exists(select 1 from public.sessions where tenant_id = v_tenant and agent_id = p_agent_id) into v_has_sessions;
  if v_has_sessions then
    raise exception 'agent has session history and cannot be deleted' using errcode = '22023';
  end if;

  delete from public.agent_video_config where tenant_id = v_tenant and agent_id = p_agent_id;
  delete from public.agents where tenant_id = v_tenant and id = p_agent_id;

  return jsonb_build_object('ok', true, 'id', p_agent_id);
end;
$$;

revoke all on function public.portal_delete_draft_agent from public, anon;
grant execute on function public.portal_delete_draft_agent to authenticated;

create or replace function public.portal_delete_knowledge_source(
  p_source_id app.uuid_v7
) returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_tenant app.uuid_v7;
  v_role text;
  v_status text;
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
    raise exception 'only a tenant_admin can delete knowledge sources' using errcode = '42501';
  end if;

  select status into v_status from public.knowledge_sources where tenant_id = v_tenant and id = p_source_id;
  if v_status is null then
    raise exception 'knowledge source not found for this account' using errcode = '42501';
  end if;
  if v_status not in ('pending', 'disabled') then
    raise exception 'revoke the source before deleting it' using errcode = '22023';
  end if;

  -- Versões saem explicitamente (chunks/embeddings caem por cascade das
  -- versões, mesma cadeia que a re-ingestão da 0010 usa).
  delete from public.knowledge_versions where tenant_id = v_tenant and source_id = p_source_id;
  delete from public.knowledge_sources where tenant_id = v_tenant and id = p_source_id;

  return jsonb_build_object('ok', true, 'id', p_source_id);
end;
$$;

revoke all on function public.portal_delete_knowledge_source from public, anon;
grant execute on function public.portal_delete_knowledge_source to authenticated;

COMMIT;
