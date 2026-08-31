# ADR-043: Outbox durável para notificações terminais de reunião

**Status:** Aceito para implementação local em 2026-08-31. A ativação do worker, aplicação da migration em banco remoto, configuração de segredo e qualquer envio real continuam fora desta autorização.
**Data:** 2026-08-31
**Relacionados:** Arts. 3, 5, 7, 10, 11, 12, 14, 15 e 17 da Constituição; ADR-029, ADR-036, ADR-042; M6-01 em `backlog/MVP_TASK_GRAPH.yaml`

## Contexto

O webhook da Recall grava `terminal_notification_claimed_at` antes de consultar destinatários ou chamar a Resend. Depois dessa claim, falha de banco, processo, rede, timeout ou resposta inválida do provedor não libera nova tentativa. A rota ainda conclui a entrega da Recall. O estado persistido significa apenas "a tentativa começou", mas o sistema o trata como notificação concluída.

O adapter atual também cria uma nova chave de idempotência a cada invocação e aceita qualquer HTTP 2xx como sucesso, sem validar nem persistir o identificador retornado pelo provedor. Assim, o fluxo combina risco de perda com risco de duplicata.

O `events_outbox` canônico não é apropriado para este efeito. Ele tem um consumidor definido e não oferece fanout. O workflow pós-call atual também não oferece a persistência PostgreSQL e o fence de provider exigidos. Introduzir Kafka, Temporal ou outro serviço novo para um único efeito aumentaria o acoplamento sem resolver melhor o problema imediato.

## Decisão

### Outbox PostgreSQL dedicado e fora do loop realtime

Será criado um outbox dedicado, tenant-scoped, processado por um worker HTTP assíncrono. Nenhuma parte do worker entra no caminho síncrono de áudio, vídeo, floor, tool call ou presenter.

As tabelas são:

- `meeting_terminal_notification_outbox`, sem destinatário, HTML ou resposta crua do provedor;
- `meeting_terminal_notification_payloads`, isolada, com RLS forçada, acesso apenas por RPC e retenção curta para o payload restrito;
- `meeting_terminal_notification_attempt_receipts`, append-only e sem PII.

Todas as tabelas carregam `tenant_id`. DML direto é revogado inclusive de `service_role`. O acesso ocorre somente por RPCs `security definer`, com argumentos tenant-scoped e leases cercadas por token.

### Enqueue na mesma transação do estado terminal

O helper privado `app.portal_enqueue_meeting_terminal_notification` será chamado por dois produtores:

1. `portal_update_meeting_bot_session_status_service`, quando uma sessão existente entra em `ended` ou `failed`;
2. `portal_record_meeting_bot_session_service`, quando a sessão é criada depois de a evidência terminal já ter chegado.

O identificador do comando é o próprio `meeting_session_id`. A chave do provedor é estável e persistida no formato `meeting-terminal:v1:<meeting_session_id>`. O insert é idempotente, mas um replay com tuple diferente falha como conflito.

A migration não envia notificações históricas. Sessões terminais anteriores são marcadas como legado de resultado desconhecido, sem backfill de e-mail. A função antiga de claim permanece para compatibilidade binária, mas passa a retornar `false` e nunca concede um novo envio inline.

### Payload em duas fases e fence antes da rede

O enqueue registra o snapshot mínimo de contexto e administradores. Cada lease consulta novamente os administradores do tenant. Enquanto o payload ainda não foi congelado, esse conjunto pode ser atualizado e a ausência de destinatário produz `suppressed`, nunca falso sucesso. Depois do primeiro fence, qualquer diferença no conjunto de autoridades encerra o comando em `dead_letter` com `recipient_authority_changed`, sem novo egress e sem alterar bytes ou chave de um efeito potencialmente ambíguo.

