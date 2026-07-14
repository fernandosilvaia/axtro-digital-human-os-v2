# Handoff para Codex

## Missão

Implementar o Axtro Digital Human OS V2 a partir desta pasta, começando por M0 e avançando apenas quando os gates do marco anterior estiverem verdes.

## Estado recebido

- Constituição e arquitetura V2;
- 31 contratos JSON Schema Draft 2020-12;
- 31 exemplos válidos e 31 inválidos;
- OpenAPI 3.1 e AsyncAPI 3;
- sete migrations SQL de referência, RLS e deletion graph;
- task graph com 52 tarefas M0-M3;
- oito subagentes Codex e quatro skills de repositório;
- sete validadores agregados por `scripts/validate_all.py`;
- provider fakes como requisito de M0-M2;
- modelo editável de unit economics.

Não há aplicação pronta, credenciais, provider vencedor ou autorização para produção regulada.

## Ordem de leitura

1. `AGENTS.md`
2. `ARCHITECTURE_CONSTITUTION.md`
3. `PROGRESS.md`
4. `backlog/MVP_TASK_GRAPH.yaml`
5. Documento e contrato citados pela tarefa ativa
6. Antes de M2: `docs/operations/PROVIDER_CAPABILITY_VERIFICATION_2026-07-14.md` e `docs/sources/SOURCE_REGISTER.md`

## Primeira execução

1. Rode `python3 scripts/validate_all.py` antes de editar.
2. Registre a evidência em `PROGRESS.md`.
3. Inicialize Git se necessário. Crie uma fronteira baseline antes do código quando a identidade Git estiver disponível.
4. Execute `M0-01` e siga as dependências do task graph.
5. Use adapters fake até existir credencial e aprovação explícitas.
6. Não implemente M3 antes de demonstrar e auditar M2.

## Estratégia de subagentes

Para cada task group relevante:

1. Use reviewers read-only em paralelo para exploração e riscos.
2. Aguarde todos os resultados.
3. Designe apenas um `implementation_worker` para cada conjunto de arquivos.
4. Rode `test_reviewer` e o reviewer de domínio depois do patch.
5. O agente principal integra, valida e atualiza o progresso.

Custom agents disponíveis em `.codex/agents/`: `architecture_reviewer`, `security_reviewer`, `realtime_reviewer`, `data_reviewer`, `test_reviewer`, `cost_reviewer`, `docs_researcher` e `implementation_worker`.

## Quando pedir decisão humana

Somente para:

- contratar ou ativar cobrança de provider;
- usar credenciais reais;
- escolher avatar ou modelo como default de produção;
- alterar artigo constitucional;
- apagar dados reais;
- lançar em setor regulado;
- expor endpoint público sem autenticação;
- usar imagem, voz ou réplica de pessoa real;
- executar ação destrutiva ou fora do workspace.

Para decisões reversíveis, escolha a opção mais conservadora compatível com os documentos, registre e continue.

## Marcos de entrega

### M0

Repositório executável, contratos gerados, banco local, RLS tests, fakes, CI, observabilidade e segurança base.

### M1

Walking Skeleton reproduzível com sessão, estado, turno textual, action runtime fake, receipt, timeline, replay, outbox, workflow pós-call e custo.

### M2

Human Presence Spike com voz, barge-in, late-output blocking, avatar adapter, behavior, scene, especialista interno e relatório de latência, naturalidade, falhas e custo.

### M3

Sales Closer Alpha interno. Não declarar pronto para cliente sem auditoria, provider bake-off, segurança, privacidade e aprovação de lançamento.
