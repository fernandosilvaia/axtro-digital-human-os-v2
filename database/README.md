# Database Reference

The numbered migrations define the M0 reference model. They intentionally favor clear invariants over premature performance optimization.

Key properties:

- application-generated UUIDv7;
- composite tenant foreign keys;
- forced RLS for tenant data;
- global catalogs kept separate;
- PII isolated and encrypted by the application;
- append-only evidence and receipts;
- outbox in the same database transaction;
- provider-agnostic vector dimensions.

The Codex implementation must add runnable database tests before changing this model.
