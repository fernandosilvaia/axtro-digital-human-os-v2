BEGIN;

-- `id` identifies the storage row. `event_id` makes consumer idempotence an
-- explicit, tenant-scoped database invariant without rewriting prior DDL.
ALTER TABLE events_outbox ADD COLUMN event_id app.uuid_v7;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM events_outbox
    WHERE jsonb_typeof(event_document) <> 'object'
      OR NOT event_document ?& ARRAY[
        'schema_version', 'event_id', 'event_type', 'event_version',
        'aggregate_type', 'aggregate_id', 'aggregate_version', 'tenant_id',
        'session_id', 'producer', 'trace_id', 'correlation_id', 'causation_id',
        'data_classification', 'payload_json', 'occurred_at'
      ]
      OR event_document ->> 'event_id' IS NULL
      OR event_document ->> 'tenant_id' IS DISTINCT FROM tenant_id::text
  ) THEN
    RAISE EXCEPTION 'events_outbox rows require a canonical event envelope aligned to tenant_id before event identity can be enforced';
  END IF;
END;
$$;

UPDATE events_outbox
SET event_id = (event_document ->> 'event_id')::app.uuid_v7
WHERE event_id IS NULL;

ALTER TABLE events_outbox ALTER COLUMN event_id SET NOT NULL;
ALTER TABLE events_outbox
  ADD CONSTRAINT events_outbox_tenant_event_id_key UNIQUE (tenant_id, event_id);
ALTER TABLE events_outbox
  ADD CONSTRAINT events_outbox_event_document_identity_check CHECK (
    jsonb_typeof(event_document) = 'object'
    AND event_document ?& ARRAY[
      'schema_version', 'event_id', 'event_type', 'event_version',
      'aggregate_type', 'aggregate_id', 'aggregate_version', 'tenant_id',
      'session_id', 'producer', 'trace_id', 'correlation_id', 'causation_id',
      'data_classification', 'payload_json', 'occurred_at'
    ]
    AND event_document ->> 'tenant_id' IS NOT DISTINCT FROM tenant_id::text
    AND (event_document ->> 'event_id')::app.uuid_v7 IS NOT DISTINCT FROM event_id
  );

CREATE INDEX events_outbox_tenant_status_aggregate_order_idx
  ON events_outbox (tenant_id, status, aggregate_type, aggregate_id, aggregate_version);

COMMIT;
