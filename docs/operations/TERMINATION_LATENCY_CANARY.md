# Canário de latência de encerramento (Tavus / Recall)

> **Script:** `scripts/canaries/termination-latency-canary.mjs`
> **Categoria:** `scripts/canaries/` — manual-only, nunca CI, nunca cron,
> nunca `pnpm`/`npm` script alias. Ver `scripts/canaries/README.md` para as
> regras da categoria inteira antes de ler o resto deste documento.
> **Quem decide rodar:** só o Fernando. Este documento não é uma
> autorização permanente — cada execução exige que ele forneça
> credenciais reais e o valor de confirmação explícito na hora.

## Por que este canário existe

A investigação que motivou este documento confirmou, por leitura completa
do repositório, que **não existe hoje nenhuma função exportada que um
clique humano possa chamar para encerrar uma conversa Tavus ativa ou um bot
Recall ativo** fora do fluxo de compensação de falha
(`compensateCommittedProviderEffect`) ou do reconciler em background. Os
dois botões de UI que dizem "Encerrar" (`video-call.tsx`,
`presentation-room.tsx`) fazem só teardown client-side — nunca chamam o
servidor. `endConversation`/`leaveCall` só rodam como rollback de falha ou
como limpeza tardia.

Antes de fechar esse gap com uma ação real de "parar", queremos uma
resposta com evidência, não uma suposição, para a pergunta que realmente
importa: **quando alguém chama o "stop" do provider, quanto tempo o avatar
continua com áudio/vídeo chegando a um participante real depois disso?**
Esse número define o requisito de latência que a futura ação de stop
precisa cumprir — e se hoje, sem essa ação, o único "stop" real é o
timeout do próprio provider (Tavus: até 15 min pelos call sites atuais,
teto duro de 30 min no adapter; Recall: até 30 min conforme os timeouts de
gravação configurados), este canário mede o outro extremo: o quão rápido
um `endConversation`/`leaveCall` chamado agora mesmo realmente é.

Este documento **não** propõe uma nova ação de stop em produção — isso é
trabalho de produto separado, revisado pelo caminho normal (decisions log,
code review). Este canário só mede o comportamento que já existe hoje nos
dois métodos do port (`endConversation`, `leaveCall`, `stopCameraWebpage`),
quando chamados manualmente contra uma sessão real.

## O que NUNCA fazer com este script

- Não adicionar a `package.json`, a nenhum workflow do GitHub Actions, a
  `railway.json`, a nenhum hook de git, nem a nenhum agendador. O gate de
  ambiente (abaixo) é a segunda linha de defesa, não a primeira — a
  primeira é este script nunca estar em nenhum caminho automático.
- Não rodar sem o Fernando estar olhando o resultado. Isto envolve dinheiro
  real e, no canal Recall, uma reunião externa real.
- Não usar contra um tenant de cliente pagante nem contra uma reunião
  externa real de terceiros. Use sempre uma sessão de teste criada pelo
  próprio Fernando (a própria tela "testar" do portal para Tavus; uma
  reunião — Meet/Zoom/Teams — que o próprio Fernando controla e da qual é
  o único participante humano, para Recall).

## Visão geral do fluxo

O script **não cria** a conversa/bot pago — isso mantém o canário fora do
ciclo de vida de `provider_effect_reservations` (ver regra 6 do
`scripts/canaries/README.md`: um canário nunca mexe no ledger de efeitos
pagos). Em vez disso:

1. Fernando inicia uma sessão real do jeito normal — pela tela
   `agentes/[id]/testar` do portal (canal Tavus) ou entrando numa reunião
   real com o bot Recall (canal externo) — e anota o `conversationId`
   (Tavus) ou `botId` (Recall).
2. Fernando sobe, em paralelo, o observador independente daquele canal
   (ver seção "Como medir sem acesso direto ao stream" abaixo) e confirma
   que ele já está recebendo áudio/vídeo do avatar.
