# ADR-031: Tenant-scoped knowledge retrieval as a pure port over an in-memory store

**Status:** Accepted

**Date:** 2026-07-15

## Context

ADR-025 explicitly deferred RAG: "A durable cache or RAG retrieval requires
its own ADR, revocation semantics, and multi-tenant test matrix." M3-02 now
needs authorized knowledge ingestion and retrieval. `database/migrations/0004_knowledge_governance.sql`
already defines the durable shape from M0 (`knowledge_sources`,
`knowledge_versions`, `knowledge_chunks`, `knowledge_embeddings`, each
tenant-scoped with `valid_from`/`valid_to`, `status`, `data_classification`),
but no application package has ever queried it — every M0/M1/M2 package that
touches persistence uses a repository interface backed by a process-local
fake, with the real schema proven separately by `scripts/database-integration.mjs`
and `scripts/rls-integration.mjs` (ADR-020: "nenhum ORM ou client foi
escolhido"). M3 stays fake-first per its own task-graph acceptance criteria
(D-V2-049); a real embedding provider is not chosen and no `pg` client exists
in any application package today.

## Decision

- `@axtro/knowledge-engine` is a pure, synchronous, tenant-scoped port over a
  local in-memory store whose record shapes mirror the four
  `knowledge_governance` tables column-for-column. It has no network, cache,
  provider, or Axtro Agent dependency, matching the Context Composer's
  boundary discipline from ADR-025.
- Retrieval order is fixed and fail-closed at each stage, never post-filtered:
  1. filter by tenant, allowed role/skill, product/locale tag, and validity
     (`status = active`, `valid_from <= now < valid_to`) — a caller can never
     see a chunk that fails this stage, regardless of relevance score;
  2. lexical + vector candidate retrieval — both deterministic and local in
     M3 (no real embedding provider; a fake cosine-style score derived from a
     seeded hash of the query and chunk text, never `Math.random`);
  3. deterministic rerank by combined score;
  4. an injectable policy filter hook (consent/purpose, mirrors the Scene
     Director and Perception Bus pattern from M2);
  5. a UTF-8-byte-bounded context budget, same exact accounting and atomic
     inclusion/omission discipline as `@axtro/context-composer`;
  6. every returned chunk carries a citation locator and is wrapped
     `trusted: false` — retrieved content is always data, never promoted to
     an instruction, exactly like Constitution Art. 15 and the Context
     Composer's untrusted-content rule.
- Revocation is immediate and structural, not cached: every query re-evaluates
  `status`/`valid_from`/`valid_to` against the caller-supplied clock at call
  time. Disabling a source, expiring a version, or superseding a version with
  a new one takes effect on the very next query with no invalidation step to
  forget.
- `apps/ingestion-worker` is a thin process-local pipeline (register source →
  fake malware/size scan → extract → classify → chunk → fake embed → publish
  version) that only ever writes through the knowledge-engine port — it never
  bypasses the same validity/classification rules retrieval enforces.
- Prompt-injection defense is structural, not content-filtering: this package
  never concatenates retrieved text into anything a downstream consumer could
  mistake for an instruction. A chunk's text is returned as a labeled,
  untrusted field on a typed result object. The adversarial corpus test
  proves injected imperative text inside chunk content changes nothing about
  filtering, ranking, or citation behavior — it is inert data the retrieval
  pipeline never interprets.

## Alternatives considered

- Wire directly to PostgreSQL/pgvector now. Rejected: no `pg` client is
  chosen anywhere in the codebase yet (ADR-020); would require a client
  decision mid-task, out of scope for M3-02 alone.
- Use a real embedding provider for vector retrieval. Rejected: M3-01–M3-09
  stay fake-first (D-V2-049); a real embedding provider is part of the
  deferred credentialed bake-off (D-V2-048).
- Sanitize/strip suspicious phrases from ingested content as the injection
  defense. Rejected: pattern-based content filtering is unreliable and gives
  false confidence; the actual guarantee is structural (content never
  becomes an instruction anywhere downstream).
- Skip citations to simplify the first slice. Rejected: violates the
  "citations obrigatórias em claims verificáveis internas" retrieval rule and
  Art. 7/Art. 15 grounding requirements.

## Consequences

M3-02 proves tenant/role/validity filtering, revocation, untrusted-content
handling, and citation-backed retrieval with zero real vector database or
embedding provider. A real PostgreSQL+pgvector-backed adapter implementing
the same `KnowledgeRetrievalPort` is deferred until a `pg` client and an
embedding provider are both selected through their own ADR/bake-off — this
package's port boundary is designed so that swap requires no change to any
caller (Context Composer, Role Pack, or console).

## Revisit trigger

Revisit when a real embedding provider is credentialed and benchmarked
(ties to the M2-13 provider gate), when a durable PostgreSQL-backed adapter
is built, or when cross-session knowledge caching is needed.
