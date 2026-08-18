# Roadmap de inovação validável

## Critério

Uma inovação só avança se preservar disclosure, consentimento, tenant, One Mouth, receipts e controle humano. Nenhuma hipótese abaixo autoriza biometria oculta, inferência de atributos protegidos, execução de ferramenta por texto de modelo ou ativação de provider sem canário.

## Oportunidades priorizadas

| Iniciativa | Hipótese de valor | Primeiro experimento seguro | Flag / métrica de decisão | Dependências e risco |
| --- | --- | --- | --- | --- |
| Briefing de demonstração orientado a objetivo | Visitante que declara objetivo entende valor antes de criar conta. | Formulário opcional, sem PII, que seleciona roteiro estático e mostra disclosure. | `PUBLIC_DEMO_BRIEFING_V1`; início/conclusão da demo e criação de conta. | UX research; não usar modelo nem CRM no MVP. |
| Cockpit de confiança operacional | Operador decide rollout mais rápido vendo grant, reservation, receipt e kill switch no mesmo read model. | Página interna read-only com IDs pseudonimizados e estado agregado. | `OPS_RUNTIME_TRUST_COCKPIT_V1`; tempo para detectar/pausar incidente. | Depende do contrato v44 e RLS/revisão PII. |
| Quality replay para coaching humano | Revisar sessões por evidência reduz retrabalho sem julgamento automático de pessoas. | Fila de revisão com timeline redigida e avaliação humana. | `HUMAN_REVIEW_QUEUE_V1`; cobertura e acordo entre revisores. | Depende do P0 realtime e política de retenção. |
| Planejamento de capacidade | Mostrar orçamento/custo provável reduz surpresa de cobrança. | Simulador local com rate cards e cenários sem cliente. | `CONVERSATION_CAPACITY_PLANNER_V1`; variação estimado × medido. | Não substitui reservation/ledger real. |

## Decisão desta onda

Nenhuma inovação nova foi habilitada nesta tarefa. A evidência favoreceu corrigir integridade, verdade de copy, descoberta e testes antes de adicionar nova superfície. A primeira candidata de baixo risco é o **Briefing de demonstração orientado a objetivo**, porque pode ser estática, opcional, feature-flagged e não requer provider, dado pessoal ou decisão do modelo.

## Ordem proposta

1. Resolver P0 de media boundary e aplicar/canarizar v44.
2. Criar contrato e métrica de referência da demonstração pública.
3. Rodar `PUBLIC_DEMO_BRIEFING_V1` com roteiro estático e rollback instantâneo.
4. Só então considerar recomendações geradas por IA, após finalidade de dados, revisão humana e avaliação de qualidade aprovadas.
