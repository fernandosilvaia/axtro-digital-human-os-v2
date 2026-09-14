BEGIN;

-- D-V2-178: uma falha transitoria de rede deixava o tenant sem IA para sempre.
--
-- O DEFEITO
-- `portal_begin_ai_usage_reservation_service` recusa QUALQUER reserva nova
-- enquanto existir uma do tenant em `provider_in_flight` ou `unknown`
-- (`blocked_unknown`). Falhar fechado diante de ambiguidade financeira esta
-- certo: contar so o envelope permitiria gasto novo no dia seguinte sem
-- evidencia de que a chamada anterior nao foi faturada.
--
-- O problema e que a metade que DESTRAVA nunca foi construida:
--   - `/api/internal/ai-usage/manual` devolve 404 por desenho ate a M5-02,
--     porque um bearer global "nao e identidade de operador e nao pode
--     autorizar transicao de estado financeiro".
--   - `portal_reconcile_ai_usage_service` exige evidencia real do provider,
--     e a rota de atividade do OpenRouter exige management key.
--
-- Medido em producao em 2026-09-14: a primeira chamada real ao cerebro da
-- Sofia falhou em "OpenRouter request failed before a response", a reserva
-- ficou em `unknown`, e a chamada seguinte ja veio `blocked_unknown`. Sem SQL
-- manual, aquele tenant nao geraria IA nunca mais.
--
-- POR QUE ISTO NAO CONTRADIZ A M5-02
-- A M5-02 existe para o caso em que alguem DECIDE o desfecho: "esta chamada
-- nao foi faturada" e uma afirmacao sobre o mundo, e afirmar isso exige
-- identidade e dupla aprovacao. Esta varredura nao decide nada. Ela aplica a
-- politica determinista OPOSTA: passado o prazo, ASSUME que o provider cobrou
-- o MAXIMO reservado. Nenhuma discricao e exercida, entao nao ha o que
-- aprovar.
--
-- A direcao importa. Assumir o maximo so pode SUPERESTIMAR o gasto contra o
-- teto interno, nunca subestimar, entao esta valvula nao pode ser usada para
-- esconder consumo. O caminho de operador continua intacto e continua exigindo
-- evidencia real, para quem quiser corrigir para baixo com a fatura na mao.
--
-- POR QUE DENTRO DA PROPRIA FUNCAO DE RESERVA
-- Sem worker novo, sem rota nova, sem agendador. A varredura roda no exato
-- momento em que o bloqueio seria aplicado, entao o destravamento acontece na
-- proxima tentativa depois do prazo e nao depende de nenhuma infraestrutura
-- que possa estar parada. Ja estamos sob `pg_advisory_xact_lock` do tenant
-- quando ela roda, entao duas chamadas concorrentes nao varrem em duplicata.

alter table public.ai_usage_reconciliation_receipts
  drop constraint ai_usage_reconciliation_evidence_chk;

alter table public.ai_usage_reconciliation_receipts
  add constraint ai_usage_reconciliation_evidence_chk
  check (evidence in ('provider_invoice_no_charge', 'provider_invoice_usage_confirmed', 'timeout_assumed_max'));

alter table public.ai_usage_reconciliation_receipts
  drop constraint ai_usage_reconciliation_usage_chk;

alter table public.ai_usage_reconciliation_receipts
  add constraint ai_usage_reconciliation_usage_chk
  check (
    (evidence = 'provider_invoice_no_charge'
      and actual_input_tokens is null and actual_output_tokens is null and reported_cost_usd is null)
    or (evidence in ('provider_invoice_usage_confirmed', 'timeout_assumed_max')
      and actual_input_tokens is not null and actual_output_tokens is not null and reported_cost_usd is not null
      and actual_input_tokens >= 0 and actual_output_tokens >= 0 and reported_cost_usd >= 0)
  );

/**
 * Resolve reservas ambiguas vencidas assumindo o pior caso. Devolve quantas
 * resolveu.
 *
 * O prazo tem piso de 15 minutos de proposito: um provider que de fato
 * recebeu a chamada fatura em segundos ou minutos, entao um prazo curto
 * demais assumiria consumo de uma chamada que ainda poderia ser reconciliada
 * com evidencia real. O teto de 24h impede que alguem desligue a valvula na
 * pratica passando um prazo absurdo.
 */
create or replace function public.portal_sweep_stale_ai_usage_unknown_service(
  p_tenant_id app.uuid_v7,
  p_max_age_seconds integer default 1800
) returns integer
language plpgsql
volatile
security definer
set search_path = 'public'
as $$
declare
  v public.ai_usage_reservations%rowtype;
  v_total integer;
  v_unit numeric(20,10);
  v_amount numeric(20,8);
  v_resolved integer := 0;
  v_receipt_id app.uuid_v7;
  v_millis bigint;
  v_time_hex text;
  v_random_hex text;
