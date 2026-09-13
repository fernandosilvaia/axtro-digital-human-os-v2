-- ADR-041: resolve o horario escolhido pelo participante SEM que o modelo
-- precise devolver nenhum identificador de banco.
--
-- Por que esta migration existe. O contrato anterior de confirm_meeting_slot
-- exigia proposalId (app.uuid_v7) como argumento obrigatorio do modelo, mas
-- propose_meeting_slots nunca entregou esse id ao modelo: o texto de sucesso
-- devolve so a lista de horarios formatada. O unico desfecho possivel numa
-- call real era o modelo inventar um uuid, a 0060 responder not_found e o
-- funil traduzir para o bucket retomavel ("Esse horario nao esta mais
-- disponivel"), o que jogava a agente de volta em propose_meeting_slots.
-- Loop infinito exatamente na hora do sim, que e o momento mais caro da
-- conversa.
--
-- A correcao certa nao e imprimir o uuid no texto. A 0060 ja declara o
-- principio: "the model never sees a raw database identifier for something
-- it did not create itself" (Art. 3). Quem tem autoridade sobre qual
-- proposta esta em jogo e o servidor, que ja conhece tenant e sessao pelo
-- contexto de chamada viva (0054). Entao o servidor resolve.
--
-- Regra de resolucao: a proposta mais recente AINDA NAO EXPIRADA daquela
-- (tenant, sessao). Isso espelha a realidade da conversa: se a agente
-- ofereceu horarios duas vezes, a pessoa esta escolhendo da ultima lista que
-- ouviu, nunca de uma anterior. expires_at ja existe na 0052 (default de 60
-- minutos), entao uma proposta velha nunca e reaproveitada em silencio.
--
-- Mesma disciplina anti-oraculo de 0053, 0054 e 0060: proposta inexistente,
-- proposta expirada, sessao de outro tenant e indice fora do ofertado
-- colapsam todos no mesmo {"outcome":"not_found"}. Nenhum caminho deixa o
-- chamador (ou alguem sondando por uma superficie mal configurada) distinguir
-- os casos e enumerar proposta de outro tenant.
--
-- Nao toca portal_schema_capabilities_service() de proposito, mesmo
-- precedente ja documentado por 0055 e 0060: o unico chamador
-- (business-action-tool-call.ts) sobe no mesmo release, entao nao existe
-- chamador cross-version que precise detectar esta RPC em runtime. A
-- capability segue em 59.
begin;

create or replace function public.portal_business_action_resolve_session_meeting_slot_service(
  p_tenant_id app.uuid_v7,
  p_session_id app.uuid_v7,
  p_slot_index integer
) returns jsonb language sql stable security definer set search_path='public' as $$
  select case
    when s.id is null then jsonb_build_object('outcome','not_found')
    else jsonb_build_object(
      'outcome','found',
      'proposalId',s.proposal_id,
      'slotId',s.id,
      'startAt',s.start_at,
      'endAt',s.end_at,
      'timezone',s.timezone
    )
  end
  from (values(1)) seed(n)
  left join lateral (
    select p.id
    from public.portal_business_action_proposals p
    where p.tenant_id=p_tenant_id
      and p.session_id=p_session_id
      and p.expires_at>now()
    order by p.created_at desc, p.id desc
    limit 1
  ) latest on true
  left join public.portal_business_action_proposal_slots s
    on s.tenant_id=p_tenant_id and s.proposal_id=latest.id and s.slot_index=p_slot_index
$$;

revoke all on function public.portal_business_action_resolve_session_meeting_slot_service(app.uuid_v7,app.uuid_v7,integer) from public,anon,authenticated,service_role;
grant execute on function public.portal_business_action_resolve_session_meeting_slot_service(app.uuid_v7,app.uuid_v7,integer) to service_role;

commit;
