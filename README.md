# Axtro Digital Human OS V2

**Plataforma multi-tenant para construir funcionários digitais de voz e vídeo com presença natural, ferramentas governadas, especialistas internos e supervisão autônoma do Axtro Agent.**

O primeiro produto é o **Sales Closer Role Pack**, mas o kernel não é acoplado a vendas. A mesma fundação poderá suportar SDR, onboarding, customer success, suporte, recepção e outros papéis empresariais.

## Estado real da entrega

**Pronto para implementação dos marcos M0, M1 e M2 pelo Codex.**

Isso significa que a equipe pode iniciar hoje:

- fundação do monorepo e CI;
- contratos e code generation;
- tenancy, RLS e audit trail;
- Walking Skeleton de uma sessão;
- Human Presence Spike com voz, interrupção, avatar substituível e cena controlada;
- provider fakes para desenvolver sem credenciais.

A produção com providers reais continua condicionada a credenciais, termos comerciais, bake-off de qualidade e validações regulatórias listadas em `PENDENCIAS_EXTERNAS.md`.

## Auditoria final

Leia `FINAL_AUDIT_REPORT.md` para o veredito, as provas reproduzíveis, os limites e a ordem de execução.

## Comece por aqui

| Papel | Entrada obrigatória |
|---|---|
| Codex implementador | `START_CODEX_TODAY.md` → `AGENTS.md` → `docs/playbooks/HANDOFF_TO_CODEX.md` → `backlog/MVP_TASK_GRAPH.yaml` |
| Codex auditor | `docs/playbooks/CODEX_AUDIT_PLAYBOOK.md` |
| Founder / produto | `docs/product/PRODUCT_VISION.md` → `docs/product/MVP_SCOPE.md` |
| Arquiteto | `ARCHITECTURE_CONSTITUTION.md` → `docs/architecture/SYSTEM_ARCHITECTURE.md` |
| Segurança | `docs/security/SECURITY_ARCHITECTURE.md` → `docs/security/THREAT_MODEL.md` |
| Financeiro | `docs/operations/COST_AND_CAPACITY_MODEL.md` + `spreadsheets/UNIT_ECONOMICS_V2.xlsx` |
| Provider e pesquisa | `docs/operations/PROVIDER_CAPABILITY_VERIFICATION_2026-07-14.md` + `docs/sources/SOURCE_REGISTER.md` |
| Evidência de QA | `docs/operations/VALIDATION_EVIDENCE.md` |

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
5. Percepção gera hipóteses com evidência e expiração, nunca leitura da mente.
6. O agente se identifica como virtual e não se apresenta como humano.
7. Toda ação externa passa por contrato, autorização, idempotência e auditoria.
8. Dados de tenant são isolados por RLS, identidades de serviço e testes negativos.
9. Provider crítico precisa de adapter, timeout, circuit breaker e fallback.
10. Aprendizado entra em produção somente após avaliação, promoção e rollback.

## Estrutura

```text
apps/                 aplicações e workers a implementar
packages/             domínio, contratos, segurança, providers e UI
contracts/            31 JSON Schemas + OpenAPI + AsyncAPI + exemplos
backlog/              task graph executável e workstreams
database/             schema de referência, migrations e matriz RLS
docs/                 produto, arquitetura, segurança, operações e playbooks
scripts/              gates reproduzíveis de arquitetura e segurança
.codex/               configuração e 8 subagentes especializados
.agents/skills/        4 workflows reutilizáveis para Codex
legacy/v1/            documentação original preservada, não normativa
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


## Evidência da migração

A V1 inteira permanece em `legacy/v1/`, com 62 arquivos hash-verificados e mapeados individualmente em `MIGRATION_MAP_V1_TO_V2.md`. O retorno parcial do Fable 5 também foi preservado. Nenhum PDF do Método Silva foi tratado como confirmado porque esses arquivos não vieram nos ZIPs recebidos.

## Limite de prontidão

Este pacote libera implementação M0-M2 com fakes e adapters. Não libera lançamento em produção, não comprova o bake-off dos providers, não certifica segurança e não aprova juridicamente usos regulados.
