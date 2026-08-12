-- Fecha achado P2 confirmado da onda 5 de auditoria autônoma (2026-08-12,
-- dimensão concurrency-idempotency-audit): `portal_create_knowledge_source`
-- não tinha NENHUM UNIQUE constraint (além de tenant_id+id gerado no
-- cliente) — diferente de `portal_create_agent`, que já é protegido por
-- `UNIQUE(tenant_id, name)` (`agents_tenant_id_name_key`, confirmado no
-- schema vivo) com um exception handler dedicado.
--
-- Cenário: duplo-clique/duas abas no form "Nova fonte" com o mesmo nome —
-- cada submissão gera um `p_id` novo no cliente, então nada no banco
-- rejeitava a segunda chamada. Duas fontes de conhecimento distintas eram
-- criadas, cada uma consumindo uma vaga do limite de 50/tenant e, se havia
-- conteúdo, cada uma disparando embeddings reais via OpenRouter (custo
-- duplicado) e entrando ativa na busca/digest — duplicando o mesmo conteúdo
-- nas respostas do agente.
--
-- Verificado ao vivo antes de escrever esta migration: ZERO linhas
-- duplicadas hoje em produção (`select tenant_id, display_name, count(*)
-- from knowledge_sources group by 1,2 having count(*)>1` → vazio), então o
-- UNIQUE constraint pode ser criado sem risco de falhar contra dado
-- existente.
--
-- Correção: `UNIQUE(tenant_id, display_name)`, mesmo padrão exato de
-- `agents_tenant_id_name_key` + exception handler idêntico ao de
-- `portal_create_agent` (0007).

BEGIN;

alter table public.knowledge_sources
  add constraint knowledge_sources_tenant_id_display_name_key unique (tenant_id, display_name);

create or replace function public.portal_create_knowledge_source(
  p_id app.uuid_v7,
  p_display_name text,
  p_source_type text,
  p_data_classification text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant app.uuid_v7;
  v_role text;
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
    raise exception 'only a tenant_admin can register knowledge sources' using errcode = '42501';
  end if;
  if char_length(coalesce(trim(p_display_name), '')) between 2 and 160 = false then
    raise exception 'display_name must be 2..160 chars' using errcode = '22023';
  end if;
  if p_source_type not in ('document', 'faq', 'url') then
    raise exception 'unsupported source_type' using errcode = '22023';
  end if;
  if p_data_classification not in ('internal', 'confidential', 'restricted') then
    raise exception 'unsupported data_classification' using errcode = '22023';
  end if;
  if (select count(*) from public.knowledge_sources where tenant_id = v_tenant) >= 50 then
    raise exception 'knowledge source limit reached for this account' using errcode = '54000';
  end if;

  -- Sempre nasce pending: ingestão de conteúdo/embeddings exige provedor de
  -- embedding real, fora do escopo do portal por enquanto.
  insert into public.knowledge_sources (tenant_id, id, source_type, display_name, data_classification, status)
  values (v_tenant, p_id, p_source_type, trim(p_display_name), p_data_classification, 'pending');

  return jsonb_build_object('ok', true, 'id', p_id);
exception
  when unique_violation then
    raise exception 'a knowledge source with this name already exists' using errcode = '23505';
end;
$$;

revoke all on function public.portal_create_knowledge_source from public, anon;
grant execute on function public.portal_create_knowledge_source to authenticated;

COMMIT;
