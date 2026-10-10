begin;

-- Publica no portao de prontidao o que 0074, 0075 e 0076 entregaram.
--
-- Essas tres migrations nao mudam a versao do schema nem publicam capability,
-- entao /api/ready ficava verde com a busca hibrida ausente (RAG vazio em
-- silencio), com o projetor de turnos ausente ou com os timeouts do ledger de IA
-- perdidos. Cada flag abaixo e calculada do catalogo no momento da leitura, no
-- mesmo padrao de businessActionCheckout* (0069) e dataGovernanceWriteFenceRepaired
-- (0071): se o objeto some, a flag cai e o portao recusa o schema.
--
-- Nao altera tabela, corpo de funcao de negocio, grant de dado nem semantica.
alter function public.portal_schema_capabilities_service() set schema app;
alter function app.portal_schema_capabilities_service() rename to portal_schema_capabilities_v73;
revoke all on function app.portal_schema_capabilities_v73() from public,anon,authenticated,service_role;
create or replace function public.portal_schema_capabilities_service()
returns jsonb language sql stable security definer set search_path='' as $$
  select (app.portal_schema_capabilities_v73()-'version')||jsonb_build_object(
    'version',77,
    'hybridKnowledgeRetrieval',
      to_regprocedure('public.portal_search_knowledge_hybrid_service(app.uuid_v7,text,jsonb,integer)') is not null
      and to_regprocedure('public.portal_search_knowledge_hybrid(text,jsonb,integer)') is not null
      and to_regclass('public.knowledge_chunks_simple_fts') is not null,
    'conversationTurnRedactionProjector',
      app.data_governance_catalog_complete()
      and exists(
        select 1 from pg_catalog.pg_trigger t
        where t.tgrelid=to_regclass('public.conversation_turns')
          and t.tgname='conversation_turns_append_only' and not t.tgisinternal
          and t.tgenabled in ('O','A')
      ),
    'aiLedgerTimeoutsBounded',
      (
        select count(*)=5
        from (values
          (to_regprocedure('public.portal_begin_ai_usage_reservation_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,integer,integer,numeric)')),
          (to_regprocedure('public.portal_mark_ai_usage_in_flight_service(app.uuid_v7)')),
          (to_regprocedure('public.portal_commit_ai_usage_service(app.uuid_v7,integer,integer,numeric)')),
          (to_regprocedure('public.portal_release_ai_usage_service(app.uuid_v7,text)')),
          (to_regprocedure('public.portal_mark_ai_usage_unknown_service(app.uuid_v7,text)'))
        ) as expected(oid)
        join pg_catalog.pg_proc p on p.oid=expected.oid
        where coalesce(p.proconfig,'{}'::text[]) @> array['lock_timeout=2s','statement_timeout=15s']
      )
  )
$$;
revoke all on function public.portal_schema_capabilities_service() from public,anon,authenticated;
grant execute on function public.portal_schema_capabilities_service() to service_role;

commit;
