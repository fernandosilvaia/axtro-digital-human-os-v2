BEGIN;

CREATE TABLE contact_profiles (
  tenant_id app.uuid_v7 NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  id app.uuid_v7 NOT NULL,
  external_ref text,
  display_name text,
  email_ciphertext bytea,
  phone_ciphertext bytea,
  pii_key_ref text,
  data_classification text NOT NULL DEFAULT 'restricted' CHECK (data_classification IN ('internal','confidential','restricted')),
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, external_ref)
);

CREATE TABLE sessions (
  tenant_id app.uuid_v7 NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  id app.uuid_v7 NOT NULL,
  agent_id app.uuid_v7 NOT NULL,
  deployment_id app.uuid_v7,
  contact_profile_id app.uuid_v7,
  role_pack_id text NOT NULL,
  role_pack_version text NOT NULL,
  channel_type text NOT NULL CHECK (channel_type IN ('native_room','telephone','google_meet','zoom','teams','web_widget','api')),
  external_session_ref text,
  status text NOT NULL CHECK (status IN ('preparing','ready','active','handoff_pending','completed','failed')),
  active_presenter_id app.uuid_v7,
  state_version bigint NOT NULL DEFAULT 0 CHECK (state_version >= 0),
  disclosure_status text NOT NULL DEFAULT 'pending',
  consent_status text NOT NULL DEFAULT 'pending',
  degradation_level text NOT NULL DEFAULT 'none',
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, agent_id) REFERENCES agents(tenant_id, id),
  FOREIGN KEY (tenant_id, deployment_id) REFERENCES agent_deployments(tenant_id, id),
  FOREIGN KEY (tenant_id, contact_profile_id) REFERENCES contact_profiles(tenant_id, id)
);

CREATE TABLE session_participants (
  tenant_id app.uuid_v7 NOT NULL,
  id app.uuid_v7 NOT NULL,
  session_id app.uuid_v7 NOT NULL,
  participant_type text NOT NULL CHECK (participant_type IN ('customer','human_presenter','digital_presenter','observer','meeting_bot')),
  display_name text,
  external_participant_ref text,
  joined_at timestamptz,
  left_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, session_id) REFERENCES sessions(tenant_id, id) ON DELETE CASCADE
);

ALTER TABLE sessions
  ADD CONSTRAINT sessions_active_presenter_fk
  FOREIGN KEY (tenant_id, active_presenter_id)
  REFERENCES session_participants(tenant_id, id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE session_state_snapshots (
  tenant_id app.uuid_v7 NOT NULL,
  id app.uuid_v7 NOT NULL,
  session_id app.uuid_v7 NOT NULL,
  aggregate_version bigint NOT NULL CHECK (aggregate_version >= 0),
  schema_id text NOT NULL,
  schema_version text NOT NULL,
  state_document jsonb NOT NULL,
  state_hash text NOT NULL CHECK (state_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, session_id) REFERENCES sessions(tenant_id, id) ON DELETE CASCADE,
  UNIQUE (tenant_id, session_id, aggregate_version)
);

CREATE TABLE session_timeline (
  tenant_id app.uuid_v7 NOT NULL,
  id app.uuid_v7 NOT NULL,
  session_id app.uuid_v7 NOT NULL,
  aggregate_version bigint NOT NULL CHECK (aggregate_version > 0),
  event_type text NOT NULL,
  event_version integer NOT NULL CHECK (event_version > 0),
  event_document jsonb NOT NULL,
  trace_id text NOT NULL,
  correlation_id app.uuid_v7 NOT NULL,
  causation_id app.uuid_v7,
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, session_id) REFERENCES sessions(tenant_id, id) ON DELETE CASCADE,
  UNIQUE (tenant_id, session_id, aggregate_version)
);

CREATE TABLE conversation_turns (
  tenant_id app.uuid_v7 NOT NULL,
  id app.uuid_v7 NOT NULL,
  session_id app.uuid_v7 NOT NULL,
  participant_id app.uuid_v7 NOT NULL,
  turn_index integer NOT NULL CHECK (turn_index >= 0),
  role text NOT NULL CHECK (role IN ('participant','presenter','system')),
  transcript_text text,
  transcript_ciphertext bytea,
  language text NOT NULL,
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  interrupted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, session_id) REFERENCES sessions(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, participant_id) REFERENCES session_participants(tenant_id, id),
  UNIQUE (tenant_id, session_id, turn_index)
);

