-- Corrige um bug P0 achado na onda 2 de auditoria autônoma (2026-08-11,
-- verificação adversarial 3/3 confirmada, com reprodução matemática e
-- rastreio completo do caminho de chamada real): o branch `provider_reported`
-- de `portal_log_ai_usage` (introduzido na 0027, D-V2-103) calcula
-- `amount_usd` e `unit_cost_usd` como DUAS variáveis arredondadas de forma
-- INDEPENDENTE a partir do mesmo valor de origem (`p_reported_cost_usd`):
--
--   v_amount := round(p_reported_cost_usd, 8);
--   v_unit_cost := round(p_reported_cost_usd / v_total, 10);
--
-- Isso viola `cost_events_amount_reconciliation_check` (0009:
-- `CHECK (amount_usd = round(quantity * unit_cost_usd, 8))`) em ~90% das
-- chamadas reais (simulado com 200k trials de custo/token realistas de
-- Haiku 4.5: 90,3% de falha) — o erro de arredondar `x/n` pra 10 casas
-- decimais, multiplicado de volta por n≈200-3000, produz um erro de até
-- ~1.5e-7 em relação ao amount original, maior que a precisão de 1e-8 que o
-- CHECK exige. `NOT VALID` na constraint só isenta linhas PRÉ-EXISTENTES da
-- validação — todo INSERT novo continua sendo checado.
--
-- Efeito em produção: toda vez que o chat de teste (agent-preview.ts, único
-- chamador que passa `p_reported_cost_usd`, vindo de `usage.cost` real do
-- OpenRouter) gera uma resposta real, há ~90% de chance da linha de custo
-- ser SILENCIOSAMENTE descartada — a exceção do CHECK aborta o INSERT, o
-- caller só faz `trackError(...)` sem lançar nem bloquear a resposta ao
-- usuário. Isso corrói (1) o ledger de custo exato que a 0027 foi construída
-- pra entregar, (2) o teto diário de segurança (`portal_ai_tokens_today`,
-- DAILY_TOKEN_CAP=500k) — subconta uso real, enfraquecendo o mesmo tipo de
-- proteção que a 0025 tratou como P0 pra vídeo, e (3) o painel de uso real
-- mostrado ao tenant_admin (`portal_usage_summary`).
--
-- Correção: mesmo padrão que os outros dois branches da própria função (e
-- que 0017 já documentava como obrigatório: "amount_usd é SEMPRE derivado
-- de unit_cost_usd*quantity... por isso nunca viola a constraint") — deriva
-- `v_amount` de `v_unit_cost` pela MESMA fórmula do CHECK, nunca arredonda
-- os dois independentemente. `v_unit_cost` continua vindo do custo real
-- reportado pelo provider (fonte 'provider_reported' preservada); só a
-- reconstrução de `v_amount` muda pra satisfazer a constraint por
-- construção, com o mesmo nível de precisão (~1e-7 USD, irrelevante em
-- qualquer agregado real) que o resto do sistema já aceita nos branches
-- 'estimated'.

BEGIN;

create or replace function public.portal_log_ai_usage(
  p_id app.uuid_v7,
  p_service text,
  p_input_tokens integer,
  p_output_tokens integer,
  p_reported_cost_usd numeric default null
) returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_tenant app.uuid_v7;
  v_total integer;
  v_price_in numeric(20,10);
  v_price_out numeric(20,10);
  v_unit_cost numeric(20,10);
  v_amount numeric(20,8);
  v_rate_card_ref text;
  v_source text := 'estimated';
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  select tenant_id into v_tenant from public.user_tenant_memberships where user_id = auth.uid();
  if v_tenant is null then
    raise exception 'no tenant provisioned' using errcode = '42501';
  end if;
  if p_service !~ '^[a-z][a-z0-9._-]{2,120}$' then
    raise exception 'invalid service label' using errcode = '22023';
  end if;
  if p_input_tokens < 0 or p_input_tokens > 2000000 or p_output_tokens < 0 or p_output_tokens > 2000000 then
    raise exception 'token counts out of range' using errcode = '22023';
  end if;
  v_total := p_input_tokens + p_output_tokens;

  if p_reported_cost_usd is not null then
    -- Custo faturado reportado pelo próprio provider (usage.cost do
    -- OpenRouter): fonte mais forte que estimativa de tabela. Teto de
    -- sanidade: uma única chamada de chat nunca custa USD 10 — valor acima
    -- disso é bug do caller, não fato.
    if p_reported_cost_usd < 0 or p_reported_cost_usd > 10 then
      raise exception 'reported cost out of range' using errcode = '22023';
    end if;
    v_source := 'provider_reported';
    v_rate_card_ref := 'openrouter.usage.reported';
    if v_total = 0 then
      v_unit_cost := 0; v_amount := 0;
    else
      -- FIX (achado P0 da auditoria 2026-08-11): amount_usd DERIVADO de
      -- unit_cost_usd pela mesma fórmula do CHECK — nunca as duas
      -- arredondadas independentemente do valor de origem (bug original:
      -- round(p_reported_cost_usd,8) vs round(p_reported_cost_usd/v_total,10)
      -- divergem em ~90% dos casos reais).
      v_unit_cost := round(p_reported_cost_usd / v_total, 10);
      v_amount := round(v_total * v_unit_cost, 8);
    end if;
  elsif p_service like 'portal.knowledge%' then
    v_price_in := 0.02 / 1000000;
    v_price_out := 0;
    v_rate_card_ref := 'openrouter.embedding.3-small';
    if v_total = 0 then
      v_unit_cost := 0; v_amount := 0;
    else
      v_unit_cost := round((p_input_tokens * v_price_in + p_output_tokens * v_price_out) / v_total, 10);
      v_amount := round(v_total * v_unit_cost, 8);
    end if;
  else
    v_price_in := 1.00 / 1000000;
    v_price_out := 5.00 / 1000000;
    v_rate_card_ref := 'openrouter.chat.haiku-4.5';
    if v_total = 0 then
      v_unit_cost := 0; v_amount := 0;
    else
      v_unit_cost := round((p_input_tokens * v_price_in + p_output_tokens * v_price_out) / v_total, 10);
      v_amount := round(v_total * v_unit_cost, 8);
    end if;
  end if;

  insert into public.cost_events (
    tenant_id, id, session_id, provider_id, service, unit_type, quantity,
    unit_cost_usd, amount_usd, source, occurred_at, rate_card_ref, rate_card_as_of
  )
  values (
    v_tenant, p_id, null, 'openrouter', p_service, 'token', v_total,
    v_unit_cost, v_amount, v_source, now(), v_rate_card_ref, '2026-08-11T00:00:00Z'
  );

  return jsonb_build_object('ok', true, 'total_tokens', v_total, 'amount_usd', v_amount, 'source', v_source);
end;
$$;

COMMIT;
