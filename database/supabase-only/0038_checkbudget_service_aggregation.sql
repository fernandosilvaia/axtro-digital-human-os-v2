-- Fecha achado P1 confirmado (3/3 verificadores) da onda 6 de auditoria
-- autônoma (2026-08-12, dimensão performance-scale-limits): `checkBudget`
-- (apps/portal/src/app/api/brain/[agentId]/chat/completions/route.ts) roda
-- em TODO turno de uma conversa de vídeo — a Tavus chama esse endpoint como
-- o LLM da persona, um POST por turno — e fazia
-- `.select("quantity")` de TODAS as linhas de `cost_events` do tenant no
-- dia (sem `.limit`), somando em JS. `cost_events` é append-only (nunca
-- deleta linha) e só tinha índice na PK (tenant_id, id) + um índice único
-- parcial em provider_request_ref — filtrar por unit_type+occurred_at
-- varria a partição inteira do tenant.
--
-- O próprio projeto já resolveu esse EXATO padrão pro caminho de chat
-- autenticado: `portal_ai_tokens_today()` (0008) faz `select sum(quantity)`
-- (agregação no banco, não em JS) — só não tinha equivalente `_service`
-- pro caminho service-role do vídeo (sem `auth.uid()`, chamada
-- servidor-a-servidor da Tavus).
--
-- Correção: (1) índice em (tenant_id, unit_type, occurred_at) — beneficia
-- TODAS as agregações diárias existentes por tenant nesta tabela, não só a
-- nova; (2) `portal_ai_tokens_today_service(p_tenant_id)`, mesmo corpo de
-- `portal_ai_tokens_today` mas com tenant explícito e MESMO filtro que
-- `checkBudget` já usava (unit_type='token', sem filtrar provider_id — hoje
-- só openrouter gera custo de token, mas não mudamos esse comportamento
-- aqui). `route.ts` troca o `.select("quantity")` + `.reduce()` em JS por
-- uma chamada a esta RPC.

BEGIN;

create index if not exists cost_events_tenant_unit_type_occurred_at_idx
  on public.cost_events (tenant_id, unit_type, occurred_at);

create or replace function public.portal_ai_tokens_today_service(
  p_tenant_id app.uuid_v7
) returns bigint
language sql
stable
security definer
set search_path = 'public'
as $$
  select coalesce(sum(quantity), 0)::bigint
  from public.cost_events
  where tenant_id = p_tenant_id
    and unit_type = 'token'
    and occurred_at >= date_trunc('day', now());
$$;

revoke all on function public.portal_ai_tokens_today_service from public, anon, authenticated;
grant execute on function public.portal_ai_tokens_today_service to service_role;

COMMIT;
