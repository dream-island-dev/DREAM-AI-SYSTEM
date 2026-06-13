-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 024: rooms — סוויטות Dream Island
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS rooms (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text        NOT NULL,
  type          text        NOT NULL DEFAULT 'סוויטה בוטיק',
  sort_order    int         NOT NULL DEFAULT 0,
  status        text        NOT NULL DEFAULT 'free'
    CHECK (status IN ('free','occupied','dirty','cleaning','maintenance')),
  current_guest text,
  checkout_date date,
  notes         text,
  is_active     boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- ── Seed: 6 known suites from dream-island.co.il ─────────────────────────────
INSERT INTO rooms (name, type, sort_order, status) VALUES
  ('אמטיסט',   'סוויטת VIP',      1, 'free'),
  ('ג''ספר',   'סוויטת VIP',      2, 'free'),
  ('אוניקס',   'סוויטת VIP',      3, 'free'),
  ('אקוומרין', 'סוויטה בוטיק',    4, 'free'),
  ('אמרלד',    'סוויטת פרמיום',   5, 'free'),
  ('רובי',     'סוויטת VIP',      6, 'free')
ON CONFLICT DO NOTHING;

-- ── updated_at trigger ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS rooms_updated_at ON rooms;
CREATE TRIGGER rooms_updated_at
  BEFORE UPDATE ON rooms
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS rooms_sort_idx ON rooms(sort_order);
CREATE INDEX IF NOT EXISTS rooms_status_idx ON rooms(status);

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;

-- כל הצוות קורא
CREATE POLICY "staff_read_rooms" ON rooms
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('super_admin','admin','manager','staff')
    )
  );

-- כל הצוות מעדכן סטטוס
CREATE POLICY "staff_update_rooms" ON rooms
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('super_admin','admin','manager','staff')
    )
  );

-- רק מנהלים מוסיפים / מוחקים
CREATE POLICY "managers_insert_rooms" ON rooms
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('super_admin','admin','manager')
    )
  );

CREATE POLICY "managers_delete_rooms" ON rooms
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('super_admin','admin','manager')
    )
  );
