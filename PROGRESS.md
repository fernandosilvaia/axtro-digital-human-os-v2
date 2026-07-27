# Progresso de implementação

**Estado atual:** M0, M1, M2 e M3 concluídos (M3-01 a M3-09 fake-first/dry-run completos; M3-10 com ferramenta pronta, piloto real e bake-off de provider pendentes de gate humano); VISUAL-01 concluído; Cérebro Método Silva no ar (D-V2-073/074); SEO-AEO-01 concluído; rate card de custos no ar (D-V2-078); M4 (cérebro customizado próprio na persona de vídeo) iniciado — M4-01 concluído (D-V2-080)

**Marco atual:** M4 (em andamento)
**Tarefa atual:** M4-02 (parser de mensagens Tavus)
**Última evidência verde:** M4-01 em 2026-07-27 — `runBrainChatCompletion` extraído para `apps/portal/src/lib/brain/chat-completion-core.ts` (ports injetadas, sem Supabase/HTTP/provider diretos), `agent-preview.ts` refatorado sem mudança de comportamento; 437 testes Node (11 novos: composição chat/vídeo, bloco de conhecimento, bloco de percepção rotulado e truncado, ordem de histórico, orçamento de mensagens sob histórico longo, validação de entrada malformada, propagação de erro do provider) + 26 Python, typecheck, lint, build e 9 validadores verdes
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
| `M2-02` | M2 | done | Build Turn Coordinator harness | `M2-01` | Máquina de estados pura, 4 perfis, geração cercada, 18 testes Node verdes cobrindo os 10 fixtures obrigatórios |
| `M2-03` | M2 | done | Implement modular STT, LLM and TTS path | `M2-02`, `M0-12` | `runModularConversationPath` com timing por componente e modo exact-capture, 7 testes Node verdes |
| `M2-04` | M2 | done | Implement speech-to-speech experiment adapter | `M2-02`, `M0-11` | Router `selectConversationPathMode` com fallback, sessão S2S com renovação antes do expiry, coberto nos mesmos 7 testes |
| `M2-05` | M2 | done | Implement Behavior and Presence Director | `M2-02`, `M0-03` | 10 estados canônicos, `BehaviorIntent` fechado, scheduler determinístico por seed, 10 testes Node verdes |
| `M2-06` | M2 | done | Implement avatar port, fake and cancellation semantics | `M2-01`, `M2-05`, `M0-12` | `AvatarSession` com resultado tipado (nunca exceção), 4 testes Node verdes |
| `M2-07` | M2 | done | Implement Scene and Presentation Director | `M2-01`, `M0-03` | `SceneManifestRegistry` fechado + `SceneDirector` com fencing por geração, 10 testes Node verdes |
| `M2-08` | M2 | done | Implement silent Specialist Fabric | `M1-04`, `M0-12` | Fila bounded + bulkhead por tipo, deadline racing, One Mouth por omissão de API, 8 testes Node verdes |
| `M2-09` | M2 | done | Implement perception signal bus and quality state | `M2-02`, `M0-03` | Vocabulário fechado de sinal/hipótese, TTL e consentimento aplicados, 8 testes Node verdes |
| `M2-10` | M2 | done | Implement degradation and recovery controller | `M2-03`, `M2-04`, `M2-06`, `M2-07` | Matriz de 10 linhas executável, recuperação explícita, fencing anti-duplicidade, 7 testes Node verdes |
| `M2-11` | M2 | done | Instrument realtime latency, quality and cost | `M2-03`, `M2-06`, `M2-07`, `M0-16` | Recorder p50/p95 por span, orçamentos de `LATENCY_BUDGETS.md`, reconciliação de custo, 11 testes Node verdes |
| `M2-12` | M2 | done | Run mandatory ten-minute Human Presence scenario | `M2-05`, `M2-08`, `M2-09`, `M2-10`, `M2-11` | Cenário determinístico de 600.000ms simulados, 11/11 itens do checklist, `artifacts/m2/evidence.json` congelado, 7 testes Node verdes |
| `M2-13` | M2 | done | M2 architecture and provider decision gate | `M2-12` | `artifacts/m2/DECISION.md`: 12 áreas de arquitetura `continue`/`tune`, 11 candidates de provider `blocked` por ausência de credencial real |
| `M3-01` | M3 | done | Implement Sales Closer Role Pack | `M2-13` | Manifesto, `sales.uninstalled` no reducer, `TenantRolePackRegistry` process-local, 11 testes Node verdes |
| `M3-02` | M3 | done | Implement authorized knowledge ingestion and RAG | `M3-01`, `M0-08` | ADR-031, `@axtro/knowledge-engine` + `apps/ingestion-worker`, 9 testes Node verdes (cross-tenant, stale, injection corpus) |
| `M3-03` | M3 | done | Add CRM-lite read adapter | `M3-01`, `M0-14` | `@axtro/tool-adapter-crm-lite` somente leitura, PII por purpose, auditoria por tenant, 10 testes Node verdes |
| `M3-04` | M3 | done | Add calendar proposal in dry-run | `M3-01`, `M0-14` | `@axtro/tool-adapter-calendar`: propõe, confirma (dry-run padrão), idempotente, 8 testes Node verdes |
| `M3-05` | M3 | done | Add proposal generation in dry-run | `M3-01`, `M0-14` | `@axtro/tool-adapter-proposal`: preço só de receipt ou catálogo válido, sem capacidade de envio, 9 testes Node verdes |
| `M3-06` | M3 | done | Implement warm human handoff | `M3-01`, `M2-10` | `@axtro/handoff`: proposta pendente única por sessão, CAS delegado ao domínio, 7 testes Node verdes |
| `M3-07` | M3 | done | Implement sandbox follow-up workflow | `M1-08`, `M3-01` | `createSandboxFollowUpWorkflow` em `@axtro/workflows` (aditivo, M1-08 intacto), 5 testes Node verdes |
| `M3-08` | M3 | done | Implement evaluation harness and golden conversations | `M3-01`, `M3-02`, `M3-06` | `@axtro/evaluation` com 6 dimensões, gate crítico independente da média, 6 cenários golden, 8 testes Node verdes |
| `M3-09` | M3 | done | Expand console for opportunity and call review | `M3-02`, `M3-03`, `M3-05`, `M3-08` | `opportunity-review.ts` novo em `@axtro/ui` (reaproveita `renderEvidenceLabel`/`escapeHtml` do M1-09), 9 testes Node verdes |
| `M3-10` | M3 | done (ferramenta) | Internal Sales Closer Alpha pilot gate | `M3-04`, `M3-05`, `M3-06`, `M3-07`, `M3-08`, `M3-09` | `generatePilotGateReport` pronto e testado; piloto real de 20 chamadas e bake-off credenciado ficam pendentes de gate humano — ver `artifacts/m3/README.md` |
| `VISUAL-01` | Produto | done | Redesign premium da landing e do workspace do portal | M3 concluído | landing, copy, motion, asset autoral, workspace e validação visual desktop/mobile concluídos |
| `SEO-AEO-01` | Produto | done | SEO, AEO, compartilhamento e superfícies públicas do portal | VISUAL-01 | `pnpm lint`, `pnpm test` (426 Node + 26 Python), typecheck, build do portal, `git diff --check`, 9 validadores verdes, deploy Railway e smoke público verde |
| `M4-01` | M4 | done | Extract ports-injected brain chat-completion core | `M3-01`, `M3-02` | `chat-completion-core.ts` sem import de Supabase/HTTP/provider; `agent-preview.ts` refatorado sem mudar comportamento; 11 testes novos (437 Node total) verdes |

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

### 2026-07-15, M2-02 concluído

- Adicionado `@axtro/turn-coordinator`: máquina de estados pura (`idle → user_speaking → endpoint_candidate → committed`, mais `agent_interrupted` e `recovered_false_interrupt`) em `state-machine.ts`, fiel a `docs/architecture/TURN_COORDINATOR.md`, com notas de interpretação explícitas para os trechos ambíguos do diagrama ASCII.
- `coordinator.ts` combina sinais (`speech_energy`, `transcript_update`, push-to-talk, `presenter_turn_completed`, `network_jitter_observed`) com a política de endpoint e barge-in por perfil, cerca geração por `generationId` monotônico, e emite diretivas (`generation_committed`, `generation_cancelled`, `playback_paused`, `playback_resumed`, `scene_cancelled`, `crosstalk_ignored`, `false_start_abandoned`) para os consumidores de M2-03/M2-06/M2-07 cancelarem mídia tardia.
- Quatro perfis (`conversational`, `presentation`, `noisy_phone`, `accessibility`) implementam a tabela de configuração do documento; `accessibility` expõe `withPushToTalkRequired` para push-to-talk opcional.
- 18 testes novos em `tests/realtime/`: máquina de estados pura (4 testes) e harness do coordenador (14 testes) cobrindo os dez fixtures obrigatórios — pausa no meio da frase, backchannel, crosstalk, ruído/música, sotaque PT-BR e números/e-mails, falso início, interrupção durante preamble, rede lenta e agente falando demais — mais recuperação de falsa interrupção, timeout de utterance máxima, push-to-talk e perfil `noisy_phone`.
- Dois bugs de encadeamento de estado foram corrigidos durante o TDD: (1) um silêncio único que já satisfaz `pauseSilenceMs` e `endpointSilenceMs` no mesmo sinal agora comita na mesma chamada, em vez de esperar um segundo sinal; (2) um `max_utterance_timeout` forçado agora comita imediatamente ao ouvir fala contínua, em vez de ser cancelado como se fosse um `speech_resumed` comum.
- `pnpm lint`, `tsc --build` completo e `node scripts/test.mjs` (233 testes Node, 23 unittest Python) verdes.
- Nenhuma credencial real, produção, provider real, deploy, migration remota ou M3 foi acessado ou iniciado.

