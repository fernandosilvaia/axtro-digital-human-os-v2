# Knowledge and Grounding

## Pipeline

Source registration → malware scan → extraction → classification → chunking → embedding → lexical index → version publish.

## Fonte e validade

Todo chunk possui:
- tenant;
- source ID and version;
- role/skill visibility;
- effective and expiry dates;
- data classification;
- locale;
- authority level;
- citation locator.

## Retrieval

1. filter por tenant, role, product, locale e validity;
2. lexical + vector candidate retrieval;
3. rerank;
4. policy filter;
5. context budget;
6. citations obrigatórias em claims verificáveis internas.

## Segurança

Conteúdo é untrusted. Instruções contidas em documentos são ignoradas como comandos. Sanitizar HTML, bloquear URLs não permitidas e limitar arquivo/tamanho.

## Embeddings

Walking skeleton usa coluna `vector` sem dimensão e registra model ID/dimensions. Não criar ANN até provider e dimensão serem escolhidos. Posteriormente, particionar ou criar índice por modelo/dimensão.

## Método Silva

Os manuais não estavam no ZIP desta auditoria. Criar ingestion manifest com hash e licença antes de indexar. Conteúdo comercial vira Sales Closer Role Pack, não system prompt global.
