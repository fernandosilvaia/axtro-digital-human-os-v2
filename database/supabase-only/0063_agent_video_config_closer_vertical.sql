BEGIN;

-- D-V2-173: a closer de Life Insurance existia em codigo e nao era alcancavel.
--
-- `apps/portal/src/lib/brain/life-insurance.ts` (D-V2-169) foi escrito, testado
-- e nunca invocado: o unico import do modulo no repositorio inteiro era o
-- proprio arquivo de teste. `buildCloserVideoSystemPrompt` montava sempre a
-- doutrina generica do Metodo Silva, sem nenhum caminho para um agente declarar
-- que atende um mercado regulado. Na pratica, o pedido "uma closer de video
-- para Life Insurance" estava cumprido no papel e ausente em qualquer call real.
--
-- Esta migration adiciona o seletor que faltava, no mesmo lugar e no mesmo
-- padrao que `presentation_kind` ja usa (0020): coluna explicita em
-- `agent_video_config`, com default seguro e constraint fechada. O precedente
-- da 0020 importa aqui porque ele existe justamente para NAO decidir
-- comportamento por heuristica de nome de agente, que foi o acoplamento fragil
-- que ela veio corrigir.
--
-- POR QUE UMA COLUNA SO, E NAO VERTICAL + MODO SEPARADOS
-- Modo ("qualification" / "recruitment") so faz sentido dentro de Life
-- Insurance. Duas colunas permitiriam o estado sem significado
-- ('metodo_silva', 'recruitment'), que o banco teria de proibir com uma
-- constraint cruzada. Um enum unico torna o estado invalido inexpressavel.
--
-- POR QUE O DEFAULT E 'metodo_silva'
-- Todo agente existente hoje e generico, e a doutrina do Metodo Silva continua
-- sendo o motor de conducao nas tres verticais. Degradar para ela e sempre
-- seguro; assumir a vertical regulada sem certeza nao e. `parseCloserVertical`
-- no portal aplica a mesma regra para valor desconhecido.
--
-- POR QUE A CAPABILITY VERSION NAO SOBE
-- Nenhuma RPC nova, nenhuma assinatura alterada. O caminho de leitura do
-- cerebro e um select direto com service_role, e se a coluna nao existir o
-- select falha, `videoConfig` vem undefined e a call degrada para
-- 'metodo_silva' em vez de cair. Ou seja, a ausencia da coluna e um estado
-- seguro, nao um estado quebrado, entao ela nao precisa virar gate de
-- readiness. Mesmo precedente de 0055, 0060, 0061 e 0062.

alter table public.agent_video_config
  add column if not exists closer_vertical text not null default 'metodo_silva';

alter table public.agent_video_config
  add constraint agent_video_config_closer_vertical_chk
  check (closer_vertical in ('metodo_silva', 'life_insurance_qualification', 'life_insurance_recruitment'));

-- Sem backfill de proposito: nenhum agente existente foi criado para atender
-- seguro de vida, e marcar um deles aqui seria decidir por conta propria o
-- posicionamento comercial de uma persona que ja esta em producao.

create or replace function public.portal_agent_video_config(p_agent_id app.uuid_v7)
returns jsonb
language plpgsql
stable
security definer
set search_path = 'public'
as $$
declare
  v_tenant app.uuid_v7;
  v_row public.agent_video_config%rowtype;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  select tenant_id into v_tenant from public.user_tenant_memberships where user_id = auth.uid();
  if v_tenant is null then
    return jsonb_build_object('configured', false);
  end if;
  select * into v_row from public.agent_video_config where tenant_id = v_tenant and agent_id = p_agent_id;
  if not found then
    return jsonb_build_object('configured', false);
  end if;
  return jsonb_build_object(
    'configured', true,
    'persona_id', v_row.tavus_persona_id,
    'replica_id', v_row.tavus_replica_id,
    'language', v_row.language,
    'presentation_kind', v_row.presentation_kind,
    'closer_vertical', v_row.closer_vertical
  );
end;
$$;

revoke all on function public.portal_agent_video_config from public, anon;
grant execute on function public.portal_agent_video_config to authenticated;

COMMIT;
