-- Corrige um acoplamento frágil: o código do portal decidia se um agente
-- apresenta o deck institucional (a própria Axtro) ou o deck de vendas (o
-- negócio do tenant) checando `agent.name.startsWith("Aurora")` — quebraria
-- silenciosamente ao renomear o agente (D-V2-08x, rename Aurora -> Raissa).
-- `presentation_kind` é um campo explícito e estável, na mesma tabela que já
-- guarda config de vídeo por agente (0009).

BEGIN;

alter table public.agent_video_config
  add column if not exists presentation_kind text not null default 'sales';

alter table public.agent_video_config
  add constraint agent_video_config_presentation_kind_chk
  check (presentation_kind in ('sales', 'platform'));

-- Backfill: o único agente institucional hoje é o que responde por "Aurora"
-- (renomeado para "Raissa" nesta mesma sessão) — ele apresenta o deck da
-- própria plataforma Axtro, não o deck de vendas de um negócio de tenant.
update public.agent_video_config
set presentation_kind = 'platform'
where agent_id = '019f6de0-0000-7000-8000-00000aa00001'::app.uuid_v7;

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
    'language', v_row.language,
    'presentation_kind', v_row.presentation_kind
  );
end;
$$;

revoke all on function public.portal_agent_video_config from public, anon;
grant execute on function public.portal_agent_video_config to authenticated;

COMMIT;
