# ADR-013: Application UUIDv7 and provider-agnostic vector dimensions

**Status:** Accepted  
**Date:** 2026-07-14

## Context

V1 claimed UUIDv7 but generated v4. It also fixed vector(1536) while claiming provider independence.

## Decision

Generate UUIDv7 in application code and validate at boundaries. Store vector without a fixed dimension in the first reference model, with embedding_model and embedding_dimensions. Add dimension-specific ANN storage or index only after model choice.

## Alternatives considered

Database v4 defaults; fixed vector dimension now.

## Consequences

Consistent sortable IDs and flexible embeddings. Generic vectors may limit ANN indexing until a deliberate migration.

## Revisit trigger

Measured retrieval scale and chosen model justify a dimension-specific table or partition with an expand-contract migration.
