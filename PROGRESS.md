# Progresso de implementação

**Estado atual:** M0 Foundation e M1 Walking Skeleton concluídos; M2 Human Presence Spike em execução autônoma controlada

**Marco atual:** M2
**Tarefa atual:** M2-01
**Última evidência verde:** M1-11 com pipeline completa, 209 testes Node, 23 unittest Python, 23 pytest, 2 testes E2E, PostgreSQL local, RLS e 9 validadores verdes em 2026-07-15
**Bloqueadores internos:** nenhum
**Pendências externas:** consultar `PENDENCIAS_EXTERNAS.md`  

## Regras de atualização

- Atualize a tarefa para `in_progress` antes de editar.
- Registre comandos, testes, arquivos e decisões ao concluí-la.
- Use somente `done` quando todos os critérios de aceite e testes do task graph passarem.
- Use `blocked` somente para dependência realmente irreversível; M0-M2 devem usar fakes quando faltarem credenciais.

## Task ledger

| ID | Marco | Status | Título | Dependências | Evidência |
|---|---|---|---|---|---|
| `M0-01` | M0 | done | Bootstrap modular monorepo | nenhuma | `pnpm install`, `uv sync`, lint, typecheck, test, build e 7 validadores verdes |
| `M0-02` | M0 | done | Install repository and documentation gates | `M0-01` | CI de runtime, fixtures negativos, rastreabilidade e 7 validadores verdes |
| `M0-03` | M0 | done | Generate TypeScript and Python contract types | `M0-01`, `M0-02` | 31 schemas gerados em TS/Python, metadata e check de drift verdes |
| `M0-04` | M0 | done | Implement domain identifiers and value objects | `M0-03` | UUIDv7 determinístico, fronteiras estritas, contextos imutáveis e serialização verificados |
| `M0-05` | M0 | done | Implement interaction state and pure reducers | `M0-04` | reducers puros, versionamento estrito, hash canônico, replay e extensão de vendas opcional verificados |
| `M0-06` | M0 | done | Implement typed configuration and secret handles | `M0-01` | config schema tipado, startup fail-closed, handles opacos, broker fake scoped e redaction verificados |
| `M0-07` | M0 | done | Install database migration runner | `M0-01`, `M0-04` | runner local numerado, receipts SHA-256, drift estrutural e integração PostgreSQL 17 com pgvector verdes |
| `M0-08` | M0 | done | Implement RLS and cross-tenant negative test suite | `M0-07` | role local sem superusuário prova RLS em 35 tabelas, contexto ausente, reset transacional, FKs tenant e sessão, append-only e namespaces de cache e objetos |
| `M0-09` | M0 | done | Implement authentication and tenant context middleware | `M0-06`, `M0-08` | registry fake somente development/test, grants mínimos server-side, seletor service-only, contexto `set_config(..., true)` e matriz de abuso validados |
| `M0-10` | M0 | done | Add OpenTelemetry and structured logging | `M0-01`, `M0-06` | raiz pública nova, carrier W3C interno, logs fechados e propagação API, worker Python e provider fake verificados |
| `M0-11` | M0 | done | Implement provider ports and capability registry | `M0-03`, `M0-04` | 9 ports fake-only, registry de capability, timeout/cancelamento, health, storage scoped e testes de swap verdes |
| `M0-12` | M0 | done | Implement deterministic provider fakes | `M0-11` | 9 fakes locais determinísticos, 3 contratos gerados, clock manual, timeout, cancelamento, falha, journal fechado e 63 testes Node mais 14 Python verdes |
| `M0-13` | M0 | done | Implement transactional outbox repository | `M0-05`, `M0-07`, `M0-10` | aggregate e envelope canônico atômicos, rollback, retry idempotente, ordering por aggregate, RLS e migration 0008 validados |
| `M0-14` | M0 | done | Implement Action Runtime skeleton | `M0-03`, `M0-08`, `M0-12` | ActionIntent estrito, policy tenant-safe, fake read-only privado, receipt, idempotência e unknown barrier validados |
| `M0-15` | M0 | done | Add application security baseline | `M0-02`, `M0-06`, `M0-09` | ingress framework-neutral bounded, quota tenant-safe, deadline cancelável, egress capability-scoped e dependency gate validados |
| `M0-16` | M0 | done | Implement cost event ledger | `M0-03`, `M0-07`, `M0-11` | custo decimal determinístico, reconciliação SQL, replay guard, RLS e migração histórica validados |
| `M0-17` | M0 | done | Create development fixtures and tenant-zero seed | `M0-08`, `M0-12`, `M0-14` | seed local idempotente de alpha/beta, composição canônica fail-closed, fakes e isolamento RLS validados |
| `M0-18` | M0 | done | M0 release gate | `M0-02`, `M0-03`, `M0-05`, `M0-08`, `M0-09`, `M0-10`, `M0-12`, `M0-13`, `M0-14`, `M0-15`, `M0-16`, `M0-17` | bundle de evidências, pipeline limpo, limitações e commit verde registrados |
| `M1-01` | M1 | done | Implement session lifecycle API | `M0-18` | cinco operações OpenAPI, lote lifecycle atômico, CAS, idempotência bounded, disclosure com receipt fake, controles de deadline e isolamento tenant validados |
| `M1-02` | M1 | done | Implement Session Actor and mailbox | `M1-01` | actor único por tenant e sessão, mailbox bounded, dedupe canônico, replay snapshot e timeline, cancelamento e deadlines de source validados |
| `M1-03` | M1 | done | Implement textual turn driver | `M1-02`, `M0-12` | turnos canônicos participant e Presenter, Fast Lane fake, One Mouth, interrupção, cancelamento, isolamento e API validados |
| `M1-04` | M1 | done | Implement context composer | `M1-03` | 39º contrato gerado, snapshot opaco, budget UTF-8, provenance, TTL, freshness no Turn Driver e suíte de injeção validados |
| `M1-05` | M1 | done | Complete fake Action Runtime flow | `M1-03`, `M0-14` | comando fechado, ActionIntent e policy derivados server-side, receipt-backed candidate, timeout fake por tenant, reconciliação exata, ledgers bounded e 154 testes Node mais 23 Python verdes |
| `M1-06` | M1 | done | Implement timeline, snapshots and replay verifier | `M1-02`, `M0-13` | timeline append-only tenant-scoped, snapshot derivado do replay, equivalência zero versus snapshot mais tail, migration 0010, rollback, drift, RLS e 166 testes Node mais 23 Python verdes |
| `M1-07` | M1 | done | Implement outbox relay and idempotent consumers | `M0-13`, `M1-06` | state machine bounded, token histórico, lease exclusivo, budget pinado, timeline idempotente, DLQ PII-free, telemetria tenant-safe e 180 testes Node mais 23 Python verdes |
| `M1-08` | M1 | done | Implement fake post-call workflow | `M1-07` | consumer composto, quatro checkpoints, resumo e avaliação fake, follow-up noop idempotente, resume, retry, cancelamento, migration 0011, RLS e 191 testes Node mais 23 Python verdes |
| `M1-09` | M1 | done | Build minimal operations console | `M1-01`, `M1-06` | lifecycle-first, replay canônico, receipts governados, custos exatos, 404 cross-tenant sem leituras secundárias, CSP hash-pinned, accessibility smoke e 206 testes Node mais 23 Python verdes |
| `M1-10` | M1 | done | Walking Skeleton E2E and failure suite | `M1-04`, `M1-05`, `M1-06`, `M1-07`, `M1-08`, `M1-09` | `pnpm m1:e2e` executa lifecycle, turnos, ação governada, relay, replay, workflow e console; goldens incluem 12 eventos, replay hash e matriz de falhas verde |
| `M1-11` | M1 | done | M1 release gate | `M1-10` | pipeline completa verde, revisões sem P0, P1 ou P2, custo fake nominal USD 0.02 e baseline M1 congelados |
| `M2-01` | M2 | done | Implement channel adapter and native-room transport boundary | `M1-11`, `M0-11` | `RoomTransport` local determinístico sobre `ChannelPort`, `apps/meeting-room` compõe fakes, 6 testes Node verdes |
| `M2-02` | M2 | pending | Build Turn Coordinator harness | `M2-01` | pending |
| `M2-03` | M2 | pending | Implement modular STT, LLM and TTS path | `M2-02`, `M0-12` | pending |
| `M2-04` | M2 | pending | Implement speech-to-speech experiment adapter | `M2-02`, `M0-11` | pending |
| `M2-05` | M2 | pending | Implement Behavior and Presence Director | `M2-02`, `M0-03` | pending |
| `M2-06` | M2 | pending | Implement avatar port, fake and cancellation semantics | `M2-01`, `M2-05`, `M0-12` | pending |
| `M2-07` | M2 | pending | Implement Scene and Presentation Director | `M2-01`, `M0-03` | pending |
| `M2-08` | M2 | pending | Implement silent Specialist Fabric | `M1-04`, `M0-12` | pending |
| `M2-09` | M2 | pending | Implement perception signal bus and quality state | `M2-02`, `M0-03` | pending |
| `M2-10` | M2 | pending | Implement degradation and recovery controller | `M2-03`, `M2-04`, `M2-06`, `M2-07` | pending |
| `M2-11` | M2 | pending | Instrument realtime latency, quality and cost | `M2-03`, `M2-06`, `M2-07`, `M0-16` | pending |
| `M2-12` | M2 | pending | Run mandatory ten-minute Human Presence scenario | `M2-05`, `M2-08`, `M2-09`, `M2-10`, `M2-11` | pending |
| `M2-13` | M2 | pending | M2 architecture and provider decision gate | `M2-12` | pending |
| `M3-01` | M3 | pending | Implement Sales Closer Role Pack | `M2-13` | pending |
| `M3-02` | M3 | pending | Implement authorized knowledge ingestion and RAG | `M3-01`, `M0-08` | pending |
| `M3-03` | M3 | pending | Add CRM-lite read adapter | `M3-01`, `M0-14` | pending |
| `M3-04` | M3 | pending | Add calendar proposal in dry-run | `M3-01`, `M0-14` | pending |
| `M3-05` | M3 | pending | Add proposal generation in dry-run | `M3-01`, `M0-14` | pending |
| `M3-06` | M3 | pending | Implement warm human handoff | `M3-01`, `M2-10` | pending |
| `M3-07` | M3 | pending | Implement sandbox follow-up workflow | `M1-08`, `M3-01` | pending |
| `M3-08` | M3 | pending | Implement evaluation harness and golden conversations | `M3-01`, `M3-02`, `M3-06` | pending |
| `M3-09` | M3 | pending | Expand console for opportunity and call review | `M3-02`, `M3-03`, `M3-05`, `M3-08` | pending |
| `M3-10` | M3 | pending | Internal Sales Closer Alpha pilot gate | `M3-04`, `M3-05`, `M3-06`, `M3-07`, `M3-08`, `M3-09` | pending |

