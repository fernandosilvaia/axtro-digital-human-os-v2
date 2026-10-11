# Base de conhecimento da Priscila (closer de Life Insurance)

Pacote versionado de fontes para o RAG do tenant que opera a closer de seguro de vida. Complementa a biblioteca de referência que já existe fora deste repositório (`02_PRODUTOS/lab/hermes-agent-sandbox/client-skills/huebner/life-insurance-expertise/references`), cobrindo o que ela não tinha: financiamento de prêmio (Kai-Zen), anuidades com revisão de melhor interesse, substituição e troca 1035, uso empresarial e sucessório, living benefits, o caminho de subscrição e um glossário trilíngue.

## Como o pacote é usado

- O núcleo que precisa estar sempre no prompt (compliance, bússola de produto, momentos sensíveis) vive em `apps/portal/src/lib/brain/life-insurance.ts`. Estes arquivos são o detalhe que a busca híbrida traz quando a conversa pede.
- O prefixo numérico é a prioridade: `scripts/ingest-knowledge-bulk.mjs` cria as fontes em ordem decrescente de nome, e o digest da conversa favorece a criada por último, então `01` fica no topo.
- Conteúdo em inglês porque é a língua dos produtos e das seguradoras; o glossário liga os termos ao espanhol e ao português, e a recuperação vetorial cruza idiomas.

## Ingestão (ação de operador, com gate humano)

Rodar sempre primeiro em dry-run, com as variáveis do tenant injetadas pelo Railway:

```bash
railway run -- node scripts/ingest-knowledge-bulk.mjs knowledge/life-insurance/priscila --dry-run
```

Depois de revisar a saída, repetir com `--apply`. O script autentica como a conta de máquina do tenant e paga embeddings sem reserva de orçamento (limitação já registrada na própria nota do script).

## Garantias automáticas

`tests/portal/life-insurance-knowledge-pack.test.mjs` prova que cada arquivo cabe no envelope de uma ingestão paga, que não há travessão e que nenhuma frase do pacote dispara a sentinela de compliance (fora da lista explícita de palavras proibidas do glossário).

## O que este pacote não é

Não é aconselhamento jurídico, tributário nem de investimento, e não substitui os documentos oficiais das seguradoras e dos programas (por exemplo, os materiais do Kai-Zen). Regras, idades, valores e prazos mudam por seguradora e estado; o texto usa linguagem de ordem de grandeza de propósito.