### 2026-07-15, M2-03 e M2-04 concluídos

- `packages/model-gateway/src/conversation-path.ts` implementa `runModularConversationPath` (STT via `SpeechToTextPort` → LLM via um novo `TextGenerationPort` local → TTS via `TextToSpeechPort`), com `timing` por componente (`sttStartedAtMs`/`sttCompletedAtMs`/`llmCompletedAtMs`/`ttsCompletedAtMs`) e um modo `exactCapture` que produz uma referência determinística distinta do modo de paráfrase (números/e-mails).
- `selectConversationPathMode` implementa o roteador de feature flag do ADR-002: com `s2sEnabled=false` nunca tenta abrir sessão; com `s2sEnabled=true`, tenta e cai para `modular` (`fallbackFromS2S=true`) se a sessão falhar, sem nunca bloquear a chamada.
- `openS2SSession`/`renewS2SSessionIfNeeded` abrem sessão em modo `s2s` via `RealtimeModelPort` e renovam a sessão antes do `expiresAt` reportado pelo provider, fechando a sessão antiga somente depois que a nova abre.
- `createDeterministicTextGenerationFake` é um fake local determinístico (seed + hash) para o passo de LLM; D-V2-046 registra que nenhum "llm" `ProviderPortKind` foi adicionado ao registry fechado de `provider-contracts` nesta etapa — a decisão de formalizar isso fica para M2-13/M3.
- 7 testes novos em `tests/realtime/conversation-path.test.mjs`: pipeline modular ordenado com timing, exact-capture determinístico e distinto de paráfrase, cancelamento propagado, roteador S2S nos três casos (desligado, saudável, fallback) e sessão S2S com renovação.
- `pnpm lint`, `tsc --build` completo e `node scripts/test.mjs` (240 testes Node, 23 unittest Python) verdes.
- Nenhuma credencial real, produção, provider real, deploy, migration remota ou M3 foi acessado ou iniciado.

### 2026-07-15, M2-05 concluído

- `@axtro/behavior-director` converte `BehaviorIntent` (goal/energy/warmth/pacing/pauseProfile/nonverbalIntent fechado, sem comando de animação livre) em `behavior_directive` validada contra `provider_capability` (voice style, faixa de speaking rate, microgestos permitidos, gaze target, max duration, `cancellationGenerationId`).
- Dez estados canônicos do documento implementados com tabelas de allowance, gaze e duração máxima por estado; `interrupted_recovering` e `technical_degraded` nunca gesticulam; `idle_ready`/`listening_*`/`thinking_brief` ficam restritos a gestos "quiet" (nod, tilt_head, soft_gaze_break), dando prioridade a listening sobre performance visual.
- Naturalness scheduler: cooldown de 8s por gesto, limite de 6 nods e 4 smiles por minuto com janela deslizante, e seleção estocástica determinística via hash SHA-256 de `(sessionSeed, callIndex, gesto)` — mesma seed e mesma sequência de chamadas sempre produzem a mesma diretiva.
- Acessibilidade: `reducedMotion` suprime todo gesto e gaze sem perder a diretiva de voz/estado; `supportsGaze=false` da capability força `gazeTarget: "none"` incondicionalmente.
- 10 testes novos em `tests/realtime/behavior-director.test.mjs`: validação contra capability, determinismo por seed, diferenciação entre seeds, neutralidade predominante de `idle_ready`, cooldown, cap por minuto, estados sem gesto, reduced motion, ausência de gaze e rejeição de intent não-canônico.
- `pnpm lint`, `tsc --build` completo e `node scripts/test.mjs` (250 testes Node, 23 unittest Python) verdes.
- Nenhuma credencial real, produção, provider real, deploy, migration remota ou M3 foi acessado ou iniciado.

### 2026-07-15, M2-06 concluído

- `@axtro/avatar-gateway` ganhou `AvatarSession`: `warmUp` mede `elapsedMs` e desabilita a sessão (Art. 14, degradação declarada) se `health()` não vier `healthy` a tempo; `renderSegment` nunca lança exceção — todo resultado é um `AvatarRenderOutcome` tipado (`rendered` | `degraded_to_voice_only` | `discarded_late` | `disabled`), garantindo que falha de avatar nunca bloqueia o áudio.
- Fencing por `generationId`: `renderSegment` recebe um callback `isGenerationActive` e descarta silenciosamente (`discarded_late`) qualquer segmento cuja geração já foi cancelada por barge-in antes do provider terminar de renderizar — nenhum frame de lip-sync tardio é entregue.
- Uma vez desabilitada (falha de warm-up ou de render), a sessão permanece `disabled` para o resto da sessão, sem retry automático, alinhado à tabela de `CAPABILITY_DEGRADATION_MATRIX.md` que M2-10 vai formalizar.
- 4 testes novos em `tests/realtime/avatar-session.test.mjs`: warm-up e render saudáveis, falha de render degradando sem lançar exceção e desabilitando a sessão, timeout de warm-up antes de qualquer render, e descarte de segmento de geração cancelada.
- `pnpm lint`, `tsc --build` completo e `node scripts/test.mjs` (254 testes Node, 23 unittest Python) verdes.
- Nenhuma credencial real, produção, provider real, deploy, migration remota ou M3 foi acessado ou iniciado.

### 2026-07-15, M2-07 concluído

- `@axtro/scene-director`: `createSceneManifestRegistry` constrói um allowlist fechado e imutável na inicialização (sem `register` em runtime); cada manifesto declara origem (obrigatoriamente `https://`), schema de data binding, ações permitidas, campos PII permitidos, capacidades de canal exigidas, timeout e fallback.
- `createSceneDirector` implementa o fluxo `SceneIntent -> select manifest -> bind sanitized data -> policy check -> render -> scene_directive -> audit event`: rejeita manifesto desconhecido, campo fora do schema, campo PII não autorizado, capacidade de canal ausente e falha de policy — sempre com resultado tipado (`accepted`/`rejected`), nunca lançando exceção.
- Concorrência por `generationId`: uma diretiva de geração mais antiga que a já ativa é rejeitada (`generation_no_longer_active`) e nunca substitui a cena do turno atual; cenas de prioridade `max` (handoff, safety) sempre podem preemptar a cena ativa, emitindo `scene_preempted` no log de auditoria.
- Toda diretiva aceita é `sandbox: "iframe_sandboxed"` fixo; nenhum caminho aceita URL arbitrária, script fornecido pelo LLM ou execução fora do allowlist.
- 10 testes novos em `tests/realtime/scene-director.test.mjs`: binding sanitizado, manifesto desconhecido, dado fora do schema, campo PII não autorizado, capacidade de canal ausente, diretiva tardia rejeitada, preempção por handoff, exposição de PII somente conforme allowlist, policy customizada e rejeição de origem não-https na construção do registry.
- `pnpm lint`, `tsc --build` completo e `node scripts/test.mjs` (264 testes Node, 23 unittest Python) verdes.
- Nenhuma credencial real, produção, provider real, deploy, migration remota ou M3 foi acessado ou iniciado.

### 2026-07-15, M2-08 concluído

- `@axtro/specialist-fabric` implementa os 7 tipos do catálogo (`product`, `pricing`, `compliance`, `research`, `proposal`, `tool_planner`, `fact_checker`) com `SpecialistRequest`/`SpecialistResult` fechados; todo resultado carrega `untrusted: true`, `expiresAtMs` e nunca um campo de fala — a superfície pública da fábrica (`registerHandler`, `request`, `metrics`) mecanicamente não tem método de publicação, então o One Mouth Rule é garantido por omissão de API, não por convenção.
- Bulkhead e fila bounded por `specialistType`: acima de `maxConcurrencyPerType` as requisições entram numa fila bounded por `maxQueueDepthPerType`; excedido isso, `rejected_queue_full` imediato — um especialista lento nunca consome todos os workers de outro tipo.
- Toda requisição corre contra o próprio `deadlineMs` via `Promise.race`; ao vencer o prazo o handler é abortado e a chamada retorna `timeout` no tempo do deadline, não no tempo real do handler. Uma resolução tardia após o timeout nunca é entregue nem contabilizada como `completed`.
- Saída do handler é validada estruturalmente (`confidence` em 0..1, `ttlMs` positivo e limitado, arrays de fontes/assumções/claims fechados); saída malformada vira `invalid_result` em vez de propagar um resultado corrompido.
- 8 testes novos em `tests/realtime/specialist-fabric.test.mjs`: resultado completo e expirável, timeout no prazo do request, descarte de resolução tardia, resultado inválido, bulkhead com fila e overflow, ausência mecânica de superfície de publicação, tipo não registrado como erro de wiring, e requisição malformada rejeitada antes do handler.
- `pnpm lint`, `tsc --build` completo e `node scripts/test.mjs` (272 testes Node, 23 unittest Python) verdes.
- Nenhuma credencial real, produção, provider real, deploy, migration remota ou M3 foi acessado ou iniciado.

