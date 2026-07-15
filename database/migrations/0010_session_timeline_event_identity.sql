BEGIN;

-- `id` identifies the storage row. Canonical `event_id` is the tenant-scoped
-- delivery identity used to make an at-least-once relay idempotent.
ALTER TABLE session_timeline ADD COLUMN event_id app.uuid_v7;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM session_timeline
    WHERE jsonb_typeof(event_document) <> 'object'
      OR NOT event_document ?& ARRAY[
        'schema_version', 'event_id', 'event_type', 'event_version',
        'aggregate_type', 'aggregate_id', 'aggregate_version', 'tenant_id',
        'session_id', 'producer', 'trace_id', 'correlation_id', 'causation_id',
        'data_classification', 'payload_json', 'occurred_at'
      ]
      OR event_document - ARRAY[
        'schema_version', 'event_id', 'event_type', 'event_version',
        'aggregate_type', 'aggregate_id', 'aggregate_version', 'tenant_id',
        'session_id', 'producer', 'trace_id', 'correlation_id', 'causation_id',
        'data_classification', 'payload_json', 'occurred_at'
      ] <> '{}'::jsonb
      OR event_document ->> 'event_id' IS NULL
      OR event_document ->> 'tenant_id' IS DISTINCT FROM tenant_id::text
      OR event_document ->> 'session_id' IS DISTINCT FROM session_id::text
  ) THEN
    RAISE EXCEPTION 'session_timeline rows require a closed canonical event envelope aligned to tenant and session before event identity can be enforced';
  END IF;
END;
$$;

-- The migration owns this bounded backfill. Disable only the existing
-- append-only trigger inside the same transaction, then restore it before any
-- new constraint becomes visible. A failure rolls the trigger state back.
ALTER TABLE session_timeline DISABLE TRIGGER session_timeline_append_only;

UPDATE session_timeline
SET event_id = (event_document ->> 'event_id')::app.uuid_v7
WHERE event_id IS NULL;

ALTER TABLE session_timeline ENABLE TRIGGER session_timeline_append_only;

ALTER TABLE session_timeline ALTER COLUMN event_id SET NOT NULL;
ALTER TABLE session_timeline
  ADD CONSTRAINT session_timeline_tenant_event_id_key UNIQUE (tenant_id, event_id);
ALTER TABLE session_timeline
  ADD CONSTRAINT session_timeline_event_document_identity_check CHECK (
    jsonb_typeof(event_document) = 'object'
    AND event_document ?& ARRAY[
      'schema_version', 'event_id', 'event_type', 'event_version',
      'aggregate_type', 'aggregate_id', 'aggregate_version', 'tenant_id',
      'session_id', 'producer', 'trace_id', 'correlation_id', 'causation_id',
      'data_classification', 'payload_json', 'occurred_at'
    ]
    AND event_document - ARRAY[
      'schema_version', 'event_id', 'event_type', 'event_version',
      'aggregate_type', 'aggregate_id', 'aggregate_version', 'tenant_id',
      'session_id', 'producer', 'trace_id', 'correlation_id', 'causation_id',
      'data_classification', 'payload_json', 'occurred_at'
    ] = '{}'::jsonb
    AND event_document ->> 'schema_version' IS NOT DISTINCT FROM '2.0.0'
    AND event_document ->> 'tenant_id' IS NOT DISTINCT FROM tenant_id::text
    AND event_document ->> 'session_id' IS NOT DISTINCT FROM session_id::text
    AND event_document ->> 'aggregate_type' IS NOT DISTINCT FROM 'interaction_session'
    AND event_document ->> 'aggregate_id' IS NOT DISTINCT FROM session_id::text
    AND (event_document ->> 'event_id')::app.uuid_v7 IS NOT DISTINCT FROM event_id
    AND (event_document ->> 'aggregate_version')::bigint IS NOT DISTINCT FROM aggregate_version
    AND event_document ->> 'event_type' IS NOT DISTINCT FROM event_type
    AND (event_document ->> 'event_version')::integer IS NOT DISTINCT FROM event_version
    AND event_document ->> 'trace_id' IS NOT DISTINCT FROM trace_id
    AND (event_document ->> 'correlation_id')::app.uuid_v7 IS NOT DISTINCT FROM correlation_id
    AND (event_document ->> 'causation_id')::app.uuid_v7 IS NOT DISTINCT FROM causation_id
    AND (event_document ->> 'occurred_at')::timestamptz IS NOT DISTINCT FROM occurred_at
    AND jsonb_typeof(event_document -> 'payload_json') = 'string'
    AND jsonb_typeof((event_document ->> 'payload_json')::jsonb) = 'object'
  );

COMMIT;
