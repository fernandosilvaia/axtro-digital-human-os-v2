# Codex Audit Playbook

## Quando usar

- ao fim de cada marco;
- antes de integrar provider real;
- antes de pilotar tenant externo;
- após mudança em auth, RLS, tool runtime, billing ou realtime cancellation.

## Subagentes do projeto

Execute reviews independentes em paralelo, dentro do limite de threads, e aguarde todos antes de corrigir:

1. `architecture_reviewer`: Constituição, boundaries e coupling.
2. `security_reviewer`: tenancy, secrets, injection, scenes e tools.
3. `realtime_reviewer`: races, cancellation, late output e backpressure.
4. `data_reviewer`: contracts, migrations, constraints, RLS e deletion.
5. `test_reviewer`: casos negativos, replay, chaos e flakiness.
6. `cost_reviewer`: atribuição, capacidade, budget e denial of wallet.
7. `docs_researcher`: somente quando uma premissa depende de API ou comportamento externo atual.

Os reviewers são read-only. O agente principal consolida os achados e delega correções bounded a um único `implementation_worker` por write set.

## Checklist crítico

- Existe chamada síncrona do realtime para Axtro Agent?
- Specialist pode publicar áudio ou vídeo?
- `active_presenter_id` pode sofrer race ou dupla posse?
- Late provider output pode escapar após barge-in?
- Tool write tem idempotency, policy e receipt?
- Há anúncio de sucesso antes de receipt?
- Tenant context pode sobreviver no pool, cache, log, vector ou storage?
- RAG, transcript ou provider output pode alterar system instructions?
- Scene pode abrir URL, script ou asset não allowlisted?
- Consent purpose é verificado antes do processamento opcional?
- PII ou secret aparece em logs?
- Budget é enforceado antes do spend?
- Workflow retry duplica efeito?
- Deletion cobre provider copies, cache, object storage e indexes?
- Custo distingue minuto conectado, falado, reservado e especulativo?
- Fallback preserva disclosure, policy e One Mouth Rule?

## Formato de relatório

```markdown
# Audit YYYY-MM-DD
## Executive result
## Critical findings
## High findings
## Medium findings
## Missing tests
## Cost regressions
## Accepted residual risks
## Verification commands and evidence
```

Critical e High bloqueiam promoção. Achado sem evidência precisa ser classificado como hipótese e não como falha confirmada.
