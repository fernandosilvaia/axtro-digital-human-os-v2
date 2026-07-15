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

## Execução congelada na M1-10

```bash
pnpm m1:e2e
```

O harness usa as APIs reais de lifecycle e turnos, a timeline como fonte do
Session Actor, o coordenador real de catálogo, relay composto, workflow em
quatro checkpoints, Cost Ledger, replay verifier e console operacional. Todos
os clocks, IDs, claims e providers são fakes locais determinísticos.

Artefatos versionados:

- `artifacts/m1/timeline.json`: 12 eventos em ordem, somente metadata e
  fingerprints, sem payload ou transcript;
- `artifacts/m1/evidence.json`: hash de replay, action receipt sanitizado,
  custos, workflow, console e matriz de falhas;
- `artifacts/m1/manifest.json`: hashes canônicos dos dois artefatos.

A matriz prova sessão estrangeira indistinguível de ausente, zero leitura
secundária após negação, crash do relay depois do efeito e antes do ACK,
recuperação por lease na tentativa 2 sem duplicação, e receipt `unknown` que
bloqueia retry cego até reconciliação autenticada `not_applied`.

O teste executa o cenário duas vezes no mesmo processo e exige igualdade exata
com os arquivos congelados. Ele não atualiza goldens automaticamente e não usa
rede, credencial real, banco remoto, produção ou deploy.

## Degradação e rollback

- capacidade esgotada na projeção de ações rejeita o novo comando antes da
  execução e preserva receipts anteriores;
- crash do relay mantém o evento em `publishing` até o lease expirar, e a
  retomada usa novo fencing token sem duplicar timeline ou workflow;
- efeito `unknown` não confirma disponibilidade e bloqueia nova execução até
  reconciliação autenticada;
- falha de replay ou integridade torna o console indisponível sem renderizar
  evidência parcial.

Toda a M1-10 é local e não possui migration ou estado remoto. O rollback é a
reversão do commit da tarefa, incluindo harness, goldens, comando e capability
de leitura. Nenhum dado de produção requer compensação.

## Não incluir

Audio, avatar, meeting bot, CRM real, email real ou pagamentos. Fakes não são dívida quando seguem o contrato definitivo.
