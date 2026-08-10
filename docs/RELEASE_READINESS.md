# Prontidão de release — 2026-08-06 (pós-onda W5: billing hardening + a11y + RLS + limpeza de equipe)

## Notas (0–100, com evidência — não é opinião)

| Dimensão | Nota | Evidência / o que segura a nota |
|---|---|---|
| Funcionalidade | 90 | Fluxos principais e2e verdes (CI, 18 specs, build de produção); reunião externa agendada nunca validada com humano real; remoção de membro fecha o último buraco de gestão de equipe |
| Facilidade de uso | 84 | Demo 1-clique, auto-provisão, copy corrigida, checkout com estado pendente; sem onboarding guiado passo-a-passo |
| Onboarding | 78 | Signup→agente ativo em minutos; sem checklist de primeiros passos |
| Design | 88 | Sistema visual consistente, validado mobile+desktop; `/precos` linkada na nav/footer/sitemap (estava despublicada na prática) |
| Mobile | 87 | Landing e workspace verificados 375px; sidebar fechada agora sai da árvore de tabulação/leitor de tela (D-V2-105) |
| Acessibilidade | 80 | Labels/aria nos forms, aria-live no chat, sidebar mobile não-tabulável quando fechada, contraste de `--text-faint` corrigido pra AA (D-V2-105) |
| Frontend | 87 | Error boundary, estados tratados, hidratação limpa, dedup do padrão de leitura de config de vídeo (4 call sites → 1 helper) |
| Backend | 90 | Ports/adapters, falha-fechada, idempotência nos caminhos críticos incluindo checkout Stripe (D-V2-105 — achado real: faltava desde D-V2-101) |
| Banco | 91 | RLS forçada 100% nas tabelas novas, guard monotônico de status; achado arquitetural fechado — `tenant_isolation` das tabelas do kernel é código morto documentado corretamente (nunca foi vulnerabilidade, D-V2-105) |
| Segurança | 90 | Sem P0; P1 de checkout duplicado (Stripe) e gap de remoção de membro fechados nesta onda; riscos residuais declarados em SECURITY_REVIEW |
| Performance | 80 | Build ok, rotas dinâmicas enxutas; sem medição formal de p95 web |
| Confiabilidade | 86 | Degradação declarada em todo caminho; watchdogs; telemetria de fallback; webhook Stripe não descarta mais evento malformado em silêncio |
| Custos | 89 | Todo caminho pago com teto + ledger; mecanismo de cobrança real (Stripe) com migrations 0025-0028 aplicadas — falta só a chave real (mesmo que teste) |
| IA | 86 | Eval golden pelo adapter real; injeção de percepção fechada; RAG do brain pendente |
| Integrações | 87 | Tavus/OpenRouter/Recall com timeout/erros tipados/testes; Stripe com idempotência de checkout — testado com fakes, nunca contra a API real |
| Testes | 90 | 580+ Node + 26 Py + 18 e2e em CI contra build de produção (+10 novos testes de idempotência/config de vídeo/webhook) |
| Observabilidade | 82 | Logs estruturados com redaction, telemetria de degradação; webhook Stripe agora sinaliza evento malformado dentro de escopo; sem alerta proativo |
| Infraestrutura | 85 | Railway + domínio próprio + health; rollback = redeploy de commit anterior |
| Prontidão comercial | 89 | Cadastro→uso→limites→legal→preço→checkout→cobrança ok em código, migrations aplicadas; bloqueado só pela chave Stripe real (mesmo que teste) e provisionar o catálogo de preços na Stripe |
| **Geral** | **87** | |

## O que bloqueia cada nível seguinte

- **Primeiros clientes pagantes**: (1) criar conta Stripe e rodar `scripts/stripe_setup.mjs` em modo teste pra gerar os price ids; (2) configurar `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`/price ids no Railway; (3) fazer uma assinatura de teste ponta a ponta (checkout → webhook → painel mostrando o plano) antes de cobrar de cliente de verdade; (4) 1 reunião externa agendada validada com humano. As migrations 0025-0028 já estão aplicadas no Supabase hospedado.
- **Escala inicial**: migrar Stripe de modo teste pra produção (gate humano — chave `sk_live_`); alertas proativos de custo/erro; DPIA percepção; bake-off formal de providers (D-V2-048); RAG no cérebro custom. ~~Persistência de transcript/histórico de conversa~~ — implementada e em produção (D-V2-106, 2026-08-10): tabela `conversation_transcripts` + 5 RPCs, captura nas 3 superfícies (chat/vídeo/reunião externa), tela `/conversas`.