### 2026-07-15, M2-09 concluído

- `@axtro/perception` implementa exatamente as três categorias permitidas em M2 (dialogue, technical, visual_presence opt-in) como vocabulário fechado de `PerceptionSignalType` — não existe forma de construir um sinal de mentira, diagnóstico, atributo protegido, risco/solvência, biometria ou emoção-como-fato, porque esses tipos simplesmente não estão na lista.
- Todo `PerceptionSignal` carrega evidence, confidence, detector e versão, purpose, privacyClass, `observedAtMs` e `expiresAtMs` (Art. 4). `RECOMMENDED_SIGNAL_TTL_MS` espelha a tabela do documento (áudio baixo 10s, vídeo congelado 5s, etc.); o chamador pode sobrescrever o TTL dentro de um teto de 4h.
- Sinais de `visual_presence` exigem `requiredConsentPurpose` do detector estar presente em `grantedConsentPurposes`; sem o consentimento correspondente o sinal é rejeitado com motivo explícito, nunca descartado silenciosamente.
- `deriveHypothesis` só aceita os 4 tipos de hipótese fechados, exige ao menos uma evidência, e rejeita evidência inexistente ou já expirada — uma hipótese nunca é mais forte que o sinal que a sustenta.
- 8 testes novos em `tests/realtime/perception-bus.test.mjs`: contrato completo do sinal, rejeição e aceite por consentimento visual, detector emitindo tipo não registrado, seis tipos de inferência proibida comprovadamente inconstrutíveis, expiração por TTL, hipótese com evidência válida/ausente/tipo desconhecido/expirada, e detector/confidence inválidos.
- `pnpm lint`, `tsc --build` completo e `node scripts/test.mjs` (280 testes Node, 23 unittest Python) verdes.
- Nenhuma credencial real, produção, provider real, deploy, migration remota ou M3 foi acessado ou iniciado.

### 2026-07-15, M2-10 concluído

- `@axtro/degradation-controller` executa as 10 linhas de `docs/operations/CAPABILITY_DEGRADATION_MATRIX.md` como dados tipados e imutáveis (`CAPABILITY_DEGRADATION_MATRIX`, `ruleFor`), em vez de prosa: cada falha (`avatar_unavailable`, `tts_primary_down`, `stt_degraded`, `s2s_down`, `rag_down`, `tool_timeout`, `axtro_daemon_down`, `meeting_bot_removed`, `network_poor`, `budget_reached`) mapeia para um `systemAction` e `dataAction` fechados.
- `handleFailure`/`recover`/`isDegraded` seguem Art. 14 (degradação declarada): uma falha fica ativa até uma chamada explícita de `recover`, nunca se autolimpa silenciosamente.
- `markPresented`/`shouldSuppressDuplicatePresentation` fecham o requisito de "recuperação sem output duplicado do Presenter": ao cair de S2S para modular (ou qualquer fallback), uma geração já apresentada, ou qualquer geração mais antiga que a já apresentada, é marcada para supressão — testado com um cenário de output tardio de uma geração S2S cancelada chegando depois do fallback modular já ter sido entregue.
- Optei por um pacote novo em vez de tocar `packages/session-runtime` (alvo listado no task graph): a integração final desse controlador com o Session Actor real fica para quando M3 promover alguma capability M2 além do spike, evitando risco desnecessário sobre o M1 congelado nesta sessão.
- 7 testes novos em `tests/realtime/degradation-controller.test.mjs`, incluindo um teste de integração real com `selectConversationPathMode` do M2-04.
- `pnpm lint`, `tsc --build` completo e `node scripts/test.mjs` (287 testes Node, 23 unittest Python) verdes.
- Nenhuma credencial real, produção, provider real, deploy, migration remota ou M3 foi acessado ou iniciado.

### 2026-07-15, M2-11 concluído

- `@axtro/realtime-telemetry` mede os nove spans exigidos pelo cenário obrigatório (`audio_ingress`, `turn_candidate`, `turn_commit`, `context_compose`, `model_first_token`, `tts_first_audio`, `avatar_first_frame`, `channel_publish`, `cancellation_acknowledged`), correlacionados por `generationId`, com vocabulário próprio em vez de alargar o `TELEMETRY_SPAN_NAMES` fechado de `@axtro/observability` (D-V2-047, mesmo racional do D-V2-046).
- `SPAN_BUDGETS` espelha `docs/operations/LATENCY_BUDGETS.md` linha a linha: orçamentos p50/p95 para endpoint confirmation, context compose, model first token, TTS first audio e publish/jitter; orçamentos ideal/acceptable (não percentil) para avatar warm-up e barge-in stop; `TOTAL_EOT_TO_AUDIO_BUDGET_MS` soma os cinco componentes do turno para o teto composto de 650ms p50 / 1500ms p95.
- `percentiles`/`evaluateBudget` usam nearest-rank sobre amostras ordenadas; `missingSpansForGeneration` prova completude de span por geração — insumo direto para a evidência de M2-12.
- `reconcileSessionCost` compara custo estimado vs relatado pelo provider com tolerância configurável (10% padrão), como exigido pelo critério de aceite de M2-11.
- 11 testes novos em `tests/realtime/realtime-telemetry.test.mjs`: p50/p95 com amostras suficientes, orçamento percentil respeitado, p95 estourado com p50 saudável (distribuição de cauda), spans não orçados, orçamentos de threshold (warm-up/barge-in), soma composta EOT→áudio completa e incompleta, completude de span por geração, reconciliação de custo dentro e fora da tolerância, e rejeição de span malformado.
- `pnpm lint`, `tsc --build` completo e `node scripts/test.mjs` (298 testes Node, 23 unittest Python) verdes.
- Nenhuma credencial real, produção, provider real, deploy, migration remota ou M3 foi acessado ou iniciado.

### 2026-07-15, M2-12 concluído

- `tests/e2e/m2-human-presence-spike-harness.mjs` compõe todos os componentes M2-01 a M2-11 (RoomTransport, Turn Coordinator, caminho modular, Behavior Director, Avatar Session, Scene Director, Specialist Fabric, Perception Bus, Degradation Controller, Realtime Telemetry) num único cenário fake-first com relógio simulado próprio.
- Os onze itens obrigatórios de `docs/operations/HUMAN_PRESENCE_SPIKE.md` são exercitados em sequência: disclosure (marcador, mecanismo real em M1-01), pergunta aberta, pausa no meio de frase, interrupção do usuário (barge-in com frame de avatar tardio descartado), captura exata de número/e-mail, consulta de catálogo read-only, especialista atrasado (timeout no próprio deadline), apresentação de slide, injeção de falha de avatar (quinta chamada de `avatar.render` falha deterministicamente), retorno a voice-only e encerramento.
- O relógio simulado avança até exatamente 600.000ms (dez minutos); o preenchimento final usa tempo de escuta ambiente sem eventos, provando ausência de deadlock, exceção não tratada ou transição de estado inválida ao longo de toda a janela, não só nos destaques roteirizados.
- Dois bugs de composição foram corrigidos durante a integração: (1) a falha de avatar injetada na segunda chamada de render acontecia cedo demais, misturando o teste de "late frame descartado" com o de "falha de avatar" — movida para a quinta chamada; (2) o turno que sucede a interrupção tinha voz insuficiente (90ms) para superar `minSpeechDurationMsToStart`, sendo tratado como falso início — corrigido com um chunk de fala adicional antes do silêncio final.
- `pnpm m2:e2e` (novo script, espelha `m1:e2e`) roda 7 testes: determinismo byte-a-byte contra `artifacts/m2/evidence.json`, checklist completo mais dez minutos sem deadlock, barge-in sem late output mais degradação de avatar, especialista atrasado não bloqueante, cena aceita mais custo reconciliado, todos os orçamentos de `LATENCY_BUDGETS.md` avaliados, e ausência de material restrito no artefato congelado.
- `artifacts/m2/evidence.json` e `artifacts/m2/README.md` congelados; `pnpm lint`, `tsc --build` completo, `node scripts/test.mjs` (305 testes Node, 23 unittest Python) e `pnpm m1:e2e` (M1 continua verde) passaram.
- Nenhuma credencial real, produção, provider real, deploy ou migration remota foi acessado. A revisão de naturalidade PT-BR real e o bake-off de provider ficam explicitamente pendentes para M2-13/M3 com gate humano.

### 2026-07-15, M2-13 concluído — M2 Human Presence Spike encerrado

