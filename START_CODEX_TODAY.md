# Começar a programação no Codex hoje

Este é o caminho mais seguro e direto para iniciar a implementação sem voltar ao Fable 5 ou ao Claude Code.

## 1. Entregue a pasta inteira

Descompacte `AXTRO_DIGITAL_HUMAN_OS_V2_CODEX_READY.zip` e abra a pasta `axtro-digital-human-os-v2` como projeto no Codex. Não envie apenas o prompt. Os contratos, migrations, task graph, instruções e validadores fazem parte da especificação.

## 2. Modo recomendado

O projeto já contém `.codex/config.toml` com:

```toml
approval_policy = "on-request"
sandbox_mode = "workspace-write"
```

A rede fica desabilitada por padrão. Instalações e acesso externo devem solicitar aprovação.

No Codex CLI, dentro da pasta:

```bash
python3 scripts/validate_all.py
codex --sandbox workspace-write --ask-for-approval on-request
```

No aplicativo ou IDE do Codex, abra a pasta, marque o projeto como confiável e use o modo equivalente a workspace write com aprovação quando necessário.

## 3. Prompt para colar

Cole integralmente o conteúdo de:

```text
docs/playbooks/PROMPT_EXECUCAO_AUTONOMA_CODEX.md
```

## 4. Primeiro resultado esperado

O Codex deve:

1. Rodar os sete validadores e registrar a evidência.
2. Ler a Constituição, o handoff e a tarefa `M0-01`.
3. Inicializar o monorepo e Git quando necessário.
4. Criar os comandos reais de lint, typecheck, test e build.
5. Implementar M0 por dependências, com contratos e fakes.
6. Concluir o Walking Skeleton M1.
7. Iniciar M2 somente quando M0 e M1 estiverem verdes.

## 5. O que não deve acontecer

- Começar pela interface bonita sem o domínio e a segurança.
- Pular RLS, receipts, outbox ou testes cross-tenant.
- Usar credenciais reais para desbloquear o MVP.
- Escolher Tavus, OpenAI, LiveKit, Recall ou outro provider como definitivo sem benchmark.
- Colocar o Axtro Agent dentro do loop de cada resposta.
- Deixar dois subagentes editarem o mesmo write set.
- Tratar a conclusão de M2 como autorização de lançamento.

## 6. Evidência que deve voltar

Ao fim de cada marco, o Codex deve entregar:

- tarefas concluídas e commits ou fronteiras commit-ready;
- comandos e resultados dos testes;
- demo reproduzível;
- decisões registradas;
- riscos residuais;
- atualização de `PROGRESS.md`;
- confirmação de que `python3 scripts/validate_all.py` continua verde.
