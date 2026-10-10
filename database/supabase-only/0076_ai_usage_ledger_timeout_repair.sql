begin;

-- Reparo forward-only dos limites de espera das RPCs de mutacao do ledger de IA.
--
-- A 0049 publicou lock_timeout=2s e statement_timeout=15s nas cinco RPCs. Como
-- CREATE OR REPLACE FUNCTION substitui a configuracao por funcao (proconfig)
-- pela que a nova definicao declara, tres redefinicoes seguintes apagaram o SET:
-- begin na 0067 (e de novo na 0074), commit na 0073 e mark_in_flight na 0074.
-- Sem o teto, uma ingestao longa que segura o FOR UPDATE da fonte faz o begin de
-- outra ingestao, ja dentro do advisory lock do tenant, esperar sem limite, e os
-- begins de chat e brain do mesmo tenant enfileiram atras dele.
--
-- Esta migration so reaplica a configuracao. Nao altera corpo, grants nem
-- semantica de nenhuma funcao.
alter function public.portal_begin_ai_usage_reservation_service(
  app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,
  text,text,integer,integer,numeric
) set lock_timeout='2s';
alter function public.portal_begin_ai_usage_reservation_service(
  app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,
  text,text,integer,integer,numeric
) set statement_timeout='15s';
alter function public.portal_mark_ai_usage_in_flight_service(app.uuid_v7)
  set lock_timeout='2s';
alter function public.portal_mark_ai_usage_in_flight_service(app.uuid_v7)
  set statement_timeout='15s';
alter function public.portal_commit_ai_usage_service(app.uuid_v7,integer,integer,numeric)
  set lock_timeout='2s';
alter function public.portal_commit_ai_usage_service(app.uuid_v7,integer,integer,numeric)
  set statement_timeout='15s';

-- Falha fechada: a migration so conclui se as cinco RPCs publicam os dois tetos.
do $ledger_timeouts$
declare v_bounded integer;
begin
  select count(*) into v_bounded
  from (values
    ('public.portal_begin_ai_usage_reservation_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,integer,integer,numeric)'::regprocedure),
    ('public.portal_mark_ai_usage_in_flight_service(app.uuid_v7)'::regprocedure),
    ('public.portal_commit_ai_usage_service(app.uuid_v7,integer,integer,numeric)'::regprocedure),
    ('public.portal_release_ai_usage_service(app.uuid_v7,text)'::regprocedure),
    ('public.portal_mark_ai_usage_unknown_service(app.uuid_v7,text)'::regprocedure)
  ) as expected(oid)
  join pg_proc p on p.oid = expected.oid
  where coalesce(p.proconfig,'{}'::text[]) @> array['lock_timeout=2s','statement_timeout=15s'];
  if v_bounded <> 5 then
    raise exception 'AI ledger mutation RPCs must publish bounded timeouts (% of 5)', v_bounded using errcode = '55000';
  end if;
end;
$ledger_timeouts$;

commit;
