# Mapa de migração V1 para V2

**Data da auditoria:** 2026-07-14  
**Fonte auditada:** pacote `files (13).zip`, preservado em `legacy/v1/`  
**Inventário:** 62 arquivos, todos listados abaixo e verificados por `legacy/V1_FILE_INVENTORY.sha256`.

## Correção da evidência do retorno parcial do Fable 5

O pacote `files (14).zip` continha somente três arquivos e foi preservado em `legacy/fable-v2-partial/`. Nenhum dos dois ZIPs recebidos nesta conversa continha PDFs. Portanto, a afirmação do retorno parcial de que oito PDFs do Método Silva estavam confirmados em outro filesystem não é usada como evidência neste pacote. A ingestão desses materiais permanece em `PENDENCIAS_EXTERNAS.md` até que os arquivos sejam fornecidos, licenciados e hasheados.

## Auditoria reproduzida sobre a V1

| Checagem | Resultado verificado | Tratamento V2 |
|---|---|---|
| Arquivos V1 | 62 | Todos preservados e mapeados individualmente |
| PDFs dentro do pacote V1 | 0 | Dependência externa explícita |
| Schemas V1 | 5 JSON válidos | Substituídos por 31 schemas Draft 2020-12 |
| Objetos internos sem `additionalProperties: false` | 22 | V2 fecha todos os objetos e inclui exemplo positivo e negativo |
| UUID | V1 declarava UUIDv7, mas usava `gen_random_uuid()` | V2 exige UUIDv7 gerado na aplicação |
| Vetores | V1 fixava dimensão 1536 | V2 registra provider, model e dimension |
| Referências operacionais a arquivos ausentes | `PROGRESS.md`, `RELEASE_MVP.md` e caminho incorreto para pendências | V2 inclui `PROGRESS.md`, playbooks atuais e QA automatizado |

## Matriz completa

