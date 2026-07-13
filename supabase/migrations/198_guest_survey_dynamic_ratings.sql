-- Migration 198: Dynamic survey categories (ratings jsonb) + suites upsell CTA flag.
--
-- Staff can invent rating categories in Feedback → Surveys editor. Scores for
-- ALL categories (legacy + custom) live in guest_surveys.ratings. The original
-- six columns stay for backward compatibility / digests but become nullable so
-- a survey with only custom categories can insert without inventing fake scores.
-- avg_categories GENERATED column (locked to /6) is dropped — average is
-- computed in app/Edge from ratings (or legacy columns as fallback).

ALTER TABLE public.guest_surveys
  ADD COLUMN IF NOT EXISTS ratings jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.guest_surveys
  ADD COLUMN IF NOT EXISTS suites_cta_shown boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.guest_surveys.ratings IS
  'Category scores keyed by guest_survey_ui category key (1-10). Source of truth for dynamic categories; legacy patio/… columns mirrored when key matches.';

COMMENT ON COLUMN public.guest_surveys.suites_cta_shown IS
  'True when thank-you screen showed Dream Island suites booking CTA (positive avg).';

-- Backfill ratings from legacy columns for rows that only have the six fields.
UPDATE public.guest_surveys
SET ratings = jsonb_build_object(
  'patio', patio,
  'live_kitchen', live_kitchen,
  'chestnut_restaurant', chestnut_restaurant,
  'service_team', service_team,
  'spa', spa,
  'cleaning_maintenance', cleaning_maintenance
)
WHERE ratings = '{}'::jsonb
  AND patio IS NOT NULL
  AND live_kitchen IS NOT NULL
  AND chestnut_restaurant IS NOT NULL
  AND service_team IS NOT NULL
  AND spa IS NOT NULL
  AND cleaning_maintenance IS NOT NULL;

-- Drop generated avg (always /6) — cannot express dynamic category counts.
ALTER TABLE public.guest_surveys DROP COLUMN IF EXISTS avg_categories;

ALTER TABLE public.guest_surveys ALTER COLUMN patio DROP NOT NULL;
ALTER TABLE public.guest_surveys ALTER COLUMN live_kitchen DROP NOT NULL;
ALTER TABLE public.guest_surveys ALTER COLUMN chestnut_restaurant DROP NOT NULL;
ALTER TABLE public.guest_surveys ALTER COLUMN service_team DROP NOT NULL;
ALTER TABLE public.guest_surveys ALTER COLUMN spa DROP NOT NULL;
ALTER TABLE public.guest_surveys ALTER COLUMN cleaning_maintenance DROP NOT NULL;
