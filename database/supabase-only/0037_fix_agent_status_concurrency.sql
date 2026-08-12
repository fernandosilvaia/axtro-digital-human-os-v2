-- Fecha achado P3 da auto-revisão do código novo desta sessão (2026-08-12,
-- D-V2-114): `portal_set_agent_status` (0014) repete a MESMA classe de
-- check-then-act sem lock já corrigida em `portal_ingest_knowledge` (0035)
-- — lê `agents.status` sem `FOR UPDATE`, depois faz `UPDATE` sem nenhum
-- lock entre a leitura e a escrita.
--
-- Cenário: duas requisições de ativação genuinamente concorrentes pro MESMO
-- agente (SELECTs de ambas rodando antes de qualquer COMMIT, não só um
-- duplo-clique sequencial) podem as duas ler `v_current='draft'`, as duas
-- passarem da guarda de no-op, e as duas retornarem `changed:true` mesmo
-- só uma sendo uma transição real. `resources.ts` (fix irmão desta mesma
-- onda, D-V2-114) agora confia em `changed` pra decidir se reenvia o
-- e-mail "Agente ativado" — sem esse lock, a segunda chamada concorrente
-- ainda dispararia um e-mail duplicado, o mesmo sintoma que o fix de
-- `changed` tentou eliminar (agora só pro caso sequencial, não pro
-- genuinamente concorrente).
--
-- Correção: mesmo padrão de `0035_fix_ingest_knowledge_concurrency.sql` —
-- `SELECT ... FOR UPDATE` na leitura do status atual. Serializa duas
-- chamadas concorrentes: a segunda bloqueia até a primeira commitar, então
-- lê o status JÁ atualizado e cai corretamente no branch de no-op
-- (`changed:false`). Nenhum outro comportamento da função muda.

BEGIN;

create or replace function public.portal_set_agent_status(
  p_agent_id app.uuid_v7,
  p_status text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant app.uuid_v7;
  v_role text;
  v_current text;
  v_disclosure text;
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
    raise exception 'only a tenant_admin can change agent status' using errcode = '42501';
  end if;
  if p_status not in ('active', 'draft') then
    raise exception 'status must be active or draft' using errcode = '22023';
  end if;

  -- FIX (achado P3 da auto-revisão 2026-08-12): FOR UPDATE serializa
  -- ativações concorrentes do MESMO agente — sem isso, duas chamadas
  -- simultâneas liam o mesmo status e as duas podiam retornar changed:true.
  select status, disclosure_profile_id into v_current, v_disclosure
  from public.agents where tenant_id = v_tenant and id = p_agent_id
  for update;
  if v_current is null then
    raise exception 'agent not found for this account' using errcode = '42501';
  end if;
  if v_current = p_status then
    return jsonb_build_object('ok', true, 'id', p_agent_id, 'status', v_current, 'changed', false);
  end if;
  if v_current not in ('draft', 'active') then
    raise exception 'agent status cannot be changed from its current state' using errcode = '22023';
  end if;
  if p_status = 'active' and coalesce(v_disclosure, '') = '' then
    raise exception 'agent has no disclosure profile' using errcode = '22023';
  end if;

  update public.agents
  set status = p_status
  where tenant_id = v_tenant and id = p_agent_id;

  return jsonb_build_object('ok', true, 'id', p_agent_id, 'status', p_status, 'changed', true);
end;
$$;

COMMIT;
