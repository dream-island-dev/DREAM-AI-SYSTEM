-- Migration 028: Guests table — open RLS to all authenticated users
--
-- WHY: The live DB may have had policies with names not covered by 027's DROP list,
-- leaving a restrictive "manager sees only own rows" policy active.
-- This migration nukes every policy on guests and lays down two clean ones:
--   READ  — any authenticated user sees all guests
--   WRITE — any authenticated user can insert/update/delete guests
--
-- Safe to re-run (idempotent DROP IF EXISTS).

-- ── Nuke all existing policies on guests ────────────────────────────────────
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'guests'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.guests', pol.policyname);
  END LOOP;
END$$;

-- ── Recreate: two simple open policies ──────────────────────────────────────
ALTER TABLE public.guests ENABLE ROW LEVEL SECURITY;

CREATE POLICY guests_read ON public.guests
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY guests_write ON public.guests
  FOR ALL
  USING     (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);
