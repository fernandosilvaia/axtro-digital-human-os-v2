# Prontidão de release — 2026-08-11 (pós D-V2-107: auditoria + lote de correções e alertas proativos de custo)

## Notas (0–100, com evidência — não é opinião)

| Dimensão | Nota | Evidência / o que segura a nota |
|---|---|---|
| Funcionalidade | 91 | Fluxos principais e2e verdes (CI, 15 specs, build de produção); reunião externa agendada nunca validada com humano real; **corrigido**: lockout de billing — status `unpaid`/`incomplete_expired`/`paused` travava a conta sem conseguir assinar nem gerenciar (D-V2-107, achado P1 confirmado por 3 verificadores) |
| Facilidade de uso | 85 | Demo 1-clique, auto-provisão, copy corrigida, checkout com estado pendente; checklist do dashboard trocou o item "sempre verdadeiro" por sinal real de engajamento (D-V2-107) |
| Onboarding | 80 | Signup→agente ativo em minutos; checklist agora mede "testou o agente no chat" (usage.services_7d) em vez de "conta existe" — ainda sem passo-a-passo guiado além do checklist |
| Design | 88 | Sistema visual consistente, validado mobile+desktop; `/precos` linkada na nav/footer/sitemap |
| Mobile | 87 | Landing e workspace verificados 375px; sidebar fechada fora da árvore de tabulação/leitor de tela (D-V2-105) |
| Acessibilidade | 80 | Labels/aria nos forms, aria-live no chat, sidebar mobile não-tabulável quando fechada, contraste de `--text-faint` em AA (D-V2-105) |
| Frontend | 88 | Error boundary do workspace + **novo**: error boundary das rotas públicas de auth (/login, /signup, /recuperar-senha, /nova-senha — D-V2-107, chamam Supabase Auth direto e antes caíam na tela crua do Next em inglês) |
| Backend | 91 | Ports/adapters, falha-fechada, idempotência nos caminhos críticos; billing.ts e a UI de /configuracoes agora usam a MESMA classificação de status de assinatura (D-V2-107) |
| Banco | 91 | RLS forçada 100% nas tabelas novas, guard monotônico de status; `tenant_isolation` das tabelas do kernel documentado corretamente como código morto (D-V2-105) |
| Segurança | 91 | Sem P0; auditoria adversarial 2026-08-11 confirmou 2 P1 (lockout de billing, /privacidade desatualizada pós D-V2-106) e 1 P2 real (SECRET_PATTERN não cobria formato de chave Stripe), todos corrigidos na mesma rodada; riscos residuais em SECURITY_REVIEW |
| Performance | 80 | Build ok, rotas dinâmicas enxutas; sem medição formal de p95 web |
| Confiabilidade | 87 | Degradação declarada em todo caminho; watchdogs; telemetria de fallback; **corrigido**: healthcheck do Railway apontava pra `/login` (página 100% estática, nunca detectaria um deploy com env var de Supabase quebrada) — agora aponta pra `/api/health` (D-V2-107) |
| Custos | 91 | Todo caminho pago com teto + ledger; catálogo de teste (1 Meter + 3 Products + 6 Prices) provisionado de verdade na Stripe e validado contra a API real; **novo**: alertas proativos por e-mail em 80%/100% dos 4 tetos diários (D-V2-107, migration 0031 escrita — falta aplicar) |
| IA | 86 | Eval golden pelo adapter real; injeção de percepção fechada; RAG do brain pendente |
| Integrações | 87 | Tavus/OpenRouter/Recall com timeout/erros tipados/testes; Stripe com idempotência de checkout — chave de teste validada contra a API real (GET /v1/balance, 2026-08-10), catálogo real criado; checkout ponta a ponta ainda não rodado (falta env var no Railway) |
| Testes | 91 | 611 Node + 26 Py + 15 e2e em CI contra build de produção; **novo**: e2e do caminho de LEITURA do histórico de conversa (/conversas, /conversas/[id]) — não existia nenhum, achado da auditoria e fechado na mesma rodada (D-V2-107), que por sua vez expôs e corrigiu um bug real: modo demonstração nunca registrava transcript |
| Observabilidade | 87 | Logs estruturados com redaction (agora cobrindo também formato de chave Stripe); telemetria de degradação; **alerta proativo de custo implementado** (D-V2-107) — era o principal gap desta dimensão |
| Infraestrutura | 87 | Railway + domínio próprio (`closer.axtroai.com`) + healthcheck real (`/api/health`, corrigido de `/login` — D-V2-107); rollback = redeploy de commit anterior |
| Prontidão comercial | 91 | Cadastro→uso→limites→legal→preço→checkout→cobrança ok em código, migrations 0025-0030 aplicadas, catálogo Stripe teste real provisionado, lockout de billing corrigido; falta só as env vars no Railway + 1 assinatura de teste ponta a ponta antes de considerar o funil fechado |
| **Geral** | **88** | |

## O que bloqueia cada nível seguinte

- **Primeiros clientes pagantes**: ~~(1) criar conta Stripe e rodar `scripts/stripe_setup.mjs` em modo teste~~ — feito 2026-08-10 (Meter + 3 Products + 6 Prices reais, `livemode: false` confirmado). (2) configurar `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`/6 price ids no Railway (bloqueado — ação em infraestrutura compartilhada, aguardando o Fernando colar no dashboard); (3) fazer uma assinatura de teste ponta a ponta (checkout → webhook → painel mostrando o plano) antes de cobrar de cliente de verdade; (4) 1 reunião externa agendada validada com humano; (5) aplicar a migration 0031 (alertas de custo) — escrita, aguardando autorização. As migrations 0025-0030 já estão aplicadas no Supabase hospedado.
- **Escala inicial**: migrar Stripe de modo teste pra produção (gate humano — chave `sk_live_`); ~~alertas proativos de custo~~ — implementado (D-V2-107, migration 0031 pendente de aplicação); DPIA percepção; bake-off formal de providers (D-V2-048); RAG no cérebro custom. ~~Persistência de transcript/histórico de conversa~~ — implementada e em produção (D-V2-106).
