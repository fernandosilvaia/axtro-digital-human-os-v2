BEGIN;

ALTER TABLE session_participants
  ADD CONSTRAINT session_participants_tenant_session_id_id_key
  UNIQUE (tenant_id, session_id, id);

ALTER TABLE sessions
  DROP CONSTRAINT sessions_active_presenter_fk;

ALTER TABLE sessions
  ADD CONSTRAINT sessions_active_presenter_fk
  FOREIGN KEY (tenant_id, id, active_presenter_id)
  REFERENCES session_participants(tenant_id, session_id, id)
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE conversation_turns
  DROP CONSTRAINT conversation_turns_tenant_id_participant_id_fkey;

ALTER TABLE conversation_turns
  ADD CONSTRAINT conversation_turns_tenant_id_session_id_participant_id_fkey
  FOREIGN KEY (tenant_id, session_id, participant_id)
  REFERENCES session_participants(tenant_id, session_id, id);

ALTER TABLE handoffs
  DROP CONSTRAINT handoffs_tenant_id_from_presenter_id_fkey;

ALTER TABLE handoffs
  ADD CONSTRAINT handoffs_tenant_id_session_id_from_presenter_id_fkey
  FOREIGN KEY (tenant_id, session_id, from_presenter_id)
  REFERENCES session_participants(tenant_id, session_id, id);

ALTER TABLE cost_events
  DROP CONSTRAINT cost_events_tenant_id_session_id_fkey;

ALTER TABLE cost_events
  ADD CONSTRAINT cost_events_tenant_id_session_id_fkey
  FOREIGN KEY (tenant_id, session_id)
  REFERENCES sessions(tenant_id, id)
  ON DELETE RESTRICT;

ALTER TABLE evaluation_runs
  DROP CONSTRAINT evaluation_runs_tenant_id_session_id_fkey;

ALTER TABLE evaluation_runs
  ADD CONSTRAINT evaluation_runs_tenant_id_session_id_fkey
  FOREIGN KEY (tenant_id, session_id)
  REFERENCES sessions(tenant_id, id)
  ON DELETE RESTRICT;

COMMIT;
