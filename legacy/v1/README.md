# Axtro Human Sales AI

**Plataforma SaaS multi-tenant de funcionários digitais comerciais por voz e vídeo, governada pelo Axtro Agent.**

> Sales Operating System de IA — não apenas um "AI closer". Fábrica de closers digitais que participam de videochamadas, ligações e reuniões (sala própria, Google Meet, Zoom, telefone), conduzem a venda pelo Método Silva ou metodologia do cliente, apresentam materiais, executam ferramentas (CRM, agenda, pagamento, assinatura) e transferem para humanos sem quebrar a experiência.

**Status:** Arquitetura completa (Fase 0 documentada) · Pronto para implementação pelo Claude Code
**Data desta documentação:** 2026-07-13 · Cotações externas registradas com data de acesso

---

## Comece por aqui

| Se você é... | Leia primeiro |
|---|---|
| Claude Code (implementação) | `docs/playbooks/HANDOFF_TO_CLAUDE_CODE.md` → `docs/playbooks/PROMPT_EXECUCAO_AUTONOMA.md` |
| Codex (auditoria) | `docs/playbooks/CODEX_AUDIT_PLAYBOOK.md` |
| Produto / Founder | `docs/product/PRODUCT_VISION.md` → `docs/product/BENCHMARK_STUDY.md` |
| Arquiteto | `docs/architecture/SYSTEM_ARCHITECTURE.md` → ADRs em `docs/adr/` |
| Financeiro | `docs/product/UNIT_ECONOMICS.md` + `spreadsheets/UNIT_ECONOMICS.xlsx` |

## Mapa do repositório

```
docs/
  product/        Visão, requisitos, benchmark de mercado, economia unitária
  architecture/   Sistema, realtime, conversa humana, sales engine, RAG,
                  memória, tools, multi-tenancy, dados, eventos, API, diagramas
  security/       Arquitetura de segurança + threat model
  compliance/     LGPD, consentimento, telemarketing, setores regulados
  operations/     Observabilidade, avaliação, testes, providers, build vs buy,
                  roadmap, plano de implementação, riscos, decisões
  adr/            ADR-001 a ADR-015 (decisões arquiteturais)
  playbooks/      Handoff Claude Code, playbook Codex, contributing, DoD,
                  prompt de execução autônoma
packages/domain/schemas/   JSON Schemas canônicos (estado de venda, eventos, tools)
prototypes/     Protótipos de UI (console JSX) e mapa interativo da arquitetura (HTML)
spreadsheets/   UNIT_ECONOMICS.xlsx (modelo editável com fórmulas)
```

## Decisões principais (resumo — detalhes nos ADRs)

1. **Realtime**: LiveKit Cloud + LiveKit Agents (Python). Dois modos com fallback: **pipeline** STT→LLM→TTS (default, controle e custo) e **speech-to-speech** (OpenAI Realtime, atrás de flag). ADR-002/003.
2. **Avatar**: camada `AvatarProvider`; **Tavus CVI** primário, fallback automático para modo somente-voz. Sem modelo próprio no MVP. ADR-005.
3. **Reuniões externas**: `MeetingBotProvider` com **Recall.ai** (Output Media) para Meet/Zoom/Teams. ADR-006.
4. **Telefonia**: **Telnyx** via LiveKit SIP (conta e número já existentes: +1 617 450-5166).
5. **Inteligência comercial**: `SalesSessionState` estruturado e versionado, motor determinístico separado do LLM. **Método Silva nativo** (Framework SILVA, Reunião Silva 6 fases, Cold Call 4 momentos) + SPIN/BANT/MEDDIC/custom por tenant.
6. **Axtro Agent (Hermes daemon)**: gerente autônomo **fora do caminho crítico** — pré-call (briefing), in-call (canal paralelo de sugestões), pós-call (resumo, CRM, follow-up). Call continua com políticas locais se o daemon cair. ADR-012.
7. **Dados**: Supabase Postgres + **RLS por tenant_id** em 100% das tabelas, pgvector, Redis (Upstash). ADR-007/009.
8. **Eventos**: Postgres outbox + **Redis Streams** no MVP; gatilho de migração para NATS JetStream documentado. ADR-008.
9. **Tools**: contratos com schema, risk class, idempotência, dry-run, aprovação humana e audit log. LLM nunca executa código arbitrário. ADR-010.
10. **Stack**: Next.js/TS (web) + NestJS/TS (API SaaS) + Python/uv (realtime-worker, supervisor) em monorepo Turborepo+pnpm. Deploy: Vercel + Fly.io + Supabase. ADR-001/015.

## Escopo exato do MVP (Fases 0+1)

Um closer de **voz** na Sala Axtro (LiveKit) com: identificação de IA configurável, base de conhecimento (RAG) alimentada pelos 8 manuais do Método Silva (tenant zero), `SalesSessionState` com Framework SILVA, agendamento no Google Calendar, CRM-lite interno, handoff humano quente com pacote de contexto, resumo pós-call + follow-up por e-mail, analytics básicos e trilha de auditoria. Avatar/vídeo = Fase 2. Meet/Zoom = Fase 3. Multi-tenant self-serve/billing = Fase 4. Daemon Hermes completo = Fase 5.

## Fatos confirmados vs. propostos

- **Confirmados**: 8 manuais Método Silva no projeto (v2.1/2026, uso interno; os manuais já citam "calls gravadas no Axtro AI"); Google Workspace da Axtro ativo; Telnyx ativo com número; Axtro Agent existente sobre engine Hermes (Nous Research), daemon 24/7.
- **Propostos (com justificativa em DECISIONS_LOG.md/ADRs)**: todos os providers, stack, esquemas e fases.
- **Pendências externas**: ver `PENDENCIAS_EXTERNAS.md`.
