BEGIN;

-- D-V2-174: `app_metadata.actor_id` era lido em cinco lugares e escrito em nenhum.
--
-- O DEFEITO
-- Cinco caminhos do portal leem `user.app_metadata.actor_id` para provar qual
-- ator do tenant esta agindo:
--   apps/portal/src/lib/actions/calendar-connection.ts (conectar e desconectar)
--   apps/portal/src/app/api/google-calendar/oauth/callback/route.ts
--   apps/portal/src/lib/paid-effects/index.ts
--   apps/portal/src/lib/actions/video-conversation.ts
-- Nenhum lugar do repositorio JAMAIS gravou esse campo. `actor_id` sempre
-- existiu em `user_tenant_memberships`, nunca no JWT, entao a leitura sempre
-- devolvia null.
--
-- MEDIDO EM PRODUCAO ANTES DA CORRECAO (2026-09-13): as duas contas do
-- sistema, incluindo a `demo@axtroai.com` provisionada em julho, tinham
-- `raw_app_meta_data->>'actor_id'` nulo.
--
-- O QUE ISSO QUEBRAVA
-- 1. Conectar Google Calendar: falhava sempre em `sessao_invalida`. Como
--    `propose_meeting_slots` depende da conexao, a agenda do funil ADR-039
--    estava bloqueada na origem.
-- 2. Encerrar efeito pago de provider (`paid-effects`): devolvia sempre
--    `not_stoppable`. O matador estaria inerte em silencio no dia em que
--    `PORTAL_PROVIDER_TERMINATION_ENABLED` fosse ligada. Este e o mais grave
--    dos dois, porque um matador que responde "nao da pra parar" e
--    indistinguivel de um matador que nao existe.
-- 3. Chamada de video: degrada sem erro, o campo e opcional la.
--
-- A CORRECAO
-- `provision_self_serve_tenant` e o unico ponto do sistema que cria uma
-- associacao usuario/tenant, entao e o lugar certo para publicar a claim: a
-- gravacao acontece na MESMA transacao que insere a associacao, e nao existe
-- caminho em que uma exista sem a outra.
--
-- A sincronizacao tambem roda no early return (usuario que ja tem tenant).
-- Isso torna a funcao auto-curativa: qualquer usuario cujo claim tenha ficado
-- para tras por um caminho que nao previmos volta ao normal na proxima
-- chamada, sem migration nova.
--
-- ONDE A CLAIM APARECE
-- `raw_app_meta_data` e o lugar controlado pela aplicacao que o Supabase
-- embute no JWT. E `app_metadata`, nao `user_metadata`, de proposito: o
-- usuario final pode editar o segundo, e um `actor_id` editavel pelo proprio
-- usuario seria escalacao de privilegio, nao conveniencia.
--
-- IMPORTANTE PARA QUEM FOR TESTAR
-- O JWT e emitido no login. Um usuario ja logado quando esta migration roda
-- so passa a carregar a claim depois que o token for renovado ou refeito o
-- login. O backfill abaixo corrige o dado; a sessao aberta ainda carrega o
-- token antigo por ate um ciclo de refresh.
--
-- ESCOPO
-- Sem tabela nova, sem assinatura alterada, sem permissao alterada. A
-- capability version nao sobe, mesmo precedente de 0055, 0060, 0061 e 0062.

create or replace function public.provision_self_serve_tenant(
  p_tenant_id app.uuid_v7,
  p_actor_id app.uuid_v7,
  p_slug text,
  p_legal_name text,
  p_home_region text,
  p_default_language text,
  p_default_timezone text
) returns app.uuid_v7
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_tenant_id app.uuid_v7;
  existing_actor_id app.uuid_v7;
  v_email text;
  v_invite record;
begin
  if auth.uid() is null then
    raise exception 'provision_self_serve_tenant requires an authenticated caller' using errcode = '28000';
  end if;

  select tenant_id, actor_id into existing_tenant_id, existing_actor_id
  from public.user_tenant_memberships
  where user_id = auth.uid();

  if existing_tenant_id is not null then
    -- Auto-cura: publica a claim de quem ja tinha associacao mas ficou sem ela
    -- (todo usuario provisionado antes desta migration).
    update auth.users u
    set raw_app_meta_data = coalesce(u.raw_app_meta_data, '{}'::jsonb)
                            || jsonb_build_object('actor_id', existing_actor_id::text)
    where u.id = auth.uid()
      and (u.raw_app_meta_data->>'actor_id') is distinct from existing_actor_id::text;
    return existing_tenant_id;
  end if;

  -- Convite pendente para o e-mail confirmado do usuário tem precedência
  -- sobre criar um tenant novo. O mais antigo vence; aceito atomicamente.
  select lower(u.email) into v_email from auth.users u where u.id = auth.uid();

  select i.* into v_invite
  from public.tenant_invites i
  where lower(i.email) = v_email and i.status = 'pending'
  order by i.created_at
  limit 1
  for update;

  if v_invite.id is not null then
    insert into public.user_tenant_memberships (user_id, tenant_id, actor_id, role)
    values (auth.uid(), v_invite.tenant_id, p_actor_id, v_invite.role);

    update public.tenant_invites
    set status = 'accepted', accepted_at = now()
    where id = v_invite.id;

    update auth.users u
    set raw_app_meta_data = coalesce(u.raw_app_meta_data, '{}'::jsonb)
                            || jsonb_build_object('actor_id', p_actor_id::text)
    where u.id = auth.uid();

    return v_invite.tenant_id;
  end if;

  insert into public.tenants (id, slug, legal_name, status, home_region, default_language, default_timezone)
  values (p_tenant_id, p_slug, p_legal_name, 'trial', p_home_region, p_default_language, p_default_timezone);

  insert into public.tenant_settings (tenant_id) values (p_tenant_id);

  insert into public.user_tenant_memberships (user_id, tenant_id, actor_id, role)
  values (auth.uid(), p_tenant_id, p_actor_id, 'tenant_admin');

  update auth.users u
  set raw_app_meta_data = coalesce(u.raw_app_meta_data, '{}'::jsonb)
                          || jsonb_build_object('actor_id', p_actor_id::text)
  where u.id = auth.uid();

  return p_tenant_id;
end;
$$;

revoke all on function public.provision_self_serve_tenant from public, anon;
grant execute on function public.provision_self_serve_tenant to authenticated;

-- Backfill de quem ja existia. Idempotente: so toca linha cujo claim esteja
-- ausente ou divergente da associacao real.
update auth.users u
set raw_app_meta_data = coalesce(u.raw_app_meta_data, '{}'::jsonb)
                        || jsonb_build_object('actor_id', m.actor_id::text)
from public.user_tenant_memberships m
where m.user_id = u.id
  and (u.raw_app_meta_data->>'actor_id') is distinct from m.actor_id::text;

COMMIT;
