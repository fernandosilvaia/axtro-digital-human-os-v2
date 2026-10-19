begin;

-- ADR-051 etapa 2: recibo duravel da admissao da closer da Billion Leads Pro.
--
-- A etapa 1 emite a admissao como token assinado e sem estado. A ADR-038 pede que o aviso de IA
-- fique gravado de forma duravel ANTES do canal existir, e os limites por conta viviam em memoria
-- de processo. Esta migration cria o recibo (uma linha por admissao emitida), o limite diario por
-- conta no banco e a revogacao. Guarda so o HASH da conta do CRM, nunca o identificador cru, o
-- nome ou o contato da pessoa.
--
-- Aditiva: nao altera tabela, funcao nem grant existente e NAO move a versao publicada do schema
-- (o app aceita no maximo a 77). O app fecha em falha se estas funcoes nao existirem.
--
-- POR QUE A TABELA NAO TEM tenant_id: app.data_governance_catalog_complete() compara TODA tabela
-- public com coluna tenant_id contra o catalogo de governanca (contagem exata de linhas). Uma
-- tabela nova com tenant_id deixa o catalogo incompleto e derruba quatro capabilities do portao de
-- prontidao (medido no harness). Este recibo e de PLATAFORMA, nao dado de negocio do tenant: guarda
-- o hash de uma pessoa externa do CRM e metadados da conversa, para um unico agente fixado por env.
-- Em vez de entrar no catalogo (decisao de governanca do dono, pendente), ele tem retencao propria:
-- as funcoes de emissao apagam recibos com mais de 180 dias.
create table if not exists public.billion_closer_admissions (
  id uuid primary key,
  agent_id app.uuid_v7 not null,
  account_hash text not null,
  language text not null,
  interest text not null,
  stage text not null,
  disclosure_version text not null,
  disclosed_at timestamptz not null,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  video_started_at timestamptz,
  constraint billion_closer_admissions_hash_chk check (account_hash ~ '^[0-9a-f]{32}$'),
  constraint billion_closer_admissions_language_chk check (language in ('portuguese','english','spanish')),
  constraint billion_closer_admissions_interest_chk check (interest in ('crm','leads','unknown')),
  constraint billion_closer_admissions_stage_chk check (stage ~ '^[a-z_]{3,32}$'),
  constraint billion_closer_admissions_disclosure_chk check (length(disclosure_version) between 1 and 64),
  constraint billion_closer_admissions_ttl_chk check (expires_at > issued_at and expires_at <= issued_at + interval '6 hours')
);

create index if not exists billion_closer_admissions_account_issued_idx
  on public.billion_closer_admissions (account_hash, issued_at desc);

alter table public.billion_closer_admissions enable row level security;
alter table public.billion_closer_admissions force row level security;
revoke all on table public.billion_closer_admissions from public, anon, authenticated, service_role;

-- Emite o recibo. Recusa acima do teto diario da conta e dentro de 24h de uma revogacao (pedido de
-- parar). O lock por conta serializa duas emissoes concorrentes da mesma pessoa.
create or replace function public.portal_issue_billion_closer_admission_service(
  p_id uuid,
  p_agent_id app.uuid_v7,
  p_account_hash text,
  p_language text,
  p_interest text,
  p_stage text,
  p_disclosure_version text,
  p_disclosed_at timestamptz,
  p_expires_at timestamptz,
  p_max_per_day integer default 6
) returns jsonb
language plpgsql
volatile
security definer
set search_path = 'public'
as $$
begin
  if p_max_per_day is null or p_max_per_day < 1 or p_max_per_day > 50 then
    raise exception 'max per day must be 1..50' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('billion-closer:' || p_account_hash, 0));
  delete from public.billion_closer_admissions where issued_at < now() - interval '180 days';
  if exists (
    select 1 from public.billion_closer_admissions
    where account_hash = p_account_hash and revoked_at is not null and revoked_at > now() - interval '24 hours'
  ) then
    return jsonb_build_object('outcome', 'revoked');
  end if;
  if (
    select count(*) from public.billion_closer_admissions
    where account_hash = p_account_hash and issued_at > now() - interval '24 hours'
  ) >= p_max_per_day then
    return jsonb_build_object('outcome', 'limit');
  end if;
  insert into public.billion_closer_admissions
    (id, agent_id, account_hash, language, interest, stage, disclosure_version, disclosed_at, expires_at)
  values
    (p_id, p_agent_id, p_account_hash, p_language, p_interest, p_stage, p_disclosure_version, p_disclosed_at, p_expires_at);
  return jsonb_build_object('outcome', 'issued');
