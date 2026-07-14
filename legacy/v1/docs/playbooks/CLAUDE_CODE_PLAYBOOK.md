# CLAUDE_CODE_PLAYBOOK.md — como o Claude Code deve trabalhar neste projeto

> Público: a instância de Claude Code que implementará o sistema. Leia HANDOFF_TO_CLAUDE_CODE.md primeiro; este playbook é o "como", aquele é o "o quê".

## 1. Loop de trabalho por tarefa
1. Ler o bloco correspondente em IMPLEMENTATION_PLAN.md e os docs referenciados (só os referenciados — não releia o repo inteiro a cada tarefa).
2. Escrever primeiro o teste/eval que prova o critério de aceite; vê-lo falhar.
3. Implementar o mínimo que passa; rodar suíte local do workspace afetado (`turbo run test --filter=...` / `uv run pytest apps/realtime-worker`).
4. Atualizar docs se o comportamento normativo mudou (mesmo PR). Doc desatualizado = bug.
5. Commit convencional pequeno; PR com descrição preenchendo o template; auto-review antes de pedir merge.

## 2. Regras inegociáveis (não reinterpretar)
- JSON Schemas em `packages/domain/schemas` são a fonte; tipos são gerados, nunca editados à mão.
- Nenhuma tabela sem RLS; nenhuma query sem tenant context; teste de isolamento acompanha toda tabela nova.
- Nada de limite comercial/preço/permissão em prompt — sempre política/dado server-side.
- Latência: qualquer código no caminho realtime precisa de justificativa de budget no PR (comentário `// budget:`).
- Segredos só via Doppler; se um segredo aparecer em diff, aborte e limpe histórico.
- Axtro Agent nunca ganha chamada síncrona no caminho da conversa. Se parecer necessário, é design errado — pare e registre em DECISIONS_LOG a alternativa.

## 3. Quando estiver em dúvida
Ordem de resolução: (1) doc normativo citado no plano; (2) ADR relacionado; (3) DECISIONS_LOG; (4) decidir você mesmo o menor escopo reversível, registrar em DECISIONS_LOG com prefixo `D-CC-nn` e seguir. Não pare para perguntar em decisões reversíveis; pare apenas em: apagar dados, gastar dinheiro novo (contratar provider/plano), tocar em COMPLIANCE mínimos, ou expor endpoint público novo sem auth.

## 4. Gestão de contexto (para você, Claude Code)
- Mantenha um `PROGRESS.md` na raiz do repo de código: o que foi feito (bloco, PR, data), o que está em andamento, próximos 3 passos, dívidas anotadas. Atualize a cada sessão — é seu ponto de retomada.
- Ao retomar sessão: leia PROGRESS.md + o bloco atual do plano; nada mais por padrão.
- Tarefas grandes: quebre em PRs ≤ ~400 linhas de diff produtivo.

## 5. Padrões de código (resumo; detalhes em CONTRIBUTING)
TS strict, sem `any` não justificado; Py 3.12 typing completo, mypy limpo; erros como tipos/Result nos fluxos previsíveis, exceptions só para o inesperado; logs estruturados com as 6 chaves de correlação; feature flags via tabela `flags` (tenant-scoped) — nada de env var para flag de produto.

## 6. Interação com providers em dev
Fake providers por default (harness); reais só sob flag `USE_REAL_PROVIDERS=1` e em staging. Nunca gravar amostras de áudio de teste com voz de pessoa real no repo.
