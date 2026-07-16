-- Custom Access Token Hook: injeta app_metadata.tenant_id / actor_id /
-- tenant_role no JWT a partir de user_tenant_memberships. A função fica
-- publicada aqui; HABILITAR o hook é passo manual no dashboard
-- (Authentication > Hooks), gate humano — ver D-V2-057.

BEGIN;

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  claims jsonb;
  membership record;
begin
  select tenant_id, actor_id, role
  into membership
  from public.user_tenant_memberships
  where user_id = (event->>'user_id')::uuid;

  claims := event->'claims';

  if jsonb_typeof(claims->'app_metadata') is null then
    claims := jsonb_set(claims, '{app_metadata}', '{}'::jsonb);
  end if;

  if membership.tenant_id is not null then
    claims := jsonb_set(claims, '{app_metadata,tenant_id}', to_jsonb(membership.tenant_id::text));
    claims := jsonb_set(claims, '{app_metadata,actor_id}', to_jsonb(membership.actor_id::text));
    claims := jsonb_set(claims, '{app_metadata,tenant_role}', to_jsonb(membership.role));
  end if;

  event := jsonb_set(event, '{claims}', claims);
  return event;
end;
$$;

grant usage on schema public to supabase_auth_admin;

grant execute
  on function public.custom_access_token_hook
  to supabase_auth_admin;

revoke execute
  on function public.custom_access_token_hook
  from authenticated, anon, public;

COMMIT;
