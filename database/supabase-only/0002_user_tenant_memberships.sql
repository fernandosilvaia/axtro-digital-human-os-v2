-- Mapa usuário Supabase -> tenant/actor/papel. Um tenant por usuário (PK em
-- user_id). actor_id é um UUIDv7 próprio gerado pela aplicação porque
-- auth.users.id é UUIDv4 e não passa em parseActorId. Racional: ADR-032,
-- D-V2-056.

BEGIN;

create table public.user_tenant_memberships (
  user_id uuid primary key references auth.users(id) on delete cascade,
  tenant_id app.uuid_v7 not null references public.tenants(id) on delete cascade,
  actor_id app.uuid_v7 not null unique,
  role text not null check (role in ('tenant_admin', 'tenant_operator')),
  created_at timestamptz not null default now()
);

grant all on table public.user_tenant_memberships to supabase_auth_admin;
revoke all on table public.user_tenant_memberships from authenticated, anon, public;

alter table public.user_tenant_memberships enable row level security;
alter table public.user_tenant_memberships force row level security;

create policy "Allow auth admin to read memberships" on public.user_tenant_memberships
  as permissive for select
  to supabase_auth_admin
  using (true);

COMMIT;
