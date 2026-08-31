# Current Provider Matrix

**Data de consulta geral:** 2026-07-14. **Atualização focal de e-mail:** 2026-08-31.
Ver `docs/sources/SOURCE_REGISTER.md` e `docs/operations/PROVIDER_CAPABILITY_VERIFICATION_2026-07-14.md`.

Esta matriz registra candidates e capacidades públicas. Não é uma decisão de produção.

| Layer | Candidate | Confirmado publicamente | Restrição conhecida | Precisa benchmark |
|---|---|---|---|---|
| Realtime room | LiveKit | agents participam de rooms; transport, turns e avatar plugins | custos e cold start dependem do plano | PT-BR latency, região, quotas, reconexão |
| Turn detection | LiveKit Audio/Text Turn Detector | sinais semânticos e acústicos; suporte multilíngue incluindo português | uso com S2S pode exigir STT adicional e custo extra | falso corte, barge-in, ruído, sotaques |
| Realtime S2S | OpenAI Realtime | live audio, tools, WebRTC/WebSocket e server controls | sessão máxima documentada de 60 minutos | rollover, custo real, interruption, exact capture |
| External meeting | Recall.ai | webpage output media publica áudio e vídeo em Zoom, Meet, Teams e Webex | waiting room, browser runtime e compute variam | GPU, long call, admission, reconexão |
| Avatar | Tavus | conversational video, replicas, planos e concorrência publicados | custo e capacidade dependem do plano | lip sync, listening, cancelamento, PT-BR, termos |
| Avatar | LiveKit-supported alternatives | múltiplos plugins atuais | maturidade e SDK variam | bake-off com pelo menos dois candidates |
| STT | Deepgram Flux Multilingual | streaming, turn detection e preço público | modelo e promoção podem mudar | nomes, ruído, endpointing, exact capture |
| TTS | ElevenLabs Flash/Turbo | API TTS e preço por caracteres publicados | custo por voz e plano pode variar | PT-BR, pronúncia, latência, interrupção |
| TTS | Cartesia | realtime TTS disponível | termos e qualidade variam por modelo | PT-BR, cancelamento, custo efetivo |
| Telephony | Telnyx | Voice API e SIP possuem pricing separado | tarifa SIP depende de destino e direção | rotas, qualidade, AMD, transferências |

## Exclusions atuais

Hedra aparece como deprecated na documentação atual do LiveKit. Não entra na shortlist, salvo nova evidência oficial e ADR posterior.

## Regra de decisão

Nenhum provider é default definitivo nesta fase. M2-13 deve registrar `continue`, `tune`, `replace` ou `blocked`, com evidência de qualidade, custo, privacidade, confiabilidade e fallback.

## M2-13: decisão registrada (2026-07-15)

Todas as linhas desta matriz permanecem `blocked` para promoção: a sessão
que implementou M2-01 a M2-12 foi inteiramente fake-first, sem credencial
real e sem chamada de rede externa. Nenhum candidate foi executado contra
seu SDK real. Ver `artifacts/m2/DECISION.md` para o veredito completo por
candidate e por área de arquitetura, e `artifacts/m2/evidence.json` para a
evidência fake que sustenta as decisões de arquitetura (não de provider).
Nenhuma linha desta tabela muda de "precisa benchmark" para aprovada.

## Notification delivery, M6-01

Atualização focal verificada em 2026-08-31. Resend é o adapter já existente para e-mail transacional, não uma decisão do bake-off realtime M2-13. A documentação oficial confirma chave idempotente por 24 horas, batch com um ID por mensagem aceita e eventos posteriores por webhook. M6-01 envia uma mensagem separada por administrador, nunca um array visível de endereços, e distingue aceite de entrega. O código está fake-first e local; somente canary fake isolado é permitido nesta etapa. Provider real, agenda, volume e tráfego de clientes permanecem bloqueados por M6-05 até existir escopo de canary por tenant, quota, fairness, custo, circuit breaker, entrega final, backlog SLO e retenção com evidência.
