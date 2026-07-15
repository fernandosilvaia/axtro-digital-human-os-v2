BEGIN;

ALTER TABLE session_timeline
  ADD CONSTRAINT session_timeline_completion_source_key
  UNIQUE (tenant_id, session_id, event_id, aggregate_version, event_type);

CREATE TABLE workflow_commands (
  tenant_id app.uuid_v7 NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  id app.uuid_v7 NOT NULL,
  session_id app.uuid_v7 NOT NULL,
  workflow_type text NOT NULL,
  workflow_version text NOT NULL,
  aggregate_type text NOT NULL,
  source_event_type text NOT NULL,
  source_event_id app.uuid_v7 NOT NULL,
  source_event_fingerprint text NOT NULL,
  source_aggregate_version bigint NOT NULL,
  source_state_hash text NOT NULL,
  command_fingerprint text NOT NULL,
  trace_id text NOT NULL,
  correlation_id app.uuid_v7 NOT NULL,
  causation_id app.uuid_v7,
  requested_by app.uuid_v7 NOT NULL,
  idempotency_key text NOT NULL,
  scheduled_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  data_classification text NOT NULL,
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT workflow_commands_profile_check CHECK (
    workflow_type = 'post_call_processing'
    AND workflow_version = '1.0.0'
    AND aggregate_type = 'interaction_session'
    AND source_event_type = 'session.completed'
    AND data_classification = 'internal'
  ),
  CONSTRAINT workflow_commands_integrity_check CHECK (
    source_event_fingerprint ~ '^[0-9a-f]{64}$'
    AND source_state_hash ~ '^[0-9a-f]{64}$'
    AND command_fingerprint ~ '^[0-9a-f]{64}$'
    AND trace_id ~ '^[0-9a-f]{16,64}$'
    AND source_aggregate_version > 0
  ),
  CONSTRAINT workflow_commands_idempotency_key_check CHECK (
    idempotency_key ~ '^post-call-processing/v1/[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  CONSTRAINT workflow_commands_tenant_id_session_id_fkey
    FOREIGN KEY (tenant_id, session_id) REFERENCES sessions(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT workflow_commands_tenant_id_requested_by_fkey
    FOREIGN KEY (tenant_id, requested_by) REFERENCES service_identities(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT workflow_commands_source_completion_fkey
    FOREIGN KEY (tenant_id, session_id, source_event_id, source_aggregate_version, source_event_type)
    REFERENCES session_timeline(tenant_id, session_id, event_id, aggregate_version, event_type)
    ON DELETE RESTRICT,
  CONSTRAINT workflow_commands_tenant_idempotency_key_key UNIQUE (tenant_id, idempotency_key),
  CONSTRAINT workflow_commands_tenant_source_profile_key
    UNIQUE (tenant_id, source_event_id, workflow_type, workflow_version),
  CONSTRAINT workflow_commands_run_reference_key
    UNIQUE (tenant_id, id, workflow_type, workflow_version, aggregate_type, session_id, idempotency_key),
  CONSTRAINT workflow_commands_receipt_source_key
    UNIQUE (tenant_id, id, session_id, source_event_id, source_aggregate_version, source_event_type)
);

ALTER TABLE workflow_runs
  ADD CONSTRAINT workflow_runs_receipt_reference_key
    UNIQUE (tenant_id, id, command_id, aggregate_id);

ALTER TABLE workflow_runs
  ADD COLUMN post_call_command_id app.uuid_v7,
  ADD COLUMN state_version bigint NOT NULL DEFAULT 1,
  ADD COLUMN max_attempts integer NOT NULL DEFAULT 4,
  ADD COLUMN next_attempt_at timestamptz,
  ADD COLUMN last_error_code text,
  ADD COLUMN result_hash text,
  ADD COLUMN cancelled_at timestamptz,
  ADD COLUMN active_fencing_token app.uuid_v7,
  ADD COLUMN lease_expires_at timestamptz,
  ADD COLUMN data_classification text NOT NULL DEFAULT 'internal';

ALTER TABLE workflow_runs
  ADD CONSTRAINT workflow_runs_post_call_profile_check CHECK (
    workflow_type <> 'post_call_processing'
    OR (
      workflow_version = '1.0.0'
      AND aggregate_type = 'interaction_session'
      AND post_call_command_id IS NOT DISTINCT FROM command_id
      AND status IN ('queued','running','waiting','completed','failed','cancelled')
      AND current_step IN ('generate_summary','evaluate','record_follow_up_guard','finalize')
      AND attempts BETWEEN 0 AND 64
      AND max_attempts BETWEEN 1 AND 16
      AND state_version > 0
      AND input_document = '{}'::jsonb
      AND last_error IS NULL
      AND data_classification = 'internal'
    )
  ) NOT VALID,
  ADD CONSTRAINT workflow_runs_post_call_error_check CHECK (
    workflow_type <> 'post_call_processing'
    OR (
      (status = 'queued' AND last_error_code IS NULL)
      OR (status = 'running' AND (last_error_code IS NULL OR last_error_code = 'lease_expired'))
      OR (status = 'waiting' AND last_error_code = 'activity_retryable')
      OR (status = 'completed' AND last_error_code IS NULL)
      OR (status = 'failed' AND last_error_code IN (
        'max_attempts_exhausted','invalid_source','policy_denied','internal_failure'
      ))
      OR (status = 'cancelled' AND last_error_code IS NULL)
    )
  ) NOT VALID,
  ADD CONSTRAINT workflow_runs_post_call_lease_check CHECK (
    workflow_type <> 'post_call_processing'
    OR (
      (status = 'running' AND active_fencing_token IS NOT NULL AND lease_expires_at > updated_at)
      OR (status <> 'running' AND active_fencing_token IS NULL AND lease_expires_at IS NULL)
    )
  ) NOT VALID,
  ADD CONSTRAINT workflow_runs_post_call_waiting_check CHECK (
    workflow_type <> 'post_call_processing'
    OR (status = 'waiting' AND next_attempt_at > updated_at)
    OR (status <> 'waiting' AND next_attempt_at IS NULL)
  ) NOT VALID,
  ADD CONSTRAINT workflow_runs_post_call_lifecycle_check CHECK (
    workflow_type <> 'post_call_processing'
    OR (
      (
        (status = 'queued' AND attempts = 0)
        OR (status <> 'queued' AND attempts BETWEEN 1 AND 64)
      )
      AND (
        status NOT IN ('running','waiting','completed','failed')
        OR started_at IS NOT NULL
      )
      AND (status <> 'completed' OR current_step = 'finalize')
    )
  ) NOT VALID,
  ADD CONSTRAINT workflow_runs_post_call_terminal_check CHECK (
    workflow_type <> 'post_call_processing'
    OR (status = 'completed' AND completed_at IS NOT NULL AND cancelled_at IS NULL AND result_hash ~ '^[0-9a-f]{64}$')
    OR (status = 'cancelled' AND completed_at IS NULL AND cancelled_at IS NOT NULL AND result_hash IS NULL)
    OR (status NOT IN ('completed','cancelled') AND completed_at IS NULL AND cancelled_at IS NULL AND result_hash IS NULL)
  ) NOT VALID,
  ADD CONSTRAINT workflow_runs_post_call_command_fkey
    FOREIGN KEY (
      tenant_id, post_call_command_id, workflow_type, workflow_version,
      aggregate_type, aggregate_id, idempotency_key
    )
    REFERENCES workflow_commands(
      tenant_id, id, workflow_type, workflow_version,
      aggregate_type, session_id, idempotency_key
    )
    ON DELETE RESTRICT NOT VALID;

CREATE UNIQUE INDEX workflow_runs_tenant_active_fencing_token_unique
  ON workflow_runs (tenant_id, active_fencing_token)
  WHERE active_fencing_token IS NOT NULL;

CREATE UNIQUE INDEX workflow_runs_tenant_post_call_command_unique
  ON workflow_runs (tenant_id, post_call_command_id)
  WHERE workflow_type = 'post_call_processing';

CREATE TABLE workflow_step_receipts (
  tenant_id app.uuid_v7 NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  id app.uuid_v7 NOT NULL,
  session_id app.uuid_v7 NOT NULL,
  workflow_run_id app.uuid_v7 NOT NULL,
  command_id app.uuid_v7 NOT NULL,
  source_event_id app.uuid_v7 NOT NULL,
  source_aggregate_version bigint NOT NULL,
  source_event_type text NOT NULL DEFAULT 'session.completed',
  step text NOT NULL,
  attempt integer NOT NULL,
  outcome text NOT NULL,
  artifact_hash text,
  failure_code text,
  fencing_token app.uuid_v7 NOT NULL,
  state_version_before bigint NOT NULL,
  state_version_after bigint NOT NULL,
  trace_id text NOT NULL,
  correlation_id app.uuid_v7 NOT NULL,
  started_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL,
  data_classification text NOT NULL DEFAULT 'internal',
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT workflow_step_receipts_shape_check CHECK (
    source_event_type = 'session.completed'
    AND step IN ('generate_summary','evaluate','record_follow_up_guard','finalize')
    AND attempt BETWEEN 1 AND 16
    AND outcome IN ('checkpointed','retry_scheduled','completed','cancelled','failed')
    AND (artifact_hash IS NULL OR artifact_hash ~ '^[0-9a-f]{64}$')
    AND (
      failure_code IS NULL
      OR failure_code IN (
        'activity_retryable','lease_expired','max_attempts_exhausted',
        'invalid_source','policy_denied','internal_failure'
      )
    )
    AND state_version_before > 0
    AND state_version_after = state_version_before + 1
    AND trace_id ~ '^[0-9a-f]{16,64}$'
    AND completed_at >= started_at
    AND data_classification = 'internal'
    AND (
      (outcome = 'checkpointed' AND artifact_hash IS NOT NULL AND failure_code IS NULL)
      OR (outcome = 'retry_scheduled' AND artifact_hash IS NULL AND failure_code = 'activity_retryable')
      OR (outcome = 'completed' AND step = 'finalize' AND artifact_hash IS NULL AND failure_code IS NULL)
      OR (outcome = 'cancelled' AND artifact_hash IS NULL AND failure_code IS NULL)
      OR (outcome = 'failed' AND artifact_hash IS NULL AND failure_code IN (
        'max_attempts_exhausted','invalid_source','policy_denied','internal_failure'
      ))
    )
  ),
  CONSTRAINT workflow_step_receipts_tenant_run_fkey
    FOREIGN KEY (tenant_id, workflow_run_id) REFERENCES workflow_runs(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT workflow_step_receipts_run_command_session_fkey
    FOREIGN KEY (tenant_id, workflow_run_id, command_id, session_id)
    REFERENCES workflow_runs(tenant_id, id, command_id, aggregate_id) ON DELETE RESTRICT,
  CONSTRAINT workflow_step_receipts_tenant_command_fkey
    FOREIGN KEY (tenant_id, command_id) REFERENCES workflow_commands(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT workflow_step_receipts_command_source_fkey
    FOREIGN KEY (
      tenant_id, command_id, session_id, source_event_id,
      source_aggregate_version, source_event_type
    ) REFERENCES workflow_commands(
      tenant_id, id, session_id, source_event_id,
      source_aggregate_version, source_event_type
    ) ON DELETE RESTRICT,
  CONSTRAINT workflow_step_receipts_source_completion_fkey
    FOREIGN KEY (tenant_id, session_id, source_event_id, source_aggregate_version, source_event_type)
    REFERENCES session_timeline(tenant_id, session_id, event_id, aggregate_version, event_type)
    ON DELETE RESTRICT,
  CONSTRAINT workflow_step_receipts_run_step_attempt_key
    UNIQUE (tenant_id, workflow_run_id, step, attempt),
  CONSTRAINT workflow_step_receipts_tenant_fencing_token_key
    UNIQUE (tenant_id, fencing_token)
);

CREATE TABLE post_call_workflow_results (
  tenant_id app.uuid_v7 NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  workflow_run_id app.uuid_v7 NOT NULL,
  session_id app.uuid_v7 NOT NULL,
  command_id app.uuid_v7 NOT NULL,
  source_event_id app.uuid_v7 NOT NULL,
  source_event_fingerprint text NOT NULL,
  source_aggregate_version bigint NOT NULL,
  source_event_type text NOT NULL DEFAULT 'session.completed',
  source_state_hash text NOT NULL,
  trace_id text NOT NULL,
  correlation_id app.uuid_v7 NOT NULL,
  causation_id app.uuid_v7,
  summary_template_code text NOT NULL,
  summary_text text NOT NULL,
  canonical_event_count integer NOT NULL,
  final_state_version bigint NOT NULL,
  evaluator_version text NOT NULL,
  evaluation_outcome text NOT NULL,
  score_basis_points integer NOT NULL,
  follow_up_command_id app.uuid_v7 NOT NULL,
  follow_up_mode text NOT NULL,
  follow_up_status text NOT NULL,
  follow_up_external_effect boolean NOT NULL,
  follow_up_effect_hash text NOT NULL,
  result_hash text NOT NULL,
  completed_at timestamptz NOT NULL,
  data_classification text NOT NULL,
  PRIMARY KEY (tenant_id, workflow_run_id),
  CONSTRAINT post_call_workflow_results_shape_check CHECK (
    source_event_type = 'session.completed'
    AND source_event_fingerprint ~ '^[0-9a-f]{64}$'
    AND source_state_hash ~ '^[0-9a-f]{64}$'
    AND trace_id ~ '^[0-9a-f]{16,64}$'
    AND summary_template_code = 'deterministic_session_summary_v1'
    AND char_length(summary_text) BETWEEN 1 AND 500
    AND canonical_event_count BETWEEN 1 AND 10000
    AND final_state_version > 0
    AND evaluator_version = 'fake-structural-v1'
    AND evaluation_outcome IN ('passed','review_required')
    AND score_basis_points BETWEEN 0 AND 10000
    AND follow_up_mode = 'deterministic_noop'
    AND follow_up_status = 'not_sent'
    AND follow_up_external_effect = false
    AND follow_up_effect_hash ~ '^[0-9a-f]{64}$'
    AND result_hash ~ '^[0-9a-f]{64}$'
    AND data_classification = 'restricted'
  ),
  CONSTRAINT post_call_workflow_results_tenant_run_fkey
    FOREIGN KEY (tenant_id, workflow_run_id) REFERENCES workflow_runs(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT post_call_workflow_results_run_command_session_fkey
    FOREIGN KEY (tenant_id, workflow_run_id, command_id, session_id)
    REFERENCES workflow_runs(tenant_id, id, command_id, aggregate_id) ON DELETE RESTRICT,
  CONSTRAINT post_call_workflow_results_tenant_command_fkey
    FOREIGN KEY (tenant_id, command_id) REFERENCES workflow_commands(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT post_call_workflow_results_command_source_fkey
    FOREIGN KEY (
      tenant_id, command_id, session_id, source_event_id,
      source_aggregate_version, source_event_type
    ) REFERENCES workflow_commands(
      tenant_id, id, session_id, source_event_id,
      source_aggregate_version, source_event_type
    ) ON DELETE RESTRICT,
  CONSTRAINT post_call_workflow_results_source_completion_fkey
    FOREIGN KEY (tenant_id, session_id, source_event_id, source_aggregate_version, source_event_type)
    REFERENCES session_timeline(tenant_id, session_id, event_id, aggregate_version, event_type)
    ON DELETE RESTRICT,
  CONSTRAINT post_call_workflow_results_tenant_command_key UNIQUE (tenant_id, command_id),
  CONSTRAINT post_call_workflow_results_evidence_reference_key
    UNIQUE (tenant_id, workflow_run_id, session_id),
  CONSTRAINT post_call_workflow_results_tenant_source_event_key UNIQUE (tenant_id, source_event_id)
);

CREATE TABLE post_call_workflow_result_evidence (
  tenant_id app.uuid_v7 NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  workflow_run_id app.uuid_v7 NOT NULL,
  session_id app.uuid_v7 NOT NULL,
  ordinal integer NOT NULL,
  evidence_event_id app.uuid_v7 NOT NULL,
  evidence_aggregate_version bigint NOT NULL,
  evidence_event_type text NOT NULL,
  PRIMARY KEY (tenant_id, workflow_run_id, evidence_event_id),
  CONSTRAINT post_call_workflow_result_evidence_ordinal_check CHECK (ordinal BETWEEN 0 AND 15),
  CONSTRAINT post_call_workflow_result_evidence_tenant_ordinal_key
    UNIQUE (tenant_id, workflow_run_id, ordinal),
  CONSTRAINT post_call_workflow_result_evidence_tenant_result_fkey
    FOREIGN KEY (tenant_id, workflow_run_id)
    REFERENCES post_call_workflow_results(tenant_id, workflow_run_id) ON DELETE RESTRICT,
  CONSTRAINT post_call_workflow_result_evidence_result_session_fkey
    FOREIGN KEY (tenant_id, workflow_run_id, session_id)
    REFERENCES post_call_workflow_results(tenant_id, workflow_run_id, session_id) ON DELETE RESTRICT,
  CONSTRAINT post_call_workflow_result_evidence_timeline_fkey
    FOREIGN KEY (tenant_id, session_id, evidence_event_id, evidence_aggregate_version, evidence_event_type)
    REFERENCES session_timeline(tenant_id, session_id, event_id, aggregate_version, event_type)
    ON DELETE RESTRICT
);

DO $$
DECLARE
  table_name text;
  tenant_tables text[] := ARRAY[
    'workflow_commands',
    'workflow_step_receipts',
    'post_call_workflow_results',
    'post_call_workflow_result_evidence'
  ];
BEGIN
  FOREACH table_name IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id())',
      table_name
    );
  END LOOP;
END $$;

CREATE TRIGGER workflow_commands_append_only
BEFORE UPDATE OR DELETE ON workflow_commands
FOR EACH ROW EXECUTE FUNCTION app.prevent_mutation();

CREATE TRIGGER workflow_step_receipts_append_only
BEFORE UPDATE OR DELETE ON workflow_step_receipts
FOR EACH ROW EXECUTE FUNCTION app.prevent_mutation();

CREATE TRIGGER post_call_workflow_results_append_only
BEFORE UPDATE OR DELETE ON post_call_workflow_results
FOR EACH ROW EXECUTE FUNCTION app.prevent_mutation();

CREATE TRIGGER post_call_workflow_result_evidence_append_only
BEFORE UPDATE OR DELETE ON post_call_workflow_result_evidence
FOR EACH ROW EXECUTE FUNCTION app.prevent_mutation();

COMMIT;
