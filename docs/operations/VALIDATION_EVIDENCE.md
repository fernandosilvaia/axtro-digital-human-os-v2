# Evidência de validação M0 e M1

**Executado em:** 2026-07-15

**Estado:** M0 Foundation e M1 Walking Skeleton verdes; M2 e M3 não iniciados

## Pipeline canônica

A evidência completa e seus limites estão em `artifacts/m0/README.md` e
`artifacts/m1/README.md`. O gate M1 executou:

```bash
pnpm install --frozen-lockfile
UV_CACHE_DIR=/private/tmp/axtro-uv-cache uv sync --locked --all-groups
pnpm lint
pnpm contracts:check
pnpm typecheck
pnpm test
UV_CACHE_DIR=/private/tmp/axtro-uv-cache uv run pytest
pnpm build
pnpm db:test
pnpm db:rls
pnpm m1:e2e
python3 scripts/validate_all.py
git diff --check
```

Resultados:

- 28 workspaces não foram alterados pelo install congelado;
- 48 schemas e tipos gerados sem drift;
- 209 testes Node e 23 unittest Python verdes;
- 23 testes pytest verdes;
- PostgreSQL temporário local verde para apply limpo, upgrade, seed, drift,
  reconciliação de custo, integridade de workflow e UUIDv7;
- matriz RLS local verde para isolamento tenant, contexto ausente, reset de pool,
  FKs, append-only e namespaces;
- 2 testes E2E verdes com duas execuções determinísticas por cenário;
- lint, typecheck, build e whitespace verdes.

## Validadores do repositório

```text
DOCUMENTATION QA PASSED: 28 required files, 52 executable tasks
CONTRACT VALIDATION PASSED: 48 schemas, 48 valid examples, 48 invalid examples
CONTRACT TYPE CHECK PASSED: 48 schemas, generator 1.0.0
CONTRACT GENERATION VALIDATION PASSED
SPEC VALIDATION PASSED: 11 OpenAPI paths, 5 AsyncAPI operations
DATABASE CONTRACT VALIDATION PASSED: 42 tables, 11 migrations
CODEX SETUP VALIDATION PASSED: 8 custom agents, 4 repository skills
MIGRATION INVENTORY VALIDATION PASSED: 62 V1 files mapped and hash-verified
DEPENDENCY SCAN PASSED: no high or critical findings in committed locks
SECRET SCAN PASSED
VALIDATION SUITE PASSED: 9 checks
```

## Evidência M1

O comando `pnpm m1:e2e` prova lifecycle, seis turnos alternados, One Mouth,
ação governada, outbox com retry, timeline, snapshot mais tail, replay, workflow,
custo e console. Os artefatos congelados registram 12 eventos, replay hash,
matriz cross-tenant, unknown effect e custo nominal de USD 0.02.

Revisões independentes de arquitetura, segurança e release não deixaram P0,
Critical ou High aberto. O hardening final passou a exigir
`essential_processing` em toda leitura ou escrita de sessão nos guards de
lifecycle, timeline, Session Actor, outbox, custo e projeção operacional.

## Workbook histórico

A verificação documental inicial de 2026-07-14 confirmou 14 abas e ausência de
erros de fórmula conhecidos em `spreadsheets/UNIT_ECONOMICS_V2.xlsx`. Os preços
e premissas permanecem inputs datados. O gate M1 não atualizou preços de
provider e o valor fake de USD 0.02 não substitui a planilha nem representa
produção.

## Limites desta evidência

Esta validação prova a baseline local de M0 e M1. Ela não prova:

- segurança certificada ou identidade de produção;
- qualidade, latência, disponibilidade ou preço de provider real;
- execução integrada de canal de áudio, avatar, meeting bot ou telephony;
- durabilidade multiprocesso dos stores e workers locais;
- aprovação jurídica ou regulatória;
- migration em banco remoto, deploy ou prontidão para cliente externo.

Esses itens pertencem a M2, M3 e às pendências externas. Nenhuma credencial real,
rede de provider, produção, banco remoto ou deploy foi usado neste gate.
