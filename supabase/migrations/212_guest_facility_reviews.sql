-- Migration 212: Facility-scoped guest reviews (bot-collected via WhatsApp).
-- Extends guest_feedback (117) with facility_category + optional rating so
-- staff can filter restaurant/spa/patio feedback in GuestFeedbackTabs.

ALTER TABLE public.guest_feedback
  ADD COLUMN IF NOT EXISTS facility_category TEXT
    CHECK (
      facility_category IS NULL OR facility_category IN (
        'restaurant', 'live_kitchen', 'patio', 'spa', 'pool', 'bar',
        'cleaning', 'service', 'general'
      )
    ),
  ADD COLUMN IF NOT EXISTS rating SMALLINT
    CHECK (rating IS NULL OR (rating BETWEEN 1 AND 10));

CREATE INDEX IF NOT EXISTS idx_guest_feedback_facility
  ON public.guest_feedback (facility_category, created_at DESC)
  WHERE facility_category IS NOT NULL;

-- Widen source CHECK for bot tool + tier-0 facility capture paths.
DO $$
DECLARE
  v_conname TEXT;
BEGIN
  SELECT c.conname INTO v_conname
  FROM pg_constraint c
  JOIN pg_class t      ON t.oid = c.conrelid
  JOIN pg_attribute a  ON a.attrelid = t.oid
  WHERE t.relname = 'guest_feedback'
    AND c.contype = 'c'
    AND a.attname = 'source'
    AND a.attnum = ANY (c.conkey)
  LIMIT 1;

  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.guest_feedback DROP CONSTRAINT %I', v_conname);
  END IF;
END $$;

ALTER TABLE public.guest_feedback
  ADD CONSTRAINT guest_feedback_source_check
  CHECK (source IN (
    'freeform_reflection', 'post_stay_button', 'severe_complaint',
    'structured_survey', 'facility_review', 'bot_tool'
  ));
