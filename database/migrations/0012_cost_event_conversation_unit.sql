BEGIN;

ALTER TABLE cost_events
  DROP CONSTRAINT cost_events_unit_type_check;

ALTER TABLE cost_events
  ADD CONSTRAINT cost_events_unit_type_check
    CHECK (
      unit_type IN (
        'minute',
        'second',
        'token',
        'character',
        'megabyte',
        'request',
        'seat',
        'flat',
        'conversation'
      )
    ) NOT VALID;

ALTER TABLE cost_events
  VALIDATE CONSTRAINT cost_events_unit_type_check;

COMMIT;
