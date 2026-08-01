# CHANGELOG (resumo por onda — detalhes em PROGRESS.md e DECISIONS_LOG.md)

## 2026-07-31 — Reunião externa ao vivo + produto aberto para contratação

- **feat(cleanup):** exclusão de agente em rascunho e de fonte revogada (RPCs 0023 com
  guardas + dupla confirmação na UI) — limites de 20/50 não entopem mais (D-V2-095).
- **feat(legal):** /termos e /privacidade honestos, linkados no signup e sitemap,
  marcados para revisão jurídica formal.
- **test(e2e):** 14 specs — ciclos de vida completos de agente e fonte clique-a-clique.

- **feat(meetings):** agente entra em reuniões reais de Meet/Zoom/Teams (Recall.ai) com
  palco de rosto próprio, áudio bidirecional (bot 4-core + sinal cru) e webhook de status —
  validado ao vivo com a Raissa num Meet real (D-V2-091/092/093).
- **feat(video):** auto-provisão de persona de vídeo na ativação de agente (cérebro,
  voz, percepção, tools) — clientes novos ganham vídeo sem configuração manual (D-V2-094).
- **feat(billing-lite):** teto de 20 conversas de vídeo/dia por tenant + seção "Plano e
  contratação" com limites explícitos e CTA comercial.
- **test(e2e):** suite clique-a-clique ampliada para 11 specs, 11/11 verdes.

## 2026-07-24 — SEO/AEO, rate card de custos e correções (execução autônoma)

- **feat(seo):** landing pública com metadata canônica, Open Graph dinâmico, JSON-LD
  (organização/site/software/FAQPage), `robots.txt`, `sitemap.xml`, `llms.txt`/
  `llms-full.txt`, manifest PWA e ícones de compartilhamento (SEO-AEO-01, D-V2-077).
- **feat(portal):** dashboard com prontidão operacional baseada em dados reais da conta.
- **feat(costing):** rate card de custos com preço público de tabela (OpenRouter,
  Tavus) — `unit_cost_usd`/`amount_usd` reais em vez de 0; painel "Uso de IA" ganha
  custo estimado hoje/7d por serviço (T8, D-V2-078).
- **fix(seo):** `llms.txt`/`llms-full.txt` ficaram fora do matcher de exclusão do
  middleware de auth (307 para `/login` em vez de 200) — corrigido, com teste HTTP
  e2e novo cobrindo as 6 rotas públicas do middleware (D-V2-079).
- **decision:** modelo LLM das 3 personas Tavus migrado de `tavus-glm-4.7`
  (depreciado) para `tavus-gemma-4` (D-V2-076); migração para RLS-por-claim (T13)
  avaliada e adiada por falta de ambiente de staging para provar isolamento de tenant.

## 2026-07-20 — Rate limiting, notificação de ativação e telemetria

- **feat(security):** rate limit por tenant nas RPCs caras (20 convites/dia, 30
  ingestões/dia), sem alterar comportamento existente.
- **feat(team):** e-mail aos admins do tenant quando um agente é ativado (best-effort).
- **feat(observability):** adapter único de telemetria com redação automática de PII;
  17 pontos de log ad-hoc consolidados, 4 testes novos.

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
