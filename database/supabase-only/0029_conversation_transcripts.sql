-- Histórico de conversa (chat/vídeo/reunião externa) — o gap de maior valor
-- deixado de propósito de fora da onda W5 (DECISIONS_LOG D-V2-105): até
-- aqui, NENHUMA conversa que o agente conduz fica registrada pro dono
-- revisar depois — nem o chat de teste, nem uma call de vídeo, nem uma
-- reunião externa real. D-V2-106 fecha isso.
--
-- Uma linha por conversa (não por turno): `turns` é jsonb com o histórico
-- inteiro — mesmo desenho que os 3 providers já devolvem naturalmente
-- (Tavus: array de {role,content,timestamp}; chat sandbox: mesmo shape;
-- Recall: blocos por participante). Evita modelar uma segunda tabela
-- turno-a-turno só pra reescrever a mesma informação que já chega pronta.
--
-- Chave de idempotência: (tenant_id, surface, external_ref). external_ref é
-- o id que cada superfície já tem — client-gerado (uuid) pro chat, o
-- tavus conversation_id pro vídeo, o recall bot_id pra reunião externa.
-- Todo upsert (chat incremental, webhook do Tavus/Recall) escreve por essa
-- chave, nunca duplica.
--
-- Conteúdo é potencialmente PII do lead — mesma disciplina de RLS de toda
-- tabela nova do projeto: FORCE ROW LEVEL SECURITY sem NENHUMA policy,
-- acesso só via RPC SECURITY DEFINER (leitura: auth.uid(); escrita webhook:
-- service_role, resolve a linha só por surface+external_ref).
--
-- ACHADO CRÍTICO da revisão adversarial 2026-08-10 (P0/P1 confirmado por 3
-- dimensões independentes): o índice único original era só
-- (tenant_id, surface, external_ref) — a UPDATE que os webhooks do
-- Tavus/Recall chamam (`portal_append_transcript_turns_service`) resolve a
-- linha SEM tenant_id no WHERE, contando com a suposição de que só existe
-- UMA linha por (surface, external_ref) no mundo inteiro. Sem um índice
-- único GLOBAL garantindo isso, dois tenants podiam (por corrida, ou por
-- um tenant mal-intencionado chamando a RPC autenticada com um
-- external_ref adivinhado/vazado) acabar com linhas colidindo — um único
-- webhook então sobrescreveria as duas em silêncio, vazando o histórico de
-- um lead pro painel do tenant errado. `meeting_bot_sessions` (0021) já
-- tinha a disciplina certa pra essa MESMA classe de id (índice único
-- GLOBAL em recall_bot_id, não por tenant) — esta tabela não seguia o
-- próprio padrão do projeto. Corrigido abaixo: índice único global parcial
-- pra vídeo/reunião (os ids vêm de provider com UM ÚNICO par de chaves de
-- API compartilhado — genuinamente globais, nunca escolhidos pelo tenant)
-- + guarda que RECUSA (não silencia) qualquer match ambíguo.

BEGIN;

create table if not exists public.conversation_transcripts (
  id app.uuid_v7 primary key,
  tenant_id app.uuid_v7 not null,
  agent_id app.uuid_v7 not null,
  surface text not null,
  external_ref text not null,
  turns jsonb not null default '[]'::jsonb,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, agent_id) references public.agents(tenant_id, id) on delete cascade,
  constraint conversation_transcripts_surface_chk check (surface in ('chat', 'video', 'meeting')),
  constraint conversation_transcripts_external_ref_len_chk check (char_length(external_ref) between 1 and 255),
  constraint conversation_transcripts_turns_is_array_chk check (jsonb_typeof(turns) = 'array')
);

create unique index if not exists conversation_transcripts_tenant_surface_ref_idx
  on public.conversation_transcripts (tenant_id, surface, external_ref);
-- Índice único GLOBAL (sem tenant_id) pra vídeo/reunião: o external_ref
-- dessas duas superfícies é gerado pelo provider (Tavus conversation_id,
-- Recall bot_id) sob uma ÚNICA chave de API compartilhada da plataforma —
-- é genuinamente global, nunca escolhido pelo tenant. A superfície 'chat'
-- fica de fora de propósito: seu external_ref é um uuid gerado no client
-- (crypto.randomUUID()) e a escrita já é 100% tenant-scoped via auth.uid()
-- em portal_upsert_conversation_transcript — não passa pelo caminho
-- tenant-less do webhook, não precisa da mesma garantia.
create unique index if not exists conversation_transcripts_global_surface_ref_idx
  on public.conversation_transcripts (surface, external_ref)
  where surface in ('video', 'meeting');
