-- 256: Armonim floor roster + shift sessions (kiosk name picker + attribution).

CREATE TABLE IF NOT EXISTS public.restaurant_floor_staff (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name         TEXT        NOT NULL,
  can_be_shift_manager BOOLEAN     NOT NULL DEFAULT false,
  is_active            BOOLEAN     NOT NULL DEFAULT true,
  sort_order           INTEGER     NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_restaurant_floor_staff_active
  ON public.restaurant_floor_staff (sort_order, display_name)
  WHERE is_active = true;

COMMENT ON TABLE public.restaurant_floor_staff IS
  'Armonim kiosk roster — names in shift gate picker (Admin/manager CRUD).';

CREATE TABLE IF NOT EXISTS public.restaurant_shift_sessions (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id           UUID        REFERENCES public.restaurant_floor_staff(id) ON DELETE SET NULL,
  display_name       TEXT        NOT NULL,
  session_role       TEXT        NOT NULL DEFAULT 'waiter'
                     CHECK (session_role IN ('waiter', 'shift_manager')),
  meal_period        TEXT        NOT NULL DEFAULT 'dinner'
                     CHECK (meal_period IN ('lunch', 'dinner', 'other')),
  device_profile_id  UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  orders_count       INTEGER     NOT NULL DEFAULT 0,
  wa_sent_count      INTEGER     NOT NULL DEFAULT 0,
  started_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at           TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_restaurant_shift_sessions_active
  ON public.restaurant_shift_sessions (started_at DESC)
  WHERE ended_at IS NULL;

ALTER TABLE public.restaurant_orders
  ADD COLUMN IF NOT EXISTS waiter_name_snap TEXT,
  ADD COLUMN IF NOT EXISTS shift_session_id UUID
    REFERENCES public.restaurant_shift_sessions(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.restaurant_orders.waiter_name_snap IS
  'Display name from Armonim shift session (shared tablet).';
COMMENT ON COLUMN public.restaurant_orders.shift_session_id IS
  'Links order to restaurant_shift_sessions for shift stats.';

-- Seed starter roster (editable by managers in DB / future admin UI).
INSERT INTO public.restaurant_floor_staff (display_name, can_be_shift_manager, sort_order)
SELECT v.display_name, v.can_be_shift_manager, v.sort_order
FROM (VALUES
  ('מנהל משמרת', true, 0),
  ('מלצר/ית 1', false, 10),
  ('מלצר/ית 2', false, 20)
) AS v(display_name, can_be_shift_manager, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM public.restaurant_floor_staff LIMIT 1);

INSERT INTO public.bot_config (config_key, config_value, category, label)
VALUES (
  'restaurant_kiosk_ui',
  '{"welcome_line":"ברוכים הבאים למשמרת ערב","evening_hours_line":"שירות ערב — תיאום שעות ארוחה","kosher_badge":true,"external_menu_url":"https://armmonim.co.il/","shift_manager_pin":"","wa_signature":"צוות מסעדת ערמונים"}'::jsonb,
  'general',
  'ממשק קיוסק מסעדת ערמונים (JSON)'
)
ON CONFLICT (config_key) DO NOTHING;

ALTER TABLE public.restaurant_floor_staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurant_shift_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS restaurant_floor_staff_read ON public.restaurant_floor_staff;
CREATE POLICY restaurant_floor_staff_read ON public.restaurant_floor_staff
  FOR SELECT TO authenticated
  USING (public.is_restaurant_staff_or_manager());

DROP POLICY IF EXISTS restaurant_floor_staff_admin_write ON public.restaurant_floor_staff;
CREATE POLICY restaurant_floor_staff_admin_write ON public.restaurant_floor_staff
  FOR ALL TO authenticated
  USING (
    COALESCE((SELECT role FROM public.profiles WHERE id = auth.uid()), '')
      IN ('super_admin', 'admin', 'manager')
  )
  WITH CHECK (
    COALESCE((SELECT role FROM public.profiles WHERE id = auth.uid()), '')
      IN ('super_admin', 'admin', 'manager')
  );

DROP POLICY IF EXISTS restaurant_shift_sessions_select ON public.restaurant_shift_sessions;
CREATE POLICY restaurant_shift_sessions_select ON public.restaurant_shift_sessions
  FOR SELECT TO authenticated
  USING (public.is_restaurant_staff_or_manager());

DROP POLICY IF EXISTS restaurant_shift_sessions_insert ON public.restaurant_shift_sessions;
CREATE POLICY restaurant_shift_sessions_insert ON public.restaurant_shift_sessions
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_restaurant_staff_or_manager()
    AND device_profile_id = auth.uid()
  );

DROP POLICY IF EXISTS restaurant_shift_sessions_update ON public.restaurant_shift_sessions;
CREATE POLICY restaurant_shift_sessions_update ON public.restaurant_shift_sessions
  FOR UPDATE TO authenticated
  USING (
    public.is_restaurant_staff_or_manager()
    AND device_profile_id = auth.uid()
  )
  WITH CHECK (
    public.is_restaurant_staff_or_manager()
    AND device_profile_id = auth.uid()
  );

ALTER TABLE public.restaurant_shift_sessions REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'restaurant_shift_sessions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.restaurant_shift_sessions;
  END IF;
END $$;
