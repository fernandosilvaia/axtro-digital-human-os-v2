# Plano de integração da rodada do Codex (2026-10-01) na `main` e no banco hospedado

Estado: **proposta, nada executado.** Escrito em 2026-10-10 sobre o commit `e10d566` da branch `claude/post-codex-fixes-2026-10-10`, que está empilhada em `codex/audit-2026-10-01`. Nenhum push, merge, migration remota ou deploy foi feito para preparar este plano.

Convenção de evidência: **[V]** verificado por mim nesta sessão (git, leitura de código, execução local), **[D]** declarado em documento do repositório, **[S]** reportado por outra sessão do Fernando (leitura somente no hospedado), **[?]** não verificado.

## 1. Resumo e decisões pedidas

A branch tem 19 commits à frente da `main` e 0 atrás, então a integração em si é um fast-forward [V]. O difícil não é o merge, é a **ordem entre schema, código e portão de prontidão**, porque:

1. cada uma das migrations 0059, 0069, 0070, 0071, 0072 e 0073 publica uma `version` nova (59, 69, 70, 71, 72, 73) encadeada na anterior, e o portão de prontidão da `main` só aceita 50, 56, 57 e 58 [V];
2. o código novo chama a busca híbrida da 0074 **sem fallback**, de propósito [V];
3. o código novo já removeu os botões de exclusão direta, que só deixam de funcionar com a 0059 [V];
4. o hospedado não tem a 0059 nem a 0069 [S].

**Recomendação:** Opção B (seção 4), uma janela única com **schema primeiro, código depois**, mais duas peças de preparação que eu posso fazer sozinho antes da janela: uma migration 0077 que publica as capabilities de 0074 a 0076, e a atualização do portão para o schema final.

Decisões que só você pode tomar:

| # | Decisão | Por que é sua |
|---|---|---|
| D1 | Aplicar a governança de dados (0059) no hospedado agora, ou adiar e ir pela Opção C | Desliga a exclusão direta de agente, fonte e conversa para todo tenant. Decisão de produto e LGPD |
| D2 | Quem executa os pedidos de exclusão aprovados | `apps/workflow-worker` é código morto (memória do projeto), então hoje o pedido é registrado e aprovado, mas nada o executa |
| D3 | Autorizar o database operator a ler e aplicar as migrations no hospedado | Banco e produção são risco alto com gate humano pela regra da casa |
| D4 | Chaves das autoridades de atestação: gerar aleatórias e guardar no Doppler | O seed do harness deriva as chaves de uma constante do repositório [V] e nunca pode ir para produção |
| D5 | Janela de manutenção e quem fica como release owner, database operator e observer | O runbook M5-01 já exige esses papéis |

## 2. Estado verificado

| Fato | Fonte |
|---|---|
| `main` = `origin/main` = `3f0a489`. Branch atual: 19 commits à frente, 0 atrás | [V] `git rev-list --count` |
| 19 commits = 12 do Codex (migrations 0071 a 0075, IMP-01 a IMP-05, ADR-047/048/049) + 7 meus (advisories, locale do harness, 0076, validação pré-fence da ingestão, `not_started` no vídeo, D-V2-193, README 0074/0075) | [V] `git log` |
| Gate no `fd6b513` (os commits seguintes só mexem em documentação): 2.130 testes Node, 63 Python, `validate_all` 9/9, build do portal, PostgreSQL 0001 a 0076 | [V] execução local |
| Portão de prontidão: `MAXIMUM_COMPATIBLE_SCHEMA_VERSION = 58` em `apps/portal/src/app/api/ready/route.ts:24`, conjunto `{50, 56, 57, 58}`; `REQUIRED_SCHEMA_VERSION = 58` em `scripts/production-readiness-bootstrap.mjs:11`, executado como `preDeployCommand` em `railway.json` | [V] |
| Hospedado: tabelas de governança (0059) e de checkout (0069) **não existem**; `list_migrations` termina em `agent_video_config_self_service_catches_up` (14/09) | [S] sessão "Apply migration 0070", que não aplicou nada |
| Hospedado: 0060 a 0068 constam como aplicadas em `RELEASE_READINESS.md`, mas a mesma sessão leu a lista de migrations de outro jeito. **Conflito a resolver no preflight** (anexo B) | [D] contra [S] |
| Railway só usa o healthcheck no momento do deploy e **não monitora depois que o deploy está no ar** | [V] documentação oficial do Railway |
| Se o healthcheck do deploy novo falha, o deploy antigo continua ativo | [V] documentação oficial, por inferência do texto |
| Rollback e redeploy reutilizam a imagem; **a documentação não diz** se o `preDeployCommand` roda de novo | [V] documentação oficial; tratar como risco (seção 7) |
| Hoje o hospedado serve só testes do Fernando, sem tráfego pago (`RELEASE_READINESS.md`, "risco aceito só pro Fernando testar") | [D] |

