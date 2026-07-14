# HANDOFF_TO_CLAUDE_CODE.md — documento de transferência oficial

> **Você (Claude Code) está recebendo este repositório de documentação para construir o Axtro Human Sales AI do zero.** Este arquivo é seu ponto de entrada único. Data do handoff: 2026-07-13. Autor: arquitetura gerada com o fundador (Axtro). Idioma de trabalho: PT-BR.

## 1. O que você está construindo (3 parágrafos)
Uma plataforma SaaS multi-tenant white-label de **vendedores digitais de IA** que conversam por **voz (e depois vídeo/avatar)** em tempo real: atendem e conduzem chamadas de vendas na "Sala Axtro" (web), ao telefone e, mais tarde, em Google Meet/Zoom. O vendedor IA aplica uma **metodologia comercial explícita e auditável** — default: **Método Silva** (framework SILVA de qualificação, Reunião Silva de 6 fases, Cold Call Silva, esteira de 8 etapas) — mantendo um **SalesSessionState** determinístico que o LLM alimenta mas não governa. Ele executa ferramentas com contratos e classes de risco (agenda, CRM, pagamento), transfere para humanos com **handoff quente** carregando um pacote padronizado, e gera resumo/follow-up pós-call.

Acima da operação existe o **Axtro Agent** (daemon próprio do fundador, engine Hermes/Nous), que **nunca entra no caminho crítico da conversa**: prepara briefings pré-call, envia sugestões efêmeras em paralelo durante a call e roda jobs de melhoria pós-call. Se o daemon cair, a plataforma opera 100%.

O negócio: concorrentes (SalesCloser.ai etc.) vendem agentes genéricos em inglês com metodologia opaca; nosso diferencial é metodologia brasileira nativa + naturalidade de conversa (budgets de latência rígidos) + handoff quente real + white-label. MVP = closer de voz para o tenant zero (o próprio Método Silva) — detalhes em PRODUCT_VISION e BENCHMARK_STUDY.

## 2. Ordem de leitura obrigatória (e só ela, nesta ordem)
1. Este arquivo (inteiro).
2. `docs/operations/IMPLEMENTATION_PLAN.md` — seu plano de trabalho tarefa a tarefa.
3. `docs/architecture/SYSTEM_ARCHITECTURE.md` — mapa geral (D01–D03).
4. Por bloco, leia apenas os docs citados no bloco. Referência completa: README.md (índice).
Os demais documentos são consulta sob demanda. **Não** tente carregar tudo em contexto.

## 3. Estado atual — fatos vs propostas
**FATOS CONFIRMADOS (existem hoje):** os 8 manuais PDF do Método Silva (conteúdo já extraído e refletido em SALES_INTELLIGENCE_ENGINE §3); Google Workspace da Axtro ativo; número Telnyx +1 617 450-5166 ativo; Axtro Agent existe como daemon Hermes do fundador (interfaces a construir). **TUDO O MAIS É PROPOSTO** e está aprovado para execução salvo contra-ordem: stack, schemas, fases, provedores, preços de referência (cotados 2026-07-13 — **reconfirme qualquer preço antes de contratar**; lista em PENDENCIAS_EXTERNAS.md).

## 4. Seu primeiro dia (bootstrap do repo de código)
```bash
# novo repositório de código (docs entram como /docs)
gh repo create axtro/axtro-human-sales-ai --private
cp -r <este-repo-de-docs> ./docs
# F0/B0.1 em diante conforme IMPLEMENTATION_PLAN
pnpm dlx create-turbo@latest . --package-manager pnpm   # ajuste à estrutura do B0.1
```
Crie `PROGRESS.md` imediatamente (template no CLAUDE_CODE_PLAYBOOK §4). Trabalhe bloco a bloco: **B0.1 → B0.8, depois B1.1 → B1.12.** Dependências estão anotadas em cada bloco; blocos sem dependência mútua podem intercalar.

## 5. Critérios de aceite — onde estão
Cada bloco em IMPLEMENTATION_PLAN tem aceite verificável. Gates de qualidade (G1–G6) em EVALUATION_FRAMEWORK. Done = DEFINITION_OF_DONE (10 itens). Não invente critérios; não pule os existentes.

## 6. Comandos canônicos (após B0.1/B0.2)
```bash
pnpm i && pnpm build            # monorepo TS
turbo run test lint typecheck   # qualidade TS
uv sync && uv run pytest        # workers Python
uv run pytest apps/realtime-worker/tests/harness  # harness realtime
pnpm seed                        # tenant zero (idempotente)
supabase db push                 # migrações (dev)
pnpm eval:g1 | pnpm eval:g2 ...  # gates (defina os scripts no B0.4/B1.4)
```

## 7. Convenções que você segue sem exceção
Conventional Commits · branches `feat|fix|chore/<bloco>-<slug>` · squash-merge · PR ≤400 linhas produtivas · migrações duas fases · schemas versionados com bump · tipos gerados · RLS+teste para toda tabela · segredos só Doppler · flags em tabela · logs com `tenant_id/agent_id/session_id/lead_id/opportunity_id/trace_id` · textos de voz/UI em `packages/domain/content/pt-BR/`. Detalhes: CONTRIBUTING.md.

## 8. Pontos NÃO reinterpretáveis (se parecer boa ideia mudar, NÃO mude — registre objeção)
1. Axtro Agent fora do caminho crítico (nada síncrono na conversa).
2. Limites comerciais/preços/permissões fora do prompt; catálogo no DB é a única fonte de preço.
3. Disclosure de IA no primeiro turno — configurável no estilo, jamais removível.
4. RLS em 100% das tabelas com teste de isolamento.
5. SalesSessionState é a fonte de verdade comercial; LLM propõe, motor dispõe.
6. Budgets de latência (REALTIME §5) são requisitos, não aspirações — PR que os viola não mergeia.
7. Fallback declarado para todo provider do caminho crítico.
8. Clonagem de voz somente com evidência de consentimento arquivada.
9. Tool com efeito externo passa por contrato + risk_class + auditoria, sempre.
10. Golden/adversarial gates bloqueiam merge — sem "depois eu arrumo".

## 9. Quando parar e perguntar ao fundador
Apenas: gastar dinheiro novo (contratos/planos) · apagar dados de produção · afrouxar qualquer item do §8 · publicar endpoint público novo sem auth · decisões jurídicas (COMPLIANCE além do especificado). Todo o resto: decida, registre em DECISIONS_LOG (`D-CC-nn`), siga.

## 10. Definição de sucesso do seu trabalho
F0 completo com CI verde; depois F1/B1.12 Go: 10 conversas reais de venda no tenant zero com naturalness ≥4,0, zero violação crítica de guardrail, handoff quente funcionando ≤10s, custo/min real registrado e ≤25% acima do projetado em UNIT_ECONOMICS. Quando atingir, gere `RELEASE_MVP.md` com evidências e pare para revisão do fundador.

Boa construção. O prompt de partida autônoma está em `docs/playbooks/PROMPT_EXECUCAO_AUTONOMA.md`.
