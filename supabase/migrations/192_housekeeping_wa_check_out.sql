-- Housekeeping WA observer — allow check_out event_type (Co N / N co signals).

ALTER TABLE housekeeping_wa_events
  DROP CONSTRAINT IF EXISTS housekeeping_wa_events_event_type_check;

ALTER TABLE housekeeping_wa_events
  ADD CONSTRAINT housekeeping_wa_events_event_type_check
  CHECK (event_type IN ('ready', 'check_in', 'check_out'));

COMMENT ON TABLE housekeeping_wa_events IS
  'Dedup + audit for housekeeping group ready/check_in/check_out signals (whapi-webhook observer).';
