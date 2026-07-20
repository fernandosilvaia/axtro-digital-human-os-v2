# EXECUTION_LOG — execução autônoma

Registro por ciclo do loop (auditar → priorizar → implementar → testar → mergear).
Detalhe técnico por decisão: `docs/operations/DECISIONS_LOG.md`.

## Ciclo 3 · 2026-07-19/20 — "produto operável de ponta a ponta"

- **Auditoria:** `docs/PROJECT_AUDIT.md` criado; backlog priorizado em `TASKS.md`.
- **T1 Ativação de agente:** RPC `portal_set_agent_status` (0014, aplicada no live e testada:
  active/draft/inválido), guarda de provider no server action, `AgentStatusToggle` na lista.
- **T2 E-mail de convite:** `lib/email.ts` (Resend, timeout 10s, log sem PII), envio
  não-bloqueante no `inviteMember`, feedback distinto na UI, chave local via Doppler.
- **T3 Modo demonstração:** `PORTAL_FAKE_PROVIDERS=1` — chat determinístico formato Silva,
  embeddings fake xorshift normalizados (busca continua funcional), apresentação simulada
  com navegação manual do deck.
- **T4 E2E Playwright:** 6 specs serial (landing, redirect, login, ativação com reversão,
  chat mock, deck simulado); webServer próprio na porta 3100 com fake providers.
- **T5 CI/health/docs:** job `build-portal` no workflow; `GET /api/health`; documentação
  final completa (este conjunto de arquivos). Bug real encontrado e corrigido: a rota
  nasceu protegida pelo middleware de auth (redirecionava pra `/login`, quebrando o
  smoke test) — excluída do matcher do `proxy.ts`, verificado com curl e e2e.
- **Validação:** lint, typecheck (workspace + portal), 418 testes Node + 26 Python, build
  do portal, 9 validadores, secret scan e 6/6 specs Playwright (Chrome real) — todos verdes.
- **T6 Rate limiting:** 0015 aplicada no live — 20 convites/dia e 30 ingestões/dia por
  tenant (`create or replace` preservando 100% do comportamento anterior das duas RPCs).
  Testado ao vivo: convite normal continua funcionando, dado de teste limpo.
- **T9 Notificação de ativação:** 0016 (`portal_list_admin_emails`, admin-only) +
  `sendAgentActivatedEmail` no fluxo de ativação, best-effort (nunca desfaz a ativação).
  README de `database/supabase-only/` corrigido — faltava a entrada de 0014 do ciclo
  anterior. Validado com o e2e completo (6/6, incluindo o teste que ativa/pausa Bruno).

## Ciclo 2 · 2026-07-19 — Cérebro Método Silva + percepção emocional

- PR #16 (cérebro, RAG, personas, apresentação) e PR #17 (emenda ADR-035) — mergeados
  com autorização explícita do Fernando. Evidências em PROGRESS.md.

## Ciclo 1 · 2026-07-16/18 — Fase de produto

- PRs #1-#15 (sessões anteriores): portal completo com auth, RAG, vídeo, custos e deploy.
