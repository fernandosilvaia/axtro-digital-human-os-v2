-- RPC de leitura para notificações por e-mail (T9): devolve o e-mail dos
-- tenant_admin do chamador, para avisar "agente ativado" etc. Restrita a
-- admin (mesma classe de quem já pode ativar agente/convidar) — não expõe
-- e-mail de admin para operador comum.

BEGIN;

create or replace function public.portal_list_admin_emails()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant app.uuid_v7;
  v_role text;
  v_emails jsonb;
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
    raise exception 'only a tenant_admin can list admin emails' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(u.email), '[]'::jsonb) into v_emails
  from public.user_tenant_memberships m
  join auth.users u on u.id = m.user_id
  where m.tenant_id = v_tenant and m.role = 'tenant_admin';

  return v_emails;
end;
$$;

revoke all on function public.portal_list_admin_emails from public, anon;
grant execute on function public.portal_list_admin_emails to authenticated;

COMMIT;
