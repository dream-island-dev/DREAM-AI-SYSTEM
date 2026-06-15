-- Migration 038: Add 'cleaner' role for tablet kiosk users
-- Cleaners see only RoomBoard (sidebar hidden), auto-filtered to "לניקיון".
-- Assign role manually via AdminPanel → UserManagement.

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_role_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('super_admin', 'admin', 'manager', 'staff', 'cleaner'));

-- Cleaners can read room_status (needed for RoomBoard fetch)
DROP POLICY IF EXISTS "room_status_cleaner_read" ON public.room_status;
CREATE POLICY "room_status_cleaner_read" ON public.room_status
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- Cleaners can upsert room_status (they update room state from tablet)
DROP POLICY IF EXISTS "room_status_cleaner_write" ON public.room_status;
CREATE POLICY "room_status_cleaner_write" ON public.room_status
  FOR ALL USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- Cleaners can read guests (to show guest name on room card)
-- (guests table already has open read for authenticated — no new policy needed)
