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
3. **Idempotência do webhook por `webhook-id` não persistida** — o guard monotônico de status cobre o dano real (regressão); replay dentro da janela de 5min de um evento não-terminal é inofensivo por construção.
4. **DPIA / validação jurídica por jurisdição da percepção emocional** segue pendência externa (PENDENCIAS_EXTERNAS.md) — pré-requisito para venda a mercados regulados, não para piloto controlado.