- `artifacts/m2/DECISION.md` registra o gate de decisão: 12 áreas de arquitetura M2-01 a M2-11 recebem `continue` (2 delas com nota `tune`: vocabulário próprio de telemetria/degradação e validação spike-tier), nenhuma recebe `replace`; os 10 candidates de `CURRENT_PROVIDER_MATRIX.md` mais Hedra recebem `blocked` uniformemente, motivo explícito de ausência de bake-off credenciado, sem nenhum blocker de qualidade ou jurídico adicional.
- `docs/operations/CURRENT_PROVIDER_MATRIX.md` ganhou uma seção "M2-13: decisão registrada" apontando para a evidência; nenhuma linha da matriz mudou de "precisa benchmark" para aprovada.
- D-V2-048 registra a separação deliberada entre decisão de arquitetura (comprovável com evidência fake de M2-12) e decisão de provider (exige credencial real e gate humano) — misturar as duas esconderia que nenhum provider real foi de fato exercitado nesta sessão.
- Reestimativa qualitativa de M3: os contratos e o fencing por geração de M2 (`RoomTransport`, `TurnCoordinator`, `AvatarSession`, `SceneDirector`) são tratados como estáveis para receber uma implementação real de provider sem redesenho; M3 deve orçar o bake-off credenciado (`PROVIDER_BENCHMARK_PROTOCOL.md`, gate humano) como item de escopo próprio, não incluído em M0-M2.
- **M2 Human Presence Spike está concluído**: M2-01 a M2-13 done, 305 testes Node e 23 unittest Python verdes, `pnpm m1:e2e` e `pnpm m2:e2e` verdes, nenhuma credencial real, provider real, deploy ou migration remota acessados.

### 2026-07-15, gate de release M2 completo

- Pipeline completa executada e verde ao final da sessão: `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm contracts:check`, `pnpm typecheck`, `pnpm test` (305 Node + 23 unittest Python), `uv run pytest` (23), `pnpm build`, `pnpm db:test`, `pnpm db:rls`, `pnpm m1:e2e` (2, M1 permanece verde), `pnpm m2:e2e` (7), `python3 scripts/validate_all.py` (9 validadores) e `git diff --check`.
- `pnpm db:test` e `pnpm db:rls` exigiram `LC_ALL=C LANG=C` explícitos neste ambiente para contornar um bug conhecido do PostgreSQL 17 via Homebrew no macOS (`postmaster became multithreaded during startup` quando `LC_ALL`/`LANG` ficam vazios em vez de ausentes) — nenhuma mudança de código ou script foi necessária, é puramente ambiental.
- `FINAL_AUDIT_REPORT.md` atualizado para cobrir M0, M1 e M2 juntos: veredito, implementação auditada, comandos reproduzíveis, garantias arquiteturais, riscos aceitos e próxima sequência agora refletem o spike M2 completo e o gate de decisão de M2-13.
- Working tree limpo, 13 commits de M2 (M2-01 a M2-13) mais este, todos com mensagem convencional e coautoria registrada.

### 2026-07-15, M3 iniciado — M3-01 concluído

- Escopo de M3 confirmado antes de codar: `AGENTS.md` isenta apenas M0-M2 de bloqueio por credencial ausente; `HANDOFF_TO_CODEX.md` classifica M3 como "Sales Closer Alpha interno. Não declarar pronto para cliente sem auditoria, provider bake-off, segurança, privacidade e aprovação de lançamento." M3-01 a M3-09 permanecem fake-first/dry-run porque é exatamente isso que o texto de aceite de cada uma já exige; o bake-off credenciado e os 20 chamados internos reais de M3-10 são tratados como itens de escopo próprios fora da execução autônoma (D-V2-049).
- `@axtro/domain` ganhou o evento `sales.uninstalled` (payload vazio) e o reducer `uninstallSales`, fechando a lacuna que impedia "pack can be enabled or removed" no nível de sessão — reinstalar após remover é permitido (D-V2-050). Diferente do vocabulário próprio usado em M2 (spike), aqui estender `packages/domain` é a continuação correta porque o Role Pack é exatamente o extension point que o pacote já antecipava (`extensions.sales?`).
- `@axtro/role-pack-sales-closer` (`packages/role-packs/sales-closer/`): manifesto `SALES_CLOSER_MANIFEST` validado contra `contracts/schemas/role_pack_manifest.schema.json`, helpers puros `createInitialSalesState`/`applySalesUpdate` (nunca mintam evento, ID ou timestamp — essa autoridade fica em session-application) e `TenantRolePackRegistry` process-local para habilitar/desabilitar por tenant, independente do estado de extensão por sessão (D-V2-051).
- 11 testes novos (1 em `tests/domain/reducers.test.mjs` para `sales.uninstalled`, 10 em `tests/role-packs/sales-closer.test.mjs`): manifesto válido/rejeitado, seed de qualificação, merge de update e rejeição pós-fechamento, wiring end-to-end install→uninstall pelo reducer real, sessão genérica sem o pack, e registry por tenant (instalar antes de habilitar, isolamento entre tenants, remoção de pack nunca habilitado rejeitada, reabilitação após remoção).
- `pnpm lint`, `pnpm contracts:check`, `tsc --build` completo, `node scripts/test.mjs` (316 testes Node, 23 unittest Python), `pnpm m1:e2e` e `pnpm m2:e2e` verdes.
- Nenhuma credencial real, produção, provider real, deploy ou migration remota foi acessado.

### 2026-07-15, M3-02 concluído

- `docs/adr/ADR-031-knowledge-and-rag-retrieval.md` registra a decisão que ADR-025 havia reservado: `@axtro/knowledge-engine` é um port puro e síncrono sobre um store em memória cujas formas espelham coluna-a-coluna `database/migrations/0004_knowledge_governance.sql` (já existente desde M0, nunca antes consultado por código de aplicação). Nenhum client `pg` ou provider de embedding real foi escolhido — consistente com M3 permanecer fake-first onde o próprio critério de aceite pede.
- Pipeline de retrieval fechado e fail-closed em ordem fixa: tenant/role/produto/locale/validade → candidatos léxico+vetorial determinísticos (hash SHA-256, nunca `Math.random`) → rerank → policy hook injetável → orçamento de bytes UTF-8 exato (mesma disciplina do Context Composer de M1-04, omissão atômica em vez de corte de chunk) → citação obrigatória. Todo chunk retornado é `trusted: false`.
- Revogação é estrutural, não cacheada: publicar uma nova versão da mesma fonte marca a versão anterior superada (`validToMs` = início de validade da nova versão) e a próxima consulta já reflete isso sem passo de invalidação.
- `apps/ingestion-worker`: fonte → scan fake de malware/tamanho → extração/chunking determinístico por parágrafo → embedding fake por hash → publicação de versão, sempre pelo mesmo port que a leitura usa (ingestão nunca contorna as regras de validade/classificação).
- Defesa contra prompt injection é estrutural: o pacote nunca concatena texto recuperado em algo que um consumidor a jusante possa interpretar como instrução. O teste do corpus adversarial prova que frases imperativas dentro do conteúdo não mudam filtragem, ranking ou citação — permanecem dado inerte.
- 9 testes novos em `tests/knowledge/knowledge-engine.test.mjs`: fim a fim com citação e untrusted, retrieval cross-tenant zerado, fonte desabilitada excluída imediatamente, versão superada excluída a partir da janela de validade da nova, allowlist de role/produto/locale independentes, corpus de prompt injection como dado inerte, rejeição de malware/tamanho antes de gravar, truncamento atômico por orçamento de bytes, e policy hook customizado.
- `pnpm lint`, `pnpm contracts:check`, `tsc --build` completo, `node scripts/test.mjs` (325 testes Node, 23 unittest Python), `pnpm m1:e2e`, `pnpm m2:e2e` e `python3 scripts/validate_all.py` (9 validadores) verdes.
- Nenhuma credencial real, produção, provider real, deploy ou migration remota foi acessado.

### 2026-07-15, M3-03 concluído

- `@axtro/tool-adapter-crm-lite` (`packages/tool-adapters/crm-lite/`): adaptador somente leitura para `lead` e `opportunity`, com schema de campos fechado por tipo de registro (PII marcado explicitamente por campo) e apenas dois purposes autorizados a ver PII (`proposal_preparation`, `handoff_context`) — `sales_qualification` nunca recebe contato.
- Cada leitura é auditada por tenant (`auditLog`) com requester, purpose, campos solicitados vs. concedidos vs. negados e status; a superfície pública do adaptador (`read`, `auditLog`) não tem nenhum método de escrita — enforcement estrutural, igual ao One Mouth por omissão de API da Specialist Fabric em M2-08.
- Deadline racing reaproveita o mesmo padrão da Specialist Fabric (M2-08): uma fonte de dados lenta é liberada no próprio `deadlineMs`, nunca no tempo real do provider.
- 10 testes novos em `tests/tool-adapters/crm-lite.test.mjs`: escopo de leitura não-PII, negação de PII por purpose, PII liberado para purposes autorizados, mistura de campo concedido e negado na mesma resposta, timeout, registro não encontrado, campo desconhecido negado, schema independente para `opportunity`, ausência estrutural de escrita, e isolamento de auditoria entre tenants.
- `pnpm lint`, `pnpm contracts:check`, `tsc --build` completo e `node scripts/test.mjs` (335 testes Node, 23 unittest Python) verdes.
- Nenhuma credencial real, produção, provider real, deploy ou migration remota foi acessado.

