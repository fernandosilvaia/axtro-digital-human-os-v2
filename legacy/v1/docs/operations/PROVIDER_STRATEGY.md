# PROVIDER_STRATEGY.md — matriz de fornecedores, fallbacks e lock-in

> Status: PROPOSTO. Preços citados: cotados publicamente em **2026-07-13** — sempre reconferir antes de contratar (PENDENCIAS_EXTERNAS). Regra de ouro: **todo provider no caminho crítico tem fallback configurado e testado** (game day trimestral).

## 1. Matriz normativa
| Camada | Primário | Fallback | Critério de troca automática | Lock-in / mitigação |
|---|---|---|---|---|
| Infra realtime (salas, SFU, SIP) | LiveKit Cloud (~US$0,0075/participante-min) | — (self-host LiveKit OSS é o plano de saída, não fallback quente) | n/a | Médio; API OSS idêntica ⇒ migração possível F5+ |
| STT PT-BR | Deepgram Nova (streaming, ~US$0,0077/min) | AssemblyAI Universal-Streaming | 3 timeouts/erros em 60s OU WER anômalo | Baixo; interface `SttProvider` |
| LLM realtime | Claude Haiku (via Model Gateway) | GPT-4o-mini | TTFT p95 > budget 2min seguidos OU erro | Baixo; gateway multi-provider |
| LLM raciocínio (pós-call, judge) | Claude Sonnet | GPT-4o | erro/quota | Baixo |
| TTS | ElevenLabs Flash v2.5 (~US$0,06/min equiv.) | Cartesia Sonic (~US$0,025/min) | TTFB p95 > 400ms OU erro | Médio (voz clonada não portável!) ⇒ clonar voz nos DOIS providers no onboarding de voz custom |
| S2S (flag) | OpenAI Realtime (~US$0,10+/min) | cai para pipeline STT→LLM→TTS | qualquer instabilidade | Alto ⇒ por isso é flag, não default |
| Avatar vídeo | Tavus CVI (Growth US$397/1.250min; overage ~US$0,32–0,37/min) | voz-only (degradação graciosa) | falha de warm-up >2,5s ou erro de stream | Alto (réplicas não portáveis) ⇒ contrato anual só após F2 validada; manter fotos/vídeos fonte para re-treinar em concorrente (HeyGen/D-ID) |
| Meeting bots | Recall.ai (~US$0,80/h a verificar) | adiar feature (F3) | n/a | Médio; Output Media é diferencial deles |
| Telefonia | Telnyx (US$0,007/min US; número atual +1 617 450-5166) | Twilio (portabilidade SIP) | falha de originação | Baixo (SIP padrão) |
| Embeddings | OpenAI text-embedding-3-small | Voyage | erro/quota | Baixo; re-embed é barato |
| Banco/Auth/Storage | Supabase (região SP) | — (backup diário + PITR; plano de saída = Postgres puro) | n/a | Médio-baixo (é Postgres) |
| Filas | Redis Streams (Upstash) | — (F3+: NATS JetStream) | n/a | Baixo |
| Pagamentos (tool) | Stripe | — | n/a | Baixo |
| Secrets | Doppler | env versionado cifrado (break-glass) | n/a | Baixo |

## 2. Model Gateway (nosso, pequeno)
Camada fina interna (não é produto): roteia por `task_class` (realtime|reasoning|judge|embedding), aplica timeout/retry/hedging (para realtime: hedge request no fallback se TTFT>1,2s), registra custo por chamada com `tenant_id/session_id`, e permite pin de versão de modelo por tenant (estabilidade > novidade). **Não** construir gateway genérico multiuso — só o que o produto precisa (BUILD_VS_BUY).

## 3. Política de contratos
F0–F2: tudo pay-as-you-go, zero compromisso anual. Compromissos anuais só quando: volume ≥ 3 meses estável E desconto ≥ 25% E existe fallback validado. Tavus e ElevenLabs são os candidatos a negociação primeiro (maior peso no custo/min — ver UNIT_ECONOMICS).

## 4. Saúde de providers
Ping sintético por provider a cada 60s (staging) e circuito por tenant em produção; página interna de status; incidentes de provider viram anotação automática nos dashboards (explicar picos de métrica).