## 3. Por que um merge direto na `main` quebra

**C1. Portão de prontidão contra a cadeia de versões.** A cadeia é 58 → 59 → 69 → 70 → 71 → 72 → 73, cada função de capabilities renomeia a anterior para `portal_schema_capabilities_vNN` e a 0069 chama `v59` [V]. Consequências: (a) aplicar qualquer migration da cadeia deixa `/api/ready` em 503 para o build atual; (b) não existe aplicação parcial a partir da 0069 sem a 0059; (c) um build novo com o portão em 58 falha no bootstrap contra qualquer schema da cadeia, e o deploy não sobe. As migrations 0060 a 0068, 0074 e 0076 **não** mudam a versão [V].

**C2. Busca híbrida sem fallback.** `apps/portal/src/lib/brain/knowledge-retrieval.ts` chama `portal_search_knowledge_hybrid_service` e devolve lista vazia em qualquer erro, sem usar a RPC antiga, para não servir conteúdo sem provar a validade e a política atuais [V]. Código novo contra schema sem 0074: o RAG fica vazio em silêncio e cada turno ainda paga um embedding antes de descobrir (achado da revisão independente).

**C3. Botões de exclusão.** O código novo trocou `AgentDeleteButton` e a exclusão de fonte por texto de "indisponível" [V]. Sem a 0059 no hospedado, a exclusão direta ainda funciona e a UI a esconde. Com a 0059 e o build antigo, os botões existem e sempre falham (a mensagem já é traduzida na `main`).

**C4. Invisibilidade das migrations 0074 a 0076.** Nenhuma delas publica capability [V]. O portão fica verde com RAG vazio, com a projeção de turnos ausente ou com os timeouts do ledger perdidos. Por isso a Opção B inclui a 0077.

**C5. Governança sem executor e sem chaves.** `apps/workflow-worker` é código morto (memória do projeto). O seed do harness calcula as chaves das autoridades como `sha256("axtro-governance-authority:{kind}:{code}")` (`scripts/supabase-portal-integration.mjs:2174`) [V]; quem lê o repositório consegue forjar atestações com elas. Em produção precisam ser aleatórias e ficar no Doppler. Sem autoridades provisionadas a tela de governança mostra "indisponível neste ambiente" e falha fechada, o que é aceitável.

**C6. Quórum e harness.** A branch `claude/awesome-hermann-bacade` (`49394b2`) impede o autor do pedido de aprovar a própria exclusão do tenant. Efeito: tenant com menos de 3 `tenant_admin` não conclui a aprovação, e o fallback `operator_required` da ADR-046 não existe [D]. Essa branch conflita **só** em `scripts/supabase-portal-integration.mjs` com a minha pilha [V] (`git merge-tree`). A branch `claude/silly-bassi-a00e7f` (`af90f21`, travessões) mescla limpo [V].

## 4. Opções

| Opção | O que faz | Risco | Reversibilidade | Depende de |
|---|---|---|---|---|
| A. Merge direto e deixar o Railway publicar | Fast-forward na `main` | Alto. Sem aplicar o schema, o deploy passa (hospedado e portão em 58) e o RAG fica vazio (C2) e a UI perde a exclusão (C3). Se o schema for aplicado depois, `/api/ready` vai a 503 (C1) | Boa para o código, mas o RAG vazio é silencioso | Nada. **Não recomendada** |
| **B. Janela única: schema, depois código** | Aplica 0059 e 0069 a 0077 em ordem, depois publica o código com o portão novo | Médio, concentrado na janela | Schema é forward-only; o app só avança por correção | D1 a D5 |
| C. Só 0074 e 0076, com o código sem a remoção dos botões | Aplica as duas migrations que não mudam versão e publica um recorte do código | Baixo | Boa: o portão continua em 58 | Um recorte de código a produzir (seção 6) |
| D. Segurar fora da `main` | Nada em produção | Nenhum agora; a dívida de schema cresce | Total | Só tempo |

0074 e 0076 não usam nenhum dos 113 objetos criados só pela cadeia 0059/0069 a 0073 [V, análise estática]; a 0075 usa 25 deles [V]. Isso sustenta a Opção C, mas a combinação "0001 a 0068 mais 0074 e 0076, sem a cadeia" **nunca foi executada** no harness [?] e precisa de uma variante antes de ser confiável.