O worker renderiza uma versão fechada do template e chama `portal_begin_meeting_terminal_notification_dispatch_service`. Essa RPC revalida a autoridade uma segunda vez, persiste destinatários, assunto, HTML e SHA-256 exatos, marca o início potencial do efeito e só então autoriza a chamada externa. Depois desse fence o payload é imutável. Uma nova versão visual exige novo `template_version`; o renderer de uma versão já publicada não pode mudar.

Se o processo cair antes do fence, a lease expirada é recuperável como `lease_expired`. Se cair depois do fence, o resultado é `ambiguous`; a próxima tentativa usa exatamente a mesma chave e os mesmos bytes.

### Máquina de estados

```text
pending -> delivering -> provider_accepted
                    \-> retry_wait -> delivering
                    \-> ambiguous -> delivering
                    \-> dead_letter
pending -> suppressed
```

Invariantes:

- somente `delivering` possui `lease_token` e `lease_until`;
- `attempts` fica entre 0 e 8;
- ack e fail exigem tenant, notification ID, token e lease ainda viva;
- `provider_accepted` exige receipt digest e timestamp;
- `dead_letter` e `suppressed` são terminais e nunca voltam a ser leased;
- o deadline automático é 23 horas após o enqueue, menor que a retenção documentada de 24 horas da chave idempotente da Resend;
- uma ambiguidade depois do deadline nunca é reenviada automaticamente.

`provider_accepted` significa que a API da Resend aceitou a requisição e devolveu um ID válido. Não significa entrega na caixa do destinatário. `email.delivered` continua sendo uma evidência posterior e distinta.

### Resultado fechado do adapter

O port do provedor retorna apenas uma união fechada:

- `provider_accepted`, com referência de provider validada;
- `retryable_failure`, com código fechado e `retryAfterSeconds` limitado;
- `permanent_failure`, com código fechado;
- `provider_ambiguous`, para timeout, transporte interrompido ou 2xx sem receipt válido;
- `simulated`, somente no fake determinístico.

Nunca são persistidos corpo cru, mensagem crua, endereço de destinatário em log ou erro do provedor. O adapter usa o endpoint batch para criar uma mensagem separada por destinatário, impedindo que administradores vejam endereços uns dos outros. Os IDs retornados são validados como um conjunto completo e transformados em um único digest antes do receipt durável.

### Retentativa, rate limit e ambiguidade

A Resend mantém idempotência por 24 horas e documenta limite padrão atual de 10 requisições por segundo por equipe. O worker processa no máximo 4 comandos sequenciais por execução, uma chamada batch por comando, timeout de 10 segundos e lease de 60 segundos. O limite de 4 preserva margem de 20 segundos para banco e scheduling no pior caso válido. Respostas 429 permanecem retentáveis porque o limite é compartilhado com outras chaves da equipe e pode mudar.

São retentáveis, dentro do budget, rede, timeout, 429, 5xx, autenticação/configuração temporariamente divergente e `409 concurrent_idempotent_requests`. Validação, rejeição permanente e `409 invalid_idempotent_request` são terminais. A rota faz preflight de configuração antes da lease, então ausência local conhecida de credencial não consome tentativa. O banco, não texto arbitrário do worker, decide o próximo estado a partir de códigos fechados.

### Bot terminal ainda não materializado

A evidência assinada da Recall continua retida. Enquanto a sessão pode chegar, a rota responde 503 de forma limitada. Depois de 8 tentativas ou 15 minutos, o receipt recebe resolução `orphaned_deadline`, a entrega é concluída e o retry infinito termina. Se a sessão for registrada depois, ela consome a evidência terminal retida, muda a resolução para `matched_late` e enfileira exatamente um comando.

### Readiness e operação

Readiness passa a separar:

- ingestão Recall, que prova HMAC e capacidade do schema;
- worker `meeting_terminal_notification`, que prova versão, deployment, fingerprint e último sucesso;
- backlog, dead letters e idade do item mais antigo, sem PII.

O artefato bridge aceita schema 56 ou 57. Com a feature flag desligada, o worker fica dormente e o schema 56 continua compatível. Com a flag ligada, schema 57, segredo do dispatcher, configuração do provider e heartbeat passam a ser obrigatórios.

