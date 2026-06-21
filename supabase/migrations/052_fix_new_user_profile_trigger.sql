-- Migration 052: Bind handle_new_auth_user() to auth.users (onboarding-loop fix)
--
-- ROOT CAUSE: the handle_new_auth_user() function has been redefined four
-- times across migrations 002/003/004/014, but no migration ever contained
-- the CREATE TRIGGER statement that actually binds it to fire on
-- `auth.users` INSERT. A brand-new auth user (e.g. created directly in
-- Supabase Auth) therefore never gets a `profiles` row at all.
--
-- DepartmentOnboardingModal's save then runs `UPDATE profiles ... WHERE id=?`
-- against a row that doesn't exist — Postgres reports 0 rows affected, NOT
-- an error, so the frontend believes the save succeeded. On the next page
-- load `loadUserWithProfile()` finds no row (again), `user.department` is
-- still empty, and the onboarding modal reappears — the infinite "onboarding
-- loop" reported by Mike for newly created agents (e.g. "Afek").
--
-- This migration is idempotent and safe to re-run regardless of whether the
-- trigger already exists on the live DB.

-- ── 1. Bind the existing function to auth.users (was missing entirely) ──────
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

-- ── 2. Backfill any auth.users created since migration 008 that are still
--      missing a profiles row (mirrors 008's one-time backfill, which only
--      covered users that existed at the time it ran). ──────────────────────
INSERT INTO public.profiles (id, name, email, role, avatar_text, status)
SELECT
  au.id,
  COALESCE(au.raw_user_meta_data->>'name', au.raw_user_meta_data->>'full_name', split_part(au.email, '@', 1), 'User'),
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