3. Fernando roda o script apontando para o `target-id` da sessão. O script:
   - valida o gate de ambiente;
   - registra `t0` imediatamente antes de chamar o método real do port
     (`endConversation` / `leaveCall` / `stopCameraWebpage`);
   - chama o método real e registra `t1` quando a resposta HTTP volta;
   - lê o timestamp do observador (arquivo NDJSON, ou — na ausência de um
     observador automatizado — um keypress manual do próprio Fernando no
     instante em que vê/ouve o avatar parar);
   - calcula `delta_ms` e aplica o critério de pass/fail;
   - grava tudo em `.canary-evidence/<channel>-<runId>.json` (gitignored).
4. Fernando revisa a evidência antes de decidir qualquer coisa a partir do
   resultado — um único run é uma amostra, não uma prova estatística.

## Sinais e timestamps capturados

Todo evento tem timestamp de parede (`ts_iso`, ISO-8601, para
correlacionar com webhooks do provider, que carregam seu próprio
wall-clock) e um offset monotônico em milissegundos a partir do primeiro
evento do run (`ts_monotonic_ms`, imune a *clock skew* entre processos —
é o que alimenta o cálculo de `delta_ms`).

| # | Evento | Fonte | O que prova |
|---|---|---|---|
| 1 | `termination-call-start` (`t0`) | script | momento em que decidimos mandar parar — é o zero da régua |
| 2 | `termination-call-end` (`t1`) | script | provider confirmou (HTTP 200/204) que recebeu o pedido — **não** prova que a mídia parou, só que o pedido chegou |
| 3 | evento(s) do observador independente | observador (ver abaixo) | quando um participante real de fato parou de receber áudio/vídeo — é a evidência que importa |
| 4 | webhook do provider (corroboração secundária) | Tavus `system.shutdown` (reason `end_conversation_endpoint_hit`) / Recall `bot.call_ended`, `bot.done` | confirma, de um ângulo diferente (o próprio sistema do provider), que ele considera a sessão encerrada — chega depois e não é uma testemunha independente do que o participante realmente viu/ouviu, por isso é secundário, não a métrica principal |
| 5 | `delta_ms` (derivado) | script | `ts(evento 3) - ts(t0)` — o número que decide PASS/FAIL |

O script grava os cinco no JSON de evidência, mesmo quando o resultado é
FAIL ou INCONCLUSIVE — a evidência de uma falha é tão importante quanto a
de um sucesso.

## Como medir sem acesso direto ao stream WebRTC do nosso lado

Nosso backend nunca teve acesso direto ao media stream — ele só manda
comandos HTTP para o provider e recebe webhooks. Para saber o que um
participante real efetivamente viu/ouviu, este canário usa uma
**testemunha independente por canal**, e trata os webhooks do provider como
corroboração secundária, não como prova primária (motivo: `system.shutdown`
é o próprio Tavus dizendo "eu fechei a sala", não um relato de quem estava
na chamada; os eventos de percepção do Tavus — `application.perception_analysis`
— só chegam depois da call inteira, em lote, sem granularidade por turno,
e nem sequer são consumidos hoje por `tavus-webhook.ts`, então não servem
como proxy de latência em milissegundos).

### Canal Tavus: um segundo participante programático na sala Daily

A conversa Tavus é servida numa sala Daily.co (`conversation_url`). A
testemunha recomendada é um **segundo participante silencioso** entrando
nessa mesma sala via `@daily-co/daily-js` (já é dependência do portal,
`apps/portal/package.json`) dentro de uma página headless (Playwright já é
devDependency do portal, `apps/portal/e2e/`), que:

1. Entra na sala como observador, sem áudio/vídeo próprio;
2. Escuta `call.on('track-stopped', ...)` e `call.on('participant-left', ...)`
   para o participante da réplica;
3. No instante de cada evento relevante, escreve uma linha NDJSON em um
   arquivo compartilhado (o `--observer-file` que o canário lê):
   ```json
   {"ts_iso":"2026-08-18T14:03:22.481Z","source":"daily-observer","event":"track-stopped","detail":{"kind":"video","participantId":"..."}}
   ```
