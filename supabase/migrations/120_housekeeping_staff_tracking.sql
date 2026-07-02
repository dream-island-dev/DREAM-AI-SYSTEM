-- 120_housekeeping_staff_tracking.sql
-- Session 84c — Live staff tracking on housekeeping tablet + admin roster CRUD.
-- staff_members = admin-managed roster; room_status.current_*_name = live assignment per suite.

CREATE TABLE IF NOT EXISTS public.staff_members (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT        NOT NULL,
  role       TEXT        NOT NULL DEFAULT 'both'
                         CHECK (role IN ('room_cleaner', 'jacuzzi', 'both')),
  is_active  BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_staff_members_active ON public.staff_members (is_active) WHERE is_active = TRUE;

COMMENT ON TABLE public.staff_members IS
  'Housekeeping tablet roster — names shown in assignment picker (AdminPanel CRUD).';
COMMENT ON COLUMN public.staff_members.role IS
  'room_cleaner = room/suite only; jacuzzi = jacuzzi crew; both = either picker.';

ALTER TABLE public.room_status
  ADD COLUMN IF NOT EXISTS current_cleaner_name TEXT,
  ADD COLUMN IF NOT EXISTS current_jacuzzi_name TEXT;

COMMENT ON COLUMN public.room_status.current_cleaner_name IS
  'Live assignment — who is cleaning the suite now (HousekeepingTabletView). Cleared on final clean.';
COMMENT ON COLUMN public.room_status.current_jacuzzi_name IS
  'Live assignment — who is cleaning the jacuzzi now. Cleared on final clean or jacuzzi reset.';

ALTER TABLE public.staff_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff_members_authenticated_read" ON public.staff_members;
CREATE POLICY "staff_members_authenticated_read" ON public.staff_members
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "staff_members_admin_write" ON public.staff_members;
CREATE POLICY "staff_members_admin_write" ON public.staff_members
  FOR ALL TO authenticated
  USING (
    COALESCE((SELECT role FROM public.profiles WHERE id = auth.uid()), '') IN
      ('super_admin', 'admin', 'manager')
  )
  WITH CHECK (
    COALESCE((SELECT role FROM public.profiles WHERE id = auth.uid()), '') IN
      ('super_admin', 'admin', 'manager')
  );
