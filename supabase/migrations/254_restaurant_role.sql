-- Migration 254: restaurant role — kiosk-only לוח מסעדה (כמו cleaner + housekeeping tablet).

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_role_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN (
    'super_admin', 'admin', 'manager', 'staff', 'cleaner', 'receptionist', 'restaurant'
  ));

COMMENT ON COLUMN public.profiles.role IS
  'restaurant = לוח מסעדה בלבד (תיאום שעות + הזמנות + KDS).';

CREATE OR REPLACE FUNCTION public.is_restaurant_staff_or_manager()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND (
        p.role = 'restaurant'
        OR p.restaurant_access = true
        OR p.role IN ('manager', 'admin', 'super_admin')
      )
  );
$$;
