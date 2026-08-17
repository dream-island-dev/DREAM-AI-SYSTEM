-- 300_ezgo_sales_segment.sql
-- EZGO Order.SalesSegment is a numeric id (live: 0,1,2,3,5,6,8,10).
-- Hebrew labels (בודדים / קבוצות ישירות) live in EZGO UI only — staff maps once.

CREATE TABLE IF NOT EXISTS public.ezgo_sales_segment_map (
  ezgo_segment_id INTEGER PRIMARY KEY,
  kind            TEXT NOT NULL DEFAULT 'unmapped'
                    CHECK (kind IN ('unmapped', 'individual', 'direct_group', 'other')),
  label           TEXT NOT NULL DEFAULT '',
  matched_via     TEXT NOT NULL DEFAULT 'seen'
                    CHECK (matched_via IN ('seen', 'staff_verified')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.ezgo_sales_segment_map IS
  'EZGO Order.SalesSegment id -> individual (בודדים) / direct_group (קבוצות ישירות). Unmapped ids stay FAIL VISIBLE until staff maps them.';

DROP TRIGGER IF EXISTS trg_ezgo_sales_segment_map_updated ON public.ezgo_sales_segment_map;
CREATE TRIGGER trg_ezgo_sales_segment_map_updated
  BEFORE UPDATE ON public.ezgo_sales_segment_map
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.ezgo_sales_segment_map ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth users can access ezgo_sales_segment_map" ON public.ezgo_sales_segment_map;
CREATE POLICY "auth users can access ezgo_sales_segment_map"
  ON public.ezgo_sales_segment_map FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "cleaner_lockdown_ezgo_sales_segment_map" ON public.ezgo_sales_segment_map;
CREATE POLICY "cleaner_lockdown_ezgo_sales_segment_map" ON public.ezgo_sales_segment_map
  AS RESTRICTIVE FOR ALL
  USING      (COALESCE(public.get_true_role(), '') <> 'cleaner')
  WITH CHECK (COALESCE(public.get_true_role(), '') <> 'cleaner');

ALTER TABLE public.guests
  ADD COLUMN IF NOT EXISTS ezgo_sales_segment_id INTEGER,
  ADD COLUMN IF NOT EXISTS sales_segment_kind TEXT
    CHECK (sales_segment_kind IS NULL OR sales_segment_kind IN ('unmapped', 'individual', 'direct_group', 'other'));

COMMENT ON COLUMN public.guests.ezgo_sales_segment_id IS
  'Raw EZGO Order.SalesSegment id. Kind comes from ezgo_sales_segment_map.';
COMMENT ON COLUMN public.guests.sales_segment_kind IS
  'individual = בודדים (full automation); direct_group = קבוצות ישירות (Stage 4 courtesy_only).';

CREATE INDEX IF NOT EXISTS idx_guests_sales_segment_kind
  ON public.guests (sales_segment_kind)
  WHERE sales_segment_kind IS NOT NULL;
