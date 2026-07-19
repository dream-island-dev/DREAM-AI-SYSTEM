-- 257: Add hostess session role for Armonim shift gate attribution.

ALTER TABLE public.restaurant_shift_sessions
  DROP CONSTRAINT IF EXISTS restaurant_shift_sessions_session_role_check;

ALTER TABLE public.restaurant_shift_sessions
  ADD CONSTRAINT restaurant_shift_sessions_session_role_check
  CHECK (session_role IN ('waiter', 'shift_manager', 'hostess'));

COMMENT ON COLUMN public.restaurant_shift_sessions.session_role IS
  'Floor role for shift attribution: waiter | shift_manager | hostess (meal coordination).';
