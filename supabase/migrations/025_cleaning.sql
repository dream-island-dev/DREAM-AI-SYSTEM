-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 025: cleaning_tasks + cleaning_sessions
-- ─────────────────────────────────────────────────────────────────────────────

-- ── cleaning_tasks — רשימת משימות לכל חדר ────────────────────────────────────
CREATE TABLE IF NOT EXISTS cleaning_tasks (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id    uuid REFERENCES rooms(id) ON DELETE CASCADE,
  label      text        NOT NULL,
  sort_order int         NOT NULL DEFAULT 0,
  is_active  boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ── cleaning_sessions — לוג ניקיונות ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cleaning_sessions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id          uuid REFERENCES rooms(id) ON DELETE CASCADE,
  started_at       timestamptz NOT NULL DEFAULT now(),
  completed_at     timestamptz,
  completed_tasks  jsonb       NOT NULL DEFAULT '[]',  -- מערך של task ids שהושלמו
  issue_note       text,
  status           text NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress','done','issue')),
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS cleaning_tasks_room_idx    ON cleaning_tasks(room_id);
CREATE INDEX IF NOT EXISTS cleaning_sessions_room_idx ON cleaning_sessions(room_id);
CREATE INDEX IF NOT EXISTS cleaning_sessions_date_idx ON cleaning_sessions(started_at);

-- ── Seed: default tasks for all rooms ────────────────────────────────────────
-- כל חדר יקבל ברירת מחדל — אפשר לשנות דרך הממשק
INSERT INTO cleaning_tasks (room_id, label, sort_order)
SELECT r.id, t.label, t.sort_order
FROM rooms r
CROSS JOIN (VALUES
  (1, 'פינוי מגבות ופריטים'),
  (2, 'החלפת מצעים ושמיכות'),
  (3, 'ניקוי חדר רחצה'),
  (4, 'ריחוף ושאיבת רצפות'),
  (5, 'מילוי צרכי רחצה'),
  (6, 'ניקוי מטבחון / מיני בר'),
  (7, 'בדיקה כללית ודיווח בעיות')
) AS t(sort_order, label)
WHERE r.is_active = true
ON CONFLICT DO NOTHING;

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE cleaning_tasks    ENABLE ROW LEVEL SECURITY;
ALTER TABLE cleaning_sessions ENABLE ROW LEVEL SECURITY;

-- משימות — כל הצוות קורא, מנהלים עורכים
CREATE POLICY "staff_read_tasks" ON cleaning_tasks
  FOR SELECT USING (true);  -- ציבורי — דף ניקיון לא דורש auth

CREATE POLICY "managers_write_tasks" ON cleaning_tasks
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('super_admin','admin','manager')
    )
  );

-- sessions — ציבורי לכתיבה (נקיין ללא login), מנהלים קוראים
CREATE POLICY "public_insert_sessions" ON cleaning_sessions
  FOR INSERT WITH CHECK (true);

CREATE POLICY "public_update_sessions" ON cleaning_sessions
  FOR UPDATE USING (true);

CREATE POLICY "staff_read_sessions" ON cleaning_sessions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('super_admin','admin','manager','staff')
    )
  );
