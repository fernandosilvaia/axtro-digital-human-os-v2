# IMPLEMENTATION_PLAN.md — plano executável F0→F1 (nível de tarefa)

> Status: NORMATIVO para o Claude Code. Ordem importa: cada bloco lista dependências. Critérios de aceite são verificáveis por comando/teste. Detalhes de convenção em HANDOFF_TO_CLAUDE_CODE.md.

## F0 — Fundação (blocos B0.x)
**B0.1 Monorepo** — Turborepo+pnpm; workspaces `apps/{web,admin,meeting-room,api}` (TS) e `apps/{realtime-worker,axtro-supervisor}` (Py/uv), `packages/{domain,ui,evaluation,config}`. Aceite: `pnpm build` e `uv run pytest` verdes no CI.
**B0.2 Qualidade base** — ESLint+Prettier+tsconfig strict; ruff+mypy; commitlint (conventional); Husky. Aceite: pipeline de PR executa tudo <10min.
**B0.3 Supabase** — projeto região SP; migrações com supabase CLI; aplicar DDL de DATA_MODEL.md §3; RLS em 100% das tabelas; roles api_rw/worker_ro/analytics_ro. Aceite: suíte `rls-isolation.test.ts` (gerada de DATA_MODEL) passa.
**B0.4 Schemas do domínio** — copiar `packages/domain/schemas/*.json` deste repo de docs; codegen: zod (TS) via json-schema-to-zod + pydantic (Py) via datamodel-code-generator; contract tests dos payloads. Aceite: mudança de schema sem bump quebra CI.
**B0.5 Esqueleto API** — NestJS: módulos auth, tenants, agents, leads, sessions (stub), health; OTel + Sentry ligados; middleware de tenant (JWT→RLS `set_config`). Aceite: `GET /health` com trace no Grafana; e2e de auth.
**B0.6 Esqueleto realtime-worker** — LiveKit Agents Python; entrypoint que entra numa sala e ecoa áudio (loopback) com providers FAKE; harness de testes (TEST_STRATEGY §1). Aceite: teste de interrupção com relógio virtual passa.
**B0.7 Seed tenant zero** — script idempotente que cria tenant "Método Silva", agente "Sofia (Closer)", ingere os 8 PDFs (pipeline mínimo de chunking), 5 leads fictícios. Aceite: `pnpm seed && pnpm seed` (2ª execução sem duplicar).
**B0.8 Deploy contínuo** — Vercel (web/admin/meeting-room), Fly.io (api, realtime-worker), Doppler; ambientes dev/staging. Aceite: merge em main ⇒ staging atualizado automaticamente.

## F1 — MVP Closer de Voz (blocos B1.x)
**B1.1 Sessions core** (dep B0.3/4/5) — POST /v1/sessions cria sala LiveKit + token do lead + registro; estados da sessão; eventos `session.*` no outbox. Aceite: contract tests + evento visível no consumer de teste.
**B1.2 Pipeline de voz real** (dep B0.6) — Deepgram streaming PT-BR; Model Gateway (Haiku primário, hedging, custo por chamada); ElevenLabs Flash + Cartesia fallback; budgets instrumentados (OBSERVABILITY §2). Aceite: sessão real com p50 EOT→áudio ≤0,8s medido em staging; teste de fallback derrubando provider fake.
**B1.3 Motor de conversa humanizada** (dep B1.2) — EOT híbrido, backchannels, SpeechStyle, normalização pré-TTS, glossário de pronúncia por tenant. Aceite: golden G2 subset de naturalidade; robotic_markers=0 nos goldens.
**B1.4 Sales Intelligence Engine** (dep B0.4) — SalesSessionState store (state_rev otimista), máquina de funil (esteira 8 etapas), extrator SILVA por turno, Método Silva plugin default (fases da Reunião Silva + Cold Call Silva), objection handler (9 mortais), NBA, limites comerciais. Aceite: unit evals G1 ≥ alvos; replay dos 40 goldens G2.
**B1.5 RAG comercial** (dep B0.7) — chunking orientado a venda, pgvector + rerank leve, citações internas no contexto; injeção por fase do funil. Aceite: eval de retrieval (recall@5 ≥0,85 no dataset dos manuais); teste de isolamento cross-tenant.
**B1.6 Tools F1** (dep B1.1) — `calendar.check_availability`, `calendar.book_meeting` (Google), `crm.upsert_lead`, `crm.log_activity`, `dnc.add`, `handoff.request`; runtime com risk_class/dry-run/auditoria. Aceite: contract tests por tool + sequenceDiagram D13 respeitado nos traces.
**B1.7 Handoff quente** (dep B1.6) — pipeline gera HandoffPacket (schema), notifica humano (web push + Telegram), humano entra na mesma sala; modo scheduled/async. Aceite: golden de handoff; packet validado por schema; humano recebe ≤10s.
**B1.8 Pós-call** (dep B1.4) — jobs: transcript final, resumo executivo, follow-up (draft e-mail via Gmail API do tenant zero — aprovação manual F1), atualização CRM-lite, métricas humanas. Aceite: sessão encerrada ⇒ todos jobs ≤2min; e-mail draft aparece no dashboard.
**B1.9 Dashboard F1** (dep B1.8) — Ao vivo (sessões, ouvir, assumir), Agentes (prompt/knowledge/voz + G6 mini-suite), Analytics (15 KPIs), Aprovações. Aceite: fluxos Playwright.
**B1.10 Sala Axtro (lead)** — página meeting-room: link único, sem login, mic check, disclosure visível, tema white-label do tenant. Aceite: Lighthouse a11y ≥90; teste real em 4G.
**B1.11 Axtro Agent F1** (dep B1.1) — supervisor wrapper: consome eventos, gera PreCallBriefing (schema) p/ sessões agendadas, sugestões in-call TTL-2-turnos via data channel, jobs pós-call idempotentes; kill switch. Aceite: briefing_ready_rate ≥90% nas agendadas em staging; matar daemon não afeta latência (teste).
**B1.12 Go/No-Go MVP** — checklist: gates G1–G5 verdes, 10 calls reais tenant zero, custo/min real registrado, PENDENCIAS_EXTERNAS itens F1 resolvidos. Aceite: documento de release assinado no repo.

## Estimativa de esforço (dev·dias com Claude Code, calibrar após F0)
F0 ≈ 10–14 · F1 ≈ 30–40. Caminho crítico: B1.2→B1.3→B1.4 (latência+motor). Paralelizável: B1.5/B1.6/B1.9.