end;
$$;

-- Confere o recibo a cada uso. A assinatura do token prova a origem; o recibo prova que o aviso
-- foi gravado e que a admissao nao foi revogada nem expirou.
create or replace function public.portal_check_billion_closer_admission_service(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = 'public'
as $$
declare
  v public.billion_closer_admissions;
begin
  select * into v from public.billion_closer_admissions where id = p_id;
  if not found then return jsonb_build_object('valid', false, 'reason', 'not_found'); end if;
  if v.revoked_at is not null then return jsonb_build_object('valid', false, 'reason', 'revoked'); end if;
  if v.expires_at <= now() then return jsonb_build_object('valid', false, 'reason', 'expired'); end if;
  return jsonb_build_object('valid', true, 'reason', 'ok', 'agentId', v.agent_id);
end;
$$;

-- Reserva a sessao de video da admissao. A mesma admissao nunca abre duas vezes (a idempotencia do
-- efeito pago ja garante a mesma sala), e a conta tem um teto diario de salas.
create or replace function public.portal_reserve_billion_closer_video_service(p_id uuid, p_max_per_day integer default 2)
returns jsonb
language plpgsql
volatile
security definer
set search_path = 'public'
as $$
declare
  v public.billion_closer_admissions;
begin
  if p_max_per_day is null or p_max_per_day < 1 or p_max_per_day > 20 then
    raise exception 'max per day must be 1..20' using errcode = '22023';
  end if;
  select * into v from public.billion_closer_admissions where id = p_id for update;
  if not found or v.revoked_at is not null or v.expires_at <= now() then
    return jsonb_build_object('outcome', 'invalid');
  end if;
  if v.video_started_at is not null then return jsonb_build_object('outcome', 'already'); end if;
  perform pg_advisory_xact_lock(hashtextextended('billion-closer:' || v.account_hash, 0));
  if (
    select count(*) from public.billion_closer_admissions
    where account_hash = v.account_hash and video_started_at > now() - interval '24 hours'
  ) >= p_max_per_day then
    return jsonb_build_object('outcome', 'limit');
  end if;
  update public.billion_closer_admissions set video_started_at = now() where id = p_id;
  return jsonb_build_object('outcome', 'reserved');
end;
$$;

-- Pedido de parar: revoga as admissoes vigentes da conta. Devolve quantas foram revogadas.
create or replace function public.portal_revoke_billion_closer_account_service(p_account_hash text)
returns integer
language plpgsql
volatile
security definer
set search_path = 'public'
as $$
declare
  v_count integer;
begin
  if p_account_hash !~ '^[0-9a-f]{32}$' then
    raise exception 'account hash must be 32 hex chars' using errcode = '22023';
  end if;
  update public.billion_closer_admissions set revoked_at = now()
  where account_hash = p_account_hash and revoked_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.portal_issue_billion_closer_admission_service(uuid,app.uuid_v7,text,text,text,text,text,timestamptz,timestamptz,integer) from public, anon, authenticated;
revoke all on function public.portal_check_billion_closer_admission_service(uuid) from public, anon, authenticated;
revoke all on function public.portal_reserve_billion_closer_video_service(uuid,integer) from public, anon, authenticated;
revoke all on function public.portal_revoke_billion_closer_account_service(text) from public, anon, authenticated;
grant execute on function public.portal_issue_billion_closer_admission_service(uuid,app.uuid_v7,text,text,text,text,text,timestamptz,timestamptz,integer) to service_role;
grant execute on function public.portal_check_billion_closer_admission_service(uuid) to service_role;
grant execute on function public.portal_reserve_billion_closer_video_service(uuid,integer) to service_role;
grant execute on function public.portal_revoke_billion_closer_account_service(text) to service_role;

commit;
