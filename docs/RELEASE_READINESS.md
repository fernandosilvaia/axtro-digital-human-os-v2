# Prontidão de release — 2026-08-03 (pós-hardening D-V2-100 + billing D-V2-101)

## Notas (0–100, com evidência — não é opinião)

| Dimensão | Nota | Evidência / o que segura a nota |
|---|---|---|
| Funcionalidade | 88 | Fluxos principais e2e verdes (CI, 17 specs); reunião externa agendada nunca validada com humano real |
| Facilidade de uso | 82 | Demo 1-clique, auto-provisão, copy corrigida; sem onboarding guiado passo-a-passo |
| Onboarding | 78 | Signup→agente ativo em minutos; sem checklist de primeiros passos |
| Design | 88 | Sistema visual consistente, validado mobile+desktop; `/precos` nova segue o mesmo sistema |
| Mobile | 84 | Landing e workspace verificados 375px; login mobile corrigido |
| Acessibilidade | 70 | Labels/aria nos forms, aria-live no chat; sidebar inert e sr-only por fazer |
| Frontend | 85 | Error boundary, estados tratados, hidratação limpa |
| Backend | 88 | Ports/adapters, falha-fechada, idempotência nos caminhos críticos (agora incluindo cobrança) |
| Banco | 90 | RLS forçada 100%, guard monotônico de status (meeting bot E agora assinatura) |
| Segurança | 88 | Sem P0; P1s da auditoria de produto E os 4 P1 da revisão de billing corrigidos; riscos residuais declarados em SECURITY_REVIEW |
| Performance | 80 | Build ok, rotas dinâmicas enxutas; sem medição formal de p95 web |
| Confiabilidade | 85 | Degradação declarada em todo caminho; watchdogs; telemetria de fallback |
| Custos | 89 | Todo caminho pago com teto + ledger; **agora com mecanismo de cobrança real** (Stripe, planos com minutos incluídos + overage) — falta aplicar as migrations e configurar chaves reais |
| IA | 86 | Eval golden pelo adapter real; injeção de percepção fechada; RAG do brain pendente |
| Integrações | 85 | Tavus/OpenRouter/Recall com timeout/erros tipados/testes; **Stripe novo** (checkout, portal, webhook, overage metering — testado com fakes, nunca contra a API real) |
| Testes | 89 | 563 Node + 26 Py + 17 e2e em CI (+31 novos testes de billing) |
| Observabilidade | 80 | Logs estruturados com redaction, telemetria de degradação; sem alerta proativo |
| Infraestrutura | 85 | Railway + domínio próprio + health; rollback = redeploy de commit anterior |
| Prontidão comercial | 87 | Cadastro→uso→limites→legal→**preço→checkout→cobrança** ok em código; bloqueado por 3 coisas externas: aplicar migrations 0025/0026, chave Stripe real (mesmo que teste) e provisionar o catálogo de preços na Stripe |
| **Geral** | **86** | |

## O que bloqueia cada nível seguinte

- **Primeiros clientes pagantes**: (1) aplicar `0025_fix_cost_events_conversation_unit_type.sql` e `0026_tenant_subscriptions.sql` no Supabase real (autorização pendente do Fernando); (2) criar conta Stripe e rodar `scripts/stripe_setup.mjs` em modo teste pra gerar os price ids; (3) configurar `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`/price ids no Railway; (4) fazer uma assinatura de teste ponta a ponta (checkout → webhook → painel mostrando o plano) antes de cobrar de cliente de verdade; (5) 1 reunião externa agendada validada com humano.
- **Escala inicial**: migrar Stripe de modo teste pra produção (gate humano — chave `sk_live_`); alertas proativos de custo/erro; DPIA percepção; bake-off formal de providers (D-V2-048); RAG no cérebro custom; constraint `unique` em `stripe_customer_id` antes de qualquer fluxo de troca de customer.
