-- Housekeeping WhatsApp observer — idempotency log for whapi-webhook ready + check-in signals.

CREATE TABLE IF NOT EXISTS housekeeping_wa_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  wa_message_id TEXT NOT NULL,
  room_number SMALLINT NOT NULL CHECK (room_number BETWEEN 1 AND 26),
  room_id TEXT NOT NULL,
  event_type TEXT NOT NULL DEFAULT 'ready' CHECK (event_type IN ('ready', 'check_in')),
  source_line TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_housekeeping_wa_msg_room_event UNIQUE (wa_message_id, room_number, event_type)
);

CREATE INDEX IF NOT EXISTS idx_housekeeping_wa_events_created
  ON housekeeping_wa_events (created_at DESC);

ALTER TABLE housekeeping_wa_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY housekeeping_wa_events_read_authenticated
  ON housekeeping_wa_events FOR SELECT
  TO authenticated
  USING (true);

COMMENT ON TABLE housekeeping_wa_events IS
  'Dedup + audit for housekeeping group ready/check_in signals (whapi-webhook observer).';
