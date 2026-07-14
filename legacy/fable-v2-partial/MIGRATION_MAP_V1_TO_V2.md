# MIGRATION_MAP_V1_TO_V2.md

> Matriz de migração da documentação **Axtro Human Sales AI (V1, 62 arquivos)** para **Axtro Digital Human OS (V2)**.
> Baseada em auditoria executada em 2026-07-14 **com scripts sobre o filesystem** (resultados na §0). Decisões: `manter` (copiar como está), `atualizar` (mesmo doc, seções novas), `reescrever` (mesmo tema, arquitetura V2), `dividir`, `mover`, `aposentar`.

## 0. Resultado da auditoria V1 (verificado, não opinião)

| # | Checagem | Resultado | Evidência |
|---|---|---|---|
| A1 | 8 PDFs do Método Silva existem? | **SIM — fato confirmado** | `ls /mnt/project/*.pdf` = 8 arquivos (SDR, Closer, Head, Multicanal IA, Cold Call, Social Selling, Sales Farming, Playbook). A auditoria externa não tinha acesso à pasta do projeto; item 3.12 corrigido. A *ingestão* deles no RAG continua sendo tarefa (não dependência externa). |
| A2 | JSON Schemas parseiam? | SIM, 5/5 | `json.load` ok |
| A3 | Objetos sem `additionalProperties:false` | **22** (briefing 6, tool_contract 5, sales_session_state 4, handoff_packet 4, event_envelope 3) | script §0 |
| A4 | Referências locais não resolvidas | **3** diretas (`PROGRESS.md`, `RELEASE_MVP.md`, `docs/PENDENCIAS_EXTERNAS.md` citado com caminho errado) + caminhos de schema citados de forma ambígua em 4 docs | script §0. V2 exige zero + verificador automático |
| A5 | UUIDv7 prometido vs SQL | **Contradição** — texto promete UUIDv7, DDL usa `gen_random_uuid()` (v4) | DATA_MODEL.md linhas 8/23 |
| A6 | Vector 1536 vs provider-agnostic | **Contradição** — `vector(1536)` fixa OpenAI text-embedding-3-small sem ADR | DATA_MODEL.md linha 80 |
| A7 | Perception/Behavior/Scene como subsistemas normativos | **Ausentes** — aparecem como parágrafos dentro de HUMANLIKE/SALES docs | grep |
| A8 | Workflows duráveis separados de event bus | **Ausente** — outbox+Streams cobrem eventos; pós-call/follow-up modelados como consumers, sem retry/timer/compensação formal | EVENT_ARCHITECTURE.md |
| A9 | Unit economics cobre minuto conectado vs falado, warm pool, egress, storage, taxas | **Parcial** — só SPK% e infra fixa | UNIT_ECONOMICS.xlsx |
| A10 | Fundamentos invioláveis (Axtro fora do caminho crítico, RLS 100%, tool contracts, disclosure, evals bloqueantes) | **Corretos — preservar** | ADR-007/010/012, COMPLIANCE |

## 1. Raiz

| Arquivo V1 | Decisão | Motivo | Destino V2 | Risco se não corrigir |
|---|---|---|---|---|
| README.md | reescrever | produto passa a ser Digital Human OS; Sales vira Role Pack | README.md | posicionamento errado orienta todo o código |
| PENDENCIAS_EXTERNAS.md | atualizar | itens novos (Temporal, providers de avatar, ANPD) e correção A1 | PENDENCIAS_EXTERNAS.md | decisões travadas sem dono |
| — | novo | regras não reinterpretáveis em um só lugar | ARCHITECTURE_CONSTITUTION.md | cada doc reinterpreta as regras |
| — | novo | gates de qualidade da própria documentação | ARCHITECTURE_STATUS.md + DOCUMENTATION_MANIFEST.md | "pronto" vira opinião |
| — | novo | contexto nativo p/ agentes de código | CLAUDE.md, AGENTS.md, PROGRESS.md (template) | handoff só em prosa longa |

## 2. docs/product