## 5. Plano da Opção B

### Fase 0. Preparação local (eu faço, sem tocar produção)

| # | Item | Pronto quando |
|---|---|---|
| P0.1 | Criar `integration/codex-2026-10` a partir da pilha, mesclar `49394b2` e `af90f21`, resolver o conflito do harness adotando o fixture de 3 admins | `pnpm db:portal:test` e o gate completo verdes |
| P0.2 | Migration `0077` que reescreve `portal_schema_capabilities_service` com `version` 77 e três capabilities **calculadas do catálogo**, não constantes: `hybridKnowledgeRetrieval` (RPC e índice FTS existem), `conversationTurnRedactionProjector` (trigger `conversation_turns_append_only` presente) e `aiLedgerTimeoutsBounded` (as cinco RPCs com `proconfig` correto). Mesmo padrão de `dataGovernanceWriteFenceRepaired` | Harness afirma antes e depois, teste de linhagem cobre a 0077 |
| P0.3 | Portão: `route.ts` e `production-readiness-bootstrap.mjs` passam a exigir a versão 77 e as três capabilities; testes de readiness e de bootstrap atualizados | Testes de readiness verdes; `/api/ready` recusa 73 sem as capabilities |
| P0.4 | Variante do harness para a Opção C (0001 a 0068 mais 0074 e 0076) | Passa em PG17 |
| P0.5 | Sondas somente leitura do anexo B revisadas com o database operator | Lista final aprovada |
| P0.6 | Runbook operacional da janela derivado da seção 5, no formato do `M5_01_PRODUCTION_ROLLOUT.md` | Revisado por você |

Estimativa: P0.1 a P0.3 são trabalho de um ciclo; P0.4 é pequeno.

### Fase 1. Decisões e autorizações (humano)

D1 a D5 respondidas por escrito. Sem D1 e D2 a Opção B não segue; cair para a C.

### Fase 2. Janela de manutenção

1. **Congelar** os caminhos pagos (vídeo, Recall, OpenRouter, checkout) como no §2 do M5-01. Como o hospedado não tem tráfego pago, o drain é curto, mas `provider_in_flight` e `unknown` devem estar em zero [D].
2. **Preflight somente leitura** no hospedado com o anexo B: confirmar quais das 0059 a 0076 já existem e o estado de `ai_usage_reservations`, `conversation_turns`, `agent_video_config` e `knowledge_chunks`. Parar se a sonda contradisser o que está escrito aqui.
3. **Aplicar, uma por transação, na ordem:** 0059, 0069, 0070, 0071, 0072, 0073, 0074, 0075, 0076, 0077. Depois de cada uma, ler `portal_schema_capabilities_service()` e registrar `version` e capabilities. Parar na primeira divergência.
   - A 0075 recusa a migration se `conversation_turns` divergir da forma conhecida de 13 colunas [V]; isso é esperado, não contornar.
   - A 0072 não certifica vínculos históricos de vídeo [V]: conferir antes se algum `agent_video_config` aponta para persona de outro tenant.
   - A 0074 cria um índice GIN sem `CONCURRENTLY` em `knowledge_chunks`, o que bloqueia escrita nessa tabela durante a criação [V]. Com tabela pequena é segundos; confirmar a contagem de linhas no preflight.
4. **Autoridades de atestação:** gerar chaves aleatórias (32 bytes), guardar no Doppler, provisionar. Passo separado, com o gate de D4. Pode ficar para depois do deploy; a tela mostra "indisponível" até lá.
5. **Publicar o código:** fast-forward da `main` para `integration/codex-2026-10`. O Railway faz o build, roda o bootstrap com o portão novo e só promove com `/api/ready` 200. Se falhar, o deploy antigo continua no ar (degradado, ver seção 7).
6. **Smokes pós-deploy**, todos sem custo pago: login; cadastrar fonte de conhecimento com texto de teste e conferir que a busca devolve o trecho; conversa de texto no brain; `/configuracoes` mostra o estado da governança; `/api/ready` 200; zero reservas `unknown`. Teste pago de vídeo continua exigindo sua autorização.
7. **Descongelar** e observar duas leituras de `/api/ready` separadas por um intervalo.

### Fase 3. Fechamento

Registro de evidência (modelo no fim do M5-01), atualização de `PROGRESS.md`, do README de migrations (trocar "não aplicada remotamente") e do `DECISIONS_LOG`.

### Fora do escopo desta janela (gates próprios)

`PORTAL_PROVIDER_TERMINATION_ENABLED`, canário de terminação, Stripe live, teste pago de mídia, OAuth do Google em produção.

