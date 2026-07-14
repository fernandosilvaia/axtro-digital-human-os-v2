-- Reference only. Apply numbered migrations in order through the chosen migration runner.
-- This file intentionally documents the sequence instead of duplicating definitions.
\i migrations/0001_extensions_and_domains.sql
\i migrations/0002_control_plane.sql
\i migrations/0003_interaction_and_actions.sql
\i migrations/0004_knowledge_governance.sql
\i migrations/0005_rls_and_immutability.sql
\i migrations/0006_reference_seeds.sql
\i migrations/0007_relational_tenancy_integrity.sql
\i migrations/0008_outbox_event_identity.sql
\i migrations/0009_cost_event_reconciliation.sql
