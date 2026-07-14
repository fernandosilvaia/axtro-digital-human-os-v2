# ADR-013 — Retenção e eliminação: defaults conservadores, expurgo real, região SP
**Status:** Aceito · 2026-07-13
**Contexto:** Gravações de voz são dado pessoal sensível na prática; LGPD exige eliminação efetiva; tenants têm necessidades distintas (coaching vs compliance).
**Decisão:** Defaults configuráveis por tenant: áudio 90d, transcript 24m, logs 12m, auditoria 5a; job diário de expurgo com tombstone auditável; eliminação de titular propaga a embeddings (delete de chunks derivados) e agenda remoção em backups no ciclo; dados em repouso na região São Paulo; suboperadores internacionais listados por tenant (transparência).
**Alternativas rejeitadas:** Reter tudo indefinidamente (passivo jurídico); não derivar embeddings de PII (inviável — memória de lead precisa); eliminação só lógica (não cumpre LGPD).
**Consequências:** + posição de compliance vendável; risco reduzido. − pipelines de expurgo têm que ser testados (suite própria) e complicam backups (documentado em runbook).
