-- ACHADO CRÍTICO (2026-08-03, durante o trabalho de billing/D-V2-101):
-- `cost_events_unit_type_check` (database/migrations/0009, aplicada ANTES
-- de 'conversation' existir como conceito) só permite
-- ('minute','second','token','character','megabyte','request','seat','flat')
-- — NUNCA incluiu 'conversation'. Toda RPC que loga custo de vídeo
-- (portal_log_video_usage 0011/0017, portal_log_video_usage_service 0024)
-- insere unit_type='conversation' e SEMPRE falhou contra essa constraint
-- desde 2026-07-18 (0011 aplicada). Confirmado via execute_sql em produção:
-- zero linhas com unit_type='conversation' existem na tabela, apesar de
-- centenas de conversas Tavus reais já terem sido criadas nesta sessão.
--
-- Efeito real: toda chamada a essas RPCs falhava silenciosamente (os
-- callers só fazem `if (error) trackError(...)`, nunca propagam) —
-- checkVideoCap sempre lia conversations_today=0 e SEMPRE retornava
-- "allowed", nunca teve efeito nenhum. O teto diário de 20 conversas/dia
-- de vídeo (o componente mais caro do produto, ~US$0,35/min) nunca esteve
-- ativo em produção. Prioridade P0 — corrigido antes de construir billing
-- em cima de uma contagem que não existia.

BEGIN;

ALTER TABLE public.cost_events
  DROP CONSTRAINT cost_events_unit_type_check,
  ADD CONSTRAINT cost_events_unit_type_check
    CHECK (unit_type IN ('minute','second','token','character','megabyte','request','seat','flat','conversation'))
    NOT VALID;

-- Nenhuma linha histórica pode violar (zero linhas 'conversation' existem
-- hoje) — validar imediatamente em vez de deixar NOT VALID para sempre.
ALTER TABLE public.cost_events VALIDATE CONSTRAINT cost_events_unit_type_check;

COMMIT;
