# ADR-001 — Monorepo com Turborepo (pnpm + uv)
**Status:** Aceito · 2026-07-13
**Contexto:** 5 apps + pacotes compartilhados (schemas, domínio, evals), 2 linguagens (TS para web/API, Python para realtime/IA), 1 desenvolvedor + Claude Code. Contratos precisam evoluir em lockstep.
**Decisão:** Monorepo Turborepo com pnpm workspaces (TS) e uv (Python) no mesmo repo; `packages/domain/schemas` como fonte única com codegen para os dois lados; cache remoto do Turborepo no CI.
**Alternativas rejeitadas:** Polyrepo (drift de contrato, overhead de release para 1 pessoa); Nx (mais pesado, sem ganho aqui); Bazel (overengineering).
**Consequências:** + refactors atômicos cross-stack, PRs coerentes, um CI. − pipeline precisa de filtros (`--filter`) para não rebuildar tudo; disciplina de fronteiras entre packages (lint rule de imports).
