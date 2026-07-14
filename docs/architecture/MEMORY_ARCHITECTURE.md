# Memory Architecture

## Stores lógicos

1. Session working memory: efêmera, actor/Redis.
2. Session timeline: append-only e auditável.
3. Contact memory: fatos permitidos e provenance.
4. Opportunity or case memory: estado do processo.
5. Tenant knowledge: RAG versionado.
6. Role and agent memory: configurações e deployment versions.
7. Operational learning: métricas e experiment evidence.

## Leitura

Context Composer aplica purpose, role, tenant, classification e recency. Memória não é despejada inteira no prompt.

## Escrita

- fatos explícitos ou tool-verified podem ser persistidos;
- hipóteses ficam em store temporário com TTL;
- pós-call consolida através de workflow e policy;
- modelo não escolhe retenção.

## Exclusão

Deletion graph cobre source, chunks, embeddings, session assets, contact facts e provider copies. Audit tombstone não mantém conteúdo apagado.

## Cross-tenant

Nenhuma chave de cache sem tenant prefix. Embedding query exige tenant predicate antes de ranking. Testes alternam tenants na mesma connection pool.
