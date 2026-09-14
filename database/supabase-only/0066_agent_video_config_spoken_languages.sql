BEGIN;

-- D-V2-175: um agente so podia declarar UM idioma falado.
--
-- O PROBLEMA
-- `agent_video_config.language` e uma coluna unica, e o portal a repassa ao
-- provider como o idioma da conversa. Isso basta para um agente que atende um
-- mercado so, mas nao para a closer de Life Insurance: o mercado e americano,
-- o lead fala ingles ou espanhol, e o candidato a agente da rede brasileira
-- fala portugues. Com uma coluna unica, escolher ingles significa nao
-- reconhecer a fala de quem responder em espanhol.
--
-- POR QUE COLUNA NOVA E NAO TROCAR A EXISTENTE
-- `language` continua sendo o idioma de ABERTURA e o idioma da doutrina do
-- prompt, que e escolha diferente de "quais idiomas eu reconheco". Trocar a
-- coluna por um array forcaria todo chamador a decidir qual elemento e a
-- abertura, e hoje ha varios (saudacao, deck, prompt do cerebro). A coluna
-- nova e aditiva e o default NULL significa exatamente o comportamento de
-- hoje, entao nenhum agente existente muda de comportamento.
--
-- VOCABULARIO
-- Guarda 'portuguese' | 'english' | 'spanish', o MESMO vocabulario que o
-- dominio ja usa em `language`, nunca os codigos do provider. A traducao para
-- o formato que a Tavus espera acontece na camada de provider. Guardar 'en' ou
-- 'pt-BR' aqui amarraria o schema ao formato de um fornecedor especifico, e
-- trocar de fornecedor viraria migration de dados.
--
-- INVARIANTES
-- 1. Se o array existe, tem de 1 a 3 entradas, todas do conjunto conhecido.
-- 2. Sem duplicatas: 'english' duas vezes nao significa nada e passaria a ser
--    enviado duas vezes ao provider.
-- 3. O idioma de abertura (`language`) precisa estar dentro do array. Abrir a
--    call num idioma que a agente nao reconhece e o pior estado possivel:
--    ela fala primeiro e nao entende a resposta.
--
-- ESCOPO
-- Sem RPC nova. `portal_agent_video_config` passa a expor a coluna. A
-- capability version nao sobe: a ausencia da coluna faz o portal cair no
-- comportamento de hoje, que e um estado seguro, entao ela nao precisa virar
-- gate de readiness. Mesmo precedente de 0055, 0060, 0061, 0062 e 0063.

alter table public.agent_video_config
  add column if not exists spoken_languages text[];

-- CHECK nao aceita subconsulta, entao a deteccao de duplicata sai para uma
-- funcao. Em plpgsql de proposito: uma funcao SQL pura seria inlinada de volta
-- na expressao do CHECK, reintroduzindo a subconsulta que o Postgres recusa.
create or replace function app.text_array_has_duplicates(p_values text[])
returns boolean
language plpgsql
immutable
as $$
declare
  v_distinct integer;
begin
  if p_values is null then
    return false;
  end if;
  select count(distinct entry) into v_distinct from unnest(p_values) as entry;
  return v_distinct <> cardinality(p_values);
end;
$$;

alter table public.agent_video_config
  add constraint agent_video_config_spoken_languages_chk
  check (
    spoken_languages is null
    or (
      array_length(spoken_languages, 1) between 1 and 3
      and spoken_languages <@ array['portuguese', 'english', 'spanish']::text[]
      and not app.text_array_has_duplicates(spoken_languages)
      and language = any (spoken_languages)
    )
  );

comment on column public.agent_video_config.spoken_languages is
  'Idiomas que a agente RECONHECE numa call. NULL mantem o comportamento de um idioma so (a coluna language). Vocabulario do dominio, nunca codigo de provider.';

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
    'closer_vertical', v_row.closer_vertical,
    'spoken_languages', v_row.spoken_languages
  );
end;
$$;

revoke all on function public.portal_agent_video_config from public, anon;
grant execute on function public.portal_agent_video_config to authenticated;

COMMIT;
