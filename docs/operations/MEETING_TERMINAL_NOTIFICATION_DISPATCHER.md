# Meeting terminal notification dispatcher

Runbook operacional do outbox definido pela ADR-043. Este documento não autoriza migration remota, segredo, flag, deploy, envio real ou agenda automática.

## Contrato operacional

- Produtor: transição terminal da Recall na mesma transação que grava `ended` ou `failed`.
- Comando estável: um item por `meeting_session_id`, com chave `meeting-terminal:v1:<meeting_session_id>`.
- Worker: `POST /api/internal/meeting-terminal-notifications`, lote máximo de 4, lease de 60 segundos e timeout de provider de 10 segundos.
- Provider real: Resend. O modo fake determinístico usa `PORTAL_FAKE_PROVIDERS=1` e não acessa a rede.
- Resultado qualificado: `provider_accepted` só depois de ID válido da Resend e ACK durável local. Isso não prova entrega na caixa do destinatário.
- Estados que exigem operador: qualquer `ambiguous`, `dead_letter`, resposta HTTP diferente de 200 ou heartbeat ausente.

Nenhum log, heartbeat, resposta HTTP ou attempt receipt contém e-mail, assunto, HTML, URL de reunião ou corpo cru do provider.

## Pré-condições de rollout

1. Publicar uma versão da aplicação que aceite schema 56 e 57, mantendo `MEETING_TERMINAL_NOTIFICATION_OUTBOX_ENABLED=false`.
2. Executar preflight read-only no ambiente hospedado e confirmar a sequência de migration. O estado remoto não foi consultado por M6-01.
3. Aplicar `0057_meeting_terminal_notification_outbox.sql` somente com autorização explícita.
4. Confirmar `/api/ready` ainda verde com a flag desligada.
5. Gerar um segredo exclusivo de pelo menos 24 caracteres e configurá-lo como `MEETING_TERMINAL_NOTIFICATION_DISPATCH_SECRET` no runtime e nos GitHub Actions secrets.
6. Criar o GitHub Environment protegido `production`, exigir required reviewers e manter o secret restrito a esse environment.
7. Configurar a repo variable `MEETING_TERMINAL_NOTIFICATION_DISPATCH_URL` exatamente como `https://closer.axtroai.com/api/internal/meeting-terminal-notifications`.
8. Confirmar `RESEND_API_KEY` e identidade imutável de deployment no runtime.

A migration não faz backfill histórico. Linhas terminais anteriores ficam marcadas como legado de resultado desconhecido e não disparam e-mail.

## Canary sem envio real

1. Em um ambiente isolado, manter `PORTAL_FAKE_PROVIDERS=1` e ativar a flag do outbox.
2. Criar uma única sessão de teste e fazê-la chegar a estado terminal.
3. Disparar manualmente o workflow `Dispatch meeting terminal notifications` pelo `workflow_dispatch`.
4. Exigir HTTP 200, `simulated=1`, todos os contadores de falha em zero e heartbeat `meeting_terminal_notification` fresco.
5. Repetir o webhook terminal e o workflow. O segundo processamento não pode criar novo comando nem novo efeito lógico.
6. Desligar a flag antes de sair do ambiente de teste.

O workflow versionado é deliberadamente manual, não faz checkout de código, injeta o bearer somente no passo de dispatch e faz uma única chamada sem retry HTTP. Nenhuma agenda foi criada por M6-01. O bootstrap valida configuração e backlog, mas nunca grava heartbeat do worker; somente uma execução real e limpa do dispatcher pode provar sua saúde.

## Canary real bloqueado até M6-05

A lease de M6-01 seleciona o backlog global por disponibilidade e não oferece um filtro seguro por tenant. Portanto, ligar o provider real em um ambiente compartilhado pode escolher um comando de cliente mais antigo antes do tenant interno pretendido. Não ativar a flag com Resend real, não executar este workflow contra uma fila compartilhada e não tratar o GitHub Environment como isolamento de tenant.

Somente o canary fake em ambiente isolado acima é permitido em M6-01. M6-05 deve adicionar seleção tenant-fair e um escopo de canary fail-closed, além de quota, custo e reconciliação de entrega, antes do primeiro envio real. Aceitação da API continuará não sendo prova de entrega final.

## Resposta a incidentes

| Sinal | Interpretação | Ação segura |
|---|---|---|
| `retryScheduled > 0` | falha transitória conhecida | manter agenda desligada, corrigir configuração ou aguardar provider e executar novo lote manual dentro do deadline |
| `ambiguous > 0` ou `ambiguousBacklog > 0` | efeito externo pode ter ocorrido sem ACK local | não trocar chave nem payload; repetir somente pelo worker, dentro de 23 horas |
| `deadLettered > 0` ou `deadLetterBacklog > 0` | budget, deadline, payload ou rejeição terminal | bloquear promoção e investigar por IDs internos e códigos fechados, nunca por PII em logs |
| heartbeat acima de 720 segundos | worker ausente ou deployment divergente | manter readiness não pronta e verificar identidade, fingerprint, segredo e execução manual |
| backlog cresce sem falha | capacidade insuficiente ou worker inativo | manter novos efeitos controlados e aumentar frequência apenas após canary e autorização |

## Rollback

1. Definir `MEETING_TERMINAL_NOTIFICATION_OUTBOX_ENABLED=false` e não executar o workflow.
2. Não reabrir a claim antiga. Na v57 ela retorna sempre `false`.
3. Não apagar outbox, payload ou receipts. A flag desligada pausa o worker; comandos já enfileirados permanecem para drenagem posterior autorizada.
4. Não reverter a migration de forma destrutiva. Corrigir forward-only.
5. Não promover um artefato anterior à v57 depois do apply. O rollback suportado usa build v57-aware com flag desligada ou hotfix forward-only.

Desligar a flag em schema v57 não perde novos eventos terminais: a RPC de estado continua fazendo enqueue atômico, mas o worker fica dormente. O backlog precisa ser acompanhado durante o rollback.

## Retenção e fechamento

- Payload de um ACK aceito ou simulado recebe `purge_after` de 1 dia.
- Payload de dead letter recebe `purge_after` de 30 dias.
- O cleanup apaga somente payloads vencidos, em lotes de até 500.
- Outbox e attempt receipts são evidência tenant-scoped. A política final de retenção, legal hold, redação e deleção pertence a M6-04.

## Bloqueios antes de agenda automática

Canary fake manual não equivale a autorização para envio real. M6-05 deve fechar escopo de canary por tenant, quota e budget por tenant, fairness, reconciliação dos eventos finais da Resend, backoff distribuído pelo deadline, circuit breaker, SLO de idade do backlog, retenção content-free e fila de operador. Até lá, a flag permanece desligada em ambiente compartilhado, o GitHub Environment `production` permanece protegido e o workflow somente manual.

## Fontes do provider

- [Idempotency Keys](https://resend.com/docs/dashboard/emails/idempotency-keys)
- [Usage Limits](https://resend.com/docs/api-reference/rate-limit)
- [Errors](https://resend.com/docs/api-reference/errors)
- [Send Batch Emails](https://resend.com/docs/api-reference/emails/send-batch-emails)
- [Managing Webhooks](https://resend.com/docs/webhooks/introduction)
