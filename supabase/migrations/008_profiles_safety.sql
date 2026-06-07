-- ================================================================
-- Migration 008: Profiles table hardening
-- ----------------------------------------------------------------
-- 1. Ensure the status column exists (added in 003 but schema.sql
--    may have been applied after, rolling it back).
-- 2. Backfill any auth.users rows that are missing a profiles row
--    (handles cases where the handle_new_auth_user trigger failed).
-- 3. Ensure role CHECK constraint includes all 4 tiers.
-- Safe to re-run (all operations are idempotent).
-- ================================================================

-- ── 1. Add status column if it was lost ──────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'suspended', 'pending'));

-- ── 2. Add avatar column if missing ─────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS avatar TEXT;

-- ── 3. Repair role CHECK constraint to include all 4 tiers ──────────────────
-- Drop the old constraint (which may only allow 'admin'|'manager')
-- and replace it with the full set.
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_role_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('super_admin', 'admin', 'manager', 'staff'));

-- ── 4. Backfill missing profile rows from auth.users ────────────────────────
-- Any auth.users row without a matching profiles row gets a staff profile.
INSERT INTO public.profiles (id, name, email, role, avatar_text, status)
SELECT
  au.id,
  COALESCE(au.raw_user_meta_data->>'name', split_part(au.email, '@', 1), 'User'),
  au.email,
  CASE lower(au.email)
    WHEN 'tzalamnadlan@gmail.com' THEN 'super_admin'
    WHEN 'promote7il@gmail.com'   THEN 'admin'
    ELSE 'staff'
  END,
  LEFT(UPPER(COALESCE(au.raw_user_meta_data->>'name', au.email, 'U')), 2),
  'active'
FROM auth.users au
WHERE NOT EXISTS (
  SELECT 1 FROM public.profiles p WHERE p.id = au.id
)
ON CONFLICT (id) DO NOTHING;

-- ── 5. Re-apply owner model to existing rows ─────────────────────────────────
UPDATE public.profiles
SET role = 'super_admin', updated_at = NOW()
WHERE lower(email) = 'tzalamnadlan@gmail.com'
  AND role IS DISTINCT FROM 'super_admin';

UPDATE public.profiles
SET role = 'admin', updated_at = NOW()
WHERE lower(email) = 'promote7il@gmail.com'
  AND role IS DISTINCT FROM 'admin';

-- ================================================================
-- END OF MIGRATION 008
-- ================================================================