| V1 | Decisão | Motivo | Destino | Risco |
|---|---|---|---|---|
| PRODUCT_VISION.md | reescrever | visão do OS, não do closer | DIGITAL_HUMAN_OS_VISION.md + PRODUCT_VISION.md | teto do produto = 1 vertical |
| PRODUCT_REQUIREMENTS.md | reescrever | requisitos por plano (kernel) + por pack; IDs rastreáveis P0/P1 | PRODUCT_REQUIREMENTS.md | P0 sem trilha até teste |
| BENCHMARK_STUDY.md | atualizar | adicionar categoria "digital human OS" e datas | BENCHMARK_STUDY.md | leitura de mercado defasada |
| UNIT_ECONOMICS.md | reescrever | margem por canal, minuto conectado vs falado | UNIT_ECONOMICS.md | preço decidido com custo subestimado |
| — | novo | Sales como instalação, não como núcleo | SALES_CLOSER_ROLE_PACK.md + METHOD_SILVA_PACK.md | Método Silva vira hardcode espalhado |

## 3. docs/architecture

| V1 | Decisão | Motivo | Destino | Risco |
|---|---|---|---|---|
| SYSTEM_ARCHITECTURE.md | reescrever | reorganizar em 5 planos + C4 | SYSTEM_ARCHITECTURE.md + PLATFORM_BOUNDARIES.md + CONTROL_PLANE_ARCHITECTURE.md | fronteiras implícitas ⇒ acoplamento |
| REALTIME_ARCHITECTURE.md | reescrever | vira kernel com Session Actor, lease, cancel tokens, backpressure | REALTIME_INTERACTION_KERNEL.md | corridas e estados perdidos em produção |
| HUMANLIKE_CONVERSATION_ENGINE.md | dividir | turn-taking → doc próprio; presença → diretor próprio | TURN_COORDINATOR.md + BEHAVIOR_PRESENCE_DIRECTOR.md | naturalidade sem dono nem teste |
| SALES_INTELLIGENCE_ENGINE.md | dividir | motor genérico (RoleState) sai do vertical; apresentação sai p/ Scene Director | ROLE_AND_SKILL_PACKS.md + SALES_CLOSER_ROLE_PACK.md + SALES_INTELLIGENCE_ENGINE.md (pack) | kernel contaminado por vendas |
| — | novo | percepção como sinais com evidência/TTL/consentimento | MULTIMODAL_PERCEPTION_ENGINE.md | "leitura de mente" sem governança = risco legal |
| — | novo | estado de qualidade multidimensional (anti trust-score) | INTERACTION_STATE_ARCHITECTURE.md | número mágico inexplicável |
| — | novo | cenas com manifest/allowlist | SCENE_PRESENTATION_DIRECTOR.md | LLM dirigindo browser livre |
| — | novo | 4 lanes + One Mouth Rule + especialistas tipados | COGNITIVE_FABRIC.md + SPECIALIST_AGENT_FABRIC.md | swarm com vozes concorrentes |
| AXTRO_AGENT_INTEGRATION.md | reescrever | vira control plane do daemon com bridge versionado | AXTRO_AGENT_CONTROL_PLANE.md | acoplamento síncrono acidental |
| — | novo | Temporal (ou equivalente) p/ pré/pós-call, follow-up, deleção | DURABLE_WORKFLOW_ARCHITECTURE.md | event bus virando workflow engine |
| MEETING_GATEWAY.md | reescrever | matriz de capacidade por canal + degradação declarada | MEETING_GATEWAY.md + CAPABILITY_DEGRADATION_MATRIX.md (ops) | prometer paridade que não existe |
| AVATAR_AND_VOICE_ARCHITECTURE.md | atualizar | bake-off em vez de vencedor fixo; warm pool | AVATAR_AND_VOICE_ARCHITECTURE.md | lock-in por demo visual |
| KNOWLEDGE_AND_RAG.md | atualizar | knowledge por Role Pack; ADR de embeddings | KNOWLEDGE_AND_RAG.md | A6 sem solução |
| MEMORY_ARCHITECTURE.md | reescrever | memórias sob InteractionSessionState + timeline | MEMORY_ARCHITECTURE.md | estado duplicado e divergente |
| TOOL_RUNTIME.md | reescrever | fluxo ActionIntent→PolicyDecision→Receipt | ACTION_AND_TOOL_RUNTIME.md | ação sem trilha de política |
| MULTI_TENANCY.md | atualizar | service identity, pool reset, context leakage tests | MULTI_TENANCY.md | vazamento por conexão reaproveitada |
| DATA_MODEL.md | reescrever | corrigir A5/A6, FKs/NOT NULL, PII separada, deletion graph, migrations 2 fases | DATA_MODEL.md + database/reference-schema.sql + database/migration-plan.md + database/rls-policy-matrix.md + database/deletion-graph.md | migration improvisada em produção |
| EVENT_ARCHITECTURE.md | reescrever | envelope V2 (correlation/causation/classification), domínios de evento, separado de workflows | EVENT_ARCHITECTURE.md | eventos não auditáveis |
| API_DESIGN.md | reescrever | OpenAPI 3.1 + AsyncAPI 3 como contrato-fonte | API_DESIGN.md + contracts/openapi + contracts/asyncapi | API divergindo da prosa |
| DIAGRAMS.md | reescrever | sequências E2E por cena/turn/handoff | END_TO_END_SEQUENCE_DIAGRAMS.md | fluxos só na cabeça |

