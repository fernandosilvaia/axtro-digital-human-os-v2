# ADR-025: Bounded, provenance-preserving Context Composer

**Status:** Accepted

**Date:** 2026-07-14

## Context

M1-04 needs to give the textual Fast Lane a small, deterministic context
without turning timelines, RAG results, suggestions, or the Axtro Agent into a
synchronous dependency. The existing state contains structured confirmed facts
but its incremental summary is conversational content, not a policy or a fact.
Existing `agent_suggestion` and `specialist_result` contracts also do not carry
the server-owned `context_version` required to reject late work.

## Decision

- Add `@axtro/context-composer` as a pure synchronous module. It accepts only
  an authorized `session:read` request with `essential_processing`, an opaque
  snapshot captured by the Turn Driver from the projected Session Actor state,
  opaque server-created suggestion snapshots, and an opaque server-created
  approved-knowledge catalog. A raw state object is not a composition input.
  It has no cache, I/O, provider, Axtro Agent, tool, outbox, Actor, media, or
  network dependency.
- Define generated `context_composition` as the closed payload at the Composer
  to Fast Lane boundary. It preserves tenant and session scope for adapter
  enforcement, but its entry content never embeds those identifiers as prompt
  text. A future model adapter must render only the structured content and
  trust labels, never provenance identifiers as instructions.
- Compose only three source classes in M1: structured confirmed state except
  `system_observation`, active approved knowledge, and active
  server-normalized suggestions or hypotheses. The incremental summary is
  optionally included as restricted `untrusted` conversational content. It is
  never promoted to a fact, role, policy, tool grant, or instruction.
- An approved knowledge record is an opaque catalog capability created from
  tenant-scoped, active, versioned, checksummed, role and purpose compatible
  records with an approval receipt. A caller-supplied `approved` boolean never
  establishes authority. Dynamic suggestions and hypotheses are opaque
  snapshots with a server-owned `context_version`, source metadata, evidence,
  confidence, and TTL. Those external sources may carry only public, internal,
  or confidential content. They cannot carry `restricted` context; approved
  knowledge also retains a nonempty approval receipt reference in provenance.
- The Composer derives `context_version` from the authoritative state version.
  Dynamic input with a different version, invalid provenance, disallowed use,
  tenant or session mismatch, future creation, invalid expiry, or
  `expires_at <= now` is excluded or fails closed at its trusted factory.
  RFC3339 timestamps are validated for real calendar dates and offsets before
  TTL comparison.
- UTF-8 byte accounting is exact and bounded. Entries are atomic: content that
  does not fit is omitted with a count rather than truncated. Ordering is
  code-owned and stable: conversational state, confirmed facts, approved
  knowledge, then uncertain dynamic inputs. Untrusted priority never changes
  that precedence.
- The textual Turn Driver composes context after committing and projecting the
  participant turn, while outside its mutation lane and actor mailbox. The
  fake Fast Lane receives the explicit typed composition. The usual generation,
  floor, outbox, and cancellation fences remain unchanged. The submit path
  requires both `session:write` and `session:read` before it can make that
  participant commit. Before Fast Lane sees any composition, the Turn Driver
  reparses it and rejects tenant, version, structural, expiry, future timestamp,
  and provenance lifetime violations against its trusted clock. This protects
  the boundary even when tests inject a malformed or stale Composer.

## Alternatives considered

- Pass a raw prompt string assembled by the Turn Driver.
- Send all timeline transcripts or full documents to Fast Lane.
- Let the Axtro Agent or a RAG query compose context synchronously.
- Trust a source-provided priority or approval flag.
- Add a cache before revocation, tenant, and purpose invalidation keys exist.

## Consequences

The Walking Skeleton gets deterministic bounded context and can prove TTL,
provenance, ordering, byte limits, untrusted-content handling, and tenant
isolation with no database or provider. M2 may add producers for normalized
suggestion snapshots and specialist output. A durable cache or RAG retrieval
requires its own ADR, revocation semantics, and multi-tenant test matrix.

## Revisit trigger

Revisit when M1-06 introduces durable snapshots, M2 introduces Axtro Agent or
Specialist producers, or a selected model adapter needs a rendered context
format.
