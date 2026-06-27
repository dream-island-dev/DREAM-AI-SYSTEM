-- Migration 098: Portal Scene Visibility Segmentation
-- session: "EXTENSION: PORTAL SCENE VISIBILITY SEGMENTATION"
--
-- Two-level visibility control for the guest portal:
--
-- Level 1 — Scene-level (this migration):
--   portal_scenes.visibility_settings TEXT[] — which room_types see this entire
--   scene. Default: all three types (no existing scene disappears). GIN index
--   enables the same @> (array-contains) filter used by upsell_items.
--
-- Level 2 — CTA-level (JSONB extension, no schema migration needed):
--   Each object in portal_scenes.ctas may optionally include:
--   { ..., "visibility": ["suite"] }
--   Absence of the key = no restriction (backward compat). guest-portal-data
--   strips CTAs the guest is not entitled to server-side before responding.
--
-- Architectural change: portal_scenes is now fetched by guest-portal-data
-- (server-side, filtered) and sent as `scenes` in the response. PhotoTour.js
-- uses the prop when available and falls back to its own DB fetch only when
-- GuestPortal.js hasn't provided scenes (staff previews, offline, etc.).
-- The portal_scenes table keeps its PUBLIC read RLS — the edge function uses
-- service_role key anyway; the public policy remains for legacy callers.

ALTER TABLE public.portal_scenes
  ADD COLUMN IF NOT EXISTS visibility_settings TEXT[]
    NOT NULL DEFAULT ARRAY['suite', 'day_guest', 'premium_day_guest'];

-- GIN index for @> (array-contains) filter — mirrors idx_upsell_items_visibility
CREATE INDEX IF NOT EXISTS idx_portal_scenes_visibility
  ON public.portal_scenes USING GIN (visibility_settings);

-- Inline self-test
DO $$
DECLARE
  empty_count INT;
BEGIN
  SELECT COUNT(*) INTO empty_count
    FROM public.portal_scenes
   WHERE array_length(visibility_settings, 1) = 0
      OR visibility_settings IS NULL;
  IF empty_count > 0 THEN
    RAISE EXCEPTION 'Migration 098 self-test FAILED: % rows have empty/null visibility_settings', empty_count;
  END IF;
  RAISE NOTICE 'Migration 098 self-test PASSED: all portal_scenes rows have visibility_settings set';
END$$;