CREATE TABLE consent_evidence (
  tenant_id app.uuid_v7 NOT NULL,
  id app.uuid_v7 NOT NULL,
  session_id app.uuid_v7 NOT NULL,
  subject_ref text NOT NULL,
  consent_type text NOT NULL,
  purpose text NOT NULL,
  status text NOT NULL CHECK (status IN ('granted','denied','revoked','expired')),
  method text NOT NULL,
  jurisdiction text NOT NULL,
  disclosure_version text NOT NULL,
  evidence_hash text NOT NULL CHECK (evidence_hash ~ '^[0-9a-f]{64}$'),
  captured_at timestamptz NOT NULL,
  expires_at timestamptz,
  revoked_at timestamptz,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, session_id) REFERENCES sessions(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE disclosure_records (
  tenant_id app.uuid_v7 NOT NULL,
  id app.uuid_v7 NOT NULL,
  session_id app.uuid_v7 NOT NULL,
  disclosure_type text NOT NULL,
  version text NOT NULL,
  content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  delivery_channel text NOT NULL,
  language text NOT NULL,
  delivered_at timestamptz NOT NULL,
  acknowledged boolean NOT NULL DEFAULT false,
  acknowledged_at timestamptz,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, session_id) REFERENCES sessions(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE session_health (
  tenant_id app.uuid_v7 NOT NULL,
  id app.uuid_v7 NOT NULL,
  session_id app.uuid_v7 NOT NULL,
  overall_status text NOT NULL,
  degradation_level text NOT NULL,
  metrics jsonb NOT NULL,
  provider_statuses jsonb NOT NULL,
  active_incidents text[] NOT NULL DEFAULT '{}',
  observed_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, session_id) REFERENCES sessions(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE action_intents (
  tenant_id app.uuid_v7 NOT NULL,
  id app.uuid_v7 NOT NULL,
  session_id app.uuid_v7 NOT NULL,
  actor_id app.uuid_v7 NOT NULL,
  actor_type text NOT NULL,
  tool_contract_id text NOT NULL,
  action_name text NOT NULL,
  arguments_document jsonb NOT NULL,
  purpose text NOT NULL,
  idempotency_key text NOT NULL,
  status text NOT NULL CHECK (status IN ('proposed','authorized','denied','approval_pending','executing','completed','failed','unknown','expired')),
  requested_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, session_id) REFERENCES sessions(tenant_id, id) ON DELETE CASCADE,
  UNIQUE (tenant_id, idempotency_key)
);

CREATE TABLE policy_decisions (
  tenant_id app.uuid_v7 NOT NULL,
  id app.uuid_v7 NOT NULL,
  intent_id app.uuid_v7 NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('allow','deny','require_approval')),
  reasons text[] NOT NULL,
  obligations text[] NOT NULL DEFAULT '{}',
  policy_version text NOT NULL,
  evaluated_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, intent_id) REFERENCES action_intents(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE human_approvals (
  tenant_id app.uuid_v7 NOT NULL,
  id app.uuid_v7 NOT NULL,
  intent_id app.uuid_v7 NOT NULL,
  requested_from app.uuid_v7,
  status text NOT NULL CHECK (status IN ('pending','approved','denied','expired','cancelled')),
  reason text,
  requested_at timestamptz NOT NULL,
  decided_at timestamptz,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, intent_id) REFERENCES action_intents(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE tool_executions (
  tenant_id app.uuid_v7 NOT NULL,
  id app.uuid_v7 NOT NULL,
  intent_id app.uuid_v7 NOT NULL,
  provider_id text NOT NULL,
  attempt integer NOT NULL CHECK (attempt > 0),
  status text NOT NULL CHECK (status IN ('started','succeeded','failed','pending','unknown','cancelled')),
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, intent_id) REFERENCES action_intents(tenant_id, id) ON DELETE CASCADE,
  UNIQUE (tenant_id, intent_id, attempt)
);

CREATE TABLE tool_receipts (
  tenant_id app.uuid_v7 NOT NULL,
  id app.uuid_v7 NOT NULL,
  execution_id app.uuid_v7 NOT NULL,
  intent_id app.uuid_v7 NOT NULL,
  status text NOT NULL CHECK (status IN ('succeeded','failed','pending','unknown','cancelled')),
  result_document jsonb,
  error_document jsonb,
  effect_hash text CHECK (effect_hash IS NULL OR effect_hash ~ '^[0-9a-f]{64}$'),
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, execution_id) REFERENCES tool_executions(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, intent_id) REFERENCES action_intents(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE handoffs (
  tenant_id app.uuid_v7 NOT NULL,
  id app.uuid_v7 NOT NULL,
  session_id app.uuid_v7 NOT NULL,
  from_presenter_id app.uuid_v7 NOT NULL,
  target_type text NOT NULL,
  target_id app.uuid_v7,
  reason_code text NOT NULL,
  priority text NOT NULL,
  packet_document jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('requested','accepted','completed','expired','cancelled','failed')),
  requested_at timestamptz NOT NULL,
  accepted_at timestamptz,
  completed_at timestamptz,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, session_id) REFERENCES sessions(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, from_presenter_id) REFERENCES session_participants(tenant_id, id)
);

COMMIT;
