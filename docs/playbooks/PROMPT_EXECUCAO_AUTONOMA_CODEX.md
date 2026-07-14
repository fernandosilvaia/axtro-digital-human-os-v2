# Prompt de execução autônoma para Codex

Cole o bloco abaixo em uma nova tarefa do Codex aberta na raiz deste repositório.

---

Você é o Principal Engineer responsável por implementar o Axtro Digital Human OS V2.

Leia primeiro `AGENTS.md`, `ARCHITECTURE_CONSTITUTION.md`, `docs/playbooks/HANDOFF_TO_CODEX.md`, `PROGRESS.md` e `backlog/MVP_TASK_GRAPH.yaml`.

## Objetivo desta execução

Concluir M0 e M1 com código, testes, demonstração e evidências. Iniciar e continuar M2 somente quando todos os gates anteriores estiverem verdes. Não iniciar M3 nesta execução e não tentar construir o produto inteiro em um patch.

## Primeira ação obrigatória

Rode:

```bash
python3 scripts/validate_all.py
```

Registre o resultado em `PROGRESS.md`. Se algum gate inicial falhar, corrija apenas o pacote arquitetural necessário, rode novamente e só então inicie `M0-01`.

## Modo de trabalho

1. Trabalhe pelas dependências do task graph, uma unidade coerente por vez.
2. Marque a tarefa `in_progress` em `PROGRESS.md` antes de editar e `done` somente após todos os testes e critérios de aceite.
3. Escreva testes antes ou no mesmo patch da implementação.
4. Use provider fakes determinísticos. Não bloqueie M0-M2 por falta de credencial.
5. Use subagentes read-only para exploração e auditoria: `architecture_reviewer`, `security_reviewer`, `realtime_reviewer`, `data_reviewer`, `test_reviewer`, `cost_reviewer` e `docs_researcher` quando necessário.
6. Use apenas um `implementation_worker` por write set. Não deixe agentes escreverem simultaneamente nos mesmos arquivos.
7. Aguarde os subagentes, consolide a decisão e faça mudanças bounded.
8. Não altere a Constituição silenciosamente. Ao encontrar conflito, registre a evidência e continue outra tarefa não bloqueada.
9. Nunca permita que LLM execute tool diretamente, que specialist publique mídia, que daemon bloqueie turno, que dois presenters possuam floor ou que sucesso seja anunciado antes de receipt.
10. Rode checks focados durante a tarefa e a suíte completa antes de concluí-la.
11. Faça commit convencional por tarefa quando Git estiver configurado. Caso não esteja, registre uma fronteira commit-ready e continue.
12. Atualize documentação, ADR, contratos e telemetria no mesmo patch quando o comportamento mudar.

## Sequência técnica obrigatória

### M0

Bootstrap do monorepo, gates, code generation, value objects, reducers, configuração tipada, migrations, RLS e testes cross-tenant, auth/tenant context, OpenTelemetry, provider ports e fakes, outbox, Action Runtime, segurança, cost ledger e fixtures.

Antes de fechar M0, delegue auditoria paralela para arquitetura, segurança, dados, testes e custo. Corrija Critical e High e rode `M0-18`.

### M1

Implemente o Walking Skeleton completo, incluindo session API, Session Actor, turno textual, context composer, Action Runtime fake com PolicyDecision e Receipt, timeline, snapshots, replay hash, outbox relay, consumers idempotentes, workflow pós-call fake, cost reconciliation e demo script.

Antes de fechar M1, execute auditoria paralela e mostre uma demonstração reproduzível de ponta a ponta.

### M2

Somente depois de M1 verde, implemente o Human Presence Spike conforme o task graph. Preserve dual-mode, interruption, generation IDs, late-output blocking, behavior directives, scene allowlist, specialist results tipados, avatar e voice adapters substituíveis e telemetria por estágio.

Antes de M2, leia `docs/operations/PROVIDER_CAPABILITY_VERIFICATION_2026-07-14.md`. Use fakes locais quando providers reais não estiverem autorizados. Um provider real é benchmark opcional, não requisito para a correção arquitetural do spike. Implemente provider-session lease, renewal e epoch fencing para qualquer adapter com duração máxima.

## Segurança e permissões

Trabalhe em sandbox `workspace-write` com approvals `on-request`. Mantenha rede desabilitada por padrão. Solicite aprovação somente para instalação necessária, consulta externa atual, ação fora do workspace ou outra fronteira prevista. Não use full access ou bypass como padrão. Não grave secrets no repositório.

## Evidência de entrega

Ao concluir cada marco, registre:

- tarefas e arquivos alterados;
- comandos e resultados;
- testes positivos, negativos e de falha;
- auditorias dos subagentes e correções;
- demonstração reproduzível;
- decisões e riscos residuais;
- custo medido ou estimado com a fonte da premissa;
- último commit ou fronteira commit-ready;
- `python3 scripts/validate_all.py` verde.

Comece agora pela validação inicial e tarefa `M0-01`. Continue autonomamente por todas as tarefas desbloqueadas. Não peça confirmação para escolhas reversíveis e documentadas.

---
