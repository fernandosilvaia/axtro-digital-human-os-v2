-- Ativação/pausa de agente pelo portal (T1, docs/PROJECT_AUDIT.md).
-- D-V2-062 criou agentes sempre 'draft' porque ativação exigia provedores
-- conectados — hoje o ambiente TEM provider de texto (OpenRouter), vídeo
-- (Tavus por persona) e RAG; a checagem de provider vive no server action
-- (é conhecimento do ambiente, não do banco). Aqui ficam as guardas de
-- dado: admin do tenant, transições explícitas draft<->active e disclosure
-- profile presente para ativar.

BEGIN;

create or replace function public.portal_set_agent_status(
  p_agent_id app.uuid_v7,
  p_status text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant app.uuid_v7;
  v_role text;
  v_current text;
  v_disclosure text;
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
    raise exception 'only a tenant_admin can change agent status' using errcode = '42501';
  end if;
  if p_status not in ('active', 'draft') then
    raise exception 'status must be active or draft' using errcode = '22023';
  end if;

  select status, disclosure_profile_id into v_current, v_disclosure
  from public.agents where tenant_id = v_tenant and id = p_agent_id;
  if v_current is null then
    raise exception 'agent not found for this account' using errcode = '42501';
  end if;
  if v_current = p_status then
    return jsonb_build_object('ok', true, 'id', p_agent_id, 'status', v_current, 'changed', false);
  end if;
  if v_current not in ('draft', 'active') then
    raise exception 'agent status cannot be changed from its current state' using errcode = '22023';
  end if;
  if p_status = 'active' and coalesce(v_disclosure, '') = '' then
    raise exception 'agent has no disclosure profile' using errcode = '22023';
  end if;

  update public.agents
  set status = p_status
  where tenant_id = v_tenant and id = p_agent_id;

  return jsonb_build_object('ok', true, 'id', p_agent_id, 'status', p_status, 'changed', true);
end;
$$;

revoke all on function public.portal_set_agent_status from public, anon;
grant execute on function public.portal_set_agent_status to authenticated;

COMMIT;
