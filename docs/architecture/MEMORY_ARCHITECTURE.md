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

Em M1, a composição é local e estruturada: fatos confirmados, conhecimento
aprovado e sugestões ou hipóteses ainda válidas carregam provenance e rótulo de
confiança. Resumo incremental e conteúdo de conhecimento são dados não
confiáveis, não instruções. Transcript não entra na composição M1. O pacote é
limitado por bytes UTF-8 e não usa cache até existir invalidação por tenant,
propósito, versão e revogação.

Conhecimento aprovado, sugestões e hipóteses só podem transportar classificação
public, internal ou confidential. `restricted` permanece limitado ao estado
confirmado local. O conhecimento aprovado conserva uma referência de receipt
na provenance para que a entrada não possa aparentar aprovação sem evidência.

O Turn Driver só entrega ao Composer um snapshot opaco capturado após a
projeção do Session Actor. Um objeto de estado bruto não é aceito na fronteira.
`system_observation` fica fora de M1 porque o estado atual não carrega a prova
de finalidade e consentimento exigida para percepção. Datas de TTL passam por
validação calendária RFC3339 antes de ordenar ou expirar itens.
Antes de entregar o payload ao Fast Lane, o Turn Driver revalida freshness
contra o seu clock confiável e descarta qualquer composição injetada, expirada
ou futura.

## Escrita

- fatos explícitos ou tool-verified podem ser persistidos;
- hipóteses ficam em store temporário com TTL;
- pós-call consolida através de workflow e policy;
- modelo não escolhe retenção.

## Exclusão

Deletion graph cobre source, chunks, embeddings, session assets, contact facts e provider copies. Audit tombstone não mantém conteúdo apagado.

## Cross-tenant

Nenhuma chave de cache sem tenant prefix. Embedding query exige tenant predicate antes de ranking. Testes alternam tenants na mesma connection pool.
