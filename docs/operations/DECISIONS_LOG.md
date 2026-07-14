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
