# CHANGELOG (resumo por onda — detalhes em PROGRESS.md e DECISIONS_LOG.md)

## 2026-08-06 — Onda W5: hardening de billing, acessibilidade e equipe

- **fix(billing):** checkout Stripe ganha idempotência (janela de 1min) + botão "Assinar"
  desabilita no primeiro clique — duplo clique/duas abas não geram mais duas assinaturas
  cobrando em paralelo. `existingStripeCustomerId` reaproveitado ao reassinar após
  cancelar. Webhook Stripe loga evento malformado dentro de escopo (antes: silêncio).
- **feat(equipe):** `portal_remove_member` — não existia forma de revogar acesso de um
  membro já aceito (só convite pendente tinha "Revogar"); guarda contra remover o último
  admin e contra auto-remoção.
- **fix(a11y):** sidebar mobile fechada sai da árvore de tabulação/leitor de tela
  (`visibility:hidden`); `--text-faint` corrigido pro mínimo AA (~4.1:1 → ~5.6:1).
- **docs(rls):** `database/rls-policy-matrix.md` corrigido — descrevia um mecanismo
  (`SET LOCAL app.tenant_id`) nunca implementado; a policy do kernel é código morto
  fail-closed (nunca foi vulnerabilidade), mas o doc lia como proteção ativa.
- **refactor:** dedup do padrão "ler config de vídeo do agente" (4 call sites → 1 helper,
  `lib/video-config.ts`) — o mesmo bug de fail-open tinha sido corrigido separadamente
  4 vezes ao longo de duas auditorias porque a lógica estava copiada.
- **feat(meetings):** e-mail aos admins quando reunião externa termina (ended/failed) —
  o evento de negócio mais importante do produto não notificava ninguém.
- **decision:** persistência de transcript/histórico de conversa (chat, vídeo, reunião
  externa) identificada como a lacuna de maior valor — documentada como próximo passo em
  vez de implementada nesta onda (feature nova de escopo maior, não bug; D-V2-105).

## 2026-08-05 — Página de venda publicada + fecho do backlog da auditoria (W4)

- **feat(venda):** /precos linkada na nav ("Planos") e no footer da landing + sitemap —
  a página de venda existia mas não era alcançável de lugar nenhum (D-V2-103).
- **fix(conhecimento):** digest de vídeo round-robin por fonte, recentes primeiro (0027) —
  antes, com 2+ fontes, a closer só via o começo da fonte mais antiga; piso de
  similaridade 0.25 no RAG do chat corta chunks irrelevantes de todo turno.
- **feat(custos):** custo faturado real do OpenRouter no ledger (`provider_reported`) +
  cost_event do bot Recall por sessão de reunião externa.
- **feat(meetings):** agendamento no fuso da CONTA (default_timezone do tenant) com
  conversão IANA genérica — "15:00" agora é 15:00 no relógio do dono; Flórida segue default.
- **feat(video):** modo réplica em inglês (saudação + contexto EN quando o agente é EN);
  "Copiar conversa" no chat de teste.
- **ci:** e2e roda contra `next build && next start` no CI — o build de produção passa a
  ser validado antes de todo deploy.
- **fix(framework):** o novo gate pegou NO PRIMEIRO RUN um hang intermitente de server
  actions no build de produção (bug do React empacotado no Next 16.2.x — usuário ficava
  com "Criando..." eterno): Next 16.2.10 → 16.3.0 + React 19.2.8, flake 50% → 0 em 3
  rodadas; router.refresh() explícito nos 5 componentes de mutação como hardening
  (D-V2-104).

## 2026-08-02/03 — Hardening autônomo + cobrança Stripe + fecho da auditoria

- **fix(auditoria):** rodada de hardening D-V2-100 (auditoria multi-agente, 44 achados,
  25 correções em 3 lotes): cérebro de vídeo destravado (prompt >10k vs cap de 4k do
  adapter), 4 caminhos de gasto sem teto fechados, percepção emocional priorizando o
  MAIS RECENTE, persona institucional protegida, resiliência de UI.
- **feat(billing):** cobrança real dos planos via Stripe (D-V2-101): Piloto/Crescimento/
  Escala, checkout, portal de assinatura, webhook assinado, overage por conversa via
  Billing Meters. Aguardando chaves + migrations 0025/0026 (gate humano) para ligar.
- **fix(fecho):** lote final da auditoria (D-V2-102): headers de segurança HTTP em
  produção (HSTS, nosniff, X-Frame-Options com exceção do palco do bot, Permissions-
  Policy delegando câmera/mic ao Daily), erros de login/cadastro em pt-BR com
  role="alert", aviso de demo indisponível, 404 em pt-BR, botão encerrar/copiar link na
  sala de vídeo, CTAs da landing com estado pendente + footer com termos/privacidade,
  painel "Reuniões externas" (RPC 0021 que estava órfã), ingestão funcionando no modo
  demonstração, DST da Flórida corrigido (2ª iteração), CI com concurrency group e
  heredoc quotado, e2e auto-reparável cobrindo /rosto-agente e /recuperar-senha,
  telemetria redigindo mensagens de erro de provider.

## 2026-08-01 — Domínio próprio + CI do e2e destravado

- **fix(domain):** `PORTAL_PUBLIC_URL` e `NEXT_PUBLIC_SITE_URL` atualizadas de volta pra
  `closer.axtroai.com` (domínio já conectado no Railway, mas as variáveis ainda apontavam
  pra raw URL) — e-mails, sitemap, `og:url` e canonical corrigidos e verificados ao vivo
  (D-V2-097).
- **fix(ci):** os 4 secrets do e2e cadastrados no GitHub, e dois bugs reais corrigidos que
  mantinham o CI inteiro quebrado desde D-V2-096 (`if` de job referenciando `secrets` —
  contexto não permitido, invalida o workflow inteiro; pacotes do monorepo não buildados
  antes do e2e). Validado com 2 runs completos numa branch de teste; `main` agora roda os
  5 jobs verdes, incluindo os 14 specs Playwright de verdade (D-V2-098).
- **chore(recall):** segundo endpoint de webhook cadastrado no dashboard do Recall.ai
  apontando pro domínio próprio, em paralelo ao endpoint antigo (raw URL do Railway) —
  nenhum removido, sanity check 401 confirmado no endpoint novo.
- **feat(security):** verificação de assinatura HMAC nos webhooks do Recall.ai
  (`webhook-id`/`webhook-timestamp`/`webhook-signature`, formato Standard Webhooks/Svix),
  somada ao token na URL já existente — opcional, fail closed quando configurada, janela
  anti-replay de 5min, suporta rotação de segredo. 9 testes novos (D-V2-099).

## 2026-07-31 — Reunião externa ao vivo + produto aberto para contratação

- **feat(cleanup):** exclusão de agente em rascunho e de fonte revogada (RPCs 0023 com
  guardas + dupla confirmação na UI) — limites de 20/50 não entopem mais (D-V2-095).
- **feat(legal):** /termos e /privacidade honestos, linkados no signup e sitemap,
  marcados para revisão jurídica formal.
- **test(e2e):** 14 specs — ciclos de vida completos de agente e fonte clique-a-clique.
- **ci(e2e):** job `e2e-portal` roda os 14 specs Playwright em todo PR/push contra fake
  providers + login demo real; pulado automaticamente sem os 4 secrets do GitHub
  (gate humano documentado em NEEDS_CONNECTION.md) — D-V2-096.

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
