-- 261: allow the shared kiosk account (role='restaurant') to manage the restaurant menu CMS.
-- App-level gate (shift-manager PIN + session_role) controls who reaches the UI;
-- this matches the existing pattern in migration 255 for restaurant_dinner_messages.

CREATE OR REPLACE FUNCTION public.is_restaurant_menu_admin()
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
