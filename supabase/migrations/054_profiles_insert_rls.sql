-- Migration 054: profiles INSERT policy + onboarding upsert UPDATE-path fix
--
-- Reported error: "new row violates row-level security policy (USING
-- expression) for table profiles" from DepartmentOnboardingModal's upsert().
--
-- ── Part 1 (as requested): explicit self-row INSERT policy ───────────────────
-- NOTE verified against the live policy set (migration 003): "profiles_insert_trigger"
-- already grants INSERT WITH CHECK (true) unconditionally, so a plain INSERT was
-- never the blocker on its own. This narrower, explicitly-named policy is additive
-- (multiple permissive policies OR together) and documents real intent.
DROP POLICY IF EXISTS "profiles_insert_self" ON public.profiles;
CREATE POLICY "profiles_insert_self" ON public.profiles
  FOR INSERT
  WITH CHECK (auth.uid() = id);

-- ── Part 2 (root-cause candidate): upsert's ON CONFLICT DO UPDATE branch ─────
-- "USING expression" only ever applies to SELECT/UPDATE/DELETE policies — INSERT
-- policies have no USING clause. .upsert() compiles to INSERT ... ON CONFLICT (id)
-- DO UPDATE, and when the on_auth_user_created trigger (migration 052) has already
-- created the row, every onboarding save hits that UPDATE branch, which checks the
-- UPDATE policies' USING clause, not the INSERT policy above.
--
-- The only existing self-update policy ("profiles_update_self", migration 003)
-- requires get_true_role() != 'super_admin' in its USING clause in addition to
-- auth.uid() = id. This adds a second permissive UPDATE policy with that extra
-- condition removed from USING — while keeping the EXACT same anti-role-escalation
-- WITH CHECK, so a user still can never write a different role into their own row.
-- Safe to add alongside the existing policy: permissive USING/WITH CHECK clauses
-- OR together, so this only ever widens reachability, never weakens the role guard.
DROP POLICY IF EXISTS "profiles_update_self_basic" ON public.profiles;
CREATE POLICY "profiles_update_self_basic" ON public.profiles
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id
    AND role = (SELECT role FROM public.profiles WHERE id = auth.uid())
  );
