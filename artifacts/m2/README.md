# M2-12 evidence: ten-minute Human Presence scenario

**Estado:** cenário obrigatório verde; M2-13 (decisão de arquitetura e provider) ainda não foi executado

**Data da execução:** 2026-07-15

**Branch:** `codex/m0-m1-foundation`

## Escopo comprovado

O cenário determinístico em `tests/e2e/m2-human-presence-spike-harness.mjs` compõe,
fake-first e sem nenhuma credencial real, todos os componentes construídos em
M2-01 a M2-11:

- `RoomTransport` (`@axtro/meeting-gateway`) sobre um `ChannelPort` fake;
- Turn Coordinator (`@axtro/turn-coordinator`), perfil `conversational`;
- caminho modular STT/LLM/TTS e roteador S2S (`@axtro/model-gateway`);
- Behavior and Presence Director (`@axtro/behavior-director`);
- Avatar Session com cancelamento e degradação (`@axtro/avatar-gateway`);
- Scene and Presentation Director (`@axtro/scene-director`);
- Silent Specialist Fabric (`@axtro/specialist-fabric`);
- Perception signal bus (`@axtro/perception`);
- Degradation and recovery controller (`@axtro/degradation-controller`);
- Realtime latency/quality/cost telemetry (`@axtro/realtime-telemetry`).

Todos os onze itens obrigatórios de `docs/operations/HUMAN_PRESENCE_SPIKE.md`
são exercitados em sequência: disclosure, pergunta aberta, pausa no meio de
frase, interrupção do usuário, captura exata de número/e-mail, consulta de
catálogo read-only, especialista atrasado, apresentação de um slide, injeção
de falha de avatar, retorno a voice-only e encerramento. O relógio simulado
avança até **600.000 ms (dez minutos)** sem deadlock, exceção não tratada ou
transição de estado inválida em nenhum dos componentes.

## Perguntas do spike respondidas por esta evidência

| Pergunta | Resposta nesta rodada fake |
|---|---|
| Barge-in interrompe voz e avatar sem late output? | Sim — `avatar.late_segment_discarded=true`, `turn_coordinator.barge_in_confirmed=true` |
| Qual componente domina a latência? | `model_first_token` (220ms) e `avatar_first_frame` (850-900ms) são os maiores componentes medidos; total EOT→áudio da geração 1 é 525ms, dentro do orçamento p50 de 650ms |
| A cena muda sem quebrar ritmo? | Sim — o slide é aceito pelo `SceneDirector` sem exceção nem bloqueio do turno |
| O sistema degrada para voz com elegância? | Sim — `avatar.disabled_after_failure=true`, `avatar.post_failure_render_outcome="disabled"`, sem nova tentativa automática |
| Especialista paralelo melhora a resposta sem bloquear? | A consulta de catálogo (`pricing`) completa; o especialista de pesquisa atrasado libera o chamador no próprio deadline (`status="timeout"`), nunca no tempo real do handler |
| Quanto custa por minuto conectado e falado? | Reconciliação de custo fake: estimado 84 µUSD vs reportado 87 µUSD pelo provider, variação 3.6%, dentro da tolerância de 10% (`cost.status="reconciled"`) |
| A conversa em PT-BR parece natural por dez minutos? | **Não avaliado nesta evidência** — exige revisão humana/bake-off real por `PROVIDER_BENCHMARK_PROTOCOL.md`; ver limitações |
| O avatar demonstra listening sem uncanny repetition? | Parcialmente coberto por `tests/realtime/behavior-director.test.mjs` (cooldown, cap por minuto, neutralidade de `idle_ready`); não reavaliado nesta rodada de 10 minutos além do estado canônico usado |

## Pipeline executado

| Comando | Resultado |
|---|---|
| `pnpm lint` | passou |
| `pnpm typecheck` | passou |
| `pnpm test` | passou, 298 testes Node e 23 unittest Python (antes de M2-12) |
| `pnpm m2:e2e` | passou, 7 testes e duas execuções idênticas do cenário |

## Artefato congelado

- `evidence.json`: checklist completo com timestamps simulados, estado final
  do Turn Coordinator, resultado do avatar, da cena, dos especialistas, da
  percepção, da degradação, dos p50/p95 por span com avaliação de orçamento,
  soma EOT→áudio e reconciliação de custo.

O `evidence.json` é determinístico: duas execuções independentes do harness
produzem exatamente o mesmo JSON canônico.

## Limitações conhecidas

- **Fake-first total.** Nenhum provider real, credencial, rede ou banco foi
  acessado. `disclosure` é apenas um marcador de precondição — o mecanismo
  real de disclosure persistido pertence a M1-01 (`session-application`) e
  não foi reinvocado aqui.
- **Naturalness review não realizada.** A pergunta "a conversa em PT-BR
  parece natural por dez minutos" exige revisão humana ou bake-off com
  credenciais reais, fora do escopo M0-M2 desta sessão.
- **Vídeo não medido.** Não existe pipeline de vídeo real em M2; `video_quality`
  no `evidence.json` registra explicitamente `not_measured_fake_only`.
- **`@axtro/realtime-telemetry` e `@axtro/degradation-controller` usam
  vocabulário próprio** em vez de estender os enums fechados de M0
  (`@axtro/observability`, `@axtro/session-runtime`) — ver D-V2-046, D-V2-047
  em `docs/operations/DECISIONS_LOG.md`.
- Este README cobre apenas a evidência de M2-12. A decisão formal de
  arquitetura e de providers (continue/tune/replace/blocked por candidato)
  é responsabilidade de M2-13 e ainda não foi registrada aqui.

## Decisão de prontidão

Esta evidência prova que os componentes M2-01 a M2-11, compostos juntos,
sustentam o cenário obrigatório de dez minutos sem deadlock e com
degradação elegante. Ela **não** autoriza produção, provider real,
credenciais reais, deploy ou promoção de nenhuma capability além do spike.
