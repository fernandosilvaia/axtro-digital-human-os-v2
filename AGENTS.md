# Instruções do repositório para Codex

## Missão

Construir o Axtro Digital Human OS V2 por marcos pequenos, verificáveis e contract-first. O primeiro produto é o Sales Closer Role Pack, mas o kernel deve permanecer genérico.

## Leia antes de editar

1. `ARCHITECTURE_CONSTITUTION.md`
2. `docs/playbooks/HANDOFF_TO_CODEX.md`
3. `PROGRESS.md`
4. O item atual em `backlog/MVP_TASK_GRAPH.yaml`
5. Apenas os documentos e contratos citados pela tarefa ativa

Não use `legacy/v1` nem `legacy/fable-v2-partial` como fonte normativa.

## Modo de execução

- Trabalhe uma tarefa do task graph por vez, respeitando dependências.
- Atualize `PROGRESS.md` no início e no fim de cada tarefa.
- Escreva ou atualize testes no mesmo patch da implementação.
- Prefira mudanças pequenas, coerentes, reversíveis e observáveis.
- Registre decisões reversíveis em `docs/operations/DECISIONS_LOG.md`.
- Mudança constitucional exige ADR e não pode ser feita silenciosamente.
- Provider sem credencial deve ter fake determinístico e contrato idêntico ao adapter real.
- Faça commit convencional por tarefa quando Git e identidade estiverem disponíveis. Caso contrário, registre uma fronteira commit-ready em `PROGRESS.md` e continue.
- Não bloqueie por ausência de credencial em M0-M2. Use fakes e registre o item externo.

## Subagentes do projeto

Use subagentes somente para tarefas independentes e bounded. Aguarde todos antes de decidir.

- `architecture_reviewer`: boundaries e Constituição, read-only.
- `security_reviewer`: tenancy, RLS, tools, PII e abuso, read-only.
- `realtime_reviewer`: turnos, cancelamento, races e latência, read-only.
- `data_reviewer`: schemas, migrations, RLS e compatibilidade, read-only.
- `test_reviewer`: lacunas de teste e flakiness, read-only.
- `cost_reviewer`: custo, capacidade e denial of wallet, read-only.
- `docs_researcher`: confirmação de APIs atuais em fontes primárias, read-only e rede sujeita a approval.
- `implementation_worker`: um único write set por tarefa.

Nunca permita que dois agentes com escrita editem os mesmos arquivos simultaneamente.

## Skills do repositório

Os workflows reutilizáveis ficam em `.agents/skills/`:

- `architecture-change`
- `contract-first-feature`
- `realtime-quality`
- `security-review`

Use a skill aplicável sempre que a tarefa tocar seu domínio.

## Proibições

- Não colocar o Axtro Agent no loop síncrono áudio para áudio.
- Não executar tool diretamente a partir de texto do modelo.
- Não afirmar conclusão sem `tool_execution_receipt` de sucesso.
- Não permitir duas vozes como Presenter simultaneamente.
- Não esconder disclosure de IA.
- Não criar inferência biométrica ou emocional silenciosa.
- Não misturar tenants, nem em cache, logs, embeddings, storage ou testes.
- Não instalar dependência de produção sem registrar motivo, versão e alternativa.
- Não usar `danger-full-access`, bypass de approvals ou rede aberta como padrão.
- Não escolher provider definitivo antes do benchmark previsto.

## Comandos canônicos

Antes do bootstrap do código:

```bash
python3 scripts/validate_all.py
```

Depois do bootstrap, preserve o gate acima e adicione os comandos reais do repositório:

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
uv sync
uv run pytest
python3 scripts/validate_all.py
```

## Definition of Done resumida

- Critérios de aceite da tarefa atendidos.
- Testes positivos, negativos e de falha.
- Tipos gerados a partir dos contratos quando aplicável.
- Telemetria e correlation IDs presentes.
- Sem segredo ou PII em logs.
- Docs e ADR atualizados quando comportamento mudou.
- Nenhuma referência quebrada.
- RLS e teste cross-tenant para todo dado de tenant.
- Evidência registrada em `PROGRESS.md`.