create index if not exists conversation_transcripts_tenant_agent_idx
  on public.conversation_transcripts (tenant_id, agent_id, started_at desc);

alter table public.conversation_transcripts enable row level security;
alter table public.conversation_transcripts force row level security;

-- Valida o shape de `turns` (achado P2 da revisão adversarial 2026-08-10):
-- sem isso, um provider malformado ou uma chamada direta da RPC
-- autenticada podia gravar lixo que quebraria a tela de detalhe (dado
-- não-validado renderizado direto). Compartilhada pelas duas RPCs de
-- escrita — mesmo teto de tamanho dos parsers de app (Tavus MAX_TURN_CHARS
-- e o teto de turno do brain), com folga.
create or replace function app.validate_transcript_turns(p_turns jsonb)
returns void
language plpgsql
as $$
begin
  if jsonb_array_length(p_turns) > 1000 then
    raise exception 'turns array exceeds the sanity cap (1000)' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_turns) as elem
    where jsonb_typeof(elem) <> 'object'
      or (elem->>'role') not in ('user', 'assistant')
      or jsonb_typeof(elem->'content') <> 'string'
      or char_length(elem->>'content') = 0
      or char_length(elem->>'content') > 8000
  ) then
    raise exception 'turns contains a malformed element (expected {role: user|assistant, content: 1..8000 chars})' using errcode = '22023';
  end if;
end;
$$;

