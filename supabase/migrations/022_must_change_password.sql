-- ================================================================
-- Migration 022: must_change_password flag + drop department check
--
-- 1. Drop profiles_department_check — was manually added, too
--    restrictive (blocked "סוויטות", "הנהלה", etc.)
--    Department is free text; validation lives in the frontend.
-- 2. Add must_change_password BOOLEAN — set true for users created
--    with a temporary password; cleared after they set their own.
-- ================================================================

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_department_check;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;
