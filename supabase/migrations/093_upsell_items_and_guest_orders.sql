-- Migration 093: Dynamic Experience Hub — upsell_items + guest_orders
-- session: "MASTER INTEGRATION: DYNAMIC UPSALE & EXPERIENCE HUB"
--
-- Design decisions:
--   • upsell_items.target_audience — server-side filter, never leaks suite items to day_use guests
--   • guest_orders — thin join table; status pipeline mirrors spa_staging/inventory_submissions pattern
--   • No DELETE policy on guest_orders — order history is financial-adjacent (same rule as voucher tables)
--   • RLS: authenticated staff read/write; portal submissions go through service-role key in edge functions
--   • Seeded with 6 items matching the resort's known offering; all easily editable via a future admin UI

-- ── upsell_items ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS upsell_items (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT        NOT NULL,
  description      TEXT,
  price            NUMERIC(10, 2),
  category         TEXT        NOT NULL DEFAULT 'general',
  -- 'suite'   → only shown to room_type='suite' guests
  -- 'day_use' → only shown to room_type='day_guest' guests
  -- 'all'     → shown to every guest
  target_audience  TEXT        NOT NULL DEFAULT 'all'
    CHECK (target_audience IN ('suite', 'day_use', 'all')),
  sort_order       INTEGER     NOT NULL DEFAULT 100,
  is_active        BOOLEAN     NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE upsell_items ENABLE ROW LEVEL SECURITY;

-- Authenticated staff: full CRUD
CREATE POLICY "upsell_items_auth_all"
  ON upsell_items FOR ALL
  USING (auth.uid() IS NOT NULL);

-- ── guest_orders ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS guest_orders (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_id    BIGINT      NOT NULL REFERENCES public.guests(id) ON DELETE CASCADE,
  item_id     UUID        NOT NULL REFERENCES upsell_items(id) ON DELETE RESTRICT,
  quantity    INTEGER     NOT NULL DEFAULT 1 CHECK (quantity > 0),
  status      TEXT        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'fulfilled', 'cancelled')),
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE guest_orders ENABLE ROW LEVEL SECURITY;

-- Authenticated staff: full CRUD (service-role writes from portal edge function bypass RLS)
CREATE POLICY "guest_orders_auth_all"
  ON guest_orders FOR ALL
  USING (auth.uid() IS NOT NULL);

-- Index for fast per-guest order lookup (management dashboard, operations board)
CREATE INDEX IF NOT EXISTS idx_guest_orders_guest_id ON guest_orders(guest_id);
CREATE INDEX IF NOT EXISTS idx_guest_orders_status   ON guest_orders(status);

-- ── Seed: initial catalog ─────────────────────────────────────────────────────
-- All seeded items are editable via admin UI — these are starting defaults only.
INSERT INTO upsell_items (name, description, price, category, target_audience, sort_order) VALUES
  ('טיפול ספא נוסף',
   'מסאז'' רקמות עמוק 60 דקות — נשלח לכם לחדר אישור עם שעה מדויקת',
   280, 'spa', 'all', 10),

  ('שדרוג ארוחת בוקר',
   'ארוחת בוקר אמריקאית מפנקת עם ממרחים, פירות, מיצים טבעיים ופתיחת יום מושלמת',
   120, 'food', 'all', 20),

  ('בקבוק שמפניה',
   'שמפניה מובחרת עם ניחוח פירות יער — מוגשת קרה לחדר',
   180, 'amenity', 'suite', 30),

  ('סל פירות עונתי',
   'פירות טריים מרעננים, פרוסים ומוגשים בסטייל לחדרכם',
   85, 'amenity', 'all', 40),

  ('שיעור יוגה בוקר',
   'שיעור יוגה פרטי עם מדריכה מוסמכת — שעה לפני שהיום מתחיל',
   150, 'activity', 'all', 50),

  ('ארוחת ערב רומנטית לחדר',
   'ארוחת שף פרטית לשניים: 3 מנות, קינוח, ואווירה בלי לצאת מהחדר',
   450, 'food', 'suite', 60),

  ('פדל / ספורט',
   'שעת משחק בפדל + ציוד — לבד, בזוג, או כקבוצה',
   120, 'activity', 'day_use', 70),

  ('כניסה לג''קוזי מכסה',
   'גישה פרטית לג''קוזי חיצוני עם מכסה — שעתיים לבחירתכם',
   200, 'amenity', 'day_use', 80)
ON CONFLICT DO NOTHING;

-- ── tasks.source CHECK — widen to include 'portal_order' ─────────────────────
-- Portal order → task route for direct service requests (follow same pattern
-- as 'portal_room_service' widened in migration 085).
DO $$
BEGIN
  -- Drop the existing check constraint if it exists, then recreate with the new value.
  -- The constraint name follows the naming convention from migration 085.
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'tasks' AND constraint_name = 'tasks_source_check'
  ) THEN
    ALTER TABLE tasks DROP CONSTRAINT tasks_source_check;
  END IF;

  ALTER TABLE tasks ADD CONSTRAINT tasks_source_check CHECK (
    source IN (
      'whatsapp_staff', 'manual', 'inbox_routed', 'guest_request',
      'manual_group', 'portal_upsell', 'portal_room_service', 'portal_order',
      'voice_call', 'legacy_service_call'
    )
  );
END$$;
