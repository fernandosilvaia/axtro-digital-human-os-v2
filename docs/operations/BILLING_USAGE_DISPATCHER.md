# Runbook — dispatcher de uso faturável do Stripe

## Escopo e invariantes

O dispatcher entrega a outbox criada pela ativação transacional, após a
persistência do resultado visível ao cliente. Ele não cria unidades por conta
própria. Cada tentativa envia ao Stripe o
`meter_event_name`, o `meter_event_at` persistido na ativação da unidade (validado dentro do
período de cobrança congelado na reserva) e a mesma chave de idempotência
derivada do evento de custo.

- `data === true` das RPCs de acknowledgement/failure é o único receipt aceito;
- timeout, indisponibilidade e acknowledgement ambíguo voltam ao retry com a
  mesma chave;
- cada linha recebe um token UUIDv7 novo em uma lease de 60 segundos,
  imediatamente antes da chamada Stripe; nunca se faz lease antecipada do
  lote inteiro;
- uma execução processa no máximo 20 linhas em série. O adapter pode consumir
  até 20 segundos por linha, por isso o cliente do workflow admite 480 segundos
  e não faz retry HTTP sobre uma chamada ainda potencialmente ativa;
- rejeição permanente ou oito tentativas vão para `dead_letter`;
- uma linha em `dead_letter` nunca é reenviada automaticamente;
- uma linha malformada é validada isoladamente e enviada a `dead_letter` com
  `invalid_outbox_row`; ela não impede a entrega das demais linhas do lote;
- segredo, customer ID e tenant ID não entram nos logs do workflow.

## Ativação

1. Concluir o rollout expand-contract das migrations M5-01 e confirmar `/api/ready` verde.
2. Manter a repository variable `BILLING_DISPATCH_SCHEDULE_ENABLED` ausente ou
   diferente de `true`. Assim, o cron permanece inerte enquanto
   `workflow_dispatch` continua disponível para a prova manual.
3. No Railway, configurar `BILLING_USAGE_OUTBOX_ENABLED=true`,
   `STRIPE_SECRET_KEY` e um `BILLING_DISPATCH_SECRET`
   aleatório de pelo menos 24 caracteres. Nesta etapa,
   `STRIPE_SECRET_KEY` deve continuar em test mode.
4. No GitHub Actions, configurar:
   - repository variable `BILLING_DISPATCH_URL` com
     `https://closer.axtroai.com/api/internal/billing-usage`;
   - repository secret `BILLING_DISPATCH_SECRET` com exatamente o mesmo valor
     do Railway.
5. Executar manualmente o workflow
   `Dispatch Stripe billing usage`.
6. Conferir no output apenas contagens agregadas: `leased`, `delivered`,
   `failed`, `deadLettered`, `backlog`, `oldestAgeSeconds` e
   `deadLetterBacklog`, `held`, `oldestHeldAgeSeconds`, `providerInFlight`,
   `unknown`, `cleanupPending` e `oldestProviderPendingAgeSeconds`.
7. Salvar como evidência operacional o URL/ID da execução, commit SHA,
   timestamp, contagens agregadas antes/depois e confirmação do Meter em test
   mode. A evidência aprovada exige `failed=0`, `deadLettered=0`,
   `deadLetterBacklog=0`, `unknown=0` e `cleanupPending=0`; backlog pendente ou
   held precisa de justificativa e nova observação até convergir.
8. Somente após revisão humana dessa evidência, configurar
   `BILLING_DISPATCH_SCHEDULE_ENABLED=true`. A troca de `STRIPE_SECRET_KEY`
   para live continua sendo um gate humano separado e não é autorizada por
   este runbook.

O cron é avaliado a cada cinco minutos, serializado por `concurrency`, e só
executa quando `BILLING_DISPATCH_SCHEDULE_ENABLED=true`; `workflow_dispatch`
continua permitido para a prova manual. Ausência ou formato inválido de
URL/segredo encerra o job antes de qualquer chamada. Este runbook não autoriza
uma chamada Stripe live nem a troca para uma chave live.

## Alertas operacionais

Configure as notificações de falha do GitHub Actions e um alerta no log drain
para o evento estruturado `billing_usage_dispatch_completed`. Limiares iniciais:

- crítico: qualquer falha do workflow por duas execuções consecutivas;
- crítico: `deadLetterBacklog > 0` ou `deadLettered > 0`;
- warning: `oldestAgeSeconds > 900` (três intervalos de tolerância);
- warning: `backlog > 100`.
- crítico: `unknown > 0` ou `cleanupPending > 0`;
- warning: `held > 0` por mais de 300 segundos;
- warning: `providerInFlight > 0` com `oldestProviderPendingAgeSeconds > 300`.

O evento `billing_usage_backlog_observation_failed` indica que entregas podem
ter sido confirmadas, mas a telemetria agregada falhou. Ele exige investigação;
não é motivo para reenviar manualmente um evento.

## Triagem e recuperação

1. Pausar o workflow se a chave, endpoint ou schema estiverem incorretos.
2. Identificar a linha somente por `id`, `cost_event_id`, status, attempts e
   código de erro em uma consulta service-role auditada. Não copiar o customer
   ID para tickets ou chat.
3. Verificar o Meter do Stripe usando a chave de idempotência estável e o
   instante do período. Um timeout não prova ausência do efeito.
4. Para `dead_letter`, corrigir a causa e reconciliar se o Stripe aceitou o
   evento. Não alterar status nem reenfileirar até essa verificação.
5. Se o Stripe confirmou o evento, persistir o acknowledgement por uma operação
   administrativa auditada futura. Se confirmou rejeição, uma operação de
   requeue service-only pode ser criada/aprovada separadamente. Hoje não existe
   requeue público ou automático.
6. Registrar contagens antes/depois, correlation ID do workflow e decisão no
   incidente. Nunca registrar segredo, bearer ou payload completo.

Rotacionar `BILLING_DISPATCH_SECRET` exige atualizar Railway e GitHub na mesma
janela. Durante a rotação, pause o workflow; uma divergência intencional deve
falhar com HTTP 401, sem tocar a outbox.