-- Escrita autenticada: usada pelo chat sandbox (a única superfície onde o
-- conteúdo passa pela nossa sessão de usuário, não por webhook). Upsert
-- substitui `turns` por inteiro a cada chamada — o chamador (server action)
-- já manda o histórico completo, mesma disciplina de idempotência do resto.
create or replace function public.portal_upsert_conversation_transcript(
  p_id app.uuid_v7,
  p_agent_id app.uuid_v7,
  p_surface text,
  p_external_ref text,
  p_turns jsonb,
  p_ended_at timestamptz default null
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
  if p_surface not in ('chat', 'video', 'meeting') then
    raise exception 'invalid surface' using errcode = '22023';
  end if;
  if jsonb_typeof(p_turns) is distinct from 'array' then
    raise exception 'turns must be a jsonb array' using errcode = '22023';
  end if;
  perform app.validate_transcript_turns(p_turns);
  select exists(select 1 from public.agents where tenant_id = v_tenant and id = p_agent_id) into v_agent_exists;
  if not v_agent_exists then
    raise exception 'agent not found for this account' using errcode = '42501';
  end if;

  insert into public.conversation_transcripts (id, tenant_id, agent_id, surface, external_ref, turns, ended_at)
  values (p_id, v_tenant, p_agent_id, p_surface, p_external_ref, p_turns, p_ended_at)
  on conflict (tenant_id, surface, external_ref) do update set
    turns = excluded.turns,
    ended_at = coalesce(excluded.ended_at, conversation_transcripts.ended_at),
    updated_at = now();

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.portal_upsert_conversation_transcript from public, anon;
grant execute on function public.portal_upsert_conversation_transcript to authenticated;

-- Escrita service-role: usada pelos webhooks do Tavus e do Recall.ai (sem
-- auth.uid(), sem sessão nenhuma). Deliberadamente NÃO recebe tenant_id do
-- chamador — um webhook externo não é fonte confiável de qual tenant é
-- dono da conversa (Art. 9). Em vez disso resolve a linha SÓ por
-- (surface, external_ref): a linha PRECISA já existir, criada no momento
-- em que a conversa/bot nasceu (contexto autenticado, tenant conhecido de
-- verdade) — vídeo em video-conversation.ts, reunião em meeting-bot.ts,
-- ambos chamando portal_upsert_conversation_transcript acima na criação.
-- Sem linha prévia, o webhook não tem como inventar o tenant — found=false,
-- fica visível no log do caller, nunca grava um tenant adivinhado.
create or replace function public.portal_append_transcript_turns_service(
  p_surface text,
  p_external_ref text,
  p_turns jsonb,
  p_ended_at timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_row_count integer;
begin
  if p_surface not in ('chat', 'video', 'meeting') then
    raise exception 'invalid surface' using errcode = '22023';
  end if;
  if jsonb_typeof(p_turns) is distinct from 'array' then
    raise exception 'turns must be a jsonb array' using errcode = '22023';
  end if;
  perform app.validate_transcript_turns(p_turns);

  update public.conversation_transcripts
  set turns = p_turns,
      ended_at = coalesce(p_ended_at, ended_at),
      updated_at = now()
  where surface = p_surface and external_ref = p_external_ref;

  get diagnostics v_row_count = row_count;
  -- Nunca deveria acontecer com o índice único global acima — mas se
  -- acontecer (corrida, dado legado, bug futuro), RECUSA em vez de
  -- escrever o mesmo conteúdo em cima de mais de uma linha/tenant em
  -- silêncio (achado P0/P1 da revisão adversarial 2026-08-10).
  if v_row_count > 1 then
    raise exception 'ambiguous transcript match for surface=%, external_ref=% (% rows)', p_surface, p_external_ref, v_row_count
      using errcode = '42501';
  end if;
  return jsonb_build_object('found', v_row_count > 0);
end;
$$;

revoke all on function public.portal_append_transcript_turns_service from public, anon, authenticated;
grant execute on function public.portal_append_transcript_turns_service to service_role;

-- Resolve o nome do agente a partir do recall_bot_id (join com
-- meeting_bot_sessions, 0021) — usado pelo webhook de transcrição da
-- Recall.ai pra distinguir a fala do AGENTE (bot, casa com o nome) da fala
-- do lead/outros participantes reais nos blocos que a Recall devolve por
-- participante (não há role explícito como no Tavus, só nome).
create or replace function public.portal_get_meeting_bot_agent_service(
  p_recall_bot_id text
) returns jsonb
language plpgsql
stable
security definer
set search_path = 'public'
as $$
declare
  v_result jsonb;
begin
  select jsonb_build_object('tenantId', s.tenant_id, 'agentId', s.agent_id, 'agentName', a.name)
  into v_result
  from public.meeting_bot_sessions s
  join public.agents a on a.tenant_id = s.tenant_id and a.id = s.agent_id
  where s.recall_bot_id = p_recall_bot_id;

  return v_result;
end;
$$;

revoke all on function public.portal_get_meeting_bot_agent_service from public, anon, authenticated;
grant execute on function public.portal_get_meeting_bot_agent_service to service_role;

-- Leitura: lista as conversas do tenant (mais recentes primeiro), sem o
-- conteúdo de `turns` (fica pesado pra lista) — só o resumo pra escolher
-- qual abrir. Filtro opcional por agente.
create or replace function public.portal_list_conversation_transcripts(
  p_agent_id app.uuid_v7 default null,
  p_limit integer default 50
) returns jsonb
language plpgsql
stable
security definer
set search_path = 'public'
as $$
declare
  v_tenant app.uuid_v7;
  v_limit integer;
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  select tenant_id into v_tenant from public.user_tenant_memberships where user_id = auth.uid();
  if v_tenant is null then
    return '[]'::jsonb;
  end if;
  v_limit := least(greatest(coalesce(p_limit, 50), 1), 200);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id,
    'agentId', t.agent_id,
    'agentName', a.name,
    'surface', t.surface,
    'turnCount', jsonb_array_length(t.turns),
    'startedAt', t.started_at,
    'endedAt', t.ended_at
  ) order by t.started_at desc), '[]'::jsonb)
  into v_result
  from public.conversation_transcripts t
  join public.agents a on a.tenant_id = t.tenant_id and a.id = t.agent_id
  where t.tenant_id = v_tenant
    and (p_agent_id is null or t.agent_id = p_agent_id)
  limit v_limit;

  return v_result;
end;
$$;

revoke all on function public.portal_list_conversation_transcripts from public, anon;
grant execute on function public.portal_list_conversation_transcripts to authenticated;

-- Leitura de detalhe: uma conversa inteira (com `turns`), scoped ao tenant.
create or replace function public.portal_get_conversation_transcript(
  p_id app.uuid_v7
) returns jsonb
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
    raise exception 'no tenant provisioned' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'id', t.id,
    'agentId', t.agent_id,
    'agentName', a.name,
    'surface', t.surface,
    'turns', t.turns,
    'startedAt', t.started_at,
    'endedAt', t.ended_at
  )
  into v_result
  from public.conversation_transcripts t
  join public.agents a on a.tenant_id = t.tenant_id and a.id = t.agent_id
  where t.tenant_id = v_tenant and t.id = p_id;

  if v_result is null then
    raise exception 'transcript not found for this account' using errcode = '42501';
  end if;

  return v_result;
end;
$$;

revoke all on function public.portal_get_conversation_transcript from public, anon;
grant execute on function public.portal_get_conversation_transcript to authenticated;

COMMIT;
