# SYSTEM_ARCHITECTURE — Visão Geral

## Princípios
1. **Loop de conversa sagrado**: nada com latência imprevisível (daemon, RAG pesado, tools lentas) entra no caminho síncrono áudio→áudio sem orçamento explícito.
2. **Provider-agnostic**: toda dependência crítica atrás de interface + registry (Model/Voice/Avatar/MeetingBot/CRM/Payment/Signature).
3. **Estado explícito > memória do modelo**: `SalesSessionState` versionado é a fonte de verdade comercial.
4. **Tenant-first**: tenant_id + RLS desde a primeira migration.
5. **Eventos como espinha dorsal**: tudo relevante vira evento versionado (outbox), consumido por Supervisor, analytics e avaliação.
6. **Fail-open com política local**: qualquer dependência não essencial cai → call continua degradada com regras locais.

## Diagrama de contexto (C4-1)
```mermaid
flowchart LR
  Cliente[Cliente final] -->|voz/video/fone/widget| GW[Meeting Gateway]
  Operador[Time comercial humano] --> WEB[Console Web]
  Admin[Admin do tenant] --> WEB
  GW --> RT[Realtime Conversation Engine]
  RT <--> AV[Avatar Provider Layer]
  RT <--> VG[Voice Gateway STT/TTS/S2S]
  RT <--> MG[Model Gateway LLMs]
  RT <--> TR[Tool Runtime]
  RT <--> SE[Sales Intelligence Engine]
  SE <--> KB[Knowledge & RAG]
  RT -->|eventos| BUS[(Event Bus)]
  BUS --> SUP[Axtro Agent Supervisor daemon Hermes]
  SUP --> TR
  SUP --> CRM[(CRM / Calendar / Email / Pagto / Assinatura)]
  TR --> CRM
  WEB --> API[SaaS API]
  API --> DB[(Postgres RLS + pgvector)]
  RT --> DB
  SUP --> DB
  BUS --> AN[Analytics & Evaluation]
```

## Diagrama de containers (C4-2)
```mermaid
flowchart TB
  subgraph Frontend [Vercel]
    web[apps/web Next.js]
    admin[apps/admin Next.js]
    room[apps/meeting-room Next.js + LiveKit React]
  end
  subgraph Core [Fly.io]
    api[apps/api NestJS TS]
    rtw[apps/realtime-worker Python LiveKit Agents]
    sup[apps/axtro-supervisor Python daemon Hermes]
    bot[apps/meeting-bot-worker Node orquestra Recall]
  end
  subgraph Dados
    pg[(Supabase Postgres RLS + pgvector + Vault)]
    redis[(Upstash Redis streams + estado sessao)]
    obj[(Supabase Storage por tenant)]
  end
  subgraph Providers
    lk[LiveKit Cloud + SIP Telnyx]
    llm[Anthropic OpenAI Google OpenRouter]
    stt[Deepgram]
    tts[ElevenLabs Cartesia]
    ava[Tavus CVI]
    mbot[Recall.ai]
    goog[Google Workspace APIs]
    pay[Stripe Pix]
  end
  web --> api
  admin --> api
  room --> lk
  api --> pg
  api --> redis
  rtw --> lk
  rtw --> stt
  rtw --> tts
  rtw --> llm
  rtw --> ava
  rtw --> pg
  rtw --> redis
  sup --> redis
  sup --> pg
  sup --> llm
  sup --> goog
  bot --> mbot
  bot --> lk
  api --> pay
```