4. Continua rodando até o humano encerrar (ou até `participant-left` do
   participante da réplica, o que for último).

Este observador **não está implementado neste run** (v1 do canário) — o
que está implementado é o contrato de arquivo NDJSON que ele precisa
produzir e o consumidor desse arquivo no script principal
(`waitForObserverEvent`). Construir e validar o join headless do Daily é
trabalho separado, com suas próprias falhas possíveis (ex.: a sala pode
recusar um segundo participante dependendo da config de `properties` da
conversa) — não faz sentido misturar essa complexidade com o gate que
precisa ser auditável e simples. Até esse observador existir, o fallback é
o modo manual descrito abaixo.

### Canal Recall: um segundo bot Recall como testemunha/gravador

Não existe um "segundo humano fácil" para colocar numa reunião externa
real de forma programática sem reimplementar um cliente do próprio Zoom/
Meet/Teams. A testemunha recomendada reaproveita a própria capacidade
central do Recall — gravação — usando um **segundo bot Recall**, entrando
na mesma reunião de teste, com o único papel de gravar:

1. Fernando sobe a reunião de teste (ele é o único humano presente) e
   entram dois bots Recall: o bot "agente" (o que está sendo mandado
   parar — o alvo do canário) e o bot "observador" (grava a reunião
   inteira, sem enviar mídia própria).
2. O canário chama `leaveCall`/`stopCameraWebpage` no bot agente e
   registra `t0`/`t1` normalmente.
3. Depois do run, o bot observador é parado também (`leaveCall`) e sua
   gravação é baixada (webhook `bot.done` → `recording ready`,
   `providerReceiptRef` já documentado no fluxo existente de transcript).
4. A gravação do observador é a evidência forense: o offset, dentro da
   gravação, do último frame de vídeo/última amostra de áudio audível do
   avatar é comparado com `t0` (conhecido em wall-clock, e a gravação tem
   um instante de início em wall-clock conhecido — o `join_at` do bot
   observador).
5. Para v1, essa comparação é **revisão humana da gravação** (Fernando
   assiste/ouve e marca o timestamp) — é mais lenta, mas não depende de
   nenhuma ferramenta nova nem de heurística não validada. Uma automação
   com `ffmpeg` (`silencedetect` para áudio, `freezedetect`/diff de frame
   para vídeo) é uma melhoria futura documentada aqui como próximo passo,
   não como parte do v1: qualquer heurística automática deveria primeiro
   ser validada contra alguns runs revisados manualmente antes de virar a
   fonte de verdade.

Latência de `DELETE /bot/{id}/output_media/` (câmera) e de
`POST /bot/{id}/leave_call/` **não é documentada publicamente pela
Recall.ai** em nenhuma das páginas oficiais consultadas (mecanismo de
streaming, reference de criação/remoção de output media, reference de
leave_call, FAQ) — não existe um número para comparar contra. Isso reforça
por que este canário precisa medir empiricamente em vez de assumir um
SLA.

### Modo manual (fallback sem dependências novas, disponível hoje)