## Log de execução

### 2026-07-14, M0-01 iniciado

- Leitura obrigatória concluída: Constituição, instruções do repositório, README, playbooks, Definition of Done, task graph, progresso, ADRs relevantes e instruções locais.
- Validação inicial executada: `python3 scripts/validate_all.py`.
- Resultado inicial: documentação, contratos, especificações, contrato de banco, inventário de migrations e secret scan verdes. `validate_codex_setup.py` falhou porque o interpretador local é Python 3.9.6 e não expõe `tomllib`; a correção preservará a validação do TOML e será coberta por teste.
- Git foi inicializado na branch dedicada `codex/m0-m1-foundation`; nenhuma branch principal foi criada ou alterada.

### 2026-07-14, M0-01 concluído e M0-02 iniciado

- Criados workspaces pnpm e uv, package boundaries iniciais para domínio, contratos, configuração, segurança, banco, eventos, observabilidade, providers, policy, tools e custos, mais o esqueleto do Control Plane API e do worker realtime.
- Adicionados scripts canônicos `lint`, `typecheck`, `test` e `build`, checks de boundary sem SDK de provider no domínio, e testes Python para o parser TOML de compatibilidade.
- `validate_codex_setup.py` agora preserva a validação de TOML em Python 3.9-3.10 sem dependência externa e usa `tomllib` nativo em Python 3.11+.
- Dependências somente de desenvolvimento registradas: `typescript@5.9.3` e `@types/node@24.10.1`; sem SDK de provider nem dependência de produção.
- Evidências verdes: `env UV_CACHE_DIR=.uv-cache uv sync`, `pnpm install`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` e `python3 scripts/validate_all.py`.
- Próxima tarefa marcada antes de qualquer alteração: M0-02, CI de runtime, meta-gates negativos e rastreabilidade P0.

### 2026-07-14, M0-02 concluído e M0-03 iniciado

- A CI agora instala pnpm, Node 24, Python 3.12 e uv, executa `pnpm install --frozen-lockfile`, `uv sync --locked --all-groups`, lint, typecheck, testes, pytest e o agregador de validadores.
- Incluídos fixtures efêmeros que provam falha para schema quebrado, link Markdown quebrado e segredo detectável, sem gravar segredo em arquivo versionado.
- `docs_qa.py` passou a validar cada referência de tarefa da matriz P0 contra o task graph. A matriz foi alinhada aos IDs reais, inclusive disclosure/consentimento em M1-01, RLS em M0-08, Action Runtime em M0-14/M1-05 e Axtro Bridge em M1-03.
- O workspace Python foi fixado em Python 3.10+ porque `jsonschema@4.26.0` exige essa versão; `python3 scripts/validate_all.py` continua verde com o Python 3.9 local pela compatibilidade TOML de M0-01.
- Evidências verdes: `pnpm install --frozen-lockfile`, `env UV_CACHE_DIR=.uv-cache uv sync --all-groups`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `env UV_CACHE_DIR=.uv-cache uv run pytest`, `pnpm build` e `python3 scripts/validate_all.py`.
- Próxima tarefa marcada antes de qualquer alteração: M0-03, geração determinística de tipos de contrato e detecção de drift.

### 2026-07-14, M0-03 concluído e M0-04 iniciado

- Criado `scripts/generate_contract_types.py`, gerador determinístico sem dependência externa para os 31 schemas Draft 2020-12.
- Artefatos gerados: `packages/contracts-ts/src/generated.ts`, export TypeScript e `packages/contracts-py/src/axtro_contracts/__init__.py`. Cada contrato declara schema de origem, `$id`, `schema_version` e SHA-256 de origem.
- Adicionado gate `validate_contract_generation.py` ao agregador. A CI e `pnpm contracts:check` falham quando os arquivos gerados não correspondem aos schemas.
- Testes cobrem geração repetível em diretório temporário, sincronismo do artefato versionado e rejeição dos 31 exemplos inválidos.
- Evidências verdes: `pnpm contracts:generate`, `pnpm contracts:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test` (9 testes Python), `env UV_CACHE_DIR=.uv-cache uv run pytest` (9 testes), `pnpm build` e `python3 scripts/validate_all.py` (8 checks).
- Próxima tarefa marcada antes de qualquer alteração: M0-04, value objects, UUIDv7, tenant context, trace context e classification primitives.

### 2026-07-14, M0-04 concluído e M0-05 iniciado

- Implementados UUIDv7 lower-case com variante RFC, construtores determinístico e criptograficamente aleatório, parsers de fronteira e tipos distintos para tenant, sessão, ator e correlação.
- Implementados `TenantContext` e `TraceContext` explícitos, imutáveis e serializáveis, com validação de actor type, escopos, finalidades, trace ID e correspondência de tenant.
- Adicionados `schema_version` e `data_classification` como primitives estritas derivadas dos contratos gerados. O domínio continua sem import de banco, framework ou SDK de provider.
- A revisão de segurança identificou duas entradas permissivas no primeiro patch. Os parsers agora recusam objetos com `toString` e `actorType` é validado em runtime antes do narrowing de TypeScript.
- Testes cobrem UUIDv7 determinístico, propriedades de timestamp, versão e variante, rejeição de UUIDv4 e objetos coercíveis, round trip de serialização e valores de contexto e classificação inválidos.
- Evidências verdes: `env CI=true pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `env UV_CACHE_DIR=.uv-cache uv run pytest`, `pnpm build` e `python3 scripts/validate_all.py`.
- Próxima tarefa marcada antes de qualquer alteração: M0-05, estados de interação, reducers puros, hash e replay determinístico.

### 2026-07-14, M0-05 concluído e M0-06 iniciado

- Implementado aggregate de interação com `InteractionSessionState`, `ConversationState`, `RoleState`, qualidade multidimensional e extensão `SalesState` ausente por padrão. O domínio não importa `@axtro/events`, providers, banco, framework ou daemon.
- Adicionados eventos internos discriminados e parser runtime estrito. O pacote de eventos somente codifica e decodifica o `EventEnvelope` gerado, usando payload JSON canônico.
- Reducers rejeitam schema, event type, payload, aggregate type, tenant, sessão e versão inválidos. O primeiro evento exige versão 1 e os seguintes exigem incremento exato.
- Hash SHA-256 usa serialização canônica com chaves ordenadas e arrays preservados. Snapshots e eventos de entrada permanecem imutáveis; replay repetido e após round trip JSON produz o mesmo hash.
- Ativação exige `consent.recorded` permitido, `disclosure.delivered` ou acknowledgment e presenter não nulo. `session.created` inicia ambos os estados em `pending`; troca de presenter exige o proprietário anterior esperado.
- A revisão de segurança também levou à revalidação estrutural de snapshot reidratado antes de cada transição. `derived_hypothesis` é proibida como fato confirmado. A lineage persistida de `evidence_id` ainda depende da futura timeline ou repositório de evidências e está registrada como R17.
- Evidências verdes: `env CI=true pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test` (16 testes Node e 9 Python), `env UV_CACHE_DIR=.uv-cache uv run pytest` (9 testes) e `python3 scripts/validate_all.py` (8 checks).
- Próxima tarefa marcada antes de qualquer alteração: M0-06, configuração tipada, secret handles, redaction e matriz fail-closed.

### 2026-07-14, M0-06 concluído e M0-07 iniciado

- Adicionado contrato `runtime_configuration` com 32 schemas e exemplos válidos e inválidos, tipos TypeScript e Python regenerados, e `SecretHandle` alinhado também no OpenAPI de provider connection.
- `loadRuntimeConfig` é puro, imutável e fail-closed. Exige ambiente, serviço, modo `fake` e broker handle, recusa valores de configuração malformados, provider real, aliases de credencial conhecidos e startup antes da validação. `.env.example` contém somente referências sintéticas.
- Implementados handles opacos, redaction estruturada sem executar getters ou serializadores hostis, erros públicos seguros e fake broker determinístico. O broker é construído com o contexto do servidor, vincula tenant e provider, exige scope específico por purpose e nunca materializa credencial, usa rede ou expõe handle no lease ID.
- A metadata de modelo não recebe handle. Somente a configuração do adapter confiável contém a referência opaca. A autenticação que cria `TenantContext` a partir de claims verificadas permanece obrigatória para M0-09.
- Testes novos cobrem matriz de configuração, aliases de segredo, inputs hostis, redaction de objetos, erros e ciclos, isolamento de tenant, provider, purpose e scope, ausência de rede e contrato de handles. Revisão de segurança independente concluída sem achados remanescentes.
- Evidências verdes: `env CI=true pnpm install --frozen-lockfile`, `pnpm contracts:check`, `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test` (25 testes Node e 10 Python unittest), `env UV_CACHE_DIR=.uv-cache uv run pytest` (10 testes) e `python3 scripts/validate_all.py` (8 checks).
- Próxima tarefa marcada antes de qualquer alteração: M0-07, runner de migrations numeradas contra PostgreSQL local com pgvector, sem conexão remota.

### 2026-07-14, M0-07 concluído

