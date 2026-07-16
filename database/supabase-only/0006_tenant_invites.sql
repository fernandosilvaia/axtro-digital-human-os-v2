-- Convites de equipe por tenant. Convite pendente é honrado pelo
-- provisionamento (ver 0004): quem cria conta com um e-mail convidado entra
-- no tenant do convite com o papel definido, em vez de criar tenant próprio.
-- Sem acesso direto via PostgREST (RLS forçado, zero policies) — toda
-- leitura/escrita passa pelas RPCs abaixo.

BEGIN;

create table public.tenant_invites (
  id uuid primary key default gen_random_uuid(),
  tenant_id app.uuid_v7 not null references public.tenants(id) on delete cascade,
  email text not null check (email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  role text not null check (role in ('tenant_admin', 'tenant_operator')),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked')),
  invited_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);

create unique index tenant_invites_pending_unique
  on public.tenant_invites (tenant_id, lower(email))
  where status = 'pending';

revoke all on table public.tenant_invites from authenticated, anon, public;

alter table public.tenant_invites enable row level security;
alter table public.tenant_invites force row level security;

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

create or replace function public.portal_revoke_invite(p_invite_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant app.uuid_v7;
  v_role text;
  v_count integer;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  select tenant_id, role into v_tenant, v_role
  from public.user_tenant_memberships where user_id = auth.uid();
  if v_tenant is null or v_role <> 'tenant_admin' then
    raise exception 'only a tenant_admin can revoke invites' using errcode = '42501';
  end if;

  update public.tenant_invites
  set status = 'revoked'
  where id = p_invite_id and tenant_id = v_tenant and status = 'pending';
  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'invite not found or not pending' using errcode = '22023';
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.portal_revoke_invite from public, anon;
grant execute on function public.portal_revoke_invite to authenticated;

create or replace function public.portal_list_team()
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
    return jsonb_build_object('members', '[]'::jsonb, 'invites', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'email', u.email, 'role', m.role, 'joined_at', m.created_at,
        'is_you', m.user_id = auth.uid()
      ) order by m.created_at)
      from public.user_tenant_memberships m
      join auth.users u on u.id = m.user_id
      where m.tenant_id = v_tenant
    ), '[]'::jsonb),
    'invites', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'email', i.email, 'role', i.role, 'created_at', i.created_at
      ) order by i.created_at desc)
      from public.tenant_invites i
      where i.tenant_id = v_tenant and i.status = 'pending'
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.portal_list_team from public, anon;
grant execute on function public.portal_list_team to authenticated;

COMMIT;