### 2026-07-15, M3-04 concluído

- `@axtro/tool-adapter-calendar` (`packages/tool-adapters/calendar/`): `proposeSlots` varre a janela solicitada em incrementos de `durationMinutes`, mescla os intervalos ocupados de todos os participantes e só oferece slots sem sobreposição; timezone é validada contra uma lista fechada (`SUPPORTED_TIMEZONES`) antes de qualquer cálculo, nunca inferida.
- `confirmSlot` exige que o slot selecionado tenha sido de fato oferecido na proposta (senão `unknown_slot`), reavalia conflito no momento da confirmação (disponibilidade pode ter mudado desde a proposta), e só escreve de verdade no `CalendarWriteSink` injetado quando `approved: true` **e** `dryRun: false` explícitos — o padrão é sempre `dryRun: true`, que nunca toca o sink.
- Idempotência por `idempotencyKey` por tenant: reenviar a mesma chave retorna exatamente o mesmo resultado já registrado, sem criar um segundo evento externo.
- 8 testes novos em `tests/tool-adapters/calendar.test.mjs`: timezone rejeitada e timezone aceita, conflito removendo apenas os slots sobrepostos, conflito surgido entre proposta e confirmação, dry-run padrão sem aprovação nem escrita, aprovação negada nunca escreve mesmo com `dryRun:false`, confirmação real com aprovação e `dryRun:false`, idempotência sem duplicar evento, proposta expirada e slot nunca oferecido.
- `pnpm lint`, `pnpm contracts:check`, `tsc --build` completo e `node scripts/test.mjs` (343 testes Node, 23 unittest Python) verdes.
- Nenhuma credencial real, produção, provider real, deploy ou migration remota foi acessado.

### 2026-07-15, M3-05 concluído

- `@axtro/tool-adapter-proposal` (`packages/tool-adapters/proposal/`): todo preço de linha vem de um `ReceiptPriceReference` já emitido ou de um `CatalogEntry` dentro da janela de validade no momento (`atMs`) — nunca de texto de modelo não confirmado. `isDryRun: true` é fixo no preview; o pacote não tem nenhum método de envio.
- Template deve estar `status: "active"`; todo `requiredInputs` do template precisa estar confirmado em `inputs` antes de qualquer cálculo, senão `missing_input` com a lista exata de campos faltantes.
- Desconto por linha nunca pode exceder `maxDiscountPercent` do catálogo do produto, mesmo quando o preço vem de um receipt (o teto de desconto continua sendo do catálogo atual, não do receipt antigo).
- 9 testes novos em `tests/tool-adapters/proposal.test.mjs`: preview válido precificado pelo catálogo, input faltante, catálogo expirado (stale), desconto não autorizado, desconto dentro do teto aplicado corretamente, precificação por receipt distinta do catálogo atual, template depreciado tratado como desconhecido, receipt inexistente rejeitado, e ausência estrutural de capacidade de envio.
- `pnpm lint`, `pnpm contracts:check`, `tsc --build` completo e `node scripts/test.mjs` (352 testes Node, 23 unittest Python) verdes.
- Nenhuma credencial real, produção, provider real, deploy ou migration remota foi acessado.

### 2026-07-15, M3-06 concluído

- `@axtro/handoff` (`packages/handoff/`): gerencia a proposta de handoff (pending/accepted/declined/timed_out/rolled_back), no máximo uma pendente por sessão, e delega a troca real de `active_presenter_id` a um `PresenterFloorChanger` injetável em vez de reimplementar CAS — reaproveita a garantia já provada do `presenter.changed` de M1-02 (D-V2-053) em vez de mexer novamente no reducer central de domínio nesta sessão.
- `requestHandoff` entrega o `HandoffContextPacket` completo (summary, objeções, receipts, ações abertas) ao `HandoffNotifier` assim que a proposta é criada — o humano vê o contexto antes de decidir aceitar.
- `acceptHandoff` só chama o floor changer uma vez; uma segunda chamada de accept sobre uma proposta já resolvida é um no-op de leitura, nunca uma segunda troca de piso. Rollback reverte exatamente uma vez e não pode ser chamado duas vezes sobre a mesma proposta.
- Uma segunda `requestHandoff` para a mesma sessão enquanto há uma pendente é rejeitada como `conflict_simultaneous_request` (nunca enfileirada ou mesclada); a proposta original permanece intacta e aceitável.
- 7 testes novos em `tests/handoff/handoff.test.mjs`: aceite muda o piso exatamente uma vez e entrega o pacote completo, timeout nunca toca o piso, rollback reverte uma vez e rejeita segunda tentativa, requisição simultânea rejeitada e depois aceita normalmente após resolução, rejeição do CAS surfaceada como `declined`, e apenas o humano-alvo pode aceitar.
- `pnpm lint`, `pnpm contracts:check`, `tsc --build` completo e `node scripts/test.mjs` (359 testes Node, 23 unittest Python) verdes.
- Nenhuma credencial real, produção, provider real, deploy ou migration remota foi acessado.

### 2026-07-15, M3-07 concluído

- `createSandboxFollowUpWorkflow` adicionado como módulo novo (`packages/workflows/src/sandbox-follow-up.ts`) exportado a partir do `index.ts` existente sem tocar em nenhuma linha do motor de workflow pós-call de M1-08 (1443 linhas, já congelado) — aditivo, não reescrita.
- O draft nunca é texto livre: `bodyReferences` referencia IDs de evidência confirmada (`confirmedFactIds`, `receiptIds`) que o chamador já tem, não conteúdo inventado pelo gerador.
- Padrão sandbox: sem `approvalPathEnabled: true` explícito, o `FollowUpSendSink` nunca é chamado (`send_denied_sandbox`). Uma falha transitória no gerador propaga para o chamador com o contador de tentativas já avançado; reexecutar `run()` com a mesma `idempotencyKey` é um retry real, não uma tentativa nova.
- Conclusão duplicada: reexecutar uma `idempotencyKey` já resolvida retorna o resultado idêntico anterior sem regenerar o draft nem reenviar.
- 5 testes novos em `tests/workflows/sandbox-follow-up.test.mjs`: draft vinculado à evidência, sandbox nunca envia sem aprovação explícita, retry após falha transitória sem duplicar, conclusão duplicada idempotente, e chaves de idempotência distintas produzindo drafts independentes.
- `pnpm lint`, `pnpm contracts:check`, `tsc --build` completo, `node scripts/test.mjs` (364 testes Node, 23 unittest Python, incluindo o suite original de M1-08 intacto), `pnpm m1:e2e` e `pnpm m2:e2e` verdes.
- Nenhuma credencial real, produção, provider real, deploy ou migration remota foi acessado.

### 2026-07-15, M3-08 concluído

- `@axtro/evaluation` pontua as 6 dimensões pedidas (factuality, policy, discovery, brevity, naturalness, handoff) sobre `GoldenScenario`s determinísticos; espelha o shape da tabela `evaluation_runs` (já existente desde M0, nunca consultada por código de aplicação até agora — mesmo padrão de M3-02 e agora M3-08).
- Gate crítico independente da média: qualquer violação de `policy` (claim proibida repetida por um turno do presenter) ou de `handoff` (handoff obrigatório que nunca ocorreu) força `status: "failed_critical_violation"`, mesmo que as outras 4 dimensões estejam perfeitas — a média nunca "compra de volta" uma violação crítica.
- `naturalness` nunca é fingida como avaliada por máquina: a evidência é sempre `"not_evaluated_requires_human_review"`, consistente com o Art. 11 (julgamento de modelo nunca é o único gate de segurança/factualidade).
- `evaluatorVersion` e evidência por dimensão são sempre gravados no resultado; apenas turnos do PRESENTER são avaliados quanto a claims proibidas — o texto do participante (incluindo tentativas de prompt injection) nunca conta como violação em si.
- 6 cenários golden em `tests/golden/scenarios.mjs` (en-US e pt-BR de discovery/preço, injeção de voz resistida e injeção de voz que falha, handoff obrigatório cumprido e handoff obrigatório perdido) e 8 testes em `tests/golden/evaluation.test.mjs`: determinismo entre execuções, cobertura completa de dimensão, injeção segura sem violação, injeção repetida falhando criticamente com a claim do participante nunca contada como violação do presenter, mesma pontuação estrutural entre pt-BR e en-US, handoff cumprido vs. perdido, versão e evidência sempre gravadas, e naturalness sempre marcada para revisão humana.
- `pnpm lint`, `pnpm contracts:check`, `tsc --build` completo e `node scripts/test.mjs` (372 testes Node, 23 unittest Python) verdes.
- Nenhuma credencial real, produção, provider real, deploy ou migration remota foi acessado.

### 2026-07-15, M3-09 concluído