## 4. docs/security e compliance

| V1 | Decisão | Motivo | Destino | Risco |
|---|---|---|---|---|
| SECURITY_ARCHITECTURE.md | atualizar | adicionar service identities, scene sandbox, specialist poisoning | SECURITY_ARCHITECTURE.md | novas superfícies sem controle |
| THREAT_MODEL.md | atualizar | +ameaças V2 (T16-T30: meeting hijack, denial of wallet, browser escape…) | THREAT_MODEL.md | ameaças de vídeo ignoradas |
| COMPLIANCE.md | dividir | disclosure/segurança de digital human e biometria/percepção viram docs próprios region-aware | COMPLIANCE.md → REGION_AND_SECTOR_POLICY.md + DIGITAL_HUMAN_SAFETY_AND_DISCLOSURE.md + PERCEPTION_PRIVACY_AND_BIOMETRICS.md | EU AI Act/ANPD tratados como rodapé |
| — | novo | resposta a incidentes (deepfake, vazamento, tool destrutiva) | INCIDENT_RESPONSE.md | improviso em crise |

## 5. docs/operations

| V1 | Decisão | Motivo | Destino | Risco |
|---|---|---|---|---|
| OBSERVABILITY.md | atualizar | +métricas de presença humana e segurança; custo por minuto conectado/falado | OBSERVABILITY.md | otimizar o que não é medido |
| EVALUATION_FRAMEWORK.md | atualizar | golden convos, compradores sintéticos, testes adversariais | EVALUATION_FRAMEWORK.md | gate de qualidade fraco p/ vídeo |
| TEST_STRATEGY.md | atualizar | replay/noise/cancel tests do Turn Coordinator; RLS negativo | TEST_STRATEGY.md | regressões de corrida |
| PROVIDER_STRATEGY.md | reescrever | protocolo de bake-off + matriz datada, sem vencedor permanente | PROVIDER_STRATEGY.md + PROVIDER_BENCHMARK_PROTOCOL.md + CURRENT_PROVIDER_MATRIX.md | escolha por marketing |
| BUILD_VS_BUY.md | atualizar | +Temporal, +avatar providers 2026 | BUILD_VS_BUY.md | reinventar workflow engine |
| ROADMAP.md | reescrever | 2 trilhos paralelos + M0-M6 com exit criteria | ROADMAP.md | validar produto errado (só voz) |
| IMPLEMENTATION_PLAN.md | reescrever | vira task graph executável | IMPLEMENTATION_PLAN.md + backlog/MVP_TASK_GRAPH.yaml + backlog/EPICS.md + backlog/PARALLEL_WORKSTREAMS.md + backlog/DEPENDENCY_GRAPH.md | tarefas grandes demais p/ agente |
| RISK_REGISTER.md | atualizar | +riscos V2 (uncanny valley, custo vídeo, regulação biometria) | RISK_REGISTER.md | riscos novos invisíveis |
| DECISIONS_LOG.md | manter+atualizar | histórico preservado; decisões V2 anexadas | DECISIONS_LOG.md | perda de rastro |
| — | novo | budgets de latência decompostos e mensuráveis | LATENCY_BUDGETS.md | budget vira aspiração |
| — | novo | custo+capacidade+concorrência | COST_AND_CAPACITY_MODEL.md | denial of wallet |
| — | novo | escopos executáveis M1/M2 | MVP_WALKING_SKELETON.md + HUMAN_PRESENCE_SPIKE.md | milestone sem definição |
| — | novo | rastreabilidade P0→teste | REQUIREMENTS_TRACEABILITY_MATRIX.md | P0 sem cobertura |

## 6. docs/playbooks

