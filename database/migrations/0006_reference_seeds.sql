BEGIN;

INSERT INTO provider_catalog (provider_id, provider_type, display_name, capabilities, status)
VALUES
  ('fake-realtime', 'realtime_model', 'Deterministic Realtime Fake', '{"streaming":true,"barge_in":true}'::jsonb, 'approved'),
  ('fake-avatar', 'avatar', 'Deterministic Avatar Fake', '{"streaming":true}'::jsonb, 'approved'),
  ('fake-meeting', 'meeting', 'Deterministic Meeting Fake', '{"native_room":true}'::jsonb, 'approved'),
  ('fake-catalog', 'tool', 'Deterministic Catalog Fake', '{"read_only":true}'::jsonb, 'approved')
ON CONFLICT (provider_id) DO NOTHING;

COMMIT;