- Implementado `@axtro/database` com descoberta contígua das seis migrations normativas, checksums SHA-256, receipts ordenados em `public.axtro_schema_migrations`, sentinelas contra migration aplicada sem receipt e boundary explícito de UUIDv7 da aplicação.
- `db:migrate`, `db:drift` e `db:test` usam somente URLs loopback sem senha, usuário e banco explícitos. A URL fornecida pelo operador exige `AXTRO_ALLOW_LOCAL_DATABASE_URL=1`; subprocessos recebem allowlist mínima, password e service files inertes, TLS e GSS desabilitados.
- Leitura e drift não criam a tabela de receipts. Um lock local por identidade normalizada serializa apply, read e drift entre aliases de loopback, com falha fechada para lock órfão ou estado sem receipt.
- O drift verifica extensões, domínio UUIDv7 completo, tabela e policy RLS exatas, triggers append-only ativos com timing e eventos corretos, e as funções `app.current_tenant_id` e `app.prevent_mutation`. A integração prova clean apply, upgrade de 0005 para 0006, rejeições UUIDv4 e variante RFC inválida, e regressões reais de domínio, policy, trigger e função.
- O harness inicia somente PostgreSQL 17 com pgvector em diretório temporário local, confirma `vector.control`, faz cleanup idempotente também em `SIGINT` ou `SIGTERM`, e não aceita ambiente remoto, credencial ou deploy.
- Revisões independentes de dados, testes e segurança concluídas. Evidências verdes: `env CI=true pnpm install --frozen-lockfile`, `pnpm contracts:check`, `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test` (31 Node e 10 Python unittest), `pnpm db:test`, `UV_CACHE_DIR=.uv-cache uv run pytest` (10) e `python3 scripts/validate_all.py` (8 checks).
- Próxima tarefa: M0-08, suíte negativa RLS e cross-tenant.

### 2026-07-14, M0-08 concluído

- Adicionada a migration forward-only `0007_relational_tenancy_integrity.sql`. Presenter ativo, participante de turn e apresentador de handoff agora referenciam `(tenant_id, session_id, id)`, evitando vínculo com participante de outra sessão do mesmo tenant. O drift estrutural também verifica essas constraints e a CI executa a nova suíte `pnpm db:rls`.
- A prova PostgreSQL local usa uma role efêmera `LOGIN NOSUPERUSER NOINHERIT NOBYPASSRLS`, sem acesso ao ledger de migrations nem a catálogos globais. Ela semeia dois tenants e testa as 35 tabelas com RLS: leitura própria, invisibilidade cross-tenant, escrita própria, insert cross-tenant rejeitado, update e delete cross-tenant sem efeito, ausência de contexto e reset de `SET LOCAL` após `COMMIT` e `ROLLBACK`.
- Foram adicionados casos reais para FK composta de agente e de sessão, presenter, turn e handoff de sessão diferente, seis tabelas append-only e proteção do histórico. O teste revelou que `ON DELETE SET NULL` tentaria alterar `cost_events`, o que contradiz a trigger append-only. ADR-019 registra a alternativa segura: `ON DELETE RESTRICT` para custo e avaliação, preservando vínculo e atribuição.
- `createTenantCacheKey` e `createTenantObjectKey` exigem UUIDv7, tenant e ambiente explícitos, recusam coerção hostil, traversal, barras e segmentos vazios. Os testes demonstram que componentes iguais nunca colidem entre tenants.
- Revisões independentes de segurança e testes concluídas sem bloqueadores. A autorização de qual tenant uma identidade pode selecionar permanece deliberadamente para M0-09, sem ser declarada como concluída nesta tarefa.
- Evidências verdes: `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test` (33 Node e 10 Python unittest), `pnpm contracts:check`, `UV_CACHE_DIR=.uv-cache uv run pytest` (10), `pnpm db:test`, `pnpm db:rls` e `python3 scripts/validate_all.py` (8 checks).
- Próxima tarefa marcada antes de qualquer alteração: M0-09, middleware de autenticação e contexto de tenant autorizado.

### 2026-07-14, M0-09 concluído e M0-10 iniciado

- Criado `@axtro/auth` e o middleware framework-neutral da API. O bearer de desenvolvimento é um identificador opaco para uma registry determinística injetada no startup, nunca uma credencial real, e o fake só pode ser construído em `development` ou `test` com `dev_auth_enabled=true`.
- A registry aceita somente os grants mínimos M0: scopes `session:read`, `session:write`, `provider:use` e `tool:use`, e finalidades `essential_processing`, `provider_auth` e `tool_auth`. Claims, ator, escopos e finalidades chegam somente da identidade verificada server-side.
- `X-Tenant-Id` é seletor exclusivo de service identity, precisa coincidir com grant explícito e nunca concede autoridade. Users com o mesmo grant são rejeitados até existir contrato claim-based próprio. O contrato OpenAPI, a arquitetura de tenancy e a arquitetura de segurança foram alinhados a essa fronteira.
- O contexto autorizado é imutável e só é aceito por helpers autenticados. Antes de qualquer handler, `withAuthorizedTenantTransaction` aplica `SELECT set_config('app.tenant_id', $1, true)` parametrizado no escopo da transação. Falha ao configurar o contexto impede o handler, e nenhum header bruto chega ao handler.
- Testes cobrem matriz de auth, configuração fora de development/test, header duplicado, confused deputy, user selector, grants admin ou bypass, contexto forjado, falha de contexto SQL e rollback. A suíte RLS local agora prova a semântica exata de `set_config(..., true)` após `COMMIT` e `ROLLBACK`.
- Revisões independentes de testes e segurança aprovaram o patch sem bloqueadores. A decisão reversível D-V2-023 registra o fake, a allowlist e o limite service-only.
- Evidências verdes: `pnpm lint`, `pnpm typecheck`, `pnpm contracts:check`, `pnpm build`, `pnpm test` (40 testes Node e 10 Python unittest), `UV_CACHE_DIR=.uv-cache uv run pytest` (10), `pnpm db:test`, `pnpm db:rls` e `python3 scripts/validate_all.py` (8 checks).
- Próxima tarefa marcada antes de qualquer alteração: M0-10, telemetria OpenTelemetry e logging estruturado sem PII.

### 2026-07-14, M0-10 concluído e M0-11 iniciado

- Criado `@axtro/observability` como núcleo compatível com OpenTelemetry, sem SDK, exporter, auto-instrumentação, rede ou estado global. A API cria uma raiz W3C e correlação UUIDv7 novas somente após autenticação, ignorando `traceparent`, `baggage` e demais cabeçalhos públicos.
- O único carrier interprocesso M0 é `traceparent` W3C estrito. Tenant, sessão, correlação e causa permanecem no contexto autorizado ou em evento interno já validado. A raiz da API não aceita sessão arbitrária e inicia com `session_id=null`.
- O teste executa o caminho API para worker Python para provider fake. O worker emite record compatível com o schema M0, revalida dataclasses públicas antes de uso e o callback de provider recebe apenas `traceparent`.
- Logs e spans usam event codes, error codes e atributos operacionais fechados. Não aceitam payload, transcript, segredo, nomes ou slugs livres. A referência de provider é local e criada pelo runtime. Dados `restricted` omitem atributos, e falha de sink é contada sem alterar o resultado de negócio.
- ADR-017, limites de plataforma, operação e D-V2-024 foram alinhados. Revisões independentes de arquitetura e segurança aprovaram o patch sem bloqueadores.
- Evidências verdes: `pnpm lint`, `pnpm typecheck`, `pnpm test` (44 Node e 14 Python unittest), `pnpm build`, `UV_CACHE_DIR=/private/tmp/axtro-uv-cache uv run pytest` (14) e `python3 scripts/validate_all.py` (8 checks).
- Próxima tarefa marcada antes de qualquer alteração: M0-11, portas de provider e registry de capacidades.

### 2026-07-14, M0-11 concluído e M0-12 iniciado

- Adicionado o 33º contrato normativo, `provider_registry_entry`, que referencia a evidência canônica `provider_capability` e aceita múltiplas capacidades do mesmo provider e port. O validador de contratos agora resolve referências locais sem rede e os tipos TypeScript e Python continuam determinísticos.
- Criados `@axtro/provider-contracts` e gateways de composição para model, voice, avatar e meeting. Os nove ports são fake-only, sem SDK, credencial, rede ou provider selecionado como default.
- O registry é imutável, exige provider explícito, expõe somente inspeção, elegibilidade fechada e fallback explícito. Ele recusa capability disabled ou deprecated, health unavailable ou unknown e circuit que não esteja closed. Não há roteamento, promoção ou fallback automático.
- Todo método exposto pelo registry recebe `ProviderOperationControl`; o sinal recebido pelo adapter é derivado e aborta em cancelamento do caller ou deadline. O guard de microtask impede iniciar trabalho após abort imediato. Health, custo, outputs, exceções de capability e teardown são normalizados e erros brutos de provider não chegam ao caller.
- Storage usa capacidade opaca process-local vinculada a scope antes do adapter. Referência de outro scope, caminho, URL ou objeto copiado é rejeitado antes de executar o port. ToolPort permanece declarado, mas fechado até M0-14, sem factory pública de autorização e sem chamada do adapter.
- `ProviderCostUnit` foi alinhado exatamente a `CostEvent.unit_type`; qualquer conversão de byte ou duração de storage fica deliberadamente para M0-16. A decisão reversível D-V2-025 foi atualizada.
- Revisões independentes de arquitetura e segurança aprovaram o patch após testes de cancelamento imediato, close timeout/cancelamento/redaction, capability throw segura, todos os métodos não governados, swap explícito, selection fail-closed e cross-tenant storage.
- Evidências verdes: `pnpm lint`, `pnpm typecheck`, `pnpm contracts:check`, `pnpm test` (54 testes Node e 14 Python unittest), `pnpm build`, `UV_CACHE_DIR=/private/tmp/axtro-uv-cache uv run pytest` (14), e `python3 scripts/validate_all.py` (8 checks).
- Próxima tarefa marcada antes de qualquer alteração: M0-12, provider fakes determinísticos com seed, latência, falha, cancelamento e resposta parcial.

### 2026-07-14, M0-12 concluído e M0-13 iniciado

