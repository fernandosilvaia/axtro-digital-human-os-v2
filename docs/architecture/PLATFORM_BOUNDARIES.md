# Platform Boundaries

## Bounded contexts

| Contexto | Possui | Não possui |
|---|---|---|
| Identity and Tenancy | tenants, users, roles, service identities | estado da call |
| Agent Configuration | agents, personas, role packs, skill grants | execução realtime |
| Interaction Runtime | sessions, turns, floor, health | billing e aprendizado |
| Action Runtime | contracts, policies, approvals, receipts | decisão comercial livre |
| Knowledge | sources, chunks, retrieval, citations | system prompts |
| Workflow | timers, retries, compensações | media loop |
| Evaluation | datasets, runs, scores, findings | promoção direta |
| Learning | candidates, experiments, promotions | autoedição de produção |
| Billing and Cost | cost events append-only, usage ledger, rate cards, budgets, plans | provider secrets, invoice API, realtime critical path |

## Regra de dependência

Dependências apontam para dentro do domínio, nunca do domínio para SDKs de providers. Adapters implementam ports definidos em `packages/provider-contracts`.

```text
UI -> Application services -> Domain -> Ports
                              ^
Provider adapters ------------|
```

## Tipos de package

- `packages/domain`: entidades, state machines, reducers e invariantes sem I/O.
- `packages/contracts`: schemas e tipos gerados.
- `packages/provider-contracts`: interfaces de STT, TTS, avatar, meeting, LLM e storage.
- `packages/auth`: verificação de identidade, grants explícitos de tenant e contexto transacional.
- `packages/security`: policy evaluation, data classification, referências de segredo, ingress framework-neutral bounded e policy de egress por adapter, sem servidor HTTP, transporte ou rede própria.
- `packages/observability`: correlação W3C interna, nomes de spans, métricas e logs estruturados seguros, sem backend, payload ou transporte próprio.
- `packages/costing`: atribuição determinística de custo, rate cards opacos, agregação por evidência e reconciliação append-only, sem SDK, rede ou chamada a adapter.
- `packages/ui`: componentes sem regra de domínio.

## Regras de import

1. `domain` não importa framework, database ou SDK de provider.
2. `contracts` não importa application code.
3. adapters podem importar SDK e port, não módulos de UI.
4. web não acessa banco diretamente para mutações de domínio.
5. realtime worker não chama o daemon diretamente.
