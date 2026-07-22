# Axtro Digital Human OS V2

**Plataforma multi-tenant para construir funcionários digitais de voz e vídeo com presença natural, ferramentas governadas, especialistas internos e supervisão autônoma do Axtro Agent.**

O primeiro produto é o **Sales Closer Role Pack**, mas o kernel não é acoplado a vendas. A mesma fundação poderá suportar SDR, onboarding, customer success, suporte, recepção e outros papéis empresariais.

## Estado real da entrega

**Duas camadas, ambas verdes.** O kernel M0-M3 (fundação genérica de
funcionários digitais — domínio, contratos, tenancy/RLS, Action Runtime,
Turn Coordinator, percepção, Role Pack de vendas) está completo e congelado
por release gates, 100% fake-first. Em cima dele, o **produto** (`apps/portal/`)
está NO AR em produção: auth real, RAG real, agentes de vídeo Tavus com o
Cérebro Método Silva e percepção emocional (ADR-035), ativação de agente,
modo apresentação com slides comandados pela própria agente, cost ledger,
rate limiting e telemetria.

O repositório já contém:

- fundação modular, gates locais e CI (kernel + build/typecheck do portal);
- 47 contratos com code generation determinístico;
- tenancy, RLS, autenticação real (Supabase) e audit trail;
- lifecycle, Session Actor, turnos textuais, contexto bounded, ações governadas, timeline, relay e workflow pós-call (fake no kernel; real no portal via OpenRouter/Tavus);
- portal Next.js completo: dashboard, agentes, conhecimento (RAG real), equipe, chat e vídeo com o Cérebro Método Silva;
- purpose limitation por `essential_processing` em todas as fronteiras de sessão;
- provider fakes para desenvolver o kernel sem credenciais, e `PORTAL_FAKE_PROVIDERS=1` para testar o portal inteiro sem chave nenhuma.

O kernel roda a demo completa com um único comando, somente com fakes locais:

```bash
pnpm m1:e2e   # ou pnpm m2:e2e
```

**Comece pelo estado atual, não por este resumo:** `docs/HANDOFF.md` (como
operar/desenvolver agora), `PROGRESS.md` (histórico completo por tarefa),
`docs/PROJECT_AUDIT.md` + `TASKS.md` (o que falta, priorizado).

## Auditoria final

Leia `FINAL_AUDIT_REPORT.md` para o veredito do kernel M0-M3 e
`artifacts/m1/README.md` para a pipeline, checklist, hashes, custo e limites do
release M1. Para o estado do produto, `docs/PROJECT_AUDIT.md` é o documento vivo.

## Comece por aqui

| Papel | Entrada obrigatória |
|---|---|
| Assumir o produto (dev/operação) | `docs/HANDOFF.md` → `docs/ARCHITECTURE.md` → `docs/TESTING.md` |
| Codex implementador (kernel) | `START_CODEX_TODAY.md` → `AGENTS.md` → `docs/playbooks/HANDOFF_TO_CODEX.md` → `backlog/MVP_TASK_GRAPH.yaml` |
| Codex auditor | `docs/playbooks/CODEX_AUDIT_PLAYBOOK.md` |
| Founder / produto | `docs/product/PRODUCT_VISION.md` → `docs/product/MVP_SCOPE.md` |
| Arquiteto | `ARCHITECTURE_CONSTITUTION.md` (+ ADRs em `docs/adr/`) → `docs/ARCHITECTURE.md` |
| Segurança | `docs/SECURITY.md` → `docs/security/THREAT_MODEL.md` |
| Deploy/DevOps | `docs/DEPLOYMENT.md` |
| Financeiro | `docs/operations/COST_AND_CAPACITY_MODEL.md` + `spreadsheets/UNIT_ECONOMICS_V2.xlsx` |
| Provider e pesquisa | `docs/operations/PROVIDER_CAPABILITY_VERIFICATION_2026-07-14.md` + `docs/sources/SOURCE_REGISTER.md` |
| Evidência de QA | `docs/TESTING.md` + `docs/operations/VALIDATION_EVIDENCE.md` |
| O que só você pode conectar | `docs/NEEDS_CONNECTION.md` |

## Arquitetura resumida

