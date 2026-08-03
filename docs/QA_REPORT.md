# QA — rodada de hardening 2026-08-02 (D-V2-100)

## Suítes automatizadas (executadas nesta máquina, nesta rodada)

| Suíte | Resultado |
|---|---|
| Node (`pnpm test`) | **532/532 verdes** (baseline era 515 — 17 testes novos nesta rodada) |
| Python | 26/26 verdes |
| Typecheck (`tsc --build --force`) | limpo |
| Lint | limpo |
| Validadores canônicos (9) | verdes (docs, contratos, DB, secret scan, dependency scan) |
| Build de produção Next | ✓ 18/18 páginas |
| E2E Playwright (17 testes) | roda em CI a cada push (D-V2-096/098); inclui teste HTTP real das rotas públicas e das rotas `/api/*` |

## Testes novos desta rodada (regressão dos achados)

- `brain-video-golden.test.mjs` — eval reproduzível: requisição shaped como
  o Tavus manda atravessa parser → núcleo → **validador real do adapter**
  (fetch fake); prova caps por mensagem, sobrevivência do contexto, bloqueio
  de tag de percepção forjada e truncamento de turno gigante.
- `brain-chat-completion-core` — split do prompt de vídeo sob o cap; corte
  (nunca rejeição) na superfície de vídeo; bloco de contexto do provider;
  recência na percepção.
- `brain-handle-chat-request` — teto esgotado/ilegível falha-fechado sem
  gerar; fallbacks localizados PT/EN; degradedReason em toda degradação.
- `brain-tavus-request` — percepção só de system; providerContext preservado
  com recência.
- `meetings-join-meeting` — agendado sem sala; sala encerrada quando o bot
  falha; falha do encerramento não engole a falha primária.
- `providers/recall` — `automatic_leave` no payload oficial.
- `brain-maestria-humana` — doutrina presente nos 2 idiomas, ética
  inegociável, teto de latência respeitado.

## Verificação visual no navegador (modo demo, sem provider pago)

| Fluxo | Viewport | Resultado |
|---|---|---|
| Landing | 375×812 | ✅ hero legível, CTAs empilhados, **botão Entrar visível** (regressão corrigida nesta rodada) |
| Landing | 1280×720 | ✅ sem erro de console |
| Login demo → dashboard | 375×812 | ✅ métricas empilhadas, menu hambúrguer |
| Agentes (lista, ativar/pausar/excluir) | 1280×720 | ✅ Raissa renomeada, exclusão só em rascunho |
| Console do navegador | ambos | ✅ zero erros |

## Não executado nesta rodada (declarado)

- Playwright local (roda em CI; não repetido na máquina).
- Firefox/WebKit (projeto configura Chromium; sem suporte configurado para os demais — nenhuma alegação de compatibilidade é feita).
- Chamada de vídeo REAL com câmera/microfone (exige humano; a última validação ao vivo foi D-V2-093 — áudio do bot em reunião real).
- Leitores de tela (não verificado; sr-only do chat segue como melhoria futura).
