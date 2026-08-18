# Runbook — rollout de produção M5-01

## Escopo, autoridade e resultado esperado

Este runbook operacionaliza o expand-contract do ADR-036 sem autorizar nem
executar migration remota, cobrança live, promoção pública ou mudança de
credencial. Cada ação em Railway, Supabase, Stripe ou GitHub exige o gate humano
já definido para produção.

O resultado esperado é um artefato M5-01 compatível com schema v42, inicialmente
sem tráfego público, com `/api/ready` verde, efeitos pagos cercados por reservas
duráveis e workers provados em Stripe test mode antes do canário. `/api/health`
continua sendo liveness; nunca deve substituir `/api/ready` na decisão de rotear
tráfego.

Invariantes durante toda a janela:

- nenhum novo caminho pago recebe tráfego enquanto writers antigo e novo
  poderiam concorrer;
- migrations 0040, 0041 e 0042 são aplicadas, nessa ordem, durante maintenance e
  drain completo, antes do startup do candidato M5-01;
- o artefato legado permanece parado depois de 0041; ele não é compatível com
  os writers service-owned do contract;
- depois de 0042, somente um artefato v42-aware pode ser promovido ou restaurado;
- `provider_in_flight`, `unknown`, `cleanup_pending`, `held`, outbox e dead
  letter são evidência financeira: nunca apagar, expirar ou liberar por tempo;
- schedules permanecem desligados até a prova Stripe test mode e as leituras de
  backlog passarem;
- nenhum resultado é declarado concluído sem receipt persistido ou contador
  agregado observado.

## Bootstrap automático do candidato Railway

