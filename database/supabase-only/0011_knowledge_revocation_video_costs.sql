-- Governança de conhecimento: revogação/reativação imediata de fonte
-- (promessa da UI desde a onda 2) + registro de conversas de vídeo no
-- ledger de custos (cada chamada Tavus criada vira um cost_event).
-- Revogar = status 'disabled': portal_search_knowledge e
-- portal_knowledge_digest só leem fontes 'active', então o efeito é
-- imediato, sem tocar em chunks/embeddings (reativação é barata).

BEGIN;

create or replace function public.portal_set_knowledge_source_status(
  p_source_id app.uuid_v7,
  p_status text
) returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_tenant app.uuid_v7;
  v_role text;
  v_status text;
  v_has_chunks boolean;
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
    raise exception 'only a tenant_admin can change knowledge sources' using errcode = '42501';
  end if;
  if p_status not in ('active', 'disabled') then
    raise exception 'status must be active or disabled' using errcode = '22023';
  end if;

  select status into v_status
  from public.knowledge_sources
  where tenant_id = v_tenant and id = p_source_id;
  if v_status is null then
    raise exception 'knowledge source not found for this account' using errcode = '42501';
  end if;
  if v_status = 'deleted' then
    raise exception 'a deleted source cannot change status' using errcode = '22023';
  end if;

  if p_status = 'active' then
    select exists (
      select 1 from public.knowledge_chunks ch
      join public.knowledge_versions v on v.tenant_id = ch.tenant_id and v.id = ch.version_id
      where ch.tenant_id = v_tenant and v.source_id = p_source_id
    ) into v_has_chunks;
    if not v_has_chunks then
      raise exception 'source has no ingested content to activate' using errcode = '22023';
    end if;
  end if;

  update public.knowledge_sources
  set status = p_status
  where tenant_id = v_tenant and id = p_source_id;

  return jsonb_build_object('ok', true, 'source_id', p_source_id, 'status', p_status);
end;
$$;

revoke all on function public.portal_set_knowledge_source_status from public, anon;
grant execute on function public.portal_set_knowledge_source_status to authenticated;

-- Uma linha no ledger por conversa de vídeo criada. unit_cost fica 0 com
-- source 'measured' até existir rate card (mesma política do 0008): o que
-- se mede agora é a QUANTIDADE, o preço entra na reconciliação.
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
    0, 0, 'measured', now()
  );

  return jsonb_build_object('ok', true, 'id', p_id);
end;
$$;

revoke all on function public.portal_log_video_usage from public, anon;
grant execute on function public.portal_log_video_usage to authenticated;

COMMIT;
