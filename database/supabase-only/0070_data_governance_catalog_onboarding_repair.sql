begin;

-- Repara um buraco de onboarding no catalogo de governanca de dados (M6-04,
-- 0059): 6 tabelas tenant-scoped criadas DEPOIS da 0059 (0065: o oauth state
-- store do Google Calendar; 0069: as quatro tabelas do checkout via Stripe
-- Connect) nunca foram somadas a public.data_governance_resource_catalog.
--
-- app.data_governance_catalog_complete() compara TODA tabela em public com
-- coluna tenant_id contra o catalogo (surface='database') e falha se
-- sobrar alguma de qualquer lado. Com as 6 de fora, essa funcao sempre
-- devolvia falso, e portanto o botao "Exclusao de dados do tenant"
-- (Configuracoes -> requestTenantDataGovernanceDisposition em
-- apps/portal/src/lib/actions/data-governance-disposition.ts) nunca saia de
-- { outcome: "not_ready", reason: "catalog_incomplete" }, pra nenhum
-- tenant, em nenhum ambiente. Essa checagem e puramente derivada do schema
-- (information_schema.columns), sem nenhum dado especifico de ambiente,
-- entao o mesmo buraco existe no projeto hospedado.
--
-- POR QUE catalog_generation='pre_v59' E NAO 'v59_control'
-- O check constraint de catalog_generation so aceita
-- ('pre_v59','v59_control','external'). Nenhum dos tres nomes descreve bem
-- "tabela de negocio criada depois da v59", mas 'pre_v59' e o unico que
-- participa dos LOOPS REAIS de inventario/exclusao tenant-wide
-- (app.data_governance_inventory_complete, app.data_governance_database_absent,
-- e o proprio bloco de derivacao de deletion_order abaixo): todos filtram
-- explicitamente catalog_generation='pre_v59'. Cadastrar como 'v59_control'
-- faria catalog_complete() voltar a true sem que estas 6 tabelas jamais
-- fossem de fato inventariadas ou apagadas numa exclusao tenant-wide real:
-- pior que o bug atual, porque passaria a MENTIR que a exclusao aconteceu.
-- 'pre_v59' e a classificacao correta: sao tabelas de negocio tenant-scoped
-- comuns, exatamente o que o resto da familia 'pre_v59' ja e.
--
-- CONSEQUENCIA 1 (contagem exata): app.data_governance_catalog_complete()
-- exige exatamente 86 linhas catalog_generation='pre_v59' -- contagem
-- literal do dia em que a 0059 foi escrita. Com as 6 novas fica 92; a
-- funcao e recriada abaixo com o numero certo.
--
-- CONSEQUENCIA 2 (deletion_order): o bloco de derivacao por grafo de FK da
-- 0059 rodou UMA UNICA VEZ, no apply da propria 0059, sobre as 86 tabelas
-- que existiam entao. As migrations 0065/0069 acrescentaram FKs novas ao
-- grafo (as 4 tabelas de checkout entre si e contra
-- tenants/agents/sessions/session_participants/grants/leads/
-- user_tenant_memberships, e portal_business_action_receipts
-- ganhou checkout_reservation_id, apontando PRA checkout_reservations) sem
-- que ninguem rederivasse deletion_order. Isso torna pelo menos duas linhas
-- antigas ("folha", deletion_order=20/24 respectivamente) estruturalmente
-- desatualizadas: portal_business_action_leads passa a ter
-- checkout_reservations como filho novo, e portal_business_action_grants
-- tambem. Escolher deletion_order a mao pras 6 linhas novas sem corrigir as
-- antigas arriscaria violar a invariante child.deletion_order<parent.deletion_order
-- numa exclusao real. Em vez disso, este arquivo roda de novo, byte a byte,
-- a MESMA derivacao por grafo de FK da 0059 (mesmo cycle-break de
-- sessions_active_presenter_fk), agora sobre as 92 linhas
-- catalog_generation='pre_v59' -- inclui as 6 novas e recalcula, de forma
-- comprovadamente topologica (o proprio bloco se auto-verifica e aborta a
-- transacao inteira se algo ficar inconsistente), as linhas antigas afetadas
-- pelas FKs novas. Isso muda deletion_order de varias linhas pre-existentes,
-- nao só das 6 novas: e a correcao certa, nao uma migration destrutiva --
-- nenhuma linha de DADO de tenant e tocada, so metadados do catalogo.
--
-- Classificacao das 6 linhas, por precedente direto (relatorio completo na
-- entrega desta tarefa):
--   db_google_calendar_oauth_states: sem coluna id uuid (PK e state_hash) ->
--     locator_strategy tenant_relation, mesmo padrao de
--     db_billing_stripe_event_receipts. Guarda so um hash + expiry de 10
--     minutos, sem segredo reversivel, e ja tem faxina propria (apaga
--     expirados a cada novo state aberto). irreversible_delete, sem
--     subject_link_required (o unico "sujeito" da linha e actor_id, um
--     operador do tenant, nunca um data subject externo) e sem
--     retained_exception (nao serve como evidencia de auditoria de longo
--     prazo).
--   db_portal_business_action_checkout_connections: mesmo papel de
--     db_portal_business_action_calendar_connections, mas SEM segredo (o
--     proprio header da 0069 documenta que o access_token OAuth da Stripe e
--     descartado pela aplicacao; a tabela so guarda stripe_account_id, que
--     nao e secreto) -> irreversible_delete, nao crypto_erase (nao ha nada
--     pra crypto-apagar).
--   db_portal_business_action_checkout_products: catalogo de produtos do
--     tenant_admin, sem dado pessoal -> irreversible_delete, mesmo padrao de
--     configuracao/catalogo tenant-scoped (ex.: db_agent_video_config).
--   db_portal_business_action_checkout_reservations: espelha
--     db_portal_business_action_calendar_reservations linha a linha (mesmo
--     ADR-039/040, mesmo autor, mesmo shape: FK pra agent/session/presenter/
--     grant, maquina de estado de reserva, contact_email opcional) ->
--     redact, subject_link_required=true. Ambiguidade real (ver relatorio):
--     diferente da irma de calendario, esta tabela carrega valores de
--     pagamento reais (amount_total_cents, stripe_charge_id); redact ainda
--     preserva a linha (so apaga PII), mas retain_content_free +
--     retained_exception=true (o padrao das tabelas de evidencia
--     financeira, ex.: db_billing_checkout_intents) tambem seria defensavel
--     se existir uma obrigacao fiscal de retencao. Fica para o Fernando
--     decidir com contexto juridico que este arquivo nao tem.
--   db_portal_business_action_checkout_reconcile_approvals: espelha
--     db_portal_business_action_meeting_reconcile_approvals coluna a coluna
--     (reconciliacao dual-operador) -> retain_content_free,
--     subject_link_required=true, retained_exception=true.
--   db_portal_business_action_checkout_stripe_event_receipts: dedup de
--     webhook por event_id (sem coluna id uuid), mesmo papel de
--     db_billing_stripe_event_receipts -> retain_content_free,
--     retained_exception=true, sem subject_link_required (account.updated
--     nao e sobre uma pessoa; os eventos de checkout.session.* sao
--     evidencia do provider de pagamento, nao um registro pessoal por si).
insert into public.data_governance_resource_catalog(
  resource_code,surface,relation_name,catalog_generation,default_action,
  subject_link_required,retained_exception,inventory_order,deletion_order,
  locator_strategy,resource_class,verification_method,subject_redaction_strategy,
  projection_version
) values
  ('db_google_calendar_oauth_states','database','public.google_calendar_oauth_states','pre_v59','irreversible_delete',false,false,106,20,'tenant_relation','configuration','sql_absence','none','row-absence@1'),
  ('db_portal_business_action_checkout_connections','database','public.portal_business_action_checkout_connections','pre_v59','irreversible_delete',false,false,107,20,'uuid_id','action_evidence','sql_absence','none','row-absence@1'),
  ('db_portal_business_action_checkout_products','database','public.portal_business_action_checkout_products','pre_v59','irreversible_delete',false,false,108,20,'uuid_id','action_evidence','sql_absence','none','row-absence@1'),
  ('db_portal_business_action_checkout_reservations','database','public.portal_business_action_checkout_reservations','pre_v59','redact',true,false,109,20,'uuid_id','action_evidence','sql_absence','none','row-absence@1'),
  ('db_portal_business_action_checkout_reconcile_approvals','database','public.portal_business_action_checkout_reconcile_approvals','pre_v59','retain_content_free',true,true,110,20,'uuid_id','action_evidence','typed_content_free_scan','none','row-absence@1'),
  ('db_portal_business_action_checkout_stripe_event_receipts','database','public.portal_business_action_checkout_stripe_event_receipts','pre_v59','retain_content_free',false,true,111,20,'tenant_relation','action_evidence','typed_content_free_scan','none','row-absence@1')