begin
  if p_max_age_seconds is null or p_max_age_seconds < 900 or p_max_age_seconds > 86400 then
    raise exception 'sweep age must be 900..86400 seconds' using errcode = '22023';
  end if;

  for v in
    select * from public.ai_usage_reservations
    where tenant_id = p_tenant_id
      and state in ('provider_in_flight', 'unknown')
      and updated_at <= now() - make_interval(secs => p_max_age_seconds)
    order by updated_at
    for update
  loop
    -- Pior caso: o envelope inteiro. Mesma normalizacao que
    -- portal_commit_ai_usage_service ja aplica quando o provider nao reporta uso.
    v_total := v.max_input_tokens + v.max_output_tokens;
    continue when v_total <= 0;
    v_unit := round(v.max_cost_usd / v_total, 10);
    v_amount := round(v_total * v_unit, 8);

    v_millis := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
    v_time_hex := lpad(to_hex(v_millis), 12, '0');
    -- `gen_random_uuid()` e nativo do Postgres, sem extensao: pgcrypto vive em
    -- `extensions` no Supabase e em lugar nenhum no Postgres do harness, e
    -- depender dele faria a migration passar num e falhar no outro.
    v_random_hex := replace(gen_random_uuid()::text, '-', '');
    v_receipt_id := (
      substr(v_time_hex,1,8) || '-' || substr(v_time_hex,9,4) || '-7' || substr(v_random_hex,1,3) ||
      '-8' || substr(v_random_hex,4,3) || '-' || substr(v_random_hex,7,12)
    )::app.uuid_v7;

    -- Gera o uuid v7 aqui em vez de chamar o helper de outro modulo. Alem de
    -- nao acoplar contabilidade de IA ao modulo de governanca de dados, isto
    -- evita depender de uma funcao que pode nao existir: a primeira tentativa
    -- desta migration falhou em producao exatamente assim, porque o helper
    -- existe no repositorio mas nao no banco hospedado.
    insert into public.ai_usage_reconciliation_receipts(
      id, tenant_id, reservation_id, evidence, provider_receipt_ref,
      actual_input_tokens, actual_output_tokens, reported_cost_usd)
    values (
      v_receipt_id, v.tenant_id, v.id, 'timeout_assumed_max',
      'timeout:' || v.id::text,
      v.max_input_tokens, v.max_output_tokens, v.max_cost_usd)
    on conflict (tenant_id, reservation_id) do nothing;

    insert into public.cost_events(
      tenant_id, id, provider_id, service, unit_type, quantity, unit_cost_usd,
      amount_usd, source, occurred_at, rate_card_ref, rate_card_as_of, provider_request_ref)
    values (
      v.tenant_id, v.cost_event_id, 'openrouter', 'portal.' || v.operation, 'token',
      v_total, v_unit, v_amount, 'provider_reported', now(),
      'openrouter.timeout.assumed_max', '2026-08-13T00:00:00Z', v.provider_request_ref)
    on conflict do nothing;

    update public.ai_usage_reservations
    set state = 'committed',
        actual_input_tokens = v.max_input_tokens,
        actual_output_tokens = v.max_output_tokens,
        reported_cost_usd = v.max_cost_usd,
        committed_at = now(),
        updated_at = now()
    where id = v.id;

    v_resolved := v_resolved + 1;
  end loop;

  return v_resolved;
end;
$$;

revoke all on function public.portal_sweep_stale_ai_usage_unknown_service(app.uuid_v7,integer)
  from public, anon, authenticated;
grant execute on function public.portal_sweep_stale_ai_usage_unknown_service(app.uuid_v7,integer)
  to service_role;