- Criado `@axtro/provider-fakes` com os nove ports locais fake-only, composição explícita no registry, seed determinístico, referências opacas reproduzíveis, clock manual do pacote e scheduler sem rede, SDK, credencial, fonte aleatória ou relógio ambiente.
- Adicionados os contratos gerados `fake_provider_scenario`, `fake_provider_journal_entry` e `fake_provider_replay_descriptor`, com exemplos válidos e negativos. O journal referencia a enumeração fechada de operações do cenário e não aceita texto livre, tenant, referência, input, output, sessão, trace ou seed.
- O cenário limita delay, parciais, invocação e falhas injetadas. Cancelamento, timeout, falha antes ou depois de parciais e resposta parcial são reproduzíveis. Parciais permanecem somente marcadores de journal até M2.
- O provider contract deriva o orçamento de deadline na fronteira do adapter, preserva-o em controle interno e o fake o consome sem relógio ambiente. Cancelamento vence uma corrida pendente com timeout, saída tardia é bloqueada e uma chamada raw expirada falha antes de trabalho ou journal.
- O gerador de contratos agora resolve fragmentos JSON Pointer e representa campos opcionais em `TypedDict` compatível com Python 3.10. UUIDv7 e seeds secret-like são rejeitados nos schemas de fixture.
- Storage preserva somente referência selada e scope validado. ToolPort continua fail-closed com `action_runtime_required`, reservado para o funil `ActionIntent`, `PolicyDecision` e `ToolExecutionReceipt` de M0-14.
- ADR-012 e D-V2-026 registram a decisão reversível. Revisões independentes de arquitetura, segurança e testes aprovaram o patch após regressões de deadline, cancelamento, raw bootstrap e contrato.
- Evidências verdes: `pnpm lint`, `pnpm typecheck`, `pnpm contracts:check`, `pnpm test` (63 Node e 14 Python unittest), `pnpm build`, `UV_CACHE_DIR=/private/tmp/axtro-uv-cache uv run pytest` (14) e `python3 scripts/validate_all.py` (8 checks).
- Próxima tarefa marcada antes de qualquer alteração: M0-13, outbox transacional com commit atômico, retry idempotente e ordenação por aggregate.

### 2026-07-14, M0-13 concluído e M0-14 iniciado

- Implementado `@axtro/events` com repositório local determinístico que recebe somente `AuthorizedRequestContext`, valida o evento de interação pelo codec existente e confirma aggregate reduzido e envelope canônico no mesmo coordenador copy-on-write. Falhas injetadas depois da escrita do aggregate, do outbox ou antes do commit restauram aggregate, outbox e índices juntos.
- O relay M0 permanece local, bounded e sem broker, worker, workflow, rede ou scan global. Ele usa índices por tenant e aggregate, exige `session:write`, preserva predecessor não publicado e expõe somente uma seam de inspeção tenant-scoped do fake. Efeito de consumer é idempotente por `(tenant_id, event_id)` e retry após perda de acknowledgement não duplica o efeito.
- Adicionada a migration forward-only `0008_outbox_event_identity.sql`: materializa `event_id`, exige unicidade `(tenant_id, event_id)` e exige envelope canônico com identidade de tenant e evento correspondente. A validação é null-safe tanto no backfill quanto no `CHECK` persistente. O runner agora detecta drift das duas constraints de identidade.
- A integração PostgreSQL prova apply limpo, upgrade com backfill válido, rollback para envelope ausente, nulo ou de tenant divergente, rejeição de evento divergente no mesmo tenant, e drift após remoção de cada constraint. A fixture RLS usa envelope canônico.
- Revisões independentes de arquitetura, segurança e testes aprovaram a tarefa. Evidências verdes: `pnpm lint`, `pnpm typecheck`, `pnpm contracts:check`, `pnpm test` (69 Node e 14 Python unittest), `pnpm build`, `UV_CACHE_DIR=/private/tmp/axtro-uv-cache uv run pytest` (14), `pnpm db:test`, `pnpm db:rls` e `python3 scripts/validate_all.py` (8 checks).
- Próxima tarefa marcada antes de qualquer alteração: M0-14, funil ActionIntent, PolicyDecision e ToolExecutionReceipt com fake read-only.

### 2026-07-14, M0-14 concluído e M0-15 iniciado

- Implementados `@axtro/policy` e `@axtro/tool-runtime`. O runtime aceita somente `AuthorizedRequestContext` e `ActionIntent` estrito, exige tenant, ator, `tool:use` e `tool_auth`, e cria internamente `PolicyDecision` e `ToolExecutionReceipt` imutáveis. Texto de modelo, decisão, receipt, provider, endpoint e adapter não são entradas de execução.
- O único recurso M0 é uma fixture de catálogo determinística, privada e somente leitura. Ela está alinhada ao contrato ativo `catalog.lookup`: `tenant_installation`, `read_tenant`, classificação interna, sem side effects e atores Presenter ou Workflow. O `ToolPort` de provider permanece fail-closed e nenhuma factory de `AuthorizedToolExecution` foi criada.
- Idempotência é vinculada a tenant mais key e tenant mais intent. Replays retornam o mesmo receipt mesmo após a expiração da janela. Uma operação `unknown` reserva e bloqueia tenant, contrato, ação e argumentos canônicos contra retry cego, inclusive em corrida, com nova key, session, ator ou purpose. Somente receipt `succeeded` confirma efeito.
- O perfil de approval é fechado na composição e apenas torna a policy mais restritiva para teste. Não pode ser selecionado por texto, `ActionIntent`, decisão ou receipt. ADR-010, arquitetura de ações, contratos de provider e D-V2-028 registram a fronteira reversível.
- A nova suíte cobre allow, deny, approval, Actor allowlist, entrada hostil, contexto forjado, scope e purpose, isolamento cross-tenant, mesma key em tenants distintos, conflito de intent, replay pós-expiração, concorrência e unknown effect. Revisões independentes de arquitetura, segurança e testes aprovaram o patch sem bloqueadores.
- Evidências verdes: `pnpm lint`, `pnpm typecheck`, `pnpm contracts:check`, `pnpm test` (77 testes Node e 14 Python unittest), `pnpm build`, `UV_CACHE_DIR=/private/tmp/axtro-uv-cache uv run pytest` (14), `python3 scripts/validate_all.py` (8 checks) e `git diff --check`.
- Próxima tarefa marcada antes de qualquer alteração: M0-15, baseline de segurança com limites explícitos de entrada, rate, timeout e egress allowlist.

### 2026-07-14, M0-15 concluído e M0-16 iniciado

- Criado o baseline framework-neutral em `@axtro/security`: mede bytes reais antes de parse ou auth, rejeita headers duplicados, hostis ou fora de limite, usa coletor de corpo terminal após falha e entrega um perfil de headers de resposta fechado, sem CORS permissivo ou HSTS incondicional.
- A API agora compõe a sequência obrigatória ingress, autenticação, quota por tenant e ator autenticados, deadline e handler. A quota local é bounded em 1.024 buckets, usa clock injetável e ignora IP, forwarded headers e campos públicos. O deadline derivado aborta o trabalho e descarta resultado tardio.
- A resposta de erro segura segue exatamente o `Problem` existente no OpenAPI, com detalhe estático e `trace_id`, sem criar shape paralelo, ecoar request, segredo ou token. A correlação permanece na telemetria autenticada.
- A policy de egress é default deny. A capability por adapter aceita somente origens HTTPS exatas e vincula a prova opaca ao alvo normalizado; somente `dispatch` capability-scoped entrega o alvo ao transporte. Scheme inseguro, userinfo, fragmento, IP, loopback, porta alternativa, suffix host, redirect externo e proof forjada são rejeitados. Nenhum fake ganhou rede ou provider real.
- Adicionados ADR-020, D-V2-029 e atualizações de boundaries e arquitetura de segurança. O scanner local lê pnpm e uv locks contra snapshot versionado, falha fechado para input inválido e bloqueia findings high ou critical. CI executa o scanner antes de instalar o workspace, e o agregador o executa como nono validador.
- Revisões independentes de arquitetura, segurança e testes aprovaram após três correções: o Problem foi alinhado ao OpenAPI, a proof de egress passou a carregar target capability-scoped e o collector passou a fechar também após chunk único oversized.
- Evidências verdes: `env CI=true pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, `pnpm contracts:check`, `pnpm test` (83 testes Node e 18 Python unittest), `pnpm build`, `UV_CACHE_DIR=/private/tmp/axtro-uv-cache uv run pytest` (18), `python3 scripts/validate_all.py` (9 checks) e `git diff --check`.
- Riscos não bloqueantes registrados: o snapshot de advisories exige refresh operacional com proveniência antes de release, o limiter ainda é local por processo, e adapters reais deverão controlar redirects manualmente e validar DNS e IP do peer antes de qualquer egress.
- Próxima tarefa marcada antes de qualquer alteração: M0-16, cost event ledger com valores estimados e medidos, reconciliação, arredondamento e isolamento tenant-safe.

### 2026-07-14, M0-16 concluído e M0-17 iniciado

- Implementado `@axtro/costing` com ledger determinístico append-only, cálculo por inteiros escalados, arredondamento half-up e rejeição explícita quando um valor não preserva precisão no contrato numérico gerado. Valores estimados, medidos e reportados pelo provider permanecem separados em agregações e reconciliações.
- Rate cards e provider request references são capabilities opacas locais. A referência de request é vinculada ao rate card, tenant e sessão, e o ledger aceita uma vez por fonte, preservando somente o replay idempotente do mesmo evento. Nenhum SDK, credencial, invoice API ou caminho crítico realtime foi introduzido.
- A migration `0009_cost_event_reconciliation.sql` adiciona campos compatíveis e constraints forward-only para preservar eventos legados, trigger de reconciliação para exigir evidência estimada com dimensões iguais e índice parcial único por tenant, fonte e request reference para impedir duplicidade persistida. O guard de drift valida definição de checks, função, trigger, FK e índice.
- A integração PostgreSQL prova migração limpa, upgrade com custo histórico compatível e incompatível preservados, equação de custo, alvo medido rejeitado, dimensões divergentes rejeitadas, replay por reference, índice parcial, drift estrutural e UUIDv7. A suíte RLS confirma contexto ausente, relacionamento cross-tenant e mutação append-only, incluindo `DELETE` de custo.
- ADR-021, modelo de custo, limites de provider, plano de migration, decisão D-V2-030 e matriz de rastreabilidade foram atualizados. As revisões independentes de arquitetura, segurança e testes aprovaram sem bloqueadores.
- Evidências verdes: `pnpm lint`, `pnpm contracts:check`, `pnpm typecheck`, `pnpm test` (88 Node e 18 Python unittest), `pnpm build`, `UV_CACHE_DIR=/private/tmp/axtro-uv-cache uv run pytest` (18), `pnpm db:test`, `pnpm db:rls`, `python3 scripts/validate_all.py` (9 checks) e `git diff --check`.
- Próxima tarefa marcada antes de qualquer alteração: M0-17, fixtures de development e tenant-zero fake, sem PII ou credenciais reais.

### 2026-07-14, M0-17 concluído e M0-18 iniciado

- Implementados fixture e seed local `tenant-zero` para os tenants determinísticos `tenant-zero-alpha` e `tenant-zero-beta`. Cada tenant recebe configuração, identidade de workflow, agente e deployment Sales Closer, role pack, skill pack e somente as conexões `fake-realtime` e `fake-catalog` com handles opacos `ref_fake_*`.
- O seed é transacional e idempotente, requer opt-in explícito e uma URL PostgreSQL exclusivamente local. Antes de aplicar dados, valida o drift do schema; após os inserts, um bloco SQL verifica a composição canônica inteira dos dois tenants. Uma adulteração não é silenciosamente corrigida: o seed falha fechado e preserva o estado para investigação.
- A integração executa o seed duas vezes, prova composição dos dois tenants, bloqueio de URL remota, credencial ou query string, falha por drift e falha por handle adulterado. A matriz RLS prova leituras próprias e bloqueios cruzados para role pack, provider, identidade e agente, além de negar a execução do seed pela role runtime.
- O scanner de segredos passou a cobrir `.mjs`, com fixture negativa. Não há PII de clientes, URLs, credenciais reais ou providers externos no seed. A decisão D-V2-031 e o guia de seed documentam o limite de desenvolvimento local.
- Revisões independentes de segurança e testes aprovaram sem bloqueadores. Evidências verdes: `pnpm lint`, `pnpm contracts:check`, `pnpm typecheck`, `pnpm test` (92 Node e 18 Python unittest), `pnpm build`, `UV_CACHE_DIR=/private/tmp/axtro-uv-cache uv run pytest` (18), `pnpm db:test`, `pnpm db:rls`, `python3 scripts/validate_all.py` (9 checks) e `git diff --check`.
- Próxima tarefa marcada antes de qualquer alteração: M0-18, consolidação da evidência de release de Foundation.

### 2026-07-14, M0-18 concluído e M1-01 iniciado

- Criado `artifacts/m0/README.md` como bundle de release de Foundation, com escopo comprovado, commit verde, comandos, resultados, garantias verificadas e limitações. A evidência não autoriza produção, provider real, credenciais reais, deploy nem os marcos M2 e M3.
- Pipeline limpo repetido com `CI=true pnpm install --frozen-lockfile`, `UV_CACHE_DIR=/private/tmp/axtro-uv-cache uv sync --locked --all-groups`, `pnpm lint`, `pnpm contracts:check`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm db:test`, `pnpm db:rls`, `UV_CACHE_DIR=/private/tmp/axtro-uv-cache uv run pytest`, `python3 scripts/validate_all.py` e checks de diff. Todos passaram, incluindo 92 testes Node, 18 unittest Python, 18 pytest e 9 validadores.
- A integração PostgreSQL temporária validou migrations, upgrade, custo, seed, drift e UUIDv7. A matriz RLS confirmou contexto ausente, reset de pool, FKs, append-only e isolamento tenant. Não houve acesso a banco remoto, produção ou provider externo.
- Revisão independente do bundle confirmou ausência de whitespace no conteúdo staged, coerência das alegações, limitações e o commit verde `47db095` para o conteúdo anterior. Sem bloqueadores restantes.
- Próxima tarefa marcada antes de qualquer alteração: M1-01, API de lifecycle de sessão conforme OpenAPI, com versão otimista e isolamento tenant.