`railway.json` executa `pnpm run production:bootstrap` como
`preDeployCommand`, entre o build e o start do portal. Segundo a
[documentação oficial do Railway](https://docs.railway.com/deployments/pre-deploy-command),
esse comando roda em um container separado, recebe as variáveis do serviço,
não pode depender do app ou de volume em execução e impede o deployment quando
termina com status diferente de zero. O healthcheck continua sendo
`/api/ready`; `/api/health` não é usado para promoção.

O bootstrap `m5-01-v1` falha fechado e, nesta ordem:

1. exige identidade imutável em `AXTRO_DEPLOYMENT_ID` ou
   `RAILWAY_GIT_COMMIT_SHA`, Supabase HTTPS, service role e workers reais
   habilitados;
2. lê por PostgREST service-role `portal_schema_capabilities_service` e exige
   schema exatamente v42 com todas as capabilities M5-01 verdadeiras;
3. exige zero nos estados críticos dos backlogs de billing, efeitos de
   provider e reconciliação de AI;
4. consulta em modo somente leitura os seis Prices e o Meter Stripe do mesmo
   modo da chave configurada, exigindo conta/modo, USD, intervalo mensal, `licensed`/`metered`, valores
   versionados, Meter compartilhado, `sum` e chaves de payload exatas;
5. somente depois de todas as provas grava `started` e `succeeded` de
   `billing_usage` e `provider_effect_reconciler`, com versão, deployment e os
   mesmos fingerprints usados por `/api/ready`.

Nenhuma chamada Stripe `POST`, criação de provider ou consumo de outbox ocorre
no bootstrap. O rollout inicial continua obrigatório em test mode; depois do
gate humano que configurar o catálogo live, o mesmo bootstrap apenas o lê e
exige `livemode=true` antes de permitir o processo subir. Os logs expõem apenas códigos fechados, nunca
URL Supabase, token service-role, chave Stripe, Price IDs, Meter ID ou resposta
bruta. `false`, objeto ou erro em qualquer RPC de receipt não conta como
sucesso.

Isso fecha o ciclo de primeira promoção: o candidato recebe os dois heartbeats
compatíveis antes de iniciar e então `/api/ready` pode ficar verde assim que o
processo subir. As execuções manuais da seção 7 continuam obrigatórias para
provar e renovar os workers antes dos schedules; a expectativa antiga de 503
até o primeiro workflow manual fica substituída por este bootstrap versionado.

Para validar o mesmo mecanismo localmente com fetches fake e sem credenciais:

```bash
pnpm build
node --test tests/operations/production-readiness-bootstrap.test.mjs
```

## Papéis e artefatos obrigatórios

Defina antes da janela:

- `release owner`: conduz o checklist e decide parar;
- `database operator`: único autorizado a aplicar 0040, 0041 e 0042;
- `billing reviewer`: confere catálogo, Meter e eventos no Stripe test mode;
- `observer`: guarda evidência e monitora circuit breakers;
- SHA do artefato candidato e SHA-256 dos arquivos
  `0040_production_integrity_hardening.sql` e
  `0041_provider_transcript_contract.sql` e
  `0042_cost_event_schema_and_legacy_writer_contract.sql`;
- URL privada ou não promovida do candidato e URL pública atual;
- link do incidente/janela, horário UTC de início e canal de coordenação;
- último artefato v42-aware conhecido. Na primeira janela ele é o próprio
  candidato; não existe rollback legado depois do contract.

Não copie tokens, bearer secrets, customer IDs, provider refs, payloads de
webhook, dados de tenant ou PII para a evidência.

## 0. Preflight local e fronteira imutável

Execute no commit exato que será construído:

```bash
pnpm db:portal:test
node --test tests/portal/readiness-route.test.mjs tests/portal/billing-usage-dispatch.test.mjs tests/portal/provider-effect-reconciler.test.mjs tests/portal/paid-effect-intents.test.mjs
pnpm lint
pnpm typecheck
pnpm test
pnpm build
python3 scripts/validate_all.py
```

O primeiro comando é a prova PostgreSQL local de apply, grants, RLS,
concorrência, falha intermediária com rollback transacional e transição v40 →
v42. A suíte Node usa fakes determinísticos; nenhuma credencial real é
necessária. Pare se qualquer comando falhar ou se o working tree alterar o
conteúdo das migrations depois da captura dos checksums.

Registre somente comando, exit code, resumo de testes, commit e checksums. O
preflight local não prova que o schema hospedado, os secrets ou o catálogo
Stripe estão corretos.

## 1. Preparar configuração sem ativar execução

No candidato não promovido, configure e valide os valores exigidos por
`/api/ready`:

- Supabase URL, publishable key e service-role key;
- `PORTAL_FAKE_PROVIDERS=0` ou ausente;
- Recall key, região, allowlist exata de download e
  `RECALL_WEBHOOK_SECRET=whsec_...` canônico;
- Tavus e OpenRouter keys, modelo OpenRouter exatamente revisado e
  `AI_USAGE_RECONCILE_SECRET` com pelo menos 24 caracteres;
- `BILLING_USAGE_OUTBOX_ENABLED=true`, `BILLING_DISPATCH_SECRET` com pelo menos
  24 caracteres, Stripe **test-mode** key, webhook secret, Meter event name e
  os seis `STRIPE_PRICE_*` de test mode;
- `PROVIDER_EFFECT_RECONCILER_ENABLED=true` e
  `PROVIDER_EFFECT_RECONCILE_SECRET` com pelo menos 24 caracteres.

Esses flags tornam os endpoints protegidos utilizáveis; não iniciam um worker
por si só. Mantenha `BILLING_DISPATCH_SCHEDULE_ENABLED` e
`PROVIDER_EFFECT_RECONCILE_SCHEDULE_ENABLED` ausentes ou diferentes de `true`
até a prova manual. O `preDeployCommand` grava os dois heartbeats de sucesso
do bootstrap; portanto, depois de o processo candidato subir, a readiness
inicial deve ser 200 se identidade, fingerprints, schema e configuração
continuarem coincidentes. As execuções manuais da seção 7 são um gate
operacional separado antes de schedules, canário ou promoção.

Configure URLs de workflow primeiro para o candidato, nunca para um artefato
legado. Os secrets equivalentes no Railway e GitHub devem coincidir, mas seu
valor não entra na evidência.

No Stripe test mode, confira que os seis Price IDs pertencem à mesma conta e ao
mesmo modo da key, que os overages são de **US$ 30 por conversa**, que o Meter
usa exatamente `STRIPE_CONVERSATION_OVERAGE_EVENT_NAME` e que o endpoint de
webhook test aponta para o candidato. Não criar, trocar ou usar objetos live
nesta janela.

## 2. Entrar em maintenance e drenar writers pagos

Ative maintenance antes de 0040. O controle deve impedir novas entradas de:

- vídeo direto e apresentação Tavus;
- lead institucional em `/api/leads/video-session`;
- criação/agendamento de bot Recall e attachment do SENTINELA;
- geração/embedding OpenRouter;
- checkout ou mutações que possam criar nova unidade faturável.

Enquanto houver efeitos antigos em voo, preserve callbacks de Tavus, Recall,
Stripe e Resend e os endpoints internos necessários para concluir o drain. Se
o mecanismo de maintenance disponível bloquear também callbacks, primeiro
espere a janela máxima documentada dos providers e confirme os dashboards e
logs; só então aplique o bloqueio total. Não redirecione callbacks para o
candidato antes de 0040.

O drain está aceito apenas quando, por duas observações consecutivas:

- não houve nova entrada paga nem criação nos dashboards dos providers;
- não há request pago conhecido ainda em voo no app legado;
- webhooks pendentes conhecidos terminaram ou foram registrados como incidente;
- o owner e o observer registraram horário UTC e evidência agregada.

Se o legado não fornece estado durável suficiente para provar um request
ambíguo, pare e reconcilie nos consoles dos providers. Tempo decorrido não é
prova de rejeição.

## 3. Expand: aplicar somente 0040

Com maintenance ativo e drain aceito, o database operator aplica **somente**
`database/supabase-only/0040_production_integrity_hardening.sql` pela ferramenta
Supabase já aprovada para migrations. Guarde receipt, horário, checksum e
identidade do operador. Não cole SQL parcial, não edite a migration durante a
janela e não use comandos de drop, truncate ou rollback destrutivo.

Pelo console service-role auditado, faça apenas leituras:

```sql
select public.portal_schema_capabilities_service();
select public.portal_billing_usage_backlog_service();
select public.portal_provider_effect_reconciliation_backlog_service();
select state, count(*) from public.ai_usage_reservations group by state order by state;
```

O primeiro resultado deve declarar `version: 40` e as capacidades aditivas de
reservas, AI, outbox, webhooks, transcript e reconciliação. Para uma primeira
instalação drenada, os backlogs devem começar em zero; qualquer valor não zero
exige origem identificada e observação, sem mutação manual.

## 4. Contract: aplicar 0041 e 0042 ainda em maintenance

Sem reiniciar o artefato legado e mantendo tráfego zero, o database operator
aplica `database/supabase-only/0041_provider_transcript_contract.sql` e, com o
receipt de sucesso, aplica imediatamente
`database/supabase-only/0042_cost_event_schema_and_legacy_writer_contract.sql`.
A 0041 revoga writers autenticados de provider transcript/meeting bot; a 0042
alinha todo `cost_events` ao contrato `2.1.0` e revoga os três writers diretos
legados de custo. A sequência completa é a fronteira sem retorno aos writers
legados.

Confirme pelo console service-role:

```sql
select public.portal_schema_capabilities_service();
```

O JSON deve ter `version: 42`, `costEventSchemaVersion=true`,
`legacyCostWritersRevoked=true` e todas as capacidades listadas na seção
seguinte verdadeiras. Se qualquer flag estiver falsa, mantenha maintenance e
não inicie o candidato.

## 5. Iniciar o candidato v42 com tráfego zero

Construa/inicie o candidato usando o SHA registrado, mas mantenha domínio
público, ingress ou route promotion desligados. O healthcheck Railway continua
apontando para `/api/ready`; não troque para `/api/health` para forçar uma
promoção. Esta ordem é intencional: o candidato só inicia depois de 0042, já
compatível com o schema v42, e o bootstrap bem-sucedido já persistiu os dois
heartbeats compatíveis. Se `/api/ready` retornar 503 no startup, pare: não use
uma execução manual de worker para contornar divergência de identidade,
fingerprint, schema ou configuração.

No endpoint privado do candidato:

```bash
curl --fail-with-body --silent --show-error "${CANDIDATE_URL}/api/health"
curl --fail-with-body --silent --show-error "${CANDIDATE_URL}/api/ready"
```

Readiness deve retornar 200 imediatamente depois do bootstrap e do startup do
processo. Isso confirma a admissão do artefato, mas não substitui a prova manual
dos dois workers na seção 7. O schema v42 deve declarar todas estas capacidades
verdadeiras:

- `providerEffectReservations`;
- `providerEffectReconciliation`;
- `billingUsageOutbox`;
- `billingCheckoutIntents`;
- `strictSubscriptionIdentity`;
- `legacySubscriptionWriterRevoked`;
- `costEventSchemaVersion`;
- `legacyCostWritersRevoked`;
- `recallWebhookDedupe`;
- `recallTenantBinding`;
- `tavusWebhookCapabilities`;
- `tavusCustomerDeliveryReceipts`;
- `tavusStageCapabilities`;
- `aiUsageReservations`;
- `aiUsageReconciliation`;
- `workerHeartbeats`;
- `providerTranscriptService`;
- `authenticatedProviderTranscriptPreclaimBlocked`;
- `authenticatedMeetingBotPreclaimBlocked`.

Depois confirme no candidato:

```bash
curl --fail-with-body --silent --show-error "${CANDIDATE_URL}/api/ready"
```

Exija HTTP 200, `ok: true`, todas as checks de configuração verdadeiras e
`database/schema: true`. Salve corpo redigido, status, timestamp e SHA. Não
roteie tráfego se a capability estiver incompleta, se a RPC exceder o deadline
de três segundos ou se a readiness oscilar.

## 6. Smokes em test mode, ainda sem tráfego público

Use somente conta, Prices, customer, subscription e tenant sintéticos de test
mode. Execute um caso por vez com correlation/command ID novo e preserve os
receipts:

1. Reserva que falha por cap não deve chamar provider.
2. Replay da mesma intenção deve retornar a mesma reserva/efeito, sem segunda
   criação.
3. Tavus/Recall aceito deve persistir cost event UUIDv7 e permanecer `held` até
   o receipt visível ao cliente.
4. Terminal Recall antes de `camera_started` deve impedir nova Tavus e deixar a
   compensação/void observável.
5. `camera_started` deve ativar billing uma única vez; abaixo da franquia não
   cria outbox de overage e acima dela cria exatamente uma linha.
6. Timeout pós-dispatch deve virar `unknown` e bloquear novo gasto; não tente
   liberar a linha nesta janela.
7. Webhook Recall assinado deve aceitar uma vez, replayar sem efeito duplicado
   e rejeitar assinatura, idade ou host de transcript inválidos.
8. Checkout e webhook Stripe test devem persistir primeiro o intent durável,
   vincular um único `cs_*` e então a assinatura correspondente. Repetir o
   comando reutiliza URL/idempotency key; um segundo `sub_*` ativo permanece
   conflito visível e não substitui a assinatura corrente. O snapshot correto
   deve alimentar a ativação seguinte.

Leia novamente os três probes agregados da seção 3. Critérios obrigatórios
antes de workers:

- `deadLetter = 0` nos dois backlogs;
- `unknown = 0` e `providerInFlight = 0` após concluir os casos controlados;
- `cleanupPending = 0` ou uma compensação conhecida ainda em observação, sem
  liberar tráfego;
- `held = 0` após os receipts dos smokes;
- nenhum erro de persistência de receipt, ledger, webhook ou outbox.

O caso deliberado de `unknown` deve ser executado em tenant isolado, evidenciado
e resolvido somente por procedimento de teste que recrie o banco/fixture local;
não crie `unknown` artificial em produção hospedada para provar o gate.

## 7. Provar workers antes de habilitar schedules

Os heartbeats escritos pelo bootstrap provam admissão e identidade no startup;
não provam uma execução operacional dos workflows externos. Conclua os dois
runs manuais abaixo antes de habilitar schedules e antes de iniciar canário ou
promoção.

### Billing

Com `BILLING_DISPATCH_SCHEDULE_ENABLED` ainda falso, execute manualmente
`Dispatch Stripe billing usage`. Confira o evento no Meter do Stripe test mode
e a mesma idempotency key em um retry controlado. A resposta aceita exige:

- HTTP 200 e `ok=true`;
- `failed=0`, `deadLettered=0`, `deadLetterBacklog=0`;
- `unknown=0`, `cleanupPending=0`;
- backlog e held convergindo a zero.

### Provider effects

Com o backlog limpo e o endpoint já validado, habilite o workflow
`Reconcile paid provider effects` no GitHub e dispare uma execução manual antes
do próximo intervalo. A resposta aceita exige HTTP 200, `ok=true`,
`failed=0`, `deadLettered=0`, `deadLetterBacklog=0` e
`operatorRequired=0`. Um backlog vazio é um smoke válido de configuração; não
fabrique um efeito pago real com falha para alimentar o reconciler.

Somente depois da revisão humana dos dois runs:

- defina `BILLING_DISPATCH_SCHEDULE_ENABLED=true`;
- defina `PROVIDER_EFFECT_RECONCILE_SCHEDULE_ENABLED=true`;
- observe pelo menos duas execuções consecutivas de cada worker.

Não avance para a seção 8 enquanto os dois runs manuais e essas observações
não estiverem aceitos.

Os workflows rodam a cada cinco minutos e cada execução aceita persiste um
heartbeat `m5-01-v1`. `/api/ready` exige o último sucesso de ambos com idade de
0 a 720 segundos; `started`, falha, versão divergente ou timestamp futuro não
são prova de prontidão.

## 8. Canário e promoção

Prefira split de tráfego nativo da plataforma, se já estiver configurado. Se
não houver split, não improvise DNS: mantenha maintenance público e use a URL
do candidato com um único tenant/test customer aprovado como canário.

No canário, execute uma conversa curta Tavus e um fluxo Recall controlado em
test mode, confirme receipt de entrega, ledger, outbox/Meter quando aplicável e
ausência de duplicata em replay. Observe duas janelas de worker e duas leituras
de `/api/ready` separadas por pelo menos um intervalo do schedule.

Promova somente quando:

- readiness permaneceu 200 e liveness não mascarou falha de dependência;
- não houve erro de persistência nem criação duplicada;
- backlogs novos convergiram e nenhum dead letter/unknown ficou aberto;
- o billing reviewer confirmou objetos e eventos **test mode**;
- release owner e observer anexaram evidência e aprovaram a retirada gradual
  de maintenance.

A troca para Stripe live, alteração de catálogo live ou cobrança de cliente é
um gate humano posterior e separado. Este runbook não a autoriza.

## Circuit breakers e critérios de abort

Volte imediatamente a maintenance e impeça novas entradas pagas quando ocorrer
qualquer um destes sinais:

- `/api/ready` não 200, instável ou com schema diferente de v42;
- novo `unknown`, `providerInFlight` envelhecendo ou `cleanupPending` crescente;
- `deadLetterBacklog > 0`, `operatorRequired > 0` ou falha do worker;
- `held` acima de 300 segundos, `oldestAgeSeconds` acima de 900 segundos ou
  backlog crescendo por duas observações;
- cost event ausente/inválido, receipt de delivery ausente, outbox duplicada ou
  Meter sem a unidade esperada;
- webhook HMAC, dedupe, ownership de transcript ou isolamento de tenant falhar;
- erro estruturado `billing_usage_*_persistence_failed`,
  `provider_effect_*_persistence_failed`,
  `provider_effect_reconciliation_failed` ou readiness database failure.

Para interromper execução automática, pause os workflows. Se também desligar
`BILLING_USAGE_OUTBOX_ENABLED` ou `PROVIDER_EFFECT_RECONCILER_ENABLED` no app
real, `/api/ready` deve cair para 503; isso é comportamento de segurança e deve
manter o serviço fora de tráfego. Não use um flag como atalho para apagar ou
liberar uma barreira financeira.

## Rollback schema-aware

### Antes de 0041

Mantenha maintenance, pare o candidato e reconcilie toda linha criada por 0040.
O artefato anterior só pode ser restaurado enquanto o schema ainda está em v40
e não há `provider_in_flight`, `unknown`, `cleanup_pending`, `held` ou outbox
pendente. A migration 0040 é aditiva e permanece como evidência; não a reverta.

### Depois de 0041 e antes de 0042

Mantenha maintenance e não inicie nem repromova um candidato. A revogação dos
writers de provider já é efetiva, mas o bootstrap e a readiness desta release
exigem o contrato completo v42. Aplique 0042 como forward-only, confirme a
capability v42 e então siga para o candidato.

### Depois de 0042

Rollback para o writer legado é proibido. Mantenha maintenance e faça uma das
duas ações:

1. repromova o último artefato v42-aware conhecido; ou
2. entregue um forward hotfix v42-aware, repetindo preflight, readiness e
   canário.

Não restaure grants autenticados, não reabra preclaim de provider ref, não
reverta 0041 ou 0042, não restaure os writers diretos de custo, não delete
reservation/outbox/receipt/cost event e não trate lease
expirada como autorização de gasto. Um incidente ambíguo permanece bloqueado
até existir evidência compatível com ADR-036.

## Registro mínimo de evidência

Preencha um único registro, sem PII ou secrets:

```text
window_id:
started_at_utc:
ended_at_utc:
release_owner:
database_operator:
billing_reviewer:
observer:
candidate_commit:
migration_0040_sha256:
migration_0040_receipt:
migration_0041_sha256:
migration_0041_receipt:
migration_0042_sha256:
migration_0042_receipt:
v40_capability_observed_at_during_maintenance:
v42_capability_observed_at:
v42_ready_http_status: 200
local_gate_results:
stripe_test_mode_catalog_receipt:
stripe_test_meter_receipt:
billing_manual_workflow_run:
reconciler_manual_workflow_run:
scheduled_observation_runs:
backlog_before:
backlog_after:
canary_receipts:
circuit_breakers_triggered:
decision: promote | hold | forward-fix
decision_reason:
```

Referências operacionais: [ADR-036](../adr/ADR-036-durable-provider-effect-reservations.md),
[dispatcher Stripe](BILLING_USAGE_DISPATCHER.md),
[reconciliador de efeitos](PROVIDER_EFFECT_RECONCILIATION.md) e
[dependências externas](../NEEDS_CONNECTION.md).
