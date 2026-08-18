# Runbook — expansão do runtime bridge M5-02

## Limite de autoridade

Este runbook complementa o rollout M5-01. Ele não autoriza migrations
remotas, tráfego público, cobrança, mudança de credenciais ou promoção de
deploy sem o release owner, database operator, observer e a janela humana
descritos em `M5_01_PRODUCTION_ROLLOUT.md`.

O objetivo é promover um artefato compatível com schema **v46**, mantendo
`PORTAL_RUNTIME_BRIDGE_ENABLED=false` até que as evidências abaixo existam.
Com a flag desligada, o Portal falha fechado: não há fallback para criação
direta de Tavus, Recall ou lead-video.

## Pré-condições imutáveis

- O candidato já passou `pnpm db:portal:test`, `pnpm lint`, `pnpm typecheck`,
  `pnpm test`, `pnpm build` e `python3 scripts/validate_all.py` no commit exato.
- O banco hospedado está drenado conforme o runbook M5-01; efeitos `unknown`,
  `provider_in_flight`, `cleanup_pending` e backlogs financeiros não recebem
  tratamento manual por tempo decorrido.
- O operador registrou apenas SHA do artefato e checksum das migrations
  `0040`–`0046`; nunca copie segredo, URL de reunião, provider ref, payload ou
  PII para a evidência.
- As reuniões externas e o handoff de leads continuam explicitamente fechados
  até existir convite/disclosure/consentimento por participante. Não use uma
  flag para reabrir esses caminhos.

## Janela de aplicação

1. Coloque as entradas pagas em maintenance e preserve somente callbacks
   necessários para concluir o drain.
2. Confirme que a produção está em v45, com 0040–0045 aplicadas e sem
   migration parcial. Aplique **somente então**
   `database/supabase-only/0046_provider_effect_termination_fence.sql`, uma
   vez, na mesma janela de maintenance. Não use `supabase db push`: estas
   migrations Supabase-only exigem o operador de banco aprovado.
3. Com service role auditada, leia `portal_schema_capabilities_service()` e
   exija `version: 46`, `providerEffectTerminationFence:true` e todas as
   capabilities de runtime:
   `runtimeChannelAdmission`, `runtimeChannelGrantFences`,
   `runtimeProviderBindingReceipts`, `runtimeSceneReceipts`,
   `runtimeKillSwitches`, `runtimeDualOperatorReconciliation` e
   `runtimeBridgeReceiptIntegrity`. Confirme também que tabelas e funções de
   término têm RLS forçada, nenhum grant para `anon`/`authenticated` e somente
   `service_role` executa as RPCs.
4. Faça o deploy candidato ainda com
   `PORTAL_RUNTIME_BRIDGE_ENABLED=false`. O bootstrap e `/api/ready` devem
   ficar verdes sem reabrir provider creation. O bootstrap deve falhar fechado
   se a capability v46 não existir.

## Canário controlado

1. Com tráfego público ainda em zero, habilite a flag somente para o
   candidato/canário aprovado e uma conta de teste sem dados de clientes.
2. Verifique uma sessão Tavus direta: disclosure visível, cinco confirmações
   de finalidade, uma session/grant/receipt por comando e uma única criação
   do provider. Desligue a flag e confirme que a próxima tentativa não cria
   reserva nem provider.
3. Verifique o kill switch tenant/agent/capability antes de criação e antes de
   callback. A tentativa deve falhar fechada; uma cena atrasada deve produzir
   rejeição por geração, nunca alteração local.
4. Exercite um contexto adversarial de provider/RAG. Confirme em telemetria
   que ele aparece como dado não confiável e nunca como mensagem `system`.
5. Faça dois operadores distintos aprovarem uma reconciliação de efeito
   `unknown` de teste; confirme recibo imutável. Uma aprovação só não pode
   reconciliar.
6. Antes de abrir tráfego, prove no canário que um receipt com provider ref ou
   URL diferente da reservation retorna falso sem gravar evidência, e que uma
   tentativa de evento de kill switch com tenant divergente é rejeitada pelo
   banco. Registre somente hashes/IDs permitidos, nunca URL de reunião.
7. No banco local e no canário sem cliente, prove que duas solicitações de
   término concorrentes recebem no máximo uma lease de dispatch, que retry/
   lease expirada não aceita settle antigo e que o resultado HTTP público não
   contém provider ref, reservation ou token. `provider_accepted` significa
   aceite do pedido pelo provider — não silêncio físico de áudio/vídeo.

## Promoção, rollback e observação

Promova somente após os canários, backlogs e `/api/ready` verdes serem
registrados pelo observer. Em incidente, desabilite o kill switch durável ou
`PORTAL_RUNTIME_BRIDGE_ENABLED`; ambos bloqueiam efeitos novos. Não restaure
o artefato legado, não apague recibos e não libere efeitos ambíguos. Use um
forward fix ou a reconciliação de dois operadores. A v46 contém o pedido de
término entre réplicas, mas não remove o bloqueio P0 de promoção realtime:
somente o canário independente de mídia pode demonstrar descarte de saída
tardia e confirmar término físico.