### 2026-07-14, M1-01 concluído e M1-02 iniciado

- Criado `@axtro/session-application` como boundary framework-neutral entre a API e o domínio/outbox. A API implementa `create`, `get`, `activate`, `complete` e `timeline` conforme OpenAPI, compõe ingress, autenticação, telemetria e Problems fechados, inclusive em rejeições pré-autenticação.
- A criação confirma em lote `session.created`, `session.prepared`, `disclosure.delivered` e `consent.recorded`; mantém disclosure, consentimento, registry de presenter e receipt local no mesmo boundary determinístico. O catálogo server-side aceita apenas o canal `api` por padrão, e uma entrega fake indisponível não cria estado, evidence ou outbox.
- Mutações exigem CAS por `expected_state_version`, ledger de idempotência tenant-scoped e bounded sem TTL, e hash canônico do motivo de conclusão sem armazenar o texto. O mesmo comando retorna a receipt anterior, payload diferente conflita e a capacidade excedida falha fechada.
- `SessionCommandControl` é verificado antes e depois de aguardar lock e dentro da transação fake do outbox antes do commit. O teste de timeout prova que uma disclosure atrasada não produz efeito tardio. Read/write scope, tenants cruzados, transições inválidas, session inexistente, query inválida, input malformado e headers duplicados retornam Problems declarados, sem eco de token ou corpo.
- ADR-022, D-V2-032, matriz de rastreabilidade e OpenAPI foram atualizados. O OpenAPI-backed test usa os schemas e respostas reais para validar casos positivos, negativos, status, headers e Problems.
- Revisões independentes de arquitetura inicial, segurança final e testes final aprovaram. O risco não bloqueante para M1-02: o coordenador fake do outbox rejeita transações realmente sobrepostas de sessões independentes, portanto o mailbox deve serializar por sessão sem criar ordem global ou expor 500.
- Evidências verdes: `pnpm lint`, `pnpm contracts:check`, `pnpm typecheck`, `pnpm test` (107 Node e 21 unittest Python), `pnpm build`, `UV_CACHE_DIR=/private/tmp/axtro-uv-cache uv run pytest` (21), `pnpm db:test`, `pnpm db:rls`, `python3 scripts/validate_all.py` (9 checks) e `git diff --check`.
- Próxima tarefa marcada antes de qualquer alteração: M1-02, Session Actor e mailbox por sessão com reidratação, idempotência e sem daemon ou ordenação global.

### 2026-07-14, M1-02 concluído

- Criado `@axtro/session-runtime` como o único Session Actor M1. A registry é indexada pelo par tenant e sessão, não contém fila, lock ou ordenação global, e observa somente `EventEnvelope` canônico já comprometido. O actor não cria eventos, não usa outbox, não grava timeline ou snapshot, não chama provider, não chama Axtro Agent e não publica mídia.
- Cada mailbox é bounded, mantém FIFO entre itens da mesma prioridade, reserva uma vaga para safety e permite que cancelamento de geração preempte comandos normais. O reducer existente continua a única fonte de estado e de One Mouth; outputs tardios são bloqueados por `generation_id` e `canPublishGeneration`.
- Dedupe usa `event_id` e fingerprint. Reentrega hot retorna o resultado original; após evicção, o actor consulta a fonte canônica com replay limitado a 10.000 envelopes. O lookup é tenant-scoped, coalescido por identidade e fingerprint e limitado a um por actor antes de I/O. Ausência de evidência produz `SessionActorReplayWindowError` sem mutação.
- Reidratação valida tenant, sessão, versões, eventos repetidos, ordenação, hash de snapshot e equivalência de snapshot mais tail. Leitura da fonte recebe `AbortSignal`, deadline de 1.000 ms por padrão e máximo de 10.000 ms; timeout, falha de scheduler ou resultado tardio falham fechados e removem actor parcial da registry.
- ADR-023 e D-V2-033 registram a fronteira, a ausência de contrato ou migration nova, e o limite operacional que M1-06 deverá substituir por snapshot mais tail e lookup durável. `apps/realtime-worker/SESSION_ACTOR_BOUNDARY.md` preserva o worker Python como fronteira de telemetria, sem segundo reducer ou mailbox.
- Revisões de arquitetura, realtime, segurança e testes aprovaram o patch. Os testes novos cobrem concorrência mesma sessão, sessões independentes, conflito, RLS de identidade, capacidade de registry e mailbox, snapshot adulterado ou cross-tenant, ordem inválida, duplicate delivery após reidratação, lane safety, cancelamento, flood de replay, timeout, I/O tardio e falhas determinísticas de scheduler.
- Evidências verdes: `pnpm lint`, `pnpm contracts:check`, `pnpm typecheck`, `pnpm test` (120 Node e 21 unittest Python), `pnpm build`, `UV_CACHE_DIR=/private/tmp/axtro-uv-cache uv run pytest` (21), `pnpm db:test`, `pnpm db:rls`, `python3 scripts/validate_all.py` (9 checks) e `git diff --check`.
- Risco não bloqueante: cache miss histórico custa replay O(n), limitado a 10.000 eventos e a um lookup por actor. M1-06 deve substituir por adapter durável de snapshot mais tail e lookup indexado, atrás dos limites de ingress autenticados existentes.
- Próxima tarefa: M1-03, textual turn driver com providers fake e sem colocar Axtro Agent no caminho crítico.

### 2026-07-14, M1-03 concluído

- Criado `@axtro/turns` como escritor canônico TypeScript. Ele valida contrato de submissão, identidade participante server-side, `session:write` e `essential_processing`; confirma primeiro o turno participant `restricted`, projeta o envelope retornado no Actor, inicia uma geração e chama a Fast Lane fake somente fora da lane de sessão.
- A resposta Presenter agora é outro `turn.committed` canônico e inclui speaker, papel e geração. O schema e o parser exigem generation nula para participant e positiva para Presenter. Antes do commit, o driver verifica geração, Presenter ativo e reducer/outbox, preservando One Mouth de forma atômica.
- O diretório local rejeita autoridade duplicada por tenant, sessão e participante. O ledger de idempotência é bounded e separado por tenant, sessão e participante, com hash canônico de texto restrito. A API expõe somente `202 Accepted`, command ID e trace ID, sem ecoar transcript.
- Interrupção só persiste marcador quando a geração pendente correspondente é cancelada no Actor. A fence local é definida antes do primeiro `await`, vence o caso `release()` seguido de interrupção e faz o estado entrar em `recovering_interruption`. Timeout, erro, saída inválida e cancelamento de request invalidam e limpam a geração; o sinal confiável da API alcança a Fast Lane.
- ADR-024, D-V2-034, arquitetura de eventos, matriz de rastreabilidade e a boundary do worker foram atualizados. Não há provider real, rede, credencial, tool, mídia, Action Runtime nem Axtro Agent no caminho síncrono.
- Revisões independentes de arquitetura, segurança e testes aprovaram o patch final. As evidências verdes são: `pnpm lint`, `pnpm contracts:check`, `pnpm typecheck`, `pnpm test` (133 Node e 22 Python unittest), `pnpm build`, `UV_CACHE_DIR=/private/tmp/axtro-uv-cache uv run pytest` (22), `pnpm db:test`, `pnpm db:rls`, `python3 scripts/validate_all.py` (9 checks) e `git diff --check`.
- Risco não bloqueante: se uma falha excepcional ocorrer entre a fence de interrupção e o cancelamento do Actor, a saída continua bloqueada pela fence local, mas uma limpeza defensiva adicional poderá ser considerada quando a interface de cancelamento durável for introduzida.
- Próxima tarefa dependente: M1-04, context composer determinístico, seguida por M1-05 em lane paralela de dependência.

