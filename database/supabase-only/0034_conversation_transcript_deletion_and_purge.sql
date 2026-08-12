-- Fecha 2 achados P1 confirmados (3/3 verificadores) da onda 5 de auditoria
-- autônoma (2026-08-12, dimensão lgpd-privacy-depth):
--
-- 1) `apps/portal/src/app/privacidade/page.tsx` promete, em produção, que
--    qualquer pessoa pode "solicitar acesso, correção ou exclusão dos seus
--    dados — incluindo o histórico de conversas — a qualquer momento pelo
--    e-mail fernando@axtroai.com". A migration 0029 (conversation_transcripts)
--    nunca ganhou uma RPC de exclusão — as únicas RPCs de delete do schema
--    inteiro (portal_delete_draft_agent, portal_delete_knowledge_source,
--    0023) removem CONFIGURAÇÃO de tenant, não dado pessoal de conversa. Sem
--    RPC nem UI, cumprir o pedido hoje exigiria um operador escrever um
--    DELETE cru direto em produção, sem trilha de auditoria e sem guarda
--    contra apagar a linha errada.
--
-- 2) `conversation_transcripts` não tem NENHUM mecanismo de retenção/expurgo
--    — o texto integral de qualquer conversa (até 1000 turnos x 8000 chars,
--    app.validate_transcript_turns) fica pra sempre, contradizendo
--    docs/adr/ADR-016-data-retention-deletion.md ("dados... default to the
--    shortest configured period"). O v1 legado tinha um job diário de purga
--    (legacy/v1/docs/architecture/DATA_MODEL.md) que nunca foi carregado
--    pro v2 — legacy/v1 é explicitamente não-normativo (AGENTS.md:15).
--
-- Duas RPCs de exclusão pontual (mesmo padrão de portal_delete_knowledge_source):
--   - portal_delete_conversation_transcript: autenticada, tenant_admin,
--     escopada ao próprio tenant — dá ao tenant_admin uma forma real de
--     cumprir um pedido de exclusão sem precisar de acesso a produção. Wired
--     na UI de /conversas na mesma mudança.
--   - portal_delete_conversation_transcript_service: variante service-role
--     (mesmo padrão de portal_log_ai_usage_service etc.) — é o caminho real
--     que o Fernando usa hoje pra cumprir um pedido que chega por e-mail
--     (ele não tem sessão de tenant_admin de cada tenant), via script pontual
--     com a service_role key, nunca exposta ao app.
--
-- Uma RPC de expurgo em massa, PARAMETRIZADA (não automática):
--   - portal_purge_old_conversation_transcripts_service: apaga conversas
--     mais antigas que N dias (contados a partir do fim da conversa, ou do
--     início se nunca foi marcada como encerrada). N é OBRIGATÓRIO e tem um
--     piso de segurança de 30 dias (contra um erro de digitação que apagaria
--     quase tudo) — DELIBERADAMENTE não escolhe um período de retenção real
--     nem agenda execução automática (não existe infra de cron neste repo,
--     confirmado pela própria auditoria). O período de retenção real e a
--     decisão de automatizar (pg_cron, GitHub Action agendada, etc.) são
--     decisão de produto/jurídico do Fernando — esta RPC só entrega a
--     CAPACIDADE técnica, pronta pra ser chamada manualmente ou agendada
--     assim que esse número for decidido.

BEGIN;

create or replace function public.portal_delete_conversation_transcript(
  p_id app.uuid_v7
) returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_tenant app.uuid_v7;
  v_role text;
  v_exists boolean;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  select tenant_id, role into v_tenant, v_role
  from public.user_tenant_memberships where user_id = auth.uid();
  if v_tenant is null then
    raise exception 'no tenant provisioned' using errcode = '42501';
  end if;
  if v_role <> 'tenant_admin' then
    raise exception 'only a tenant_admin can delete conversation transcripts' using errcode = '42501';
  end if;

  select exists(select 1 from public.conversation_transcripts where tenant_id = v_tenant and id = p_id) into v_exists;
  if not v_exists then
    raise exception 'transcript not found for this account' using errcode = '42501';
  end if;

  delete from public.conversation_transcripts where tenant_id = v_tenant and id = p_id;

  return jsonb_build_object('ok', true, 'id', p_id);
end;
$$;

revoke all on function public.portal_delete_conversation_transcript from public, anon;
grant execute on function public.portal_delete_conversation_transcript to authenticated;

create or replace function public.portal_delete_conversation_transcript_service(
  p_tenant_id app.uuid_v7,
  p_id app.uuid_v7
) returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_exists boolean;
begin
  select exists(select 1 from public.conversation_transcripts where tenant_id = p_tenant_id and id = p_id) into v_exists;
  if not v_exists then
    raise exception 'transcript not found for this tenant' using errcode = '42501';
  end if;

  delete from public.conversation_transcripts where tenant_id = p_tenant_id and id = p_id;

  return jsonb_build_object('ok', true, 'id', p_id);
end;
$$;

revoke all on function public.portal_delete_conversation_transcript_service from public, anon, authenticated;
grant execute on function public.portal_delete_conversation_transcript_service to service_role;

create or replace function public.portal_purge_old_conversation_transcripts_service(
  p_older_than_days integer
) returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_deleted integer;
begin
  if p_older_than_days is null or p_older_than_days < 30 then
    raise exception 'p_older_than_days must be an integer of at least 30 (safety floor against accidental mass deletion)' using errcode = '22023';
  end if;

  delete from public.conversation_transcripts
  where coalesce(ended_at, started_at) < now() - (p_older_than_days || ' days')::interval;

  get diagnostics v_deleted = row_count;
  return jsonb_build_object('ok', true, 'deleted', v_deleted);
end;
$$;

revoke all on function public.portal_purge_old_conversation_transcripts_service from public, anon, authenticated;
grant execute on function public.portal_purge_old_conversation_transcripts_service to service_role;

COMMIT;