on conflict (resource_code) do nothing;

-- Rederiva deletion_order por grafo de FK real, byte a byte igual ao bloco
-- da 0059 (mesmo cycle-break de sessions_active_presenter_fk), agora sobre
-- as 92 linhas catalog_generation='pre_v59' (86 antigas + 6 novas). O bloco
-- se auto-verifica no final e aborta a transacao inteira (raise exception)
-- se a ordem resultante nao for topologica -- reaplicar este arquivo nunca
-- pode deixar uma ordem de exclusao invalida sem que a migration inteira
-- falhe primeiro.
do $derive_data_governance_deletion_order_v70$
declare v_cycle text;
begin
  with recursive fk_edges as (
      select child.relation_name child_relation,parent.relation_name parent_relation
      from pg_constraint fk
      join public.data_governance_resource_catalog child
        on fk.conrelid=to_regclass(child.relation_name)
       and child.catalog_generation='pre_v59'
      join public.data_governance_resource_catalog parent
        on fk.confrelid=to_regclass(parent.relation_name)
       and parent.catalog_generation='pre_v59'
      where fk.contype='f' and child.relation_name<>parent.relation_name
        and not (
          fk.conname='sessions_active_presenter_fk'
          and fk.conrelid='public.sessions'::regclass
          and fk.confrelid='public.session_participants'::regclass
        )
    ), walk(start_relation,current_relation,path,cycle) as (
      select e.child_relation,e.parent_relation,
             array[e.child_relation,e.parent_relation]::text[],false
      from fk_edges e
      union all
      select w.start_relation,e.parent_relation,w.path||e.parent_relation,
             e.parent_relation=any(w.path)
      from walk w
      join fk_edges e on e.child_relation=w.current_relation
      where not w.cycle
    )
  select array_to_string(path,' -> ') into v_cycle
  from walk where cycle limit 1;
  if v_cycle is not null then
    raise exception 'data governance deletion graph contains a foreign-key cycle: %',v_cycle using errcode='55000';
  end if;

  with recursive fk_edges as (
    select child.relation_name child_relation,parent.relation_name parent_relation
    from pg_constraint fk
    join public.data_governance_resource_catalog child
      on fk.conrelid=to_regclass(child.relation_name)
     and child.catalog_generation='pre_v59'
    join public.data_governance_resource_catalog parent
      on fk.confrelid=to_regclass(parent.relation_name)
     and parent.catalog_generation='pre_v59'
    where fk.contype='f' and child.relation_name<>parent.relation_name
      and not (
        fk.conname='sessions_active_presenter_fk'
        and fk.conrelid='public.sessions'::regclass
        and fk.confrelid='public.session_participants'::regclass
      )
  ), descendants(root_relation,current_relation,depth,path) as (
    select c.relation_name,c.relation_name,0,array[c.relation_name]::text[]
    from public.data_governance_resource_catalog c
    where c.catalog_generation='pre_v59' and c.surface='database'
    union all
    select d.root_relation,e.child_relation,d.depth+1,d.path||e.child_relation
    from descendants d
    join fk_edges e on e.parent_relation=d.current_relation
    where not e.child_relation=any(d.path)
  ), ranks as (
    select root_relation,max(depth) deletion_depth
    from descendants
    group by root_relation
  )
  update public.data_governance_resource_catalog c
  set deletion_order=20+r.deletion_depth
  from ranks r
  where c.catalog_generation='pre_v59' and c.relation_name=r.root_relation;

  if exists(
    select 1
    from pg_constraint fk
    join public.data_governance_resource_catalog child
      on fk.conrelid=to_regclass(child.relation_name)
     and child.catalog_generation='pre_v59'
    join public.data_governance_resource_catalog parent
      on fk.confrelid=to_regclass(parent.relation_name)
     and parent.catalog_generation='pre_v59'
    where fk.contype='f' and child.relation_name<>parent.relation_name
      and not (
        fk.conname='sessions_active_presenter_fk'
        and fk.conrelid='public.sessions'::regclass
        and fk.confrelid='public.session_participants'::regclass
      )
      and child.deletion_order>=parent.deletion_order
  ) then
    raise exception 'data governance deletion order is not foreign-key topological' using errcode='55000';
  end if;
