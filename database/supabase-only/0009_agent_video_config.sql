-- Config de vídeo por agente (persona/réplica Tavus). Permite que cada agente
-- tenha voz, percepção e sensibilidade a interrupção próprias (via persona
-- Tavus) em vez da réplica-padrão global. Tenant-scoped; leitura via RPC
-- SECURITY DEFINER resolvida por auth.uid(). Ver ADR-034 / D-V2-065.

BEGIN;

create table if not exists public.agent_video_config (
  tenant_id app.uuid_v7 not null,
  agent_id app.uuid_v7 not null,
  tavus_persona_id text,
  tavus_replica_id text,
  language text not null default 'portuguese',
  created_at timestamptz not null default now(),
  primary key (tenant_id, agent_id),
  foreign key (tenant_id, agent_id) references public.agents(tenant_id, id) on delete cascade,
  constraint agent_video_config_has_target check (tavus_persona_id is not null or tavus_replica_id is not null),
  constraint agent_video_config_persona_fmt check (tavus_persona_id is null or tavus_persona_id ~ '^[a-z0-9]{6,64}$'),
  constraint agent_video_config_replica_fmt check (tavus_replica_id is null or tavus_replica_id ~ '^[a-z0-9]{6,64}$')
);

alter table public.agent_video_config enable row level security;
alter table public.agent_video_config force row level security;

create or replace function public.portal_agent_video_config(p_agent_id app.uuid_v7)
returns jsonb
language plpgsql
stable
security definer
set search_path = 'public'
as $$
declare
  v_tenant app.uuid_v7;
  v_row public.agent_video_config%rowtype;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  select tenant_id into v_tenant from public.user_tenant_memberships where user_id = auth.uid();
  if v_tenant is null then
    return jsonb_build_object('configured', false);
  end if;
  select * into v_row from public.agent_video_config where tenant_id = v_tenant and agent_id = p_agent_id;
  if not found then
    return jsonb_build_object('configured', false);
  end if;
  return jsonb_build_object(
    'configured', true,
    'persona_id', v_row.tavus_persona_id,
    'replica_id', v_row.tavus_replica_id,
    'language', v_row.language
  );
end;
$$;

revoke all on function public.portal_agent_video_config from public, anon;
grant execute on function public.portal_agent_video_config to authenticated;

COMMIT;
