# Axtro Agent Control Plane

## Papel

O Axtro Agent, baseado no engine Hermes e executado como daemon, é o gerente operacional autônomo. Ele não é o motor de turnos.

## Pre-call
- recebe lead ou reunião;
- solicita dados através de APIs com scope próprio;
- cria `pre_call_briefing` versionado;
- recomenda role pack, especialistas, scenes e constraints;
- preaquece recursos através de comandos do Control Plane;
- nunca recebe secrets de tenant.

## In-call
- consome eventos redigidos ou autorizados;
- produz `agent_suggestion` com context version e TTL;
- pode solicitar avaliação de risco ou handoff;
- não publica mídia e não faz chamada síncrona pelo worker.

## Post-call
- dispara ou observa workflow;
- propõe resumo, tarefas, follow-up e experiment candidates;
- atualiza sistemas somente via Action Runtime;
- gera coaching e análise agregada.

## Bridge

Interface HTTP/event-driven autenticada por service identity:
- submit briefing;
- submit suggestion;
- request workflow;
- query status;
- receive domain events.

## Resiliência

- daemon offline não muda session health para failed;
- sugestões atrasadas são descartadas;
- commands são idempotentes;
- backlog do daemon possui quota por tenant;
- kill switch pode desativar o bridge sem derrubar calls.
