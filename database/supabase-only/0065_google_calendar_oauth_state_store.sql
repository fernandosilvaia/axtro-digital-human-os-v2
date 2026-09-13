BEGIN;

-- D-V2-174: o `state` do OAuth vivia num Map de processo que os dois lados do
-- fluxo nunca compartilharam.
--
-- O DEFEITO
-- `apps/portal/src/lib/google-calendar/oauth-state.ts` guardava os `state`
-- pendentes num `Map` em memoria de processo. Quem GRAVA e a Server Action
-- `startGoogleCalendarConnection`; quem LE e o route handler
-- `api/google-calendar/oauth/callback`. No Next.js esses dois sao empacotados
-- separadamente, entao cada um carrega a propria instancia do modulo e o
-- proprio Map. O que a Action grava, o callback nunca enxerga.
--
-- MEDIDO EM PRODUCAO (2026-09-13): gerei um `state` novo e chamei o callback
-- 5 segundos depois, mesma sessao, mesmo navegador, `numReplicas: 1`, uma
-- unica instancia rodando e nenhum restart no intervalo. Resultado:
-- `state_invalido`. Ou seja, a conexao do Google Calendar nunca pode ser
-- concluida desde que foi construida, e por isso o defeito de
-- `app_metadata.actor_id` (0064) tambem nunca tinha aparecido: o fluxo nao
-- chegava longe o bastante para expo-lo.
--
-- O arquivo original ANTECIPOU o risco de multiplas replicas e documentou a
-- ressalva. O modo de falha real e outro e acontece com uma instancia so.
--
-- POR QUE TABELA E NAO COOKIE
-- Cookie assinado tambem resolveria, e ate amarra o fluxo ao navegador que o
-- iniciou, o que um Map no servidor nunca fez. Mas o callback compara
-- `tenantId`/`actorId` do state com os da sessao viva, e essa comparacao so
-- vale se o par for a prova de adulteracao. Assinar exigiria uma chave nova
-- em ambiente, e derivar chave de uma credencial existente seria pior. Tabela
-- e o padrao que o resto do dominio ja usa para estado sensivel, nao precisa
-- de segredo novo, sobrevive a restart e a replica, e e auditavel.
--
-- POR QUE GUARDA HASH E NAO O TOKEN
-- Mesma disciplina de `portal_resolve_agent_brain_config_service`, que casa
-- por hash do segredo: quem consegue ler a tabela nao consegue completar um
-- fluxo pendente de ninguem. O token de 256 bits so existe em transito.
--
-- ANTI-ORACULO
-- Consumir devolve o MESMO `not_found` para nunca existiu, ja foi usado e
-- expirou. O chamador nao precisa distinguir os tres e o atacante nao pode
-- usar a resposta para descobrir se acertou um token.

create table if not exists public.google_calendar_oauth_states (
  state_hash text primary key,
  tenant_id app.uuid_v7 not null references public.tenants(id) on delete cascade,
  actor_id app.uuid_v7 not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint google_calendar_oauth_states_hash_chk check (state_hash ~ '^[0-9a-f]{64}$'),
  constraint google_calendar_oauth_states_ttl_chk
    check (expires_at > created_at and expires_at <= created_at + interval '10 minutes')
);

create index if not exists google_calendar_oauth_states_tenant_created_idx
  on public.google_calendar_oauth_states (tenant_id, created_at);

-- Nenhum papel de cliente toca esta tabela: o acesso legitimo e so pelas duas
-- RPC abaixo, que rodam como service_role a partir do servidor.
alter table public.google_calendar_oauth_states enable row level security;
alter table public.google_calendar_oauth_states force row level security;
revoke all on table public.google_calendar_oauth_states from public, anon, authenticated, service_role;

/**
 * Abre um `state` pendente. Alem de inserir, faz a faxina que o Map fazia em
 * memoria: remove expirados e aplica o teto por tenant.
 *
 * O teto por tenant existe pelo mesmo achado da revisao adversarial que gerou
 * `MAX_TRACKED_STATES_PER_TENANT` no arquivo original: sem ele, um tenant que
 * abre fluxos sem nunca concluir acumula linhas indefinidamente. Aqui o
 * excedente e podado por tenant, entao um tenant nunca afeta o `state`
 * pendente de outro.
 */
create or replace function public.portal_begin_google_calendar_oauth_state_service(
  p_state_hash text,
  p_tenant_id app.uuid_v7,
  p_actor_id app.uuid_v7,
  p_ttl_seconds integer default 600
) returns jsonb
language plpgsql
volatile
security definer
set search_path = 'public'
as $$
declare
  c_max_per_tenant constant integer := 8;
begin
  if p_state_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'state_hash must be sha256 hex' using errcode = '22023';
  end if;
  if p_ttl_seconds is null or p_ttl_seconds < 60 or p_ttl_seconds > 600 then
    raise exception 'ttl must be 60..600 seconds' using errcode = '22023';
  end if;

  delete from public.google_calendar_oauth_states where expires_at <= now();

  delete from public.google_calendar_oauth_states s
  where s.tenant_id = p_tenant_id
    and s.state_hash in (
      select old.state_hash
      from public.google_calendar_oauth_states old
      where old.tenant_id = p_tenant_id
      order by old.created_at desc, old.state_hash desc
      offset c_max_per_tenant - 1
    );

  insert into public.google_calendar_oauth_states (state_hash, tenant_id, actor_id, expires_at)
  values (p_state_hash, p_tenant_id, p_actor_id, now() + make_interval(secs => p_ttl_seconds));

  return jsonb_build_object('ok', true);
end;
$$;

/**
 * Consome (remove) e valida. Uso unico: o DELETE ... RETURNING garante que
 * duas chamadas concorrentes com o mesmo hash nunca sejam ambas bem
 * sucedidas, o que o `Map.get` seguido de `Map.delete` do original nao
 * garantia sozinho.
 */
create or replace function public.portal_consume_google_calendar_oauth_state_service(
  p_state_hash text
) returns jsonb
language plpgsql
volatile
security definer
set search_path = 'public'
as $$
declare
  v_row public.google_calendar_oauth_states%rowtype;
begin
  if p_state_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  delete from public.google_calendar_oauth_states s
  where s.state_hash = p_state_hash
  returning s.* into v_row;

  if v_row.state_hash is null or v_row.expires_at <= now() then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  return jsonb_build_object(
    'outcome', 'found',
    'tenantId', v_row.tenant_id,
    'actorId', v_row.actor_id
  );
end;
$$;

revoke all on function public.portal_begin_google_calendar_oauth_state_service(text,app.uuid_v7,app.uuid_v7,integer)
  from public, anon, authenticated;
revoke all on function public.portal_consume_google_calendar_oauth_state_service(text)
  from public, anon, authenticated;
grant execute on function public.portal_begin_google_calendar_oauth_state_service(text,app.uuid_v7,app.uuid_v7,integer)
  to service_role;
grant execute on function public.portal_consume_google_calendar_oauth_state_service(text)
  to service_role;

COMMIT;
