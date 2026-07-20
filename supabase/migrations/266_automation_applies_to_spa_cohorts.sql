-- 266: Expand automation_stages.applies_to — suite/daypass × spa sub-cohorts.
-- Behavior-preserving: migrates hardcoded spa stage_key gates into declarative applies_to.
-- Legacy non_suite → daypass (umbrella). Code still accepts non_suite until rows are updated.

ALTER TABLE public.automation_stages
  DROP CONSTRAINT IF EXISTS automation_stages_applies_to_check;

ALTER TABLE public.automation_stages
  ADD CONSTRAINT automation_stages_applies_to_check
  CHECK (applies_to IN (
    'all',
    'suite', 'suite_spa', 'suite_no_spa',
    'daypass', 'daypass_spa', 'daypass_no_spa',
    'non_suite'
  ));

COMMENT ON COLUMN public.automation_stages.applies_to IS
  'Audience: all | suite(+_spa/_no_spa) | daypass(+_spa/_no_spa). non_suite legacy alias for daypass. spa = spa_date equals arrival_date.';

-- Umbrella day-pass stages (with + without spa) — same reach as old non_suite.
UPDATE public.automation_stages
SET applies_to = 'daypass'
WHERE stage_key IN ('morning_welcome', 'mid_stay_daypass')
  AND applies_to IN ('non_suite', 'daypass');

-- Spa day-pass only (was non_suite + checkEligibility stage_key gate).
UPDATE public.automation_stages
SET applies_to = 'daypass_spa'
WHERE stage_key IN ('night_before_daypass', 'spa_warmup_daypass', 'survey_invite_daypass');

-- Day-pass without spa (checkout_fb dedupe + manual upsell).
UPDATE public.automation_stages
SET applies_to = 'daypass_no_spa'
WHERE stage_key IN ('checkout_fb_daypass', 'spa_upsell_daypass');

-- Remaining legacy non_suite → daypass umbrella.
UPDATE public.automation_stages
SET applies_to = 'daypass'
WHERE applies_to = 'non_suite';
