BEGIN;

CREATE TABLE knowledge_sources (
  tenant_id app.uuid_v7 NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  id app.uuid_v7 NOT NULL,
  source_type text NOT NULL,
  display_name text NOT NULL,
  source_uri text,
  data_classification text NOT NULL,
  access_policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL CHECK (status IN ('pending','active','stale','disabled','deleted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE knowledge_versions (
  tenant_id app.uuid_v7 NOT NULL,
  id app.uuid_v7 NOT NULL,
  source_id app.uuid_v7 NOT NULL,
  version text NOT NULL,
  content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  valid_from timestamptz,
  valid_to timestamptz,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, source_id) REFERENCES knowledge_sources(tenant_id, id) ON DELETE CASCADE,
  UNIQUE (tenant_id, source_id, version)
);

CREATE TABLE knowledge_chunks (
  tenant_id app.uuid_v7 NOT NULL,
  id app.uuid_v7 NOT NULL,
  version_id app.uuid_v7 NOT NULL,
  chunk_index integer NOT NULL CHECK (chunk_index >= 0),
  content_text text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  token_count integer CHECK (token_count IS NULL OR token_count >= 0),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, version_id) REFERENCES knowledge_versions(tenant_id, id) ON DELETE CASCADE,
  UNIQUE (tenant_id, version_id, chunk_index)
);

CREATE TABLE knowledge_embeddings (
  tenant_id app.uuid_v7 NOT NULL,
  id app.uuid_v7 NOT NULL,
  chunk_id app.uuid_v7 NOT NULL,
  embedding_model text NOT NULL,
  embedding_dimensions integer NOT NULL CHECK (embedding_dimensions > 0),
  embedding vector NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, chunk_id) REFERENCES knowledge_chunks(tenant_id, id) ON DELETE CASCADE,
  CHECK (vector_dims(embedding) = embedding_dimensions),
  UNIQUE (tenant_id, chunk_id, embedding_model)
);

CREATE TABLE workflow_runs (
  tenant_id app.uuid_v7 NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  id app.uuid_v7 NOT NULL,
  command_id app.uuid_v7 NOT NULL,
  workflow_type text NOT NULL,
  workflow_version text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id app.uuid_v7 NOT NULL,
  idempotency_key text NOT NULL,
  status text NOT NULL,
  current_step text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  input_document jsonb NOT NULL,
  last_error jsonb,
  started_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE TABLE audit_log (
  tenant_id app.uuid_v7 NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  id app.uuid_v7 NOT NULL,
  actor_id app.uuid_v7,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text NOT NULL,
  outcome text NOT NULL,
  trace_id text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE events_outbox (
  tenant_id app.uuid_v7 NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  id app.uuid_v7 NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id app.uuid_v7 NOT NULL,
  aggregate_version bigint NOT NULL,
  event_type text NOT NULL,
  event_version integer NOT NULL,
  event_document jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','publishing','published','failed','dead_letter')),
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, aggregate_type, aggregate_id, aggregate_version)
);

CREATE TABLE cost_events (
  tenant_id app.uuid_v7 NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  id app.uuid_v7 NOT NULL,
  session_id app.uuid_v7,
  provider_id text NOT NULL,
  service text NOT NULL,
  unit_type text NOT NULL,
  quantity numeric(20,8) NOT NULL CHECK (quantity >= 0),
  unit_cost_usd numeric(20,10) NOT NULL CHECK (unit_cost_usd >= 0),
  amount_usd numeric(20,8) NOT NULL CHECK (amount_usd >= 0),
  source text NOT NULL CHECK (source IN ('measured','provider_reported','estimated')),
  occurred_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, session_id) REFERENCES sessions(tenant_id, id) ON DELETE SET NULL
);

CREATE TABLE usage_ledger (
  tenant_id app.uuid_v7 NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  id app.uuid_v7 NOT NULL,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  metric text NOT NULL,
  quantity numeric(20,8) NOT NULL,
  source_event_count bigint NOT NULL,
  calculated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, period_start, period_end, metric)
);

CREATE TABLE evaluation_runs (
  tenant_id app.uuid_v7 NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  id app.uuid_v7 NOT NULL,
  session_id app.uuid_v7,
  evaluator_version text NOT NULL,
  scorecard_id text NOT NULL,
  results jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('queued','running','completed','failed','review_required')),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, session_id) REFERENCES sessions(tenant_id, id) ON DELETE SET NULL
);

CREATE TABLE experiment_candidates (
  tenant_id app.uuid_v7 NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  id app.uuid_v7 NOT NULL,
  component text NOT NULL,
  hypothesis text NOT NULL,
  baseline_version text NOT NULL,
  candidate_version text NOT NULL,
  target_metrics text[] NOT NULL,
  guardrails text[] NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE deployment_promotions (
  tenant_id app.uuid_v7 NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  id app.uuid_v7 NOT NULL,
  experiment_id app.uuid_v7 NOT NULL,
  component text NOT NULL,
  from_version text NOT NULL,
  to_version text NOT NULL,
  environment text NOT NULL,
  rollout_percentage numeric(5,2) NOT NULL CHECK (rollout_percentage BETWEEN 0 AND 100),
  decision text NOT NULL CHECK (decision IN ('promote','hold','rollback','reject')),
  decision_reasons text[] NOT NULL,
  rollback_plan text NOT NULL,
  approved_by app.uuid_v7 NOT NULL,
  promoted_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, experiment_id) REFERENCES experiment_candidates(tenant_id, id)
);

COMMIT;
