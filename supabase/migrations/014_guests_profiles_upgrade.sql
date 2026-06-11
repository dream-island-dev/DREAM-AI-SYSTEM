-- ================================================================
-- Migration 014: Guests departure_date + Profiles job_title + Role fix
-- Safe to re-run (idempotent). Run in Supabase SQL Editor.
-- ================================================================

-- ── A. Add departure_date to guests ──────────────────────────────
ALTER TABLE public.guests
  ADD COLUMN IF NOT EXISTS departure_date DATE;

CREATE INDEX IF NOT EXISTS idx_guests_departure ON public.guests (departure_date);

-- ── B. Add 'day_guest' to room_type CHECK (was missing) ──────────
ALTER TABLE public.guests
  DROP CONSTRAINT IF EXISTS guests_room_type_check;

ALTER TABLE public.guests
  ADD CONSTRAINT guests_room_type_check
  CHECK (room_type IN ('day_guest', 'standard', 'suite'));

-- ── C. Add job_title to profiles ─────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS job_title TEXT;

-- ── D. Expand role CHECK to include super_admin + staff ──────────
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_role_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('super_admin', 'admin', 'manager', 'staff'));

-- ── E. Fix DEFAULT role to 'staff' ───────────────────────────────
ALTER TABLE public.profiles
  ALTER COLUMN role SET DEFAULT 'staff';

-- ── F. Fix DB trigger — new users default to 'staff' ─────────────
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.profiles (id, name, email, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.email,
    CASE
      WHEN NEW.email = 'tzalamnadlan@gmail.com' THEN 'super_admin'
      WHEN NEW.email = 'promote7il@gmail.com'   THEN 'admin'
      ELSE 'staff'
    END
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;