## 6. Plano da Opção C (fallback)

Aplica só 0074 e 0076 no hospedado e publica um recorte do código. O schema continua com `version` 58, então o portão atual segue verde com o build antigo e com o novo.

**A Opção C custa mais do que parecia.** O código da pilha trocou três telas por versões que só fazem sentido com a governança aplicada, e as três precisam ser revertidas no recorte [V, leitura do diff]:

| Tela | O que o código novo faz | Efeito num hospedado sem a cadeia |
|---|---|---|
| `agent-delete-button.tsx` | Troca o botão de excluir agente por texto "indisponível" | Perde a exclusão que ainda funciona |
| `source-actions.tsx` e `conhecimento/page.tsx` | Remove a exclusão de fonte | Idem |
| `video-config.tsx` e `agent-video-config.ts` | Remove o formulário de persona e réplica (self-service da D-V2-179) e mostra "onboarding governado pendente" | Perde o cadastro de persona que a 0068 liberou; só a 0072 faz o servidor recusar |

As demais mudanças de aplicação funcionam nos dois schemas (`setAgentVideoConfig` relê a persona armazenada e a reenvia, aceita pela RPC antiga e pela da 0072) [V]. O custo da C é manter um recorte divergente da pilha até a governança entrar, e a cadeia 0059 a 0073 continua pendente. Por isso a recomendação continua sendo a B; a C só vale se D1 for "não agora".

Prova disponível: o perfil `hosted-without-governance` do harness (`pnpm db:portal:test:hosted-profile`) aplica 0001 a 0058, 0060 a 0068, 0074 e 0076 e confirma que a versão publicada continua 58 [ver seção 10].

## 7. Rollback e modos de falha

| Momento | O que acontece | Ação |
|---|---|---|
| Falha numa migration | Cada uma roda em transação e reverte sozinha | Parar, registrar, não editar a migration durante a janela |
| Migrations aplicadas, deploy novo falha no bootstrap | O deploy antigo continua servindo, com `/api/ready` em 503 e sem monitor que o derrube [V]. Degradação: exclusão direta falha, edição de persona de vídeo é recusada pela 0072 [V] | Corrigir para frente e republicar |
| Deploy novo no ar com problema | O schema é forward-only. Rollback do app para o build antigo **pode ser impossível**: o portão antigo em 58 rejeita o schema 77, e a documentação do Railway não diz se o rollback reexecuta o `preDeployCommand` [V] | Plano é hotfix para frente. Antes da janela, testar o rollback no ambiente de staging do Railway, se existir [?] |
| Migration 0059 em diante | Não reverter, não restaurar RPCs de exclusão direta, não apagar tabelas de governança | Forward-only (mesma regra do M5-01 depois da 0042) |

## 8. Coordenação com as sessões abertas

| Sessão | Estado | Relação com este plano |
|---|---|---|
| "Apply migration 0070 + seed governance authorities" | Ociosa, **não aplicou nada** [S] | A premissa não vale: a 0070 depende da 0059 e da 0069. Não aplicar a 0070 sozinha e não usar o seed do harness. Sugiro arquivar |
| "Apply the one remaining SQL fix for self-approval gap" | Concluída: `49394b2`, sem push | Entra na P0.1; conflito só no harness |
| "Scrub remaining em dashes" | Concluída: `af90f21`, sem push | Entra na P0.1; mescla limpo |
| "Verify production Supabase redirect-URL allow-list" e "Set PT-BR password-reset email template" | Configuração de auth, independente do schema | Sem dependência; fazer antes ou depois, mas conferir `/auth/callback` antes de liberar convites |

## 9. Riscos residuais e o que não foi verificado

- O estado real do hospedado não foi lido por mim (a leitura foi negada) [?]. Tudo da seção 2 marcado [S] ou [D] vale como hipótese até o preflight.
- A combinação 0074 e 0076 sem a cadeia só tem prova estática [?].
- Depois do `49394b2`, tenant com menos de 3 admins não consegue concluir a aprovação de exclusão; produto e operação precisam decidir o caminho `operator_required` [D].
- Achados abertos da revisão independente que **não** bloqueiam a integração, mas não foram corrigidos: classificação "Restrito" não filtra a busca (desde a 0010); `scripts/ingest-knowledge-bulk.mjs` faz chamada paga sem reserva; possível conflito de `destroy()` com `createCallObject` no daily-js; RPCs de busca híbrida liberadas a `authenticated` sem chamador. Lista completa na memória do projeto.

