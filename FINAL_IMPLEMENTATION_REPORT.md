# Relatório final de implementação — hardening autônomo 2026-08-02 (D-V2-100)

## 1. Resumo executivo

Rodada de auditoria-e-correção autônoma sobre um sistema que JÁ chegava
saudável (baseline 100% verde). Uma auditoria multi-agente de 6 dimensões
produziu 44 achados; os graves foram re-verificados manualmente no código e
**25 correções reais** foram implementadas, testadas e deployadas em 4
commits. O achado mais crítico: o cérebro customizado (M4) **nunca teria
funcionado em produção** — o prompt de vídeo (>10k chars) ia como uma única
mensagem system e o adapter rejeita >4k, degradando TODA chamada; corrigido
na raiz com eval de regressão que atravessa o validador real do adapter.
Quatro caminhos que gastavam dinheiro real sem teto foram fechados.

- Situação inicial: nota geral ~78 (funcional, mas com 7 P1s latentes de
  gasto/segurança e o cérebro custom quebrado por construção).
- Situação final: nota geral **84** (tabela completa em
  `docs/RELEASE_READINESS.md`), sem P0/P1 conhecido em aberto.

## 2. Implementações e correções (todas com estado explícito)

**Corrigido com teste automatizado (regressão nova):**
1. Prompt de vídeo fatiado sob o cap do adapter (P1 — destrava o brain).
2. Turno longo cortado (nunca rejeitado) na superfície de vídeo (P1 — loop
   permanente de fallback).
3. Injeção via tag de percepção em turno do usuário bloqueada (P1).
4. `conversational_context` (RAG de vídeo/deck/resumo da ligação) preservado
   como dado rotulado — antes era jogado fora.
5. Bloco de percepção mantém a leitura mais RECENTE ao truncar.
6. Teto diário de 500k tokens + rate limit 40/min no `/api/brain`,
   falha-fechado, com fala de encerramento localizada (P1).
7. Idioma da persona propagado ao cérebro (EN não falava mais pt-BR).
8. `degradedReason` + telemetria em toda degradação (antes catch vazio).
9. Agendado não cria mais sala Tavus que expiraria (P1); sala nasce no
   webhook quando o bot entra (claim atômica, rollback, custo logado).
10. Sala Tavus encerrada quando a criação do bot falha (P1 — sala órfã paga).
11. `automatic_leave` no bot Recall (P1 — bot-hora ilimitada).
12. Reunião externa incrementa teto/ledger de vídeo (P1 — cap nunca contava).
13. Teto diário + ledger + pin `RAISSA_VIDEO_AGENT_ID` no
    `/api/leads/video-session` (P1/P2 — gasto sem teto + sequestro de persona).
14. Migration **0024 aplicada**: `platform` fora do self-service; status
    terminal pegajoso; `portal_log_video_usage_service`.
15. Token do webhook em tempo constante + 401 unificado (P2 — oráculo).
16. Timeout dos 3 adapters cobre a leitura do corpo (P2).
17. Tavus tolera 204/corpo vazio como sucesso (P2).
18. Nome de lead >95 chars não derruba mais a criação da conversa (P3).
19. Eval golden reproduzível do caminho real do brain (gap de avaliação).

**Corrigido com validação manual (visual/navegador):**
20. `(app)/error.tsx` — falha transitória não derruba mais o workspace.
21. Erro de leitura da config de vídeo exposto (antes: réplica default
    silenciosa — degradação não declarada).
22. Botão Entrar visível na landing mobile (≤720px não tinha login).
23. Copy do "gate de provedores" fantasma corrigida (2 lugares).
24. Confirmações destrutivas desarmam em 5s; agendamento no passado
    rejeitado (server + min no input); watchdog de 45s no palco do rosto.

**Implementado e validado (novo, pedido do Fernando):**
25. Doutrina **Maestria Humana** — síntese 100% autoral de comportamento/
    persuasão/valor (sem texto de obra de terceiro), no prompt de vídeo
    (PT/EN, sob o teto de latência) e aplicada via PATCH nas 3 personas
    vivas; ética inegociável testada.

## 3. Testes e validações

`pnpm test` **532 Node + 26 Python** (baseline 515; +17 novos), typecheck,
lint, 9 validadores canônicos, `next build` (18/18), e2e 17 specs em CI.
QA visual mobile/desktop em modo demo (detalhe em `docs/QA_REPORT.md`).

## 4. Deploy e operação

Produção: Railway, domínio `closer.axtroai.com` (health verde pós-deploy).
Rollback: redeploy do commit anterior (procedimento já exercitado).
Migration 0024 aplicada no Supabase real e confirmada por leitura.
Env novas no Railway: `RAISSA_VIDEO_AGENT_ID` (pin da agente institucional).

## 5. Commits desta rodada

- `574f46b` doutrina Maestria Humana + baseline
- `e17c3d3` lote 1 — cérebro (9 correções + eval golden)
- `3b44d3d` lote 2 — reuniões/dinheiro (8 correções + 0024)
- `1374307` lote 3 — resiliência/UX (8 correções)
- (este commit) docs finais + relatório

## 6. Pendências e bloqueios externos (somente o que não pude resolver)

1. **Rewiring de persona real pro cérebro custom** — decisão de produto do
   Fernando (afeta calls reais). O cérebro agora está tecnicamente apto
   pela primeira vez.
2. **RAG no caminho do brain** — exige RPC `_service` de busca vetorial
   (próxima onda; gap declarado no código).
3. **Billing/preço** — não existe cobrança; decisão comercial pendente
   (doc da reunião de 30/07: "definir preço do produto de entrada").
4. **Validação humana da reunião agendada** — o fluxo sentinela completo
   (join_at → webhook → câmera) nunca rodou com uma reunião real.
5. **DPIA/jurídico da percepção emocional** — pendência externa herdada.

## 7. Veredito final

**Pronto para piloto controlado** (nível 3 de 5) — e a um passo de
"primeiros clientes": o que falta para o nível 4 não é engenharia de
produto, é decisão comercial (preço/cobrança) e uma validação humana do
fluxo de reunião agendada.