| V1 | Decisão | Motivo | Destino | Risco |
|---|---|---|---|---|
| HANDOFF_TO_CLAUDE_CODE.md | reescrever | curto; aponta p/ CLAUDE.md + task graph | HANDOFF_TO_CLAUDE_CODE.md | prompt gigante ⇒ contexto estourado |
| CLAUDE_CODE_PLAYBOOK.md | reescrever | usa subagents/skills/hooks nativos | CLAUDE_CODE_PLAYBOOK.md + CLAUDE_CODE_EXECUTION_PLAN.md + .claude/* | Claude Code sem guard-rails |
| CODEX_AUDIT_PLAYBOOK.md | reescrever | lanes de auditoria + AGENTS.md | CODEX_PARALLEL_AUDIT_PLAN.md + CODEX_AUDIT_PLAYBOOK.md + AGENTS.md | 2 escritores no mesmo arquivo |
| PROMPT_EXECUCAO_AUTONOMA.md | reescrever | referencia M0-M3 e task graph | PROMPT_EXECUCAO_AUTONOMA_CLAUDE_CODE.md + PROMPT_AUDITORIA_CODEX.md | prompt desatualizado |
| CONTRIBUTING.md / DEFINITION_OF_DONE.md | atualizar | DoD ganha gates de docs QA | CONTRIBUTING.md / DEFINITION_OF_DONE.md | — |
| — | novo | checklist de release | RELEASE_CHECKLIST.md | referência quebrada A4 |

## 7. docs/adr

| V1 | Decisão | Destino |
|---|---|---|
| ADR-001 (monorepo), 003 (LiveKit), 004 (gateway), 006 (Recall), 007 (RLS), 010 (tools), 011 (handoff), 013 (retenção), 014 (obs) | manter+atualizar status | ADR-001…mantidos, renumerados no índice V2 |
| ADR-002 (dual-mode), 005 (avatar), 008 (eventos), 009 (memória), 012 (Axtro fora do caminho), 015 (deploy) | reescrever | versões V2 com options/rollback trigger |
| — | novos (10) | Role Pack boundary · Turn Coordinator · Perception evidence-based · Behavior Director · Scene Director · One Mouth Rule · InteractionState · Temporal · Embedding dimensionality · Modular monolith |

## 8. packages/domain/schemas → contracts/schemas

| V1 | Decisão | Destino |
|---|---|---|
| sales_session_state | reescrever | interaction_session_state + conversation_state + role_state + sales_state (pack) |
| tool_contract | reescrever | tool_contract V2 + action_intent + policy_decision + tool_execution_receipt |
| event_envelope | reescrever | event_envelope V2 (correlation/causation/classification) |
| handoff_packet | atualizar | handoff_packet V2 |
| briefing | atualizar | pre_call_briefing V2 |
| — | novos (22) | perception_signal · derived_hypothesis · interaction_quality_state · behavior_directive · scene_manifest · scene_directive · role_pack_manifest · skill_pack_manifest · specialist_request · specialist_result · agent_suggestion · workflow_command · workflow_status · provider_capability · cost_event · experiment_candidate · deployment_promotion · consent_evidence · disclosure_record · session_health_state (+ OpenAPI, AsyncAPI) |

**Regra global dos schemas V2**: JSON Schema 2020-12, `additionalProperties:false` em todo objeto, `required` explícito, `$id`, `schema_version`, tenant scope, exemplos válidos e inválidos em `contracts/examples/`.

## 9. Protótipos e planilha

| V1 | Decisão | Motivo |
|---|---|---|
| prototypes/axtro-console.jsx | manter+mover | continua válido; ganhará painel de percepção/cenas quando os contratos existirem |
| prototypes/architecture-overview.html | aposentar (substituir) | mapa reflete V1; nova versão em 5 planos após SYSTEM_ARCHITECTURE V2 |
| spreadsheets/UNIT_ECONOMICS.xlsx | reescrever | 14 abas: Provider_Catalog datado, minuto conectado×falado, warm pool, meeting bot compute, egress, storage, taxas, concorrência, margem por canal, Actual_vs_Model |

## 10. Riscos da migração em si

1. **Perder o que a V1 acertou** — mitigação: §0-A10 lista os invioláveis preservados na Constituição.
2. **Documentação infinita** — mitigação: cada doc V2 nasce com dono, inputs/outputs e teste; DOCUMENTATION_MANIFEST trava escopo.
3. **Task graph teórico** — mitigação: M1 (Walking Skeleton) e M2 (Human Presence Spike) são os primeiros grafos detalhados; o resto em épicos.