### 2026-07-14, M1-04 concluído

- Criado `@axtro/context-composer` e o contrato fechado `context_composition`, elevando o conjunto a 39 schemas gerados para TypeScript e Python. O Composer é local, síncrono e sem cache, I/O, rede, provider, ferramenta, mídia, Actor, outbox ou Axtro Agent.
- O Turn Driver captura um snapshot capability opaco depois da projeção do Session Actor e só então compõe contexto fora da lane e mailbox. Estado bruto, snapshot forjado, snapshot de outra instância, tenant, sessão, versão, `session:read`, purpose e dados de `system_observation` falham fechados.
- Entradas são atômicas, ordenadas de modo determinístico e limitadas pelo JSON serializado em UTF-8. Conhecimento, sugestões e hipóteses preservam provenance sem se tornarem instruções; os três recusam `restricted`, knowledge exige checksum e receipt, e sugestões ou hipóteses exigem TTL e vínculo à versão do estado.
- O parser runtime fecha a fronteira Composer para Fast Lane: valida shape, classificação, evidence, checksum, timestamps RFC3339 reais, lifetime interno, orçamento e expiry. O Turn Driver repete a fence com seu clock confiável e não chama a Fast Lane para uma composição injetada malformada, futura ou expirada.
- ADR-025, D-V2-035, documentação de memória e boundary, matriz de rastreabilidade e exemplos foram atualizados. Revisões independentes de arquitetura, segurança e testes aprovaram após hardening de snapshot, clock, TTL, classificação externa e exemplo válido.
- Evidências verdes: `pnpm lint`, `pnpm contracts:check`, `pnpm typecheck`, `pnpm test` (146 Node e 23 Python unittest), `pnpm build`, `UV_CACHE_DIR=/private/tmp/axtro-uv-cache uv run pytest` (23), `python3 scripts/validate_all.py` (9 checks) e `git diff --check`.
- Risco não bloqueante: a capability de captura continua limitada ao fluxo server-side pós-Actor. Um consumidor futuro deve receber uma porta autoritativa, não um objeto de estado bruto.
- Próxima tarefa: M1-05, completar o fluxo Action Runtime fake por `ActionIntent`, `PolicyDecision` e `ToolExecutionReceipt`.

### 2026-07-14, M1-05 concluído

- Criado o contrato fechado `catalog_lookup_command`, elevando o conjunto a 40 schemas gerados para TypeScript e Python. O comando aceita somente `question_id`, `session_id` e `starter` ou `growth`; não aceita texto, tenant, ator, ferramenta, provider, policy, idempotência, timeout, receipt ou resultado do caller.
- Implementado o Catalog Lookup Coordinator server-side em `@axtro/tool-runtime`, fora de `@axtro/turns`, Fast Lane, mailbox do Session Actor, mídia, timeline e publicação Presenter. Ele exige `session:read`, `session:write`, `tool:use`, `essential_processing` e `tool_auth`, valida a registry fake de sessão, deriva `ActionIntent` e passa pela policy e pela fake privada já governada.
- A resposta é uma candidata tenant-scoped e confirma disponibilidade somente de receipt `succeeded` com intent, tenant, JSON canônico e effect hash coerentes. Ela cita o receipt, mas não produz fala, evento Presenter, timeline ou estado automático. `ToolPort` permanece fail-closed, sem SDK, rede, credencial ou adapter aberto.
- O modo fake fechado `timeout_once` gera `unknown` com evidência normalizada de timeout para a operação real, isolado por tenant. A reconciliação aceita apenas o mesmo comando autenticado e limpa a barreira privada e a barreira do coordenador após validar tenant, sessão, ator, fingerprint, intent e receipt. Repetição, comando alterado, tenant cruzado e retry cego permanecem bloqueados.
- Ambos os ledgers de ação e de comando são bounded por tenant e preservam replay anterior. A suíte cobre happy path receipt-cited, injeção e campos forjados, cada scope e purpose obrigatório, aprovação pendente sem confirmação, timeout alpha e beta independente, reconciliação, capacidade, replay, tenants cruzados e ausência estática de Action Runtime na Fast Lane.
- ADR-026 e D-V2-036 registram a decisão. A matriz de rastreabilidade, boundary do worker, arquitetura de actions, exemplos e tipos gerados foram atualizados. Revisões independentes de arquitetura, segurança e testes aprovaram o patch.
- Evidências verdes: `pnpm lint`, `pnpm contracts:check` (40 schemas), `pnpm typecheck`, `pnpm test` (154 testes Node e 23 unittest Python), `pnpm build`, `UV_CACHE_DIR=/private/tmp/axtro-uv-cache uv run pytest` (23), `python3 scripts/validate_all.py` (9 checks) e `git diff --check`. Não houve mudança de migrations, banco ou RLS nesta tarefa.
- Risco não bloqueante: a registry de sessão continua fake e a candidata não é publicação. M1-06 e posteriores devem trocar a autoridade pela fonte durável de floor/estado antes de timeline ou fala Presenter.
- Próxima tarefa pendente: M1-06, timeline, snapshots e replay verifier. Nenhuma tarefa de M2 ou M3 foi iniciada.

### 2026-07-15, M1-06 concluído

- Criado o contrato fechado `session_state_snapshot`, elevando o catálogo a 41 schemas gerados para TypeScript e Python. O snapshot cobre o aggregate completo, é `restricted`, inclui hash canônico e permanece um cache reconstruível, nunca a fonte de autoridade.
- Implementado em `@axtro/events` o repositório determinístico de timeline append-only, tenant-scoped e bounded. Append exige `session:write`; leitura exige `session:read`; materialização do snapshot exige ambos. Identidade global por tenant e evento, continuidade de versões, fingerprints canônicos, reentrega idempotente e conflitos falham antes de mutação.
- Implementado em `@axtro/session-runtime` o replay verifier público e a fonte read-only do Session Actor. A hidratação reproduz a timeline desde zero, lê um tail real depois da versão do snapshot e só publica estado após comparar estado, versão, hash, identidades e fingerprints. Ausência de snapshot, tail vazio, versão ausente, duplicação, inversão e tamper estão cobertos.
- Adicionada a migration forward-only `0010_session_timeline_event_identity.sql`, com `event_id` UUIDv7, unicidade tenant-scoped e constraint fechada que alinha o envelope a tenant, sessão, aggregate, versões, trace e timestamps. O backfill suspende somente o trigger append-only dentro da transação e o restaura antes do commit.
- A integração PostgreSQL prova upgrade histórico válido, backfill, trigger restaurado, rejeição append-only, rollback atômico quando UUIDv4 falha entre `DISABLE` e `ENABLE TRIGGER`, e drift quando a constraint perde a closure do envelope. A matriz RLS prova identidade relacional, isolamento cross-tenant, contexto ausente e namespaces isolados.
- ADR-027 e D-V2-037 registram timeline como autoridade, snapshot como cache, leitura consistente futura e a fronteira de M1-07. A matriz usa `REQ-STATE-004`; nenhuma regra constitucional, provider, rede, ferramenta direta, Axtro Agent síncrono, M2 ou M3 foi introduzido.
- Revisões independentes de arquitetura, segurança e testes aprovaram a tarefa sem bloqueadores após os hardenings de least privilege, backfill transacional, drift fechado e rollback do trigger.
- Evidências verdes: `pnpm lint`; `pnpm contracts:check` com 41 schemas; `pnpm typecheck`; `pnpm test` com 166 testes Node e 23 unittest Python; `pnpm build`; `UV_CACHE_DIR=.uv-cache uv run pytest` com 23 testes; `python3 scripts/validate_all.py` com 9 checks; `pnpm db:test`; `pnpm db:rls`; e `git diff --check`.
- Riscos não bloqueantes: o repositório determinístico da M1 permanece process-local; um adapter PostgreSQL futuro deve fixar um watermark ou usar leitura transacional consistente. O fingerprint detecta alteração no limite do repositório, mas não substitui uma hash chain ou proteção contra administrador do storage comprometido.
- Próxima tarefa pendente: M1-07, relay de outbox e consumidores idempotentes. Nenhuma tarefa de M2 ou M3 foi iniciada.

### 2026-07-15, M1-07 concluído

