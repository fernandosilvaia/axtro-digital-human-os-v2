BEGIN;

ALTER TABLE cost_events
  ADD COLUMN currency text NOT NULL DEFAULT 'USD',
  ADD COLUMN rate_card_ref text,
  ADD COLUMN rate_card_as_of timestamptz,
  ADD COLUMN reconciles_cost_event_id app.uuid_v7,
  ADD COLUMN trace_id text,
  ADD COLUMN provider_request_ref text;

ALTER TABLE cost_events
  ADD CONSTRAINT cost_events_currency_check
    CHECK (currency = 'USD') NOT VALID,
  ADD CONSTRAINT cost_events_provider_id_length_check
    CHECK (char_length(provider_id) BETWEEN 1 AND 120) NOT VALID,
  ADD CONSTRAINT cost_events_service_length_check
    CHECK (char_length(service) BETWEEN 1 AND 160) NOT VALID,
  ADD CONSTRAINT cost_events_unit_type_check
    CHECK (unit_type IN ('minute','second','token','character','megabyte','request','seat','flat')) NOT VALID,
  ADD CONSTRAINT cost_events_amount_reconciliation_check
    CHECK (amount_usd = round(quantity * unit_cost_usd, 8)) NOT VALID,
  ADD CONSTRAINT cost_events_rate_card_pair_check
    CHECK (
      (rate_card_ref IS NULL AND rate_card_as_of IS NULL)
      OR (
        rate_card_ref IS NOT NULL
        AND rate_card_as_of IS NOT NULL
        AND rate_card_ref ~ '^[a-z][a-z0-9._/-]{0,159}$'
        AND rate_card_ref !~ '://'
      )
    ) NOT VALID,
  ADD CONSTRAINT cost_events_trace_id_check
    CHECK (trace_id IS NULL OR trace_id ~ '^[0-9a-f]{32}$') NOT VALID,
  ADD CONSTRAINT cost_events_provider_request_ref_check
    CHECK (provider_request_ref IS NULL OR provider_request_ref ~ '^ppr_[a-z0-9]{6,64}$') NOT VALID,
  ADD CONSTRAINT cost_events_reconciliation_source_check
    CHECK (
      reconciles_cost_event_id IS NULL
      OR (
        source IN ('measured','provider_reported')
        AND reconciles_cost_event_id <> id
      )
    ) NOT VALID,
  ADD CONSTRAINT cost_events_tenant_id_reconciles_cost_event_id_fkey
    FOREIGN KEY (tenant_id, reconciles_cost_event_id)
    REFERENCES cost_events(tenant_id, id)
    ON DELETE RESTRICT NOT VALID;

CREATE FUNCTION app.validate_cost_event_reconciliation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_cost cost_events%ROWTYPE;
BEGIN
  IF NEW.reconciles_cost_event_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO target_cost
  FROM cost_events
  WHERE tenant_id = NEW.tenant_id
    AND id = NEW.reconciles_cost_event_id
  FOR KEY SHARE;

  IF NOT FOUND
    OR target_cost.source IS DISTINCT FROM 'estimated'
    OR target_cost.session_id IS DISTINCT FROM NEW.session_id
    OR target_cost.provider_id IS DISTINCT FROM NEW.provider_id
    OR target_cost.service IS DISTINCT FROM NEW.service
    OR target_cost.unit_type IS DISTINCT FROM NEW.unit_type
  THEN
    RAISE EXCEPTION 'cost reconciliation target must be matching estimated evidence'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER cost_events_reconciliation_target
BEFORE INSERT ON cost_events
FOR EACH ROW EXECUTE FUNCTION app.validate_cost_event_reconciliation();

CREATE UNIQUE INDEX cost_events_tenant_source_provider_request_ref_unique
ON cost_events (tenant_id, source, provider_request_ref)
WHERE provider_request_ref IS NOT NULL;

COMMIT;