## Componentes (contratos resumidos; detalhes nos docs dedicados)
| # | Componente | Doc | Responsabilidade em 1 linha |
|---|---|---|---|
| 1 | Realtime Conversation Engine | REALTIME_ARCHITECTURE | Loop áudio↔áudio, turnos, barge-in, execução de tools permitidas, publicação de eventos; funciona sem o daemon |
| 2 | Axtro Agent Supervisor | AXTRO_AGENT_INTEGRATION | Pré/in/pós-call assíncrono; nunca no caminho crítico |
| 3 | Meeting Gateway | MEETING_GATEWAY | Adapters: Sala Axtro, Meet, Zoom, Teams, Telnyx, widget, mobile, API |
| 4 | Avatar Provider Layer | AVATAR_AND_VOICE_ARCHITECTURE | Interface única de avatar + warm-up + fallback |
| 5 | Model Gateway | ADR-004 + PROVIDER_STRATEGY | Roteamento por tarefa/custo/latência/idioma/tenant, fallback, budgets, shadow/A-B |
| 6 | Voice Gateway | AVATAR_AND_VOICE_ARCHITECTURE | STT/TTS/S2S/VAD/turn/diarização/idioma + normalização e glossário de pronúncia |
| 7 | Sales Intelligence Engine | SALES_INTELLIGENCE_ENGINE | Estado da venda + metodologias + próxima melhor ação |
| 8 | Knowledge & Grounding | KNOWLEDGE_AND_RAG | Ingestão→RAG híbrido com citações e validade |
| 9 | Tool & Action Engine | TOOL_RUNTIME | Contratos, risk class, idempotência, aprovação, audit |
| 10 | Presentation Engine | SALES_INTELLIGENCE_ENGINE §7 | Controller valida ações de alto nível do LLM (abrir apresentação, avançar slide...) |
| 11 | Human Handoff | REALTIME_ARCHITECTURE §8 | Máquina de estados de transferência + pacote de contexto |
| 12 | Memory | MEMORY_ARCHITECTURE | 7 memórias isoladas por escopo e tenant |
| 13 | Multi-tenant | MULTI_TENANCY + DATA_MODEL | RLS, RBAC/ABAC, medição, budgets, white-label |
| 14 | Segurança | SECURITY_ARCHITECTURE + THREAT_MODEL | Security by design + kill switch |
| 15 | Compliance | COMPLIANCE | Identificação IA, consentimentos, DNC, setores |
| 16 | Observabilidade | OBSERVABILITY | OTel + métricas técnicas/humanas/comerciais |
| 17 | Avaliação | EVALUATION_FRAMEWORK | Gates automáticos + humanos antes de produção |
| 18 | Resiliência | REALTIME_ARCHITECTURE §9 | Tabela de fallbacks por dependência |
| 19 | Eventos | EVENT_ARCHITECTURE | Catálogo + envelope versionado + outbox |

## Estrutura do monorepo (avaliada e ajustada — ADR-001)
Mantida a proposta original com 3 ajustes: (a) `packages/contracts` renomeado para `provider-contracts` mantido, mas schemas canônicos ficam em `packages/domain/schemas` gerando tipos TS (json-schema-to-ts) e Python (datamodel-code-generator); (b) `apps/api` concentra SaaS + tool-runtime HTTP no MVP (separação futura preservada por módulos Nest); (c) `infrastructure/terraform` mínimo desde F0 (projetos, secrets, DNS), não infra completa.

```
/apps: web · admin · meeting-room · api · realtime-worker · axtro-supervisor · meeting-bot-worker
/packages: domain · database · auth · events · observability · security · provider-contracts ·
  model-gateway · voice-gateway · avatar-gateway · meeting-gateway · tool-runtime · sales-engine ·
  knowledge-engine · memory · evaluation · ui · config
/infrastructure: terraform · docker · monitoring · ci
/docs: (este diretório)
```
Regra: Python (`realtime-worker`, `axtro-supervisor`) consome os mesmos JSON Schemas de `/packages/domain/schemas` — proibido divergir tipos.

## Fluxo completo de uma call (nativa, com avatar — Fase 2)
```mermaid
sequenceDiagram
  participant L as Lead
  participant API as SaaS API
  participant SUP as Axtro Agent
  participant RT as Realtime Engine
  participant AV as Avatar Provider
  participant T as Tool Runtime
  API->>SUP: lead.created / session.preparing
  SUP->>RT: briefing + politicas + tools autorizadas (contexto inicial)
  RT->>AV: warm-up (pool)
  L->>RT: entra na sala (session.ready)
  RT->>L: identificacao de IA + abertura (Reuniao Silva F1)
  loop turnos
    L->>RT: fala (VAD/EOT)
    RT->>RT: STT -> SalesState update -> LLM (streaming)
    RT->>T: tool permitida? (agenda/CRM) async quando possivel
    RT->>AV: audio -> video labial
    RT-->>SUP: eventos (intent/objecao/sentimento)
    SUP-->>RT: sugestao via canal paralelo (TTL)
  end
  alt handoff
    RT->>API: handoff.requested + pacote de contexto
    API->>Humano: notifica + entrega pacote
    Humano->>RT: entra na sala (transferencia quente)
  end
  RT->>SUP: session.completed
  SUP->>T: resumo -> CRM -> follow-up -> tarefas
```

## Consistência entre documentos
Toda decisão citada aqui existe em ADR ou DECISIONS_LOG; números de latência apenas em REALTIME_ARCHITECTURE §Budgets; preços apenas em UNIT_ECONOMICS (+planilha). Conflitos encontrados na análise da pasta: nenhum — os manuais são conteúdo de metodologia (viram knowledge base do tenant zero) e já referenciam "Axtro AI" para gravação de calls, decisão preservada.
