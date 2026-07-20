# CHANGELOG (resumo por onda — detalhes em PROGRESS.md e DECISIONS_LOG.md)

## 2026-07-19/20 — Execução autônoma: produto operável de ponta a ponta

- **feat(portal):** ativação/pausa de agente pelo admin (RPC 0014 + botão na lista); texto
  desatualizado corrigido — Bruno/Marina destraváveis.
- **feat(team):** convite de equipe envia e-mail real via Resend (não-bloqueante, template
  pt-BR, mock logado sem chave).
- **feat(portal):** `PORTAL_FAKE_PROVIDERS=1` — modo demonstração completo sem chaves
  (chat determinístico, embeddings fake, apresentação simulada com deck navegável).
- **test(e2e):** Playwright da UI logada (login demo, dashboard, ativação, chat, apresentação).
- **ci:** job `build-portal` (typecheck + build Next); rota `/api/health` + smoke pós-deploy.
- **docs:** PROJECT_AUDIT, TASKS, NEEDS_CONNECTION, TESTING, SECURITY, DEPLOYMENT,
  ARCHITECTURE, EXECUTION_LOG, HANDOFF.

## 2026-07-19 — Percepção emocional profunda (PR #17)

- Art. 4 da Constituição emendado (ADR-035): leitura de emoção, micro-expressões e corpo
  como capacidade central; 8 consultas de percepção por idioma nas 3 personas ao vivo.

## 2026-07-19 — Cérebro Método Silva (PR #16)

- 38 manuais adquiridos do Drive (cofre com hash); cérebro nos 9 blocos do método;
  10 manuais no RAG (438 chunks); personas renovadas (Rafaela `p8966676f4d2`); modo
  apresentação com slides comandados pela agente (`@daily-co/daily-js`).

## 2026-07-16/18 — Fase de produto (PRs #1-#15)

- Supabase real + portal com auth completa; RAG real com governança; Tavus por persona
  (Aurora/Amanda); OpenRouter no chat; painel Uso de IA; deploy Railway; SMTP Resend;
  Auth Hook com claims.

## 2026-07-14/15 — Kernel M0-M3

- Foundation, Walking Skeleton, Human Presence Spike e Sales Closer Alpha fake-first,
  com release gates auditados (ver FINAL_AUDIT_REPORT.md).
