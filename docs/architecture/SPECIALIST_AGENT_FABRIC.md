# Specialist Agent Fabric

## Catálogo inicial

- Product Specialist: factualidade de produto.
- Pricing Specialist: catálogo, elegibilidade e limites.
- Compliance Specialist: disclosure, claims e restrições setoriais.
- Research Specialist: somente fontes permitidas, normalmente pré-call.
- Proposal Specialist: estrutura proposta em dry-run.
- Tool Planner: transforma objetivo em intents, sem executar.
- Fact Checker: verifica afirmação candidata contra sources.

## Contrato

`specialist_request` contém:
- tenant e session;
- specialist type;
- question ou task estruturada;
- allowed sources;
- context version;
- deadline;
- data classification;
- response schema.

`specialist_result` contém:
- status;
- answer estruturado;
- sources;
- confidence;
- assumptions;
- prohibited claims;
- expiry;
- context version.

## Segurança

- especialista herda somente os mínimos dados necessários;
- credentials continuam no Tool Runtime;
- resultado é untrusted data;
- specialists não podem modificar prompt de sistema;
- research externo não acontece no caminho crítico sem opt-in e budget.

## Operação

Use fila bounded e bulkheads por specialist. Um especialista lento não consome todos os workers. Cache é permitido por tenant, source version e data classification.

## Métricas

- request rate;
- hit rate e reuse;
- latency p50/p95;
- timeout;
- stale discard;
- source coverage;
- judge agreement;
- custo por resultado utilizado.
