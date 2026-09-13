BEGIN;

-- D-V2-172: o digest de conhecimento descartava a fonte inteira em vez de cortá-la.
--
-- O DEFEITO
-- `portal_knowledge_digest` monta um resumo de contexto com orçamento por
-- fonte: `v_source_budget := greatest(600, p_max_chars / v_source_count)`.
-- O laço interno acumulava chunks assim:
--
--   exit when char_length(v_source_content) + char_length(r_chunk.content_text) + 1 > v_source_budget;
--
-- Ou seja: se o PRIMEIRO chunk não coubesse inteiro no orçamento, o laço saía
-- sem acumular nada, e o `continue when v_source_content = ''` logo abaixo
-- descartava a fonte por completo. Não é um corte, é um tudo-ou-nada.
--
-- Isso colide de frente com o chunker do próprio portal. `chunkContent`
-- (apps/portal/src/lib/knowledge.ts) usa TARGET_CHUNK_CHARS = 1200, então o
-- primeiro chunk de qualquer documento real tem entre ~700 e 1200 chars, quase
-- sempre acima do piso de 600. Resultado: a fonte quase nunca entra.
--
-- MEDIDO EM PRODUÇÃO ANTES DA CORREÇÃO (2026-09-13, tenant de demonstração):
-- 14 fontes ativas, primeiro chunk de 11 delas entre 724 e 1183 chars. O digest
-- devolvia 358 chars vindos de UMA fonte só ("Tabela de preços por região",
-- primeiro chunk de 319 chars, a única abaixo do piso). Os 10 manuais do
-- Método Silva, com 400+ chunks somados, não chegavam em nenhuma call. O
-- recurso estava silenciosamente morto: não dava erro, só devolvia quase nada.
--
-- A CORREÇÃO
-- Quando o chunk não cabe inteiro, entra um PREFIXO dele até o orçamento, em
-- vez de a fonte ser jogada fora. O corte procura uma fronteira legível, nesta
-- ordem: fim de frase, depois fronteira de palavra, e só então corte seco. O
-- prefixo recebe o marcador " [...]" para o modelo saber que o trecho continua,
-- e o marcador é contado dentro do orçamento, nunca acima dele.
--
-- POR QUE CORTAR E NÃO SUBIR O PISO
-- Subir o piso para ~1300 faria caber um chunk inteiro, mas aí só ~2 fontes
-- entrariam nos 3500 chars. O digest é contexto ambiente, não recuperação: a
-- recuperação dirigida é `portal_search_knowledge_service`, que devolve chunks
-- inteiros e relevantes para a pergunta. Para contexto ambiente, largura vale
-- mais que profundidade, então 5 fontes cortadas batem 2 fontes inteiras.
--
-- ESCOPO
-- Assinatura, permissões e formato de retorno não mudam, então a versão de
-- capacidade não sobe (mesmo precedente de 0055, 0060 e 0061). O que muda é só
-- o conteúdo que já deveria estar sendo entregue.

create or replace function public.portal_knowledge_digest(
  p_max_chars integer default 3500
) returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_tenant app.uuid_v7;
  v_content text := '';
  v_sources jsonb := '[]'::jsonb;
  v_source_count integer;
  v_source_budget integer;
  v_source_content text;
  v_piece text;
  v_room integer;
  v_slice text;
  v_cut text;
  r_source record;
  r_chunk record;
  -- Marcador de continuação, contado DENTRO do orçamento.
  c_ellipsis constant text := ' [...]';
  -- Abaixo disto um prefixo vira confete e não ajuda o modelo: melhor não
  -- cortar do que entregar meia frase solta.
  c_min_slice constant integer := 160;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  select tenant_id into v_tenant
  from public.user_tenant_memberships where user_id = auth.uid();
  if v_tenant is null then
    raise exception 'no tenant provisioned' using errcode = '42501';
  end if;
  if p_max_chars is null or p_max_chars < 200 or p_max_chars > 6000 then
    raise exception 'max_chars must be 200..6000' using errcode = '22023';
  end if;

  select count(*) into v_source_count
  from public.knowledge_sources s
  where s.tenant_id = v_tenant and s.status = 'active';
  if v_source_count = 0 then
    return jsonb_build_object('content', null, 'sources', '[]'::jsonb);
  end if;

  -- Orçamento por fonte: divide o teto entre as fontes, com piso de 600
  -- chars. Com muitas fontes entram só as ~(teto/600) mais recentes, cada
  -- uma com conteúdo suficiente pra ser utilizável (não confete).
  v_source_budget := greatest(600, p_max_chars / v_source_count);

  for r_source in
    select s.id, s.display_name
    from public.knowledge_sources s
    where s.tenant_id = v_tenant and s.status = 'active'
    order by s.created_at desc, s.id desc
  loop
    v_source_content := '';
    for r_chunk in
      select ch.content_text
      from public.knowledge_chunks ch
      join public.knowledge_versions v on v.tenant_id = ch.tenant_id and v.id = ch.version_id
      where ch.tenant_id = v_tenant and v.source_id = r_source.id
      order by ch.chunk_index
    loop
      -- O +1 reserva o \n que separa este chunk do anterior.
      v_room := v_source_budget - char_length(v_source_content) - 1;
      if char_length(r_chunk.content_text) <= v_room then
        v_source_content := v_source_content || E'\n' || r_chunk.content_text;
        continue;
      end if;

      -- Não cabe inteiro. Antes daqui saía sem acumular nada e a fonte era
      -- descartada; agora entra o maior prefixo legível que couber.
      v_room := v_room - char_length(c_ellipsis);
      exit when v_room < c_min_slice;

      v_slice := left(r_chunk.content_text, v_room);
      -- 1) até o fim da última frase completa do prefixo. O \s depois do
      -- terminador é obrigatório de propósito: sem ele, "R$ 18.900" casaria
      -- no ponto decimal e o corte entregaria "custa R$ 18." como se fosse o
      -- preço. Preço cortado no meio é pior que texto faltando.
      v_cut := rtrim(substring(v_slice from '^.*[.!?]\s'));
      -- 2) senão, até a última fronteira de palavra.
      if v_cut is null or char_length(v_cut) < c_min_slice then
        v_cut := regexp_replace(v_slice, '\s+\S*$', '');
      end if;
      -- 3) senão, corte seco (chunk sem espaço nenhum no trecho).
      if v_cut is null or char_length(v_cut) < c_min_slice then
        v_cut := v_slice;
      end if;

      v_source_content := v_source_content || E'\n' || v_cut || c_ellipsis;
      exit;
    end loop;

    continue when v_source_content = '';
    v_piece := E'\n\n### Fonte: ' || r_source.display_name || v_source_content;
    exit when char_length(v_content) + char_length(v_piece) > p_max_chars;
    v_content := v_content || v_piece;
    v_sources := v_sources || to_jsonb(r_source.display_name);
  end loop;

  if v_content = '' then
    return jsonb_build_object('content', null, 'sources', '[]'::jsonb);
  end if;
  return jsonb_build_object('content', ltrim(v_content, E'\n'), 'sources', v_sources);
end;
$$;

revoke all on function public.portal_knowledge_digest(integer) from public, anon;
grant execute on function public.portal_knowledge_digest(integer) to authenticated;

COMMIT;