- `packages/ui/src/opportunity-review.ts` é um módulo novo e aditivo; a única mudança no arquivo já existente do M1-09 (`operations-console.ts`) foi exportar `escapeHtml` (já testado, comportamento idêntico) em vez de reescrever escaping HTML do zero — risco mínimo sobre código já congelado.
- Reaproveita `renderEvidenceLabel` (já distingue receipt confirmado vs. hipótese não verificada) para hipóteses e receipts; toda citação do Knowledge Engine (M3-02) é marcada `data-trusted="false"` com o rótulo "Conteúdo recuperado, não confiável" — a mesma disciplina fato/hipótese/sugestão que o console já tinha, agora estendida a citações RAG e achados do avaliador (M3-08, com violações críticas marcadas `data-critical="true"`).
- Permissão: renderizar um modelo cujo `tenantId` difere do escopo autorizado do operador lança `OpportunityReviewPermissionError` antes de qualquer HTML ser produzido — nunca um render cross-tenant parcial.
- Retenção/redação: campos sensíveis (`sensitiveFields`) só entram no HTML quando `viewerHasPiiAccess === true`; sem essa permissão, o valor nunca chega à string de saída (omissão estrutural, não ocultação client-side). Todo campo passa por `escapeHtml`.
- 9 testes novos em `tests/ui/opportunity-review.test.mjs`: permissão cross-tenant rejeitada e mesma tenant aceita, redação com e sem PII, injeção de script/HTML sempre escapada, acessibilidade (lang, aria-label, sem script/onclick), distinção fato/hipótese/sugestão, achados críticos do avaliador marcados distintamente, e modelo malformado falha fechado.
- `pnpm lint`, `pnpm contracts:check`, `tsc --build` completo, `node scripts/test.mjs` (381 testes Node, 23 unittest Python, suite original de M1-09 intacta), `pnpm m1:e2e` e `pnpm m2:e2e` verdes.
- Nenhuma credencial real, produção, provider real, deploy ou migration remota foi acessado.

### 2026-07-15, M3-10 concluído (ferramenta) — piloto real fica pendente de gate humano

- `generatePilotGateReport` (`packages/evaluation/src/pilot-gate.ts`, exportado aditivamente do `index.ts` já existente) agrega chamadas revisadas em um relatório único: total revisado, violações críticas de policy ainda abertas, violações de tenancy ainda abertas, custo e qualidade por canal, e uma decisão fechada em três valores. `requiresHumanApprovalForCustomerBeta` é sempre `true` — nenhuma execução desta ferramenta jamais aprova um beta.
- Amostra mínima de 20 chamadas é obrigatória (`meetsMinimumSample`); uma violação crítica ou de tenancy só deixa de bloquear quando explicitamente marcada `resolved: true`; `callId` duplicado é rejeitado (cada chamada revisada precisa ser distinta).
- `artifacts/m3/evidence.json` roda a ferramenta contra 20 registros **sintéticos e determinísticos**, marcados `data_provenance: "FAKE_SYNTHETIC_DATA_NOT_A_REAL_INTERNAL_PILOT"`. `artifacts/m3/README.md` documenta explicitamente o que essa evidência prova (a ferramenta funciona) e o que ela não prova (nenhuma chamada real aconteceu) — consistente com D-V2-049 e com `HANDOFF_TO_CODEX.md`: M3 não pode declarar pronto para cliente sem auditoria, bake-off de provider, segurança, privacidade e aprovação de lançamento reais.
- 8 testes novos em `tests/golden/pilot-gate.test.mjs`: amostra insuficiente sempre bloqueia, amostra limpa fica pronta para revisão humana (nunca auto-aprovada), violação crítica aberta bloqueia, violação resolvida deixa de bloquear, violação de tenancy aberta bloqueia mesmo com avaliações limpas, custo/qualidade por canal calculados independentemente (canal sem chamada é omitido, não preenchido com zero), `callId` duplicado rejeitado, e a decisão nunca inclui um valor de aprovação de beta.
- `pnpm lint`, `pnpm contracts:check`, `tsc --build` completo, `node scripts/test.mjs` (389 testes Node, 23 unittest Python), `pnpm m1:e2e`, `pnpm m2:e2e` e `python3 scripts/validate_all.py` (9 validadores) verdes.
- Nenhuma credencial real, produção, provider real, deploy, migration remota ou chamada interna real foi acessada ou executada. **M3-10 permanece formalmente aberto quanto ao piloto real e ao bake-off** — só uma sessão com gate humano pode fechá-lo de fato.

### 2026-07-15, gate de release M3 completo

- Pipeline completa executada e verde ao final da sessão: `pnpm install --frozen-lockfile`, `uv sync --locked --all-groups`, `pnpm lint`, `pnpm contracts:check`, `pnpm typecheck`, `pnpm test` (389 Node + 23 unittest Python), `uv run pytest` (23), `pnpm build`, `pnpm db:test`, `pnpm db:rls` (ambos com `LC_ALL=C LANG=C` neste ambiente), `pnpm m1:e2e` (2, M1 continua verde), `pnpm m2:e2e` (7, M2 continua verde), `python3 scripts/validate_all.py` (9 validadores) e `git diff --check`.
- `FINAL_AUDIT_REPORT.md` atualizado para cobrir M0, M1, M2 e M3 juntos: veredito, implementação auditada, garantias arquiteturais, riscos aceitos e próxima sequência agora refletem os dez pacotes/módulos novos de M3 e deixam M3-10 explicitamente marcado como "ferramenta pronta, piloto real pendente".
- Working tree limpo, 10 commits de M3 (M3-01 a M3-10) mais este, todos com mensagem convencional e coautoria registrada.
- **M3 Sales Closer Alpha está concluído no escopo autônomo desta sessão**: M3-01 a M3-09 fake-first/dry-run completos e testados; M3-10 entrega a ferramenta de gate mas não fabrica piloto real, exatamente como D-V2-049 e D-V2-054 documentam.

### 2026-07-16, fase de produto: Supabase real + portal Next.js com login

- Escopo desta fase (fora do task graph de M0-M3, decidido em conversa com o usuário): sistema visual no ar com autenticação real, mantendo o mandato fake-first restrito a M0-M3. Três decisões confirmadas antes de começar: frontend novo do zero (não evoluir `apps/web`), provider de auth gerenciado (Supabase Auth), e pausa obrigatória antes de qualquer conta/infra real paga — cumprida via `AskUserQuestion` antes de criar o projeto Supabase (US$10/mês, aprovado explicitamente).
- Projeto Supabase real criado (`digital-human-os`, org Axtro AI, `us-east-1`, id `ovctadcrvnfpgxzplupp`) e as 11 migrations portáveis de `database/migrations/` aplicadas nele sem alteração — mesmo contrato de schema local e hospedado.
- RLS de leitura pública aplicado diretamente no projeto Supabase (fora de `database/migrations/`) para as 3 tabelas de catálogo sem `tenant_id` (`schema_registry`, `provider_catalog`, `region_policy_catalog`), que o advisor de segurança da Supabase acusou como expostas via PostgREST à role `anon`. Registrado como D-V2-055: não virou migration portátil porque o shape (policy `SELECT`-only, sem `tenant_id`) quebraria o fingerprint exato de `CATALOG_ASSERTION_SQL` em `packages/database/src/migrations.ts`, que só reconhece o padrão `tenant_isolation`/`FOR ALL` das tabelas com `tenant_id`.
- `apps/portal` (novo app `@axtro/portal`, Next.js 16 + React 19) criado fora do grafo de `tsc --build` do monorepo (Next.js compila sozinho via `next build`/`next dev`) mas dentro do `pnpm-workspace.yaml`. Usa `@supabase/ssr` com os três clientes padrão (browser, server, proxy/middleware) para sessão real: signup, login, logout, callback de confirmação de e-mail, e `/dashboard` protegido que redireciona para `/login` sem sessão válida.
- Testado de ponta a ponta no navegador contra o projeto Supabase real: signup criou de fato um usuário em `auth.users` (confirmado via SQL, depois removido por ser só teste), tela de confirmação de e-mail renderizou corretamente, e acesso direto a `/dashboard` sem sessão foi bloqueado pelo proxy e redirecionado para `/login`.
- Dois bugs pré-existentes descobertos e corrigidos como efeito colateral direto de adicionar o novo app (não relacionados ao produto em si): `scripts/lint.mjs` não excluía `.next/` da varredura de whitespace (adicionado à lista ao lado de `dist`/`node_modules`); `scripts/dependency_scan.py` confundia campos aninhados (`peerDependencies`, `peerDependenciesMeta`) dentro do bloco `packages:` do `pnpm-lock.yaml` com entradas de pacote de nível superior — nunca disparou antes porque nenhuma dependência anterior declarava `peerDependencies` ali. Regex corrigida e teste de regressão adicionado em `tests/python/test_dependency_scan.py`.
- `pnpm lint`, `tsc --build` completo, `node scripts/test.mjs` (389 Node + 24 unittest Python, incluindo o teste de regressão novo) e `pnpm --filter @axtro/portal run build`/`typecheck` verdes.
- Autenticação de usuário humano para chamadas internas ao API tenant-scoped (estender `packages/auth` além de `identityKind: "service"`) foi deliberadamente **não** feita nesta fase — `packages/auth`'s M0-09 já documenta isso como pendente de "um contrato público baseado em claim" desenhado com cuidado, não algo para encaixar às pressas. O portal hoje autentica usuários via Supabase; ligar essa sessão ao contexto de tenant RLS do core fica para uma sessão dedicada.

