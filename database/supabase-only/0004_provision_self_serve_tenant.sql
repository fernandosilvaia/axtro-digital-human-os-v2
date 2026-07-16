-- Provisionamento self-serve: cadastro cria o próprio tenant (decisão de
-- produto confirmada) — exceto quando há convite pendente para o e-mail do
-- usuário (ver 0006_tenant_invites.sql): nesse caso ele entra no tenant do
-- convite com o papel definido. SECURITY DEFINER para não depender da chave
-- service_role, que fica reservada pro fim da fase. Idempotente: usuário já
-- membro recebe o tenant existente. Racional: ADR-032, D-V2-056.
-- Requer: grant usage on schema app to authenticated (tipos app.uuid_v7 nos
-- parâmetros).

BEGIN;

grant usage on schema app to authenticated;

create or replace function public.provision_self_serve_tenant(
  p_tenant_id app.uuid_v7,
  p_actor_id app.uuid_v7,
  p_slug text,
  p_legal_name text,
  p_home_region text,
  p_default_language text,
  p_default_timezone text
) returns app.uuid_v7
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_tenant_id app.uuid_v7;
  v_email text;
  v_invite record;
begin
  if auth.uid() is null then
    raise exception 'provision_self_serve_tenant requires an authenticated caller' using errcode = '28000';
  end if;

  select tenant_id into existing_tenant_id
  from public.user_tenant_memberships
  where user_id = auth.uid();

  if existing_tenant_id is not null then
    return existing_tenant_id;
  end if;

  -- Convite pendente para o e-mail confirmado do usuário tem precedência
  -- sobre criar um tenant novo. O mais antigo vence; aceito atomicamente.
  select lower(u.email) into v_email from auth.users u where u.id = auth.uid();

  select i.* into v_invite
  from public.tenant_invites i
  where lower(i.email) = v_email and i.status = 'pending'
  order by i.created_at
  limit 1
  for update;

  if v_invite.id is not null then
    insert into public.user_tenant_memberships (user_id, tenant_id, actor_id, role)
    values (auth.uid(), v_invite.tenant_id, p_actor_id, v_invite.role);

    update public.tenant_invites
    set status = 'accepted', accepted_at = now()
    where id = v_invite.id;

    return v_invite.tenant_id;
  end if;

  insert into public.tenants (id, slug, legal_name, status, home_region, default_language, default_timezone)
  values (p_tenant_id, p_slug, p_legal_name, 'trial', p_home_region, p_default_language, p_default_timezone);

  insert into public.tenant_settings (tenant_id) values (p_tenant_id);

  insert into public.user_tenant_memberships (user_id, tenant_id, actor_id, role)
  values (auth.uid(), p_tenant_id, p_actor_id, 'tenant_admin');

  return p_tenant_id;
end;
$$;

revoke all on function public.provision_self_serve_tenant from public, anon;
grant execute on function public.provision_self_serve_tenant to authenticated;

COMMIT;
