# Gates reproduzíveis da arquitetura

Rode a suíte completa a partir da raiz:

```bash
python3 scripts/validate_all.py
```

Checks individuais:

```bash
python3 scripts/docs_qa.py
python3 scripts/validate_contracts.py
python3 scripts/validate_specs.py
python3 scripts/validate_database_contract.py
python3 scripts/validate_codex_setup.py
python3 scripts/validate_migration_inventory.py
python3 scripts/secret_scan.py
```

Eles validam documentação, task graph, 41 schemas e exemplos, OpenAPI/AsyncAPI, invariantes do banco, configuração nativa do Codex, inventário da V1 e padrões comuns de segredo.

## Tipos gerados de contratos

Os tipos TypeScript e Python são derivados exclusivamente de `contracts/schemas/`:

```bash
pnpm contracts:generate
pnpm contracts:check
```

`contracts:check` também é executado pelo agregador e pela CI. Nunca edite os arquivos gerados manualmente.

O Codex deve preservar esses gates e ampliar a CI com lint, typecheck, unit, integration, E2E, migration apply/rollback, RLS negativo, replay, chaos e security tests conforme o código aparecer.

## Migrations locais

```bash
export AXTRO_LOCAL_DATABASE_URL='postgresql://postgres@127.0.0.1:54329/axtro_dhos_v2'
export AXTRO_ALLOW_LOCAL_DATABASE_URL=1
pnpm db:migrate
pnpm db:drift
pnpm db:test
```

Os comandos aceitam somente PostgreSQL local sem senha e exigem opt-in explícito quando uma URL local é fornecida. `db:test` usa um cluster PostgreSQL 17 com pgvector efêmero quando nenhuma URL local é fornecida.
