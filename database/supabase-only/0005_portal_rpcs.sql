-- API de dados do portal: RPCs SECURITY DEFINER que resolvem o tenant do
-- chamador por auth.uid() -> user_tenant_memberships. Sem service_role;
-- escrita restrita a tenant_admin. Racional: D-V2-058.

BEGIN;

create or replace function app.portal_caller_tenant()
returns app.uuid_v7
language sql
stable
security definer
set search_path = ''
as $$
  select tenant_id from public.user_tenant_memberships where user_id = auth.uid()
$$;

revoke all on function app.portal_caller_tenant from public, anon;
grant execute on function app.portal_caller_tenant to authenticated;

create or replace function public.portal_tenant_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant app.uuid_v7;
  v_row public.tenants%rowtype;
  v_role text;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  v_tenant := app.portal_caller_tenant();
  if v_tenant is null then
    return jsonb_build_object('provisioned', false);
  end if;

  select * into v_row from public.tenants where id = v_tenant;
  select role into v_role from public.user_tenant_memberships where user_id = auth.uid();

  return jsonb_build_object(
    'provisioned', true,
    'tenant', jsonb_build_object(
      'id', v_row.id,
      'slug', v_row.slug,
      'legal_name', v_row.legal_name,
      'status', v_row.status,
      'home_region', v_row.home_region,
      'default_language', v_row.default_language,
      'default_timezone', v_row.default_timezone,
      'created_at', v_row.created_at
    ),
    'role', v_role,
    'counts', jsonb_build_object(
      'agents', (select count(*) from public.agents where tenant_id = v_tenant),
      'sessions', (select count(*) from public.sessions where tenant_id = v_tenant),
      'knowledge_sources', (select count(*) from public.knowledge_sources where tenant_id = v_tenant),
      'contacts', (select count(*) from public.contact_profiles where tenant_id = v_tenant and deleted_at is null)
    )
  );
end;
$$;

revoke all on function public.portal_tenant_overview from public, anon;
grant execute on function public.portal_tenant_overview to authenticated;

create or replace function public.portal_update_tenant_profile(
  p_legal_name text,
  p_default_language text,
  p_default_timezone text
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
    raise exception 'only a tenant_admin can edit the tenant profile' using errcode = '42501';
  end if;
  if char_length(coalesce(p_legal_name, '')) between 1 and 200 = false then
    raise exception 'legal_name must be 1..200 chars' using errcode = '22023';
  end if;
  if p_default_language !~ '^[a-z]{2}-[A-Z]{2}$' then
    raise exception 'default_language must be a BCP-47 tag like pt-BR' using errcode = '22023';
  end if;
  if char_length(coalesce(p_default_timezone, '')) between 1 and 64 = false then
    raise exception 'default_timezone must be 1..64 chars' using errcode = '22023';
  end if;

  update public.tenants
  set legal_name = p_legal_name,
      default_language = p_default_language,
      default_timezone = p_default_timezone,
      updated_at = now()
  where id = v_tenant;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.portal_update_tenant_profile from public, anon;
grant execute on function public.portal_update_tenant_profile to authenticated;

create or replace function public.portal_list_agents()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant app.uuid_v7;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  v_tenant := app.portal_caller_tenant();
  if v_tenant is null then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', a.id, 'name', a.name, 'role_type', a.role_type,
      'status', a.status, 'created_at', a.created_at
    ) order by a.created_at desc)
    from public.agents a where a.tenant_id = v_tenant
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.portal_list_agents from public, anon;
grant execute on function public.portal_list_agents to authenticated;

create or replace function public.portal_list_knowledge_sources()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant app.uuid_v7;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  v_tenant := app.portal_caller_tenant();
  if v_tenant is null then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', k.id, 'display_name', k.display_name, 'source_type', k.source_type,
      'data_classification', k.data_classification, 'status', k.status, 'created_at', k.created_at
    ) order by k.created_at desc)
    from public.knowledge_sources k where k.tenant_id = v_tenant
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.portal_list_knowledge_sources from public, anon;
grant execute on function public.portal_list_knowledge_sources to authenticated;

COMMIT;
