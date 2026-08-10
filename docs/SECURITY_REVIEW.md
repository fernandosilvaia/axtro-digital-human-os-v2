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

## Revisão de segurança — histórico de conversa (D-V2-106, 2026-08-10)

> Método: workflow multi-agente — 4 finders read-only paralelos (isolamento
> de tenant nas RPCs novas, autenticação dos 2 webhooks, validação/injeção
> no conteúdo capturado, custo/config) sobre `conversation_transcripts` e
> os 3 pontos de integração (chat sandbox, vídeo Tavus, reunião externa
> Recall.ai); achados `P0`/`P1` levados a 3 verificadores adversariais
> independentes cada, maioria decide. Resultado: **3 achados confirmados
> (1×P0, 2×P1), mesma causa raiz, 0 refutados** — mais 18 achados menores.

| Achado | Severidade | Correção |
|---|---|---|
| Índice único de idempotência era só `(tenant_id, surface, external_ref)` — mas `portal_append_transcript_turns_service` (chamada pelos webhooks Tavus/Recall, sem `auth.uid()`) resolve a linha a atualizar **sem `tenant_id` no WHERE**, contando com a suposição implícita de que só existe UMA linha por `(surface, external_ref)` no banco inteiro. Sem uma garantia de banco pra isso, dois tenants podiam colidir num mesmo `external_ref` (corrida, ou um tenant autenticado chamando a RPC de upsert com um id de conversa/bot adivinhado ou vazado de outro tenant) e o próximo webhook sobrescreveria as duas linhas em silêncio — vazando o histórico de um lead pro painel de um tenant que não é dono da conversa | P0/P1 (3 dimensões independentes convergiram na mesma causa) | Índice único **global** parcial `conversation_transcripts_global_surface_ref_idx` em `(surface, external_ref) WHERE surface IN ('video','meeting')` — mesma disciplina já usada em `meeting_bot_sessions_recall_bot_id_idx` (0021) pra essa mesma classe de id gerado por provider sob uma única chave de API compartilhada da plataforma (genuinamente global, nunca escolhido pelo tenant). `chat` fica de fora de propósito: seu `external_ref` é client-gerado e a escrita já é 100% tenant-scoped via `auth.uid()`, nunca passa pelo caminho tenant-less do webhook. Somado a uma guarda defensiva: se `row_count > 1` mesmo assim (bug futuro, dado legado), a RPC **recusa** com exceção em vez de escrever por cima de mais de uma linha em silêncio |
| `turns` (conteúdo potencialmente vindo de webhook externo) só validava `jsonb_typeof(...) = 'array'` — sem teto de tamanho nem shape dos elementos, um payload malformado do provider (ou uma chamada direta da RPC autenticada) podia gravar lixo que quebraria a tela de detalhe (dado não-validado renderizado direto em `/conversas/[id]`) | P2 | `app.validate_transcript_turns(p_turns)` — valida teto de 1000 turnos e shape de cada elemento (`role` em `user`/`assistant`, `content` string de 1 a 8000 chars) — chamada nas duas RPCs de escrita antes de qualquer INSERT/UPDATE |
| `downloadTranscript` (provider-recall) bufferiza a resposta inteira (`response.text()`) ANTES de checar o teto de tamanho (`MAX_TRANSCRIPT_BYTES`) — uma URL de download que devolvesse um corpo gigante seria segurada inteira em memória antes de ser rejeitada | P2 | Checagem de `Content-Length` ANTES de bufferizar, como primeira linha de defesa (não blinda 100% — um servidor podia mentir no header — mas corta o caso comum); o teto pós-buffer continua como rede de segurança final |

**Verificado e aceito sem correção (achados menores, 18 no total — destaques):**

- **Match de papel (assistant/user) na transcrição de reunião externa é por NOME** (`block.participantName === agentName`), porque a Recall.ai não devolve um `role` explícito por bloco como o Tavus devolve — achado 3× independentemente. Um participante que renomeia a si mesmo pra bater exatamente com o nome do agente sai marcado como `assistant`. `isHost` não é sinal melhor (o bot normalmente entra como convidado, não host). Corrigir de verdade exigiria capturar o `participant_id` do PRÓPRIO bot via evento de participante em tempo real durante a call — fora do escopo desta rodada; documentado como limitação conhecida no código (`apps/portal/src/app/api/recall/webhook/route.ts`). Impacto aceito: pior caso é um rótulo trocado numa tela de leitura, nunca vaza dado entre tenants nem abre acesso indevido.
- **`tavusWebhookCallbackUrl()` cai pra uma URL de produção hardcoded quando `PORTAL_PUBLIC_URL`/`NEXT_PUBLIC_SITE_URL` não estão setadas** — mesmo padrão já usado em 7+ outros pontos do projeto (`site.ts`, `email.ts`, `billing.ts`, `meetings/stage.ts`, `knowledge.ts`, `chat/completions/route.ts`, `agent-preview.ts`). Decisão deliberada de NÃO divergir só este arquivo do padrão estabelecido: o projeto roda como um único deploy de produção no Railway, sem ambiente de staging separado — o fallback nunca diverge da URL real em prática.
- Transcrição de reunião externa (Recall.ai, US$0,15/hora) não entra no ledger `cost_events` ainda — gap honestamente declarado, ver `docs/COST_OPTIMIZATION.md`.
- Demais 15 achados: nomenclatura, comentários, sugestões de teste adicional — sem risco de segurança, não rastreados individualmente aqui.

Pipeline após as correções: 594 Node + 26 Python, typecheck, lint, 9 validadores, `next build` — tudo verde. Migrations 0029/0030 aplicadas em produção e confirmadas via `execute_sql` (tabela + índice único global + as duas RPCs de escrita chamando o validador).
