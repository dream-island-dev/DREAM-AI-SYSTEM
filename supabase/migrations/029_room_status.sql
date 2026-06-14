-- 020_room_status.sql
-- Dream Island — room status table for RoomBoard component
-- Tracks per-room operational status (occupied/vacant/cleaning/maintenance)
-- Guest data comes from the guests table; this table handles non-guest states.

CREATE TABLE IF NOT EXISTS room_status (
  room_id     text        PRIMARY KEY,
  status      text        NOT NULL DEFAULT 'פנוי',
  notes       text,
  updated_at  timestamptz DEFAULT now(),
  updated_by  uuid        REFERENCES auth.users(id)
);

ALTER TABLE room_status ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_read_room_status" ON room_status;
CREATE POLICY "auth_read_room_status"
  ON room_status FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "auth_write_room_status" ON room_status;
CREATE POLICY "auth_write_room_status"
  ON room_status FOR ALL
  USING (auth.uid() IS NOT NULL);

-- Seed all 26 Dream Island suites with initial status 'פנוי'
INSERT INTO room_status (room_id, status) VALUES
  ('101','פנוי'), ('102','פנוי'), ('103','פנוי'), ('104','פנוי'),
  ('105','פנוי'), ('106','פנוי'), ('107','פנוי'), ('108','פנוי'),
  ('201','פנוי'), ('202','פנוי'), ('203','פנוי'), ('204','פנוי'),
  ('205','פנוי'), ('206','פנוי'), ('207','פנוי'), ('208','פנוי'),
  ('301','פנוי'), ('302','פנוי'), ('303','פנוי'), ('304','פנוי'),
  ('P1', 'פנוי'), ('P2', 'פנוי'), ('P3', 'פנוי'),
  ('P4', 'פנוי'), ('P5', 'פנוי'), ('P6', 'פנוי')
ON CONFLICT (room_id) DO NOTHING;
