-- 180_spa_board_color_staff_note.sql
-- Staff UX on Smart Spa Board: per-appointment color marker + staff-only note.
-- Separated from `notes` (Ezgo import text) so re-import never wipes staff annotations.

ALTER TABLE public.spa_appointments
  ADD COLUMN IF NOT EXISTS board_color TEXT,
  ADD COLUMN IF NOT EXISTS staff_note  TEXT;

ALTER TABLE public.spa_appointments
  DROP CONSTRAINT IF EXISTS spa_appointments_board_color_check;

ALTER TABLE public.spa_appointments
  ADD CONSTRAINT spa_appointments_board_color_check
  CHECK (
    board_color IS NULL
    OR board_color IN ('gold', 'blue', 'green', 'rose', 'amber', 'slate')
  );

COMMENT ON COLUMN public.spa_appointments.board_color IS
  'Optional staff visual marker on SpaBoard cards. Keys: gold|blue|green|rose|amber|slate. Never written by Ezgo sync.';
COMMENT ON COLUMN public.spa_appointments.staff_note IS
  'Staff-only free-text note on the board. Distinct from notes (Ezgo import). Sync engine must not overwrite.';
