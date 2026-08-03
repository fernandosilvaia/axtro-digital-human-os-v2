-- Correções da auditoria de hardening 2026-08-02 (D-V2-100), três achados
-- confirmados no banco:
--
-- 1. portal_set_agent_video_config (0022) aceitava presentation_kind
--    'platform' de QUALQUER tenant_admin — combinado com a resolução da
--    persona institucional em /api/leads/video-session, um tenant hostil
--    conseguia sequestrar a Raissa institucional (e receber o resumo/PII do
--    lead na persona dele). Linhas 'platform' são criação exclusiva do
--    operador da plataforma (SQL direto/migration) — a RPC self-service só
--    grava 'sales' a partir de agora.
--
-- 2. portal_update_meeting_bot_session_status_service aceitava QUALQUER
--    transição — um retry/entrega fora de ordem do webhook regressava
--    sessão 'ended' para 'in_call' (estado corrompido: ativa e encerrada ao
--    mesmo tempo). Estados terminais agora são pegajosos.
--
-- 3. Faltava a variante service do log de custo de vídeo: os caminhos
--    servidor-a-servidor (video-session do lead, câmera do bot sentinela)
--    criavam conversas Tavus reais sem NUNCA entrar no ledger/teto.
--    Mesma disciplina de portal_log_ai_usage_service (0019).

BEGIN;

create or replace function public.portal_set_agent_video_config(
  p_agent_id app.uuid_v7,
  p_persona_id text,
  p_language text,
  p_presentation_kind text default 'sales'
) returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_tenant app.uuid_v7;
  v_role text;
  v_agent_exists boolean;
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
    raise exception 'only a tenant_admin can configure agent video' using errcode = '42501';
  end if;
  if p_persona_id !~ '^[a-z0-9]{6,64}$' then
    raise exception 'persona_id must be a plain Tavus persona id' using errcode = '22023';
  end if;
  if p_language not in ('portuguese', 'english') then
    raise exception 'language must be portuguese or english' using errcode = '22023';
  end if;
  -- 'platform' é exclusivo do operador da plataforma (nunca self-service):
  -- essa flag decide QUEM atende os leads institucionais da Axtro.
  if p_presentation_kind <> 'sales' then
    raise exception 'presentation_kind must be sales' using errcode = '42501';
  end if;
  select exists(select 1 from public.agents where tenant_id = v_tenant and id = p_agent_id) into v_agent_exists;
  if not v_agent_exists then
    raise exception 'agent not found for this account' using errcode = '42501';
  end if;

  insert into public.agent_video_config (tenant_id, agent_id, tavus_persona_id, language, presentation_kind)
  values (v_tenant, p_agent_id, p_persona_id, p_language, 'sales')
  on conflict (tenant_id, agent_id) do update
  set tavus_persona_id = excluded.tavus_persona_id,
      tavus_replica_id = null,
      language = excluded.language,
      presentation_kind = excluded.presentation_kind;

  return jsonb_build_object('ok', true, 'agent_id', p_agent_id, 'persona_id', p_persona_id);
end;
$$;

-- Estados terminais são pegajosos: retry/replay/entrega fora de ordem nunca
-- ressuscita uma sessão encerrada. Transição terminal->terminal é permitida
-- (ended -> failed não faz sentido regredir, mas não corrompe; mantemos
-- simples: terminal nunca muda).
create or replace function public.portal_update_meeting_bot_session_status_service(
  p_recall_bot_id text,
  p_status text
) returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_updated boolean;
begin
  if p_status not in ('created', 'joining', 'in_call', 'ended', 'failed') then
    raise exception 'invalid status' using errcode = '22023';
  end if;
  update public.meeting_bot_sessions
  set status = p_status,
      updated_at = now(),
      ended_at = case when p_status in ('ended', 'failed') then now() else ended_at end
  where recall_bot_id = p_recall_bot_id
    and status not in ('ended', 'failed');
  v_updated := found;
  if not v_updated then
    -- Distingue "sessão não existe" de "sessão terminal" só internamente;
    -- pro chamador (webhook) os dois são found=false/ignored.
    return jsonb_build_object('found', exists(
      select 1 from public.meeting_bot_sessions where recall_bot_id = p_recall_bot_id
    ), 'applied', false);
  end if;
  return jsonb_build_object('found', true, 'applied', true);
end;
$$;

revoke all on function public.portal_update_meeting_bot_session_status_service from public, anon, authenticated;
grant execute on function public.portal_update_meeting_bot_session_status_service to service_role;

-- Log de custo de vídeo para caminhos servidor-a-servidor (sem auth.uid()).
-- Mesmo evento de portal_log_video_usage (0017): quantity=1, custo 0 no
-- evento (duração real não medida — o piso entra na leitura), source
-- 'estimated' por honestidade estrutural (Art. 16).
create or replace function public.portal_log_video_usage_service(
  p_tenant_id app.uuid_v7,
  p_id app.uuid_v7
) returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  if not exists (select 1 from public.tenants where id = p_tenant_id) then
    raise exception 'unknown tenant' using errcode = '42501';
  end if;

  insert into public.cost_events (
    tenant_id, id, provider_id, service, unit_type, quantity,
    unit_cost_usd, amount_usd, source, occurred_at
  ) values (
    p_tenant_id, p_id, 'tavus', 'portal.video_conversation', 'conversation', 1,
    0, 0, 'estimated', now()
  );

  return jsonb_build_object('ok', true, 'id', p_id);
end;
$$;

revoke all on function public.portal_log_video_usage_service from public, anon, authenticated;
grant execute on function public.portal_log_video_usage_service to service_role;

COMMIT;
