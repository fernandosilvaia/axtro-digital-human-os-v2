begin;

-- AUD-02: contain new asset assignment without certifying historical assets.
-- Only platform-governed provisioning may create or replace asset bindings.
-- This RPC edits preferences on an existing locked same-tenant binding only.
create or replace function public.portal_set_agent_video_config(
  p_agent_id app.uuid_v7,
  p_persona_id text,
  p_replica_id text,
  p_language text,
  p_spoken_languages text[] default null,
  p_closer_vertical text default 'metodo_silva'
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant app.uuid_v7;
  v_role text;
  v_agent_exists boolean;
  v_config public.agent_video_config%rowtype;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  select tenant_id, role into v_tenant, v_role
  from public.user_tenant_memberships where user_id = auth.uid() for share;
  if v_tenant is null then
    raise exception 'no tenant provisioned' using errcode = '42501';
  end if;
  if v_role <> 'tenant_admin' then
    raise exception 'only a tenant_admin can configure agent video' using errcode = '42501';
  end if;
  select exists(select 1 from public.agents where tenant_id = v_tenant and id = p_agent_id) into v_agent_exists;
  if not v_agent_exists then
    raise exception 'agent not found for this account' using errcode = '42501';
  end if;

  select * into v_config from public.agent_video_config
  where tenant_id=v_tenant and agent_id=p_agent_id for update;
  if not found then
    raise exception 'video asset assignment requires governed provisioning' using errcode='42501';
  end if;
  if p_persona_id is distinct from v_config.tavus_persona_id
     or p_replica_id is distinct from v_config.tavus_replica_id then
    raise exception 'video asset assignment requires governed provisioning' using errcode='42501';
  end if;

  if p_language is null or p_language not in ('portuguese', 'english', 'spanish') then
    raise exception 'language must be portuguese, english or spanish' using errcode = '22023';
  end if;
  if p_closer_vertical is null or p_closer_vertical not in ('metodo_silva', 'life_insurance_qualification', 'life_insurance_recruitment') then
    raise exception 'closer_vertical not recognized' using errcode = '22023';
  end if;
  if p_spoken_languages is not null and (
    array_length(p_spoken_languages, 1) is null
    or array_length(p_spoken_languages, 1) not between 1 and 3
    or not (p_spoken_languages <@ array['portuguese', 'english', 'spanish']::text[])
    or app.text_array_has_duplicates(p_spoken_languages)
    or not (p_language = any (p_spoken_languages))
  ) then
    raise exception 'spoken_languages must have 1..3 distinct known languages and include language' using errcode = '22023';
  end if;
  update public.agent_video_config
  set language=p_language,spoken_languages=p_spoken_languages,closer_vertical=p_closer_vertical
  where tenant_id=v_tenant and agent_id=p_agent_id;

  return jsonb_build_object('ok', true, 'agent_id', p_agent_id, 'persona_id', p_persona_id);
end;
$$;

revoke all on function public.portal_set_agent_video_config(app.uuid_v7,text,text,text,text[],text)
  from public,anon,authenticated,service_role;
grant execute on function public.portal_set_agent_video_config(app.uuid_v7,text,text,text,text[],text)
  to authenticated;
revoke insert,update,delete on table public.agent_video_config from public,anon,authenticated,service_role;

alter function public.portal_schema_capabilities_service() set schema app;
alter function app.portal_schema_capabilities_service() rename to portal_schema_capabilities_v71;
revoke all on function app.portal_schema_capabilities_v71() from public,anon,authenticated,service_role;
create or replace function public.portal_schema_capabilities_service()
returns jsonb language sql stable security definer set search_path='' as $$
  select (app.portal_schema_capabilities_v71()-'version')||jsonb_build_object(
    'version',72,'videoAssetAssignmentGoverned',true
  )
$$;
revoke all on function public.portal_schema_capabilities_service() from public,anon,authenticated;
grant execute on function public.portal_schema_capabilities_service() to service_role;

commit;
