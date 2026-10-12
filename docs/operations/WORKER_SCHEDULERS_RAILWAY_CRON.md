# Agendadores dos workers no cron do Railway

Status: preparado em 2026-10-12, nada criado em produção. Quem executa os passos 2 a 5 é o operador.

## Por que

O `/api/ready` exige que os heartbeats dos workers financeiros tenham menos de 720 segundos (`WORKER_MAX_AGE_SECONDS`). Quem os renova é o endpoint protegido que cada worker expõe, chamado por agendador externo. Hoje o único agendador é o cron do GitHub Actions, e ele falha de duas formas:

- Mesmo funcionando ele rodou a cada 3 a 6 horas, não a cada 5 minutos (o GitHub atrasa agendamentos).
- Desde 2026-10-11 08:45 UTC todas as execuções falham com "account is locked due to a billing issue".

Efeito medido em 2026-10-12: o deploy passa (o `production:bootstrap` grava os dois heartbeats), mas 12 minutos depois o `/api/ready` volta a 503 só por `workers`. As filas estavam vazias nessa data (uso do Stripe, efeitos pagos e reservas de IA), então nada estava preso. O risco é o primeiro consumo cobrável ficar sem despacho.

## O que foi preparado

`deploy/worker-cron/` é uma imagem mínima (Node 24 alpine, usuário não root, dois arquivos) que faz a mesma chamada dos workflows: POST com Bearer na rota protegida do portal, mesmo teto de espera (480 s, 90 s e 120 s), sem retry, mesmo filtro de resposta. Sai com código 0 só se o portal respondeu 200 e o filtro aceitou. O segredo nunca vai para o log, e um redirecionamento conta como falha (não é seguido).

- `gates.mjs`: os filtros de resposta em JavaScript. `tests/operations/worker-cron.test.mjs` roda os mesmos payloads no `jq` original (`scripts/worker-response-gate.jq` e o filtro embutido no workflow de reuniões) e exige o mesmo resultado.
- `worker-cron.mjs`: o executor. Configuração por variáveis do serviço: `WORKER` (`billing`, `reconciler` ou `meeting`), `WORKER_URL` e `WORKER_SECRET`.
- `railway.json`: build por Dockerfile, `cronSchedule` de `*/5 * * * *` (o mínimo do Railway; deixa folga para uma execução perdida dentro da janela de 12 minutos) e `restartPolicyType: NEVER`.

Os segredos não são copiados: os serviços novos referenciam as variáveis que o serviço `portal` já tem, pela sintaxe `${{portal.NOME}}` do Railway.

## Passo a passo

Pré-requisito: `railway status` mostra o projeto `axtro-digital-human-os`, ambiente `production`. Se o `railway add` pedir ambiente, escolha `production`.

### 1. Conferir as filas antes (leitura)

O primeiro disparo despacha o que estiver pendente, inclusive eventos de uso do Stripe. Veja o que há:

```sql
select status, count(*) from public.billing_usage_outbox group by status;
```

Em 2026-10-12 estava vazio. Se houver linhas pendentes e a chave do Stripe for de produção, o primeiro disparo as envia de verdade.

### 2. Despachante de uso do Stripe

```bash
railway add --service cron-billing-usage
railway variable set --service cron-billing-usage --skip-deploys 'WORKER=billing' 'WORKER_URL=${{portal.PORTAL_PUBLIC_URL}}/api/internal/billing-usage' 'WORKER_SECRET=${{portal.BILLING_DISPATCH_SECRET}}'
railway up deploy/worker-cron --path-as-root --service cron-billing-usage --environment production --ci -m "cron do despachante de uso"
```

### 3. Reconciliador de efeitos pagos

```bash
railway add --service cron-provider-effects
railway variable set --service cron-provider-effects --skip-deploys 'WORKER=reconciler' 'WORKER_URL=${{portal.PORTAL_PUBLIC_URL}}/api/internal/provider-effects/reconcile' 'WORKER_SECRET=${{portal.PROVIDER_EFFECT_RECONCILE_SECRET}}'
railway up deploy/worker-cron --path-as-root --service cron-provider-effects --environment production --ci -m "cron do reconciliador"
```

### 4. Verificar

Depois de 5 a 10 minutos, no painel de cada serviço a execução deve aparecer como concluída, com uma linha JSON no log (`worker`, `status` 200 e os contadores). Os heartbeats devem estar novos:

```sql
select worker_name, last_succeeded_at, extract(epoch from (now() - last_succeeded_at))::int as age_seconds from public.worker_heartbeats order by worker_name;
```

O teste que importa é esperar mais de 12 minutos depois do último deploy e ler o `/api/ready` duas vezes, com intervalo. Deve continuar 200:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://closer.axtroai.com/api/ready
```

### 5. Desligar o agendamento do GitHub

Só depois de verificar. Os endpoints trabalham por lease, então uma sobreposição curta é segura, mas manter dois agendadores só gera chamadas à toa. Os workflows já têm a chave:

```bash
gh variable set BILLING_DISPATCH_SCHEDULE_ENABLED --body false
gh variable set PROVIDER_EFFECT_RECONCILE_SCHEDULE_ENABLED --body false
```

## Terceiro serviço (reuniões)

`MEETING_TERMINAL_NOTIFICATION_OUTBOX_ENABLED` está `false` em produção, então não há o que despachar e o `/api/ready` não exige esse heartbeat. Quando for ligado, crie `cron-meeting-notifications` com `WORKER=meeting`, `WORKER_URL=${{portal.PORTAL_PUBLIC_URL}}/api/internal/meeting-terminal-notifications` e `WORKER_SECRET=${{portal.MEETING_TERMINAL_NOTIFICATION_DISPATCH_SECRET}}`.

## Reverter

Remova os serviços `cron-billing-usage` e `cron-provider-effects` no painel do Railway (Settings, Delete Service) e religue o agendamento antigo com `gh variable set BILLING_DISPATCH_SCHEDULE_ENABLED --body true` e `gh variable set PROVIDER_EFFECT_RECONCILE_SCHEDULE_ENABLED --body true`. Nada no portal, no banco ou no app muda em nenhum dos dois sentidos.

## Limites

- Quem alerta é o `/api/ready`. Se ainda não houver monitor de disponibilidade apontado para ele, configure um: é o único sinal de que o agendador parou.
- O custo é de dois contêineres que rodam alguns segundos a cada 5 minutos. Confira o painel de uso depois de um dia; está longe do gate de R$ 500 por mês, mas o número real é o do painel.
- A imagem base está fixada por digest (`node:24-alpine@sha256:...`), então o contêiner só muda quando alguém decidir. Isso também significa que correções de segurança do Node e do Alpine não entram sozinhas: a cada trimestre, ou quando sair um aviso, troque o digest no `Dockerfile` (veja o digest atual de `node:24-alpine` no Docker Hub), rode `node --test tests/operations/worker-cron.test.mjs` e reimplante os dois serviços com o `railway up` do passo 2 e 3.