## Anexo A. Cadeia de migrations pendentes

| Migration | Muda `version` | Exige | Observação |
|---|---|---|---|
| 0059 governança de dados | 59 | v58 | Desliga exclusão direta. Cria o catálogo, o keyring e as autoridades |
| 0060 a 0068 | não | nada da cadeia | Consta como aplicada [D]; conferir [S] |
| 0069 checkout Stripe Connect | 69 | v59 | Tabelas novas de checkout |
| 0070 catálogo de governança | 70 | v69 | Seis tabelas faltavam no catálogo |
| 0071 write fence | 71 | v70 | Triggers de fence nas tabelas onboardadas |
| 0072 ativos de vídeo | 72 | v71 | RPC autenticada só edita idioma e vertical |
| 0073 evidência financeira | 73 | v72 | Normaliza tupla 0,0 no commit |
| 0074 busca híbrida | não | nada da cadeia | Índice GIN, RPCs híbridas, redefine begin e mark |
| 0075 projetor de turnos | não | governança (25 objetos) | Recusa forma divergente de `conversation_turns` |
| 0076 timeouts do ledger | não | nada da cadeia | `alter function ... set` em três RPCs |
| 0077 (a escrever, P0.2) | 77 | v73 | Publica as capabilities de 0074 a 0076 |

## Anexo B. Sondas somente leitura para o preflight

```sql
-- versão e capabilities publicadas
select public.portal_schema_capabilities_service()->>'version' as version;

-- objetos principais por migration (true = aplicada)
select
  to_regclass('public.data_governance_resource_catalog') is not null      as m0059,
  to_regproc('public.portal_business_action_resolve_meeting_slot_service') is not null as m0060,
  to_regproc('public.portal_business_action_resolve_session_meeting_slot_service') is not null as m0061,
  to_regclass('public.google_calendar_oauth_states') is not null          as m0065,
  to_regproc('public.portal_sweep_stale_ai_usage_unknown_service') is not null as m0067,
  to_regclass('public.portal_business_action_checkout_connections') is not null as m0069,
  to_regproc('public.portal_search_knowledge_hybrid_service') is not null as m0074,
  exists (select 1 from pg_trigger where tgname = 'conversation_turns_append_only') as m0075;

-- 0062, 0063, 0064, 0066 e 0068 só redefinem funções: conferir pelo registro de migrations do operador.

-- dados que as migrations seguintes podem recusar
select state, count(*) from public.ai_usage_reservations group by state order by state;
select count(*) as knowledge_chunks from public.knowledge_chunks;
select count(*) as video_bindings from public.agent_video_config;
```

## Anexo C. Comandos de verificação local (já executados no `e10d566`)

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
.venv/bin/python3 scripts/validate_all.py
pnpm db:portal:test        # PostgreSQL 0001 a 0076
git merge-tree --write-tree --name-only HEAD claude/awesome-hermann-bacade   # conflito só no harness
```

## 10. Andamento da preparação (Fase 0)

Branch local `integration/codex-2026-10`, criada a partir da pilha, sem push. Atualizado em 2026-10-10.

| Item | Estado | Evidência |
|---|---|---|
| P0.1 integrar `49394b2` e `af90f21` | feito | Conflito só no harness, resolvido mantendo o fixture de efeitos do Codex e o de 3 admins; PostgreSQL 0001 a 0076 passou no branch mesclado |
| P0.2 migration 0077 | feito | `0077_schema_capability_publication.sql`: `version` 77 e três flags calculadas do catálogo; o harness prova que cada flag cai quando o objeto some (mutação com rollback) e que as outras 9 capabilities da cadeia estão publicadas |
| P0.3 portão | feito | `route.ts` e `production-readiness-bootstrap.mjs` exigem as 12 capabilities de integração e aceitam v77; a v58 hospedada hoje e as versões 59 a 76 e 78 são recusadas; mutação (remover uma capability do portão) derruba 2 testes |
| P0.4 perfil `hosted-without-governance` | em validação | Primeira execução expôs asserções que esperavam a versão 59 depois da 0060 e da 0061; corrigidas para o perfil |
| P0.5 sondas do preflight | pendente | Revisar o anexo B com o operador de banco |
| P0.6 runbook da janela | pendente | Derivar da seção 5 |

Decisão de projeto do portão: o build novo passa a recusar o schema v58 de propósito. Se a janela falhar entre as migrations e o deploy, o build antigo continua no ar (o Railway não o derruba), mas o build novo não sobe contra um schema sem a busca híbrida. Isso troca "RAG vazio em silêncio" por "deploy bloqueado com erro explícito".
