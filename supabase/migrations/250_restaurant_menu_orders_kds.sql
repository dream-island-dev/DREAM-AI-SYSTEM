-- =============================================================================
-- 250_restaurant_menu_orders_kds.sql
-- Restaurant Menu CMS + Waiter Orders + Kitchen Display (KDS).
-- Separate from upsell_items/guest_orders (experience hub).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.is_restaurant_staff_or_manager()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND (
        p.restaurant_access = true
        OR p.role IN ('manager', 'admin', 'super_admin')
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.is_restaurant_menu_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role IN ('manager', 'admin', 'super_admin')
  );
$$;

CREATE TABLE IF NOT EXISTS public.restaurant_daily_counters (
  day_ymd     DATE        NOT NULL PRIMARY KEY,
  last_number INTEGER     NOT NULL DEFAULT 0
);

CREATE OR REPLACE FUNCTION public.next_restaurant_order_display_number(
  p_day DATE DEFAULT (NOW() AT TIME ZONE 'Asia/Jerusalem')::DATE
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n INTEGER;
BEGIN
  INSERT INTO public.restaurant_daily_counters (day_ymd, last_number)
  VALUES (p_day, 1)
  ON CONFLICT (day_ymd) DO UPDATE
    SET last_number = public.restaurant_daily_counters.last_number + 1
  RETURNING last_number INTO n;
  RETURN n;
END;
$$;

CREATE TABLE IF NOT EXISTS public.restaurant_menu_versions (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  label         TEXT         NOT NULL DEFAULT 'תפריט ראשי',
  status        TEXT         NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft', 'published', 'archived')),
  published_at  TIMESTAMPTZ,
  published_by  UUID         REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  created_by    UUID         REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_restaurant_menu_versions_one_published
  ON public.restaurant_menu_versions (status)
  WHERE status = 'published';

CREATE TABLE IF NOT EXISTS public.restaurant_menu_sections (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id  UUID         NOT NULL REFERENCES public.restaurant_menu_versions(id) ON DELETE CASCADE,
  name        TEXT         NOT NULL,
  sort_order  INTEGER      NOT NULL DEFAULT 100,
  is_active   BOOLEAN      NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_restaurant_menu_sections_version
  ON public.restaurant_menu_sections (version_id, sort_order);

CREATE TABLE IF NOT EXISTS public.restaurant_menu_items (
  id            UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id    UUID           NOT NULL REFERENCES public.restaurant_menu_sections(id) ON DELETE CASCADE,
  name          TEXT           NOT NULL,
  description   TEXT,
  price         NUMERIC(10, 2),
  course        TEXT           NOT NULL DEFAULT 'main'
                CHECK (course IN ('starter', 'main', 'dessert', 'drink', 'kids', 'side', 'other')),
  allergens     TEXT[]         NOT NULL DEFAULT '{}',
  tags          TEXT[]         NOT NULL DEFAULT '{}',
  is_available  BOOLEAN        NOT NULL DEFAULT true,
  sort_order    INTEGER        NOT NULL DEFAULT 100,
  created_at    TIMESTAMPTZ    NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ    NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_restaurant_menu_items_section
  ON public.restaurant_menu_items (section_id, sort_order);

DROP TRIGGER IF EXISTS trg_restaurant_menu_items_updated ON public.restaurant_menu_items;
CREATE TRIGGER trg_restaurant_menu_items_updated
  BEFORE UPDATE ON public.restaurant_menu_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.restaurant_menu_imports (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id      UUID         REFERENCES public.restaurant_menu_versions(id) ON DELETE SET NULL,
  source_filename TEXT,
  storage_path    TEXT,
  raw_ai_json     JSONB,
  parsed_summary  JSONB,
  status          TEXT         NOT NULL DEFAULT 'pending_review'
                  CHECK (status IN ('pending_review', 'approved', 'rejected')),
  reviewed_by     UUID         REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at     TIMESTAMPTZ,
  review_note     TEXT,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  created_by      UUID         REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.restaurant_kds_tokens (
  id          BIGSERIAL    PRIMARY KEY,
  token       UUID         NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  label       TEXT         NOT NULL DEFAULT 'מסך מטבח',
  is_active   BOOLEAN      NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  created_by  UUID         REFERENCES auth.users(id) ON DELETE SET NULL
);

INSERT INTO public.restaurant_kds_tokens (label, is_active)
SELECT 'מסך מטבח — ערמונים', true
WHERE NOT EXISTS (SELECT 1 FROM public.restaurant_kds_tokens WHERE is_active = true);

CREATE TABLE IF NOT EXISTS public.restaurant_orders (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  display_number  INTEGER      NOT NULL,
  day_ymd         DATE         NOT NULL DEFAULT (NOW() AT TIME ZONE 'Asia/Jerusalem')::DATE,
  meal_period     TEXT         NOT NULL DEFAULT 'dinner'
                  CHECK (meal_period IN ('lunch', 'dinner', 'other')),
  status          TEXT         NOT NULL DEFAULT 'submitted'
                  CHECK (status IN ('submitted', 'in_kitchen', 'ready', 'served', 'cancelled')),
  guest_id        BIGINT       REFERENCES public.guests(id) ON DELETE SET NULL,
  table_label     TEXT,
  guest_name_snap TEXT,
  room_snap       TEXT,
  dietary_snap    TEXT,
  vip_snap        BOOLEAN      NOT NULL DEFAULT false,
  waiter_id       UUID         REFERENCES public.profiles(id) ON DELETE SET NULL,
  kitchen_notes   TEXT,
  cancel_reason   TEXT,
  submitted_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  in_kitchen_at   TIMESTAMPTZ,
  ready_at        TIMESTAMPTZ,
  served_at       TIMESTAMPTZ,
  cancelled_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (day_ymd, display_number)
);

CREATE INDEX IF NOT EXISTS idx_restaurant_orders_kds_queue
  ON public.restaurant_orders (status, submitted_at)
  WHERE status IN ('submitted', 'in_kitchen', 'ready');

CREATE INDEX IF NOT EXISTS idx_restaurant_orders_day
  ON public.restaurant_orders (day_ymd DESC, display_number DESC);

CREATE INDEX IF NOT EXISTS idx_restaurant_orders_guest
  ON public.restaurant_orders (guest_id, submitted_at DESC)
  WHERE guest_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_restaurant_orders_updated ON public.restaurant_orders;
CREATE TRIGGER trg_restaurant_orders_updated
  BEFORE UPDATE ON public.restaurant_orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.restaurant_order_lines (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id     UUID         NOT NULL REFERENCES public.restaurant_orders(id) ON DELETE CASCADE,
  item_id      UUID         REFERENCES public.restaurant_menu_items(id) ON DELETE SET NULL,
  item_name    TEXT         NOT NULL,
  unit_price   NUMERIC(10, 2),
  quantity     INTEGER      NOT NULL DEFAULT 1 CHECK (quantity > 0 AND quantity <= 20),
  line_notes   TEXT,
  course       TEXT,
  sort_order   INTEGER      NOT NULL DEFAULT 100,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_restaurant_order_lines_order
  ON public.restaurant_order_lines (order_id, sort_order);

CREATE TABLE IF NOT EXISTS public.restaurant_order_events (
  id          BIGSERIAL    PRIMARY KEY,
  order_id    UUID         NOT NULL REFERENCES public.restaurant_orders(id) ON DELETE CASCADE,
  event_type  TEXT         NOT NULL
              CHECK (event_type IN ('submitted', 'in_kitchen', 'ready', 'served', 'cancelled', 'line_added')),
  actor_id    UUID         REFERENCES public.profiles(id) ON DELETE SET NULL,
  payload     JSONB        NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_restaurant_order_events_order
  ON public.restaurant_order_events (order_id, created_at);

ALTER TABLE public.restaurant_daily_counters        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurant_menu_versions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurant_menu_sections         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurant_menu_items            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurant_menu_imports          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurant_kds_tokens            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurant_orders                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurant_order_lines           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurant_order_events          ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS restaurant_daily_counters_deny ON public.restaurant_daily_counters;
CREATE POLICY restaurant_daily_counters_deny ON public.restaurant_daily_counters
  FOR ALL USING (false);

DROP POLICY IF EXISTS restaurant_menu_versions_read ON public.restaurant_menu_versions;
CREATE POLICY restaurant_menu_versions_read ON public.restaurant_menu_versions
  FOR SELECT USING (public.is_restaurant_staff_or_manager());

DROP POLICY IF EXISTS restaurant_menu_versions_write ON public.restaurant_menu_versions;
CREATE POLICY restaurant_menu_versions_write ON public.restaurant_menu_versions
  FOR ALL
  USING (public.is_restaurant_menu_admin())
  WITH CHECK (public.is_restaurant_menu_admin());

DROP POLICY IF EXISTS restaurant_menu_sections_read ON public.restaurant_menu_sections;
CREATE POLICY restaurant_menu_sections_read ON public.restaurant_menu_sections
  FOR SELECT USING (public.is_restaurant_staff_or_manager());

DROP POLICY IF EXISTS restaurant_menu_sections_write ON public.restaurant_menu_sections;
CREATE POLICY restaurant_menu_sections_write ON public.restaurant_menu_sections
  FOR ALL
  USING (public.is_restaurant_menu_admin())
  WITH CHECK (public.is_restaurant_menu_admin());

DROP POLICY IF EXISTS restaurant_menu_items_read ON public.restaurant_menu_items;
CREATE POLICY restaurant_menu_items_read ON public.restaurant_menu_items
  FOR SELECT USING (public.is_restaurant_staff_or_manager());

DROP POLICY IF EXISTS restaurant_menu_items_write ON public.restaurant_menu_items;
CREATE POLICY restaurant_menu_items_write ON public.restaurant_menu_items
  FOR ALL
  USING (public.is_restaurant_menu_admin())
  WITH CHECK (public.is_restaurant_menu_admin());

DROP POLICY IF EXISTS restaurant_menu_imports_rw ON public.restaurant_menu_imports;
CREATE POLICY restaurant_menu_imports_rw ON public.restaurant_menu_imports
  FOR ALL
  USING (public.is_restaurant_menu_admin())
  WITH CHECK (public.is_restaurant_menu_admin());

DROP POLICY IF EXISTS restaurant_kds_tokens_admin ON public.restaurant_kds_tokens;
CREATE POLICY restaurant_kds_tokens_admin ON public.restaurant_kds_tokens
  FOR ALL
  USING (public.is_restaurant_menu_admin())
  WITH CHECK (public.is_restaurant_menu_admin());

DROP POLICY IF EXISTS restaurant_orders_rw ON public.restaurant_orders;
CREATE POLICY restaurant_orders_rw ON public.restaurant_orders
  FOR ALL
  USING (public.is_restaurant_staff_or_manager())
  WITH CHECK (public.is_restaurant_staff_or_manager());

DROP POLICY IF EXISTS restaurant_order_lines_rw ON public.restaurant_order_lines;
CREATE POLICY restaurant_order_lines_rw ON public.restaurant_order_lines
  FOR ALL
  USING (public.is_restaurant_staff_or_manager())
  WITH CHECK (public.is_restaurant_staff_or_manager());

DROP POLICY IF EXISTS restaurant_order_events_rw ON public.restaurant_order_events;
CREATE POLICY restaurant_order_events_rw ON public.restaurant_order_events
  FOR ALL
  USING (public.is_restaurant_staff_or_manager())
  WITH CHECK (public.is_restaurant_staff_or_manager());

ALTER TABLE public.restaurant_orders REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'restaurant_orders'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.restaurant_orders;
  END IF;
END$$;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'restaurant-menu-imports',
  'restaurant-menu-imports',
  false,
  10485760,
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS restaurant_menu_imports_storage_insert ON storage.objects;
CREATE POLICY restaurant_menu_imports_storage_insert ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'restaurant-menu-imports'
    AND public.is_restaurant_menu_admin()
  );

DROP POLICY IF EXISTS restaurant_menu_imports_storage_select ON storage.objects;
CREATE POLICY restaurant_menu_imports_storage_select ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'restaurant-menu-imports'
    AND public.is_restaurant_menu_admin()
  );

INSERT INTO public.restaurant_menu_versions (label, status)
SELECT 'תפריט ראשי — טיוטה', 'draft'
WHERE NOT EXISTS (SELECT 1 FROM public.restaurant_menu_versions);

INSERT INTO public.restaurant_menu_sections (version_id, name, sort_order)
SELECT v.id, 'עיקריות', 10
FROM public.restaurant_menu_versions v
WHERE v.status = 'draft'
  AND NOT EXISTS (
    SELECT 1 FROM public.restaurant_menu_sections s WHERE s.version_id = v.id
  )
LIMIT 1;