-- Reescreve a funcao de reserva com a varredura enxertada logo antes do
-- bloqueio. O resto do corpo e identico ao da 0040.
create or replace function public.portal_begin_ai_usage_reservation_service(
  p_id app.uuid_v7,p_cost_event_id app.uuid_v7,p_tenant_id app.uuid_v7,p_agent_id app.uuid_v7,p_source_id app.uuid_v7,
  p_idempotency_key text,p_operation text,p_max_input_tokens integer,p_max_output_tokens integer,p_max_cost_usd numeric
) returns jsonb language plpgsql security definer set search_path='public' as $$
declare v_existing public.ai_usage_reservations%rowtype; v_tokens bigint; v_ingestions bigint; v_ref text;
begin
  if p_idempotency_key !~ '^[a-z0-9][a-z0-9:._/-]{7,199}$' or not (
    (p_operation='chat_generation' and p_max_input_tokens=20000 and p_max_output_tokens=512 and p_max_cost_usd=0.05)
    or (p_operation='brain_generation' and p_max_input_tokens=20000 and p_max_output_tokens=512 and p_max_cost_usd=0.05)
    or (p_operation='knowledge_query_embedding' and p_max_input_tokens=1000 and p_max_output_tokens=0 and p_max_cost_usd=0.001)
    or (p_operation='knowledge_ingestion_embedding' and p_max_input_tokens=20000 and p_max_output_tokens=0 and p_max_cost_usd=0.01)
  ) then raise exception 'AI reservation envelope does not match operation contract' using errcode='22023'; end if;
  if p_agent_id is not null and not exists(select 1 from public.agents where tenant_id=p_tenant_id and id=p_agent_id) then raise exception 'agent not found for tenant' using errcode='42501'; end if;
  if p_source_id is not null and not exists(select 1 from public.knowledge_sources where tenant_id=p_tenant_id and id=p_source_id) then raise exception 'source not found for tenant' using errcode='42501'; end if;
  if p_operation in ('chat_generation','brain_generation') and p_agent_id is null then raise exception 'agent is required' using errcode='22023'; end if;
  if p_operation='knowledge_ingestion_embedding' and p_source_id is null then raise exception 'source is required' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text,0));
  select * into v_existing from public.ai_usage_reservations where tenant_id=p_tenant_id and idempotency_key=p_idempotency_key for update;
  if found then
    if v_existing.agent_id is distinct from p_agent_id or v_existing.source_id is distinct from p_source_id or v_existing.operation is distinct from p_operation
      or v_existing.max_input_tokens is distinct from p_max_input_tokens or v_existing.max_output_tokens is distinct from p_max_output_tokens or v_existing.max_cost_usd is distinct from p_max_cost_usd then raise exception 'AI reservation replay conflict' using errcode='23505'; end if;
    return jsonb_build_object('outcome',case when v_existing.state in ('provider_in_flight','unknown') then 'blocked_unknown' else 'replayed' end,'reservationId',v_existing.id,'state',v_existing.state,'providerRequestRef',v_existing.provider_request_ref);
  end if;
  -- Uma resposta ambigua fecha TODO o budget de IA do tenant. Contar apenas
  -- o envelope ate o fim do dia permitiria novo gasto no dia seguinte sem
  -- evidencia de que a chamada anterior nao foi faturada.
  -- D-V2-178: antes de aplicar o bloqueio, resolve as ambiguas VENCIDAS
  -- assumindo o pior caso. Roda aqui, e nao num worker, porque e exatamente
  -- aqui que o bloqueio morde: o destravamento acontece na proxima tentativa
  -- depois do prazo e nao depende de nenhum agendador estar de pe. Ja estamos
  -- sob o advisory lock do tenant, entao duas chamadas concorrentes nao
  -- varrem em duplicata.
  perform public.portal_sweep_stale_ai_usage_unknown_service(p_tenant_id);
  if exists(select 1 from public.ai_usage_reservations where tenant_id=p_tenant_id and state in ('provider_in_flight','unknown')) then
    return jsonb_build_object('outcome','blocked_unknown','bucket','ai_unknown_outcome');
  end if;
  select coalesce(sum(quantity),0)::bigint into v_tokens from public.cost_events c where c.tenant_id=p_tenant_id and c.unit_type='token' and c.occurred_at>=date_trunc('day',now(),'UTC')
    and not exists(select 1 from public.ai_usage_reservations r where r.tenant_id=c.tenant_id and r.cost_event_id=c.id);
  -- Reserved rows consume their envelope in the creation bucket. Committed
  -- rows consume the linked ledger quantity in the occurred_at bucket, so a
  -- dispatch before midnight and commit after midnight cannot disappear from
  -- either day. Ambiguous rows are already blocked tenant-wide above.
  select v_tokens+coalesce(sum(case
    when r.state='committed' then c.quantity
    else r.max_input_tokens+r.max_output_tokens
  end),0)::bigint into v_tokens
  from public.ai_usage_reservations r
  left join public.cost_events c on c.tenant_id=r.tenant_id and c.id=r.cost_event_id
  where r.tenant_id=p_tenant_id and r.state<>'released'
    and (
      (r.state='reserved' and r.created_at>=date_trunc('day',now(),'UTC'))
      or (r.state='committed' and c.occurred_at>=date_trunc('day',now(),'UTC'))
      or r.state in ('provider_in_flight','unknown')
    );
  if v_tokens+p_max_input_tokens+p_max_output_tokens>500000 then return jsonb_build_object('outcome','capped','bucket','ai_tokens_daily','usage',v_tokens,'cap',500000); end if;
  if p_operation='knowledge_ingestion_embedding' then
    select count(*) into v_ingestions from public.ai_usage_reservations where tenant_id=p_tenant_id and operation='knowledge_ingestion_embedding' and created_at>=date_trunc('day',now(),'UTC') and state<>'released';
    if v_ingestions>=30 then return jsonb_build_object('outcome','capped','bucket','knowledge_ingestions_daily','usage',v_ingestions,'cap',30); end if;
  end if;
  v_ref:='ppr_'||replace(p_id::text,'-','');
  insert into public.ai_usage_reservations(id,cost_event_id,tenant_id,agent_id,source_id,idempotency_key,operation,max_input_tokens,max_output_tokens,max_cost_usd,provider_request_ref)
    values(p_id,p_cost_event_id,p_tenant_id,p_agent_id,p_source_id,p_idempotency_key,p_operation,p_max_input_tokens,p_max_output_tokens,p_max_cost_usd,v_ref);
  return jsonb_build_object('outcome','reserved','reservationId',p_id,'state','reserved','providerRequestRef',v_ref);
end; $$;

COMMIT;
