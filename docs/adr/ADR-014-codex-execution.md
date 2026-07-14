# ADR-014: Codex-first implementation with repository-native gates

**Status:** Accepted  
**Date:** 2026-07-14

## Context

Claude credits are unavailable and the implementation must start with Codex without relying on a giant prompt alone.

## Decision

Use hierarchical AGENTS.md, bounded skills, a dependency task graph, worktrees for parallel lanes and workspace-write approval mode. Every task produces tests and evidence. Architecture validators run before code work.

## Alternatives considered

One unrestricted autonomous prompt; manual implementation only.

## Consequences

Codex can start immediately with explicit limits, while dangerous permissions and simultaneous shared-file editing remain prohibited.

## Revisit trigger

Instructions evolve when repository structure changes, but safety and evidence requirements remain.
