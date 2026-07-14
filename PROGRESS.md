# Progresso de implementação

**Estado atual:** implementação de M0 em andamento  
**Marco atual:** M0  
**Tarefa atual:** M0-11
**Última evidência verde:** M0-10 com telemetria W3C interna, logs sem PII e propagação API, worker e provider fake validada em 2026-07-14
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
| `M0-11` | M0 | in_progress | Implement provider ports and capability registry | `M0-03`, `M0-04` | início registrado antes de alterações |
| `M0-12` | M0 | pending | Implement deterministic provider fakes | `M0-11` | pending |
| `M0-13` | M0 | pending | Implement transactional outbox repository | `M0-05`, `M0-07`, `M0-10` | pending |
| `M0-14` | M0 | pending | Implement Action Runtime skeleton | `M0-03`, `M0-08`, `M0-12` | pending |
| `M0-15` | M0 | pending | Add application security baseline | `M0-02`, `M0-06`, `M0-09` | pending |
| `M0-16` | M0 | pending | Implement cost event ledger | `M0-03`, `M0-07`, `M0-11` | pending |
| `M0-17` | M0 | pending | Create development fixtures and tenant-zero seed | `M0-08`, `M0-12`, `M0-14` | pending |
| `M0-18` | M0 | pending | M0 release gate | `M0-02`, `M0-03`, `M0-05`, `M0-08`, `M0-09`, `M0-10`, `M0-12`, `M0-13`, `M0-14`, `M0-15`, `M0-16`, `M0-17` | pending |
| `M1-01` | M1 | pending | Implement session lifecycle API | `M0-18` | pending |
| `M1-02` | M1 | pending | Implement Session Actor and mailbox | `M1-01` | pending |
| `M1-03` | M1 | pending | Implement textual turn driver | `M1-02`, `M0-12` | pending |
| `M1-04` | M1 | pending | Implement context composer | `M1-03` | pending |
| `M1-05` | M1 | pending | Complete fake Action Runtime flow | `M1-03`, `M0-14` | pending |
| `M1-06` | M1 | pending | Implement timeline, snapshots and replay verifier | `M1-02`, `M0-13` | pending |
| `M1-07` | M1 | pending | Implement outbox relay and idempotent consumers | `M0-13`, `M1-06` | pending |
| `M1-08` | M1 | pending | Implement fake post-call workflow | `M1-07` | pending |
| `M1-09` | M1 | pending | Build minimal operations console | `M1-01`, `M1-06` | pending |
| `M1-10` | M1 | pending | Walking Skeleton E2E and failure suite | `M1-04`, `M1-05`, `M1-06`, `M1-07`, `M1-08`, `M1-09` | pending |
| `M1-11` | M1 | pending | M1 release gate | `M1-10` | pending |
| `M2-01` | M2 | pending | Implement channel adapter and native-room transport boundary | `M1-11`, `M0-11` | pending |
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

### 2026-07-14, baseline arquitetural

- 31 schemas estritos e 62 exemplos de contrato preparados.
- OpenAPI, AsyncAPI, SQL, RLS, task graph, unit economics e configuração Codex preparados.
- Código de aplicação ainda não iniciado.

## Próxima ação

Executar `python3 scripts/validate_all.py`, registrar o resultado e iniciar `M0-01`.