## Rollout e rollback

1. Publicar o artefato bridge que aceita v56/v57, com flag desligada.
2. Aplicar a migration 0057. Ela desativa a claim inline e acumula novos comandos sem enviar.
3. Executar uma canary manual sem envio real, validar lease, fake, backlog e heartbeat.
4. Manter Resend real e a flag desligados em qualquer ambiente compartilhado, pois M6-01 ainda não possui escopo de lease por tenant.
5. Concluir M6-05, incluindo escopo fail-closed de canary, quota por tenant, reconciliação de entrega, backoff ao longo do deadline, fairness, SLO de backlog, retenção e fila operacional.
6. Só então configurar o provider por operação autorizada, executar um canary tenant-scoped e observar ambiguidade, dead letters e idade do backlog.
7. Ativar a agenda completa e tornar o heartbeat obrigatório depois dos gates humanos.

Depois da migration 0057, rollback para um artefato anterior à v57 é proibido: esse artefato rejeita a versão do schema e os produtores PostgreSQL continuam enfileirando. O rollback suportado mantém um build compatível com v57, define a flag do worker como `false` e suspende o workflow, ou aplica um hotfix forward-only. O outbox não é apagado, nenhum rollback reabre a claim antiga e itens históricos não são reenviados.

### Limites que bloqueiam agenda automática

M6-01 fecha perda, duplicata ordinária, tenant binding, autoridade de destinatário e evidência local. Ela não autoriza envio real nem tráfego contínuo de clientes, porque a lease global ainda não isola um tenant canário. Antes de qualquer provider real ou agenda automática são obrigatórios os controles de M6-05: escopo fail-closed de canary, quota e budget por tenant, seleção tenant-fair, distinção entre rate limit e quota, circuit breaker, reconciliação durável de `sent`/`delivered`/`failed`/`bounced`/`suppressed`, SLO de backlog, política final de retenção e uma fila content-free para operador. Resend permanece o único adapter real deste canal até benchmark ou necessidade comprovada de fallback.

## Alternativas rejeitadas

- Claim antes do send: perde o efeito após qualquer falha intermediária.
- Lease sem chave estável: reduz perda, mas não resolve aceitação remota com ACK local perdido.
- Chave aleatória por processo: não protege replay entre processos.
- Reutilizar `events_outbox`: exige fanout e muda o consumidor canônico.
- Persistir provider response ou destinatários no receipt: amplia PII e acoplamento sem necessidade.
- Reenviar após 24 horas de ambiguidade: a garantia de idempotência do provider expirou.
- Introduzir Kafka ou Temporal agora: não é necessário para este efeito e aumenta a superfície operacional.

## Evidência exigida

- enqueue atômico nas duas ordens da corrida terminal/sessão;
- webhook duplicado produz um comando;
- dois workers concorrentes produzem uma lease vencedora;
- lease expirada invalida ack/fail antigos;
- crash antes e depois do fence têm resultados diferentes e conservadores;
- provider aceitou e resposta local sumiu usa a mesma chave e um único efeito lógico;
- 2xx sem ID nunca é sucesso;
- tentativa 8, deadline e falha permanente terminam em dead letter;
- bot ausente termina sem 503 infinito e pode materializar tarde;
- nenhuma leitura ou mutação cross-tenant;
- mudança de autoridade antes do fence ou em retry impede novo egress;
- cada mensagem batch contém somente um destinatário;
- nenhum e-mail, HTML ou resposta crua aparece em log, heartbeat, receipt ou resposta HTTP;
- harness PostgreSQL repetido duas vezes e gates canônicos verdes.

## Fontes primárias do provider

- `https://resend.com/docs/dashboard/emails/idempotency-keys`
- `https://resend.com/docs/api-reference/emails/send-batch-emails`
- `https://resend.com/docs/api-reference/errors`
- `https://resend.com/docs/api-reference/rate-limit`
- `https://resend.com/docs/webhooks/introduction`