### 2026-07-16, mapeamento usuário → tenant e provisionamento self-serve

- Decisão de produto confirmada com o usuário via `AskUserQuestion` antes de implementar: cadastro no portal cria o próprio tenant do usuário (self-serve), não um fluxo de convite por admin — registrado em ADR-032 e D-V2-056.
- `public.user_tenant_memberships` (Supabase-only, referencia `auth.users`, fora de `database/migrations/` pela mesma razão de D-V2-055) mapeia usuário → tenant + `actor_id` (UUIDv7 gerado em TypeScript, nunca pelo banco) + papel (`tenant_admin`/`tenant_operator`).
- `public.custom_access_token_hook` (Supabase Auth Hook, publicado mas **não habilitado** — ativar exige o dashboard, fora do alcance das ferramentas MCP desta sessão) injeta `tenant_id`/`actor_id`/`tenant_role` em `app_metadata` no JWT a partir dessa tabela.
- `public.provision_self_serve_tenant` (RPC `SECURITY DEFINER`, idempotente) cria `tenants`+`tenant_settings`+`user_tenant_memberships` usando `auth.uid()` da própria sessão do usuário — sem precisar da chave `service_role`, que fica reservada pro fim da fase por pedido explícito do usuário. `apps/portal`'s `DashboardLayout` chama essa RPC a cada carregamento autenticado.
- `packages/auth` ganhou `SupabaseSessionIdentityVerifier` (verifica JWT via JWKS remota do próprio projeto Supabase, `jose`, zero segredo compartilhado no código) e `resolveAuthorizedUserRequestContext` — função **nova**, não uma modificação de `resolveAuthorizedRequestContext` (M0-09, síncrona, só-serviço, com teste próprio que trava esse limite: "M0 rejects a tenant header selector for user identities"). `apps/api` ainda não consome isso — não há chamador real ainda, então a integração fica para quando existir.
- Testado de ponta a ponta contra o Supabase real: signup → confirmação de e-mail via SQL (sem clicar link real) → login → RPC de provisionamento → `tenants`/`tenant_settings`/`user_tenant_memberships` criados corretamente com UUIDv7 válido, badge do tenant visível no dashboard, reload confirma idempotência (mesmo tenant, não duplica). Achei e corrigi na hora um bug real descoberto pelo teste: a role `authenticated` não tinha `USAGE` no schema `app`, então nem conseguia resolver o tipo dos parâmetros da RPC.
- Mais dois bugs pré-existentes achados como efeito colateral (mesmo padrão de sessão anterior — dependências novas expondo varreduras que nunca tinham sido exercitadas): `BEARER_PATTERN` em `packages/auth` limitava o token a 256 caracteres (dimensionado pra token de dev curto, rejeitava um JWT real de verdade); `scripts/docs_qa.py` varria `node_modules/**/*.md` procurando link quebrado e claim proibida — nunca tinha aparecido porque não havia dependência JS com Markdown vendorizado antes do portal. Ambos corrigidos com teste de regressão.
- 4 testes novos em `tests/auth/supabase-session.test.mjs` (JWKS local via servidor HTTP efêmero + par de chaves ES256 real, não mockado): claim de `tenant_admin` resolve o tenant/actor/escopos exatos, `tenant_operator` resolve escopo mais restrito, assinatura forjada/issuer errado/token expirado/claims ausentes ou papel desconhecido falham fechado com `AuthenticationError`, URL do projeto malformada rejeitada e loopback http aceito só para hostnames locais. 2 testes novos em `tests/python/test_docs_qa.py`.
- `pnpm lint`, `tsc --build` completo, `node scripts/test.mjs` (393 Node + 26 unittest Python), `python3 scripts/validate_all.py` (9 validadores) e `pnpm --filter @axtro/portal run build`/`typecheck` verdes.

### 2026-07-24, SEO-AEO-01 concluído

- Landing pública adaptada ao Axtro Digital Human OS com copy de vendas, casos de uso para vendas, onboarding e customer success, FAQ visível e disclosure de IA preservado.
- SEO e AEO adicionados com metadata por rota, canonical, Open Graph dinâmico, Twitter card, JSON-LD de organização, site, software e FAQ, `robots.txt`, `sitemap.xml`, `llms.txt` e `llms-full.txt`.
- Compartilhamento e PWA adicionados com manifest, ícones PNG derivados da marca Axtro, apple touch icon e tema visual coerente.
- Rotas privadas e de autenticação recebem noindex ou ficam fora do sitemap. O middleware também libera as superfícies técnicas públicas depois da correção encontrada pelo smoke test.
- Dashboard ganhou prontidão operacional baseada em tenant, agentes e fontes de conhecimento reais, com próximo passo contextual e barra de progresso acessível.
- Validação local: `pnpm lint`, `pnpm --filter @axtro/portal run typecheck`, `pnpm --filter @axtro/portal run build`, `pnpm test` com 426 Node e 26 Python, `python3 scripts/validate_all.py` com 9 validadores e `git diff --check`.
- Publicação: Railway deployment `c0f98be9-c3ad-4084-b24d-f69dd2332c35` concluído com sucesso. Smoke test público verde em `/`, `/robots.txt`, `/sitemap.xml`, `/manifest.json`, `/opengraph-image` e `/api/health`.
- Nenhum claim, texto ou identidade da Raízes Finance foi levado ao produto Axtro. Decisão registrada em D-V2-077.

### 2026-07-24, T8 (rate card de custos) concluído — execução autônoma

- `TASKS.md` reclassificou T8 de "bloqueado, depende de números do Fernando" para desbloqueável com preços PÚBLICOS de tabela (não taxa negociada) — decisão autônoma explicitamente permitida pelo Fernando ("autonomia total para decisões").
- Preços confirmados via busca + fonte primária: OpenRouter Claude Haiku 4.5 (US$1/US$5 por 1M tokens entrada/saída — openrouter.ai/anthropic/claude-haiku-4.5), OpenRouter text-embedding-3-small (US$0,02/1M entrada), Tavus (piso de US$0,175/conversa, derivado do mínimo de cobrança de 30s a US$0,35/min — ponto médio do overage Starter/Growth, tavus.io/blog/conversational-ai-pricing).
- Supabase-only 0017 aplicada no live: `portal_log_ai_usage` calcula `unit_cost_usd`/`amount_usd` reais a partir do input/output exato de cada chamada (a assinatura da RPC não mudou); `portal_log_video_usage` corrige `source` de `'measured'` para `'estimated'` (honestidade — não medimos duração real); `portal_usage_summary` soma custo de IA exato + piso de vídeo, mantidos SEPARADOS na resposta.
- Painel "Uso de IA" no dashboard ganhou 4º tile ("Custo estimado hoje"), custo de 7 dias e valor por linha de serviço, todos em US$ com nota explícita de que é estimativa de tabela, não a fatura real.
- Testado ao vivo: log de 1000 tokens de entrada + 500 de saída (`portal.agent_preview`) retornou `amount_usd: 0.00349995` — bate a conta manual (0,001 + 0,0025 = 0,0035, diferença de arredondamento irrelevante). Fontes já ingeridas antes da migration mantêm `amount_usd=0` (histórico nunca é reescrito).
- Novo teste e2e (`portal.spec.ts`) verifica o tile "Custo estimado hoje" e a nota de rodapé no dashboard logado; suite completa 6/6 verde com Chrome do sistema.
- **Achado durante a execução**: uma sessão concorrente já havia implementado, validado e implantado o SEO-AEO-01 (D-V2-077) diretamente no working tree, sem commitar. Commitado à parte, com atribuição correta (ver commit `feat(seo): ...`), antes deste commit de T8 — nenhum trabalho de nenhuma das duas sessões foi perdido ou sobrescrito.
- Validação: `pnpm lint`, `pnpm --filter @axtro/portal run typecheck`, `pnpm --filter @axtro/portal run build`, `pnpm test` (426 Node + 26 Python), `python3 scripts/validate_all.py` (9 validadores) verdes.

## Próxima ação

Nenhuma tarefa de M0-M3 pendente dentro do escopo autorizado. Para a fase de
produto: (1) alguém com acesso ao dashboard Supabase precisa habilitar o
Custom Access Token Hook (`Authentication > Hooks`) — a função já está
publicada, só falta esse clique (D-V2-057); (2) expandir o portal com as
telas operacionais reais (hoje é só o esqueleto de auth); (3) quando o
portal precisar chamar `apps/api` em nome de um usuário logado, ligar
`resolveAuthorizedUserRequestContext` nesse ponto — não antes, não
especulativamente; (4) só então, com o sistema visual e logado funcionando
de ponta a ponta, reunir as chaves de API reais por provider via Doppler, a
pedido explícito do usuário. Deploy/hosting real segue pendente de aviso
prévio, como já combinado. Separadamente, pendente de decisão humana:
bake-off credenciado de provider e piloto interno real de M3-10.

### 2026-07-17, VISUAL-01 concluído

