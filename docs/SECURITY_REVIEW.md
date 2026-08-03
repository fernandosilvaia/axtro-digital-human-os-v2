# Revisão de segurança — rodada de hardening 2026-08-02 (D-V2-100)

> Método: 6 finders read-only paralelos (workflow multi-agente) sobre rotas
> `/api/*`, callers do service-role, migrations 0018–0024, adapters de
> provider e prompts de IA; cada achado P0/P1 re-verificado manualmente no
> código antes de qualquer correção. Nenhum P0 encontrado.

## Corrigido nesta rodada (com teste automatizado, salvo indicação)

| Achado | Severidade | Correção |
|---|---|---|
| Sequestro da persona institucional: RPC 0022 aceitava `presentation_kind='platform'` de qualquer tenant_admin e a resolução em `/api/leads/video-session` pegava linha arbitrária | P1 | Migration **0024** (aplicada): `platform` fora do self-service; rota pina a agente por `RAISSA_VIDEO_AGENT_ID` (setada no Railway) com fallback determinístico |
| `/api/brain` sem teto de gasto nem rate limit (chave OpenRouter da plataforma) | P1 | Teto diário 500k tokens/tenant lido do ledger, falha-fechada, ANTES de gerar + rate limit 40 req/min por agente; fala de encerramento localizada |
| `/api/leads/video-session` sem teto de conversas | P1 | Teto diário próprio (20/dia, falha-fechada) + custo agora entra no ledger via `portal_log_video_usage_service` |
| Reunião externa não incrementava o teto/ledger de vídeo | P1 | `portal_log_video_usage` chamado no sucesso; custo visível no painel |
| Bot Recall sem `automatic_leave` e sem call site de `leaveCall` — bot-hora ilimitada | P1 | `automatic_leave` explícito no payload (teto duro ≤40min em call) |
| Injeção de percepção: tag `<user_*>` em turno do usuário era promovida a mensagem system | P1 | Percepção só é coletada de mensagens system (papel do raven-1); tag forjada é descartada — coberto no eval golden |
| Token do webhook Recall comparado com `!==` + respostas 401 distintas (oráculo) | P2 | `constantTimeEquals` compartilhado + corpo 401 unificado |
| Regressão de estado terminal via retry/replay do webhook | P2 | Migration 0024: estados `ended`/`failed` pegajosos |
| Sala Tavus paga ficava aberta se a criação do bot falhasse | P1 | `endConversation` best-effort no caminho de erro (testado) |
| Fluxo agendado criava sala Tavus que expirava antes do horário | P1/P2 | Sala só nasce quando o bot entra (webhook liga a câmera, claim atômica anti-corrida com rollback) |

## Verificado e OK (sem mudança necessária)

- RLS forçada + acesso só por RPC `SECURITY DEFINER` com `auth.uid()` em todas as tabelas de tenant (advisor Supabase revisado nas rodadas anteriores; WARNs `authenticated_security_definer_function_executable` são o padrão intencional documentado).
- Rotas `/api/*` fora do middleware de sessão por design — cada uma com autenticação própria por segredo (bearer/token), testada com HTTP real no e2e.
- Segredos nunca em código/logs: redaction de `telemetry.ts` testada; secret scan verde no gate canônico.
- HMAC do webhook Recall (Standard Webhooks) com tolerância anti-replay ±5min, comparação constant-time, rotação de segredo suportada (testes dedicados).
- Comparação de bearer do video-session já era constant-time (agora via helper único).

## Riscos remanescentes (declarados, não corrigidos nesta rodada)

1. **Rate limit do brain é em memória por instância** — com réplicas no Railway vira melhor-esforço; a proteção dura de gasto é o teto diário no ledger (esse é cross-instância). Aceito.
2. **`checkVideoCap` é read-then-act** (não atômico): requisições concorrentes podem passar juntas e estourar o teto em ±poucas unidades. Impacto baixo (teto é soft-budget); correção ideal é RPC atômica única — registrado como melhoria futura.
3. **DPIA / validação jurídica por jurisdição da percepção emocional** segue pendência externa (PENDENCIAS_EXTERNAS.md) — pré-requisito para venda a mercados regulados, não para piloto controlado.

