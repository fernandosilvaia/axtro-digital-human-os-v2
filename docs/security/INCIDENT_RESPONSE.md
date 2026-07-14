# Incident Response

## Severidade

- SEV0: risco ativo a pessoas, credenciais mestre ou vazamento multi-tenant.
- SEV1: ação externa indevida, réplica abusada, exposição de PII relevante.
- SEV2: provider outage amplo, perda parcial, degradação comercial.
- SEV3: bug sem impacto confirmado.

## Kill switches

- tenant;
- agent deployment;
- role or skill pack;
- provider and capability;
- specific tool;
- Axtro bridge;
- recording and perception;
- meeting bots;
- all outbound actions.

## Playbook

1. Detectar e preservar evidence minimizada.
2. Conter através do menor kill switch seguro.
3. Revogar credentials e tokens afetados.
4. Identificar tenants, sessions e actions.
5. Reconciliar tool receipts e provider artifacts.
6. Comunicar conforme contrato e legislação aplicável.
7. Erradicar e corrigir.
8. Validar com replay e tests.
9. Recuperar por canary.
10. Postmortem sem culpa e novo regression test.

## Casos específicos

### Cross-tenant leak
Suspender service identity e queries afetadas, bloquear export, identificar data graph, preservar logs e acionar counsel.

### Tool action indevida
Desativar tool, reconciliar efeito, executar compensação aprovada, informar operador e cliente.

### Replica or voice misuse
Desabilitar deployment e assets, revogar consent evidence link, preservar provenance e investigar acesso.

### Provider media mix-up
Parar provider globalmente, validar session IDs, solicitar deletion e não reativar sem root cause.