- Landing pública refeita em `apps/portal/src/app/page.tsx` com narrativa de conversão, hero visual, CTAs para demo e signup, seções de vendas/onboarding/customer success, fluxo de governança e CTA final.
- Sistema visual premium aplicado em `apps/portal/src/app/globals.css`: obsidiana, indigo, violeta e coral, grid ambiental, cards com hover, botões com sheen, reveal on scroll, infográfico orbital e responsividade mobile.
- Asset autoral de digital human adicionado em `apps/portal/public/assets/digital-human/hero-presenter.png` e usado também na imagem de compartilhamento da landing.
- Componente `apps/portal/src/components/reveal-on-scroll.tsx` implementa entrada progressiva por viewport e respeita `prefers-reduced-motion`.
- Workspace interno recebeu continuidade visual em `apps/portal/src/app/(app)/dashboard/page.tsx`, com command surface, métricas com acentos por categoria e hierarquia operacional preservando os dados reais do tenant demo.
- Validação: `pnpm lint`, `pnpm build`, `pnpm --filter @axtro/portal run typecheck`, `pnpm --filter @axtro/portal run build` e `git diff --check` verdes; validação visual no navegador em desktop, mobile 390px, landing completa e dashboard autenticado.
- Nenhuma mudança em contratos, auth, isolamento de tenant, providers ou migrations. Nenhuma credencial foi adicionada ao repositório.

### 2026-07-19, Cérebro Método Silva — a IA closer treinada no método (D-V2-073/074)

- **Aquisição da IP**: os 38 manuais da Coleção Método Silva v3.0 baixados do Drive do Fernando para `knowledge-vault/metodo-silva/` (gitignored — repo público) com manifesto `SHA256SUMS`, fechando a pendência de conteúdo de `PENDENCIAS_EXTERNAS.md`. Três subagentes destilaram o método em extratos estruturados (`knowledge-vault/brain/`): as 6 fases da Reunião Silva, o framework S.I.L.V.A. de qualificação, E.A.R.C. para objeções (com as 12 objeções universais e frases-modelo literais), técnicas e armas de fechamento, guia de voz, e — decisivo — o próprio "System Prompt Silva" em 9 blocos e os 10 Princípios do Agente que o Manual de Agentes Autônomos prescreve para construir o Closer IA.
- **Cérebro no portal**: `apps/portal/src/lib/brain/metodo-silva.ts` gera os prompts do chat (2 mensagens system respeitando o cap de 4000 chars do adapter) e das personas de vídeo (pt/en, ~7-8k chars, abaixo do teto de conforto de latência do provider), seguindo os 9 blocos do método; `agent-preview.ts` passou a usá-lo. Percepção tratada como HIPÓTESE comportamental, nunca leitura de emoção (Constituição preservada).
- **RAG real do método**: 10 manuais de venda ingeridos como fontes do tenant demo pela pipeline existente (438 chunks, 115k tokens de embedding no ledger); Caso Modelo ContaLeve excluído de propósito (preços fictícios não podem virar "fatos da conta"). Busca comprovada: "tá caro" → ficha E.A.R.C. do Kit 05 no topo.
- **Personas renovadas**: Aurora e Amanda PATCHadas com o cérebro preservando voz/STT (playbook Ecoloop da Amanda mantido como apêndice; backups no cofre); Rafaela ganhou persona própria `p8966676f4d2` (Anna + voz ElevenLabs + raven-1 + interrupção alta + `tavus-glm-4.7`), registrada em `database/supabase-only/0013` (aplicada no live via Management API). 5 consultas de percepção ambiente por idioma (engajamento, confusão, ceticismo, vontade de falar, segunda pessoa no quadro).
- **Modo apresentação**: tools `next_slide`/`previous_slide`/`go_to_slide` registradas no provider e anexadas às 3 personas; `startPresentationConversation` monta deck estrutural no arco da Reunião Silva (slides SEM números — fatos só da boca da agente via digest de conhecimento) e a sala custom `presentation-room.tsx` (`@daily-co/daily-js@0.91.0` pinada) renderiza vídeo + palco de slides, escuta `conversation.tool_call` no data channel e devolve `conversation.tool_result` — a agente avança os próprios slides enquanto conduz a venda.
- **E2e**: chat por API com o pipeline real (mesmos RPCs + modelo) respondeu objeção de preço com E.A.R.C. literal do método citando a tabela de preços da conta; conversa Tavus real criada (`c1187a82019d14ac`), Rafaela vista ao vivo na sala Daily com a persona nova e depois encerrada via API — créditos Tavus voltaram a funcionar (limite de D-V2-067 não se reproduziu).
- Pipeline: `pnpm lint`, dependency scan, `pnpm test` (418 Node + 26 Python, incluindo 9 testes novos do cérebro/deck em `tests/portal/`), typecheck e build do portal, `python3 scripts/validate_all.py` (9 validadores) e secret scan verdes.
- Pendente de gate humano: teste de UI logado (login por formulário é vedado à sessão autônoma) e uma apresentação completa com microfone; merge do PR → deploy Railway.

### 2026-07-19, percepção emocional profunda — emenda constitucional (ADR-035, D-V2-075)

- Por decisão explícita do Fernando, a leitura emocional deixou de ser proibição e virou capacidade CENTRAL: o Art. 4 da Constituição foi reescrito via ADR-035 ("Percepção emocional profunda é capacidade central"), com atualização do princípio 5 do README e da proibição correspondente no AGENTS.md — mudança constitucional com ADR e testes no mesmo PR, como o próprio repo exige.
- O cérebro (`metodo-silva.ts`) agora instrui MAESTRIA de leitura: emoção por trás da fala, micro-expressões, linguagem corporal e sinais de compra decidem o que perguntar, o que responder, quando aprofundar e quando fechar — incluindo nomear a leitura com tato ("sinto que esse ponto te preocupou — me conta o que pesou?"). As `ambient_awareness_queries` do raven-1 subiram de 5 para 8 por idioma (emoção expressa, micro-expressões do último ponto, linguagem corporal, confusão, sinais de compra, vontade de falar, distração, segunda pessoa no quadro).
- Linhas vermelhas mantidas (protegem a operação sem conflitar com o produto): identificação biométrica oculta, inferência de atributo protegido, alegação de detecção de mentira e diagnóstico médico/psicológico. A leitura é declarada via disclosure (Art. 6) e governada pelas finalidades de consentimento (Art. 5); DPIA/validação por jurisdição segue em PENDENCIAS_EXTERNAS com relevância aumentada.
- Aplicado AO VIVO nas 3 personas Tavus (Aurora 7.943 chars, Amanda 8.750, Rafaela 7.748 — todas com 8 queries). Testes de "nunca ler emoção" substituídos por testes que garantem a presença da maestria E a permanência das 4 proibições; PR #16 (cérebro) mergeado no início desta sessão a pedido do Fernando.

### 2026-07-27, M4-01 — núcleo do cérebro customizado extraído (D-V2-080)

- Depois do spike D-V2-076 (confirmou por documentação oficial que a percepção do raven-1 é injetada automaticamente no contexto do LLM da persona, e que trocar o LLM da persona por um endpoint próprio via `layers.llm.base_url` é suportado), o Fernando autorizou seguir com a construção do cérebro de verdade em looping autônomo.
- `runBrainChatCompletion` extraído de `agent-preview.ts` para `apps/portal/src/lib/brain/chat-completion-core.ts`: mesma composição (Método Silva chat/vídeo + bloco de fontes RAG), com geração e log de uso injetados por porta — o núcleo não importa Supabase, HTTP nem provider diretamente, então serve tanto o sandbox de chat quanto (a partir de M4-04) o endpoint que o Tavus vai chamar.
- Nova capacidade: bloco de PERCEPÇÃO como mensagem system separada, rotulada e limitada (1800 chars), explicitamente descrita como evidência de terceiro que nunca decide preço/política (Art. 15) — pronta para receber as tags do raven-1 assim que M4-02 as extrair da requisição do Tavus.
- Corrigido durante os testes: o guard de tamanho de histórico herdado do sandbox (`MAX_HISTORY_TURNS*2`) rejeitava com erro qualquer conversa longa — errado para o caminho Tavus, onde o histórico chega pronto e fora do nosso controle. Trocado por um teto de sanidade generoso (500 entradas) com corte por orçamento dinâmico (nunca > 24 mensagens, o teto do adapter OpenRouter) em vez de rejeição.
- `agent-preview.ts` refatorado para usar o núcleo — comportamento e testes de UI existentes preservados (sem alteração de resposta).
- `apps/portal/tsconfig.json` ganhou `allowImportingTsExtensions: true` (já elegível, `noEmit` true) para permitir que o núcleo importe `metodo-silva.ts` com extensão explícita — necessário para o Node nativo (sem bundler) executar o módulo diretamente no teste, no mesmo padrão de `tests/portal/metodo-silva-brain.test.mjs`.
- M4 registrado em `backlog/MVP_TASK_GRAPH.yaml` (4 tarefas: M4-01 a M4-04) — M4-03/M4-04 tocam produção real (persona ao vivo, segredo por agente) e ficam para gate humano antes de qualquer rewiring da persona em produção.
- Pipeline: `pnpm test` (437 Node + 26 Python, 11 testes novos em `tests/portal/brain-chat-completion-core.test.mjs`), `pnpm typecheck`, `pnpm lint`, `python3 scripts/validate_all.py` (9 validadores) verdes.