end
$derive_data_governance_deletion_order_v70$;

-- app.data_governance_catalog_complete() exigia exatamente 86 linhas
-- catalog_generation='pre_v59'; agora sao 92. create or replace preserva os
-- grants atuais (a funcao ja nao tem EXECUTE pra nenhuma role, revogada em
-- bloco pela 0059 via app.data_governance_%); reafirmado abaixo mesmo assim,
-- por disciplina, e nao por desconfianca do CREATE OR REPLACE.
create or replace function app.data_governance_catalog_complete()
returns boolean language sql stable security definer set search_path='' as $$
  with tenant_relations as (
    select 'public.'||c.table_name relation_name
    from information_schema.columns c
    where c.table_schema='public' and c.column_name='tenant_id'
    union all select 'public.tenants'
  ), catalog_relations as (
    select relation_name from public.data_governance_resource_catalog where surface='database'
  )
  select
    (select count(*) from public.data_governance_resource_catalog where catalog_generation='pre_v59')=92
    and (select count(*) from public.data_governance_resource_catalog where catalog_generation='external')=7
    and app.data_governance_cycle_break_complete()
    and not exists(
      (select relation_name from tenant_relations)
      except
      (select relation_name from catalog_relations)
    )
    and not exists(
      (select relation_name from catalog_relations)
      except
      (select relation_name from tenant_relations)
    )
    and not exists(
      select 1 from public.data_governance_resource_catalog c
      where c.surface='database' and to_regclass(c.relation_name) is null
    )
    and exists(
      select 1 from public.data_governance_resource_catalog c
      where c.resource_code='db_conversation_transcripts'
        and c.projection_version='conversation-transcript-redaction@1'
        and c.relation_shape_fingerprint=app.data_governance_relation_shape_fingerprint(
          'public.conversation_transcripts'::regclass
        )
    )
    and not exists(
      select 1
      from pg_constraint fk
      join public.data_governance_resource_catalog child
        on fk.conrelid=to_regclass(child.relation_name)
       and child.catalog_generation='pre_v59'
      join public.data_governance_resource_catalog parent
        on fk.confrelid=to_regclass(parent.relation_name)
       and parent.catalog_generation='pre_v59'
      where fk.contype='f' and child.relation_name<>parent.relation_name
        and not (
          fk.conname='sessions_active_presenter_fk'
          and fk.conrelid='public.sessions'::regclass
          and fk.confrelid='public.session_participants'::regclass
        )
        and child.deletion_order>=parent.deletion_order
    )
