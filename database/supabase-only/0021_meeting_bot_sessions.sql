-- Rastreia bots do Recall.ai que colocam um agente numa reunião externa de
-- verdade (Zoom/Meet/Teams) — capacidade central do produto (D-V2-089): o
-- agente do cliente "empresta" a câmera de um bot dentro da reunião alheia.
-- Tenant-scoped, RLS forçada, mesmo padrão de agent_video_config (0009).
--
-- O bot em si é criado pela aplicação chamando a API do Recall.ai
-- diretamente (packages/provider-recall) — esta tabela só registra o
-- recibo/estado, nunca o segredo do provider. Duas vias de escrita:
-- portal_record_meeting_bot_session (usuário autenticado, cria o registro
-- logo após criar o bot de verdade) e portal_update_meeting_bot_session_status
-- (service role, chamada pelo webhook do Recall.ai — sem auth.uid()).

BEGIN;

create table if not exists public.meeting_bot_sessions (
  id app.uuid_v7 primary key,
  tenant_id app.uuid_v7 not null,
  agent_id app.uuid_v7 not null,
  recall_bot_id text not null,
  tavus_conversation_id text,
  meeting_url text not null,
  status text not null default 'created',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ended_at timestamptz,
  foreign key (tenant_id, agent_id) references public.agents(tenant_id, id) on delete cascade,
  constraint meeting_bot_sessions_status_chk check (status in ('created', 'joining', 'in_call', 'ended', 'failed')),
  constraint meeting_bot_sessions_recall_bot_id_fmt check (recall_bot_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  constraint meeting_bot_sessions_meeting_url_https check (meeting_url ~ '^https://')
);

-- Lookup pelo webhook (service role, sem RLS, sem auth.uid()): o id do bot
-- do Recall.ai é a chave de correlação — precisa ser único.
create unique index if not exists meeting_bot_sessions_recall_bot_id_idx
  on public.meeting_bot_sessions (recall_bot_id);
create index if not exists meeting_bot_sessions_tenant_idx
  on public.meeting_bot_sessions (tenant_id, created_at desc);

alter table public.meeting_bot_sessions enable row level security;
alter table public.meeting_bot_sessions force row level security;

-- Registra o recibo logo após a aplicação criar o bot de verdade via API do
-- Recall.ai — nunca antes (Art. 7: execução idempotente antes do recibo).
create or replace function public.portal_record_meeting_bot_session(
  p_id app.uuid_v7,
  p_agent_id app.uuid_v7,
  p_recall_bot_id text,
  p_meeting_url text,
  p_tavus_conversation_id text
) returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_tenant app.uuid_v7;
  v_agent_exists boolean;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  select tenant_id into v_tenant from public.user_tenant_memberships where user_id = auth.uid();
  if v_tenant is null then
    raise exception 'no tenant provisioned' using errcode = '42501';
  end if;
  if p_recall_bot_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'recall_bot_id must be a plain UUID' using errcode = '22023';
  end if;
  if p_meeting_url !~ '^https://' then
    raise exception 'meeting_url must be https' using errcode = '22023';
  end if;

  select exists(select 1 from public.agents where tenant_id = v_tenant and id = p_agent_id) into v_agent_exists;
  if not v_agent_exists then
    raise exception 'agent not found for this account' using errcode = '42501';
  end if;

  insert into public.meeting_bot_sessions (id, tenant_id, agent_id, recall_bot_id, meeting_url, tavus_conversation_id, status)
  values (p_id, v_tenant, p_agent_id, p_recall_bot_id, p_meeting_url, p_tavus_conversation_id, 'created');

  return jsonb_build_object('ok', true, 'id', p_id);
end;
$$;

revoke all on function public.portal_record_meeting_bot_session from public, anon;
grant execute on function public.portal_record_meeting_bot_session to authenticated;

-- Atualiza status a partir do webhook do Recall.ai — sem auth.uid(), só
-- service_role. Nunca revela dado de tenant no retorno (o webhook não
-- precisa disso, só confirmação de que achou a sessão).
create or replace function public.portal_update_meeting_bot_session_status_service(
  p_recall_bot_id text,
  p_status text
) returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_updated boolean;
begin
  if p_status not in ('created', 'joining', 'in_call', 'ended', 'failed') then
    raise exception 'invalid status' using errcode = '22023';
  end if;
  update public.meeting_bot_sessions
  set status = p_status, updated_at = now(), ended_at = case when p_status in ('ended', 'failed') then now() else ended_at end
  where recall_bot_id = p_recall_bot_id;
  v_updated := found;
  return jsonb_build_object('found', v_updated);
end;
$$;

revoke all on function public.portal_update_meeting_bot_session_status_service from public, anon, authenticated;
grant execute on function public.portal_update_meeting_bot_session_status_service to service_role;

-- Lista as sessões recentes do tenant (base pra uma UI futura).
create or replace function public.portal_list_meeting_bot_sessions()
returns jsonb
language plpgsql
stable
security definer
set search_path = 'public'
as $$
declare
  v_tenant app.uuid_v7;
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  select tenant_id into v_tenant from public.user_tenant_memberships where user_id = auth.uid();
  if v_tenant is null then
    return '[]'::jsonb;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id,
    'agentId', s.agent_id,
    'meetingUrl', s.meeting_url,
    'status', s.status,
    'createdAt', s.created_at,
    'endedAt', s.ended_at
  ) order by s.created_at desc), '[]'::jsonb)
  into v_result
  from public.meeting_bot_sessions s
  where s.tenant_id = v_tenant
  limit 100;

  return v_result;
end;
$$;

revoke all on function public.portal_list_meeting_bot_sessions from public, anon;
grant execute on function public.portal_list_meeting_bot_sessions to authenticated;

COMMIT;
