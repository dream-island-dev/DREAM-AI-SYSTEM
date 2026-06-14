-- ================================================================
-- Migration 027: guests.manager_id column + trigger + RLS sync
--
-- PROBLEM: The manager_id column and its auto-stamp trigger exist
-- in the live DB (added manually) but were never captured in a
-- migration file. This migration makes the state reproducible.
--
-- ALSO FIXES: Ensures all authenticated users (manager/admin/
-- super_admin) can read ALL guests, not just their own.
-- The manager_id field is for organisational tracking only —
-- it DOES NOT restrict read access.
--
-- Safe to re-run (fully idempotent).
-- ================================================================

-- ── 1. Add manager_id column (who uploaded this guest) ───────────
ALTER TABLE public.guests
  ADD COLUMN IF NOT EXISTS manager_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_guests_manager_id ON public.guests (manager_id);

COMMENT ON COLUMN public.guests.manager_id
  IS 'Profile ID of the manager who uploaded/created this guest. Used for dept-based filtering in BroadcastDashboard. Does NOT restrict read access.';

-- ── 2. Auto-stamp trigger — set manager_id = current user on INSERT ──
CREATE OR REPLACE FUNCTION public.set_guests_manager_id()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Only stamp if not already set explicitly (allows service-role inserts
  -- from Edge Functions to pass their own manager_id or leave it NULL).
  IF NEW.manager_id IS NULL AND auth.uid() IS NOT NULL THEN
    NEW.manager_id := auth.uid();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_guests_manager_id ON public.guests;
CREATE TRIGGER trg_set_guests_manager_id
  BEFORE INSERT ON public.guests
  FOR EACH ROW EXECUTE FUNCTION public.set_guests_manager_id();

-- ── 3. RLS — ensure ALL authenticated users see ALL guests ──────────
-- Drop any existing policies (including any restrictive ones added
-- manually to the live DB) and replace with a single open policy.
ALTER TABLE public.guests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS guests_rw         ON public.guests;
DROP POLICY IF EXISTS guests_read       ON public.guests;
DROP POLICY IF EXISTS guests_write      ON public.guests;
DROP POLICY IF EXISTS guests_manager_rw ON public.guests;
DROP POLICY IF EXISTS guests_own        ON public.guests;

-- READ: every authenticated user (staff / manager / admin / super_admin)
-- can see every guest. Filtering by dept happens in the frontend only.
CREATE POLICY guests_read ON public.guests
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- WRITE: every authenticated user can insert / update / delete guests.
-- (Operational staff need to update status; managers upload new guests.)
CREATE POLICY guests_write ON public.guests
  FOR ALL
  USING     (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- ================================================================
-- END OF MIGRATION 027
-- ================================================================