- Criado o contrato fechado `event_delivery_receipt`, elevando o catálogo a 42 schemas gerados para TypeScript e Python. O receipt registra somente identidade tenant, evento, aggregate, consumer code-owned, fingerprint, trace, correlation, status, tentativas, códigos fechados, effect hash e timestamps. Payload, transcript, claim token, bearer token, erro bruto e stack não são observáveis.
- Implementada em `@axtro/events` a máquina de entrega determinística e bounded com estados `pending`, `publishing`, `failed`, `published` e `dead_letter`. Claims usam lease com deadline exclusivo, UUIDv7 single-use no histórico tenant-scoped, fencing contra ACK obsoleto, attempt budget pinado no primeiro claim, backoff, máximo de tentativas, ordem por aggregate e progresso independente entre aggregates.
- Criado `apps/event-relay` com `runOnce` de um evento, clock e tokens determinísticos e consumer explícito `session-timeline`. Crash antes do efeito recupera somente após o lease; crash depois do efeito usa o receipt idempotente da timeline e não duplica o estado. O consumer reconcilia tenant, sessão, evento, versão, fingerprint e state hash antes do ACK; nome arbitrário não pode sequestrar o delivery.
- `event:relay` e `event:observe` são concedidos somente a workflow service identities e exigem `essential_processing` também no repository. Claim, ACK, retry, DLQ e observação continuam tenant-scoped e falham antes de mutação em overreach, purpose incorreto ou tenant cruzado.
- `event-relay` foi adicionado ao catálogo de observabilidade. Cada claim válido produz span `outbox.relay` e códigos fechados sem payload. Trace canônico de 32 caracteres não zero é preservado; valores válidos de 16 a 64 caracteres fora do perfil W3C usam derivação SHA-256 estável com domínio versionado, enquanto o receipt preserva o valor original. Falha do sink não altera ACK, retry, DLQ ou efeito.
- ADR-028, D-V2-038, arquitetura de eventos, multi-tenancy, topologia, matriz de rastreabilidade e documentação de contratos registram a decisão. O relay legado e o ledger `WeakMap` foram removidos. Não houve migration, alteração de banco ou implementação de M1-08, M2 ou M3; o ADR exige migration forward-only antes de adapter PostgreSQL ou execução multiprocesso.
- Revisões independentes de arquitetura, segurança e testes aprovaram o snapshot final sem bloqueadores. A suíte cobre crash antes do efeito, crash depois do efeito, reuso histórico de token, ACK no deadline, drift de configuração após restart, retry/backoff/max, poison e DLQ, ordenação, consumer não registrado, receipt divergente, config hostil, scopes, purposes, tenants cruzados, trace 16/32/64 e falha do sink.
- Evidências verdes: `pnpm lint`; `pnpm contracts:check` e `python3 scripts/validate_contracts.py` com 42 schemas; `pnpm typecheck`; `pnpm test` com 180 testes Node e 23 unittest Python; `pnpm build`; `uv run pytest` com 23 testes; `python3 scripts/validate_all.py` com 9 checks; e `git diff --check`. O validador de database permaneceu verde com 38 tabelas e 10 migrations; integração PostgreSQL e RLS não foram reaplicadas porque esta tarefa não alterou schema, migration ou policy de banco.
- Riscos não bloqueantes: o repository continua process-local e com capacidade finita. A factory fake possui até 1.024 tokens e consome um por `runOnce`, inclusive idle; isso é adequado somente ao perfil local e por job de M1 e deve ser substituído antes de worker recorrente.
- Próxima tarefa pendente: M1-08, workflow fake pós-call com resume, retry, cancelamento e idempotência, sem iniciar M2 ou M3.

### 2026-07-15, M1-08 iniciado

- Dependência M1-07 concluída, validada e commitada em `941fc12` antes do início desta tarefa.
- Task graph, arquitetura de workflows duráveis, contratos `workflow_command` e `workflow_status`, AsyncAPI, instruções de contratos e skills de mudança arquitetural, contrato primeiro e segurança foram relidos antes da implementação.
- Escopo fechado: consumir `session.completed`, gerar resumo e avaliação determinísticos, persistir status local resumível, provar retry, cancelamento e idempotência de follow-up sem provider, rede, credencial, ação externa, M2 ou M3.

### 2026-07-15, M1-08 concluído

- Criados cinco contratos fechados para comando, status, enqueue receipt, step receipt e resultado pós-call, elevando o catálogo a 47 schemas gerados para TypeScript e Python. As relações condicionais de lifecycle e outcome são validadas tanto nos JSON Schemas quanto na forma SQL.
- Implementado `@axtro/workflows` com store determinístico tenant-scoped e bounded, clock confiável, IDs server-side, idempotência por completion, quatro checkpoints de uma etapa, leases exclusivos, fencing tokens históricos, budgets de tentativa pinados e classificação fechada de falhas. Resumo, avaliação estrutural e follow-up guard são fakes locais determinísticos.
- Criado `apps/workflow-worker` com execução de uma etapa por `runOnce`, retomada por worker substituto, retry com backoff, cancelamento e telemetria PII-free. Claims expirados exauridos limpam a lease, registram receipt terminal e não consomem token substituto; checkpoints tardios permanecem bloqueados.
- O event relay ganhou duas factories explícitas: a timeline-only rejeita `session.completed`, e a composta exige o sink de workflow no bootstrap. Completion só recebe ACK depois de append idempotente na timeline e enqueue idempotente do workflow, fechando as duas janelas de crash sem introduzir fanout genérico.
- Autoridade foi separada em `workflow:dispatch`, `workflow:execute` e `workflow:observe`, restrita a service identity de workflow. Claims exigem também `session:read` antes de observar estado, e resultado `restricted` exige leitura de sessão. Cancelamento não concede observação implícita.
- Adicionada a migration forward-only `0011_post_call_workflow_persistence.sql` com 42 tabelas totais e 11 migrations. Commands, receipts, results e evidence são append-only, forced-RLS e ligados por FKs compostas ao mesmo tenant, run, command, sessão e completion exata. Checks fecham lifecycle, terminalidade e semântica de receipts.
- A matriz PostgreSQL prova clean apply, upgrade, backfill, drift estrutural, integridade de source e UUIDv7. A matriz RLS prova isolamento cross-tenant, mistura inválida dentro do mesmo tenant, lifecycle impossível, append-only, contexto ausente, reset de pool e namespaces isolados.
- ADR-029 e D-V2-039 registram a escolha por workflow fake checkpointed, sem engine real, provider, rede, ferramenta, credencial ou efeito externo. O follow-up permanece `deterministic_noop`, `not_sent` e `external_effect=false`; Axtro Agent não participa do caminho crítico.
- Revisões independentes finais de arquitetura, segurança e testes aprovaram o patch sem achados P0, P1 ou P2. Foram confirmados clock autoritativo, scopes mínimos, FKs compostas, fencing, classificação de erro, ausência de integração externa e preservação da Constituição.
- Evidências verdes: `pnpm lint`; `pnpm contracts:check` com 47 schemas; `pnpm typecheck`; `pnpm test` com 191 testes Node e 23 unittest Python; `UV_CACHE_DIR=/private/tmp/axtro-uv-cache uv run pytest` com 23 testes; `pnpm build`; `pnpm db:test`; `pnpm db:rls`; `python3 scripts/validate_all.py` com 9 checks; e `git diff --check`.
- Riscos não bloqueantes: o store TypeScript é process-local e prova restart de worker sobre o mesmo estado, não recuperação após perda do processo. Um adapter PostgreSQL futuro precisa de ledger histórico de claims abandonados antes de poder ser declarado seguro. O consumer composto é propositalmente específico, não um mecanismo geral de fanout.
- Nenhuma credencial real, ambiente de produção, banco remoto, deploy, provider real, M2 ou M3 foi acessado ou iniciado.

### 2026-07-15, M1-09 iniciado

- Dependências M1-01 e M1-06 já estão concluídas e validadas. M1-08 foi concluída separadamente no commit `cc4e1af` antes deste início.
- Escopo fechado ao console operacional mínimo definido no task graph, usando somente autoridades locais de lifecycle e timeline, dados fake determinísticos e isolamento tenant. Nenhum deploy, provider real, M2 ou M3 será iniciado.

### 2026-07-15, M1-09 concluído

- Criados `@axtro/ui` e `apps/web` sem framework, servidor, socket ou dependência de produção nova. O renderer SSR produz documentos sem script para estados populated, empty, loading e error, com landmarks semânticos, skip link, foco visível, timeline ordenada, tabelas navegáveis e labels de receipt e hipótese distintas por texto, símbolo, borda e cor.
- A rota privada `/operations/sessions/:session_id` recebe somente um `AuthorizedRequestContext` já resolvido, exige `human_operator`, `session:read` e `essential_processing`, rejeita tenant selector e consulta `SessionLifecycleApplication.getSession()` antes de toda fonte secundária. Sessão estrangeira e inexistente compartilham o mesmo 404 e os testes provam zero chamadas de timeline, actions e costs após a negação.
- O read model usa exclusivamente a timeline autoritativa M1-06, rejeita gaps, inversões, duplicatas e divergência com lifecycle, refaz o replay e o state hash, limita cada página a 100 itens e o replay a 10.000 envelopes e 5 MB UTF-8. Cursor 100/101, overflow e budget agregado possuem provas positivas e negativas.
- A projeção de ações é somente leitura e retém apenas campos allowlisted. Cada linha valida `ActionIntent`, `PolicyDecision` e `ToolExecutionReceipt` por tenant, sessão derivada do intent, identidade, janela temporal, outcome `allow` para sucesso, JSON canônico e hash criptográfico do resultado. A entrada é limitada a 10.000 registros, 100 por sessão e 5 MB cumulativos; nenhum método do Action Runtime ou ToolPort chega à UI.
- Custos são consultados somente após autorização da sessão, validados contra tenant e sessão exatos, limitados a 100 buckets e somados com `BigInt` em escala fixa. Totais estimados, medidos e reportados pelo provider permanecem separados e são reconciliados pelo renderer com os buckets.
- O renderer copia somente data descriptors para snapshot imutável, rejeita getters, proxies inconsistentes, controles bidi, timestamps inválidos, enums herdados, páginas que ocultam remanescente e totais contraditórios. Texto dinâmico é escapado e payload, transcript, arguments, result, erro bruto, provider code, external refs e rate-card refs não entram no HTML.
- A resposta envia CSP fechada com hash exato do stylesheet, `private, no-store`, `nosniff`, frame denial, permissions policy e referrer policy. A telemetria web usa valores fechados e trace root tenant-only com `session_id=null`, impedindo que um deep link estrangeiro associe a sessão não autorizada ao tenant solicitante em spans ou logs.
- ADR-030, D-V2-040, arquitetura de sistema, matriz de rastreabilidade, README e índice de ADRs registram a escolha reversível por SSR framework-neutral, a ausência deliberada de browser auth e a inexistência de contrato wire novo.
- Revisões independentes finais de arquitetura, segurança e testes aprovaram o snapshot. Achados intermediários sobre telemetria pré-autorização, hash de receipt, budgets, policy deny com sucesso, página vazia e caps simultâneos foram corrigidos e ganharam testes de regressão. O veredito final não deixou P0, P1 ou P2 arquitetural aberto.
- Evidências verdes: `pnpm lint`; `pnpm contracts:check` com 47 schemas; `pnpm typecheck`; `pnpm test` com 206 testes Node e 23 unittest Python; `uv run pytest` com 23 testes; `pnpm build`; `pnpm db:test`; `pnpm db:rls`; `python3 scripts/validate_all.py` com 9 checks, 42 tabelas e 11 migrations; e `git diff --check`.
- Riscos não bloqueantes: a rota é um adapter SSR interno, não um servidor HTTP nem browser auth; a projeção de receipts é process-local e injetada no bootstrap; a M1-10 deve provar o produtor real do Action Runtime até o console; o teste de acessibilidade é smoke estrutural, não auditoria WCAG com browser; cada refresh ainda refaz até 5 MB de replay e deve migrar para snapshot mais tail e admission control antes de exposição HTTP real.
- Nenhuma credencial real, ambiente de produção, banco remoto, deploy, provider real, execução direta de ferramenta, M2 ou M3 foi acessado ou iniciado.

