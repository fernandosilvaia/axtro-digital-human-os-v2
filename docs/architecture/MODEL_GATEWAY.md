# Model Gateway

## Objetivo

Centralizar roteamento, timeouts, observabilidade, custo e políticas de dados para LLMs, realtime models, embeddings e judges.

## Task classes
- `realtime_fast`;
- `realtime_s2s`;
- `deliberative`;
- `specialist`;
- `summary`;
- `evaluation_judge`;
- `embedding`;
- `moderation`;
- `translation`.

## Route resolution

A rota é resolvida por:
1. tenant and deployment pin;
2. data region and provider allowlist;
3. task class and modality;
4. latency deadline;
5. health and circuit state;
6. budget remaining;
7. experiment assignment;
8. fallback chain.

## Request envelope

Nunca passar secret ou objeto de domínio inteiro. Envelope contém prompt/template version, redacted context, tool definitions allowed, deadline, idempotency reference and trace fields.

## Streaming

Gateway expõe streaming sem materializar resposta inteira. Cancellation é propagado ao provider. Tokens após cancellation são registrados como wasted cost quando detectáveis.

## Hedging

Permitido apenas para task classes explicitamente habilitadas. Hedged request:
- inicia secundário após delay;
- primeiro resultado válido vence;
- cancela perdedor;
- registra custo duplicado;
- nunca duplica tool action.

## Realtime provider session leases

Realtime connections are provider resources, not domain sessions. Each adapter exposes the effective `max_session_minutes` through `provider_capability`.

For providers with a hard duration limit, including the currently documented 60-minute OpenAI Realtime limit:

1. Session Runtime schedules renewal before the hard boundary, normally at 50-55 minutes with jitter.
2. Canonical interaction state, compacted context, tool ledger and active presenter remain outside the provider session.
3. A replacement connection is warmed with the same approved voice and prompt version.
4. Cutover occurs only at a validated turn boundary and increments `provider_session_epoch`.
5. Output from the previous epoch is fenced and discarded.
6. If renewal fails, the degradation controller switches to modular STT-LLM-TTS or audio-only fallback.
7. Provider renewal never duplicates a tool request or changes the `InteractionSessionState` identity.

Long-call tests must cover renewal, failed renewal, late output and cost attribution across multiple provider sessions.

## Evaluation

Modelo de judge não pode avaliar sua própria saída como único gate. Evals importantes combinam regras, datasets e revisão humana amostrada.
