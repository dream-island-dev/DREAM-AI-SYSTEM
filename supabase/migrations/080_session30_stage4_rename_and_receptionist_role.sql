-- Migration 080: Session 5 (post-29) — two unrelated small changes bundled
-- together because both are one-line, low-risk catalogue edits:
--
-- 1. Rename automation_stages.display_name for stage_key='mid_stay' from
--    "Stage 4 — מצב שהות 🏨" to "Stage 4 — שיחות נימוסים 🏨" — a premium,
--    non-technical label for AutomationControlCenter.js's "מסע האורח" tab.
--    UPDATE only — stage_key/timing/content untouched, this is cosmetic.
--
-- 2. Add 'receptionist' to profiles.role CHECK constraint, same pattern as
--    migration 038's 'cleaner' addition — extends the existing single
--    source of truth (profiles.role) rather than introducing a parallel
--    staff_users table (CLAUDE.md §0.5).

UPDATE automation_stages
SET display_name = 'Stage 4 — שיחות נימוסים 🏨'
WHERE stage_key = 'mid_stay';

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('super_admin', 'admin', 'manager', 'staff', 'cleaner', 'receptionist'));
