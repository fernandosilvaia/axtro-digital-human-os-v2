# Evidência de release M0: Foundation

**Estado:** verde para iniciar M1, Walking Skeleton

**Data da execução:** 2026-07-14

**Branch:** `codex/m0-m1-foundation`

**Último commit verde:** `47db095 chore(devex): add deterministic tenant-zero seed`

## Escopo comprovado

M0 estabelece o kernel modular e contract-first, contratos tipados gerados,
identidade e contexto de tenant estritos, reducers determinísticos, configuração
fail-closed, migrations locais, RLS, autenticação de desenvolvimento, telemetria
fechada, ports e fakes determinísticos, outbox transacional, Action Runtime
governado, baseline de segurança, ledger de custo e seed local tenant-zero.

O seed cria exatamente dois tenants de desenvolvimento isolados, cada um com a
composição Sales Closer necessária e somente providers fake. Ele exige opt-in
explícito, valida o drift antes de escrever e falha se sua composição canônica
for adulterada. Nenhuma credencial real, PII de cliente, conexão remota ou
provider externo é necessária para esta evidência.

## Pipeline executado

| Comando | Resultado |
|---|---|
| `CI=true pnpm install --frozen-lockfile` | passou, lockfile preservado |
| `UV_CACHE_DIR=/private/tmp/axtro-uv-cache uv sync --locked --all-groups` | passou, ambiente Python sincronizado sem alterar lock |
| `git diff --check` | passou, sem erro de whitespace |
| `pnpm lint` | passou, limites de workspace e whitespace limpos |
| `pnpm contracts:check` | passou, 36 schemas gerados sem drift |
| `pnpm typecheck` | passou |
| `pnpm test` | passou, 92 testes Node e 18 Python unittest |
| `pnpm build` | passou |
| `pnpm db:test` | passou, PostgreSQL local temporário, migration limpa e upgrade, custo, seed e drift |
| `pnpm db:rls` | passou, PostgreSQL local temporário, matriz RLS e isolamento tenant |
| `UV_CACHE_DIR=/private/tmp/axtro-uv-cache uv run pytest` | passou, 18 testes |
| `python3 scripts/validate_all.py` | passou, 9 validadores |

## Garantias verificadas

- O contexto do tenant é aplicado por transação e a ausência de contexto falha fechada.
- O banco bloqueia leituras e relacionamentos cross-tenant, mutações append-only indevidas e UUIDs não v7 nas fronteiras exigidas.
- O Action Runtime aceita somente `ActionIntent` tipado, passa por decisão de policy e produz `ToolExecutionReceipt`; texto de modelo nunca alcança adapter diretamente.
- Os providers de M0 são fakes locais, determinísticos e sem SDK, rede ou credencial de provider.
- O outbox preserva mudança de aggregate e envelope em uma única transação, com retry e deduplicação explícitos.
- Custos são registrados com precisão decimal determinística, atribuição tenant-safe e reconciliação protegida no banco.
- Logs e traces usam superfícies fechadas, correlação confiável e redaction de campos sensíveis.
- O seed local é idempotente, sem PII, e sua role de runtime não pode executá-lo.

## Limitações conhecidas

- Esta evidência é local e usa PostgreSQL temporário. Não executa migrations em banco remoto nem produz deploy.
- Não houve benchmark nem seleção de provider real. Integrações externas permanecem desabilitadas e fake-only.
- O rate limiter é local por processo. A coordenação distribuída pertence a marcos posteriores.
- A validação de dependências é um snapshot do lockfile. Renovação de advisories requer execução operacional com proveniência antes de release externo.
- M1 ainda precisa implementar o Walking Skeleton: lifecycle de sessão, actor, turnos, timeline, workflow, console e E2E.

## Decisão de prontidão

M0 está apto para iniciar M1 porque os contratos, fronteiras de segurança,
persistência local, determinismo e mecanismos de evidência foram exercitados.
Esta conclusão não autoriza uso de produção, providers reais, credenciais reais,
deploy ou início de M2 e M3.
