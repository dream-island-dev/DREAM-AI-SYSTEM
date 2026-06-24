-- ================================================================
-- Migration 081: Guest claim/assignment + meal metadata
-- Session 9 (Live Inbox & WordPress-style CMS Editor) — two independent
-- additions to `guests`, bundled in one migration since both are pure
-- ADD COLUMN IF NOT EXISTS with no interdependency:
--
-- 1. claimed_by / claimed_at — persisted "who's handling this guest's
--    conversation" assignment for WhatsAppInbox.js. Lives on `guests` (not
--    a new table) per §0.5 Single Source of Truth — guests already is the
--    one row-per-guest table the inbox joins via guest_id, so a claim is
--    just another guest-state field, not a new entity. Mirrors the existing
--    tasks.claimed_by/claimed_at pattern (migration 071) used by
--    OperationsBoard.js, but scoped to guests since conversations aren't a
--    table — they're grouped client-side by phone in WhatsAppInbox.js.
--
-- 2. meal_time / meal_location — same shape as the existing spa_time field
--    (migration 044): plain TEXT, manually set, read by the inbox's
--    contextual quick-reply macros. No CHECK constraint on meal_location —
--    deliberately freeform (dining room name/table number), same reasoning
--    as why `room` isn't an enum: SUITE_REGISTRY governs rooms, but meal
--    seating has no equivalent fixed registry today.
-- ================================================================

ALTER TABLE public.guests
  ADD COLUMN IF NOT EXISTS claimed_by    UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS claimed_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS meal_time     TEXT,
  ADD COLUMN IF NOT EXISTS meal_location TEXT;

COMMENT ON COLUMN public.guests.claimed_by IS
  'profiles.id of the staff member currently handling this guest''s WhatsApp conversation (WhatsAppInbox.js claim/take-over button). NULL = unclaimed.';
COMMENT ON COLUMN public.guests.claimed_at IS
  'Timestamp of the most recent claim/take-over. Cleared (set NULL) together with claimed_by on release.';
COMMENT ON COLUMN public.guests.meal_time IS
  'Manually-set dining reservation time (e.g. "19:30"), same editing convention as spa_time (migration 044). Feeds WhatsAppInbox.js contextual macros.';
COMMENT ON COLUMN public.guests.meal_location IS
  'Manually-set dining venue/table free text (e.g. "מסעדה ראשית, שולחן 12"). No fixed registry — freeform, unlike room (SUITE_REGISTRY).';

CREATE INDEX IF NOT EXISTS idx_guests_claimed_by ON public.guests (claimed_by) WHERE claimed_by IS NOT NULL;
