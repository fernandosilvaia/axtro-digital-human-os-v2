# CONTRIBUTING.md

## Branches e commits
`main` protegida (CI verde + 1 aprovação — pode ser o audit bot). Branches: `feat/b1-4-sales-engine`, `fix/...`, `chore/...`. Commits: Conventional Commits (`feat(sales-engine): extrator SILVA por turno`); escopo = workspace. Squash-merge; título do PR vira mensagem.

## PRs
Template obrigatório: objetivo (link do bloco do plano) · o que mudou · como testar · budget de latência (se realtime) · docs atualizados (links) · riscos. Diff produtivo alvo ≤400 linhas. PR que toca schema exige bump de versão + nota de migração de payload.

## Migrações de banco
`supabase migration new <nome>`; SQL idempotente quando possível; toda migração acompanha: política RLS da tabela nova + teste de isolamento + plano de rollback comentado no topo do arquivo. Proibido `DROP` destrutivo sem migração de duas fases (expand→migrate→contract).

## Rollback
Deploys imutáveis (Fly release/Vercel). Rollback = repromover release anterior (comando documentado em runbook) + reverter migração contract se houver. Feature novas nascem atrás de flag desligada ⇒ rollback lógico sem deploy.

## Estilo
TS: ESLint config do repo, imports absolutos `@axtro/*`. Py: ruff format + mypy strict. Proibido comentário morto/código comentado em PR. Nomes de domínio em inglês no código, textos de UI/voz em PT-BR via arquivos de conteúdo (`packages/domain/content/pt-BR/`).

## Testes
Ver TEST_STRATEGY.md. Regra prática: bug corrigido = teste que o reproduz incluído.

## Dependências
Adicionar dependência exige justificativa de 1 linha no PR; preferir stdlib/já-existente; auditoria `pnpm audit`/`uv pip audit` no CI.
