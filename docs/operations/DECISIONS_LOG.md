# Decision Log V2

| ID | Data | Decisão | Motivo | Reversibilidade |
|---|---|---|---|---|
| D-V2-001 | 2026-07-14 | Digital Human OS como plataforma; Sales Closer como Role Pack | evitar acoplamento do kernel a vendas | alta |
| D-V2-002 | 2026-07-14 | Codex-first handoff com AGENTS.md e task graph | Claude sem créditos; início imediato no Codex | alta |
| D-V2-003 | 2026-07-14 | Monólito modular no Control Plane | velocidade sem perder fronteiras | média |
| D-V2-004 | 2026-07-14 | Realtime worker separado por runtime | isolamento de latência e falhas | média |
| D-V2-005 | 2026-07-14 | Provider bake-off antes de escolher avatar definitivo | evitar lock-in e escolha por marketing | alta |
| D-V2-006 | 2026-07-14 | Pipeline modular como baseline e S2S como implementação paralela | controle, comparação e fallback | média |
| D-V2-007 | 2026-07-14 | PerceptionSignal e DerivedHypothesis com TTL | evitar leitura da mente e estado eterno | baixa |
| D-V2-008 | 2026-07-14 | InteractionQualityState multidimensional | explicabilidade superior a trust score único | média |
| D-V2-009 | 2026-07-14 | Eventos separados de workflows duráveis | retry, timers e compensação não pertencem ao event bus | média |
| D-V2-010 | 2026-07-14 | UUIDv7 gerado pela aplicação | ordenação temporal sem depender da versão do Postgres | média |
| D-V2-011 | 2026-07-14 | Vector sem dimensão no walking skeleton, sem ANN | manter provider bake-off e evitar índice incorreto precoce | média |
| D-V2-012 | 2026-07-14 | M0-M2 podem usar fakes sem credenciais | permitir desenvolvimento imediato e determinístico | alta |
| D-V2-013 | 2026-07-14 | Compilador TypeScript e tipos de Node são dependências somente de desenvolvimento, fixadas no lockfile | manter lint, typecheck e build reproduzíveis sem introduzir SDK de provider ou dependência de produção | alta |
| D-V2-014 | 2026-07-14 | Validadores Python e pytest ficam no grupo de desenvolvimento fixado por uv.lock | a CI e a execução local passam a usar os mesmos validadores e fixtures negativos sem dependências de produção | alta |
| D-V2-015 | 2026-07-14 | Workspace Python requer 3.10 ou superior | jsonschema 4.26.0 é o validador normativo e exige Python 3.10+, enquanto o gate documental mantém fallback para o Python 3.9 local | alta |
| D-V2-016 | 2026-07-14 | Tipos de contrato são gerados por script Python determinístico e carregam origem, versão e hash do schema | impede cópias manuais concorrentes e torna drift bloqueante na CI sem adicionar gerador externo | alta |
| D-V2-017 | 2026-07-14 | IDs e contextos de tenant e trace são value objects estritos e imutáveis no domínio | torna UUIDv7, actor type, correlação e classificação explícitos nas bordas, sem depender de framework, banco ou SDK | alta |
| D-V2-018 | 2026-07-14 | Reducers iniciam consentimento e disclosure em `pending`, exigem eventos dedicados para ativação e revalidam snapshots reidratados | impede que criação ou snapshot forjado burle disclosure, consentimento, tenancy ou One Mouth antes de produzir estado autoritativo | alta |
| D-V2-019 | 2026-07-14 | Configuração de runtime aceita somente modo `fake`, valida antes do startup e propaga `SecretHandle` opaco apenas ao adapter; o fake broker é vinculado ao contexto autorizado e exige escopo por purpose | mantém M0-M1 sem credenciais ou egressos, evita segredo em logs e prepara M0-09 para criar contexto somente a partir de claims verificadas | alta |
| D-V2-020 | 2026-07-14 | Migrations usam runner TypeScript via `psql` local, checksum receipt e cluster efêmero PostgreSQL 17 com pgvector para integração; nenhum ORM ou client foi escolhido | valida o contrato SQL real sem banco remoto ou credencial, preserva SQL normativo e adia `pg` ou Drizzle até existir um repositório que exija client | alta |
| D-V2-021 | 2026-07-14 | Runner local exige URL loopback sem senha com opt-in explícito, inicia filhos com allowlist mínima e GSS desabilitado, serializa apply/read/drift por identidade normalizada e valida mapeamentos RLS, triggers, UUIDv7 e funções de segurança de forma estrutural | evita túnel local acidental, credencial implícita e aprovação de drift que preserve somente contagens | alta |
| D-V2-022 | 2026-07-14 | Relações de presenter, turn e handoff passam a referenciar participante da mesma sessão; exclusão física de sessão com custo ou avaliação passa a ser restrita | reforça One Mouth e tenancy relacional sem reescrever migrations já aplicadas, sem quebrar a imutabilidade de eventos financeiros e sem perder atribuição de tenant | média |
| D-V2-023 | 2026-07-14 | Auth fake usa registry determinística server-side somente em development e test, com allowlist M0 de scopes e finalidades; bearer de service identity e `X-Tenant-Id` resolvem grant explícito antes de contexto transacional | permite M0 sem OIDC ou credenciais reais, bloqueia confused deputy e grants amplos, mantém users sem seleção implícita por header e deixa staging, canary e produção fechados para a implementação fake | alta |
| D-V2-024 | 2026-07-14 | M0 usa núcleo de telemetria compatível com OpenTelemetry, sinks locais injetáveis, carrier W3C estrito somente em fronteiras internas confiáveis e registros de atributos fechados; a API pública sempre inicia trace e correlação novas | permite propagação entre API, worker e provider fake sem SDK, backend, baggage ou dados de tenant no carrier, impede que headers ou payloads públicos controlem a linhagem ou vazem para logs e reduz referências de provider a valores locais criados pelo runtime | alta |
