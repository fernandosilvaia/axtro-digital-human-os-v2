# Avaliação de conversa e de busca da Priscila

O banco de cenários (`experiments/priscila-eval/`) mede um turno por vez, com critérios determinísticos. Esta pasta mede o que ele não alcança:

- **Conversa inteira, com DeepEval.** Mede se a Priscila segue o papel, se lembra o que a pessoa já disse e se chega ao desfecho certo. Também dá nota a dois critérios próprios: conduta regulada e naturalidade falada.
- **Busca da base, com Ragas.** Mede se a busca híbrida da 0074 traz o trecho certo da base da Priscila para cada pergunta.

Tudo roda sem gastar nada até alguém confirmar o gasto, e nenhuma pessoa real aparece nos dados.

## Peças

| Arquivo | O que é |
|---|---|
| `conversations.mjs` | 6 conversas de vários turnos em inglês, espanhol e português: final expense, pressão de IUL, conta de cobertura com a calculadora, confusão com Medicare, pedido para parar no meio e agendamento com tools. |
| `rag-questions.mjs` | 8 perguntas, cada uma apontando a seção da base que deveria voltar, com uma resposta de referência. |
| `collect.mjs` | Toca as conversas pelo mesmo `runBrainChatCompletion` da produção, com o laço de tool igual ao da Tavus, e monta as linhas do Ragas. |
| `evaluate.py` | Valida, gera o relatório sem juiz e, com confirmação, roda DeepEval e Ragas. |
| `requirements.txt` | Versões fixadas das três bibliotecas. Instalar num ambiente separado. |

## Passo a passo

```bash
node experiments/conversation-eval/collect.mjs conversations
```

Sem confirmação, o coletor roda em **ensaio**: um gerador determinístico exercita toda a fiação, inclusive a calculadora e a agenda. Ensaio nunca vira nota.

```bash
node experiments/conversation-eval/collect.mjs rag
```

Sem stack local, o coletor só monta as referências. Com uma stack local que tenha a base da Priscila ingerida, a busca é de verdade. `EVAL_SUPABASE_URL` só aceita endereço de loopback, então produção nunca entra. Sem chave do OpenRouter a busca é lexical, o mesmo caminho degradado da produção. As variáveis são `EVAL_SUPABASE_URL`, `EVAL_SUPABASE_SERVICE_ROLE_KEY`, `EVAL_TENANT_ID` e `EVAL_AGENT_ID`.

```bash
python3 experiments/conversation-eval/evaluate.py conversations
python3 experiments/conversation-eval/evaluate.py rag
```

As métricas do Ragas sem LLM (precisão e recall de contexto por similaridade de texto) são grátis e rodam sempre que houver `retrieved_contexts`.

## Gastos (gate do Fernando)

| Etapa | Variáveis | Gasto |
|---|---|---|
| Respostas reais da Priscila | `CONVERSATION_EVAL_LIVE_CONFIRM=spend-openrouter-credit`, `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` | uma geração por turno: cerca de 30 chamadas nas 6 conversas, mais 8 no RAG |
| Juiz LLM (DeepEval e Ragas com LLM) | `CONVERSATION_EVAL_JUDGE_CONFIRM=spend-judge-credit`, `OPENROUTER_API_KEY`, `CONVERSATION_EVAL_JUDGE_MODEL` | várias chamadas por métrica e por conversa; usar um modelo diferente do avaliado |

O juiz usa o OpenRouter, então não precisa de chave da OpenAI. A telemetria anônima do DeepEval e do Ragas é desligada pelo próprio `evaluate.py`. Os resultados ficam em `out/`, que o git ignora (o repositório é público).

## O que ainda exige gente

- Ingerir a base da Priscila na stack local, ou num tenant de avaliação, antes de medir a busca.
- Autorizar o gasto das etapas acima.
- Ouvir as respostas gravadas: naturalidade de voz e presença continuam sendo julgamento humano. A nota do juiz é triagem, não veredito.
