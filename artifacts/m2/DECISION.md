# M2-13: M2 architecture and provider decision gate

**Estado:** M2 Human Presence Spike concluído fake-first; nenhum provider promovido

**Data:** 2026-07-15
**Branch:** `codex/m0-m1-foundation`
**Evidência de origem:** `artifacts/m2/evidence.json`, `artifacts/m2/README.md` (M2-12)

## Regra de decisão (recordada de `CURRENT_PROVIDER_MATRIX.md`)

> Nenhum provider é default definitivo nesta fase. M2-13 deve registrar
> `continue`, `tune`, `replace` ou `blocked`, com evidência de qualidade,
> custo, privacidade, confiabilidade e fallback.

Esta sessão foi 100% fake-first, sem credencial real, sem rede externa e sem
chamada a provider real (`AGENTS.md`: "Não bloqueie por ausência de
credencial em M0-M2. Use fakes e registre o item externo"). Por isso este
documento separa duas decisões distintas:

1. **Decisões de arquitetura** — o formato dos ports, do fencing por
   `generationId`, da matriz de degradação e dos directors — comprovável com
   evidência fake real do cenário M2-12.
2. **Decisões de provider** — qual SDK/candidate específico processa áudio,
   vídeo ou fala real — que exigem bake-off credenciado e gate humano
   (`HANDOFF_TO_CODEX.md`: "usar credenciais reais" é decisão humana).

## 1. Decisões de arquitetura

| Área | Veredito | Evidência (`evidence.json`) |
|---|---|---|
| `RoomTransport` sobre `ChannelPort` (M2-01, ADR-003) | **continue** | sessão inteira (join/publish/disconnect) rodou sem tocar SDK concreto; troca de provider real fica isolada em uma futura implementação de `ChannelPort` |
| Turn Coordinator, fencing por `generationId` (M2-02) | **continue** | `turn_coordinator.barge_in_confirmed=true`; nenhuma geração cancelada foi entregue |
| Dual-mode modular/S2S com fallback (M2-03/M2-04, ADR-002) | **continue** | roteador testado nos três casos (desligado, saudável, fallback); cenário M2-12 usou somente o caminho modular, então o caminho S2S real permanece **não exercitado além do roteador** — reavaliar com tráfego S2S real em M3 |
| Behavior Director determinístico por seed (M2-05) | **continue** | estados canônicos, scheduler de naturalidade e acessibilidade testados; **revisão de naturalidade humana real não foi feita** (ver Perguntas do spike, README M2-12) |
| Avatar Session com resultado tipado (M2-06) | **continue** | `avatar.late_segment_discarded=true`, `avatar.disabled_after_failure=true`, `avatar.post_failure_render_outcome="disabled"` — falha de avatar nunca bloqueou o áudio |
| Scene Director com allowlist fechada (M2-07) | **continue** | `scene.outcome="accepted"` via manifesto allowlisted; nenhum caminho de URL arbitrária existe no código |
| Specialist Fabric com bulkhead e deadline racing (M2-08) | **continue** | `specialists.delayed_specialist_status="timeout"` no próprio deadline; `catalog_query_status="completed"` sem bloqueio |
| Perception bus com vocabulário fechado (M2-09) | **continue** | sinal `packet_loss` aceito, hipótese derivada com evidência não expirada; nenhum tipo proibido é construível pelo sistema de tipos |
| Degradation controller declarativo (M2-10) | **continue** | `degradation.failures_declared=["avatar_unavailable"]`, supressão de duplicidade confirmada para a geração interrompida |
| Realtime telemetry e orçamentos (M2-11) | **continue** | todos os 9 spans avaliados; soma EOT→áudio da geração 1 (525ms) dentro do orçamento p50 (650ms) |
| Vocabulário de span/degradação próprio em vez de estender `@axtro/observability` (D-V2-046, D-V2-047) | **tune** | funcional, mas duplica conceitos entre pacotes M0 e M2; **antes de M3** avaliar unificação num único vocabulário de telemetria se alguma capability M2 for promovida |
| Validação "spike-tier" mais leve que M0/M1 (D-V2-043) | **tune** | reduziu esforço desta sessão sem violar a Constituição, mas qualquer pacote M2 promovido além do spike deve ser revisado contra o padrão de validação completo de M0/M1 antes de tocar dado real de cliente |

Nenhuma área recebeu **replace**: nenhuma abstração construída em M2 se
mostrou incompatível com o cenário obrigatório.

## 2. Decisões de provider

Todos os candidates de `docs/operations/CURRENT_PROVIDER_MATRIX.md`
recebem o mesmo veredito nesta rodada, pelo mesmo motivo:

| Layer | Candidate | Veredito | Motivo | Condição de desbloqueio |
|---|---|---|---|---|
| Realtime room | LiveKit | **blocked** | nenhuma chamada real, nenhuma credencial | rodar `PROVIDER_BENCHMARK_PROTOCOL.md` com conta de sandbox aprovada e gate humano |
| Turn detection | LiveKit Audio/Text Turn Detector | **blocked** | idem | idem, medir falso corte e barge-in com áudio PT-BR real |
| Realtime S2S | OpenAI Realtime | **blocked** | idem | idem, medir custo, rollover de sessão de 60min e exact capture reais |
| External meeting | Recall.ai | **blocked** | idem | idem, medir admission, GPU e reconexão em chamada longa real |
| Avatar | Tavus | **blocked** | idem | idem, medir lip-sync, listening e termos de uso PT-BR reais |
| Avatar | LiveKit-supported alternatives | **blocked** | idem | bake-off com pelo menos dois candidates reais antes de qualquer escolha |
| STT | Deepgram Flux Multilingual | **blocked** | idem | idem, medir nomes próprios, ruído e exact capture reais |
| TTS | ElevenLabs Flash/Turbo | **blocked** | idem | idem, medir pronúncia PT-BR e latência real |
| TTS | Cartesia | **blocked** | idem | idem, medir cancelamento e custo efetivo real |
| Telephony | Telnyx | **blocked** | idem | idem, medir rotas, AMD e transferências reais |
| Avatar | Hedra | **blocked** (excluído) | deprecated na documentação do LiveKit | não reentra na shortlist sem nova evidência oficial e ADR |

Nenhum bloqueio é de qualidade ou legal conhecido — é estritamente ausência de
execução com credencial real, que é o comportamento correto e esperado de
M0-M2 (`AGENTS.md`). Não há blocker de qualidade ou jurídico não resolvido
para registrar além disso.

`docs/operations/CURRENT_PROVIDER_MATRIX.md` permanece válida como está;
nenhuma linha muda de "precisa benchmark" para "aprovado" nesta sessão.

## 3. Custo medido (fake) e reestimativa de escopo M3

O único dado de custo desta sessão é fake (`evidence.json.cost`): 84 µUSD
estimados vs 87 µUSD "reportados pelo provider" fake, variação 3.6%. Este
número **não** é uma estimativa de produção — prova apenas que o mecanismo
de reconciliação (`reconcileSessionCost`) funciona. Nenhuma extrapolação de
custo real por minuto conectado é possível sem o bake-off da Seção 2.

Reestimativa qualitativa de M3, dado o que M2 provou:

- M3 (Role Pack de vendas, RAG autorizado, etc.) pode assumir que os
  **contratos e o fencing por geração de M2 estão prontos** para receber um
  provider real sem redesenho — a superfície (`RoomTransport`, `TurnCoordinator`,
  `AvatarSession`, `SceneDirector`) não precisa mudar para acomodar LiveKit,
  OpenAI Realtime ou qualquer candidate da matriz, só uma implementação
  concreta dos ports já existentes.
- M3 **deve orçar tempo explícito para o bake-off de provider** (gate humano,
  créditos/cobrança real, `PROVIDER_BENCHMARK_PROTOCOL.md`) como pré-requisito
  antes de qualquer demo com cliente real — isso não estava no escopo de
  nenhuma tarefa M0-M2 e não foi feito aqui.
- M3 deve reavaliar D-V2-043 (validação spike-tier) e D-V2-046/D-V2-047
  (vocabulários próprios) antes de aceitar dado real de cliente nesses
  pacotes.

## Decisão final

M2 está **concluído como spike de evidência fake-first**. As abstrações
arquiteturais recebem `continue` (duas com `tune` menor). Nenhum provider
real é promovido, escolhido ou tem credencial ativada. M3 pode iniciar
assumindo os contratos M2 como estáveis, mas deve tratar o bake-off de
provider como um item de escopo próprio com gate humano explícito.