| # | Arquivo V1 | Decisão | Destino V2 | Motivo |
|---:|---|---|---|---|
| 1 | `PENDENCIAS_EXTERNAS.md` | atualizado | `PENDENCIAS_EXTERNAS.md` | Credenciais, conteúdo ausente, jurídico e provider bake-off foram separados do trabalho implementável com fakes. |
| 2 | `README.md` | reescrito | `README.md` | Visão e entrada mudaram de Sales AI para Digital Human OS com Sales Closer como Role Pack. |
| 3 | `docs/adr/ADR-001-monorepo-turborepo.md` | substituído | `docs/adr/ADR-001-modular-monorepo.md` | Mantém monorepo, mas evita fixar ferramenta antes do bootstrap e define fronteiras modulares. |
| 4 | `docs/adr/ADR-002-realtime-dual-mode.md` | atualizado | `docs/adr/ADR-002-dual-mode-realtime.md` | Preserva speech-to-speech e pipeline modular sob o mesmo contrato. |
| 5 | `docs/adr/ADR-003-livekit-infra.md` | atualizado | `docs/adr/ADR-003-livekit-native-room.md; docs/architecture/MEETING_GATEWAY.md` | LiveKit é boundary inicial, não dependência irreversível. |
| 6 | `docs/adr/ADR-004-model-gateway.md` | absorvido | `docs/architecture/MODEL_GATEWAY.md; docs/adr/ADR-012-provider-bakeoff.md` | Roteamento e substituição de modelos ficam no gateway e no benchmark de providers. |
| 7 | `docs/adr/ADR-005-avatar-tavus.md` | substituído | `docs/architecture/AVATAR_AND_VOICE_ARCHITECTURE.md; docs/adr/ADR-012-provider-bakeoff.md` | Remove vencedor permanente antes de testes reais. |
| 8 | `docs/adr/ADR-006-meeting-bot-recall.md` | substituído | `docs/architecture/MEETING_GATEWAY.md; docs/operations/CAPABILITY_DEGRADATION_MATRIX.md; docs/adr/ADR-012-provider-bakeoff.md` | Recall permanece candidato atrás de adapter e capability matrix. |
| 9 | `docs/adr/ADR-007-multitenancy-rls.md` | atualizado | `docs/adr/ADR-009-multitenancy-rls.md; docs/architecture/MULTI_TENANCY.md` | RLS forçado, identidades de serviço e FKs tenant-safe foram explicitados. |
| 10 | `docs/adr/ADR-008-events-redis-outbox.md` | dividido | `docs/adr/ADR-011-events-workflows.md; docs/architecture/EVENT_ARCHITECTURE.md; docs/architecture/DURABLE_WORKFLOW_ARCHITECTURE.md` | Event bus e workflow durável não são o mesmo mecanismo. |
| 11 | `docs/adr/ADR-009-memory-architecture.md` | atualizado | `docs/adr/ADR-005-session-state-timeline.md; docs/architecture/MEMORY_ARCHITECTURE.md` | Estado estruturado e timeline append-only passam a ser fontes de verdade. |
| 12 | `docs/adr/ADR-010-tool-security.md` | atualizado | `docs/adr/ADR-010-action-runtime-receipts.md; docs/architecture/ACTION_AND_TOOL_RUNTIME.md` | Fluxo formal ActionIntent, PolicyDecision e Receipt. |
| 13 | `docs/adr/ADR-011-handoff-protocol.md` | atualizado | `docs/adr/ADR-004-one-mouth-floor.md; contracts/schemas/handoff_packet.schema.json` | Handoff usa troca atômica de presenter e pacote tipado. |
| 14 | `docs/adr/ADR-012-axtro-separation.md` | atualizado | `docs/adr/ADR-008-axtro-control-plane.md; docs/architecture/AXTRO_AGENT_CONTROL_PLANE.md` | Daemon continua fora do caminho crítico de áudio. |
| 15 | `docs/adr/ADR-013-data-retention.md` | atualizado | `docs/adr/ADR-016-data-retention-deletion.md; database/deletion-graph.md` | Retenção por finalidade e deleção verificável. |
| 16 | `docs/adr/ADR-014-observability-otel.md` | atualizado | `docs/adr/ADR-017-observability-otel.md; docs/operations/OBSERVABILITY.md` | Telemetria correlaciona latência, segurança, qualidade e custo. |
| 17 | `docs/adr/ADR-015-deployment-topology.md` | atualizado | `docs/adr/ADR-018-deployment-topology.md` | Monólito modular com workers isolados e promoção em estágios. |
| 18 | `docs/architecture/API_DESIGN.md` | reescrito | `docs/architecture/API_DESIGN.md; contracts/openapi/axtro-api.yaml; contracts/asyncapi/axtro-events.yaml` | Prosa agora é acompanhada por contratos executáveis. |
| 19 | `docs/architecture/AVATAR_AND_VOICE_ARCHITECTURE.md` | reescrito | `docs/architecture/AVATAR_AND_VOICE_ARCHITECTURE.md; docs/architecture/PROVIDER_CONTRACTS.md` | Providers substituíveis, warm-up, interrupção e degradação. |
| 20 | `docs/architecture/AXTRO_AGENT_INTEGRATION.md` | reescrito | `docs/architecture/AXTRO_AGENT_CONTROL_PLANE.md` | Integração assíncrona, versionada e fora do loop realtime. |
| 21 | `docs/architecture/DATA_MODEL.md` | reescrito | `docs/architecture/DATA_MODEL.md; database/` | UUIDv7, RLS, FKs tenant-safe, PII, append-only e migrations de referência. |
| 22 | `docs/architecture/DIAGRAMS.md` | reescrito | `docs/architecture/END_TO_END_SEQUENCE_DIAGRAMS.md` | Fluxos críticos ganharam sequências e failure paths. |
| 23 | `docs/architecture/EVENT_ARCHITECTURE.md` | reescrito | `docs/architecture/EVENT_ARCHITECTURE.md; contracts/asyncapi/axtro-events.yaml` | Envelope versionado com correlation e causation, separado de workflows. |
| 24 | `docs/architecture/HUMANLIKE_CONVERSATION_ENGINE.md` | dividido | `docs/architecture/TURN_COORDINATOR.md; docs/architecture/MULTIMODAL_PERCEPTION_ENGINE.md; docs/architecture/BEHAVIOR_PRESENCE_DIRECTOR.md` | Turnos, percepção e presença agora possuem donos e contratos distintos. |
| 25 | `docs/architecture/KNOWLEDGE_AND_RAG.md` | reescrito | `docs/architecture/KNOWLEDGE_AND_RAG.md` | Conhecimento por tenant e Role Pack, provenance e conteúdo não confiável. |
| 26 | `docs/architecture/MEETING_GATEWAY.md` | reescrito | `docs/architecture/MEETING_GATEWAY.md; docs/operations/CAPABILITY_DEGRADATION_MATRIX.md` | Capacidades variam por canal e precisam de fallback declarado. |
| 27 | `docs/architecture/MEMORY_ARCHITECTURE.md` | reescrito | `docs/architecture/MEMORY_ARCHITECTURE.md; docs/architecture/INTERACTION_STATE_ARCHITECTURE.md` | Memória não substitui estado de sessão nem receipts. |
| 28 | `docs/architecture/MULTI_TENANCY.md` | reescrito | `docs/architecture/MULTI_TENANCY.md; database/rls-policy-matrix.md` | Isolamento abrange banco, cache, logs, vetores, storage e providers. |
| 29 | `docs/architecture/REALTIME_ARCHITECTURE.md` | reescrito | `docs/architecture/REALTIME_INTERACTION_KERNEL.md; docs/architecture/TURN_COORDINATOR.md` | Session actor, generation IDs, cancelamento, floor e backpressure. |
| 30 | `docs/architecture/SALES_INTELLIGENCE_ENGINE.md` | dividido | `docs/architecture/ROLE_AND_SKILL_PACKS.md; docs/product/SALES_CLOSER_ALPHA.md` | Vendas é um pack, não o kernel. |
| 31 | `docs/architecture/SYSTEM_ARCHITECTURE.md` | reescrito | `docs/architecture/SYSTEM_ARCHITECTURE.md; docs/architecture/PLATFORM_BOUNDARIES.md; docs/architecture/COGNITIVE_FABRIC.md` | Sistema organizado por planos, lanes e fronteiras. |
| 32 | `docs/architecture/TOOL_RUNTIME.md` | reescrito | `docs/architecture/ACTION_AND_TOOL_RUNTIME.md; contracts/schemas/action_intent.schema.json; contracts/schemas/policy_decision.schema.json; contracts/schemas/tool_execution_receipt.schema.json` | LLM propõe, policy autoriza e receipt comprova. |
| 33 | `docs/compliance/COMPLIANCE.md` | dividido | `docs/compliance/COMPLIANCE.md; docs/compliance/DIGITAL_HUMAN_SAFETY_AND_DISCLOSURE.md; docs/compliance/PERCEPTION_PRIVACY_AND_BIOMETRICS.md; docs/compliance/REGION_AND_SECTOR_POLICY.md` | Consentimento é separado por finalidade e região. |
| 34 | `docs/operations/BUILD_VS_BUY.md` | atualizado | `docs/operations/BUILD_VS_BUY.md` | Valor proprietário fica no OS, não em modelos de avatar ou voz. |
| 35 | `docs/operations/DECISIONS_LOG.md` | preservado e atualizado | `docs/operations/DECISIONS_LOG.md; docs/adr/` | Histórico permanece, com decisões V2 formalizadas em ADRs. |
| 36 | `docs/operations/EVALUATION_FRAMEWORK.md` | reescrito | `docs/operations/EVALUATION_FRAMEWORK.md` | Evals técnicos, humanos, comerciais, segurança e release gates. |
| 37 | `docs/operations/IMPLEMENTATION_PLAN.md` | reescrito | `docs/operations/IMPLEMENTATION_PLAN.md; backlog/MVP_TASK_GRAPH.yaml; backlog/PARALLEL_WORKSTREAMS.md` | Plano virou grafo executável com dependências e testes. |
| 38 | `docs/operations/OBSERVABILITY.md` | reescrito | `docs/operations/OBSERVABILITY.md; docs/adr/ADR-017-observability-otel.md` | Mede cada estágio, custo, qualidade humana e eventos críticos. |
| 39 | `docs/operations/PROVIDER_STRATEGY.md` | reescrito | `docs/operations/PROVIDER_STRATEGY.md; docs/operations/PROVIDER_BENCHMARK_PROTOCOL.md; docs/operations/CURRENT_PROVIDER_MATRIX.md` | Escolha por bake-off datado, não por preferência fixa. |
| 40 | `docs/operations/RISK_REGISTER.md` | reescrito | `docs/operations/RISK_REGISTER.md` | Inclui uncanny valley, percepção, custo, meeting bots e learning loops. |
| 41 | `docs/operations/ROADMAP.md` | reescrito | `docs/operations/ROADMAP.md; docs/operations/MVP_WALKING_SKELETON.md; docs/operations/HUMAN_PRESENCE_SPIKE.md` | Fundação e presença humana são validadas em trilhos paralelos. |
| 42 | `docs/operations/TEST_STRATEGY.md` | reescrito | `docs/operations/TEST_STRATEGY.md` | Inclui replay, ruído, cancelamento, falhas, RLS negativo e custo. |
| 43 | `docs/playbooks/CLAUDE_CODE_PLAYBOOK.md` | substituído | `AGENTS.md; .codex/config.toml; .codex/agents/; .agents/skills/; docs/playbooks/HANDOFF_TO_CODEX.md` | Execução agora é Codex-first com instruções nativas. |
| 44 | `docs/playbooks/CODEX_AUDIT_PLAYBOOK.md` | reescrito | `docs/playbooks/CODEX_AUDIT_PLAYBOOK.md; .codex/agents/` | Auditoria paralela por especialistas read-only. |
| 45 | `docs/playbooks/CONTRIBUTING.md` | reescrito | `docs/playbooks/CONTRIBUTING.md` | Contract-first, task graph, testes e decisões rastreáveis. |
| 46 | `docs/playbooks/DEFINITION_OF_DONE.md` | reescrito | `docs/playbooks/DEFINITION_OF_DONE.md; docs/playbooks/RELEASE_CHECKLIST.md` | Gates objetivos por tarefa e release. |
| 47 | `docs/playbooks/HANDOFF_TO_CLAUDE_CODE.md` | substituído | `docs/playbooks/HANDOFF_TO_CODEX.md; docs/playbooks/CODEX_LAUNCH.md` | Handoff aponta para contratos e task graph, não para um prompt monolítico. |
| 48 | `docs/playbooks/PROMPT_EXECUCAO_AUTONOMA.md` | substituído | `docs/playbooks/PROMPT_EXECUCAO_AUTONOMA_CODEX.md; START_CODEX_TODAY.md` | Prompt é limitado por marcos e evidências. |
| 49 | `docs/product/BENCHMARK_STUDY.md` | absorvido e preservado em legado | `docs/operations/CURRENT_PROVIDER_MATRIX.md; docs/operations/PROVIDER_BENCHMARK_PROTOCOL.md; legacy/v1/docs/product/BENCHMARK_STUDY.md` | Fatos temporais precisam de fontes e bake-off atualizados. |
| 50 | `docs/product/PRODUCT_REQUIREMENTS.md` | reescrito | `docs/product/PRODUCT_REQUIREMENTS.md; docs/operations/REQUIREMENTS_TRACEABILITY_MATRIX.md` | Requisitos possuem IDs, prioridade, evidência e testes. |
| 51 | `docs/product/PRODUCT_VISION.md` | reescrito | `docs/product/PRODUCT_VISION.md; docs/product/ROLE_PACK_CATALOG.md` | Categoria é Digital Human OS. |
| 52 | `docs/product/UNIT_ECONOMICS.md` | reescrito | `docs/operations/COST_AND_CAPACITY_MODEL.md; spreadsheets/UNIT_ECONOMICS_V2.xlsx` | Custos por canal, capacidade e margem são formula-driven. |
| 53 | `docs/security/SECURITY_ARCHITECTURE.md` | reescrito | `docs/security/SECURITY_ARCHITECTURE.md; docs/security/INCIDENT_RESPONSE.md` | Inclui novos trust boundaries, kill switches e resposta a incidentes. |
| 54 | `docs/security/THREAT_MODEL.md` | reescrito | `docs/security/THREAT_MODEL.md` | Novas ameaças de vídeo, scene, specialists, wallet e tenants. |
| 55 | `packages/domain/schemas/briefing.schema.json` | substituído | `contracts/schemas/pre_call_briefing.schema.json` | Schema Draft 2020-12 estrito e versionado. |
| 56 | `packages/domain/schemas/event_envelope.schema.json` | substituído | `contracts/schemas/event_envelope.schema.json` | Envelope com correlation, causation, classificação e tenant. |
| 57 | `packages/domain/schemas/handoff_packet.schema.json` | substituído | `contracts/schemas/handoff_packet.schema.json` | Handoff tipado e fechado. |
| 58 | `packages/domain/schemas/sales_session_state.schema.json` | dividido | `contracts/schemas/interaction_session_state.schema.json; contracts/schemas/role_state.schema.json; contracts/schemas/sales_state.schema.json; contracts/schemas/interaction_quality_state.schema.json` | Estado genérico separado do pack comercial. |
| 59 | `packages/domain/schemas/tool_contract.schema.json` | dividido | `contracts/schemas/tool_contract.schema.json; contracts/schemas/action_intent.schema.json; contracts/schemas/policy_decision.schema.json; contracts/schemas/tool_execution_receipt.schema.json` | Contrato, intenção, decisão e evidência são entidades distintas. |
| 60 | `prototypes/architecture-overview.html` | preservado como referência | `legacy/v1/prototypes/architecture-overview.html` | Protótipo não é fonte normativa nem código de produção. |
| 61 | `prototypes/axtro-console.jsx` | preservado como referência | `legacy/v1/prototypes/axtro-console.jsx` | Protótipo deve ser redesenhado após o Walking Skeleton. |
| 62 | `spreadsheets/UNIT_ECONOMICS.xlsx` | substituído | `spreadsheets/UNIT_ECONOMICS_V2.xlsx` | Modelo V2 possui 14 abas, fórmulas, canais, capacidade, sensibilidade e actual vs model. |

## Regra de precedência

`legacy/v1/` e `legacy/fable-v2-partial/` são evidência histórica. Em caso de conflito, prevalecem `ARCHITECTURE_CONSTITUTION.md`, os contratos em `contracts/`, os requisitos V2 e os ADRs aceitos.

## Gate de migração

A migração é considerada rastreável quando:

1. Os 62 caminhos acima permanecem presentes no inventário de legado.
2. Nenhuma decisão V2 depende de um arquivo externo não fornecido como se estivesse confirmado.
3. Os validadores de documentação, contratos, especificações, banco, Codex e segredos passam.
4. O Codex implementa somente a partir das fontes normativas V2.