Se nenhum `--observer-file` for passado, o script pede um keypress: "Watch/
listen to the avatar now. Press ENTER the INSTANT its audio/video actually
stops." Isso funciona sem nenhuma dependência nova, mas tem viés de tempo
de reação humano (tipicamente +200–400ms) — trate resultados desse modo
como um limite superior aproximado, não uma medição apertada. Serve bem
para uma primeira passada de baseline ("é da ordem de meio segundo ou é da
ordem de 8 segundos?") antes de investir na testemunha automatizada.

## Critério de pass/fail

Threshold default por canal (`DEFAULT_THRESHOLD_MS` no script,
sobrescrevível via `--threshold-ms`):

| Canal | Ação | Threshold default | Racional |
|---|---|---|---|
| `tavus` | `endConversation` | **3000ms** | teardown de sala WebRTC costuma ser sub-segundo uma vez que o servidor destrói a sala; a folga cobre sinalização/ICE teardown + latência do próprio evento do observador. Nenhum número oficial da Tavus documenta isso — é uma proposta inicial, não um SLA. |
| `recall-leave` | `leaveCall` | **5000ms** | sem SLA documentado pela Recall.ai; teto conservador proposto até o primeiro run real dar um baseline. `leaveCall` é ação documentada como **irreversível** — o bot sai da call inteira (vídeo, áudio e gravação param). |
| `recall-camera` | `stopCameraWebpage` | **1000ms** | é descrito na doc como streaming "de baixíssima latência em tempo real"; o bot continua na reunião, só a câmera emprestada some — teto mais apertado porque a ação é mais estreita que sair da call. |

**PASS**: `delta_ms >= 0` e `delta_ms <= threshold`.

**FAIL**:
- `delta_ms > threshold` (mídia continuou chegando depois do limite); ou
- **qualquer novo turno de áudio/vídeo começando mais de 500ms depois de
  `t0`** — isto é, o avatar não pode iniciar uma nova frase depois que o
  cancelamento foi disparado, mesmo que o teardown final fique dentro do
  threshold. Este segundo critério ainda não está automatizado no v1 do
  script (o observador precisa distinguir "cauda do turno em andamento"
  de "novo turno começando" — ver NDJSON schema acima, campo `event`);
  registre isso manualmente na revisão da evidência até o observador
  automatizado cobrir o caso; ou
- a chamada de terminação em si retornou erro (não-2xx / exceção) — o
  script já marca isso como FAIL automaticamente, sem nem tentar ler o
  observador.

**INCONCLUSIVE** (não é PASS, não é FAIL — precisa de novo run):
- nenhum evento do observador chegou dentro do timeout (`--observer-file`
  configurado mas vazio/sem evento relevante, ou modo manual sem resposta);
- gravação do observador Recall ambígua (ex.: qualidade ruim demais para
  confirmar visualmente o último frame com o avatar) — não conte como PASS
  por omissão.

Estes números são um ponto de partida deliberadamente conservador. Depois
do primeiro run real de cada canal, ajuste `DEFAULT_THRESHOLD_MS` no
script com base no baseline observado — e documente o ajuste com a data e
o run que o motivou (evidência em `.canary-evidence/`, decisão em
`docs/operations/DECISIONS_LOG.md` se o número virar um requisito formal
para uma futura ação de stop em produção).

## Disponibilidade de sandbox por provider

**Tavus: existe `test_mode`, mas não serve para este canário específico.**
`POST /conversations` aceita `test_mode: true` — cria a conversa sem
cobrar minuto, sem ocupar slot de concorrência, com status já `ended`. O
problema: a própria doc diz que, em `test_mode`, **o PAL nunca entra na
call**. Como este canário mede quanto tempo leva para uma mídia *ao vivo*
parar de chegar, e em `test_mode` nunca há mídia ao vivo, `test_mode` é
útil para validar que o plumbing de criar/encerrar uma conversa continua
aceitando o payload — não para a medição de latência em si. Isso também
não é o formato de request que o port atual (`packages/provider-tavus`)
expõe hoje (`test_mode` não é passado em nenhum lugar do adapter) — se
algum dia quisermos um smoke test de plumbing usando `test_mode`, isso
exige uma extensão aditiva pequena do port, separada deste canário. Na
prática: **a medição real de latência de encerramento no canal Tavus
sempre vai custar uma conversa real, curta** (o mínimo aceito por
`maxCallDurationSeconds` é 60s, mas o custo real deve ser proporcional ao
tempo efetivamente usado antes do `endConversation`, não ao teto pedido —
confirme isso na fatura, não assuma).

**Recall: nenhum sandbox documentado.** As páginas oficiais consultadas
(`getting-started`, `faq`) não mencionam ambiente de teste, trial
gratuito, nem "sandbox mode". Não há evidência de que exista. Alternativa
proposta, com custo mínimo controlado:
- use uma reunião real que o próprio Fernando cria e da qual é o único
  humano presente (ex.: uma sala Meet pessoal, sem convidados externos);
- confirme o preço por bot-minuto vigente com a Recall.ai *antes* do
  primeiro run (não estava confirmado nesta pesquisa — não assuma um
  valor);
- rode o canário com o mínimo de bots necessário: 1 bot "agente" + 1 bot
  "observador" para o teste de `leaveCall`/`stopCameraWebpage" completo,
  ambos encerrados manualmente pelo Fernando segundos depois da medição,
  independentemente do resultado do script;
- trate cada execução como uma despesa operacional pequena e deliberada,
  aprovada por ele no momento do run — não como algo a rodar
  repetidamente "só para conferir".

## Variáveis de ambiente exigidas

| Variável | Obrigatória para | Observação |
|---|---|---|
| `TERMINATION_LATENCY_CANARY_CONFIRM` | sempre (exceto `--dry-run`) | precisa ser exatamente `RUN-AGAINST-REAL-PROVIDER` — não é booleana de propósito |
| `TAVUS_API_KEY` | `--channel=tavus` | a mesma chave real usada em produção; use uma conversa de teste, não uma de cliente |
| `RECALL_API_KEY` | `--channel=recall-leave` \| `recall-camera` | idem |
| `RECALL_API_REGION` | `--channel=recall-leave` \| `recall-camera` | mesma região configurada em produção |

`--dry-run` só exige `TERMINATION_LATENCY_CANARY_CONFIRM` e nenhuma
credencial — use para validar o wiring do script sem gastar nada.

## Como rodar

```bash
# 1. Smoke test do gate, sem gastar nada:
TERMINATION_LATENCY_CANARY_CONFIRM="RUN-AGAINST-REAL-PROVIDER" \
  node scripts/canaries/termination-latency-canary.mjs \
  --channel=tavus --target-id=placeholder --dry-run

# 2. Run real, canal Tavus, modo manual (sem observador automatizado):
TERMINATION_LATENCY_CANARY_CONFIRM="RUN-AGAINST-REAL-PROVIDER" \
  TAVUS_API_KEY="..." \
  node scripts/canaries/termination-latency-canary.mjs \
  --channel=tavus --target-id=<conversationId-real>

# 3. Run real, canal Recall (leave), com observador em arquivo:
TERMINATION_LATENCY_CANARY_CONFIRM="RUN-AGAINST-REAL-PROVIDER" \
  RECALL_API_KEY="..." RECALL_API_REGION="..." \
  node scripts/canaries/termination-latency-canary.mjs \
  --channel=recall-leave --target-id=<botId-real> \
  --observer-file=/caminho/para/observer.ndjson
```

Cada run grava `.canary-evidence/<channel>-<runId>.json` (gitignored — ver
`.gitignore`). Guarde os arquivos relevantes fora do repositório se
precisar preservá-los além do disco local.

## Fora de escopo (v1)

- O script não inicia conversa/bot — reaproveita uma sessão que Fernando já
  iniciou pelo fluxo real do app, para não duplicar (e divergir de)
  `beginProviderEffect`/`commitProviderEffect`.
- O script não chama `completeProviderEffect` nem qualquer outra função do
  ledger de efeitos pagos — mesmo sendo o "caminho feliz" certo conforme o
  padrão já estabelecido no repo, conectar isso é mudança de produto, não
  de medição, e deve passar pelo caminho normal de revisão.
- O observador automatizado (Playwright + daily-js para Tavus; segundo bot
  Recall + análise de gravação, com ou sem `ffmpeg`, para Recall) está
  documentado aqui como contrato e design recomendado, não implementado
  neste run. O modo manual cobre a primeira passada.
- O critério de "nenhum novo turno começando após 500ms" não é avaliado
  automaticamente — exige revisão humana da evidência até o observador
  automatizado distinguir turnos.