## Revisão de segurança — cobrança Stripe (D-V2-101, 2026-08-03)

> Método: 4 finders read-only paralelos (webhook auth, isolamento de tenant/
> dinheiro, corretude/idempotência de cobrança, segredos/config) sobre todo
> o código novo de billing; achados P0/P1 verificados adversarialmente por 3
> revisores independentes cada (maioria decide). 4 achados P1 confirmados
> (nenhum P0), todos corrigidos nesta mesma rodada.

| Achado | Severidade | Correção |
|---|---|---|
| `plan_id` gravado só a partir de `metadata` da assinatura Stripe — nunca reescrita pela Stripe quando o cliente troca de plano pelo Customer Portal (o único caminho de troca do produto), então upgrade/downgrade cobrava/liberava o plano ERRADO indefinidamente | P1 | Webhook agora resolve o plano pelo **price id** do item licensed (`resolvePlanId` em route.ts, contra `STRIPE_PRICE_*_BASE`); metadata vira só fallback de última instância, com telemetria quando usado |
| `startCheckout`/`openBillingPortal` sem checagem de papel no servidor — o botão só some da UI pra quem não é admin, mas a Server Action é POST-ável direto por qualquer membro autenticado do tenant | P1 | `overview.role !== "tenant_admin"` checado nas duas ações, mesmo padrão das RPCs administrativas (`portal_invite_member`) |
| `reportConversationOverageIfNeeded` engolia erro de leitura do `portal_billing_status` (só destructurava `data`) — falha transitória virava "nada a reportar" em silêncio, uma conversa que É overage nunca era cobrada nem ficava visível | P1 | Erro agora checado e telemetrado, mesma disciplina de `checkVideoCap` |
| Guarda anti-chave-de-produção do `scripts/stripe_setup.mjs` só bloqueava `sk_live_`; chaves restritas `rk_live_` (igualmente válidas em produção pros endpoints que o script chama) passavam batido | P1 | Guarda estendida pra bloquear `rk_live_` também |

**Corrigido também (P2, achado em duas dimensões independentes — entrega fora de ordem de webhook agora tem consequência financeira, não só de estado):** migration 0026 ganhou `last_event_created_at` + guarda monotônica no upsert (`WHERE excluded.last_event_created_at >= tenant_subscriptions.last_event_created_at`) — replay/retry de um evento mais velho vira no-op, nunca regride o plano/status já aplicado por um evento mais novo. O parser (`webhook.ts`) também parou de usar `items[0]` como fallback quando nenhum item vem marcado "licensed" — período e price id ficam `null` em vez de herdar silenciosamente o item de overage (Art. 14).

### Riscos de billing remanescentes (declarados, não corrigidos)

1. **`stripe_customer_id` sem constraint `unique`** — nada no banco impede duas linhas de tenant compartilharem o mesmo customer id; hoje inofensivo (`existingStripeCustomerId` do provider-stripe não tem nenhum caller real ainda), mas deve ganhar `unique` antes de qualquer fluxo de troca de customer ser implementado.
2. **`ACTIVE_STATUSES` trata `past_due` como plano ativo** — decisão intencional de dar um período de graça durante retry de pagamento da Stripe (dunning), mas o período de graça é o que a Stripe decidir (pode ser dias a semanas); se isso não for a intenção, vale limitar por tempo.
3. **Sem Idempotency-Key na criação da Checkout Session** (só `reportOverageUsage` tem) — pior caso de duplo-submit é uma Checkout Session Stripe abandonada extra, não cobrança duplicada (o guard "já assinante" impede uma segunda assinatura completa).
4. **`race` de `checkVideoCap` (item 2 acima) agora tem uma consequência financeira nova**: duas conversas concorrentes bem na fronteira do incluído podem as duas ler "allowed" quando uma delas deveria ser overage. Sem reconciliação automática ainda — a fonte de verdade de custo real (`cost_events`) sempre existe e permite auditoria manual se necessário.
