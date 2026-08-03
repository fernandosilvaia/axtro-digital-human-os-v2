# Estado da execução autônoma — hardening 2026-08-02 (D-V2-100)

**Fase atual:** concluída (relatório final entregue).

## Ciclos executados

1. **Baseline** — gates 100% verdes na largada (515 Node + 26 Py, typecheck,
   lint, 9 validadores, build, produção saudável em closer.axtroai.com).
   Registrado em `AUDIT_BASELINE.md`.
2. **Doutrina Maestria Humana** — módulo autoral (sem texto de livro de
   terceiro), aplicado no código e nas 3 personas vivas via PATCH.
3. **Auditoria multi-agente** — 6 finders paralelos, 44 achados; verificação
   adversarial automática caiu no limite de sessão → cada P1/P2 corrigido
   foi re-verificado manualmente no código antes da correção.
4. **Lote 1 (cérebro)** — 9 correções, eval golden novo.
5. **Lote 2 (reuniões/dinheiro)** — 8 correções + migration 0024 APLICADA +
   `RAISSA_VIDEO_AGENT_ID` no Railway.
6. **Lote 3 (resiliência/UX)** — 8 correções.
7. **QA navegador** (mobile+desktop, modo demo) + gates finais + deploy +
   smoke de produção.

## Decisões arquiteturais registradas

- Percepção só de mensagens system (anti-injeção) — Art. 15.
- Teto de gasto falha-fechado em TODO caminho servidor-a-servidor pago.
- Sala Tavus de agendamento criada só no in_call do bot (webhook), com
  claim atômica e rollback.
- `platform` presentation_kind fora do self-service (0024).
- Rate limit do brain em memória: aceito como melhor-esforço por instância;
  o teto no ledger é a proteção dura.

## Achados NÃO corrigidos nesta rodada (com justificativa)

- P2 #27 (tool_calls no SSE do brain): o prompt já se auto-neutraliza sem
  deck no contexto; suporte a tool_call no stream é feature, não bug — fila.
- P3s remanescentes da auditoria: sidebar inert/Esc (a11y), sr-only nas
  bolhas do chat, testes de createPersona/attachTools, cap atômico,
  hasKnowledge no prompt de vídeo, log de embedding em falha de ingestão —
  registrados aqui como fila priorizada da próxima onda.

## Bloqueios externos

- Persona real apontando pro cérebro custom (`layers.llm.base_url`) — gate
  humano do Fernando (decisão de produto, afeta calls reais).
- RAG no caminho do brain (RPC `_service` de busca vetorial) — próxima onda.
- DPIA/jurídico da percepção emocional — pendência externa de venda.

## Próximo passo sugerido

Testar o cérebro custom de ponta a ponta numa call real de teste (agora que
o P1 do prompt está corrigido, é a primeira vez que ele PODE funcionar), e
então decidir o rewiring de uma persona.
