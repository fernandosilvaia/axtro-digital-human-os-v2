-- Auto-provisão de vídeo (P1, execução autônoma 2026-07-31): até aqui, toda
-- linha de agent_video_config foi inserida à mão (0013 e sessões via SQL
-- direto) — só os agentes demo tinham vídeo. Para clientes novos terem
-- vídeo ao ativar um agente, o portal precisa gravar a config via RPC.
-- Admin do tenant, upsert idempotente, formatos validados como no CHECK
-- da própria tabela (0009/0020).

BEGIN;

create or replace function public.portal_set_agent_video_config(
  p_agent_id app.uuid_v7,
  p_persona_id text,
  p_language text,
  p_presentation_kind text default 'sales'
) returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_tenant app.uuid_v7;
  v_role text;
  v_agent_exists boolean;
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
    raise exception 'only a tenant_admin can configure agent video' using errcode = '42501';
  end if;
  if p_persona_id !~ '^[a-z0-9]{6,64}$' then
    raise exception 'persona_id must be a plain Tavus persona id' using errcode = '22023';
  end if;
  if p_language not in ('portuguese', 'english') then
    raise exception 'language must be portuguese or english' using errcode = '22023';
  end if;
  if p_presentation_kind not in ('sales', 'platform') then
    raise exception 'presentation_kind must be sales or platform' using errcode = '22023';
  end if;
  select exists(select 1 from public.agents where tenant_id = v_tenant and id = p_agent_id) into v_agent_exists;
  if not v_agent_exists then
    raise exception 'agent not found for this account' using errcode = '42501';
  end if;

  insert into public.agent_video_config (tenant_id, agent_id, tavus_persona_id, language, presentation_kind)
  values (v_tenant, p_agent_id, p_persona_id, p_language, p_presentation_kind)
  on conflict (tenant_id, agent_id) do update
  set tavus_persona_id = excluded.tavus_persona_id,
      tavus_replica_id = null,
      language = excluded.language,
      presentation_kind = excluded.presentation_kind;

  return jsonb_build_object('ok', true, 'agent_id', p_agent_id, 'persona_id', p_persona_id);
end;
$$;

revoke all on function public.portal_set_agent_video_config from public, anon;
grant execute on function public.portal_set_agent_video_config to authenticated;

COMMIT;
