begin;

-- Reparo forward-only da capability businessActionGrants.
--
-- A flag nasceu na 0056 e prova, entre outras coisas, que
-- portal_set_business_action_agent_settings_service(uuid,uuid,uuid,boolean)
-- existe e e exclusiva do service_role. A 0069 troca essa funcao de proposito:
-- remove a assinatura de quatro argumentos e cria a de cinco, com
-- p_checkout_enabled (um CREATE OR REPLACE que so soma um parametro cria um
-- segundo overload em vez de substituir o antigo). Nenhuma migration seguinte
-- republicou a flag, entao em qualquer banco migrado ate a 0077 ela ficava
-- false, e o portao de prontidao do app (/api/ready e production:bootstrap)
-- exige true. O harness nao pegou porque conferia so as capabilities novas
-- (READINESS_INTEGRATION_CAPABILITIES), nunca a uniao inteira que o portao exige.
--
-- Esta migration so reescreve a prova, apontando para a assinatura vigente. A
-- funcao de cinco argumentos ja existe e ja e service_role-only (0069). Nao
-- altera tabela, corpo de funcao de negocio, grant de dado nem a versao
-- publicada: o app aceita no maximo 77.
alter function public.portal_schema_capabilities_service() set schema app;
alter function app.portal_schema_capabilities_service() rename to portal_schema_capabilities_v77;
revoke all on function app.portal_schema_capabilities_v77() from public,anon,authenticated,service_role;
create or replace function public.portal_schema_capabilities_service()
returns jsonb language sql stable security definer set search_path='' as $$
  select app.portal_schema_capabilities_v77()||jsonb_build_object(
    'businessActionGrants',
      to_regclass('public.portal_business_action_grants') is not null
      and app.portal_table_locked_down(to_regclass('public.portal_business_action_agent_settings'))
      and app.portal_table_locked_down(to_regclass('public.portal_business_action_grants'))
      and app.portal_service_role_only('public.portal_admit_business_action_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,integer)')
      and app.portal_service_role_only('public.portal_set_business_action_agent_settings_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,boolean,boolean)')
  )
$$;
revoke all on function public.portal_schema_capabilities_service() from public,anon,authenticated;
grant execute on function public.portal_schema_capabilities_service() to service_role;

commit;
