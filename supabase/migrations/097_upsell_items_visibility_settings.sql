-- Migration 097: Dynamic Portal Segmentation — upsell_items.visibility_settings
-- session: "ARCHITECTURE: DYNAMIC PORTAL SEGMENTATION"
--
-- Replaces the single-enum `target_audience` ('suite'|'day_use'|'all') with
-- a flexible TEXT[] column `visibility_settings` that lists every room_type
-- that should see the item. Uses guests.room_type vocabulary directly
-- ('suite','day_guest','premium_day_guest') — eliminating the vocabulary
-- mismatch between target_audience='day_use' and guests.room_type='day_guest'.
--
-- target_audience is NOT dropped — it stays as a legacy column for backward
-- compatibility. No existing migration or DB function reads it at runtime;
-- guest-portal-data and PortalSettingsPanel now use visibility_settings only.
-- Drop it in a future migration once stable.
--
-- premium_day_guest gap (introduced in migration 096): the old filter only
-- emitted audienceFilter=["all"] for premium_day_guest — they never saw suite-
-- specific OR day_use-specific items. visibility_settings fixes this by design.

-- ── 1. Add column ─────────────────────────────────────────────────────────────
ALTER TABLE upsell_items
  ADD COLUMN IF NOT EXISTS visibility_settings TEXT[]
    NOT NULL DEFAULT ARRAY['suite', 'day_guest', 'premium_day_guest'];

-- ── 2. Backfill from target_audience (vocabulary translation) ─────────────────
UPDATE upsell_items
SET visibility_settings = CASE
  WHEN target_audience = 'all'     THEN ARRAY['suite', 'day_guest', 'premium_day_guest']
  WHEN target_audience = 'suite'   THEN ARRAY['suite']
  WHEN target_audience = 'day_use' THEN ARRAY['day_guest', 'premium_day_guest']
  ELSE ARRAY['suite', 'day_guest', 'premium_day_guest']
END;

-- ── 3. Padel override — show to ALL guest types ───────────────────────────────
-- The resort wants Padel/sports visible to suite guests too.
-- Identified by category='activity' + name ILIKE '%פדל%'
-- (only item currently matching that combination in the seed data).
UPDATE upsell_items
SET visibility_settings = ARRAY['suite', 'day_guest', 'premium_day_guest']
WHERE category = 'activity'
  AND name ILIKE '%פדל%';

-- ── 4. GIN index for @> (array-contains) queries in guest-portal-data ─────────
CREATE INDEX IF NOT EXISTS idx_upsell_items_visibility
  ON upsell_items USING GIN (visibility_settings);

-- ── 5. Inline self-test ───────────────────────────────────────────────────────
DO $$
DECLARE
  suite_count   INT;
  dayuse_count  INT;
  all_count     INT;
BEGIN
  -- Every row must have at least one element
  SELECT COUNT(*) INTO suite_count   FROM upsell_items WHERE visibility_settings @> ARRAY['suite'];
  SELECT COUNT(*) INTO dayuse_count  FROM upsell_items WHERE visibility_settings @> ARRAY['day_guest'];
  SELECT COUNT(*) INTO all_count     FROM upsell_items WHERE array_length(visibility_settings, 1) = 0;

  IF all_count > 0 THEN
    RAISE EXCEPTION 'Migration 097 self-test FAILED: % row(s) have empty visibility_settings', all_count;
  END IF;
  IF suite_count = 0 THEN
    RAISE EXCEPTION 'Migration 097 self-test FAILED: no items visible to suite guests';
  END IF;
  IF dayuse_count = 0 THEN
    RAISE EXCEPTION 'Migration 097 self-test FAILED: no items visible to day_guest guests';
  END IF;
  RAISE NOTICE 'Migration 097 self-test PASSED: % suite-visible, % day_guest-visible, 0 empty', suite_count, dayuse_count;
END$$;
