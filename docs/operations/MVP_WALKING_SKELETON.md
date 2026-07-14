# M1 Walking Skeleton

## Objetivo

Provar que contratos, tenancy, state, events, actions e workflows formam um sistema coerente antes de integrar voz.

## Demo script

1. Admin cria tenant `tenant-alpha`.
2. Seed instala `sales-closer@0.1.0` e skill read-only.
3. Usuário cria sessão no API.
4. Realtime fake assume Session Actor.
5. Test driver envia três turnos textuais.
6. Fast Lane fake retorna resposta determinística e state patch.
7. Uma consulta de catálogo vira ActionIntent, PolicyDecision e receipt.
8. Timeline é exibida no console.
9. Session completed cria outbox event.
10. Workflow fake gera resumo e evaluation.
11. Replay reconstrói state e compara hash.

## Acceptance evidence

- E2E test command and output;
- screenshot ou JSON da timeline;
- cross-tenant denial;
- outbox relay retry;
- action idempotency;
- state replay hash;
- cost ledger sum;
- failure injection.

## Não incluir

Audio, avatar, meeting bot, CRM real, email real ou pagamentos. Fakes não são dívida quando seguem o contrato definitivo.
