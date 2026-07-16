# M3-10: gate do piloto interno Sales Closer Alpha

**Estado:** ferramenta de gate pronta e testada; **piloto real não executado**

**Data:** 2026-07-15
**Branch:** `codex/m0-m1-foundation`

## O que esta evidência prova, e o que ela não prova

`generatePilotGateReport` (`packages/evaluation/src/pilot-gate.ts`) agrega
chamadas internas já revisadas — usando o `ScenarioEvaluationResult` de
M3-08 e custo estimado/reportado pelo provider — num relatório único: total
de chamadas revisadas, violações críticas de policy ainda abertas,
violações de tenancy ainda abertas, custo e qualidade por canal, e uma
decisão fechada em três valores (`ready_for_human_review`,
`blocked_open_critical_violation`, `blocked_insufficient_sample`). O campo
`requiresHumanApprovalForCustomerBeta` é sempre `true` — nenhuma execução
desta ferramenta jamais produz uma aprovação de beta.

`artifacts/m3/evidence.json` roda essa ferramenta contra **20 registros de
chamada sintéticos e determinísticos**, marcados explicitamente
`data_provenance: "FAKE_SYNTHETIC_DATA_NOT_A_REAL_INTERNAL_PILOT"`. Isso
prova que a ferramenta funciona de ponta a ponta — não prova, e não tenta
fingir provar, que o piloto interno de verdade aconteceu.

## O que esta sessão explicitamente não fez, e por quê

Os critérios de aceite de M3-10 (`backlog/MVP_TASK_GRAPH.yaml`) exigem:

- **"at least 20 internal calls are reviewed"** — chamadas internas REAIS,
  não simuladas;
- **"provider cost and quality are measured by channel"** — custo REAL de
  provider, o que exige o bake-off credenciado que M2-13 deixou
  explicitamente `blocked` (D-V2-048) e que `docs/playbooks/HANDOFF_TO_CODEX.md`
  reserva para decisão humana ("usar credenciais reais");
- **"customer beta requires a separate approval"** — uma aprovação de
  negócio que, por definição, não pode ser tomada por este agente.

`docs/playbooks/HANDOFF_TO_CODEX.md` classifica M3 assim: **"Sales Closer
Alpha interno. Não declarar pronto para cliente sem auditoria, provider
bake-off, segurança, privacidade e aprovação de lançamento."** D-V2-049
(registrado no início de M3 desta sessão) já havia deixado isso explícito:
o bake-off credenciado e o piloto real de 20 chamadas ficam fora do escopo
autônomo desta sessão.

## Pipeline executado

| Comando | Resultado |
|---|---|
| `pnpm lint` | passou |
| `pnpm contracts:check` | passou |
| `pnpm typecheck` | passou |
| `pnpm test` | passou (inclui os 8 testes de `tests/golden/pilot-gate.test.mjs`) |

## Condição de desbloqueio

Para de fato fechar M3-10, uma sessão humana precisa:

1. Rodar o bake-off credenciado de provider (`PROVIDER_BENCHMARK_PROTOCOL.md`, gate humano, créditos/cobrança real);
2. Conduzir 20+ chamadas internas reais em `tenant-zero` com um agente configurado de verdade;
3. Alimentar essas chamadas reais em `generatePilotGateReport` (a ferramenta já está pronta para isso);
4. Revisar o relatório resultante e, separadamente, decidir sobre aprovação de beta com cliente — nunca automatizada por esta ferramenta.

## Decisão desta sessão

A ferramenta de M3-10 está implementada, testada e pronta para uso real.
**Nenhuma decisão de piloto, beta ou lançamento é registrada aqui.** M3-01 a
M3-09 permanecem fake-first/dry-run e prontos; M3-10 fica formalmente aberto
até que uma sessão com gate humano execute o piloto real.
