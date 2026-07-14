# Contributing

## Branches e commits
- `feat/<task-id>-slug`, `fix/<task-id>-slug`, `chore/<task-id>-slug`.
- Conventional Commits.
- Um task graph item por PR sempre que possível.

## Contract-first

Mudança de payload começa no schema. Atualize exemplos, tipos gerados, producers, consumers e tests no mesmo PR.

## Migrations

Nunca editar migration aplicada. Use expand-contract, transaction quando possível e rollback/forward fix documentado.

## Code quality

- type safety;
- no implicit tenant context;
- explicit timeouts;
- cancellation propagated;
- structured errors;
- no catch-and-ignore;
- dependency rationale no PR;
- observability for new critical path.

## Docs

Comportamento público ou arquitetura alterada exige doc/ADR. Rode docs QA antes de merge.
