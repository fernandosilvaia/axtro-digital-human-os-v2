# DEFINITION_OF_DONE.md

Um bloco do IMPLEMENTATION_PLAN só está DONE quando TODOS os itens abaixo forem verdade (verificável, não opinião):

1. **Critério de aceite do bloco** passa por comando reproduzível (teste, script ou eval) citado no PR.
2. **CI verde completo** no merge (lint, types, unit, contract, integration/RLS, harness/evals conforme área tocada).
3. **Docs normativos atualizados** no mesmo PR (ou explicitamente "sem impacto em docs").
4. **Observabilidade:** logs com chaves de correlação; métricas/spans novos nomeados conforme OBSERVABILITY; aparecem no dashboard de staging.
5. **Segurança:** sem segredo em código/log; RLS+teste se houver tabela; tool nova tem contrato+auditoria; checklist de PII ok.
6. **Custo:** se adiciona chamada a provider, custo estimado por unidade anotado no PR e refletido em UNIT_ECONOMICS se material (>2% do custo/min).
7. **Rollback:** flag desligável ou plano de rollback descrito.
8. **PROGRESS.md** atualizado (feito/em andamento/próximos).
9. **Auditoria:** se PR crítico (labels), relatório do revisor anexado sem achados críticos abertos.
10. **Demo-able:** existe forma de demonstrar em staging (URL, comando ou gravação) linkada no PR.