### 2026-07-15, M1-10 iniciado

- Dependências M1-04, M1-05, M1-06, M1-07, M1-08 e M1-09 concluídas, validadas e separadas por commits convencionais. M1-09 foi commitada em `94ebd3f` antes deste início.
- Escopo fechado à composição E2E fake-only do Walking Skeleton, artefatos determinísticos e matriz de falhas exigida no task graph. Nenhum canal de áudio, provider real, deploy, credencial, M2 ou M3 será iniciado.

### 2026-07-15, M1-10 concluído

- Criado o comando canônico `pnpm m1:e2e`, que compõe as fronteiras reais e framework-neutral de lifecycle, Session Actor, Context Composer, Turn Driver, Action Runtime, Cost Ledger, outbox relay, timeline, replay verifier, workflow pós-call e console operacional. O cenário completo roda duas vezes e exige igualdade estrutural e byte a byte dos goldens.
- O fluxo produz 12 eventos canônicos, materializa snapshot na versão 11, aplica o tail de conclusão, converge outbox, Actor ativo, Actor reidratado, workflow e console no replay hash `5b61e69e9c9b9d8af7a15ef5e2358be06544b7b7cfa46b3d4335b1d9f9e425b5`.
- A One Mouth Rule é comprovada pelos seis payloads reais antes da sanitização: três turnos do participante e três do Presenter, sequência alternada, índices 1 a 6, um único Presenter igual ao floor ativo e nenhum participante usando a identidade do Presenter. Nenhum payload restrito entra nos artefatos.
- A ação de catálogo passa pela cadeia `ActionIntent`, `PolicyDecision` e `ToolExecutionReceipt`, executa o fake exatamente uma vez, reaproveita a mesma candidata no replay e não adiciona fala ou evento. A capability `action_evidence` é separada, read-only, tenant-scoped, limitada a 100 registros e expõe somente metadata allowlisted para o console.
- A matriz de falhas prova 404 indistinguível e zero leituras secundárias cross-tenant, crash do relay depois do efeito e antes do ACK com recuperação na tentativa 2 sem duplicação, e efeito de ferramenta `unknown` com retry cego bloqueado e reconciliação exata enquanto a sessão ainda está ativa.
- O workflow pós-call conclui quatro checkpoints, mantém follow-up externo desativado e preserva o hash de origem. O baseline fake registra uma requisição de catálogo estimada em USD 0.02, sem custo medido ou reportado por provider.
- Congelados `artifacts/m1/timeline.json`, `artifacts/m1/evidence.json` e `artifacts/m1/manifest.json`. O manifest fixa 12 eventos, o replay hash, SHA-256 canônico da timeline `beffbdd11a04b74889afe2159fcce4bab53b1eef8d9ef7f0cc107a92be4cffee` e da evidência `a0da2cc6519690bbe118b353b8b26a8d3ba7497db091355af2d4345ca9a0c14a`.
- ADR-026, arquitetura do Action Runtime, playbook do Walking Skeleton e D-V2-041 registram a capability de evidência, os limites locais, degradação e rollback. Não foi necessário alterar contrato wire, schema, migration, dependência ou Constituição.
- Revisões independentes finais de arquitetura, segurança e confiabilidade aprovaram o patch sem P0, P1 ou P2. O achado intermediário sobre prova insuficiente da One Mouth Rule foi corrigido e ganhou regressão explícita; o cenário `unknown` foi movido para antes da conclusão da sessão.
- Evidências verdes: `pnpm lint`; `pnpm contracts:check` com 47 schemas; `pnpm typecheck`; `pnpm test` com 209 testes Node e 23 unittest Python; `UV_CACHE_DIR=/private/tmp/axtro-uv-cache uv run pytest` com 23 testes; `pnpm build`; `pnpm m1:e2e` com 2 testes; `python3 scripts/validate_all.py` com 9 checks, 47 schemas, 42 tabelas e 11 migrations; e `git diff --check`.
- Riscos não bloqueantes: repositories, evidência de ação e execução E2E permanecem process-local; os goldens retêm somente metadata; o console ainda é SSR interno sem servidor ou browser auth; esta tarefa não reaplicou PostgreSQL e RLS porque não alterou banco, e o gate M1-11 executará a pipeline local completa.
- Nenhuma credencial real, ambiente de produção, banco remoto, deploy, provider real, ação externa, M2 ou M3 foi acessado ou iniciado.

### 2026-07-15, M1-11 iniciado

- Dependência M1-10 concluída, validada e commitada em `436466b` antes do início desta tarefa.
- Escopo fechado ao release gate de M1: revisar as evidências congeladas, executar a pipeline local completa incluindo PostgreSQL e RLS, confirmar ausência de P0 de segurança ou tenancy e registrar o custo baseline da sessão fake.
- Nenhum código de áudio, provider real, credencial, produção, deploy, banco remoto, M2 ou M3 será iniciado.

### 2026-07-15, M1-11 concluído

- A pipeline limpa foi repetida com `pnpm install --frozen-lockfile`, `UV_CACHE_DIR=/private/tmp/axtro-uv-cache uv sync --locked --all-groups`, `pnpm lint`, `pnpm contracts:check`, `pnpm typecheck`, `pnpm test`, `UV_CACHE_DIR=/private/tmp/axtro-uv-cache uv run pytest`, `pnpm build`, `pnpm db:test`, `pnpm db:rls`, `pnpm m1:e2e`, `python3 scripts/validate_all.py` e `git diff --check`.
- Todos os gates passaram: 209 testes Node, 23 unittest Python, 23 pytest, 2 testes E2E, 47 schemas, 42 tabelas, 11 migrations e 9 validadores. PostgreSQL e RLS foram exercitados somente em instâncias temporárias locais, sem banco remoto.
- A decisão D-V2-042 e os ADRs aplicáveis registram a exigência conjunta de scope de sessão e `essential_processing` em lifecycle, timeline, outbox, Session Actor, Cost Ledger e projeção operacional. Testes negativos comprovam rejeição antes de leitura, alocação ou mutação.
- O bundle `artifacts/m1/` foi congelado com 12 eventos, replay hash `5b61e69e9c9b9d8af7a15ef5e2358be06544b7b7cfa46b3d4335b1d9f9e425b5`, hash canônico da timeline `beffbdd11a04b74889afe2159fcce4bab53b1eef8d9ef7f0cc107a92be4cffee` e hash canônico da evidência `1eca0ecb0689994ac2202636b108f066e04695622983c06e94f51ab203521274`.
- O custo baseline da sessão fake nominal é USD 0.02 para uma única consulta de catálogo. Duas invocações da injeção negativa de efeito desconhecido ficam explicitamente excluídas; lifecycle, turnos, replay, workflow e console têm atribuição externa zero neste cenário.
- Revisões independentes finais de arquitetura, segurança e release aprovaram o snapshot sem P0, P1 ou P2. One Mouth, isolamento multi-tenant, ação obrigatoriamente receipt-backed, fakes determinísticos e Axtro Agent fora do caminho crítico permanecem preservados.
- Limitações aceitas: stores e workers process-local, console SSR interno sem browser auth, alertas sem transporte operacional, custo somente nominal e ausência de integração realtime ou provider real. M0 contém apenas contratos, ports e fakes locais para essas capacidades futuras.
- M0 e M1 estão concluídos como baseline local e fake-only. Nenhuma credencial real, produção, provider real, deploy, migration remota, ação externa, M2 ou M3 foi acessado ou iniciado.

### 2026-07-14, baseline arquitetural

- 31 schemas estritos e 62 exemplos de contrato preparados.
- OpenAPI, AsyncAPI, SQL, RLS, task graph, unit economics e configuração Codex preparados.
- Código de aplicação ainda não iniciado.

### 2026-07-15, M2-01 concluído

- Adicionado `RoomTransport` em `packages/meeting-gateway/src/room-transport.ts`: fronteira normalizada de sala nativa (join, leave, publish, unpublish, subscribe, reconnect, disconnect) sobre exatamente uma conexão `ChannelPort`. Nenhum SDK concreto (LiveKit ou outro) é importado; a troca futura por um adapter real fica restrita à implementação de `ChannelPort` (ADR-003, gate de benchmark).
- Ciclo de vida de participante (`joining` implícito → `active` → `reconnecting` → `active` | `left` | `removed`) preserva identidade e `joinedAtMs` através de reconexão, sem duplicar participante.
- `apps/meeting-room` criado como novo app do workspace (`pnpm-workspace.yaml`, `tsconfig.json` raiz) e único ponto que compõe `@axtro/provider-fakes` com `@axtro/meeting-gateway`; código de sessão depende somente da interface `RoomTransport`.
- 6 testes novos em `tests/realtime/room-transport.test.mjs`: contrato de transporte, rejeição de join duplicado e publish inativo, reconexão preservando identidade, participante e track desconhecidos, idempotência de `disconnect`, isolamento entre duas salas independentes.
- `pnpm lint`, `tsc --build` completo do workspace e `node scripts/test.mjs` (215 testes Node, 23 unittest Python) verdes após a mudança.
- D-V2-043 registra o padrão de validação mais leve adotado nos pacotes M2 (spike fake-first) frente ao padrão M0/M1.
- Nenhuma credencial real, produção, provider real, deploy, migration remota ou M3 foi acessado ou iniciado.

## Próxima ação

Continuar M2 em modo autônomo controlado: M2-02, Turn Coordinator harness, sobre a fronteira `RoomTransport` recém-criada.
