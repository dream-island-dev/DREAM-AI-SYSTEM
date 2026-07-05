-- 136: Meal plan + per-meal times for guest stay (portal + staff profile).

ALTER TABLE public.guests
  ADD COLUMN IF NOT EXISTS meal_plan TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS breakfast_time TEXT,
  ADD COLUMN IF NOT EXISTS lunch_time TEXT,
  ADD COLUMN IF NOT EXISTS dinner_time TEXT;

ALTER TABLE public.guests DROP CONSTRAINT IF EXISTS guests_meal_plan_check;
ALTER TABLE public.guests
  ADD CONSTRAINT guests_meal_plan_check
  CHECK (meal_plan IN ('none', 'dinner_only', 'half_board', 'full_board'));

COMMENT ON COLUMN public.guests.meal_plan IS
  'Board basis: none | dinner_only | half_board | full_board. Portal + GuestProfileModal.';
COMMENT ON COLUMN public.guests.breakfast_time IS 'HH:MM — shown when meal_plan is half_board or full_board.';
COMMENT ON COLUMN public.guests.lunch_time IS 'HH:MM — shown when meal_plan is full_board.';
COMMENT ON COLUMN public.guests.dinner_time IS 'HH:MM — dinner slot; meal_time kept in sync as primary legacy column.';