$$;
revoke all on function app.data_governance_catalog_complete() from public,anon,authenticated,service_role;

-- Encadeamento de portal_schema_capabilities_service(): mesmo padrao de toda
-- migration anterior que tocou esta funcao (0056/0058/0059/0069). So
-- corrige a chave estatica que ficou obsoleta (85 -> 91, contagem pre_v59
-- exceto tenants) e soma um fato novo de onboarding do catalogo; nao
-- acrescenta tabela nem RPC.
alter function public.portal_schema_capabilities_service() set schema app;
alter function app.portal_schema_capabilities_service() rename to portal_schema_capabilities_v69;
revoke all on function app.portal_schema_capabilities_v69() from public,anon,authenticated,service_role;

create or replace function public.portal_schema_capabilities_service()
returns jsonb language sql stable security definer set search_path='' as $$
  select (app.portal_schema_capabilities_v69()-'version')||jsonb_build_object(
    'version',70,
    'dataGovernanceHistoricalTenantRelations',(
      select count(*) from public.data_governance_resource_catalog where catalog_generation='pre_v59' and relation_name<>'public.tenants'
    )=91,
    'dataGovernanceCatalogOnboardingRepaired',
      app.data_governance_catalog_complete()
      and (select count(*) from public.data_governance_resource_catalog where catalog_generation='pre_v59')=92
  )
$$;
revoke all on function public.portal_schema_capabilities_service() from public,anon,authenticated;
grant execute on function public.portal_schema_capabilities_service() to service_role;

commit;
