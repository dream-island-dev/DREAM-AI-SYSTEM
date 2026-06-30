-- 110_mid_stay_require_checked_in.sql
-- Optional gate for Stage 4 (mid_stay): when true (default), cron/queue require
-- guests.status = 'checked_in' before dispatch. When false, timing alone decides.

ALTER TABLE public.automation_stages
  ADD COLUMN IF NOT EXISTS require_checked_in BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.automation_stages.require_checked_in IS
  'Stage 4 (mid_stay) only: when true, guest must be checked_in before dispatch. '
  'When false, send on schedule regardless of check-in status (ops override).';

-- Preserve current behavior for other stages; mid_stay starts OFF per ops request
-- (staff check-in sync lag) — re-enable via Automation Control Center toggle.
UPDATE public.automation_stages
SET require_checked_in = false
WHERE stage_key = 'mid_stay';

UPDATE public.automation_stages
SET require_checked_in = true
WHERE stage_key <> 'mid_stay';
