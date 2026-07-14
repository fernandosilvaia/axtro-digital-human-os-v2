# Data Model

## Design goals
- strong tenancy boundaries;
- explicit relational fields for security and state;
- PII separation;
- append-only timeline and receipts;
- safe deletion graph;
- provider-agnostic references.

## Identity strategy

Domain IDs are UUIDv7 generated in application code. Database columns have no `gen_random_uuid()` default for these IDs. Tests reject non-v7 IDs at application boundary.

## Entity groups

### Global catalogs
`provider_catalog`, `schema_registry`, `region_policy_catalog`. No tenant data, restricted writes.

### Tenant configuration
`tenants`, `tenant_settings`, `service_identities`, `agents`, `agent_deployments`, `role_pack_installations`, `skill_grants`, `provider_connections`.

### Contacts and PII
`contact_profiles` stores encrypted sensitive fields. Domain tables reference profile ID and retain only minimized operational attributes.

### Interaction
`sessions`, `session_state_snapshots`, `session_timeline`, `conversation_turns`, `session_participants`, `consent_evidence`, `disclosure_records`, `session_health`.

### Actions
`action_intents`, `policy_decisions`, `tool_executions`, `tool_receipts`, `human_approvals`, `handoffs`.

### Knowledge
`knowledge_sources`, `knowledge_versions`, `knowledge_chunks`, `knowledge_embeddings`.

### Governance and economics
`audit_log`, `events_outbox`, `cost_events`, `usage_ledger`, `evaluation_runs`, `experiment_candidates`, `deployment_promotions`.

## PII and encryption

Use application-level envelope encryption for high-sensitivity columns with KMS-managed keys. Searchable normalized fields are minimized and hashed only where valid. Do not store secrets in provider connection rows; store secret references.

## Embeddings

M1 uses `vector` without fixed dimension, plus `embedding_model` and `embedding_dimensions`. Exact search is acceptable for small seed data. ANN index is added only after model selection and dimension-specific strategy.

## Referential tenancy

Composite uniqueness and triggers or composite FKs prevent referencing a row from another tenant. RLS alone is not enough for write integrity.

## Migrations

Use expand-contract:
1. add nullable/new structures;
2. dual write or backfill;
3. verify;
4. switch reads;
5. enforce constraints;
6. remove old field in later release.

Reference SQL is in `database/reference-schema.sql`.
