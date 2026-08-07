-- Onda W5 (achados da auditoria 2026-08-06):
--
-- 1) portal_remove_member: não existia NENHUMA forma de revogar o acesso de
--    um membro já aceito na equipe — só convites pendentes tinham "Revogar"
--    (portal_revoke_invite, 0006). Um colaborador desligado só perdia acesso
--    se alguém mexesse direto no banco. Mesma disciplina de
--    portal_revoke_invite: exige tenant_admin, escopado por tenant_id.
--    Guardas extras: não remove a si mesmo (use "Sair da conta") e nunca
--    remove o último tenant_admin (evitaria conta órfã sem administrador).
--
-- 2) portal_list_admin_emails_service: variante service-role de
--    portal_list_admin_emails (0016), que exige auth.uid() — o webhook do
--    Recall.ai (servidor-a-servidor, sem sessão de usuário) precisa notificar
--    os admins quando uma reunião externa termina e não tem como chamar a
--    versão autenticada. Mesmo padrão de portal_log_video_usage_service
--    (0024): sem grant pra authenticated/anon, só service_role.
--
-- 3) portal_list_team (0006) ganha user_id em cada membro — o botão de
--    remover precisa de um identificador estável pra chamar
--    portal_remove_member; email não serve porque não é a chave da RPC.

BEGIN;

create or replace function public.portal_remove_member(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant app.uuid_v7;
  v_role text;
  v_target_role text;
  v_admin_count integer;
  v_count integer;
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
    raise exception 'only a tenant_admin can remove members' using errcode = '42501';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'use sign out to remove yourself' using errcode = '22023';
  end if;

  select role into v_target_role
  from public.user_tenant_memberships
  where tenant_id = v_tenant and user_id = p_user_id;
  if v_target_role is null then
    raise exception 'member not found in this account' using errcode = '22023';
  end if;

  if v_target_role = 'tenant_admin' then
    select count(*) into v_admin_count
    from public.user_tenant_memberships
    where tenant_id = v_tenant and role = 'tenant_admin';
    if v_admin_count <= 1 then
      raise exception 'cannot remove the last administrator of the account' using errcode = '22023';
    end if;
  end if;

  delete from public.user_tenant_memberships
  where tenant_id = v_tenant and user_id = p_user_id;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.portal_remove_member from public, anon;
grant execute on function public.portal_remove_member to authenticated;

create or replace function public.portal_list_admin_emails_service(p_tenant_id app.uuid_v7)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_emails jsonb;
begin
  select coalesce(jsonb_agg(u.email), '[]'::jsonb) into v_emails
  from public.user_tenant_memberships m
  join auth.users u on u.id = m.user_id
  where m.tenant_id = p_tenant_id and m.role = 'tenant_admin';
  return v_emails;
end;
$$;

revoke all on function public.portal_list_admin_emails_service from public, anon, authenticated;
grant execute on function public.portal_list_admin_emails_service to service_role;

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
        'user_id', m.user_id, 'email', u.email, 'role', m.role, 'joined_at', m.created_at,
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
