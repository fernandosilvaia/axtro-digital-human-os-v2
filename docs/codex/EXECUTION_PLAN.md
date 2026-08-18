# Plano de execução pós-auditoria

## Entregue nesta onda

1. Corrigida a fronteira de correlação UUID, sem tornar IDs autoritativos permissivos.
2. Implementada migration 0044 de integridade de receipts e FK tenant/switch; readiness exige v44 e falha fechada até aplicação humana.
3. Tornada a telemetria recursivamente redigida e resistente a entrada hostil.
4. Corrigidas canonical, metadata legal, AEO, política de crawlers e copy de preço/privacidade.
5. Adicionadas provas SQL de tenant, One Mouth concorrente e replay/receipt; adicionado gate público de saída App Router.

## Próxima sequência recomendada

| Prioridade | Ação | Dono necessário | Gate de saída |
| --- | --- | --- | --- |
| P0 | Criar tarefa de arquitetura de media boundary: geração identificada, cancelamento, fence de áudio tardio, reconnect e handoff real. | Arquitetura realtime + provider owner | Cenários contra provider sandbox; nenhum áudio tardio após cancelamento. |
| P1 | Aplicar 0044 em maintenance após validar checksum e drain de efeitos ambíguos. | Database operator + release owner | `portal_schema_capabilities_service()` v44 e `/api/ready` verdes com flag desligada. |
| P1 | Canário zero-tráfego do bridge Tavus e, separadamente, Recall. | Release owner + observer | Disclosure/consent/receipt/ref exatos; kill switch bloqueia novo efeito. |
| P2 | Modelar response runtime v44 em contratos gerados e fixtures. | Backend contract owner | Schemas/examples e consumidores compatíveis. |
| P2 | Manter o Playwright público obrigatório em PR e E2E autenticado condicional. | CI owner | Job público verde sem segredo; job autenticado não é substituído. |
| P3 | Rever `Google-Extended`/`CCBot` com jurídico/produto se grounding virar prioridade. | Product/legal | Decisão registrada e robots/llms coerentes. |

## Sequência segura de rollout v44

1. Manter `PORTAL_RUNTIME_BRIDGE_ENABLED=false`.
2. Drenar e registrar somente evidência permitida de `unknown`, `provider_in_flight` e backlogs.
3. Aplicar 0043 e 0044 em ordem durante maintenance; não editar migration aplicada nem abrir rota legada.
4. Consultar capability v44; rodar bootstrap/readiness e testes de canário.
5. Habilitar apenas o canário aprovado, observar receipts e kill switches.
6. Em incidente, desligar bridge/kill switch e usar forward fix ou reconciliação de dois operadores — nunca apagar receipt ou aceitar efeito ambíguo.

## Métricas a registrar antes de promoção

- Taxa de admissão/grant/replay/rejeição por canal, sem PII.
- Número de `one_mouth_conflict`, stale generation e dispatch recusado.
- Idade e volume de reservations `unknown`/`provider_in_flight`.
- Latência e taxa de cancelamento de mídia real; ocorrência de áudio tardio.
- Health do E2E público e erros de metadata/robots.

## Fora de escopo deliberadamente

Não houve mudança de provider definitivo, secrets, preços Stripe, dados de clientes, produção, migration remota, commit ou push. A ausência desses atos é parte da segurança da entrega.