```text
Canais: Sala Axtro | Telefone | Meet | Zoom | Widget
                         |
                         v
              Meeting Edge / Channel Adapters
                         |
                         v
              Realtime Interaction Kernel
       Turn Coordinator | Session Actor | Context Composer
                         |
                         v
                  Cognitive Fabric
       Fast Lane | Deliberative Lane | Specialists | Policy
                         |
                         v
        Role State + Action Runtime + Handoff Protocol
                         |
              +----------+----------+
              |                     |
              v                     v
      Behavior Director      Scene Director
              |                     |
              +----------+----------+
                         |
                Voz + Avatar + UI

Axtro Agent Control Plane, workflows duráveis, memória e Learning Lab
ficam fora do caminho crítico de áudio para áudio.
```

## Princípios que não podem ser quebrados

1. O Axtro Agent nunca bloqueia a resposta ao cliente.
2. Apenas um Presenter possui a voz da sessão.
3. Estado estruturado e receipts são a fonte da verdade.
4. O LLM propõe. Policy, contratos e motores determinísticos decidem.
5. Percepção lê expressões, corpo e comportamento para entender o cliente com maestria — declarada no disclosure, com evidência e validade; nunca identificação biométrica oculta nem inferência de atributos protegidos (ADR-035).
6. O agente se identifica como virtual e não se apresenta como humano.
7. Toda ação externa passa por contrato, autorização, idempotência e auditoria.
8. Dados de tenant são isolados por RLS, identidades de serviço e testes negativos.
9. Provider crítico precisa de adapter, timeout, circuit breaker e fallback.
10. Aprendizado entra em produção somente após avaliação, promoção e rollback.

## Estrutura

```text
apps/portal/           produto em produção: Next.js + Supabase, cérebro, RAG, vídeo Tavus
apps/                  demais aplicações e workers do kernel M0-M3
packages/               domínio, contratos, segurança, providers e UI
contracts/             47 JSON Schemas + OpenAPI + AsyncAPI + exemplos
backlog/               task graph executável e workstreams do kernel
database/migrations/    schema portátil, RLS e matriz de tenancy
database/supabase-only/ SQL específico do projeto Supabase hospedado (auth.users)
docs/                   produto, arquitetura, segurança, operações, ADRs e playbooks
scripts/                gates reproduzíveis de arquitetura e segurança
knowledge-vault/        cofre local gitignored — manuais Método Silva (IP proprietária)
.codex/                 configuração e 8 subagentes especializados
.agents/skills/         4 workflows reutilizáveis para Codex
legacy/v1/              documentação original preservada, não normativa
legacy/fable-v2-partial/ retorno parcial preservado como evidência
```

## Comandos de validação documental

```bash
python3 scripts/validate_all.py

# Ou individualmente:
python3 scripts/docs_qa.py
python3 scripts/validate_contracts.py
python3 scripts/validate_specs.py
python3 scripts/validate_database_contract.py
python3 scripts/validate_codex_setup.py
python3 scripts/validate_migration_inventory.py
python3 scripts/secret_scan.py
```

`legacy/v1` é apenas histórico. Nenhuma decisão nova deve ser baseada nele quando houver conflito com a V2.

## Bootstrap local

```bash
UV_CACHE_DIR="$PWD/.uv-cache" uv sync --locked --all-groups
pnpm install --frozen-lockfile
pnpm lint
pnpm contracts:check
pnpm typecheck
pnpm test
UV_CACHE_DIR="$PWD/.uv-cache" uv run pytest
pnpm build
pnpm db:test
pnpm db:rls
pnpm m1:e2e
python3 scripts/validate_all.py
```


## Evidência da migração

A V1 inteira permanece em `legacy/v1/`, com 62 arquivos hash-verificados e mapeados individualmente em `MIGRATION_MAP_V1_TO_V2.md`. O retorno parcial do Fable 5 também foi preservado. Nenhum PDF do Método Silva foi tratado como confirmado porque esses arquivos não vieram nos ZIPs recebidos.

## Limite de prontidão

O kernel M0-M3 está congelado e auditado; o produto (`apps/portal/`) está em
produção real com clientes de demonstração, mas ainda não passou por
bake-off credenciado de provider, piloto interno real (M3-10) nem parecer
jurídico por jurisdição (obrigatório antes de mercados regulados, dada a
percepção emocional ativa — ADR-035). Ver `docs/NEEDS_CONNECTION.md` para a
lista exata do que falta e de quem depende.
