# Evidência de release M1: Walking Skeleton

**Estado:** verde para encerrar M1 e preservar a baseline antes de áudio

**Data da execução:** 2026-07-15

**Branch:** `codex/m0-m1-foundation`

**Commit-base da implementação E2E:** `436466b test(e2e): automate M1 walking skeleton`

## Escopo comprovado

O cenário determinístico compõe lifecycle, Session Actor, Context Composer,
Turn Driver textual, Action Runtime governado, Cost Ledger, outbox relay,
timeline autoritativa, replay verifier, workflow pós-call e console operacional.
Ele usa somente providers fake locais, dados sintéticos e clocks e IDs fixos.

A timeline contém 12 eventos canônicos. Três turnos do participante alternam com
três turnos de um único Presenter. A ação de catálogo passa por
`ActionIntent`, `PolicyDecision` e `ToolExecutionReceipt`, não publica fala
automaticamente e executa a fixture nominal uma vez. O workflow termina quatro
checkpoints sem efeito externo.

## Pipeline executado

| Comando | Resultado |
|---|---|
| `pnpm install --frozen-lockfile` | passou, 28 workspaces e lockfile preservado |
| `UV_CACHE_DIR=/private/tmp/axtro-uv-cache uv sync --locked --all-groups` | passou, 19 pacotes resolvidos e 12 verificados |
| `pnpm lint` | passou, boundaries e whitespace limpos |
| `pnpm contracts:check` | passou, 47 schemas sem drift |
| `pnpm typecheck` | passou |
| `pnpm test` | passou, 209 testes Node e 23 unittest Python |
| `UV_CACHE_DIR=/private/tmp/axtro-uv-cache uv run pytest` | passou, 23 testes |
| `pnpm build` | passou |
| `pnpm db:test` | passou, PostgreSQL temporário local, apply limpo, upgrade, seed, integridade, custo, drift e UUIDv7 |
| `pnpm db:rls` | passou, PostgreSQL temporário local, matriz RLS, contexto ausente, reset de pool, FKs, append-only e namespaces |
| `pnpm m1:e2e` | passou, 2 testes e duas execuções idênticas do cenário |
| `python3 scripts/validate_all.py` | passou, 9 validadores, 47 schemas, 42 tabelas e 11 migrations |
| `git diff --check` | passou |

## Artefatos congelados

- `timeline.json`: metadata ordenada de 12 eventos, sem payload restrito;
- `evidence.json`: hashes, contagens, custo, salvaguardas e matriz de falhas;
- `manifest.json`: vínculo SHA-256 canônico entre timeline e evidência.

O replay hash é
`5b61e69e9c9b9d8af7a15ef5e2358be06544b7b7cfa46b3d4335b1d9f9e425b5`.
O manifest fixa a timeline em
`beffbdd11a04b74889afe2159fcce4bab53b1eef8d9ef7f0cc107a92be4cffee`
e a evidência em
`1eca0ecb0689994ac2202636b108f066e04695622983c06e94f51ab203521274`.

## Baseline de custo por sessão fake

O baseline nominal inclui exatamente uma consulta de catálogo instrumentada:

| Fonte | Serviço | Unidade | Quantidade | Valor USD |
|---|---|---|---:|---:|
| estimated | catalog | request | 1 | 0.02 |

O total estimado da sessão fake nominal é **USD 0.02**. Lifecycle, turnos,
replay, workflow e console são fakes locais com atribuição externa zero. As duas
invocações da injeção `unknown_tool_effect` pertencem à matriz negativa e ficam
explicitamente fora do baseline nominal. Não há custo medido ou reportado por
provider. Este valor prova a instrumentação, não estima produção.

## Release checklist

| Item comum | Disposição M1 |
|---|---|
| task graph do marco | M1-01 a M1-11 concluídas em ordem de dependência |
| contratos e specs | 47 schemas, OpenAPI e AsyncAPI verdes |
| lint, tipos, unit, integração e E2E | verdes na pipeline acima |
| RLS negativo | matriz PostgreSQL local verde |
| secrets e dependências | scans do validador sem High ou Critical |
| migrations limpa e upgrade | `pnpm db:test` verde |
| dashboards e alerts definidos | superfícies em `docs/operations/OBSERVABILITY.md`; console M1 local; alertas bloqueantes definidos sem transporte de produção |
| cost report | USD 0.02 nominal, escopo e exclusões explícitos acima |
| demonstração de degradação | cross-tenant, retry pós-efeito e unknown effect verdes em `evidence.json` |
| auditoria | revisões independentes sem P0, Critical ou High aberto |

## Segurança e tenancy

Os guards de lifecycle, timeline, Session Actor, outbox, custo e projeção de
ações exigem scope de sessão mais `essential_processing`. Grants destinados
somente a autenticação de provider ou ferramenta falham antes de leitura,
alocação ou mutação. A matriz E2E prova 404 cross-tenant indistinguível, zero
leituras secundárias, relay beta ocioso, timeline beta vazia e workflow oculto.

A One Mouth Rule é derivada dos seis payloads reais antes da sanitização e exige
um Presenter único igual ao floor ativo. Os artefatos versionados retêm somente
metadata allowlisted e o scan rejeita conteúdo sensível ou material operacional.

## Limitações conhecidas

- Repositories, mailbox, relay, workflow e projeções continuam process-local.
- O console é SSR interno e não possui servidor HTTP ou browser auth.
- M0 inclui contratos, ports e fakes locais de mídia, avatar e meeting, mas o
  Walking Skeleton M1 não integra nem executa canal realtime ou provider real.
- A validação usa PostgreSQL temporário local e não acessa banco remoto.
- Alertas são condições bloqueantes locais; não existe transporte operacional.
- Não houve deploy, certificação de segurança de produção ou aprovação jurídica.

## Decisão de prontidão

M0 Foundation e M1 Walking Skeleton estão aptos para servir de baseline do
Human Presence Spike. Esta decisão não inicia M2, não escolhe provider e não
autoriza produção, credenciais reais, migration remota ou deploy.
