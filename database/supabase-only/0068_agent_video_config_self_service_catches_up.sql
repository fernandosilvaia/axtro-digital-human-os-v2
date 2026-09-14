BEGIN;

-- D-V2-179: a RPC self-service de config de video existia desde a 0022 e
-- nunca foi chamada por ninguem.
--
-- O ACHADO
-- Auditando o que falta para o go-live (2026-09-14), procurei quem chama
-- `portal_set_agent_video_config` no portal inteiro: zero resultados. Nenhuma
-- server action, nenhuma tela. E o mesmo padrao do D-V2-176 (o cerebro sem
-- tela): a metade de servidor existe, a superficie nunca foi construida, e o
-- efeito pratico e que nenhum tenant real provisiona video por conta propria.
-- A Sofia (D-V2-177) so existe porque rodei INSERT manual em producao.
--
-- E A RPC EXISTENTE ESTAVA DESATUALIZADA
-- Ela foi tocada pela ultima vez na 0024 (hardening), antes da 0063
-- (closer_vertical) e da 0066 (spoken_languages) existirem. Mesmo que alguem
-- a chamasse hoje, nao daria pra configurar a vertical regulada nem os
-- idiomas reconhecidos, e `language` continuava travado em portuguese/english
-- apesar de 'spanish' ja ser vocabulario valido do dominio desde a 0066
-- (coluna sem CHECK proprio, so a RPC restringia). Tambem nunca aceitou
-- `replica_id`: sempre zerava `tavus_replica_id` ao gravar, entao um agente
-- que usa replica (em vez de persona) nunca poderia ser configurado por aqui.
--
-- O QUE MUDA
-- Assinatura nova com replica_id, spoken_languages e closer_vertical. A
-- validacao de spoken_languages replica as tres invariantes da 0066 (1..3,
-- conjunto conhecido, sem duplicata, language dentro do array) para dar erro
-- legivel em vez de estourar a constraint da tabela sem contexto.
--
-- presentation_kind sai da lista de parametros: a RPC ja forcava 'sales'
-- incondicionalmente desde a 0024 (self-service nunca cria persona
-- institucional), entao o parametro nunca teve efeito e so acrescentava
-- superficie. 'platform' continua exclusivo de SQL direto/migration.
--
-- Zero chamadores confirmados, entao troco a assinatura em vez de manter as
-- duas: manter a de 4 parametros orfa ao lado da nova seria dividir uma
-- capacidade em dois caminhos incompletos.

drop function if exists public.portal_set_agent_video_config(app.uuid_v7, text, text, text);

create or replace function public.portal_set_agent_video_config(
  p_agent_id app.uuid_v7,
  p_persona_id text,
  p_replica_id text,
  p_language text,
  p_spoken_languages text[] default null,
  p_closer_vertical text default 'metodo_silva'
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
  if p_replica_id is not null and p_replica_id !~ '^[a-z0-9]{6,64}$' then
    raise exception 'replica_id must be a plain Tavus replica id' using errcode = '22023';
  end if;
  if p_language not in ('portuguese', 'english', 'spanish') then
    raise exception 'language must be portuguese, english or spanish' using errcode = '22023';
  end if;
  if p_closer_vertical not in ('metodo_silva', 'life_insurance_qualification', 'life_insurance_recruitment') then
    raise exception 'closer_vertical not recognized' using errcode = '22023';
  end if;
  if p_spoken_languages is not null and (
    array_length(p_spoken_languages, 1) is null
    or array_length(p_spoken_languages, 1) not between 1 and 3
    or not (p_spoken_languages <@ array['portuguese', 'english', 'spanish']::text[])
    or app.text_array_has_duplicates(p_spoken_languages)
    or not (p_language = any (p_spoken_languages))
  ) then
    raise exception 'spoken_languages must have 1..3 distinct known languages and include language' using errcode = '22023';
  end if;
  select exists(select 1 from public.agents where tenant_id = v_tenant and id = p_agent_id) into v_agent_exists;
  if not v_agent_exists then
    raise exception 'agent not found for this account' using errcode = '42501';
  end if;

  insert into public.agent_video_config (
    tenant_id, agent_id, tavus_persona_id, tavus_replica_id, language,
    spoken_languages, closer_vertical, presentation_kind)
  values (
    v_tenant, p_agent_id, p_persona_id, p_replica_id, p_language,
    p_spoken_languages, p_closer_vertical, 'sales')
  on conflict (tenant_id, agent_id) do update
  set tavus_persona_id = excluded.tavus_persona_id,
      tavus_replica_id = excluded.tavus_replica_id,
      language = excluded.language,
      spoken_languages = excluded.spoken_languages,
      closer_vertical = excluded.closer_vertical,
      presentation_kind = excluded.presentation_kind;

  return jsonb_build_object('ok', true, 'agent_id', p_agent_id, 'persona_id', p_persona_id);
end;
$$;

revoke all on function public.portal_set_agent_video_config(app.uuid_v7, text, text, text, text[], text)
  from public, anon;
grant execute on function public.portal_set_agent_video_config(app.uuid_v7, text, text, text, text[], text)
  to authenticated;

COMMIT;
