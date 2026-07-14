# Current Provider Matrix

**Data de consulta:** 2026-07-14.  
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
